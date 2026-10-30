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
    env_url = os.environ.get("MT5_MCP_URL", "")
    key = os.environ.get("MT5_MCP_KEY", "")
    # the terminal's MCP server is on 22346 and MetaEditor's is on 22345 - the Copy
    # button in the terminal's MCP tab can put either one on the clipboard, so we
    # simply try them all and use the one that answers.
    candidates = []
    for u in (env_url, "http://127.0.0.1:22346/mcp", "http://127.0.0.1:22345/mcp"):
        if u and u not in candidates:
            candidates.append(u)

    print("=" * 72)
    print("MT5 MCP probe")
    print("=" * 72)
    print("key  :", ("yes (%d chars)" % len(key)) if key else "NO  <-- put it in the .env")
    print("urls :", " , ".join(candidates))
    print()

    client = None
    last_error = ""
    for url in candidates:
        c = McpClient(url, key)
        try:
            c.initialize()
            client = c
            print("CONNECTED to", url)
            break
        except McpError as e:
            last_error = str(e)
            print("  ", url, "->", e)
    if client is None:
        print()
        print("NO MCP SERVER ANSWERED:", last_error)
        print()
        print("Check these:")
        print("  1) MetaTrader 5 must be RUNNING")
        print("  2) Tools > Options > MCP > 'Enable internal server' must be ticked")
        print("  3) the API Key in the .env must be the terminal's one")
        print("     (Tools > Options > MCP -> next to API Key press Generate, then copy it)")
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
