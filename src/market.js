// market.js — data layer. Spot only (never Yahoo GC=F: distorted futures premium).
// Bars are built from tick mid-price so every level comes from the same instrument.

const SWISSQUOTE = 'https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD';
const GOLD_API = 'https://api.gold-api.com/price/XAU';
const TV_SCAN = 'https://scanner.tradingview.com/cfd/scan';
const CALENDAR = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/';

const UA = 'Mozilla/5.0 (compatible; gold-signal-bot/1.0)';

async function jget(url, init = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, ...init });
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

/** Live spot. Swissquote BBO first (tightest, exchange-grade), gold-api as fallback. */
export async function fetchSpot() {
  try {
    const d = await jget(SWISSQUOTE);
    const p = d[0].spreadProfilePrices[0];
    const bid = +p.bid, ask = +p.ask;
    return { bid, ask, mid: (bid + ask) / 2, src: 'swissquote', ts: Date.now() };
  } catch (e) {
    const d = await jget(GOLD_API);
    const px = +d.price;
    return { bid: px, ask: px, mid: px, src: 'gold-api', ts: Date.now() };
  }
}

/** TradingView spot indicators (OANDA:XAUUSD). */
export async function fetchTV() {
  const cols = ['close', 'Recommend.All|60', 'Recommend.All|15', 'Recommend.All|5',
    'RSI|60', 'RSI|15', 'ATR|60', 'ATR|15', 'ATR|5',
    'EMA50|60', 'EMA200|60', 'EMA50|15', 'EMA200|15', 'EMA50|5', 'EMA200|5'];
  const body = JSON.stringify({ symbols: { tickers: ['OANDA:XAUUSD'], query: { types: [] } }, columns: cols });
  const d = await jget(TV_SCAN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body,
  });
  const vals = d.data[0].d;
  const o = {};
  cols.forEach((c, i) => { o[c] = vals[i]; });
  return o;
}

/** DXY + US10Y. Intraday series may be null -> caller must handle. */
export async function fetchMacro() {
  const out = { dxy: null, tnx: null };
  try {
    const d = await jget(`${YAHOO}DX-Y.NYB?interval=5m&range=1d`);
    const cl = d.chart.result[0].indicators.quote[0].close.filter((x) => x != null);
    out.dxy = cl.length ? cl[cl.length - 1] : null;
  } catch {}
  try {
    const d = await jget(`${YAHOO}%5ETNX?interval=5m&range=1d`);
    const cl = d.chart.result[0].indicators.quote[0].close.filter((x) => x != null);
    out.tnx = cl.length ? cl[cl.length - 1] : null;
  } catch {}
  return out;
}

/** ForexFactory week calendar. */
export async function fetchCalendar() {
  return jget(CALENDAR);
}

// ---------------------------------------------------------------- bars

export class BarBuilder {
  constructor() { this.bars = new Map(); } // 'YYYY-MM-DDTHH:mm' -> {t,o,h,l,c}
  push(epochMs, price) {
    const d = new Date(epochMs);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}T${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const b = this.bars.get(key);
    if (!b) this.bars.set(key, { t: d.getTime(), o: price, h: price, l: price, c: price, n: 1 });
    else { b.h = Math.max(b.h, price); b.l = Math.min(b.l, price); b.c = price; b.n++; }
  }
  /** aggregate the 1m bars into tf-minute bars */
  series(tf) {
    const out = [];
    let cur = null, curKey = null;
    for (const b of [...this.bars.values()].sort((a, c) => a.t - c.t)) {
      const k = Math.floor(b.t / (tf * 60000));
      if (k !== curKey) { curKey = k; cur = { t: k * tf * 60000, o: b.o, h: b.h, l: b.l, c: b.c }; out.push(cur); }
      else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; }
    }
    return out;
  }
  prune(maxBars = 4000) {
    const keys = [...this.bars.keys()];
    if (keys.length > maxBars) for (const k of keys.slice(0, keys.length - maxBars)) this.bars.delete(k);
  }
}

// ---------------------------------------------------------------- indicators

export function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function rsi(values, period = 14) {
  if (values.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}

export function atr(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)));
  }
  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

// ---------------------------------------------------------------- time

/** Local time in an IANA zone, e.g. cairoNow() -> {h,m,hhmm,date} */
export function localNow(tz, now = new Date()) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).reduce((a, x) => (a[x.type] = x.value, a), {});
  const hhmm = `${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
  return { hhmm, h: +p.hour % 24, m: +p.minute, date: `${p.year}-${p.month}-${p.day}`, sec: +p.second };
}

export const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** UTC ms of the most recent midnight in an IANA zone (so "today" is the local day). */
export function dayStartUtc(tz, now = Date.now()) {
  const l = localNow(tz, new Date(now));
  const [Y, M, D] = l.date.split('-').map(Number);
  const wallNow = Date.UTC(Y, M - 1, D, l.h, l.m, l.sec);   // local wall clock as if it were UTC
  const offset = wallNow - now;                            // zone offset in ms
  return Date.UTC(Y, M - 1, D, 0, 0, 0) - offset;          // the UTC instant of local midnight
}
