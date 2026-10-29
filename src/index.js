// index.js — the live service: poll spot -> build bars -> run the gate -> Telegram alert.
// Runs 24/7 but only opens entries inside the session window and outside news blackouts.

import fs from 'fs';
import path from 'path';
import { BarBuilder, fetchSpot, fetchTV, fetchMacro, fetchCalendar, localNow, toMin, dayStartUtc, atrSeries } from './market.js';
import { analyze, newsBlackout } from './strategy.js';
import { sendMessage, sendVoice, getUpdates, formatAlert, formatWatch, formatMap, formatSummary, formatTradeUpdate, formatStatus, formatLevels } from './telegram.js';
import { appendJsonl, readJsonl, evaluateOutcome, signature, HORIZON_MIN } from './journal.js';
import { buildPerformance, learningVerdict, rankCandidates } from './performance.js';
import { startApi } from './api.js';

const CFG = JSON.parse(fs.readFileSync(new URL('../config.json', import.meta.url), 'utf8'));
const TOKEN = process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || CFG.telegram.token;
const CHAT = process.env.TELEGRAM_CHAT_ID || CFG.telegram.chatId;
const STATE_FILE = process.env.STATE_FILE || path.join(process.cwd(), 'state.json');
const HISTORY_FILE = process.env.HISTORY_FILE || path.join(process.cwd(), 'history.json');

// ---------------------------------------------------------------- state
const state = {
  bars: {}, trades: [], day: null, dailyR: 0, firedKeys: {},
  lastWatch: 0, dailySummarySent: false, morningSent: false, lastUpdateId: 0,
};

function load() {
  try { Object.assign(state, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch {}
  try {
    const h = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    for (const [k, v] of Object.entries(h.bars || {})) state.bars[k] = v;
  } catch {}
}
function save() {
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    trades: state.trades, day: state.day, dailyR: state.dailyR,
    firedKeys: state.firedKeys, dailySummarySent: state.dailySummarySent,
    morningSent: state.morningSent, lastUpdateId: state.lastUpdateId || 0,
  }));
  const keys = Object.keys(state.bars).sort();
  const keep = {};
  for (const k of keys.slice(-8000)) keep[k] = state.bars[k];
  fs.writeFileSync(HISTORY_FILE, JSON.stringify({ bars: keep }));
}

const builder = new BarBuilder();
function rebuild() {
  for (const [k, v] of Object.entries(state.bars)) {
    const [d, t] = k.split('T');
    const [Y, M, D] = d.split('-').map(Number);
    const [h, m] = t.split(':').map(Number);
    builder.push(Date.UTC(Y, M - 1, D, h, m), v.c);
    builder.push(Date.UTC(Y, M - 1, D, h, m) + 59000, v.c);
  }
}

// ---------------------------------------------------------------- helpers
const now = () => Date.now();
const l = () => localNow(CFG.session.tz);
function inSession() {
  const t = l();
  const m = toMin(t.hhmm);
  return m >= toMin(CFG.session.startCairo) && m <= toMin(CFG.session.endCairo);
}
function rolloverDay() {
  const d = l().date;
  if (state.day !== d) {
    state.day = d; state.trades = []; state.dailyR = 0; state.firedKeys = {};
    state.dailySummarySent = false; state.morningSent = false; state.dayStopped = false; state.sessionEndAt = 0;
    console.log(`[day] ${d} — counters reset`);
  }
}
const keyOf = (c) => `${c.dir}|${c.mssLevel.toFixed(1)}`;   // one alert per broken level per day

// ---------------------------------------------------------------- messaging
async function notify(text) {
  console.log(`[tg] ${text.replace(/\n/g, ' | ')}`);
  if (!TOKEN || !CHAT) return;
  try { await sendMessage(TOKEN, CHAT, text); }
  catch (e) { console.error('[tg] send failed:', e.message); }
}
async function notifyVoice(text, fileUrl) {
  if (!TOKEN || !CHAT || !fileUrl) return;
  try { await sendVoice(TOKEN, CHAT, fileUrl, text); }
  catch (e) { console.error('[tg] voice failed:', e.message); }
}

