// One-shot switch from demo data to real feeds, on your own PC:
//   npm run go-live -- --dry-run     show what would happen (fetches feeds to check them, writes nothing)
//   npm run go-live                  do it
// Options: --no-sync (skip fetching), --time HH:MM (schedule time, default 07:00), --yes (no pause before changes).
//
// Steps: 1 back up  2 remove demo sources, articles, their stories and demo briefs (demo contacts, experiences and
// job posts stay until v2)  3 unpause real sources (placeholder *.example addresses are paused instead)
// 4 sync each source and print an OK / failed table (a failing seeded feed is retried on its known alternate URL)
// 5 turn the daily schedule on (and phone push, when NTFY_TOPIC is set). Safe to run again: each step only changes
// what is not already in its final state. It never runs the daily workflow, drafts, approves or publishes anything.
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const NO_SYNC = argv.includes('--no-sync');
const TIME = (() => { const i = argv.indexOf('--time'); const t = i >= 0 ? argv[i + 1] : '07:00'; if (!/^\d{2}:\d{2}$/.test(t || '')) { console.error('--time needs HH:MM'); process.exit(2); } return t; })();

// .env (same rules as the launchers): KEY=value, comments and empty values skipped, real environment wins.
const envFile = path.resolve('.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[2] !== '' && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const { all, get, run, now, getSettings, setSetting, DATA_DIR } = await import('../src/db.js');
const { seedDefaults, FEED_ALTERNATES, altKind } = await import('../src/seed.js');
const { clearDemo } = await import('../src/demo.js');
const { backupNow, backupDir } = await import('../src/backup.js');
const { connectorFor } = await import('../src/connectors/index.js');
const { ingestItem, clusterArticles, rankStories } = await import('../src/pipeline.js');

const say = (...a) => console.log(...a);
const pad = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n); };
const placeholder = (url) => { try { return /(^|\.)(example|invalid|test|localhost)$/i.test(new URL(url).hostname); } catch { return false; } };

seedDefaults();
say(`Byline go-live${DRY ? ' (dry run: nothing will be changed)' : ''}`);
say(`  database: ${path.join(DATA_DIR, 'byline.db')}`);

// 1. backup
if (DRY) say(`1. Backup: would write a backup to ${backupDir()}`);
else { const b = backupNow({ label: 'before-go-live' }); say(`1. Backup: ${b.dir}`); }

// 2. demo data (people stay)
const demo = {
  sources: get('SELECT COUNT(*) AS n FROM sources WHERE is_demo = 1').n,
  articles: get('SELECT COUNT(*) AS n FROM articles WHERE is_demo = 1').n,
  stories: get('SELECT COUNT(DISTINCT story_id) AS n FROM articles WHERE is_demo = 1 AND story_id IS NOT NULL').n
};
if (!demo.sources && !demo.articles) say('2. Demo data: none left.');
else {
  say(`2. Demo data: ${DRY ? 'would remove' : 'removing'} ${demo.sources} demo sources, ${demo.articles} demo articles and the ${demo.stories} stories built only from them. Demo contacts, experiences and job posts stay.`);
  if (!DRY) clearDemo({ keepPeople: true });
}

// 3. sources
const sources = all("SELECT * FROM sources WHERE kind != 'manual' AND is_demo = 0 ORDER BY id");
const plan = sources.map(s => {
  if (placeholder(s.url)) return { s, action: s.paused ? 'keep paused' : 'pause', why: 'placeholder address' };
  if (s.kind === 'x' && !process.env.X_BEARER_TOKEN) return { s, action: s.paused ? 'keep paused' : 'pause', why: 'needs X_BEARER_TOKEN (paid)' };
  return { s, action: s.paused ? 'unpause' : 'already on' };
});
const changes = plan.filter(p => p.action === 'unpause' || p.action === 'pause');
say(`3. Sources: ${plan.filter(p => p.action === 'unpause').length} to unpause, ${plan.filter(p => p.action === 'already on').length} already on, ${plan.filter(p => p.action.includes('pause') && p.action !== 'unpause').length} left paused.`);
if (!DRY) for (const p of changes) run('UPDATE sources SET paused = ? WHERE id = ?', p.action === 'pause' ? 1 : 0, p.s.id);

