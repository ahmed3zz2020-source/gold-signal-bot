// api.js — a tiny HTTP endpoint the MT5 bridge polls (pull model: the VPS asks,
// the engine never pushes, so no trading port is exposed to the internet).
//
//   GET  /next-signal   -> the next A/A+ signal (Bearer BRIDGE_TOKEN) or 204
//   GET  /health        -> { ok, price, bias, trades, dailyR, learning }
//   GET  /performance   -> the learning table (read-only, for transparency)
//   POST /kill          -> stop publishing signals (Bearer BRIDGE_TOKEN)

import http from 'http';
import { buildPerformance, learningVerdict } from './performance.js';
import { readJsonl } from './journal.js';

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
};
const authed = (req, token) => {
  if (!token) return false;
  const h = req.headers.authorization || '';
  return h === `Bearer ${token}` || h === token;
};

export function startApi({ port, token, getState, getSignal, getPerf, onKill }) {
  const server = http.createServer(async (req, res) => {
    const url = (req.url || '').split('?')[0];
    try {
      if (url === '/health') {
        const s = getState();
        return json(res, 200, { ok: true, ts: Date.now(), ...s });
      }
      if (url === '/performance') {
        const perf = getPerf ? getPerf() : buildPerformance([], Date.now());
        return json(res, 200, {
          pGlobal: perf.pGlobal, classes: perf.classes,
          buckets: perf.buckets.map((b) => ({ sig: b.sig, cls: b.cls, n: b.n, days: b.days, pWin: b.pWin, expR: b.expR, blocked: b.blocked })),
        });
      }
      if (url === '/next-signal') {
        if (!authed(req, token)) return json(res, 401, { error: 'unauthorized' });
        const sig = getSignal();
        if (!sig) return json(res, 204, {});
        return json(res, 200, sig);
      }
      if (url === '/kill' && req.method === 'POST') {
        if (!authed(req, token)) return json(res, 401, { error: 'unauthorized' });
        if (onKill) await onKill();
        return json(res, 200, { ok: true, killed: true });
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, 500, { error: String(e && e.message || e) });
    }
  });
  server.listen(port, '0.0.0.0', () => console.log(`[api] listening on :${port}`));
  return server;
}
