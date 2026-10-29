// learn-test.js — tests for the learning engine (the journal + the performance table).
// Run: node src/learn-test.js   ->  ALL CHECKS PASSED

import { evaluateOutcome, signature, phaseOf, eventId } from './journal.js';
import { buildPerformance, learningVerdict, rankCandidates } from './performance.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { console.log(`PASS  ${name}`); pass++; }
  else { console.log(`FAIL  ${name} ${extra}`); fail++; }
};

const MIN = 60_000;
/** n records of one result, spread over `days` different days (the multi-day guard). */
const mk = (n, days, result, sig = 'k', cls = 'A') => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ sig, cls, result, ts: Date.now() - Math.floor(i / days) * 86400000 });
  return out;
};
const bar = (t, o, h, l, c) => ({ t, o, h, l, c });

// ---------------------------------------------------------------- 1. outcome evaluator
{
  const ev = { dir: 'long', ts: 1000, entry: 4000, sl: 3995, sig: 'x', bias: 'MIXED', atr15: 8 };
  const up = [bar(2 * MIN, 4000, 4008, 3999, 4006), bar(3 * MIN, 4006, 4012, 4005, 4010)];
  const r = evaluateOutcome(ev, up);
  ok('evaluator: +2R before -1R => win', r.result === 'win' && r.r === 2, JSON.stringify(r));
  ok('evaluator: MFE measured', r.mfe >= 2, JSON.stringify(r));
}
{
  const ev = { dir: 'long', ts: 1000, entry: 4000, sl: 3995, sig: 'x' };
  const down = [bar(2 * MIN, 4000, 4001, 3992, 3994)];
  const r = evaluateOutcome(ev, down);
  ok('evaluator: -1R first => loss', r.result === 'loss' && r.r === -1, JSON.stringify(r));
}
{
  const ev = { dir: 'long', ts: 1000, entry: 4000, sl: 3995, sig: 'x' };
  const tie = [bar(2 * MIN, 4000, 4012, 3994, 4000)];       // one bar holds both extremes
  const r = evaluateOutcome(ev, tie);
  ok('evaluator: a bar with both extremes counts as a LOSS (conservative)', r.result === 'loss', JSON.stringify(r));
}
{
  const ev = { dir: 'long', ts: 1000, entry: 4000, sl: 3995, sig: 'x' };
  const flat = [bar(2 * MIN, 4000, 4002, 3998, 4000)];
  const r = evaluateOutcome(ev, flat);
  ok('evaluator: nothing happens => timeout, r = 0', r.result === 'timeout' && r.r === 0, JSON.stringify(r));
}
{
  const ev = { dir: 'long', ts: 1000, entry: 4000, sl: 3995, sig: 'x' };
  ok('evaluator: no bars yet => not resolved (null)', evaluateOutcome(ev, []) === null);
}
{
  const ev = { dir: 'short', ts: 1000, entry: 4000, sl: 4005, sig: 'x' };
  const down = [bar(2 * MIN, 4000, 4001, 3990, 3992)];
  const r = evaluateOutcome(ev, down);
  ok('evaluator: a short down to -2R => win', r.result === 'win', JSON.stringify(r));
}

// ---------------------------------------------------------------- 2. shrinkage
{
  const now = Date.now();
  const two = [
    { sig: 'a', cls: 'A', ts: now, result: 'win' }, { sig: 'a', cls: 'A', ts: now, result: 'win' },
  ];
  const p = buildPerformance(two, now);
  const b = p.buckets.find((x) => x.sig === 'a');
  ok('shrinkage: 2 wins out of 2 is NOT a 100% edge', b.pWin < 0.75 && b.pWin > 0.3, `pWin=${b.pWin}`);
  ok('shrinkage: the global prior keeps an empty sample space sane', p.pGlobal > 0.25 && p.pGlobal < 0.75, `pGlobal=${p.pGlobal}`);
}
{
  const now = Date.now();
  const thirty = Array.from({ length: 30 }, (_, i) => ({ sig: 'a', cls: 'A', ts: now, result: 'win' }));
  const p = buildPerformance(thirty, now);
  const b = p.buckets.find((x) => x.sig === 'a');
  ok('shrinkage: even 30/30 stays below certainty', b.pWin < 0.9, `pWin=${b.pWin}`);
}

