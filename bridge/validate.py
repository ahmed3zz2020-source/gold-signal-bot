# validate.py — the bridge's own re-validation of a signal.
#
# The engine already applies every rule. The bridge checks them AGAIN, locally, before
# it touches the broker. This is defence in depth: if the engine is compromised, buggy or
# simply wrong, the bridge refuses the trade. Any failure => NO TRADE (never a fallback).
#
# Two volume modes:
#   * risk mode   (default)  -> the size comes from a % of the balance
#   * fixed mode  (FIXED_VOLUME > 0) -> the trader's own size, always the same
#     (rounded DOWN to the broker's step; refused if it is below the broker's minimum)

from dataclasses import dataclass, field

MIN_RR = 2.0


@dataclass
class Plan:
    action: str            # BUY | SELL
    symbol: str
    volume: float
    price: float
    sl: float
    tp: float
    comment: str = "gold-bot"
    magic: int = 20261029
    tps: list = field(default_factory=list)

    def as_dict(self):
        return {"action": self.action, "symbol": self.symbol, "volume": self.volume,
                "price": self.price, "sl": self.sl, "tp": self.tp, "comment": self.comment,
                "magic": self.magic, "tps": self.tps}


def compute_volume(balance, risk_pct, stop_points, contract_size, point_value_per_lot,
                   min_vol=0.01, max_vol=100.0, step=0.01):
    """Lots for a fixed fractional risk.
    contract_size = ounces per lot (100 for XAUUSD) · point_value_per_lot = USD per point
    per lot (100 for XAUUSD: 1 point = 1 USD).

    ⛔ FAIL-CLOSED: if the broker's minimum lot is BIGGER than what the risk allows,
       we return 0 (= no trade). We never round the size UP to the minimum, because
       that would blow through the 0.5% risk cap (Exness gold: min lot 1.00!)."""
    if stop_points <= 0 or balance <= 0:
        return 0.0
    risk_money = balance * risk_pct / 100.0
    per_lot_risk = stop_points * point_value_per_lot
    if per_lot_risk <= 0:
        return 0.0
    vol = risk_money / per_lot_risk
    if vol < min_vol:
        return 0.0                      # the minimum lot risks more than we allow
    vol = min(max_vol, vol)
    vol = int((vol + 1e-9) / step) * step  # never exceed the step (round DOWN = safer)
    if vol < min_vol:
        return 0.0
    return round(vol, 2)


def fixed_volume_size(fixed_vol, min_vol=0.01, max_vol=100.0, step=0.01):
    """The trader's FIXED size (e.g. 0.01 lot), rounded DOWN to the broker's step.

    ⛔ If it is below the broker's minimum we refuse (0 = no trade). We never round UP
       to the minimum: that would silently multiply the risk."""
    if fixed_vol <= 0:
        return 0.0
    vol = min(float(fixed_vol), max_vol)
    vol = int((vol + 1e-9) / step) * step
    if vol < min_vol - 1e-9:
        return 0.0
    return round(vol, 2)


