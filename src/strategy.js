// strategy.js — the gate. Deterministic version of the rules the analyst applies by hand:
//   liquidity level -> MSS (structure break) -> retest -> entry/SL/TP -> RR -> grade.
// Nothing fires without: MSS + retest + a fill that clears the RR gate + no news blackout.

import { ema, rsi, atr, localNow, toMin, dayStartUtc } from './market.js';

const EPS = 1e-9;

// ---------------------------------------------------------------- swings & liquidity

/** Fractal swing highs/lows on a bar series. */
export function swings(bars, lb = 2) {
  const highs = [], lows = [];
  for (let i = lb; i < bars.length - lb; i++) {
    const b = bars[i];
    let isH = true, isL = true;
    for (let k = 1; k <= lb; k++) {
      if (b.h < bars[i - k].h - EPS || b.h < bars[i + k].h - EPS) isH = false;
      if (b.l > bars[i - k].l + EPS || b.l > bars[i + k].l + EPS) isL = false;
    }
    if (isH) highs.push({ idx: i, level: b.h, t: b.t });
    if (isL) lows.push({ idx: i, level: b.l, t: b.t });
  }
  return { highs, lows };
}

/** Untapped liquidity above/below a price (swing levels that price has not closed through). */
export function liquidityMap(sw, price, extra = {}) {
  const above = sw.highs.filter((s) => s.level > price).map((s) => s.level);
  const below = sw.lows.filter((s) => s.level < price).map((s) => s.level);
  if (extra.above != null && extra.above > price) above.push(extra.above);
  if (extra.below != null && extra.below < price) below.push(extra.below);
  // round numbers and hand-mapped key levels are liquidity too
  const step = extra.roundStep || 5;
  const base = Math.round(price / step) * step;
  for (let k = 0; k <= 8; k++) {
    const up = base + k * step, dn = base - k * step;
    if (up > price) above.push(up);
    if (dn < price) below.push(dn);
  }
  for (const l of (extra.keyLevels || [])) {
    if (l > price) above.push(l); else if (l < price) below.push(l);
  }
  return {
    above: [...new Set(above)].sort((a, b) => a - b),
    below: [...new Set(below)].sort((a, b) => b - a),
  };
}

// ---------------------------------------------------------------- MSS + retest

/**
 * Find the most recent valid MSS in one direction.
 *  LONG  : an M15 close ABOVE a swing high L, still holding (no M15 close back below L).
 *  SHORT : an M15 close BELOW a swing low  L, still holding (no M15 close back above  L).
 */
export function findMSS(bars15, sw, dir, lookbackBars) {
  const cand = dir === 'long' ? sw.highs : sw.lows;
  const from = Math.max(0, bars15.length - 1 - lookbackBars);
  let best = null;
  for (const s of cand) {
    if (s.idx < from - 1) continue;
    for (let j = s.idx + 1; j < bars15.length; j++) {
      const brk = dir === 'long' ? bars15[j].c > s.level : bars15[j].c < s.level;
      if (!brk) continue;
      // still valid? no opposite close after the break
      let broken = false;
      for (let k = j + 1; k < bars15.length; k++) {
        const rev = dir === 'long' ? bars15[k].c <= s.level : bars15[k].c >= s.level;
        if (rev) { broken = true; break; }
      }
      if (!broken) best = { level: s.level, mssIdx: j, mssBar: bars15[j], swingIdx: s.idx };
      break;
    }
  }
  return best;
}

/** A rejection bar: closed back beyond the level, either a green body or a long wick. */
function isRejection(b, dir) {
  const range = Math.max(b.h - b.l, 1e-6);
  if (dir === 'long') {
    const wick = Math.min(b.o, b.c) - b.l;
    return b.c > b.o || wick / range >= 0.5;
  }
  const wick = b.h - Math.max(b.o, b.c);
  return b.c < b.o || wick / range >= 0.5;
}

/** The retest: the first bar after the MSS that revisits the broken level and rejects it. */
export function findRetest(bars5, mss, dir, atr5, cfg) {
  if (!mss) return null;
  const buf = cfg.retestBufferAtr * (atr5 || 4);
  let impulseLow = mss.mssBar.l, impulseHigh = mss.mssBar.h;
  const afterMss = mss.mssBar.t + 15 * 60000;   // the MSS is only known when the M15 closes
  const start = bars5.findIndex((b) => b.t >= afterMss);
  for (let i = start < 0 ? 0 : start; i < bars5.length; i++) {
    const b = bars5[i];
    if (b.t < afterMss) continue;
    if (dir === 'long') {
      if (b.c < mss.level - 0.9 * (atr5 || 4)) return null;      // MSS broken on a close
      if (b.l <= mss.level + buf && b.c >= mss.level && isRejection(b, 'long')) {
        return { bar: b, impulseLow: Math.min(impulseLow, b.l) };
      }
    } else {
      if (b.c > mss.level + 0.9 * (atr5 || 4)) return null;
      if (b.h >= mss.level - buf && b.c <= mss.level && isRejection(b, 'short')) {
        return { bar: b, impulseHigh: Math.max(impulseHigh, b.h) };
      }
    }
  }
  return null;
}

