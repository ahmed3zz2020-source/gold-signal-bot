// noise-test.js — does the engine fire on pure noise?
//
// The Day-1 replay gate needs a real tick file. When that file is unavailable, THIS gate
// covers the same risk from the other side: a seeded random walk has NO structure, so a
// correct engine must almost never produce an A-grade setup on it. A high count means the
// gate is too loose (it would fire in a market with nothing to trade).
//
//   node src/noise-test.js [ticks] [maxAllowed]

import fs from 'fs';
import { BarBuilder } from './market.js';
import { analyze } from './strategy.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const N = +(process.argv[2] || 6000);            // 6000 x 10s = 16.7 hours
const MAX_ALLOWED = +(process.argv[3] || 5);

// a seeded PRNG so the test is reproducible
let seed = 20261029;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => {
  const u = Math.max(rnd(), 1e-9), v = Math.max(rnd(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

// a gold-like random walk: sigma ~0.6 points per 10s tick (M15 ATR ~7 pts), a slow drift
// and three news-style jumps. Structurally there is NOTHING to trade here.
const start = Date.UTC(2026, 9, 29, 6, 0);
const rows = [];
let px = 4020;
for (let i = 0; i < N; i++) {
  px += gauss() * 0.6 + 0.0004 * Math.sin(i / 400);
  if (i === 1200 || i === 3000 || i === 4800) px += (rnd() > 0.5 ? 1 : -1) * 8;   // a spike
  const ts = start + i * 10000;
  rows.push({ ts, mid: px });
}

console.log(`synthetic noise: ${rows.length} ticks  ${new Date(rows[0].ts).toISOString()} -> ${new Date(rows[rows.length-1].ts).toISOString()}`);
console.log(`price range: ${Math.min(...rows.map(r=>r.mid)).toFixed(1)} - ${Math.max(...rows.map(r=>r.mid)).toFixed(1)}`);

const firstMin = Math.floor(rows[0].ts / 60000) * 60000;
const lastMin = Math.floor(rows[rows.length - 1].ts / 60000) * 60000;
const fired = [];
const seen = new Set();
let n = 0;
for (let t = firstMin; t <= lastMin; t += 60000) {
  const bb = new BarBuilder();
  for (const r of rows) { if (r.ts >= t) break; bb.push(r.ts, r.mid); }
  const m5 = bb.series(5), m15 = bb.series(15), m60 = bb.series(60), m1 = bb.series(1);
  if (m15.length < 12) continue;
  const closed = { 1: m1.slice(0, -1), 5: m5.slice(0, -1), 15: m15.slice(0, -1), 60: m60.slice(0, -1) };
  if (!closed[5].length || !closed[15].length) continue;
  const res = analyze({ series: (tf) => closed[tf] || closed[15] }, cfg, t);
  if (!res.ok) continue;
  n++;
  for (const c of res.candidates) {
    const key = `${c.dir}|${c.mssLevel.toFixed(1)}|${c.entry.toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fired.push({ t, c });
    console.log(`${new Date(t).toISOString().slice(11,16)}Z ${c.grade.padEnd(2)} ${c.dir.toUpperCase().padEnd(5)} entry ${c.entry.toFixed(1)} rr ${c.rrs.map(x=>x.toFixed(2)).join('/')}`);
  }
}
const a = fired.filter((f) => f.c.grade === 'A' || f.c.cgrade === 'A+');
const aa = fired.filter((f) => f.c.grade === 'A' || f.c.grade === 'A+');
console.log(`\nsteps evaluated: ${n}`);
console.log(`candidates: ${fired.length}  (A+: ${aa.filter(f=>f.c.grade==='A+').length}  A: ${aa.filter(f=>f.c.grade==='A').length}  B: ${fired.filter(f=>f.c.grade==='B').length})`);
console.log(`A-grade on pure noise: ${aa.length}  (allowed: <= ${MAX_ALLOWED} over ${(N*10/3600).toFixed(1)} hours)`);
const pass = aa.length <= MAX_ALLOWED;
console.log(`\nVERDICT: ${pass ? 'PASS — the engine barely fires on noise' : 'FAIL — ' + aa.length + ' A-grade signals on pure noise ⇒ the gate is too loose'}`);
process.exit(pass ? 0 : 1);