def validate_signal(sig, *, live_price, open_positions, trades_today, daily_r_pct,
                    balance, symbol, risk_pct=0.5, max_trades_per_day=2,
                    daily_cap_pct=1.5, max_price_drift=2.0, max_signal_age_s=120,
                    min_rr=MIN_RR, now_ms=None, contract_size=100.0,
                    point_value_per_lot=100.0, min_vol=0.01, vol_step=0.01,
                    # ---- the fixed-lot mode + the guards that protect a small account
                    fixed_volume=0.0, spread_points=0.0, max_spread_points=0.0,
                    min_stop_points=0.0, max_stop_points=0.0,
                    max_risk_pct_per_trade=0.0, daily_cap_r=0.0, losses_today=0,
                    max_margin_use_pct=0.0, leverage=0.0):
    """Return (ok, reason, plan). The plan is None when the trade is refused."""
    import time
    now = now_ms if now_ms is not None else int(time.time() * 1000)

    if not sig:
        return False, "مفيش إشارة", None

    # 1) the signal must be fresh
    age = (now - int(sig.get("ts", 0))) / 1000.0
    if age > max_signal_age_s:
        return False, f"الإشارة قديمة ({age:.0f}s > {max_signal_age_s})", None
    if sig.get("expiresTs") and now > int(sig["expiresTs"]):
        return False, "الإشارة انتهت صلاحيتها", None

    # 2) the grade
    if sig.get("grade") not in ("A", "A+"):
        return False, f"الدرجة {sig.get('grade')} مش كافية", None

    # 3) the reward/risk — recomputed from the prices, never trusted from the payload
    entry = float(sig["entry"]); sl = float(sig["sl"])
    risk = abs(entry - sl)
    if risk <= 0:
        return False, "الوقف غير صالح", None
    tps = [float(t) for t in sig.get("tps", [])]
    if len(tps) < 2:
        return False, "مفيش هدفين", None
    rrs = [abs(t - entry) / risk for t in tps]
    if rrs[1] < min_rr:
        return False, f"العائد للهدف الثاني {rrs[1]:.2f}R أقل من {min_rr}", None
    if sum(rrs) / len(rrs) < min_rr:
        return False, f"العائد المدمج {(sum(rrs)/len(rrs)):.2f}R أقل من {min_rr}", None

    # 4) never stack a position
    if open_positions:
        return False, f"فيه {len(open_positions)} صفقة مفتوحة", None

    # 5) the daily trade count
    if trades_today >= max_trades_per_day:
        return False, f"وصلت لحد {max_trades_per_day} صفقات في اليوم", None

    # 6) the daily stop after N losing trades (R-based, from the broker's history)
    if daily_cap_r > 0 and losses_today >= daily_cap_r:
        return False, f"وقف اليوم ({losses_today} صفقات خاسرة - الحد {daily_cap_r})", None

    # 7) the price must still be in the zone
    if live_price is None:
        return False, "مفيش سعر حي", None
    drift = abs(float(live_price) - entry)
    if drift > max_price_drift:
        return False, f"السعر اتحرك {drift:.2f} نقطة (الحد {max_price_drift})", None

    # 8) the spread — we pay it on the way in AND on the way out
    spread = max(0.0, float(spread_points or 0.0))
    if max_spread_points > 0 and spread > max_spread_points:
        return False, f"السبريد عالي ({spread:.2f} نقطة > الحد {max_spread_points})", None

    # 9) the stop distance has to make sense (too tight = noise, too wide = a small account dies)
    if min_stop_points > 0 and risk < min_stop_points:
        return False, f"الوقف قريب جداً ({risk:.2f} نقطة < الحد {min_stop_points})", None
    if max_stop_points > 0 and risk > max_stop_points:
        return False, f"الوقف بعيد جداً ({risk:.2f} نقطة > الحد {max_stop_points})", None

    # 10) the volume — the real loss includes the spread
    eff_risk = risk + spread
    if fixed_volume > 0:
        vol = fixed_volume_size(fixed_volume, min_vol=min_vol, step=vol_step)
        if vol <= 0:
            return False, "الحجم الثابت أصغر من أصغر لوت مسموح عند البروكر", None
    else:
        vol = compute_volume(balance, risk_pct, eff_risk, contract_size, point_value_per_lot,
                              min_vol=min_vol, step=vol_step)
        if vol <= 0:
            return False, "مفيش حجم صفقة صالح", None

    # 11) the margin guard (the leverage is the real danger on a small account)
    #     the notional is computed in the ACCOUNT currency (USC on a cent account):
    #     value of 1.0 of price for `vol` lots = price * vol * point_value_per_lot
    if max_margin_use_pct > 0 and leverage > 0 and balance > 0:
        notional = float(live_price) * vol * point_value_per_lot
        margin = notional / leverage
        use_pct = margin / balance * 100.0
        if use_pct > max_margin_use_pct:
            return False, (f"الهامش {use_pct:.1f}% من الحساب أكبر من الحد "
                           f"{max_margin_use_pct}%"), None

    # 12) what this trade really risks (money AND % of the account)
    risk_money = eff_risk * point_value_per_lot * vol
    risk_pct_actual = (risk_money / balance * 100.0) if balance > 0 else 100.0
    if max_risk_pct_per_trade > 0 and risk_pct_actual > max_risk_pct_per_trade:
        return False, (f"مخاطرة الصفقة {risk_pct_actual:.2f}% أكبر من الحد "
                       f"{max_risk_pct_per_trade}%"), None

    # 13) the daily loss cap — measured with the REAL risk of this trade
    if daily_r_pct + risk_pct_actual > daily_cap_pct + 1e-9:
        return False, f"وقف اليوم (خسارة {daily_r_pct:.2f}% + {risk_pct_actual:.2f}%)", None

    action = "BUY" if sig.get("dir") == "long" else "SELL"
    plan = Plan(action=action, symbol=symbol, volume=vol,
                price=float(live_price), sl=sl, tp=tps[0], tps=tps,
                comment=f"goldbot-{sig.get('grade')}-{sig.get('id','')}"[:30])
    return True, (f"مقبول: {action} {vol} @ {live_price} (RR {rrs[1]:.2f} | "
                  f"خسارة {risk_pct_actual:.2f}%)"), plan
