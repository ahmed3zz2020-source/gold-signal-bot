# validate.py — the bridge's own re-validation of a signal.
#
# The engine already applies every rule. The bridge checks them AGAIN, locally, before
# it touches the broker. This is defence in depth: if the engine is compromised, buggy or
# simply wrong, the bridge refuses the trade. Any failure => NO TRADE (never a fallback).

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
    per lot (100 for XAUUSD: 1 point = 1 USD)."""
    if stop_points <= 0 or balance <= 0:
        return 0.0
    risk_money = balance * risk_pct / 100.0
    per_lot_risk = stop_points * point_value_per_lot
    if per_lot_risk <= 0:
        return 0.0
    vol = risk_money / per_lot_risk
    vol = max(min_vol, min(max_vol, vol))
    vol = int(vol / step) * step          # never exceed the step (round DOWN = safer)
    return round(vol, 2)


def validate_signal(sig, *, live_price, open_positions, trades_today, daily_r_pct,
                    balance, symbol, risk_pct=0.5, max_trades_per_day=2,
                    daily_cap_pct=1.5, max_price_drift=2.0, max_signal_age_s=120,
                    min_rr=MIN_RR, now_ms=None, contract_size=100.0,
                    point_value_per_lot=100.0, min_vol=0.01, vol_step=0.01):
    """Return (ok, reason, plan). The plan is None when the trade is refused."""
    import time
    now = now_ms if now_ms is not None else int(time.time() * 1000)

    if not sig:
        return False, "مفيش إشارة", None

    # 1) the signal must be fresh
    age = (now - int(sig.get("ts", 0))) / 1000.0
    if age > max_signal_age_s:
        return False, f"الإشارة قديمة ({age:.0f}s > {max_signal_age_s}s)", None
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

    # 6) the daily loss cap
    if daily_r_pct + risk_pct > daily_cap_pct + 1e-9:
        return False, f"وقف اليوم (خسارة {daily_r_pct:.2f}% + {risk_pct}%)", None

    # 7) the price must still be in the zone
    if live_price is None:
        return False, "مفيش سعر حي", None
    drift = abs(float(live_price) - entry)
    if drift > max_price_drift:
        return False, f"السعر اتحرك {drift:.2f} نقطة (الحد {max_price_drift})", None

    # 8) the volume
    vol = compute_volume(balance, risk_pct, risk, contract_size, point_value_per_lot,
                          min_vol=min_vol, step=vol_step)
    if vol <= 0:
        return False, "مفيش حجم صفقة صالح", None

    action = "BUY" if sig.get("dir") == "long" else "SELL"
    plan = Plan(action=action, symbol=symbol, volume=vol,
                price=float(live_price), sl=sl, tp=tps[0], tps=tps,
                comment=f"goldbot-{sig.get('grade')}-{sig.get('id','')}"[:30])
    return True, f"مقبول: {action} {vol} @ {live_price} (RR {rrs[1]:.2f})", plan