function mapExtras(ctx) {
  const key = (CFG.keyLevels || []).filter((k) => Math.abs(k - ctx.price) < 40)
    .sort((a, b) => Math.abs(a - ctx.price) - Math.abs(b - ctx.price))[0];
  return {
    date: state.day || l().date,
    keyLine: key ? `${key.toFixed(1)} — خط سيولة رئيسي، لو اتكسر فوقه/تحته تتحرك` : '',
    triggers: `قفل تحت ${ctx.dayLow.toFixed(1)} → شورت\nقفل فوق ${ctx.dayHigh.toFixed(1)} → لونج`,
  };
}

// ---------------------------------------------------------------- learning engine
// Every candidate (fired OR skipped) is journalled with a uniform counterfactual outcome.
// The learning may only REMOVE setups that are demonstrably worse than average; it never
// touches the hard rules (0.5% risk, 1.5% daily cap, 2:1 floor, blackout, no stacking).
const JOURNAL_FILE = process.env.JOURNAL_FILE || path.join(process.cwd(), 'journal.jsonl');
const OUTCOMES_FILE = process.env.OUTCOMES_FILE || path.join(process.cwd(), 'outcomes.jsonl');
const LC = { ...(CFG.learning || {}) };
let perf = { pGlobal: LC.priorP ?? 0.4, n: 0, rawN: 0, buckets: [], opts: LC };
const journalSeen = new Set();
let pendingSignal = null;      // the next signal the bridge may take (published once)
let killed = false;             // the /kill switch
let lastResolve = 0, lastPerf = 0;

const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const atr15Median = () => median(atrSeries(builder.series(15), 14).slice(-30));
const nearestKeyDist = (entry, levels, atr) => {
  if (!levels?.length || !atr) return 99;
  let best = 99;
  for (const l of levels) best = Math.min(best, Math.abs(l - entry) / atr);
  return +best.toFixed(2);
};

function refreshPerf() {
  if (!LC.enabled) return;
  perf = buildPerformance(readJsonl(OUTCOMES_FILE), now(), LC);
  lastPerf = now();
}
function loadLearning() {
  if (!LC.enabled) return;
  for (const r of readJsonl(JOURNAL_FILE)) journalSeen.add(r.id);
  refreshPerf();
  console.log(`[learn] journal=${journalSeen.size} resolved=${perf.rawN} pGlobal=${perf.pGlobal}`);
}
/** Judge every journalled event that is old enough, then rebuild the table. */
function resolveOutcomes() {
  if (!LC.enabled) return;
  const bars1 = builder.series(1);
  const done = new Set(readJsonl(OUTCOMES_FILE).map((r) => r.id));
  const evs = readJsonl(JOURNAL_FILE);
  let added = 0;
  for (const ev of evs) {
    if (done.has(ev.id)) continue;
    if (now() < ev.ts + (LC.horizonMin ?? HORIZON_MIN) * 60000) continue;   // not old enough
    const r = evaluateOutcome(ev, bars1, { horizonMin: LC.horizonMin, targetR: LC.targetR });
    if (r) { appendJsonl(OUTCOMES_FILE, r); added++; }
  }
  if (added) refreshPerf();
  lastResolve = now();
}

/** Journal a candidate so history can be learned from (fired or skipped, both count). */
function journalCandidate(c, cls) {
  if (!LC.enabled) return;
  const isStruct = cls === 'M';
  const sid = isStruct
    ? `M-${c.dir}-${c.mssLevel.toFixed(1)}-${c.ts}`
    : `${c.dir}-${c.mssLevel.toFixed(1)}-${c.entry.toFixed(2)}`;
  if (journalSeen.has(sid)) return;
  const keyDist = nearestKeyDist(c.entry, CFG.keyLevels || [], c.atr15);
  const cls2 = isStruct ? 'M' : (c.grade === 'A' || c.grade === 'A+' ? 'A' : (c.grade || 'C'));
  const ev = {
    id: sid, dir: c.dir, ts: isStruct ? c.ts : now(), entry: c.entry, sl: c.sl,
    tps: c.tps || [], rrs: c.rrs || [], grade: c.grade || 'M', cls: cls2,
    sweep: !!c.sweep, bias: c.bias, atr5: c.atr5, atr15: c.atr15,
    mssLevel: c.mssLevel, blended: c.blended, keyDist,
    sig: signature({ ...c, ts: isStruct ? c.ts : now(), keyDist }, { atr15Med: atr15Median() }),
  };
  journalSeen.add(sid);
  appendJsonl(JOURNAL_FILE, ev);
  c.sig = ev.sig; c.cls = cls2;
}