// ---------------------------------------------------------------- 3. the gate
{
  const now = Date.now();
  const few = Array.from({ length: 5 }, () => ({ sig: 'weak', cls: 'A', ts: now, result: 'loss' }));
  const p = buildPerformance(few, now);
  const v = learningVerdict(p, 'weak');
  ok('gate: a bucket with too few samples is NOT blocked', v.skip === false, v.why);
}
{
  const now = Date.now();
  const mixed = [...mk(20, 3, 'win', 'good'), ...mk(15, 3, 'loss', 'bad')];
  const p = buildPerformance(mixed, now);
  ok('gate: a demonstrably worse bucket IS blocked', learningVerdict(p, 'bad').skip === true, learningVerdict(p, 'bad').why);
  ok('gate: a better bucket is NOT blocked', learningVerdict(p, 'good').skip === false, learningVerdict(p, 'good').why);
  ok('gate: an unseen type is not blocked', learningVerdict(p, 'new').skip === false);
}
{
  // the learning must never REQUIRE a trade: a perfect bucket still allows the hard gate to say no
  const now = Date.now();
  const p = buildPerformance(Array.from({ length: 30 }, () => ({ sig: 'g', cls: 'A', ts: now, result: 'win' })), now);
  ok('gate: learning only removes, it never forces a trade', learningVerdict(p, 'g').skip === false);
}

// ---------------------------------------------------------------- 4. recency decay
{
  const now = Date.now();
  const old = { sig: 'old', cls: 'A', ts: now - 60 * 86400000, result: 'loss' };   // 3 half-lives old
  const fresh = Array.from({ length: 12 }, () => ({ sig: 'new', cls: 'A', ts: now, result: 'win' }));
  const p = buildPerformance([old, ...fresh], now);
  const bOld = p.buckets.find((x) => x.sig === 'old');
  const bNew = p.buckets.find((x) => x.sig === 'new');
  ok('decay: an old sample carries much less weight', bOld.w < 0.2 && bNew.w > 11, `old w=${bOld.w.toFixed(2)} new w=${bNew.w.toFixed(2)}`);
  ok('decay: the recent bucket outranks the old one', bNew.pWin > bOld.pWin);
}

// ---------------------------------------------------------------- 5. signature
{
  const ev = { dir: 'long', ts: Date.UTC(2026, 9, 29, 9, 0), entry: 4000, sl: 3995, sweep: true, bias: 'BULLISH', atr15: 8, keyDist: 0.4, grade: 'A' };
  const s1 = signature(ev, { atr15Med: 8 });
  const s2 = signature({ ...ev, grade: 'A+' }, { atr15Med: 8 });
  ok('signature: A and A+ land in the SAME bucket', s1 === s2, `${s1} vs ${s2}`);
  const s4 = signature({ ...ev, grade: 'C' }, { atr15Med: 8 });
  ok('signature: the grade does NOT split the feature key (the class is a separate dimension)', s1 === s4, `${s1} vs ${s4}`);
  const s3 = signature({ ...ev, sweep: false }, { atr15Med: 8 });
  ok('signature: a sweep changes the bucket', s1 !== s3);
  ok('signature: the London session is its own phase', phaseOf(Date.UTC(2026, 9, 29, 9, 0)) === 'LDN');
  ok('event id is stable', eventId(ev) === eventId({ ...ev }));
}

