// journal.js — the data foundation for self-learning.
//
// Every structural event the gate sees (fired OR skipped) is written to a journal with a
// UNIFORM counterfactual outcome: "did price reach +2R before -1R inside the horizon?"
// A uniform label makes events comparable, so the bot can learn which SETUP TYPES pay.
//
// Rules that must never change (0.5% risk, 1.5% daily cap, blackout, 2:1 floor, no stacking)
// are NOT in this file. Learning may only REMOVE setups, never loosen the risk.

import fs from 'fs';

export const HORIZON_MIN = 120;   // how long we wait before judging an event
export const TARGET_R = 2;         // the uniform counterfactual target (R)

/** Stable id for an event. */
export function eventId(ev) {
  return ev.sid || `${ev.dir}-${ev.ts}-${ev.entry.toFixed(2)}`;
}

/** Session phase from the UTC hour (the trade window is 06:00-15:00 UTC). */
export function phaseOf(ts) {
  const d = new Date(ts);
  const h = d.getUTCHours() + d.getUTCMinutes() / 60;
  if (h < 6) return 'asia';
  if (h < 8) return 'preLDN';
  if (h < 11) return 'LDN';
  if (h < 13) return 'nyPre';
  if (h < 16) return 'NY';
  return 'late';
}

/** The phase GROUP used in the signature key (3 groups => a usable sample per key). */
export function phaseGroup(ts) {
  const p = phaseOf(ts);
  if (p === 'preLDN' || p === 'LDN') return 'LDN';
  if (p === 'nyPre' || p === 'NY') return 'NY';
  return 'other';
}

/**
 * The feature bucket. Deliberately coarse: with ~5-15 samples a day a 6-dimension key
 * would leave n=1 per bucket (pure noise). 4 dimensions keep the samples usable.
 * The grade is NOT part of the key (it is the label we want to learn about).
 */
export function signature(ev, ctx = {}) {
  const biasAlign = ev.bias === (ev.dir === 'long' ? 'BULLISH' : 'BEARISH') ? 'with' : 'against';
  return `${ev.dir}|${ev.sweep ? 'sweep' : 'nosweep'}|${biasAlign}|${phaseGroup(ev.ts)}`;
}

/** Append-only JSONL helpers. */
export function appendJsonl(file, obj) {
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Judge one event against the market that followed.
 * Conservative tie-break: if one bar contains both +2R and -1R, the LOSS wins (we never
 * flatter ourselves). Returns null when there is no data yet (not resolved).
 */
export function evaluateOutcome(ev, bars1, opts = {}) {
  const horizonMin = opts.horizonMin ?? HORIZON_MIN;
  const targetR = ev.targetR ?? opts.targetR ?? TARGET_R;
  const risk = Math.abs(ev.entry - ev.sl);
  if (!risk) return null;
  const end = ev.ts + horizonMin * 60000;
  let mfe = 0, mae = 0, result = 'timeout', tExtreme = null, bars = 0;
  for (const b of bars1) {
    if (b.t < ev.ts) continue;
    if (b.t > end) break;
    bars++;
    const fav = ev.dir === 'long' ? (b.h - ev.entry) / risk : (ev.entry - b.l) / risk;
    const adv = ev.dir === 'long' ? (ev.entry - b.l) / risk : (b.h - ev.entry) / risk;
    if (fav > mfe) mfe = fav;
    if (adv > mae) mae = adv;
    const hitWin = fav >= targetR;
    const hitLoss = adv >= 1;
    if (hitWin && !hitLoss) { result = 'win'; tExtreme = b.t; break; }
    if (hitLoss) { result = 'loss'; tExtreme = b.t; break; }   // conservative: loss wins ties
  }
  if (!bars) return null;                                        // no data yet
  return {
    id: eventId(ev), sig: ev.sig, cls: ev.cls || 'X', dir: ev.dir, ts: ev.ts, result,
    mfe: +mfe.toFixed(2), mae: +mae.toFixed(2), tExtreme, bars, kind: ev.kind,
    r: result === 'win' ? targetR : result === 'loss' ? -1 : 0,
  };
}
