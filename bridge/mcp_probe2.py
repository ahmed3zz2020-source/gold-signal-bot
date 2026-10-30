#!/usr/bin/env python3
"""mcp_probe2.py — the deep probe: everything the bridge needs, read only.

It asks MetaTrader 5 (over MCP) for:
  1. the account (balance / currency / leverage / permissions)
  2. the gold symbol: the exact name on this account + its full specification
  3. the broker's own margin calculation for 0.01 lot
  4. the broker's own profit calculation for the stop and for the 2R target
  5. the order CHECK for the same order (no order is placed)
  6. today's trading history
  7. the M15 candles of the gold symbol

⛔ No order is ever sent. This is read only (the only write is adding the gold
   symbol to the Market Watch, which changes nothing on the account).

Run:  .venv\\Scripts\\python.exe bridge\\mcp_probe2.py
"""

import json
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mt5_conn  # noqa: E402
from mcp_client import McpClient, McpError  # noqa: E402

mt5_conn.load_dotenv()

GOLD_HINTS = ("XAU", "GOLD")


def show(title, obj, limit=2500):
    print()
    print("-" * 70)
    print("###", title)
    if isinstance(obj, (dict, list)):
        txt = json.dumps(obj, ensure_ascii=False, indent=1)
    else:
        txt = str(obj)
    print(txt[:limit] + (" ...[cut]" if len(txt) > limit else ""))


def call(client, name, args=None):
    try:
        res = client.call(name, args or {})
        text = " | ".join(c.get("text", "") for c in (res.get("content") or []))
        if not text:
            text = json.dumps(res, ensure_ascii=False)
        try:
            return json.loads(text)
        except Exception:                                        # noqa: BLE001
            return text
    except McpError as e:
        return {"__error__": str(e)}


def find_gold(symbols):
    for s in symbols:
        name = (s.get("symbol") or "").upper()
        if any(h in name for h in GOLD_HINTS):
            return s
    return None


def main():
    key = os.environ.get("MT5_MCP_KEY", "")
    candidates = []
    for u in (os.environ.get("MT5_MCP_URL", ""), "http://127.0.0.1:22346/mcp"):
        if u and u not in candidates:
            candidates.append(u)
    client = None
    for url in candidates:
        c = McpClient(url, key)
        try:
            c.initialize()
            client = c
            print("CONNECTED to", url)
            break
        except McpError as e:
            print("  ", url, "->", e)
    if client is None:
        print("NO MCP SERVER ANSWERED")
        return 1

    # 1) the account
    acc = call(client, "get_trading_account_info")
    show("get_trading_account_info", acc, 1800)

    # 2) the symbols - hidden ones included, so we find the gold one
    syms = call(client, "get_marketwatch_symbols", {"include_hidden": True, "limit": 1000})
    lst = syms.get("symbols") if isinstance(syms, dict) else None
    print()
    print("symbols returned:", len(lst) if isinstance(lst, list) else "n/a")
    names = [s.get("symbol") for s in lst] if isinstance(lst, list) else []
    gold_names = [n for n in names if n and any(h in n.upper() for h in GOLD_HINTS)]
    print("gold symbols on this account:", gold_names[:10])

    gold = find_gold(lst) if isinstance(lst, list) else None
    if gold is None and gold_names:
        # add it to the Market Watch so it is tradable and quoted
        show("add_marketwatch_symbol", call(client, "add_marketwatch_symbol",
                                             {"symbol": gold_names[0], "show": True}), 400)
        syms2 = call(client, "get_marketwatch_symbols", {"include_hidden": True, "limit": 1000})
        lst2 = syms2.get("symbols") if isinstance(syms2, dict) else None
        gold = find_gold(lst2) if isinstance(lst2, list) else None
    show("the gold symbol spec", gold, 2500)

    if not gold:
        print()
        print("NO GOLD SYMBOL FOUND. The list above has the exact names.")
        return 2

    sym = gold.get("symbol")
    bid = float(gold.get("bid") or 0)
    ask = float(gold.get("ask") or 0)
    print()
    print("GOLD:", sym, "bid", bid, "ask", ask, "spread", round(ask - bid, 4))
    print("volume_min", gold.get("volume_min"), "step", gold.get("volume_step"),
          "contract", gold.get("contract_size"), "tick_value", gold.get("tick_value"),
          "tick_size", gold.get("tick_size"), "point", gold.get("point"))

    # 3) the broker's own margin for 0.01 lot
    show("trade_order_calc_margin  0.01 lot",
         call(client, "trade_order_calc_margin",
              {"symbol": sym, "type": "buy", "volume": 0.01, "price": ask}), 900)

    # 4) the broker's own profit: the stop and the 2R target
    stop = ask - 5.0
    target = ask + 10.0
    show("trade_order_calc_profit  at the stop -5",
         call(client, "trade_order_calc_profit",
              {"symbol": sym, "type": "buy", "volume": 0.01,
               "price_open": ask, "price_close": stop}), 900)
    show("trade_order_calc_profit  at the target +10",
         call(client, "trade_order_calc_profit",
              {"symbol": sym, "type": "buy", "volume": 0.01,
               "price_open": ask, "price_close": target}), 900)

    # 5) the order CHECK - no order is placed
    show("trade_check_market_order  0.01 lot with sl and tp",
         call(client, "trade_check_market_order",
              {"symbol": sym, "type": "buy", "volume": 0.01, "sl": stop, "tp": target}), 1200)

    # 6) today's history
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")
    show("get_trading_history_positions  (since yesterday)",
         call(client, "get_trading_history_positions",
              {"datetime_from": start, "datetime_to": now.strftime("%Y-%m-%dT%H:%M:%S"),
               "symbol": sym, "limit": 50}), 1500)

    # 7) the candles
    show("get_chart_history  M15 of the gold symbol",
         call(client, "get_chart_history",
              {"datetime_from": (now - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S"),
               "datetime_to": now.strftime("%Y-%m-%dT%H:%M:%S"),
               "symbol": sym, "period": "M15", "limit": 20}), 1500)

    print()
    print("done - send me this whole text.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
