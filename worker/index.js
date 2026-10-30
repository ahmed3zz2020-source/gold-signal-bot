// gold-engine bus — the one small relay between the signal engine and the MT5 bridge.
//
// The engine runs in a sandbox that nothing can reach, so it PUSHES a signal here and
// the bridge on the trading machine PULLS it. The Worker is the meeting point that
// lives outside both. Everything except the signal itself needs the Bearer token.

const jsonHeaders = () => ({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: jsonHeaders() });

/** KV get that never throws: a missing key is null, not an exception. */
async function kvGetJson(env, key) {
  let raw = null;
  try { raw = await env.BUS.get(key); } catch { return null; }
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      const auth = req.headers.get('authorization') || '';
      if (!env.BRIDGE_TOKEN || !(auth === `Bearer ${env.BRIDGE_TOKEN}` || auth === env.BRIDGE_TOKEN)) {
        return json({ error: 'unauthorized' }, 401);
      }
      // the bridge asks for the next signal — one shot: it is deleted once it is taken
      if (url.pathname === '/next-signal' && req.method === 'GET') {
        const sig = await kvGetJson(env, 'pending');
        if (!sig) return new Response(null, { status: 204, headers: jsonHeaders() });  // 204 takes no body
        try { await env.BUS.delete('pending'); } catch {}
        return json(sig, 200);
      }
      // the engine pushes a signal
      if (url.pathname === '/signal' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        if (!body || !body.id || !body.dir || !body.entry || !body.sl) return json({ error: 'bad signal' }, 400);
        await env.BUS.put('pending', JSON.stringify(body), { expirationTtl: 180 });
        return json({ ok: true });
      }
      // the engine's heartbeat, so the outside can see whether it is alive and warm
      if (url.pathname === '/heartbeat' && req.method === 'POST') {
        const body = await req.json().catch(() => ({}));
        await env.BUS.put('engine-status', JSON.stringify(body), { expirationTtl: 300 });
        return json({ ok: true });
      }
      // the bridge reports the real account (balance, currency, symbol) so the engine
      // never has to guess the account size - it only displays the money.
      if (url.pathname === '/account' && req.method === 'POST') {
        const body = await req.json().catch(() => null);
        if (!body || body.login == null) return json({ error: 'bad account' }, 400);
        await env.BUS.put('account', JSON.stringify(body), { expirationTtl: 86400 });
        return json({ ok: true });
      }
      if (url.pathname === '/account' && req.method === 'GET') {
        const a = await kvGetJson(env, 'account');
        return json(a || { ok: false, note: 'the bridge has not reported yet' });
      }
      if (url.pathname === '/status' && req.method === 'GET') {
        const st = await kvGetJson(env, 'engine-status');
        return json(st || { ok: false, note: 'no heartbeat yet' });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: 'worker exception', message: String((e && e.message) || e) }, 500);
    }
  },
};
