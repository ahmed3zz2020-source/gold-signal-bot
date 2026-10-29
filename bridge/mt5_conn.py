#!/usr/bin/env python3
"""mt5_conn.py — the ONE way the bridge talks to MT5.

Why this file exists (a real bug we hit on 2026-10-29):
  `mt5.initialize(login=..., password=..., server="")` sends the login to the
  terminal's DEFAULT server (MetaQuotes-Demo) -> "authorization on MetaQuotes-Demo
  failed (Invalid account)" and the terminal LEAVES the Exness account.
  Same with `initialize(path=...)` when it relaunches the terminal.

Rules enforced here:
  1. Attach to the RUNNING terminal FIRST, with NO credentials (keeps its session).
  2. Only log in with credentials when ALL of login+password+server are known.
  3. Never pass an empty server.
  4. After connecting, VERIFY the account (login + server). A mismatch is reported
     loudly and the caller must fail closed -> NO TRADE.

Also loads a .env file (no external dependency) so the Exness login/password never
has to be typed on the command line.
"""

import os
import sys

BRIDGE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(BRIDGE_DIR)


# ----------------------------------------------------------------- .env
def load_dotenv(start_dir=None):
    """Load KEY=VALUE pairs from the first .env found walking up from start_dir.
    Existing environment variables always win (so a shell export overrides the file).
    Returns the path of the file it loaded, or None."""
    here = start_dir or BRIDGE_DIR
    candidates = []
    env_path = os.environ.get("BRIDGE_ENV", "")
    if env_path:
        candidates.append(env_path)
    cur = here
    for _ in range(5):
        candidates.append(os.path.join(cur, ".env"))
        parent = os.path.dirname(cur)
        if parent == cur:
            break
        cur = parent
    for path in candidates:
        if not path or not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8-sig") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, _, val = line.partition("=")
                    key = key.strip()
                    val = val.strip().strip('"').strip("'")
                    if key and key not in os.environ:
                        os.environ[key] = val
        except OSError:
            continue
        return path
    return None


def cfg(name, default=""):
    return (os.environ.get(name) or default).strip()


