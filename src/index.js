// index.js — the live service: poll spot -> build bars -> run the gate -> Telegram alert.
// Runs 24/7 but only opens entries inside the session window and outside news blackouts.

import fs from 'fs';
import path from 'path';
import { BarBuilder, fetchSpot, fetchTV, fetchMacro, fetchCalendar, localNow, toMin, dayStartUtc } from './market.js';
import { analyze, newsBlackout } from './strategy.js';
import { sendMessage, sendVoice, getUpdates, formatAlert, formatWatch, formatMap, formatSummary, formatTradeUpdate, formatStatus, formatLevels } from './telegram.js';

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

async function evaluate() {
  const res = analyze(builder, CFG, now());
  if (!res.ok) return;
  const { ctx } = res;
  rolloverDay();
  checkOpenTrades(ctx.price);

  const t = l();
  if (inSession() && !state.morningSent && builder.series(15).length >= 20) {
    state.morningSent = true;
    await notify(formatMap(ctx, mapExtras(ctx)));
    save();            // persist immediately so a restart does NOT resend the map
  }
  if (!state.dailySummarySent && toMin(t.hhmm) >= toMin(CFG.session.endCairo)) {
    state.dailySummarySent = true;
    if (!state.sessionEndAt) state.sessionEndAt = now();   // stamp the session close
    const wins = state.trades.filter((x) => x.state !== 'stopped').length;
    const losses = state.trades.filter((x) => x.state === 'stopped').length;
    // the session's official close = the last M15 that closed inside the session window
    const endAt = dayStartUtc(CFG.session.tz, now()) + toMin(CFG.session.endCairo) * 60000;
    const closed15 = builder.series(15).filter((x) => x.t + 15 * 60000 <= endAt).slice(-1)[0];
    notify(formatSummary(ctx, {
      day: state.day, close: closed15 ? closed15.c : ctx.price,
      trades: state.trades.length, wins, losses,
      r: state.dailyR, rPct: (state.dailyR * CFG.risk.perTradePct).toFixed(2),
    })).catch(() => {});
    save();
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
      notify('\u26d4\u261d\u0648\u0635\u0644\u0646\u0627 \u0644\u062d\u062f \u0627\u0644\u062e\u0633\u0627\u0631\u0629 \u0627\u0644\u064a\u0648\u0645\u064a \u2014 \u0648\u0642\u0641 \u0627\u0644\u062a\u062f\u0627\u0648\u0644 \u0644\u0644\u064a\u0648\u0645');
    }
    return;
  }

  for (const c of res.candidates) {
    const k = keyOf(c);
    if (state.firedKeys[k]) continue;
    if (!CFG.signals.fireGrades.includes(c.grade)) {
      if (CFG.watch.enabled && c.grade === CFG.watchGrade && now() - state.lastWatch > CFG.watch.cooldownMin * 60000) {
        state.lastWatch = now(); state.firedKeys[k] = 1;
        notify(formatWatch(c));
      }
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
load(); rebuild();
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
tick(); evaluate().catch(() => {});
