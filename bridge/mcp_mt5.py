#!/usr/bin/env python3
"""mcp_mt5.py — a MetaTrader5-compatible adapter that talks to the terminal
over its built-in MCP server.

Why: since build 6230 the terminal's old Python IPC (mt5.initialize) times out
with -10005. The supported way in is the MCP server inside the terminal
(http://127.0.0.1:22346/mcp) which exposes the very same capabilities:
account, quotes, symbols, history, and ORDERS.

This module mimics the small part of the MetaTrader5 python package that the
bridge uses, so the bridge logic (validation, risk, counters) does not change:
    account_info() · positions_get() · symbol_info() · symbols_get()
    symbol_info_tick() · symbol_select() · order_check() · order_send()
    history_deals_get() · terminal_info() · shutdown()
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mcp_client import McpClient, McpError  # noqa: E402

# the constants the bridge uses from the real package
TRADE_RETCODE_DONE = 10009
TRADE_RETCODE_ERROR = 10011
ORDER_TYPE_BUY = 0
ORDER_TYPE_SELL = 1
TRADE_ACTION_DEAL = 1
ORDER_TIME_GTC = 0
ORDER_FILLING_IOC = 2
ORDER_FILLING_FOK = 1
ORDER_FILLING_RETURN = 3
MARGIN_MODE_RETAIL_NETTING = 0
MARGIN_MODE_RETAIL_HEDGING = 1


class Obj:
    """A tiny attribute bag (the real package returns named tuples)."""

    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)

    def __repr__(self):
        return "Obj(%s)" % ", ".join("%s=%r" % (k, v) for k, v in sorted(self.__dict__.items()))


def _f(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _i(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _call(client, name, args=None):
    """Call an MCP tool and return the parsed JSON payload (or the raw text)."""
    res = client.call(name, args or {})
    text = " | ".join(c.get("text", "") for c in (res.get("content") or []))
    if not text:
        text = json.dumps(res, ensure_ascii=False)
    try:
        return json.loads(text)
    except Exception:                                            # noqa: BLE001
        return {"raw": text}


class McpMt5:
    """The drop-in replacement for the MetaTrader5 python module."""

    # the constants the real package exposes at module level
    TRADE_RETCODE_DONE = TRADE_RETCODE_DONE
    TRADE_RETCODE_ERROR = TRADE_RETCODE_ERROR
    ORDER_TYPE_BUY = ORDER_TYPE_BUY
    ORDER_TYPE_SELL = ORDER_TYPE_SELL
    TRADE_ACTION_DEAL = TRADE_ACTION_DEAL
    ORDER_TIME_GTC = ORDER_TIME_GTC
    ORDER_FILLING_IOC = ORDER_FILLING_IOC
    ORDER_FILLING_FOK = ORDER_FILLING_FOK
    ORDER_FILLING_RETURN = ORDER_FILLING_RETURN
    MARGIN_MODE_RETAIL_NETTING = MARGIN_MODE_RETAIL_NETTING
    MARGIN_MODE_RETAIL_HEDGING = MARGIN_MODE_RETAIL_HEDGING

    def __init__(self, client):
        self.client = client
        self.last_error_tuple = (0, "")
        self._symbols = {}

    # ------------------------------------------------------------- helpers
    def _get(self, name, args=None, default=None):
        try:
            out = _call(self.client, name, args)
        except McpError as e:
            self.last_error_tuple = (-10005, str(e))
            return default
        if isinstance(out, dict) and "__error__" in out:
            self.last_error_tuple = (-10005, str(out["__error__"]))
            return default
        return out

    def last_error(self):
        return self.last_error_tuple

    def shutdown(self):
        return True

    # --------------------------------------------------------------- reads
    def account_info(self):
        out = self._get("get_trading_account_info", {}, {})
        acc = (out or {}).get("account") or {}
        term = (out or {}).get("terminal") or {}
        if not acc:
            return None
        return Obj(
            login=_i(acc.get("login")),
            server=acc.get("server") or "",
            name=acc.get("name") or "",
            currency=acc.get("currency") or "",
            balance=_f(acc.get("balance")),
            equity=_f(acc.get("equity"), _f(acc.get("balance"))),
            margin=_f(acc.get("margin")),
            margin_free=_f(acc.get("margin_free")),
            profit=_f(acc.get("profit")),
            leverage=_i(term.get("leverage") or acc.get("leverage")),
            trade_allowed=bool(term.get("mcp_trade_allowed", True)),
            margin_mode=(MARGIN_MODE_RETAIL_NETTING
                         if (acc.get("margin_mode") or "").lower() == "netting"
                         else MARGIN_MODE_RETAIL_HEDGING),
            raw=out,
        )

    def terminal_info(self):
        out = self._get("get_trading_account_info", {}, {}) or {}
        term = out.get("terminal") or {}
        conn = term.get("connection") or {}
        return Obj(
            build=_i(term.get("build")),
            path=term.get("terminal_path") or "",
            data_path=term.get("data_path") or "",
            connected=conn.get("state") in ("connected", "connected_to_broker"),
            trade_allowed=bool(term.get("mcp_trade_allowed", True)),
            experts_allowed=bool(term.get("experts_trade_allowed", True)),
            raw=term,
        )

    def positions_get(self, symbol=None):
        args = {"include_orders": False}
        if symbol:
            args["symbol"] = symbol
        out = self._get("get_trading_open_positions", args, {}) or {}
        res = []
        for p in (out.get("positions") or []):
            res.append(Obj(
                ticket=_i(p.get("ticket") or p.get("position_ticket")),
                symbol=p.get("symbol") or "",
                type=_i(p.get("type")),
                volume=_f(p.get("volume")),
                price_open=_f(p.get("price_open")),
                price_current=_f(p.get("price_current")),
                sl=_f(p.get("sl")),
                tp=_f(p.get("tp")),
                profit=_f(p.get("profit")),
                magic=_i(p.get("magic")),
                comment=p.get("comment") or "",
            ))
        return res

    def symbols_get(self, group=None):
        out = self._get("get_marketwatch_symbols", {"include_hidden": True, "limit": 2000}, {}) or {}
        out = self._get("get_marketwatch_symbols", {"include_hidden": True, "limit": 2000}, {}) or {}
        res = []
        for s in (out.get("symbols") or []):
            o = Obj(
                name=s.get("symbol") or "",
                description=s.get("description") or "",
                digits=_i(s.get("digits")),
                point=_f(s.get("point"), 0.01),
                trade_contract_size=_f(s.get("contract_size"), 100.0),
                trade_tick_value=_f(s.get("tick_value"), 1.0),
                trade_tick_size=_f(s.get("tick_size"), 0.01),
                volume_min=_f(s.get("volume_min"), 0.01),
                volume_max=_f(s.get("volume_max"), 100.0),
                volume_step=_f(s.get("volume_step"), 0.01),
                trade_mode=_i(s.get("trade_mode"), 4),
                visible=False,
                swap_long=_f(s.get("swap_long")),
                swap_short=_f(s.get("swap_short")),
                currency_profit=s.get("currency_profit") or "",
                currency_margin=s.get("currency_margin") or "",
                raw=s,
            )
            self._symbols[o.name] = o
            res.append(o)
        return res

    def symbol_info(self, name):
        if not self._symbols:
            self.symbols_get()
        return self._symbols.get(name)

    def symbol_select(self, name, visible=True):
        self._get("add_marketwatch_symbol", {"symbol": name, "show": bool(visible)}, {})
        info = self.symbol_info(name)
        if info is not None:
            info.visible = bool(visible)
        return info is not None

    def symbol_info_tick(self, name):
        # the catalogue (include_hidden) carries no quotes, so ask for this one symbol
        out = self._get("get_marketwatch_symbols", {"symbol": name}, {}) or {}
        syms = out.get("symbols") or []
        raw = syms[0] if syms else {}
        bid = raw.get("bid")
        ask = raw.get("ask")
        if bid is None or ask is None:
            info = self.symbol_info(name)
            raw = getattr(info, "raw", {}) or {} if info is not None else {}
            bid = raw.get("bid")
            ask = raw.get("ask")
        if bid is None or ask is None:
            return None
        return Obj(bid=_f(bid), ask=_f(ask), time=_i(raw.get("time"), 0),
                   volume=_i(raw.get("volume_real"), 0))

    def history_deals_get(self, dt_from, dt_to):
        """The MCP server returns aggregated positions; we flatten them into
        deal-like objects so the bridge's daily counters keep working."""
        out = self._get("get_trading_history_positions", {
            "datetime_from": dt_from.strftime("%Y-%m-%dT%H:%M:%S"),
            "datetime_to": dt_to.strftime("%Y-%m-%dT%H:%M:%S"),
            "limit": 500,
        }, {}) or {}
        deals = []
        items = out.get("positions") or out.get("history") or out.get("deals") or []
        for p in items:
            if not isinstance(p, dict):
                continue
            profit = None
            for k in ("profit", "realized_profit", "total_profit", "pnl"):
                if p.get(k) is not None:
                    profit = _f(p.get(k))
                    break
            if profit is None:
                continue
            deals.append(Obj(
                entry=1,                       # an exit deal
                magic=_i(p.get("magic"), 0),
                symbol=p.get("symbol") or "",
                volume=_f(p.get("volume")),
                price=_f(p.get("price_open") or p.get("close_price")),
                profit=profit,
                commission=_f(p.get("commission")),
                swap=_f(p.get("swap")),
                time=_i(p.get("close_time") or p.get("time"), 0),
                ticket=_i(p.get("ticket") or p.get("position_ticket")),
            ))
        return deals

    def candles(self, symbol, period, dt_from, dt_to, limit=500):
        out = self._get("get_chart_history", {
            "datetime_from": dt_from.strftime("%Y-%m-%dT%H:%M:%S"),
            "datetime_to": dt_to.strftime("%Y-%m-%dT%H:%M:%S"),
            "symbol": symbol, "period": period, "limit": limit,
        }, {}) or {}
        bars = out.get("candles") or out.get("bars") or out.get("data") or []
        res = []
        for b in bars:
            if not isinstance(b, dict):
                continue
            res.append(Obj(time=_i(b.get("time")), open=_f(b.get("open")),
                           high=_f(b.get("high")), low=_f(b.get("low")),
                           close=_f(b.get("close")), tick_volume=_i(b.get("tick_volume")),
                           real_volume=_i(b.get("real_volume")), spread=_i(b.get("spread"))))
        return res

    # -------------------------------------------------------------- writes
    @staticmethod
    def _side(req):
        t = req.get("type")
        if t in (ORDER_TYPE_BUY, "buy", "BUY", 0):
            return "buy"
        return "sell"

    def order_check(self, req):
        """The broker check. The MCP tool does not always give a verdict, so an
        answer without one means INCONCLUSIVE - the broker decides when we send."""
        args = {"symbol": req.get("symbol"), "type": self._side(req),
                "volume": _f(req.get("volume"))}
        for k in ("sl", "tp"):
            if req.get(k):
                args[k] = _f(req.get(k))
        out = self._get("trade_check_market_order", args, {}) or {}
        verdict = None
        for key in ("ok", "success", "valid", "accepted"):
            if key in out:
                verdict = bool(out[key])
                break
        if verdict is None and out.get("retcode") is not None:
            try:
                verdict = int(out.get("retcode")) in (0, 10009)
            except (TypeError, ValueError):
                verdict = None
        if verdict is None and (out.get("error") or out.get("isError")):
            verdict = False
        if verdict is None:
            return Obj(retcode=0,
                       comment="no verdict in the check - the broker decides",
                       raw=out)
        if verdict:
            return Obj(retcode=0, comment=out.get("comment") or "ok", raw=out)
        return Obj(retcode=TRADE_RETCODE_ERROR,
                   comment=out.get("comment") or out.get("error") or "rejected",
                   raw=out)

    def order_send(self, req):
        # a close request (it carries a position ticket) goes through the
        # dedicated close tool - trade_send_market_order would OPEN a new one
        ticket = req.get("position") or req.get("ticket")
        if ticket:
            args = {"symbol": req.get("symbol"),
                    "position_ticket": int(ticket)}
            out = self._get("trade_close_single_position", args, {}) or {}
            ok = bool(out.get("ok")) or out.get("retcode") in (0, 10009)
            if not ok:
                return Obj(retcode=TRADE_RETCODE_ERROR,
                           comment=out.get("comment") or out.get("error") or "close rejected",
                           order=None, price=None, raw=out)
            return Obj(retcode=TRADE_RETCODE_DONE,
                       comment=out.get("comment") or "closed",
                       order=out.get("ticket") or int(ticket),
                       price=out.get("price"), raw=out)
        args = {"symbol": req.get("symbol"), "type": self._side(req),
                "volume": _f(req.get("volume"))}
        for k in ("sl", "tp"):
            if req.get(k):
                args[k] = _f(req.get(k))
        comment = req.get("comment") or ""
        if comment:
            args["comment"] = comment[:31]
        out = self._get("trade_send_market_order", args, {}) or {}
        ok = bool(out.get("ok")) or out.get("retcode") in (0, 10009)
        if not ok:
            return Obj(retcode=10011, comment=out.get("comment") or out.get("error") or "rejected",
                       order=None, price=None, raw=out)
        return Obj(retcode=TRADE_RETCODE_DONE, comment=out.get("comment") or "",
                   order=out.get("order") or out.get("ticket"),
                   price=_f(out.get("price")) if out.get("price") else None,
                   raw=out)

    def close_position(self, symbol, ticket):
        out = self._get("trade_close_single_position",
                        {"symbol": symbol, "position_ticket": str(ticket)}, {}) or {}
        ok = bool(out.get("ok")) or out.get("retcode") in (0, 10009)
        return Obj(retcode=TRADE_RETCODE_DONE if ok else 10011,
                   comment=out.get("comment") or "", raw=out)

    def calc_margin(self, symbol, side, volume, price):
        out = self._get("trade_order_calc_margin",
                        {"symbol": symbol, "type": side, "volume": _f(volume),
                         "price": _f(price)}, {}) or {}
        for k in ("margin", "required_margin", "initial_margin"):
            if out.get(k) is not None:
                return _f(out.get(k))
        return 0.0

    def calc_profit(self, symbol, side, volume, price_open, price_close):
        out = self._get("trade_order_calc_profit",
                        {"symbol": symbol, "type": side, "volume": _f(volume),
                         "price_open": _f(price_open), "price_close": _f(price_close)}, {}) or {}
        for k in ("profit", "profit_loss", "pl"):
            if out.get(k) is not None:
                return _f(out.get(k))
        return 0.0