// ---------------------------------------------------------------- trade tracking
function checkOpenTrades(price) {
  const money = CFG.risk.accountUsd * (CFG.risk.perTradePct / 100);
  for (const t of state.trades) {
    if (t.state === 'closed' || t.state === 'stopped') continue;
    const hitTp = (lvl) => (t.dir === 'long' ? price >= lvl : price <= lvl);
    const hitSl = () => (t.dir === 'long' ? price <= t.sl : price >= t.sl);
    if (!t.tp1Done && hitTp(t.tps[0])) {
      t.tp1Done = true; t.state = 'tp1';
      state.dailyR += t.rrs[0] / 3;
      notify(formatTradeUpdate(t, 'tp1', { r: t.rrs[0] / 3, money: (t.rrs[0] / 3) * money }));
    } else if (!t.tp2Done && t.tp1Done && hitTp(t.tps[1])) {
      t.tp2Done = true; t.state = 'tp2';
      state.dailyR += t.rrs[1] / 3;
      notify(formatTradeUpdate(t, 'tp2', { r: t.rrs[1] / 3, money: (t.rrs[1] / 3) * money }));
    } else if (!t.tp3Done && t.tp2Done && hitTp(t.tps[2])) {
      t.tp3Done = true; t.state = 'closed';
      state.dailyR += t.rrs[2] / 3;
      notify(formatTradeUpdate(t, 'tp3', { r: t.rrs[2] / 3, money: (t.rrs[2] / 3) * money }));
    } else if (hitSl()) {
      t.state = 'stopped';
      state.dailyR -= 1;
      notify(formatTradeUpdate(t, 'stopped', { r: -1, money: -money }));
    }
  }
}

// ---------------------------------------------------------------- main loop
let calCache = { at: 0, list: [] };
async function getCalendar() {
  if (Date.now() - calCache.at > 5 * 60000) {
    try { calCache = { at: Date.now(), list: await fetchCalendar() }; } catch {}
  }
  return calCache.list;
}

/** The session stats from the bars themselves (the summary must not depend on the
 *  engine having enough bars to run the gate). */
function sessionStats() {
  const endAt = dayStartUtc(CFG.session.tz, now()) + toMin(CFG.session.endCairo) * 60000;
  const startAt = dayStartUtc(CFG.session.tz, now());
  const bars = builder.series(1).filter((b) => b.t >= startAt && b.t < endAt);
  const closed15 = builder.series(15).filter((b) => b.t + 15 * 60000 <= endAt).slice(-1)[0];
  const live = builder.series(1).slice(-1)[0];
  return {
    close: closed15 ? closed15.c : (live ? live.c : null),
    dayHigh: bars.length ? Math.max(...bars.map((b) => b.h)) : null,
    dayLow: bars.length ? Math.min(...bars.map((b) => b.l)) : null,
  };
}