// 4. sync
const rows = [];
async function tryCollect(kind, url) {
  const items = await connectorFor(kind).collect({ kind, url }, { isKnown: (u) => !!get('SELECT 1 FROM articles WHERE url = ?', u), max: 8 });
  // a listing page skips articles Byline already has, so "nothing new" is fine there; an empty feed is not
  if (!items.length && kind !== 'page') throw new Error('no items in the feed (is this an RSS/Atom address?)');
  return items;
}
if (NO_SYNC) say('4. Sync: skipped (--no-sync).');
else {
  say(`4. Sync: fetching ${plan.filter(p => !p.action.includes('pause') || p.action === 'unpause').length} sources${DRY ? ' (read-only check)' : ''}…`);
  for (const p of plan) {
    const s = p.s;
    if (p.action === 'pause' || p.action === 'keep paused') { rows.push({ name: s.name, result: 'paused', detail: p.why }); continue; }
    const st = connectorFor(s.kind).status(s);
    if (!st.ready) { rows.push({ name: s.name, result: 'FAIL', detail: st.reason }); if (!DRY) run('UPDATE sources SET last_error = ? WHERE id = ?', st.reason, s.id); continue; }
    let items = null, used = s.url, usedKind = s.kind, err = null;
    try { items = await tryCollect(s.kind, s.url); }
    catch (e) {
      err = `${e.message}${e.cause ? ` (${e.cause.code || e.cause.message})` : ''}`;
      for (const alt of FEED_ALTERNATES[s.url] || []) {
        try { items = await tryCollect(altKind(alt, s.kind), alt); used = alt; usedKind = altKind(alt, s.kind); break; } catch { /* next */ }
      }
    }
    if (!items) { rows.push({ name: s.name, result: 'FAIL', detail: err }); if (!DRY) run('UPDATE sources SET last_error = ? WHERE id = ?', err, s.id); continue; }
    let created = 0;
    if (!DRY) {
      if (used !== s.url) {
        try { run('UPDATE sources SET url = ?, kind = ? WHERE id = ?', used, usedKind, s.id); }
        catch { rows.push({ name: s.name, result: 'FAIL', detail: `${err}; alternate ${used} already exists as another source` }); continue; }
      }
      for (const it of items.slice(0, 60)) if (ingestItem(it, { ...s, url: used, kind: usedKind }).created) created++;
      run('UPDATE sources SET last_sync_at = ?, last_error = NULL, last_count = ? WHERE id = ?', now(), created, s.id);
    }
    rows.push({ name: s.name, result: 'OK', detail: `${items.length ? `${items.length} items${DRY ? '' : `, ${created} new`}` : 'reachable, nothing new'}${used !== s.url ? ` · ${DRY ? 'would switch' : 'switched'} to ${used} (was: ${err})` : ''}` });
  }
  if (!DRY && rows.some(r => r.result === 'OK')) { const c = clusterArticles(); rankStories(); say(`   clustered: ${JSON.stringify(c)}`); }
  say('');
  say(`   ${pad('source', 40)} ${pad('result', 7)} detail`);
  for (const r of rows) say(`   ${pad(r.name, 40)} ${pad(r.result, 7)} ${r.detail || ''}`);
  say(`   ${rows.filter(r => r.result === 'OK').length} OK · ${rows.filter(r => r.result === 'FAIL').length} failed · ${rows.filter(r => r.result === 'paused').length} paused`);
  if (rows.some(r => r.result === 'FAIL')) say('   A failed source keeps its error in Sources: fix its URL there, or pause it. If nearly every source fails, check this computer\'s internet connection, VPN or firewall, then run go-live again.');
  say('');
}

// 5. schedule + delivery
const s = getSettings();
const wantSchedule = { ...s.schedule, enabled: true, time: TIME };
const schedOk = s.schedule?.enabled && s.schedule?.time === TIME;
say(`5. Schedule: ${schedOk ? `already on at ${TIME}` : `${DRY ? 'would turn on' : 'on'} at ${TIME}`} (${s.timezone}). If Byline starts after ${TIME} and today hasn't run, it runs once right away.`);
if (!DRY && !schedOk) setSetting('schedule', wantSchedule);
if (process.env.NTFY_TOPIC) {
  const on = !!s.delivery?.push;
  say(`   Phone push (ntfy): ${on ? 'already on' : DRY ? 'would turn on' : 'on'}.`);
  if (!DRY && !on) setSetting('delivery', { ...s.delivery, push: true });
} else say('   Phone push: set NTFY_TOPIC in .env to get the morning digest on your phone (see docs/DEPLOY.md §5).');

say('');
say(DRY ? 'Dry run finished: nothing was changed. Run `npm run go-live` to apply.' : 'Done. Open Byline: Sources shows each feed\'s state; Runs shows each morning\'s run.');
process.exit(0); // don't wait on idle keep-alive sockets
