#!/usr/bin/env python3
"""test_api.py — WHY can't the Python API reach MetaTrader 5?

It tries every way of connecting, one by one, and prints exactly what each one says:
    A) attach to whatever terminal is running       (no path)
    B) attach to the terminal at MT5_PATH           (with the path)
    C) log in from scratch                          (login + password + server)

Then it prints the terminal's own state so we can see what is really going on.

Run:  .venv\\Scripts\\python.exe bridge\\test_api.py
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mt5_conn  # noqa: E402

mt5_conn.load_dotenv()

PATH = os.environ.get("MT5_PATH", r"C:\Program Files\MetaTrader 5\terminal64.exe")
LOGIN = os.environ.get("MT5_LOGIN", "")
PASSWORD = os.environ.get("MT5_PASSWORD", "")
SERVER = os.environ.get("MT5_SERVER", "")


def try_one(tag, **kw):
    print(f"--- {tag}")
    try:
        ok = mt5.initialize(timeout=60_000, **kw)
    except Exception as e:                       # noqa: BLE001
        print(f"   raised: {e}")
        return False
    print(f"   initialize -> {bool(ok)}   last_error={mt5.last_error()}")
    acc = mt5.account_info()
    if acc:
        print(f"   -> CONNECTED: login={acc.login} server={acc.server} "
              f"balance={acc.balance} {acc.currency} trade_allowed={acc.trade_allowed}")
        return True
    print("   -> no account info")
    try:
        mt5.shutdown()
    except Exception:                            # noqa: BLE001
        pass
    return False


def main():
    try:
        import MetaTrader5 as mt5
    except ImportError:
        print("the MetaTrader5 package is not installed - run DO-IT-ALL.bat")
        return 1

    print("=" * 70)
    print("MT5 API diagnostic")
    print("=" * 70)
    print(f"MT5_PATH      : {PATH}   (exists: {os.path.exists(PATH)})")
    print(f"MT5_LOGIN     : {LOGIN}")
    print(f"MT5_SERVER    : {SERVER}")
    print(f"password      : {'yes (' + str(len(PASSWORD)) + ' chars)' if PASSWORD else 'NO'}")
    print(f"mt5 version   : {mt5.version()}")
    print(f"last_error    : {mt5.last_error()}")
    print()

    # A) attach to whatever is running
    if try_one("A) attach to the running terminal"):
        return 0

    # B) attach with the path
    if os.path.exists(PATH) and try_one("B) attach with MT5_PATH", path=PATH):
        return 0

    # C) a fresh login
    if LOGIN and PASSWORD and SERVER and try_one("C) fresh login", login=int(LOGIN),
                                                  password=PASSWORD, server=SERVER):
        return 0

    print()
    print("=" * 70)
    print("NONE of the three worked. The usual reasons:")
    print("  1) MetaTrader 5 is NOT running right now")
    print("     -> open it, log in, and run this again")
    print("  2) 'Allow algorithmic trading' is OFF")
    print("     -> Tools > Options > Expert Advisors > tick it")
    print("  3) MetaTrader 5 runs as Administrator and this script does not")
    print("     -> right-click this .bat > Run as administrator (or the other way round)")
    print("  4) a firewall/antivirus is blocking the local port")
    print("     -> allow terminal64.exe and python.exe on the private network")
    print("=" * 70)
    return 2


if __name__ == "__main__":
    sys.exit(main())
