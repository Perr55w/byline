// Minimal in-process scheduler. Replaceable: anything that calls runDaily() (cron, a hosted
// scheduler, `npm run daily`) works the same way because runs are idempotent per date.
import { get, getSettings } from './db.js';
import { runDaily, todayIn } from './pipeline.js';

const RETRY_MINUTES = 10, MAX_ATTEMPTS = 3;

export function nowHHMM(tz) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

export async function tick() {
  const s = getSettings();
  if (!s.schedule?.enabled) return;
  const date = todayIn(s.timezone);
  if (nowHHMM(s.timezone) < s.schedule.time) return;
  if (get("SELECT id FROM runs WHERE run_date = ? AND trigger = 'schedule' AND status = 'done'", date)) return;
  const attempts = get("SELECT COUNT(*) AS n, MAX(started_at) AS last FROM runs WHERE run_date = ? AND trigger = 'schedule'", date);
  if (attempts.n >= MAX_ATTEMPTS) return;
  if (attempts.last && Date.now() - Date.parse(attempts.last) < RETRY_MINUTES * 60e3) return;
  const failed = get("SELECT id FROM runs WHERE run_date = ? AND trigger = 'schedule' AND status = 'failed' ORDER BY id DESC LIMIT 1", date);
  try {
    // Resume the failed run from its failed stage rather than starting over.
    await runDaily({ date, trigger: 'schedule', runId: failed?.id ?? null });
  } catch (e) { console.warn('[scheduler]', e.message); }
}

export function startScheduler() {
  setInterval(() => tick().catch(e => console.warn('[scheduler]', e.message)), 60e3).unref();
}
