// telegram.js — short, plain-language Arabic alerts. No jargon without a number next to it.

const API = (token) => `https://api.telegram.org/bot${token}`;

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const n = (x, d = 1) => Number(x).toFixed(d);
const dirWord = (dir) => (dir === 'long' ? 'شراء ⬆️' : 'بيع ⬇️');
const dirWord2 = (dir) => (dir === 'long' ? 'لونج' : 'شورت');

export async function sendMessage(token, chatId, text, opts = {}) {
  if (!token || !chatId) throw new Error('telegram token/chatId missing');
  const body = { chat_id: chatId, text, disable_web_page_preview: true };
  if (opts.parse_mode !== false) body.parse_mode = 'HTML';
  const post = async (b) => {
    const r = await fetch(`${API(token)}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
    });
    return r.json();
  };
  let j = await post(body);
  if (!j.ok && body.parse_mode) {                 // HTML rejected -> retry as plain text
    delete body.parse_mode;
    j = await post(body);
  }
  if (!j.ok) throw new Error(`telegram: ${j.description}`);
  return j.result;
}

export async function sendVoice(token, chatId, fileUrl, caption) {
  const r = await fetch(`${API(token)}/sendVoice`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, voice: fileUrl, caption: caption || '' }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`telegram voice: ${j.description}`);
  return j.result;
}

export async function getUpdates(token, offset) {
  const url = `${API(token)}/getUpdates?timeout=0${offset ? `&offset=${offset}` : ''}`;
  const r = await fetch(url);
  const j = await r.json();
  return j.ok ? j.result : [];
}

/** Send a file (the latest project ZIP) so it lands on the user's machine.
 *  This is the "always up to date" channel: no links to open, no guessing. */
export async function sendDocument(token, chatId, filePath, caption) {
  if (!token || !chatId) throw new Error('telegram token/chatId missing');
  const fs = await import('node:fs');
  if (!fs.existsSync(filePath)) throw new Error(`file not found: ${filePath}`);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', caption || '');
  const buf = fs.readFileSync(filePath);
  form.append('document', new Blob([buf]), filePath.split(/[\\/]/).pop());
  const r = await fetch(`${API(token)}/sendDocument`, { method: 'POST', body: form });
  const j = await r.json();
  if (!j.ok) throw new Error(`telegram document: ${j.description}`);
  return j.result;
}

// ---------------------------------------------------------------- messages

/** The trade alert: what to do, in order, with plain numbers. */
export function formatAlert(c, extra = {}) {
  const risk = Math.abs(c.entry - c.sl);
  const lines = [
    `🚨 <b>صفقة ذهب — ${dirWord(c.dir)}</b> · الدرجة <b>${esc(c.grade)}</b>`,
    '',
    `🎯 <b>الدخول:</b> ${n(c.entry)} – ${n(c.entry + (c.dir === 'long' ? 2 : -2))}`,
    `🛑 <b>وقف الخسارة:</b> ${n(c.sl)}`,
    `💰 <b>المخاطرة:</b> ${n(risk)} نقطة = ${extra.riskPct ?? 0.5}% من الحساب`,
    '',
    '<b>🎯 الأهداف</b>',
  ];
  const marks = ['1️⃣', '2️⃣', '3️⃣'];
  c.tps.forEach((t, i) => {
    const gain = c.dir === 'long' ? t - c.entry : c.entry - t;
    lines.push(`${marks[i] || '•'} ${n(t)}  →  +${n(gain)} نقطة${i === 1 ? '  ← الأساس' : ''}`);
  });
  lines.push(
    '',
    `<b>📊 العائد لكل مخاطرة:</b> ${c.rrs.map((r) => n(r, 1)).join(' · ')}`,
    '',
    `📌 <b>السبب:</b> ${extra.setupText || `كسر ${n(c.mssLevel)} ورجوع للمنطقة`}`,
    `❌ <b>الإبطال:</b> ${extra.invalidText || `قفل شمعة 15 دقيقة ${c.dir === 'long' ? 'تحت' : 'فوق'} ${n(c.mssLevel)}`}`,
  );
  if (extra.newsText) lines.push(`⚠️ <b>خبر قادم:</b> ${esc(extra.newsText)}`);
  lines.push(`🕐 ${extra.timeText || ''}`.trim());
  return lines.join('\n');
}

/** B-grade: something is forming but the RR doesn't pay. No trade. */
export function formatWatch(c) {
  return [
    `👀 <b>في حاجة قريبة — بس مش صفقة</b>`,
    `النوع: ${dirWord2(c.dir)} · الدخول ${n(c.entry)}`,
    `العائد: ${c.rrs.map((r) => n(r, 1)).join(' · ')} — أقل من 2:1`,
    `<i>مش هتدخل، بس أنا بتابع.</i>`,
  ].join('\n');
}

/** The morning map: the levels that matter, in plain language. */
export function formatMap(ctx, extra = {}) {
  const up = ctx.levels.above.slice(0, 6).map((x) => n(x)).join(' · ');
  const down = ctx.levels.below.slice(0, 6).map((x) => n(x)).join(' · ');
  const lines = [
    `🗺 <b>خريطة الذهب — ${extra.date || ''}</b>`,
    '',
    `💰 السعر: ${n(ctx.price)}   |   الاتجاه: ${biasWord(ctx.bias)}   |   التذبذب: ${ctx.atr15 ? n(ctx.atr15) : '—'}`,
    '',
    up ? `<b>🔴 مقاومة (فوق السعر):</b>\n${up}` : '',
    down ? `<b>🔵 دعم (تحت السعر):</b>\n${down}` : '',
  ].filter((x) => x !== '');
  if (extra.keyLine) lines.push('', `⚠️ <b>أهم خط:</b> ${esc(extra.keyLine)}`);
  if (extra.triggers) lines.push('', `<b>🎯 هبعتلك تنبيه لو:</b>\n${extra.triggers}`);
  return lines.join('\n');
}

/** The end-of-day summary. */
export function formatSummary(ctx, extra = {}) {
  const wins = extra.wins ?? 0, losses = extra.losses ?? 0, total = wins + losses;
  const wr = total ? Math.round((100 * wins) / total) : null;
  const lines = [
    `📊 <b>ملخص ${extra.day || ''}</b>`,
    '',
    `💰 الإغلاق: ${n(extra.close ?? ctx.price)}   |   مدى اليوم: ${n(ctx.dayLow)} – ${n(ctx.dayHigh)}`,
    `📈 صفقات: ${extra.trades ?? 0}   |   العائد: ${extra.r >= 0 ? '+' : ''}${n(extra.r ?? 0, 2)} (${extra.rPct ?? '0.00'}%)`,
    `🔄 نسبة الفوز: ${wr === null ? '— (مفيش صفقات)' : wr + '%'}`,
  ];
  if (extra.lessons?.length) {
    lines.push('', '<b>📌 أهم دروس اليوم</b>');
    for (const l of extra.lessons) lines.push(`• ${l}`);
  }
  if (extra.tomorrow?.length) {
    lines.push('', '<b>🎯 الخطوط المهمة لبكرا</b>');
    for (const l of extra.tomorrow) lines.push(`• ${l}`);
  }
  return lines.join('\n');
}

/** A trade update (TP hit / stop). */
export function formatTradeUpdate(t, kind, extra = {}) {
  const head = {
    tp1: `✅ <b>هدف 1 اتحقق</b>`, tp2: `✅ <b>هدف 2 اتحقق</b>`,
    tp3: `🏁 <b>هدف 3 اتحقق — الصفقة كاملة</b>`, stopped: `❌ <b>وقف الخسارة اتحقق</b>`,
  }[kind] || 'ℹ️ تحديث';
  const lines = [head];
  if (kind === 'stopped') lines.push(`خسرت المخاطرة كاملة (-1)`);
  else lines.push(`ربح: ${extra.r >= 0 ? '+' : ''}${n(extra.r, 2)} · ربحMoney: ${extra.money ? '$' + n(extra.money, 0) : ''}`);
  lines.push(`📍 ${esc(t.id)}`);
  return lines.join('\n');
}

export function formatStatus(ctx, extra = {}) {
  return [
    `📡 <b>الحالة</b>`,
    `💰 ${n(ctx.price)} · الاتجاه ${biasWord(ctx.bias)} · التذبذب ${ctx.atr15 ? n(ctx.atr15) : '—'}`,
    `📈 صفقات اليوم: ${extra.trades ?? 0} · العائد ${n(extra.r ?? 0, 2)}`,
    `🕐 ${extra.time || ''}`,
  ].join('\n');
}

export function formatLevels(ctx) {
  return [
    `<b>🔴 مقاومة</b>\n${ctx.levels.above.slice(0, 8).map((x) => n(x)).join(' · ') || '—'}`,
    `<b>🔵 دعم</b>\n${ctx.levels.below.slice(0, 8).map((x) => n(x)).join(' · ') || '—'}`,
  ].join('\n');
}

export const biasWord = (b) => ({ BULLISH: 'صاعد', BEARISH: 'هابط', MIXED: 'محايد' }[b] || b);