# ----------------------------------------------------------------- connect
def connect(verbose=True):
    """Connect to MT5 and return (mt5_module, info_dict).

    info_dict keys:
      ok            bool   - connected AND (no expectation OR expectation matched)
      connected     bool   - the IPC link works
      mode          str    - 'attach' | 'login' | 'none'
      login         int
      server        str
      name          str
      currency      str
      balance       float
      trade_allowed bool
      terminal_path str
      version       tuple
      expected_login int | None
      expected_server str | None
      mismatch      bool   - connected to a DIFFERENT account than configured
      problems      list[str]
    """
    try:
        import MetaTrader5 as mt5
    except ImportError:
        if verbose:
            print("MetaTrader5 package is not installed.")
            print("  py -m venv .venv")
            print("  .venv\\Scripts\\python.exe -m pip install --upgrade pip MetaTrader5")
        return None, {"ok": False, "connected": False, "mode": "none",
                      "problems": ["MetaTrader5 package missing"], "mismatch": False}

    env_file = load_dotenv()
    login_s = cfg("MT5_LOGIN")
    password = cfg("MT5_PASSWORD")
    server = cfg("MT5_SERVER")
    path = cfg("MT5_PATH", r"C:\Program Files\MetaTrader 5\terminal64.exe")

    exp_login = int(login_s) if login_s.isdigit() else None
    exp_server = server or None

    info = {
        "ok": False, "connected": False, "mode": "none", "login": None,
        "server": "", "name": "", "currency": "", "balance": 0.0,
        "trade_allowed": False, "terminal_path": "", "version": None,
        "expected_login": exp_login, "expected_server": exp_server,
        "mismatch": False, "problems": [], "env_file": env_file or "",
    }
    if verbose:
        if env_file:
            print("   env file          :", env_file)
        print("   expected account  :", exp_login or "(not set)", "|", exp_server or "(not set)")

    def _snapshot():
        acc = mt5.account_info()
        if acc is None:
            return None
        info["login"] = acc.login
        info["server"] = acc.server
        info["name"] = acc.name
        info["currency"] = getattr(acc, "currency", "")
        info["balance"] = acc.balance
        info["trade_allowed"] = bool(acc.trade_allowed)
        ti = mt5.terminal_info()
        info["terminal_path"] = ti.path if ti else ""
        info["version"] = mt5.version()
        return acc

    attempts = []

    # ---- 1) attach to the running terminal, NO credentials (keeps its session)
    if path and os.path.exists(path):
        attempts.append(("attach-path", path))
        try:
            ok = mt5.initialize(path=path, timeout=60_000)
        except Exception as exc:                                  # noqa: BLE001
            ok = False
            info["problems"].append("attach-path raised: %s" % exc)
        if ok and _snapshot() is not None:
            info["connected"] = True
            info["mode"] = "attach"

    # ---- 2) no path / not attached yet -> default initialize (no credentials)
    if not info["connected"]:
        attempts.append(("attach-default", ""))
        try:
            ok = mt5.initialize(timeout=60_000)
        except Exception as exc:                                  # noqa: BLE001
            ok = False
            info["problems"].append("attach-default raised: %s" % exc)
        if ok and _snapshot() is not None:
            info["connected"] = True
            info["mode"] = "attach"

    # ---- 3) still no account -> log in explicitly (ONLY with a full triple)
    if not info["connected"]:
        if exp_login and password and exp_server:
            attempts.append(("login", exp_server))
            try:
                ok = mt5.initialize(login=exp_login, password=password,
                                    server=exp_server, timeout=60_000)
            except Exception as exc:                              # noqa: BLE001
                ok = False
                info["problems"].append("login raised: %s" % exc)
            if ok and _snapshot() is not None:
                info["connected"] = True
                info["mode"] = "login"
        else:
            info["problems"].append(
                "no account: terminal is not logged in (or MT5_SERVER is missing in .env)")

    if not info["connected"]:
        info["problems"].append("initialize failed: %s" % (mt5.last_error(),))
        if verbose:
            for kind, where in attempts:
                print("   tried %-14s %s" % (kind, where))
            for p in info["problems"]:
                print("   !", p)
        return mt5, info

    # ---- 4) VERIFY: are we on the account we think we are on?
    if exp_login and info["login"] != exp_login:
        info["mismatch"] = True
        info["problems"].append("WRONG ACCOUNT: connected as %s, expected %s"
                                % (info["login"], exp_login))
    if exp_server and info["server"] and exp_server.lower() not in info["server"].lower():
        info["mismatch"] = True
        info["problems"].append("WRONG SERVER: connected to %s, expected %s"
                                % (info["server"], exp_server))

    info["ok"] = info["connected"] and not info["mismatch"]
    if verbose:
        print("   connected via     :", info["mode"])
        print("   terminal version  :", info["version"])
        print("   terminal path     :", info["terminal_path"])
        for p in info["problems"]:
            print("   !", p)
    return mt5, info


def require_trading_account(mt5, info, verbose=True):
    """Fail-closed gate. Returns True only if we are connected to the EXPECTED
    account AND the account may trade. Never trade on a mismatch."""
    if info is None or not info.get("connected"):
        return False
    if info.get("mismatch"):
        if verbose:
            print("BLOCKED: the terminal is on a different account than the configured one.")
        return False
    if not info.get("trade_allowed"):
        if verbose:
            print("BLOCKED: 'Allow algorithmic trading' is OFF in the terminal "
                  "(or the account cannot trade).")
        return False
    if info.get("balance", 0) <= 0:
        if verbose:
            print("BLOCKED: account balance is 0 -> no position can be sized.")
        return False
    return True


if __name__ == "__main__":
    _, i = connect(verbose=True)
    print("   result            :", "OK" if i.get("ok") else "NOT READY")
    for p in i.get("problems", []):
        print("   !", p)
    sys.exit(0 if i.get("ok") else 2)
