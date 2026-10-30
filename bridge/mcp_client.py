#!/usr/bin/env python3
"""mcp_client.py — a tiny client for MetaTrader 5's built-in MCP server.

Since build 6060 the terminal runs an MCP server inside it:
    http://127.0.0.1:22346/mcp   (Authorization: Bearer <the MCP API Key>)
It exposes the terminal's tools: account info, quotes, positions, and orders.
The old Python IPC (mt5.initialize) is what breaks on the new builds - this is
the supported way in.

Only the standard library - nothing to install.
"""

import json
import os
import sys
import urllib.error
import urllib.request

PROTOCOL_VERSION = "2025-06-18"


class McpError(RuntimeError):
    pass


class McpClient:
    def __init__(self, url, key="", timeout=30):
        self.url = (url or "").strip()
        self.key = (key or "").strip()
        self.timeout = timeout
        self.session_id = None
        self.server_info = None

    # ------------------------------------------------------------------ http
    def _post(self, payload):
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Accept", "application/json, text/event-stream")
        if self.key:
            req.add_header("Authorization", "Bearer " + self.key)
        if self.session_id:
            req.add_header("Mcp-Session-Id", self.session_id)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                sid = r.headers.get("Mcp-Session-Id") or r.headers.get("mcp-session-id")
                if sid:
                    self.session_id = sid
                return self._parse(r.read().decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            raise McpError("HTTP %s from the MCP server: %s" % (e.code, detail))
        except Exception as e:                                    # noqa: BLE001
            raise McpError("cannot reach %s: %s" % (self.url, e))

    @staticmethod
    def _parse(text):
        text = (text or "").strip()
        if not text:
            return {}
        if text.startswith("{"):
            return json.loads(text)
        # server-sent events: the payload sits in the data: lines
        found = None
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("data:"):
                chunk = line[5:].strip()
                if chunk and chunk != "[DONE]":
                    try:
                        found = json.loads(chunk)
                    except Exception:                            # noqa: BLE001
                        pass
        if found is None:
            try:
                found = json.loads(text)
            except Exception:                                    # noqa: BLE001
                found = {"raw": text[:400]}
        return found

    # ------------------------------------------------------------- protocol
    def initialize(self):
        res = self._post({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {"name": "gold-signal-bot", "version": "1.0"},
            },
        })
        self.server_info = (res.get("result") or {}).get("serverInfo")
        # the notification has no id and usually answers 202 with an empty body
        try:
            self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        except Exception:                                        # noqa: BLE001
            pass
        return res

    def list_tools(self):
        res = self._post({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        if "error" in res:
            raise McpError("tools/list failed: %s" % res["error"])
        return (res.get("result") or {}).get("tools") or []

    def call(self, name, args=None):
        res = self._post({
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": name, "arguments": args or {}},
        })
        if "error" in res:
            raise McpError("%s failed: %s" % (name, res["error"]))
        result = res.get("result") or {}
        if result.get("isError"):
            text = " | ".join(c.get("text", "") for c in result.get("content") or [])
            raise McpError("%s returned an error: %s" % (name, text[:300]))
        return result


def from_env(env=None):
    """Build a client from the .env (MT5_MCP_URL / MT5_MCP_KEY)."""
    env = env if env is not None else os.environ
    url = env.get("MT5_MCP_URL", "") or "http://127.0.0.1:22346/mcp"
    key = env.get("MT5_MCP_KEY", "")
    return McpClient(url, key)


if __name__ == "__main__":
    c = from_env()
    print("url:", c.url, "| key:", "yes" if c.key else "NO")
    try:
        print(json.dumps(c.initialize(), indent=1)[:600])
        print("tools:", len(c.list_tools()))
    except McpError as e:
        print("MCP ERROR:", e)
        sys.exit(1)