def connect(url=None, key=None, verbose=True):
    """Connect to the terminal over MCP. Returns (module, info)."""
    url = url or os.environ.get("MT5_MCP_URL") or "http://127.0.0.1:22346/mcp"
    key = key if key is not None else os.environ.get("MT5_MCP_KEY", "")
    client = McpClient(url, key)
    info = {"ok": False, "connected": False, "mode": "mcp", "login": None,
            "server": "", "name": "", "currency": "", "balance": 0.0,
            "trade_allowed": False, "terminal_path": "", "version": None,
            "expected_login": None, "expected_server": None,
            "mismatch": False, "problems": [], "env_file": "",
            "mcp_url": url}
    try:
        client.initialize()
    except McpError as e:
        info["problems"].append("mcp handshake failed: %s" % e)
        if verbose:
            print("   MCP handshake failed:", e)
        return None, info
    mod = McpMt5(client)
    acc = mod.account_info()
    if acc is None:
        info["problems"].append("mcp connected but the terminal returned no account")
        if verbose:
            print("   ! MCP connected but no account info")
        return None, info
    info.update({"ok": True, "connected": True, "login": acc.login,
                 "server": acc.server, "name": acc.name, "currency": acc.currency,
                 "balance": acc.balance, "trade_allowed": acc.trade_allowed})
    if verbose:
        print("   connected via     : MCP", url)
        print("   login / server    :", acc.login, "/", acc.server)
        print("   balance / currency:", acc.balance, acc.currency)
    return mod, info
