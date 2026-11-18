// Brief delivery beyond the app: formatted email digest (Resend) and phone push (ntfy).
// Both are free-tier HTTP APIs; each channel is skipped unless configured. Sends are idempotent per date.
import { get, run, parse, getSettings } from './db.js';

const esc = (s = '') => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const appUrl = () => process.env.BYLINE_PUBLIC_URL || `http://127.0.0.1:${process.env.PORT || 4317}`;

export function deliveryStatus() {
  const d = getSettings().delivery || {};
  return {
    email: { configured: !!process.env.RESEND_API_KEY, enabled: !!d.email, to: d.email_to || '', note: process.env.RESEND_API_KEY ? 'Resend API key detected.' : 'Set RESEND_API_KEY (free tier: 3,000 emails/month) and RESEND_FROM.' },
    push: { configured: !!process.env.NTFY_TOPIC, enabled: !!d.push, note: process.env.NTFY_TOPIC ? `Publishing to ntfy topic “${process.env.NTFY_TOPIC}”.` : 'Set NTFY_TOPIC (install the free ntfy app and subscribe to the same, hard-to-guess topic).' }
  };
}

export function digestHtml(date) {
  const b = get('SELECT * FROM briefs WHERE run_date = ?', date);
  if (!b) return null;
  const items = parse(b.items_json, []);
  const draft = b.draft_id ? get('SELECT id, title, format FROM drafts WHERE id = ?', b.draft_id) : null;
  const rows = items.map((it, i) => `
    <tr><td style="padding:16px 0;border-top:1px solid #2a2440;vertical-align:top;font:600 13px monospace;color:#f5b544;width:34px">${String(i + 1).padStart(2, '0')}</td>
    <td style="padding:16px 0;border-top:1px solid #2a2440">
      <a href="${appUrl()}/#/story/${it.story_id}" style="font:600 18px Georgia,serif;color:#f4f0ff;text-decoration:none">${esc(it.title)}</a>
      <p style="margin:6px 0;color:#d8d2ee;font:15px/1.5 Arial,sans-serif">${esc(it.summary)}</p>
      <p style="margin:0;color:#9a93b5;font:12px/1.5 Arial,sans-serif">Score ${it.score}${it.qualifies ? ' · post-worthy' : ''} · ${it.domains.length} source(s) · ${esc((it.topics || []).join(', '))}</p>
    </td></tr>`).join('');
  return `<!doctype html><html><body style="margin:0;background:#0b0912;padding:24px">
  <table role="presentation" width="100%" style="max-width:640px;margin:0 auto;background:#13101d;border-radius:12px;padding:28px">
    <tr><td colspan="2" style="font:11px monospace;letter-spacing:3px;color:#f5b544">BYLINE · ${esc(date)}</td></tr>
    <tr><td colspan="2" style="padding:8px 0 4px;font:600 26px Georgia,serif;color:#f4f0ff">Today’s briefing</td></tr>
    <tr><td colspan="2" style="padding-bottom:12px;font:16px/1.5 Georgia,serif;color:#d8d2ee">${esc(b.summary)} <span style="color:#9a93b5">≈ ${b.reading_minutes} min read.</span></td></tr>
    ${rows}
    ${draft ? `<tr><td colspan="2" style="padding-top:18px"><a href="${appUrl()}/#/draft/${draft.id}" style="display:inline-block;background:#9b7bff;color:#0b0912;padding:10px 16px;border-radius:8px;font:600 14px Arial,sans-serif;text-decoration:none">Review today’s ${esc(draft.format)} draft →</a></td></tr>` : ''}
    <tr><td colspan="2" style="padding-top:22px;font:12px Arial,sans-serif;color:#6c6588">Nothing is posted without your approval in Byline.</td></tr>
  </table></body></html>`;
}

async function sendEmail(date, to) {
  const html = digestHtml(date);
  const b = get('SELECT summary FROM briefs WHERE run_date = ?', date);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.RESEND_FROM || 'Byline <onboarding@resend.dev>', to: [to], subject: `Byline brief · ${date}`, html, text: b.summary })
  });
  if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
}

async function sendPush(date) {
  const b = get('SELECT summary, quiet FROM briefs WHERE run_date = ?', date);
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(process.env.NTFY_TOPIC)}`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Title: `Byline · ${b.quiet ? 'quiet day' : 'brief ready'}`, Click: `${appUrl()}/#/today`, Tags: 'newspaper' },
    body: b.summary.slice(0, 300)
  });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

/** Deliver a date's brief on every enabled, configured channel (each at most once per date unless forced). */
export async function deliverBrief(date, { force = false, only = null } = {}) {
  const b = get('SELECT id, delivered_json FROM briefs WHERE run_date = ?', date);
  if (!b) return { skipped: 'no brief' };
  const done = parse(b.delivered_json, {});
  const st = deliveryStatus();
  const out = {};
  const channels = { email: () => sendEmail(date, st.email.to), push: () => sendPush(date) };
  for (const [ch, fn] of Object.entries(channels)) {
    if (only && only !== ch) continue;
    if (!st[ch].configured || (!st[ch].enabled && !only)) { out[ch] = 'not configured or off'; continue; }
    if (ch === 'email' && !st.email.to) { out[ch] = 'no recipient set'; continue; }
    if (done[ch] && !force) { out[ch] = `already sent ${done[ch]}`; continue; }
    try { await fn(); done[ch] = new Date().toISOString(); out[ch] = 'sent'; }
    catch (e) { out[ch] = `failed: ${e.message}`; }
  }
  run('UPDATE briefs SET delivered_json = ? WHERE id = ?', JSON.stringify(done), b.id);
  return out;
}
