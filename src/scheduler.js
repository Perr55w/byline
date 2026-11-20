// Minimal in-process scheduler. Replaceable: anything that calls runDaily() (cron, a hosted
// scheduler, `npm run daily`) works the same way because runs are idempotent per date.
//
// Catch-up: the first check runs a few seconds after start-up, not a minute later. A PC that was off (or asleep) at
// the scheduled time therefore runs today's workflow as soon as Byline starts, once, if it hasn't run yet today.
import { get, getSettings } from './db.js';
import { runDaily } from './pipeline.js';
import { sendDueOutreach } from './outreach.js';
import { dailyBackup } from './backup.js';

const RETRY_MINUTES = 10, MAX_ATTEMPTS = 3;
export const FIRST_TICK_MS = 5000;

export function nowHHMM(tz, now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(now).replace(/^24:/, '00:');
}
const dateIn = (tz, now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/**
 * Whether the scheduled run should start now: the schedule is on, the local time (settings.timezone) is at or after
 * schedule.time, today's scheduled run hasn't finished, fewer than 3 attempts today, and the last attempt is > 10 min old.
 * Returns { due, date, reason, resume_run_id }.
 */
export function scheduleDue({ settings = getSettings(), now = new Date() } = {}) {
  const s = settings;
  if (!s.schedule?.enabled) return { due: false, reason: 'schedule off' };
  const tz = s.timezone || 'UTC';
  const date = dateIn(tz, now);
  if (nowHHMM(tz, now) < (s.schedule.time || '07:00')) return { due: false, date, reason: 'before the scheduled time' };
  if (get("SELECT id FROM runs WHERE run_date = ? AND trigger = 'schedule' AND status = 'done'", date)) return { due: false, date, reason: 'already ran today' };
  const attempts = get("SELECT COUNT(*) AS n, MAX(started_at) AS last FROM runs WHERE run_date = ? AND trigger = 'schedule'", date);
  if (attempts.n >= MAX_ATTEMPTS) return { due: false, date, reason: 'gave up after 3 attempts today' };
  if (attempts.last && now.getTime() - Date.parse(attempts.last) < RETRY_MINUTES * 60e3) return { due: false, date, reason: 'waiting before a retry' };
  const failed = get("SELECT id FROM runs WHERE run_date = ? AND trigger = 'schedule' AND status = 'failed' ORDER BY id DESC LIMIT 1", date);
  return { due: true, date, resume_run_id: failed?.id ?? null };
}

export async function tick({ now = new Date() } = {}) {
  try { const b = dailyBackup({ now }); if (b.dir) console.log(`[scheduler] daily backup → ${b.dir}${b.pruned.length ? ` (removed ${b.pruned.length} old)` : ''}`); }
  catch (e) { console.warn('[scheduler] backup', e.message); }
  await sendDueOutreach().catch(e => console.warn('[scheduler] outreach', e.message));
  const d = scheduleDue({ now });
  if (!d.due) return d;
  try {
    // Resume the failed run from its failed stage rather than starting over. Delivery (ntfy / email) runs at its end.
    const r = await runDaily({ date: d.date, trigger: 'schedule', runId: d.resume_run_id });
    console.log(`[scheduler] ${d.date} run ${r.run_id}: ${r.status}${r.stats?.delivery ? ` · delivery ${JSON.stringify(r.stats.delivery)}` : ''}`);
    return { ...d, ran: r };
  } catch (e) { console.warn('[scheduler]', e.message); return { ...d, error: e.message }; }
}

export function startScheduler() {
  const safe = () => tick().catch(e => console.warn('[scheduler]', e.message));
  setTimeout(safe, FIRST_TICK_MS).unref(); // catch-up shortly after start
  setInterval(safe, 60e3).unref();
}