async function evaluate() {
  rolloverDay();
  const st0 = sessionStats();
  // the daily summary goes out regardless of the gate's state
  if (!state.dailySummarySent && toMin(l().hhmm) >= toMin(CFG.session.endCairo)) {
    state.dailySummarySent = true;
    save();            // persist the flag BEFORE sending: a restart can never re-send it
    if (!state.sessionEndAt) state.sessionEndAt = now();
    const wins = state.trades.filter((x) => x.state !== 'stopped').length;
    const losses = state.trades.filter((x) => x.state === 'stopped').length;
    notify(formatSummary({ price: st0.close, dayHigh: st0.dayHigh, dayLow: st0.dayLow }, {
      day: state.day, close: st0.close,
      trades: state.trades.length, wins, losses,
      r: state.dailyR, rPct: (state.dailyR * CFG.risk.perTradePct).toFixed(2),
    })).catch(() => {});
  }
  const res = analyze(builder, CFG, now());
  if (!res.ok) return;
  const { ctx } = res;
  checkOpenTrades(ctx.price);

  // journal EVERY structure first (history is the learning's raw material) — this happens
  // OUTSIDE the session and outside blackouts too: the journal is for learning, not for trading
  for (const c of (res.events || res.candidates)) journalCandidate(c, null);
  for (const st of (res.structures || [])) journalCandidate(st, 'M');

  const t = l();
  if (inSession() && !state.morningSent && builder.series(15).length >= 20) {
    state.morningSent = true;
    await notify(formatMap(ctx, mapExtras(ctx)));
    save();            // persist immediately so a restart does NOT resend the map
  }
  const cal = await getCalendar();
  const nb = newsBlackout(cal, now(), CFG);
  if (nb.blocked) return;

  const open = state.trades.find((t) => t.state === 'open' || t.state === 'tp1' || t.state === 'tp2');
  if (open) return;
  if (!inSession()) return;
  if (state.trades.length >= CFG.risk.maxTradesPerDay) return;
  // daily loss cap: 1.5% of the account (0.5% per trade) => 3 losing R => STOP FOR TODAY
  const capR = -(CFG.risk.dailyLossCapPct / CFG.risk.perTradePct);
  if (state.dailyR <= capR) {
    if (!state.dayStopped) {
      state.dayStopped = true; save();
      notify('⛔ وصلنا لحد الخسارة اليومي (1.5%) — وقف التداول لليوم');
    }
    return;
  }

  const ranked = rankCandidates(res.candidates, perf, CFG.signals.fireGrades);
  for (const c of ranked) {
    const k = keyOf(c);
    if (state.firedKeys[k]) continue;
    if (!CFG.signals.fireGrades.includes(c.grade)) {
      if (CFG.watch.enabled && c.grade === CFG.watchGrade && now() - state.lastWatch > CFG.watch.cooldownMin * 60000) {
        state.lastWatch = now(); state.firedKeys[k] = 1;
        notify(formatWatch(c));
      }
      continue;
    }
    // SOFT GATE (the learning): a setup type that is demonstrably worse than average
    // gets skipped. It can never loosen anything — it only removes.
    const verdict = learningVerdict(perf, c.sig, c.cls || 'A');
    if (killed) { console.log('[kill] engine stopped — no signals published'); break; }
    if (verdict.skip) {
      console.log(`[learn] skipped ${c.dir} ${c.entry.toFixed(2)} — ${verdict.why}`);
      continue;
    }
    state.firedKeys[k] = 1;
    const id = `${c.dir === 'long' ? 'شراء' : 'sell'} ${state.day} ${c.entry.toFixed(1)}`;
    state.trades.push({
      id, dir: c.dir, grade: c.grade, entry: c.entry, sl: c.sl, tps: c.tps, rrs: c.rrs,
      state: 'open', tp1Done: false, tp2Done: false, tp3Done: false, t: now(),
    });
    const news = cal.filter((e) => e.impact === 'High' && e.date &&
      Math.abs(new Date(e.date).getTime() - now()) < 3 * 3600e3)
      .map((e) => `${e.title} ${new Date(e.date).toISOString().slice(11, 16)}Z`).join(' · ');
    pendingSignal = {
      id, dir: c.dir, grade: c.grade, entry: c.entry, sl: c.sl, tps: c.tps, rrs: c.rrs,
      risk: Math.abs(c.entry - c.sl), blended: c.blended, mssLevel: c.mssLevel,
      ts: now(), expiresTs: now() + 120000, symbol: CFG.bridge?.symbol || 'XAUUSD',
    };
    await notify(formatAlert(c, {
      accountUsd: CFG.risk.accountUsd, riskPct: CFG.risk.perTradePct,
      timeText: `${t.hhmm} القاهرة`,
      setupText: c.sweep ? `سحب سيولة فوق ${c.mssLevel.toFixed(1)} + كسر + رجوع` : `كسر ${c.mssLevel.toFixed(1)} ورجوع للمنطقة`,
      newsText: news || '',
    }));
    break;
  }
}

