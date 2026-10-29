#!/usr/bin/env python3
"""mt5_bridge.py — runs on the Windows VPS next to the MT5 terminal.

It POLLS the signal engine (pull model: no trading port is exposed to the internet),
re-validates every signal locally, then sends the order to MetaTrader 5.

Safety rules that live here (never only in the engine):
  * the SL and the TP travel WITH the order => the broker's server manages the exit
    even if this bridge or the VPS dies.
  * any failure (no MT5, wrong symbol, rejected order, stale signal) => NO TRADE.
  * DRY_RUN=1 => it only logs what it WOULD have done.

Env:
  ENGINE_URL   e.g. https://your-bridge.up.railway.app
  BRIDGE_TOKEN shared secret (the Bearer token of the engine's /next-signal)
  MT5_LOGIN / MT5_PASSWORD / MT5_SERVER   (the server name exactly as in the Personal Area)
  MT5_SYMBOL   e.g. XAUUSDm  (resolve it from the terminal, never guess)
  ACCOUNT_BALANCE fallback if the balance cannot be read
  RISK_PCT=0.5  DAILY_CAP_PCT=1.5  MAX_TRADES_PER_DAY=2
  MAX_PRICE_DRIFT=2.0  MAX_SIGNAL_AGE_S=120  DRY_RUN=1  POLL_SECONDS=5
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate import validate_signal  # noqa: E402
import mt5_conn  # noqa: E402

# the .env file (if any) must be loaded BEFORE the constants below are read
mt5_conn.load_dotenv()

ENGINE_URL = os.environ.get("ENGINE_URL", "http://127.0.0.1:8080").rstrip("/")
BRIDGE_TOKEN = os.environ.get("BRIDGE_TOKEN", "")
MT5_LOGIN = os.environ.get("MT5_LOGIN", "")
MT5_PASSWORD = os.environ.get("MT5_PASSWORD", "")
MT5_SERVER = os.environ.get("MT5_SERVER", "")
MT5_SYMBOL = os.environ.get("MT5_SYMBOL", "XAUUSDm")
MT5_PATH = os.environ.get("MT5_PATH", r"C:\Program Files\MetaTrader 5\terminal64.exe")
ACCOUNT_BALANCE = float(os.environ.get("ACCOUNT_BALANCE", "0") or 0)
RISK_PCT = float(os.environ.get("RISK_PCT", "0.5"))
DAILY_CAP_PCT = float(os.environ.get("DAILY_CAP_PCT", "1.5"))
MAX_TRADES_PER_DAY = int(os.environ.get("MAX_TRADES_PER_DAY", "2"))
MAX_PRICE_DRIFT = float(os.environ.get("MAX_PRICE_DRIFT", "2.0"))
MAX_SIGNAL_AGE_S = int(os.environ.get("MAX_SIGNAL_AGE_S", "120"))
DRY_RUN = os.environ.get("DRY_RUN", "1") not in ("0", "false", "False")
SELFTEST_SIGNAL = os.environ.get("SELFTEST_SIGNAL", "0") not in ("0", "false", "False")
POLL_SECONDS = int(os.environ.get("POLL_SECONDS", "5"))
LOG_FILE = os.environ.get("BRIDGE_LOG", "bridge.jsonl")

MAGIC = 20261029
_state = {"trades_today": 0, "day": None, "daily_r_pct": 0.0, "started": time.time()}


def log(event, **kw):
    rec = {"ts": time.time(), "event": event, **kw}
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(json.dumps(rec, ensure_ascii=False), flush=True)


def http_json(url, method="GET", body=None):
    req = urllib.request.Request(url, method=method)
    req.add_header("Authorization", f"Bearer {BRIDGE_TOKEN}")
    if body is not None:
        req.data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=15) as r:
        raw = r.read().decode()
        return r.status, (json.loads(raw) if raw else {})


def fetch_signal():
    try:
        st, body = http_json(f"{ENGINE_URL}/next-signal")
        if st == 204 or not body:
            return None
        return body
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            log("auth_error", status=e.code)
        return None
    except Exception as e:
        log("fetch_error", error=str(e))
        return None


# ------------------------------------------------------------------ MT5
def mt5_connect():
    """Connect to MT5 through mt5_conn (attach first, login only with a full triple,
    and verify the account). Returns (mt5_module, connection_info)."""
    mt5, conn = mt5_conn.connect(verbose=False)
    if not conn.get("connected"):
        log("mt5_init_failed", problems=conn.get("problems"), last_error=None)
        return None, conn
    if conn.get("mismatch"):
        log("mt5_wrong_account", login=conn.get("login"), server=conn.get("server"),
            expected_login=conn.get("expected_login"),
            expected_server=conn.get("expected_server"), problems=conn.get("problems"))
        return mt5, conn
    log("mt5_connected", mode=conn.get("mode"), server=conn.get("server"),
        login=conn.get("login"), symbol=MT5_SYMBOL, balance=conn.get("balance"),
        trade_allowed=conn.get("trade_allowed"))
    return mt5, conn


GOLD_CANDIDATES = ["XAUUSD", "XAUUSDm", "XAUUSDc", "XAUUSDmicro", "GOLD", "GOLDm", "XAUUSD.f"]


def resolve_gold_symbol(mt5):
    """Find the gold symbol THIS account actually uses (Exness names it differently per
    account type: XAUUSD / XAUUSDm / XAUUSDc). Never hardcode it."""
    if MT5_SYMBOL:
        info = mt5.symbol_info(MT5_SYMBOL)
        if info is not None:
            return MT5_SYMBOL
    names = [s.name for s in (mt5.symbols_get() or [])]
    for cand in GOLD_CANDIDATES:
        if cand in names:
            return cand
    goldish = [n for n in names if "XAU" in n.upper() or "GOLD" in n.upper()]
    return goldish[0] if goldish else None


def symbol_spec(mt5):
    """The symbol is resolved from the terminal (never hardcoded blindly) and we read the
    contract size so the lot maths matches THIS account."""
    global MT5_SYMBOL
    MT5_SYMBOL = resolve_gold_symbol(mt5) or MT5_SYMBOL
    info = mt5.symbol_info(MT5_SYMBOL)
    if info is None:
        log("symbol_not_found", symbol=MT5_SYMBOL, available=[s.name for s in mt5.symbols_get()][:40])
        return None
    if not info.visible:
        mt5.symbol_select(MT5_SYMBOL, True)
    # contract size (100 oz for XAUUSD) and the tick value (USD per point per lot)
    contract = float(getattr(info, "trade_contract_size", 100.0) or 100.0)
    tick_value = float(getattr(info, "trade_tick_value", 1.0) or 1.0)
    tick_size = float(getattr(info, "trade_tick_size", 0.01) or 0.01)
    point_value_per_lot = tick_value * (1.0 / tick_size) if tick_size else 100.0
    return {"symbol": MT5_SYMBOL, "contract": contract, "point_value": point_value_per_lot,
            "volume_min": float(getattr(info, "volume_min", 0.01) or 0.01),
            "volume_step": float(getattr(info, "volume_step", 0.01) or 0.01),
            "digits": int(getattr(info, "digits", 2) or 2)}


def send_order(mt5, plan, spec):
    import MetaTrader5 as mt5
    tick = mt5.symbol_info_tick(plan.symbol)
    if tick is None:
        log("no_tick"); return False
    price = tick.ask if plan.action == "BUY" else tick.bid
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": plan.symbol,
        "volume": plan.volume,
        "type": mt5.ORDER_TYPE_BUY if plan.action == "BUY" else mt5.ORDER_TYPE_SELL,
        "price": price,
        "sl": plan.sl,
        "tp": plan.tp,
        "deviation": 30,
        "magic": MAGIC,
        "comment": plan.comment,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,   # override with the broker's mode if it rejects
    }
    chk = mt5.order_check(req)
    log("order_check", retcode=chk.retcode if chk else None, comment=chk.comment if chk else None,
        retcode_msg=chk.retcode if chk else None)
    res = mt5.order_send(req)
    ok = res is not None and res.retcode == mt5.TRADE_RETCODE_DONE
    log("order_send", ok=ok, retcode=res.retcode if res else None,
        comment=res.comment if res else None, order=res.order if res else None,
        volume=plan.volume, price=price, sl=plan.sl, tp=plan.tp)
    return ok


def synthetic_signal(price, direction="long"):
    """A fake A signal at the live price — used by SELFTEST_SIGNAL=1 to prove the whole
    path (validation -> lot size -> plan) without the engine and without any order."""
    if direction == "long":
        entry, sl, tps = price, price - 5.0, [price + 10.0, price + 15.0, price + 20.0]
    else:
        entry, sl, tps = price, price + 5.0, [price - 10.0, price - 15.0, price - 20.0]
    risk = abs(entry - sl)
    return {"id": "selftest", "dir": direction, "grade": "A", "entry": entry, "sl": sl,
            "tps": tps, "rrs": [abs(t - entry) / risk for t in tps],
            "ts": int(time.time() * 1000), "expiresTs": int(time.time() * 1000) + 120000,
            "symbol": MT5_SYMBOL}


def main():
    log("bridge_start", engine=ENGINE_URL, dry_run=DRY_RUN, selftest=SELFTEST_SIGNAL, symbol=MT5_SYMBOL,
        server=MT5_SERVER, pid=os.getpid())
    mt5 = None
    spec = None
    while True:
        try:
            if mt5 is None:
                mt5, mod = mt5_connect()
                if mt5 is None:
                    time.sleep(10); continue
                if mod.get("mismatch"):
                    # ⛔ fail-closed: we are on a different account than configured -> no trade
                    log("blocked_wrong_account", login=mod.get("login"),
                        server=mod.get("server"), expected_login=mod.get("expected_login"),
                        expected_server=mod.get("expected_server"),
                        note="الحساب مش مطابق — trading is blocked until it is fixed")
                    try:
                        mt5.shutdown()
                    except Exception:
                        pass
                    mt5 = None
                    time.sleep(30); continue
                spec = symbol_spec(mt5)
                if spec is None:
                    log("no_symbol_spec"); time.sleep(30); continue
            # the day rollover for the local counters
            day = time.strftime("%Y-%m-%d")
            if _state["day"] != day:
                _state.update({"day": day, "trades_today": 0, "daily_r_pct": 0.0})

            positions = mt5.positions_get(symbol=MT5_SYMBOL)
            n_open = len(positions) if positions else 0
            acc = mt5.account_info()
            balance = acc.balance if acc else ACCOUNT_BALANCE
            if acc and not _state.get("logged_balance"):
                _state["logged_balance"] = True
                cur = getattr(acc, "currency", "")
                cent = cur.upper().endswith("C") and len(cur.upper()) == 3
                log("account", login=acc.login, currency=cur, balance=balance,
                    cent_account=cent,
                    note=("الرصيد والسعر بالـsnt (cents) — عشان كده الحساب 0.5% بيتحسب على "
                          "نفس العملة، واللوت بيتحسب من tick_value اللي في الـterminal") if cent else "حساب USD عادي")
                log("spec", symbol=spec["symbol"], contract_size=spec["contract"],
                    point_value_per_lot=spec["point_value"], volume_min=spec["volume_min"],
                    volume_step=spec["volume_step"])

            sig = fetch_signal()
            if balance <= 0:
                if not _state.get("zero_balance_logged"):
                    _state["zero_balance_logged"] = True
                    log("blocked_zero_balance", balance=balance,
                        note="الرصيد صفر — مفيش صفقة تقدر تتعمل (0.5% من صفر = صفر)")
                sig = None
            if sig is None and SELFTEST_SIGNAL:
                t0 = mt5.symbol_info_tick(MT5_SYMBOL)
                if t0 and time.time() - _state.get("selftest_at", 0) > 60:
                    _state["selftest_at"] = time.time()
                    sig = synthetic_signal(t0.ask if True else t0.ask)
                    log("selftest_signal", price=sig["entry"], note="محاكاة — مفيش أي أمر حقيقي")
            if sig:
                ok, why, plan = validate_signal(
                    sig, live_price=(mt5.symbol_info_tick(MT5_SYMBOL).ask
                                     if mt5.symbol_info_tick(MT5_SYMBOL) else None),
                    open_positions=list(positions or []),
                    trades_today=_state["trades_today"], daily_r_pct=_state["daily_r_pct"],
                    balance=balance, symbol=MT5_SYMBOL, risk_pct=RISK_PCT,
                    max_trades_per_day=MAX_TRADES_PER_DAY, daily_cap_pct=DAILY_CAP_PCT,
                    max_price_drift=MAX_PRICE_DRIFT, max_signal_age_s=MAX_SIGNAL_AGE_S,
                    contract_size=spec["contract"], point_value_per_lot=spec["point_value"],
                    min_vol=spec["volume_min"], vol_step=spec["volume_step"])
                log("signal", ok=ok, why=why, sig_id=sig.get("id"), grade=sig.get("grade"),
                    dir=sig.get("dir"), entry=sig.get("entry"))
                if ok and plan:
                    # ⛔ never round the size UP to the broker's minimum lot — that would
                    # blow through the 0.5% risk cap. Round DOWN to the step only, and
                    # refuse the trade when the result is below the broker's minimum.
                    step = spec["volume_step"] or 0.01
                    vol = int((plan.volume + 1e-9) / step) * step
                    if vol < spec["volume_min"] - 1e-9:
                        log("lot_below_broker_minimum", computed=plan.volume,
                            rounded=round(vol, 4), volume_min=spec["volume_min"],
                            note="الحجم المسموح smaller than the broker minimum -> NO TRADE")
                        ok, why, plan = False, "الحجم أقل من أقل لوت مسموح عند البروكر", None
                    else:
                        plan.volume = round(vol, 4)
                    if ok and plan:
                        if DRY_RUN:
                            log("dry_run_trade", plan=plan.as_dict())
                            _state["trades_today"] += 1
                        else:
                            if send_order(mt5, plan, spec):
                                _state["trades_today"] += 1
                            else:
                                log("order_failed_no_fallback")
            time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            log("bridge_stop"); break
        except Exception as e:
            log("loop_error", error=str(e))
            time.sleep(5)


if __name__ == "__main__":
    main()
