// bus.js — the link from the engine to the outside world.
//
// The engine lives in a sandbox that nothing can reach, so it cannot be polled. Instead
// it PUSHES to a tiny Worker (the "bus") and the MT5 bridge on the trading machine PULLS
// from there. The bus needs the same shared secret as the bridge.

const BUS_URL = (process.env.BUS_URL || 'https://gold-engine.octashares.com').replace(/\/$/, '');
const TOKEN = process.env.BRIDGE_TOKEN || '';

async function post(path, body, timeoutMs = 15000) {
  if (!TOKEN || !BUS_URL) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${BUS_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return r.ok;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

/** Publish a signal for the bridge to take (one shot). */
export async function pushSignal(sig) { return post('/signal', sig); }

/** Tell the outside that the engine is alive, warm and where it is. */
export async function pushHeartbeat(state) { return post('/heartbeat', state); }

/** The real account the bridge is connected to (balance, currency, symbol). */
export async function pullAccount() {
  if (!TOKEN || !BUS_URL) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(`${BUS_URL}/account`, {
      headers: { Authorization: `Bearer ${TOKEN}` }, signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    const j = await r.json();
    return (j && j.login != null) ? j : null;
  } catch { return null; }
}
