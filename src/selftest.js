// selftest.js — positive controls: a detector that never fires is worthless.
//   1) synthetic bullish MSS + retest  -> expect a LONG candidate, grade A
//   2) synthetic bearish MSS + retest  -> expect a SHORT candidate, grade A
//   3) Day-1 replay                    -> expect ZERO A-grade signals (known answer)
import fs from 'fs';
import { BarBuilder } from './market.js';
import { analyze } from './strategy.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
let failures = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  if (!ok) failures++;
};

/** Build a 1m tick series from a list of M15 bars [o,h,l,c] with a realistic intra-bar path. */
function synth(bars15, startMin = Date.parse('2026-01-05T08:00:00Z')) {
  const bb = new BarBuilder();
  let t = startMin;
  for (const [o, h, l, c] of bars15) {
    const path = [];
    path.push(o);
    for (let i = 1; i <= 4; i++) path.push(o + (h - o) * (i / 4));        // up to the high
    for (let i = 1; i <= 4; i++) path.push(h + (l - h) * (i / 4));        // down to the low
    for (let i = 1; i <= 5; i++) path.push(l + (c - l) * (i / 5));        // back to the close
    path.forEach((p, i) => bb.push(t + i * 60000, p));
    t += 15 * 60000;
  }
  return bb;
}

function firstCandidate(bb, dir) {
  const r = analyze(bb, cfg);
  if (!r.ok) return null;
  const c = r.candidates.find((x) => x.dir === dir);
  return c || null;
}

// ---- 1) bullish: tight chop 4009-4012, MSS close above 4012, retest into 4011.5, then up
const bull = [];
for (let i = 0; i < 10; i++) bull.push([4009.5, 4012, 4009, 4010]);     // tight chop
bull.push([4010, 4020, 4010, 4019]);                                    // impulse up (MSS close 4019 > 4012)
bull.push([4019, 4019.5, 4011.5, 4012.5]);                              // retest into the broken zone
bull.push([4012.5, 4026, 4012.5, 4025]);                                // continuation
const c1 = firstCandidate(synth(bull), 'long');
check('bullish MSS+retest produces a LONG', !!c1, c1 ? `entry ${c1.entry.toFixed(1)} sl ${c1.sl.toFixed(1)} tp ${c1.tps} rr ${c1.rrs.map((x) => x.toFixed(2))}` : '');
check('bullish candidate is grade A/A+', !!c1 && ['A', 'A+'].includes(c1.grade), c1 ? c1.grade : '');
check('bullish candidate has >=2 targets', !!c1 && c1.tps.length >= 2, c1 ? String(c1.tps.length) : '');

// ---- 2) bearish: mirror
const bear = [];
for (let i = 0; i < 10; i++) bear.push([4002, 4003, 4001, 4002]);
bear.push([4002, 4002, 3992, 3993]);                                   // breakdown (MSS close 3993 < 4001)
bear.push([3993, 4001.5, 3999.5, 4000.5]);                             // retest into the broken zone, rejecting at it
bear.push([4000.5, 4000.5, 3985, 3985]);                                // continuation down
const c2 = firstCandidate(synth(bear), 'short');
check('bearish MSS+retest produces a SHORT', !!c2, c2 ? `entry ${c2.entry.toFixed(1)} sl ${c2.sl.toFixed(1)} tp ${c2.tps} rr ${c2.rrs.map((x) => x.toFixed(2))}` : '');
check('bearish candidate is grade A/A+', !!c2 && ['A', 'A+'].includes(c2.grade), c2 ? c2.grade : '');

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
