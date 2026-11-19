// Display helpers: every time the UI shows is in settings.timezone, never UTC (F §2).
export const timeLocal = (iso, tz) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }) : null;
export const dateLocal = (iso, tz) => iso ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso)).replace(',', '') : null;
/** A calendar date ("2026-11-18") as "Wed 18 Nov"; no timezone shift. */
export const dayLabel = (ymd) => ymd ? new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`)).replace(',', '') : null;
export const tzAbbr = (tz, at = new Date()) => new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(at).find(p => p.type === 'timeZoneName')?.value || tz;