// ---------------------------------------------------------------- 6. ranking
{
  const now = Date.now();
  const p = buildPerformance([
    ...Array.from({ length: 14 }, () => ({ sig: 'A', cls: 'A', ts: now, result: 'win' })),
    ...Array.from({ length: 14 }, () => ({ sig: 'B', cls: 'A', ts: now, result: 'loss' })),
  ], now);
  const ranked = rankCandidates([{ sig: 'B', blended: 3 }, { sig: 'A', blended: 2.1 }], p);
  ok('ranking: the historically stronger setup comes first', ranked[0].sig === 'A', JSON.stringify(ranked.map((r) => r.sig)));
}

// ---------------------------------------------------------------- 7. per-class buckets + fallback
{
  const now = Date.now();
  const recs = [
    ...Array.from({ length: 14 }, () => ({ sig: 'k', cls: 'M', ts: now, result: 'loss' })),
    ...Array.from({ length: 14 }, () => ({ sig: 'k', cls: 'A', ts: now, result: 'win' })),
  ];
  const p = buildPerformance(recs, now);
  const m = p.buckets.find((x) => x.sig === 'k' && x.cls === 'M');
  const a = p.buckets.find((x) => x.sig === 'k' && x.cls === 'A');
  ok('classes: the same feature key keeps separate buckets per class', !!m && !!a && m !== a);
  ok('classes: each class has its own global', !!p.globals.M && !!p.globals.A && p.globals.M !== p.globals.A, JSON.stringify(p.globals));
}
{
  const now = Date.now();
  const recs = mk(18, 3, 'loss', 'k', 'M');
  const p = buildPerformance(recs, now);
  const v = learningVerdict(p, 'k', 'A');       // the retest population has no samples yet
  ok('fallback: a thin retest population falls back to the wide structure population', v.skip === true, v.why);
}
{
  const now = Date.now();
  const recs = Array.from({ length: 14 }, () => ({ sig: 'k', cls: 'M', ts: now, result: 'win' }));
  const p = buildPerformance(recs, now);
  const v = learningVerdict(p, 'k', 'A');
  ok('fallback: a strong wide population does NOT block', v.skip === false, v.why);
}

// ---------------------------------------------------------------- 8. the class-level block
{
  const now = Date.now();
  const recs = mk(30, 4, 'loss', 'k', 'A');
  const p = buildPerformance(recs, now);
  const v = learningVerdict(p, 'k', 'A');
  ok('class block: a whole losing population stops that class', v.skip === true, v.why);
}
{
  const now = Date.now();
  const recs = Array.from({ length: 14 }, () => ({ sig: 'k', cls: 'A', ts: now, result: 'win' }));
  const p = buildPerformance(recs, now);
  ok('class block: a winning population is not blocked', learningVerdict(p, 'k', 'A').skip === false);
}

// ---------------------------------------------------------------- 9. THE multi-day guarantee
{
  const now = Date.now();
  const oneDay = Array.from({ length: 40 }, () => ({ sig: 'k', cls: 'A', ts: now, result: 'loss' }));
  const p = buildPerformance(oneDay, now);
  ok('multi-day guard: ONE bad day never blocks anything',
    learningVerdict(p, 'k', 'A').skip === false, learningVerdict(p, 'k', 'A').why);
  const oneDayM = Array.from({ length: 40 }, () => ({ sig: 'k', cls: 'M', ts: now, result: 'loss' }));
  const pm = buildPerformance(oneDayM, now);
  ok('multi-day guard: ONE bad day never blocks the wide population either',
    learningVerdict(pm, 'k', 'A').skip === false, learningVerdict(pm, 'k', 'A').why);
  const spreadDays = mk(40, 4, 'loss', 'k', 'A');
  const ps = buildPerformance(spreadDays, now);
  ok('multi-day guard: the same data over 4 days DOES block',
    learningVerdict(ps, 'k', 'A').skip === true, learningVerdict(ps, 'k', 'A').why);
}

console.log(`\n${fail === 0 ? 'ALL CHECKS PASSED' : 'FAILURES: ' + fail}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
