#!/usr/bin/env python3
"""mcp_probe.py — talk to MetaTrader 5's built-in MCP server and show what it can do.

It prints:
  1. the server handshake (name + version)
  2. every tool the terminal exposes
  3. the full input schema of the trading / account / price tools
  4. a live account read (if the account tool is available)

Nothing is written and no order is sent. It is the reconnaissance step before
the bridge starts talking to the terminal over MCP.

Run:  .venv\\Scripts\\python.exe bridge\\mcp_probe.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mt5_conn  # noqa: E402
from mcp_client import McpClient, McpError  # noqa: E402

mt5_conn.load_dotenv()

INTEREST = ("trade", "order", "position", "account", "symbol", "market", "tick",
            "quote", "history", "deal", "price", "chart")


def main():
    url = os.environ.get("MT5_MCP_URL", "") or "http://127.0.0.1:22346/mcp"
    key = os.environ.get("MT5_MCP_KEY", "")
    print("=" * 72)
    print("MT5 MCP probe")
    print("=" * 72)
    print("url  :", url)
    print("key  :", ("yes (%d chars)" % len(key)) if key else "NO  <-- put it in the .env")
    print()

    client = McpClient(url, key)
    try:
        client.initialize()
    except McpError as e:
        print("HANDSHAKE FAILED:", e)
        print()
        print("If it says 401 -> the API key is wrong or empty.")
        print("If it says connection refused -> MetaTrader 5 is not running,")
        print("or 'Enable internal server' is off in Tools > Options > MCP.")
        return 1

    print("server:", json.dumps(client.server_info, ensure_ascii=False))
    print("session:", client.session_id)
    print()

    tools = client.list_tools()
    print("TOOLS (%d):" % len(tools))
    for t in tools:
        print("  -", t.get("name"))
    print()

    print("=" * 72)
    print("the schemas of the tools the bot needs")
    print("=" * 72)
    for t in tools:
        name = (t.get("name") or "").lower()
        if any(k in name for k in INTEREST):
            print()
            print("###", t.get("name"))
            desc = (t.get("description") or "").strip().replace("\n", " ")
            print("   what:", desc[:300])
            schema = t.get("inputSchema") or t.get("input_schema") or {}
            print("   args:", json.dumps(schema, ensure_ascii=False)[:900])

    print()
    print("=" * 72)
    print("live reads (read only)")
    print("=" * 72)
    for name in ("get_trading_account_info", "get_marketwatch_symbols",
                 "get_trading_open_positions"):
        try:
            res = client.call(name, {})
            text = " | ".join(c.get("text", "") for c in (res.get("content") or []))
            print()
            print("###", name)
            print(text[:1200] if text else json.dumps(res, ensure_ascii=False)[:1200])
        except McpError as e:
            print()
            print("###", name, "->", e)
    print()
    print("done - send me this whole text.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
