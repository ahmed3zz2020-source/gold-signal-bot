// replay.js — feed a recorded tick file through the engine and print every candidate.
// This is the validation harness: Day 1 (2026-10-29) has a KNOWN answer — zero trades.
// If the engine produces A-grade signals on that day, it is too loose and must be tightened.
//
//   node src/replay.js [path-to-ticks.csv]

import fs from 'fs';
import { BarBuilder, atr, localNow, toMin } from './market.js';
import { analyze } from './strategy.js';

const cfg = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const file = process.argv[2] || '/workspace/gold/spot_ticks.csv';

if (!fs.existsSync(file)) { console.error(`missing ${file}`); process.exit(1); }

const rows = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(1)) {
  const p = line.split(',');
  if (p.length === 3) {
    const ts = +p[0] * 1000;              // the CSV stores SECONDS -> JS Date wants ms
    const bid = +p[1], ask = +p[2];
    if (Number.isFinite(ts) && Number.isFinite(bid) && Number.isFinite(ask)) rows.push({ ts, mid: (bid + ask) / 2 });
  }
}
rows.sort((a, b) => a.ts - b.ts);
console.log(`ticks ${rows.length}  ${new Date(rows[0].ts).toISOString()} -> ${new Date(rows[rows.length - 1].ts).toISOString()}`);

// ⛔ FAIL-CLOSED: a replay over a short file proves nothing. Say so instead of PASSing.
const MIN_TICKS = 1000;
if (rows.length < MIN_TICKS) {
  console.log(`\nVERDICT: INCONCLUSIVE — only ${rows.length} ticks (need >= ${MIN_TICKS}).`);
  console.log('A replay over a short file cannot prove anything — the gate needs a real session of ticks.');
  process.exit(2);
}

// minute-by-minute replay: at each minute only CLOSED bars are exposed to the engine
const firstMin = Math.floor(rows[0].ts / 60000) * 60000;
const lastMin = Math.floor(rows[rows.length - 1].ts / 60000) * 60000;
let cursor = 0;
const fired = [];
const seen = new Set();
let n = 0;

for (let t = firstMin; t <= lastMin; t += 60000) {
  while (cursor < rows.length && rows[cursor].ts < t) { cursor++; }
  const bb = new BarBuilder();
  for (let i = 0; i < cursor; i++) bb.push(rows[i].ts, rows[i].mid);
  const m5 = bb.series(5), m15 = bb.series(15), m60 = bb.series(60), m1 = bb.series(1);
  if (m15.length < 12) continue;
  // drop forming bars (the engine only ever decides on closed bars)
  const closed = { 1: m1.slice(0, -1), 5: m5.slice(0, -1), 15: m15.slice(0, -1), 60: m60.slice(0, -1) };
  if (!closed[5].length || !closed[15].length) continue;
  const snap = { series: (tf) => closed[tf] || closed[15] };
  const res = analyze(snap, cfg, t);
  if (!res.ok) continue;
  n++;
  for (const c of res.candidates) {
    const key = `${c.dir}|${c.mssLevel.toFixed(1)}|${c.entry.toFixed(1)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    fired.push({ t, c, ctx: res.ctx });
    const ut = new Date(t).toISOString().slice(11, 16);
    console.log(
      `${ut}Z ${c.grade.padEnd(2)} ${c.dir.toUpperCase().padEnd(5)} entry ${c.entry.toFixed(1)} sl ${c.sl.toFixed(1)} ` +
      `tp ${c.tps.map((x) => x.toFixed(1)).join('/')} rr ${c.rrs.map((x) => x.toFixed(2)).join('/')} ` +
      `blend ${c.blended.toFixed(2)} sweep=${c.sweep ? 'Y' : 'N'} mss ${c.mssLevel.toFixed(1)} bias ${c.bias}`
    );
  }
}

console.log(`\nsteps evaluated: ${n}`);
console.log(`candidates: ${fired.length}  (A+: ${fired.filter((f) => f.c.grade === 'A+').length}  A: ${fired.filter((f) => f.c.grade === 'A').length}  B: ${fired.filter((f) => f.c.grade === 'B').length})`);
const a = fired.filter((f) => f.c.grade === 'A' || f.c.grade === 'A+');
console.log(`\nVERDICT: ${a.length === 0 ? 'PASS — no A-grade signal on a day whose correct answer was ZERO trades' : 'FAIL — ' + a.length + ' A-grade signal(s) on a no-trade day ⇒ engine too loose'}`);
if (a.length) for (const f of a) console.log(`  ${new Date(f.t).toISOString()} ${f.c.grade} ${f.c.dir} entry ${f.c.entry.toFixed(1)} sl ${f.c.sl.toFixed(1)} rr ${f.c.rrs.map((x) => x.toFixed(2)).join('/')}`);
