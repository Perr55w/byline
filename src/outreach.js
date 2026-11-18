// Sending approved outreach. Shared by the API (send now) and the scheduler (queued sends at their approved time).
import { all, get, run, now } from './db.js';
import { hashString, truncate } from './text.js';
import { sendMail, smtpConfigured } from './smtp.js';

export const outreachHash = (o) => hashString(JSON.stringify([o.recipient || '', o.channel, o.subject || '', o.body || '', o.send_at || '']));

/** Mark sent exactly once and log it on the relationship. */
export function recordSent(id) {
  const o = get('SELECT * FROM outreach WHERE id = ?', id);
  const r = run("UPDATE outreach SET status = 'sent', sent_at = ?, last_error = NULL WHERE id = ? AND status != 'sent'", now(), id);
  if (!r.changes) return false;
  run('INSERT INTO interactions(contact_id, kind, date, notes, created_at) VALUES(?,?,?,?,?)', o.contact_id, o.purpose === 'thank_you' ? 'thank_you' : 'message_sent',
    now().slice(0, 10), `${o.channel}: ${o.subject || truncate(o.body, 60)}`, now());
  run("UPDATE contacts SET stage = CASE WHEN stage IN ('researching','drafting') THEN 'contacted' ELSE stage END, next_step = 'Follow up if no reply', next_date = ? WHERE id = ?",
    new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), o.contact_id);
  return true;
}

/** Send one approved email. Claims the row first so retries and the scheduler can never send twice. */
export async function sendOutreachNow(id) {
  const o = get('SELECT o.*, c.dnc FROM outreach o JOIN contacts c ON c.id = o.contact_id WHERE o.id = ?', id);
  if (!o || o.status === 'sent') return { skipped: 'already sent' };
  if (o.dnc) throw Object.assign(new Error('Contact is marked “do not contact”.'), { status: 400 });
  if (!o.approved_hash || o.approved_hash !== outreachHash(o)) throw Object.assign(new Error('Approval no longer matches this message.'), { status: 409 });
  const claim = run("UPDATE outreach SET status = 'sending' WHERE id = ? AND status IN ('approved','queued')", id);
  if (!claim.changes) return { skipped: `status is ${o.status}` };
  try {
    await sendMail({ to: o.recipient, subject: o.subject || '(no subject)', text: o.body, messageId: o.idempotency_key });
    recordSent(id);
    return { sent: true };
  } catch (e) {
    run("UPDATE outreach SET status = 'approved', last_error = ? WHERE id = ?", e.message, id);
    throw Object.assign(new Error(`Send failed: ${e.message}`), { status: 502 });
  }
}

/** Called by the scheduler: send queued emails whose approved send time has arrived. */
export async function sendDueOutreach() {
  if (!smtpConfigured()) return [];
  const due = all("SELECT id, send_at FROM outreach WHERE status = 'queued'").filter(o => !o.send_at || Date.parse(o.send_at) <= Date.now());
  const out = [];
  for (const o of due) {
    try { out.push({ id: o.id, ...(await sendOutreachNow(o.id)) }); }
    catch (e) { out.push({ id: o.id, error: e.message }); }
  }
  return out;
}
