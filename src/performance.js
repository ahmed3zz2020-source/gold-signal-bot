// performance.js — turn resolved events into per-setup statistics, then use them to
// (a) skip setups that are demonstrably worse than average and (b) rank the rest.
//
// Anti-overfit rules built in:
//  - the per-bucket estimate is SHRUNK toward the global estimate (never a raw win rate)
//  - old samples DECAY (the current regime matters more than last month)
//  - a bucket can only be BLOCKED with a minimum amount of evidence
//  - the hard risk rules are never touched from here

export const DEFAULT_OPTS = {
  alpha: 10,          // shrinkage strength (pseudo-events toward the global estimate)
  priorP: 0.40,       // prior win rate if we had no data at all
  minSamples: 12,     // raw resolved events required before a bucket may be blocked
  margin: 0.10,       // how much worse than the global a bucket must be to be blocked
  halfLifeDays: 20,   // a sample's weight halves every N days
  targetR: 2,
};

const decay = (ageDays, halfLife) => Math.pow(0.5, Math.max(0, ageDays) / halfLife);

/**
 * @param {Array} resolved  [{sig, ts, result:'win'|'loss'|'timeout'}]
 * @param {number} now      epoch ms
 */
export function buildPerformance(resolved, now = Date.now(), opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const buckets = new Map();
  const globals = {};                 // per class: {W,L,N}

  for (const rec of resolved) {
    const w = decay((now - rec.ts) / 86400000, o.halfLifeDays);
    const cls = rec.cls || 'X';
    const g = globals[cls] || (globals[cls] = { W: 0, L: 0, N: 0 });
    g.N += w;
    if (rec.result === 'win') g.W += w;
    else if (rec.result === 'loss') g.L += w;
    const key = `${rec.sig}#${cls}`;
    const b = buckets.get(key) || { sig: rec.sig, cls: rec.cls || 'X', n: 0, w: 0, wins: 0, losses: 0, timeouts: 0, rSum: 0 };
    b.n++; b.w += w;
    if (rec.result === 'win') { b.wins += w; b.rSum += w * o.targetR; }
    else if (rec.result === 'loss') { b.losses += w; b.rSum += -w; }
    else { b.timeouts += w; }
    buckets.set(key, b);
  }

  // global estimate with a conservative prior (the SAME prior the buckets use, so a bucket
  // that IS the whole dataset can never look more confident than the global itself)
  const pOf = (g) => (g.W + o.alpha * o.priorP) / (g.N + o.alpha);
  const totalW = Object.values(globals).reduce((a, g) => a + g.N, 0);
  const pGlobal = pOf({ W: Object.values(globals).reduce((a, g) => a + g.W, 0), N: Object.values(globals).reduce((a, g) => a + g.N, 0) });

  for (const b of buckets.values()) {
    const g = globals[b.cls] || { W: 0, L: 0, N: 0 };
    b.pGlobalCls = +pOf(g).toFixed(3);
    b.pWin = +((b.wins + o.alpha * o.priorP) / (b.w + o.alpha)).toFixed(3);
    b.pLoss = +((b.losses + o.alpha * (1 - o.priorP)) / (b.w + o.alpha)).toFixed(3);
    b.expR = +(b.pWin * o.targetR - b.pLoss).toFixed(3);
    b.avgR = +(b.rSum / Math.max(b.w, 1e-9)).toFixed(3);
    b.wRate = +(b.w / Math.max(totalW, 1e-9)).toFixed(3);
    // The baseline is the class average, but never below the prior: a type that keeps
    // winning less than the prior (minus the margin) is not worth taking, even when it
    // happens to be the only type inside its class.
    b.baseline = +Math.max(b.pGlobalCls, o.priorP).toFixed(3);
    b.blocked = b.n >= o.minSamples && b.pWin < b.baseline - o.margin;
    b.samples = b.n;
    b.reason = b.blocked ? `أضعف من المتوسط (${b.pWin} مقابل ${pGlobal.toFixed(3)}) ب${b.n} عينة`
      : b.n < o.minSamples ? `عينات قليلة (${b.n}) ⇒ القرار يفضل القواعد الثابتة` : 'مقبول';
  }

  const classes = {};
  for (const [k, g] of Object.entries(globals)) {
    const p = pOf(g);
    const pL = (g.L + o.alpha * (1 - o.priorP)) / (g.N + o.alpha);
    classes[k] = {
      p: +p.toFixed(3), n: Math.round(g.N),
      expR: +(p * o.targetR - pL).toFixed(3),
      blocked: g.N >= o.minSamples && (p * o.targetR - pL) < 0,
    };
  }

  return {
    pGlobal: +pGlobal.toFixed(3),
    classes,
    globals: Object.fromEntries(Object.entries(globals).map(([k, g]) => [k, +pOf(g).toFixed(3)])),
    n: Math.round(totalW),
    rawN: resolved.length,
    buckets: [...buckets.values()].sort((a, b) => b.pWin - a.pWin),
    opts: o,
  };
}

/** Find the bucket for a feature key, preferring the exact class then the wider population. */
export function bucketOf(perf, sig, cls = 'A') {
  const exact = perf.buckets.find((x) => x.sig === sig && x.cls === cls);
  if (exact && exact.n >= perf.opts.minSamples) return { b: exact, via: cls };
  const wide = perf.buckets.find((x) => x.sig === sig && x.cls === 'M' && x.n >= perf.opts.minSamples);
  if (wide) return { b: wide, via: 'M' };
  return { b: exact || null, via: cls };
}

/** Should this candidate be skipped because its setup type keeps losing? */
export function learningVerdict(perf, sig, cls = 'A') {
  if (!perf.rawN) return { skip: false, why: 'مفيش بيانات بعد' };
  // CLASS-level: when a whole population keeps losing, stop taking that kind of setup
  const ci = perf.classes && perf.classes[cls];
  if (ci && ci.blocked) {
    return { skip: true, why: `التعلّم: الفئة دي كلها خاسرة (نجاح ${(ci.p * 100).toFixed(0)}% عند ${ci.n} عينة)` };
  }
  const { b, via } = bucketOf(perf, sig, cls);
  if (!b) return { skip: false, why: 'نوع جديد ⇒ مفيش تاريخ' };
  const gref = b.pGlobalCls ?? perf.pGlobal;
  if (b.blocked) return { skip: true, why: `التعلّم: النوع ده ضعيف (نسبة نجاح ${(b.pWin * 100).toFixed(0)}% مقابل ${(gref * 100).toFixed(0)}% عند ${b.n} عينة)` };
  return { skip: false, why: `التعلّم: النوع ده مقبول (${(b.pWin * 100).toFixed(0)}% · ${b.n} عينة${via === 'M' ? ' · من الكسور الأوسع' : ''})` };
}

/** Rank candidates: learning first, then the hard RR gate as the tie-break. */
export function rankCandidates(cands, perf, gradeOrder = []) {
  const gi = (g) => { const i = gradeOrder.indexOf(g); return i < 0 ? 99 : i; };
  const pOf = (c) => {
    const { b } = bucketOf(perf, c.sig, c.cls || 'A');
    return b ? b.pWin : perf.pGlobal;
  };
  return [...cands].sort((a, b) => {
    const dg = gi(a.grade) - gi(b.grade);          // the hard grade always dominates
    if (dg) return dg;
    const d = pOf(b) - pOf(a);                       // then what history says about the type
    if (Math.abs(d) > 0.005) return d;
    return (b.blended ?? 0) - (a.blended ?? 0);     // then the RR
  });
}
