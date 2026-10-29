#!/usr/bin/env python3
"""risk_table.py — what a trade on THIS account really costs you.

It prints, for your real balance and your real lot size, the money and the % of the
account that a stop-out costs you at every stop distance, plus the margin that one
position uses at your leverage.

Run it AFTER the .env is filled in:
    .venv\\Scripts\\python.exe bridge\\risk_table.py

Everything is in the ACCOUNT currency (USC on a cent account) — the same numbers the
bridge uses before it sends anything.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mt5_conn  # noqa: E402

mt5_conn.load_dotenv()

BALANCE = float(os.environ.get("ACCOUNT_BALANCE", "0") or 0)
LOT = float(os.environ.get("FIXED_VOLUME", "0.01") or 0.01)
LEVERAGE = float(os.environ.get("LEVERAGE", "2000") or 2000)
CONTRACT = float(os.environ.get("CONTRACT_SIZE", "100") or 100)
SPREAD = float(os.environ.get("SPREAD_POINTS", "0.3") or 0.3)
PRICE = float(os.environ.get("SYMBOL_PRICE", "4018.7") or 4018.7)
# the account-currency value of one 1.0 price move for one lot:
#   a normal USD account: 100   (100 oz x $1)
#   a cent account:      10000 (the same, in cents)
CENT = os.environ.get("CENT_ACCOUNT", "1") not in ("0", "false", "False")
POINT_VALUE_PER_LOT = (CONTRACT * 100.0) if CENT else CONTRACT


def main():
    if BALANCE <= 0:
        print("ACCOUNT_BALANCE is empty — put your real balance in the .env")
        print("  (BALANCE=3353 for this account)")
        return
    print(f"balance = {BALANCE:,.0f} (account currency)   lot = {LOT}   leverage = 1:{LEVERAGE:g}")
    print(f"one position = {LOT * CONTRACT:g} oz of gold   notional = {PRICE * LOT:,.2f}")
    margin = PRICE * LOT * POINT_VALUE_PER_LOT / LEVERAGE
    print(f"margin for one position = {margin:,.2f} = {margin / BALANCE * 100:.1f}% of the balance")
    print()
    print(f"{'stop':>6} {'loss':>12} {'% of balance':>13} {'target 2R':>10} {'win':>12} {'margin%':>9}")
    for stop in (1, 2, 3, 4, 5, 6, 8, 10, 15, 20):
        eff = stop + SPREAD
        loss = eff * POINT_VALUE_PER_LOT * LOT
        win = (stop * 2 + SPREAD) * POINT_VALUE_PER_LOT * LOT
        print(f"{stop:>6} {loss:>12,.2f} {loss / BALANCE * 100:>12.1f}% "
              f"{stop * 2:>10} {win:>12,.2f} {margin / BALANCE * 100:>8.1f}%")
    print()
    print(f"the spread costs you {SPREAD * POINT_VALUE_PER_LOT * LOT:,.2f} on every trade")
    print(f"a stop-out of {BALANCE * 0.0 + 3 * 4 * POINT_VALUE_PER_LOT * LOT:,.0f} "
          f"({3 * 4 * POINT_VALUE_PER_LOT * LOT / BALANCE * 100:.0f}%) = 3 losing trades")


if __name__ == "__main__":
    main()
