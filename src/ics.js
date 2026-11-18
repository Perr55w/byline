// Private iCalendar feed (subscribe from Google Calendar): posting slots, planned/scheduled posts,
// follow-ups, and planned outreach sends. Access is by a secret token in the URL.
import crypto from 'node:crypto';
import { all, getSettings, setSetting } from './db.js';

export function icsToken() {
  let t = getSettings().ics_token;
  if (!t) { t = crypto.randomBytes(18).toString('base64url'); setSetting('ics_token', t); }
  return t;
}

const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const day = (iso) => iso.slice(0, 10).replace(/-/g, '');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const fold = (line) => line.length <= 74 ? line : line.match(/.{1,73}/g).join('\r\n ');

export function icsFeed() {
  const s = getSettings();
  const base = process.env.BYLINE_PUBLIC_URL || '';
  const ev = [];
  const allDay = (uid, date, summary, url) => ev.push(['BEGIN:VEVENT', `UID:${uid}@byline`, `DTSTAMP:${stamp()}`, `DTSTART;VALUE=DATE:${day(date)}`,
    `DTEND;VALUE=DATE:${day(new Date(Date.parse(date.slice(0, 10) + 'T12:00:00Z') + 864e5).toISOString())}`, `SUMMARY:${esc(summary)}`, url ? `URL:${url}` : null, 'END:VEVENT'].filter(Boolean));
  const days = s.posting_days || [];
  const planned = new Set(all("SELECT planned_date FROM drafts WHERE planned_date IS NOT NULL AND status != 'archived'").map(r => r.planned_date));
  for (let i = 0; i < 56; i++) {
    const d = new Date(Date.now() + i * 864e5);
    const iso = d.toISOString().slice(0, 10);
    if (days.includes(d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })) && !planned.has(iso)) allDay(`slot-${iso}`, iso, 'Byline · open posting slot');
  }
  for (const d of all("SELECT id, title, channel, status, planned_date, published_at FROM drafts WHERE status != 'archived' AND (planned_date IS NOT NULL OR published_at IS NOT NULL)"))
    allDay(`draft-${d.id}`, d.published_at || d.planned_date, `${d.status === 'published' ? '✓ Posted' : d.status === 'scheduled' ? 'Scheduled' : 'Planned'} · ${d.channel} · ${d.title}`, base && `${base}/#/draft/${d.id}`);
  for (const c of all('SELECT id, name, next_step, next_date FROM contacts WHERE dnc = 0 AND next_date IS NOT NULL'))
    allDay(`followup-${c.id}`, c.next_date, `Follow up · ${c.name}: ${c.next_step || ''}`, base && `${base}/#/person/${c.id}`);
  for (const o of all("SELECT o.id, o.send_at, o.channel, c.name FROM outreach o JOIN contacts c ON c.id = o.contact_id WHERE o.send_at IS NOT NULL AND o.status IN ('approved','in_review','draft')"))
    allDay(`outreach-${o.id}`, o.send_at, `Send ${o.channel} to ${o.name} (approval required)`);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Byline//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Byline', ...ev.flat(), 'END:VCALENDAR'].map(fold).join('\r\n') + '\r\n';
}