// ---------------------------------------------------------------- commands
async function commands() {
  if (!TOKEN) return;
  try {
    const ups = await getUpdates(TOKEN, (state.lastUpdateId || 0) + 1);
    for (const u of ups) {
      state.lastUpdateId = Math.max(state.lastUpdateId || 0, u.update_id);   // never replay
      const txt = (u.message?.text || '').split(' ')[0].toLowerCase();
      const res = analyze(builder, CFG, now());
      const ctx = res.ok ? res.ctx : null;
      if (txt === '/ping') await notify('🏓 شغال');
      else if (txt === '/start' || txt === '/help') {
        await notify([
          '👋 <b>Gold Scout</b> — شغال.',
          ctx ? `💰 ${ctx.price.toFixed(1)} · الاتجاه ${ctx.bias === 'BULLISH' ? 'صاعد' : ctx.bias === 'BEARISH' ? 'هابط' : 'محايد'}` : '⏳ لسه بيسخّن',
          'هنبهرك بس لما تطلع صفقة A أو A+ (مش أي حاجة).',
          'الأوامر: /status · /levels · /ping',
        ].join('\n'));
      } else if (txt === '/status' && ctx) {
        await notify(formatStatus(ctx, { trades: state.trades.length, r: state.dailyR, time: `${l().hhmm} القاهرة` }));
      } else if (txt === '/levels' && ctx) {
        await notify(formatLevels(ctx));
      }
    }
  } catch {}
}

// ---------------------------------------------------------------- boot
load(); rebuild(); loadLearning();
// optional backfill: TICK_SEED=/path/ticks.csv (csv: ts,bid,ask with ts in SECONDS)
const seed = process.env.TICK_SEED;
if (seed && fs.existsSync(seed)) {
  let n = 0;
  for (const line of fs.readFileSync(seed, 'utf8').split('\n').slice(1)) {
    const p = line.split(',');
    if (p.length === 3) {
      const ts = +p[0] * 1000, bid = +p[1], ask = +p[2];
      if (Number.isFinite(ts) && Number.isFinite(bid)) { builder.push(ts, (bid + ask) / 2); n++; }
    }
  }
  console.log(`[boot] seeded ${n} ticks from ${seed}`);
}
console.log(`[boot] m15=${builder.series(15).length} token=${TOKEN ? 'yes' : 'NO'} chat=${CHAT || 'NO'}`);

async function tick() {
  try {
    const s = await fetchSpot();
    builder.push(now(), s.mid);
    builder.prune(9000);
    const d = new Date(now());
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const arr = builder.series(1);
    const last = arr[arr.length - 1];
    if (last) state.bars[key] = { t: last.t, o: last.o, h: last.h, l: last.l, c: last.c };
  } catch (e) { console.error('[tick]', e.message); }
}

setInterval(tick, CFG.poll.tickSeconds * 1000);
setInterval(() => { evaluate().catch((e) => console.error('[eval]', e.message)); }, CFG.poll.evalSeconds * 1000);
setInterval(() => { save(); }, 60000);
setInterval(() => { commands(); }, 15000);
if (process.env.BRIDGE_TOKEN) {
  startApi({
    port: +(process.env.PORT || 8080),
    token: process.env.BRIDGE_TOKEN,
    getState: () => ({
      price: ctxPrice(), bias: lastBias(), trades: state.trades.length, dailyR: state.dailyR,
      day: state.day, killed, pendingSignal: pendingSignal ? pendingSignal.id : null,
    }),
    getSignal: () => {
      if (killed) return null;
      if (!pendingSignal) return null;
      if (pendingSignal.expiresTs < Date.now()) { pendingSignal = null; return null; }
      const s = pendingSignal; pendingSignal = null;   // one shot: the bridge takes it or it expires
      return s;
    },
    getPerf: () => perf,
    onKill: async () => { killed = true; await notify('⛔ إيقاف التداول — المحرك متوقف والأوامر الجديدة مرفوضة'); },
  });
}
function ctxPrice() { try { const a = analyze(builder, CFG, now()); return a.ok ? a.ctx.price : null; } catch { return null; } }
function lastBias() { try { const a = analyze(builder, CFG, now()); return a.ok ? a.ctx.bias : null; } catch { return null; } }
setTimeout(() => { try { resolveOutcomes(); } catch (e) { console.error('[learn]', e.message); } }, 60 * 1000);  // resolve the backlog at boot
setInterval(() => { resolveOutcomes(); }, 10 * 60000);          // judge old events
setInterval(() => { if (now() - lastPerf > (LC.refreshMin ?? 30) * 60000) refreshPerf(); }, 5 * 60000);
tick(); evaluate().catch(() => {});
