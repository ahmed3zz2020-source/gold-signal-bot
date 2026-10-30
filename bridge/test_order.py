#!/usr/bin/env python3
"""test_order.py — ONE real order, to prove the broker accepts our orders.

This is the end-to-end proof of the whole chain on the REAL account:
  connect to MT5 -> read the account + the gold symbol -> send a real order
  (0.01 lot) with a stop and a target attached -> wait -> close it -> print what happened.

⛔ It sends a REAL order. It costs you the spread twice (about 60 USC = $0.06 on this
   account) and, if gold moves against you, up to the stop (2 points = 200 USC = $2).
   It uses its own magic number, so it does NOT count towards the daily trade counters.

Run:  .venv\\Scripts\\python.exe bridge\\test_order.py
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mt5_conn  # noqa: E402

mt5_conn.load_dotenv()

TEST_MAGIC = 20261030          # its own magic => the daily counters stay clean
LOT = float(os.environ.get("FIXED_VOLUME", "0.01") or 0.01)
STOP_POINTS = float(os.environ.get("TEST_STOP_POINTS", "2") or 2)
TARGET_POINTS = float(os.environ.get("TEST_TARGET_POINTS", "4") or 4)
HOLD_SECONDS = int(os.environ.get("TEST_HOLD_SECONDS", "10") or 10)
GOLD = ["XAUUSD", "XAUUSDm", "XAUUSDc", "XAUUSDmicro", "GOLD", "GOLDm", "XAUUSD.f"]


def log(*a):
    print(*a, flush=True)


def pick_symbol(mt5):
    names = [s.name for s in (mt5.symbols_get() or [])]
    for g in GOLD:
        if g in names:
            return g
    goldish = [n for n in names if "XAU" in n.upper() or "GOLD" in n.upper()]
    return goldish[0] if goldish else None


def main():
    try:
        import MetaTrader5 as mt5
    except ImportError:
        log("MetaTrader5 is not installed - run DO-IT-ALL.bat first.")
        return 1

    mt5, conn = mt5_conn.connect(verbose=True)
    if not conn.get("connected"):
        log("NO CONNECTION:", conn.get("problems"))
        return 2
    if conn.get("mismatch"):
        log("WRONG ACCOUNT - stop:", conn.get("problems"))
        return 2

    acc = mt5.account_info()
    symbol = pick_symbol(mt5)
    log("")
    log("=" * 66)
    log(f"account : {acc.login}  balance {acc.balance} {acc.currency}  leverage {acc.leverage}")
    log(f"symbol  : {symbol}")
    if not symbol:
        log("NO GOLD SYMBOL FOUND")
        return 3
    info = mt5.symbol_info(symbol)
    if not info.visible:
        mt5.symbol_select(symbol, True)
        info = mt5.symbol_info(symbol)
    log(f"contract: {info.trade_contract_size}   tick_value: {info.trade_tick_value} "
        f"tick_size: {info.trade_tick_size}   vol_min: {info.volume_min} step: {info.volume_step}")
    tick = mt5.symbol_info_tick(symbol)
    if not tick:
        log("NO TICK - the account has no quotes for this symbol")
        return 4
    log(f"bid {tick.bid}   ask {tick.ask}   spread {tick.ask - tick.bid:.2f}")
    log(f"trade_allowed: {acc.trade_allowed}   balance {acc.balance}")
    log("=" * 66)

    if acc.balance <= 0:
        log("BALANCE IS ZERO - no order can be sized. Stop.")
        return 5

    entry = float(tick.ask)
    sl = entry - STOP_POINTS
    tp = entry + TARGET_POINTS
    req = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": LOT,
        "type": mt5.ORDER_TYPE_BUY,
        "price": entry,
        "sl": sl,
        "tp": tp,
        "deviation": 30,
        "magic": TEST_MAGIC,
        "comment": "goldbot-test",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }
    chk = mt5.order_check(req)
    log(f"order_check -> retcode {chk.retcode if chk else None}  {chk.comment if chk else ''}")
    res = mt5.order_send(req)
    if res is None or res.retcode != mt5.TRADE_RETCODE_DONE:
        log(f"ORDER REJECTED -> {res.retcode if res else None}  {res.comment if res else ''}")
        log("If the retcode is about 'invalid filling', set ORDER_FILLING=RETURN in the .env")
        return 6
    log(f"ORDER SENT -> ticket {res.order}  price {res.price}  volume {LOT}  sl {sl}  tp {tp}")

    log(f"holding {HOLD_SECONDS}s ...")
    time.sleep(HOLD_SECONDS)

    pos = mt5.positions_get(symbol=symbol)
    pos = [p for p in (pos or []) if p.magic == TEST_MAGIC]
    if not pos:
        log("no open position (it may have been closed by the stop/target already)")
    else:
        p = pos[0]
        t2 = mt5.symbol_info_tick(symbol)
        close_price = float(t2.bid)
        creq = {
            "action": mt5.TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": float(p.volume),
            "type": mt5.ORDER_TYPE_SELL,
            "position": p.ticket,
            "price": close_price,
            "deviation": 30,
            "magic": TEST_MAGIC,
            "comment": "goldbot-test-close",
            "type_time": mt5.ORDER_TIME_GTC,
            "type_filling": mt5.ORDER_FILLING_IOC,
        }
        cres = mt5.order_send(creq)
        log(f"close -> retcode {cres.retcode if cres else None}  "
            f"price {cres.price if cres else None}  "
            f"{cres.comment if cres else ''}")
        log(f"entry {res.price} -> exit {cres.price if cres else '?'}  "
            f"P/L {((cres.price - res.price) * 100 * LOT) if cres else '?'} USC "
            f"(the spread is paid twice)")

    mt5.shutdown()
    log("")
    log("TEST DONE - send me the text above.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
