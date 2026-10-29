#!/usr/bin/env python3
"""test_connection.py — a read-only check of the MT5 side. It places NO orders.

It prints: the terminal version, the account (login/currency/balance/type/leverage),
the gold symbol it found, its full specification (contract size, tick value, volume
min/step, spread), and a live tick. Run it BEFORE the bridge:

    .venv\\Scripts\\python.exe bridge\\test_connection.py

Env (optional): MT5_LOGIN / MT5_PASSWORD / MT5_SERVER / MT5_PATH
If they are not set, it connects to whatever account the terminal is already logged into.
"""

import os
import sys

try:
    import MetaTrader5 as mt5
except ImportError:
    print("MetaTrader5 package is not installed.")
    print("  py -m venv .venv")
    print("  .venv\\Scripts\\python.exe -m pip install --upgrade pip MetaTrader5")
    sys.exit(1)

LOGIN = os.environ.get("MT5_LOGIN", "")
PASSWORD = os.environ.get("MT5_PASSWORD", "")
SERVER = os.environ.get("MT5_SERVER", "")
MT5_PATH = os.environ.get("MT5_PATH", r"C:\Program Files\MetaTrader 5\terminal64.exe")

GOLD = ["XAUUSD", "XAUUSDm", "XAUUSDc", "XAUUSDmicro", "GOLD", "GOLDm", "XAUUSD.f"]

def find_terminals():
    """Look for terminal64.exe in the usual places (so MT5_PATH can be set)."""
    roots = [
        os.path.expandvars(r"%ProgramFiles%"),
        os.path.expandvars(r"%ProgramFiles(x86)%"),
        os.path.expandvars(r"%LOCALAPPDATA%\Programs"),
        os.path.expandvars(r"%APPDATA%"),
    ]
    hits = []
    for root in roots:
        if not root or not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            if "terminal64.exe" in filenames:
                hits.append(os.path.join(dirpath, "terminal64.exe"))
            if len(hits) > 12:
                break
    return hits


print("=" * 68)
print("1) the terminal")
candidates = ([MT5_PATH] if MT5_PATH else []) + find_terminals()
ok = False
tried = []
for path in candidates:
    if not path or not os.path.exists(path):
        continue
    tried.append(path)
    try:
        if LOGIN and PASSWORD and SERVER:
            ok = mt5.initialize(path=path, login=int(LOGIN), password=PASSWORD,
                                server=SERVER, timeout=60_000)
        else:
            ok = mt5.initialize(path=path, timeout=60_000)
    except Exception as e:
        print("   error while trying", path, ":", e)
        ok = False
    if ok:
        print("   connected via:", path)
        break
if not ok:
    # last resort: whatever terminal the package can find
    try:
        ok = mt5.initialize(timeout=60_000)
    except Exception as e:
        print("   fallback error:", e)
if not ok:
    print("   FAILED to connect:", mt5.last_error())
    print("   tried:", tried or "(no terminal64.exe found)")
    print("   - is the MT5 terminal OPEN right now and logged in?")
    print("   - if you opened MT5 as Administrator, run this cmd as Administrator too")
    print("     (right-click the cmd icon > Run as administrator) - they must match.")
    print("   - is 'Allow algorithmic trading' ticked in Tools > Options > Expert Advisors?")
    sys.exit(2)
print("   terminal version:", mt5.version())
print("   terminal path   :", mt5.terminal_info().path if mt5.terminal_info() else "?")

print("=" * 68)
print("2) the account")
acc = mt5.account_info()
if acc is None:
    print("   NO ACCOUNT — the terminal is not logged in. File > Login to Trade Account.")
    sys.exit(3)
cur = getattr(acc, "currency", "")
print(f"   login            : {acc.login}")
print(f"   name             : {acc.name}")
print(f"   server           : {acc.server}")
print(f"   currency         : {cur}{'   (CENT ACCOUNT)' if cur.upper().endswith('C') else ''}")
print(f"   balance          : {acc.balance}")
print(f"   equity           : {acc.equity}")
print(f"   margin mode      : {'HEDGING' if acc.margin_mode == mt5.MARGIN_MODE_RETAIL_HEDGING else 'NETTING'}")
print(f"   leverage         : {acc.leverage}")
print(f"   trade allowed    : {acc.trade_allowed}   (False => algo trading is OFF)")

print("=" * 68)
print("3) the gold symbol")
names = [s.name for s in (mt5.symbols_get() or [])]
sym = None
for g in GOLD:
    if g in names:
        sym = g
        break
if sym is None:
    goldish = [n for n in names if "XAU" in n.upper() or "GOLD" in n.upper()]
    if goldish:
        sym = goldish[0]
if sym is None:
    print("   NO GOLD SYMBOL in this account. The available symbols:")
    print("  ", ", ".join(names[:60]))
    sys.exit(4)
print("   symbol       :", sym)
info = mt5.symbol_info(sym)
if not info.visible:
    mt5.symbol_select(sym, True)
    info = mt5.symbol_info(sym)
print(f"   digits       : {info.digits}   point = {info.point}")
print(f"   contract size: {info.trade_contract_size}   (100 = 1 lot = 100 oz of gold)")
print(f"   tick size    : {info.trade_tick_size}")
print(f"   tick value   : {info.trade_tick_value} {cur} per tick per 1.0 lot")
print(f"   volume min   : {info.volume_min}   step: {info.volume_step}   max: {info.volume_max}")
print(f"   spread       : {info.spread} points")
print(f"   swap long/short: {info.swap_long} / {info.swap_short}")

print("=" * 68)
print("4) a live tick")
tick = mt5.symbol_info_tick(sym)
if tick is None:
    print("   NO TICK — the account has no market data for this symbol yet.")
    print("   (a brand-new account often needs a deposit before the quotes flow)")
else:
    print(f"   bid = {tick.bid}   ask = {tick.ask}   time = {tick.time}")

print("=" * 68)
print("5) the risk maths for THIS account (0.5% per trade)")
if acc.balance > 0 and tick is not None:
    point_value = info.trade_tick_value / info.trade_tick_size if info.trade_tick_size else 100
    for stop in (3, 5, 8, 12):
        risk_money = acc.balance * 0.005
        per_lot = stop * point_value
        vol = risk_money / per_lot if per_lot else 0
        print(f"   stop {stop:>2} points -> risk {risk_money:.2f} {cur} -> "
              f"{vol:.3f} lots (min {info.volume_min})")
print("=" * 68)
print("done — no order was placed.")
mt5.shutdown()
