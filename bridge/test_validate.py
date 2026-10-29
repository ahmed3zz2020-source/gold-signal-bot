#!/usr/bin/env python3
"""test_validate.py — the bridge's own safety logic, tested WITHOUT MetaTrader.
Run: python3 bridge/test_validate.py"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate import validate_signal, compute_volume  # noqa: E402

PASS = FAIL = 0


def ok(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        print(f"PASS  {name}"); PASS += 1
    else:
        print(f"FAIL  {name} {extra}"); FAIL += 1


NOW = int(time.time() * 1000)


def sig(**kw):
    base = {"id": "s1", "dir": "long", "grade": "A", "entry": 4030.0, "sl": 4026.0,
            "tps": [4039.5, 4044.5, 4050.0], "ts": NOW - 5000,
            "expiresTs": NOW + 60000, "blended": 2.4}
    base.update(kw)
    return base


BASE = dict(live_price=4030.2, open_positions=[], trades_today=0, daily_r_pct=0.0,
            balance=10000.0, symbol="XAUUSDm")

# --- a good signal passes and produces a plan
passed, why, plan = validate_signal(sig(), **BASE)
ok("a clean A signal is accepted", passed and plan is not None, why)
ok("the plan is a BUY with the right numbers",
   plan and plan.action == "BUY" and plan.symbol == "XAUUSDm" and plan.sl == 4026.0,
   str(plan))

# --- the volume maths: 0.5% of 10000 = 50 USD, stop 4 points, 100 USD/point/lot
#     => 50 / (4 * 100) = 0.125 lot => rounded DOWN to the 0.01 step = 0.12
ok("the volume respects the 0.5% risk on a 4-point stop",
   abs(plan.volume - 0.12) < 1e-9, f"volume={plan.volume}")
v = compute_volume(10000, 0.5, 10, 100, 100, min_vol=0.01, step=0.01)
ok("a 10-point stop gives 0.05 lots", abs(v - 0.05) < 1e-9, f"volume={v}")
v = compute_volume(10000, 0.5, 1, 100, 100, min_vol=0.01, step=0.01)
ok("a 1-point stop gives 0.50 lots", abs(v - 0.50) < 1e-9, f"volume={v}")
v = compute_volume(10000, 0.5, 60, 100, 100, min_vol=0.01, step=0.01)
ok("a 60-point stop is clamped to the minimum 0.01 lot", abs(v - 0.01) < 1e-9, f"volume={v}")

# --- the refusals
passed, why, _ = validate_signal(sig(ts=NOW - 300000), **BASE)
ok("a stale signal is refused", not passed and "قديم" in why, why)
passed, why, _ = validate_signal(sig(grade="B"), **BASE)
ok("a B grade is refused", not passed, why)
passed, why, _ = validate_signal(sig(tps=[4031.0, 4032.0, 4033.0]), **BASE)
ok("a signal with RR < 2 is refused", not passed and "العائد" in why, why)
passed, why, _ = validate_signal(sig(), **{**BASE, "open_positions": [{"ticket": 1}]})
ok("a signal while a position is open is refused", not passed and "مفتوحة" in why, why)
passed, why, _ = validate_signal(sig(), **{**BASE, "trades_today": 2})
ok("the 3rd trade of the day is refused", not passed and "صفقات" in why, why)
passed, why, _ = validate_signal(sig(), **{**BASE, "daily_r_pct": 1.2})
ok("a trade that would breach the 1.5% daily cap is refused", not passed and "وقف اليوم" in why, why)
passed, why, _ = validate_signal(sig(), **{**BASE, "live_price": 4036.0})
ok("a price that drifted 6 points is refused", not passed and "اتحرك" in why, why)
passed, why, _ = validate_signal(sig(), **{**BASE, "live_price": None})
ok("no live price means no trade", not passed, why)
passed, why, _ = validate_signal(sig(expiresTs=NOW - 1000), **BASE)
ok("an expired signal is refused", not passed and "انتهت" in why, why)
passed, why, _ = validate_signal(None, **BASE)
ok("no signal means no trade", not passed, why)

# --- the short side
passed, why, plan = validate_signal(sig(dir="short", entry=4020.0, sl=4024.0,
                                    tps=[4012.0, 4005.0, 4000.0]),
                                    **{**BASE, "live_price": 4020.1})
ok("a short signal produces a SELL", passed and plan and plan.action == "SELL", why)

# --- the edge case: a 2R RR exactly at the limit is accepted
passed, why, _ = validate_signal(sig(entry=4030.0, sl=4025.0, tps=[4040.0, 4045.0, 4050.0]), **BASE)
ok("exactly 2R to the second target is accepted", passed, why)
passed, why, _ = validate_signal(sig(entry=4030.0, sl=4025.0, tps=[4034.9, 4035.5, 4040.0]), **BASE)
ok("just under 2R is refused", not passed, why)

print(f"\n{'ALL CHECKS PASSED' if FAIL == 0 else 'FAILURES: %d' % FAIL}  ({PASS} passed)")
sys.exit(0 if FAIL == 0 else 1)