/**
 * The WIDE net: every fresh M15 structure break (the first close beyond a fractal level).
 * These are NOT trades — they are the learning's sample. The risk unit is ATR (so the
 * counterfactual "+2 ATR before -1 ATR" is comparable across every structure).
 */
export function scanStructures(m15, sw, atr5, atr15, cfg, ctx) {
  const out = [];
  const unit = atr5 || 4;
  // the learning population uses a WIDE window (the whole history), not the 12-bar
  // MSS window: more samples per day is the whole point of the journal
  const lookback = cfg.learningLookback ?? 60;
  for (const dir of ['long', 'short']) {
    const lv = dir === 'long' ? sw.highs : sw.lows;
    for (const s of lv) {
      if (s.idx < m15.length - 1 - lookback) continue;
      let j = s.idx + 1;
      for (; j < m15.length; j++) {
        const brk = dir === 'long' ? m15[j].c > s.level : m15[j].c < s.level;
        if (brk) break;
      }
      if (j >= m15.length) continue;
      const bar = m15[j];
      let sweep = false;
      for (let k = j - 1; k >= Math.max(0, j - 4); k--) {
        if (dir === 'long' && m15[k].h > s.level) sweep = true;
        if (dir === 'short' && m15[k].l < s.level) sweep = true;
      }
      const entry = bar.c;
      const risk = unit;
      out.push({
        dir, level: s.level, ts: bar.t, entry, sl: dir === 'long' ? entry - risk : entry + risk,
        risk, sweep, atr5, atr15, bias: ctx.bias, mssLevel: s.level, cls: 'M',
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- targets, RR, grade

export function pickTargets(levels, entry, dir, atr15, cfg) {
  const minSep = cfg.minTp1Atr15 * (atr15 || 7);
  const maxDist = cfg.maxTpAtr15 * (atr15 || 7);
  const pool = dir === 'long' ? levels.above.filter((l) => l > entry) : levels.below.filter((l) => l < entry);
  const out = [];
  for (const l of pool) {
    const dist = Math.abs(l - entry);
    if (dist < minSep) continue;
    if (dist > maxDist) break;
    if (out.length && Math.abs(l - out[out.length - 1]) < minSep) continue;
    out.push(l);
    if (out.length >= 3) break;
  }
  return out;
}

export function gradeTrade(entry, sl, tps, dir, sweep, cfg) {
  const risk = Math.abs(entry - sl);
  if (risk <= 0) return null;
  const rrs = tps.map((t) => Math.abs(t - entry) / risk);
  if (!rrs.length) return null;
  const blended = rrs.reduce((a, b) => a + b, 0) / rrs.length;
  let grade = 'C';
  if (rrs[1] !== undefined && rrs[1] >= cfg.minRR2 && blended >= cfg.minBlendedRR) grade = 'A';
  if (grade === 'A' && blended >= cfg.gradeAplusBlendedRR && sweep) grade = 'A+';
  return { risk, rrs, blended, grade };
}

// ---------------------------------------------------------------- news blackout

export function newsBlackout(cal, nowMs, cfg) {
  const N = cfg.news || cfg;
  if (!Array.isArray(cal)) return { blocked: false };
  for (const e of cal) {
    if (!e.date || !e.impact) continue;
    const t = new Date(e.date).getTime();
    if (!Number.isFinite(t)) continue;
    const cur = (e.country || '').toUpperCase();
    let before = 0, after = 0;
    if (cur === 'USD' && e.impact === 'High') {
      const ext = N.usExtendedKeywords.some((k) => (e.title || '').toUpperCase().includes(k.toUpperCase()));
      before = ext ? N.usExtendedBeforeMin : N.usHighBeforeMin;
      after = ext ? N.usExtendedAfterMin : N.usHighAfterMin;
    } else if (cur === 'EUR' && e.impact === 'High') {
      // the FF feed tags Italian events as EUR too -> only the ECB itself blocks
      if (!/ECB|Refinancing Rate|Deposit Rate|Monetary Policy/i.test(e.title || '')) continue;
      before = N.eurHighBeforeMin; after = N.eurHighAfterMin;
    } else continue;
    const s = t - before * 60000, en = t + after * 60000;
    if (nowMs >= s && nowMs <= en) {
      return { blocked: true, until: en, title: e.title, country: cur, at: t };
    }
  }
  return { blocked: false };
}

// ---------------------------------------------------------------- main analyze

export function analyze(m1, cfg, now = Date.now()) {
  const S = cfg.signals || cfg;
  const m5 = m1.series(5), m15 = m1.series(15), m60 = m1.series(60);
  if (m15.length < 12) return { ok: false, reason: "not enough bars" };
  // ONLY CLOSED bars may decide: a forming M5/M15 close is not a fact yet
  const closed5 = m5.filter((x) => x.t + 5 * 60000 <= now);
  const closed15 = m15.filter((x) => x.t + 15 * 60000 <= now);
  if (closed15.length < 12) return { ok: false, reason: "not enough closed bars" };

  const atr5 = atr(closed5), atr15 = atr(closed15), atr60 = atr(m60);
  const price = m1.series(1).slice(-1)[0].c;
  const sw = swings(closed15, S.swingLookback);
  const m1all = m1.series(1);
  const tz = (cfg.session && cfg.session.tz) || cfg.tz || 'Africa/Cairo';
  const dStart = dayStartUtc(tz, now);
  const today = m1all.filter((b) => b.t >= dStart);
  const dayBars = today.length ? today : m1all;
  const dayHigh = Math.max(...dayBars.map((b) => b.h));
  const dayLow = Math.min(...dayBars.map((b) => b.l));
  const levels = liquidityMap(sw, price, { above: dayHigh, below: dayLow, roundStep: S.roundStep, keyLevels: cfg.keyLevels || [] });

  const ctx = {
    price, atr5, atr15, atr60,
    ema50h1: ema(m60.map((b) => b.c), 50), ema200h1: ema(m60.map((b) => b.c), 200),
    ema50m15: ema(m15.map((b) => b.c), 50), ema200m15: ema(m15.map((b) => b.c), 200),
    rsi15: rsi(m15.map((b) => b.c), 14),
    dayHigh, dayLow,
    levels,
  };
  ctx.bias = ctx.ema50h1 && ctx.ema200h1
    ? (price > ctx.ema50h1 && ctx.ema50h1 > ctx.ema200h1 ? 'BULLISH'
      : price < ctx.ema50h1 && ctx.ema50h1 < ctx.ema200h1 ? 'BEARISH' : 'MIXED')
    : 'MIXED';

  const out = { ok: true, ctx, candidates: [], events: [], structures: scanStructures(closed15, sw, atr5, atr15, S, ctx) };

  for (const dir of ['long', 'short']) {
    if (S.requireBias) {                       // optional: only trade with the H1 bias
      const need = dir === 'long' ? 'BULLISH' : 'BEARISH';
      if (ctx.bias !== need) continue;
    }
    const mss = findMSS(closed15, sw, dir, S.mssLookbackM15);
    if (!mss) continue;
    const rt = findRetest(closed5, mss, dir, atr5, S);
    if (!rt) continue;

    // sweep = a wick beyond the broken level in the bars BEFORE the MSS (liquidity grab)
    let sweep = false;
    for (let j = mss.mssIdx - 1; j >= Math.max(0, mss.mssIdx - 6); j--) {
      if (dir === 'long' && closed15[j].h > mss.level) sweep = true;
      if (dir === 'short' && closed15[j].l < mss.level) sweep = true;
    }

    const entry = rt.bar.c;
    // invalidation = beyond the last opposing swing before the MSS
    const opp = dir === 'long'
      ? sw.lows.filter((s) => s.idx < mss.mssIdx).map((s) => s.level)
      : sw.highs.filter((s) => s.idx < mss.mssIdx).map((s) => s.level);
    const anchor = dir === 'long'
      ? (opp.length ? Math.max(...opp) : mss.mssBar.l)
      : (opp.length ? Math.min(...opp) : mss.mssBar.h);
    let sl = dir === 'long'
      ? Math.min(anchor, rt.bar.l) - S.stopBufferAtr5 * (atr5 || 4)
      : Math.max(anchor, rt.bar.h) + S.stopBufferAtr5 * (atr5 || 4);

    // the pool must be built around the ENTRY, not around the current price
    const entryLevels = liquidityMap(sw, entry, { above: dayHigh, below: dayLow, roundStep: S.roundStep, keyLevels: cfg.keyLevels || [] });
    const tps = pickTargets(entryLevels, entry, dir, atr15, S);
    // NOTE: a structure with fewer than 2 clean targets is still a STRUCTURE — it is
    // journalled (grade C) so the learning sees the whole sample, not only the pretty ones
    const g = tps.length >= 2
      ? gradeTrade(entry, sl, tps, dir, sweep, S)
      : { grade: 'C', risk: Math.abs(entry - sl), rrs: [], blended: 0 };
    if (!g || !g.risk) continue;

    const ev = {
      dir, grade: g.grade, entry, sl, tps, risk: g.risk, rrs: g.rrs, blended: g.blended,
      sweep, mssLevel: mss.level, mssTime: mss.mssBar.t, retestTime: rt.bar.t,
      atr5, atr15, bias: ctx.bias,
    };
    // EVERY structure goes into the journal (the learning needs the rejected ones too);
    // only the fire/watch grades become candidates
    out.events.push(ev);
    if (tps.length >= 2 && (S.fireGrades.includes(g.grade) || g.grade === S.watchGrade)) out.candidates.push(ev);
  }
  return out;
}
