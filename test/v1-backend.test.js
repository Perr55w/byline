// v1 back end: unit tests that run in-process on a throwaway data directory (no server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.BYLINE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-v1-'));
const { nextOpenSlot } = await import('../src/routes/content.js');
const { local, nameAliases } = await import('../src/ai/local.js');

// ---------------------------------------------------------------- A1: one "next open posting day"
test('slots: today counts when it is an open posting day (Fri 20 Nov, Mon/Wed/Fri, nothing planned)', () => {
  assert.equal(nextOpenSlot({ today: '2026-11-20', days: ['Mon', 'Wed', 'Fri'] }), '2026-11-20');
});
test('slots: a planned post on today moves the next open day to the next posting day', () => {
  const taken = (d) => d === '2026-11-20';
  assert.equal(nextOpenSlot({ today: '2026-11-20', days: ['Mon', 'Wed', 'Fri'], taken }), '2026-11-23');
});
test('slots: a non-posting day finds the next posting day; `after` starts the day after', () => {
  assert.equal(nextOpenSlot({ today: '2026-11-21', days: ['Mon', 'Wed', 'Fri'] }), '2026-11-23');
  assert.equal(nextOpenSlot({ today: '2026-11-20', after: '2026-11-20', days: ['Mon', 'Wed', 'Fri'] }), '2026-11-23');
  assert.equal(nextOpenSlot({ today: '2026-11-20', days: [], taken: () => true }), null);
});

// ---------------------------------------------------------------- A1: honest employer connections
const EMPLOYERS = [
  { name: 'Google DeepMind', parent: 'Google', terms: ['DeepMind', 'Gemini', 'model evaluation'] },
  { name: 'Google Cloud', parent: 'Google', terms: ['Google Cloud', 'Vertex AI'] },
  { name: 'AWS', parent: null, terms: ['AWS', 'Amazon Web Services', 'Bedrock', 'inference cost'] }
];
test('nameAliases keeps names and name-like terms, never product terms', () => {
  assert.deepEqual(nameAliases(EMPLOYERS[0]).sort(), ['DeepMind', 'Google DeepMind']);
  assert.ok(nameAliases(EMPLOYERS[2]).includes('Amazon Web Services'));
  assert.ok(!nameAliases(EMPLOYERS[2]).includes('Bedrock'));
});
test('a product term ("Gemini") is topical overlap, not "Named in a source"', async () => {
  const story = { title: 'Gemini 3 is generally available on Google Cloud', companies: ['Google DeepMind', 'Google Cloud'] };
  const articles = [{ id: 1, url: 'https://cloud.google.com/blog/x', domain: 'cloud.google.com', evidence_kind: 'announcement', title: story.title, summary: 'Gemini 3 now runs on Vertex AI.', content: '' }];
  const out = await local.employerConnections({ story, articles, claims: [], employers: EMPLOYERS, origin: articles[0] });
  const dm = out.find(c => c.employer === 'Google DeepMind');
  assert.ok(dm, 'DeepMind still shows as an overlap');
  assert.equal(dm.mention_ok, false);
  assert.equal(out.find(c => c.employer === 'Google Cloud').mention_ok, true);
});
test('a company named only in a source body is reported as unlinked, not silently dropped', async () => {
  const story = { title: 'sdk-python v2.7.0', companies: ['AWS'] };
  const articles = [{ id: 1, url: 'https://github.com/x/y/releases/v2.7.0', domain: 'github.com', evidence_kind: 'application', title: 'sdk-python v2.7.0', summary: 'Bug fixes.', content: 'tests: remove ambient AWS variables before the tests run' }];
  const out = await local.employerConnections({ story, articles, claims: [], employers: EMPLOYERS });
  assert.equal(out.length, 0);
  assert.deepEqual(out.unlinked, ['AWS']);
});

// ---------------------------------------------------------------- A2: SSRF guard (src/net.js)
const { isBlockedIp, assertPublicHost, assertPublicUrl, safeFetch } = await import('../src/net.js');
test('isBlockedIp: private, loopback, link-local, CGNAT, ULA and mapped forms are blocked; public is not', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.254', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:192.168.0.1', '64:ff9b::a00:1', 'not-an-ip'])
    assert.equal(isBlockedIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '2a00:1450:4001::200e'])
    assert.equal(isBlockedIp(ip), false, ip);
});
test('assertPublicHost: checks every resolved address (resolver injected)', async () => {
  const lookup = (map) => async (h) => (map[h] || []).map(address => ({ address }));
  const dnsMap = { 'news.example.com': ['93.184.216.34'], 'sneaky.example.com': ['93.184.216.34', '10.0.0.5'], 'rebind.example.com': ['127.0.0.1'] };
  assert.deepEqual(await assertPublicHost('news.example.com', { lookup: lookup(dnsMap) }), ['93.184.216.34']);
  await assert.rejects(assertPublicHost('sneaky.example.com', { lookup: lookup(dnsMap) }), /Blocked/);
  await assert.rejects(assertPublicHost('rebind.example.com', { lookup: lookup(dnsMap) }), /Blocked/);
  await assert.rejects(assertPublicHost('localhost'), /Blocked/);
  await assert.rejects(assertPublicHost('printer.local'), /Blocked/);
  await assert.rejects(assertPublicHost('intranet'), /Blocked/);
  // behind a resolving proxy an unresolvable public-looking name passes; local names never do
  const nx = async () => { throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' }); };
  assert.deepEqual(await assertPublicHost('feeds.example.org', { lookup: nx, proxyResolves: true }), []);
  await assert.rejects(assertPublicHost('feeds.example.org', { lookup: nx, proxyResolves: false }), /resolve/);
  await assert.rejects(assertPublicHost('localhost', { lookup: nx, proxyResolves: true }), /Blocked/);
  await assert.rejects(assertPublicUrl('ftp://example.com/x'), /http/);
  await assert.rejects(assertPublicUrl('http://user:pw@example.com/'), /credentials/);
});
test('safeFetch re-checks the host on every redirect', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(url); return new Response('', { status: 302, headers: { Location: 'http://169.254.169.254/latest/meta-data/' } }); };
  try {
    const lookup = async () => [{ address: '93.184.216.34' }];
    await assert.rejects(safeFetch('https://news.example.com/feed', { lookup }), /Blocked/);
    assert.deepEqual(seen, ['https://news.example.com/feed'], 'the private hop was never requested');
  } finally { globalThis.fetch = realFetch; }
});

// ---------------------------------------------------------------- A3: migrations, FTS search, backups, catch-up
const { DatabaseSync } = await import('node:sqlite');
const dbm = await import('../src/db.js');
test('migrations: an old database (no schema_version, missing columns) upgrades in order, idempotently', () => {
  const file = path.join(process.env.BYLINE_DATA_DIR, 'old.db');
  const d = new DatabaseSync(file);
  d.exec(dbm.BASE_SCHEMA); // the tables as they stood before versioned migrations
  d.prepare("INSERT INTO stories(title, summary, companies, topics) VALUES('Agent orchestration lands in the enterprise', 'A survey of 40 workflows.', '[\"AWS\"]', '[\"Agent orchestration\"]')").run();
  assert.equal(dbm.schemaVersion(d), 0);
  assert.ok(!d.prepare('PRAGMA table_info(stories)').all().some(c => c.name === 'viewed_score'));
  const applied = dbm.migrate(d);
  assert.deepEqual(applied, dbm.MIGRATIONS.map(m => m.version));
  assert.equal(dbm.schemaVersion(d), dbm.MIGRATIONS.at(-1).version);
  assert.ok(d.prepare('PRAGMA table_info(stories)').all().some(c => c.name === 'viewed_score'));
  assert.ok(d.prepare('PRAGMA table_info(contacts)').all().some(c => c.name === 'segment'));
  // the FTS index was built from existing rows and follows later writes
  const hit = (q) => d.prepare('SELECT rowid / 8 AS id FROM search_fts WHERE search_fts MATCH ? AND rowid % 8 = 1').all(q).map(r => r.id);
  assert.deepEqual(hit('"orchestr"'), [1]);
  d.prepare("UPDATE stories SET title = 'Evaluation harnesses' WHERE id = 1").run();
  assert.deepEqual(hit('"orchestr"'), [1], 'topics still match');
  assert.deepEqual(hit('"harness"'), [1]);
  d.prepare('DELETE FROM stories WHERE id = 1').run();
  assert.deepEqual(hit('"harness"'), []);
  // run again: nothing to apply, nothing breaks
  assert.deepEqual(dbm.migrate(d), []);
  // a database that already had the ad-hoc columns (an earlier version) also upgrades cleanly
  const d2 = new DatabaseSync(path.join(process.env.BYLINE_DATA_DIR, 'mid.db'));
  d2.exec(dbm.BASE_SCHEMA); d2.exec("ALTER TABLE stories ADD COLUMN viewed_score REAL; ALTER TABLE contacts ADD COLUMN segment TEXT DEFAULT 'target_team'");
  assert.deepEqual(dbm.migrate(d2), dbm.MIGRATIONS.map(m => m.version));
  d.close(); d2.close();
});

test('backups: daily backup once per day, keeps the newest N', async () => {
  const { dailyBackup, listBackups, backupNow } = await import('../src/backup.js');
  const root = path.join(process.env.BYLINE_DATA_DIR, 'bk');
  for (let i = 0; i < 3; i++) { backupNow({ root, label: `old${i}` }); }
  const first = dailyBackup({ root, keep: 2, now: new Date('2099-01-01T08:00:00Z') });
  assert.ok(first.dir && fs.existsSync(path.join(first.dir, 'byline.db')));
  assert.equal(dailyBackup({ root, keep: 2, now: new Date('2099-01-01T09:00:00Z') }).skipped, 'already backed up today');
  assert.equal(listBackups(root).length, 2);
});

test('scheduler catch-up: after the scheduled time with no run today it is due once; not before, not twice', async () => {
  const { scheduleDue, FIRST_TICK_MS } = await import('../src/scheduler.js');
  assert.ok(FIRST_TICK_MS <= 10000, 'the first check runs within seconds of start-up');
  const settings = { timezone: 'America/New_York', schedule: { enabled: true, time: '07:00' } };
  const at = (iso) => new Date(iso);
  // the PC was off at 07:00 and Byline starts at 09:30 local (14:30 UTC)
  const late = scheduleDue({ settings, now: at('2031-03-04T14:30:00Z') });
  assert.equal(late.due, true);
  assert.equal(late.date, '2031-03-04');
  assert.equal(scheduleDue({ settings, now: at('2031-03-04T11:30:00Z') }).due, false, '06:30 local: not yet');
  assert.equal(scheduleDue({ settings: { ...settings, schedule: { enabled: false, time: '07:00' } }, now: at('2031-03-04T14:30:00Z') }).due, false);
  dbm.run("INSERT INTO runs(run_date, trigger, status, started_at) VALUES('2031-03-04', 'schedule', 'done', '2031-03-04T14:31:00Z')");
  assert.equal(scheduleDue({ settings, now: at('2031-03-04T15:00:00Z') }).reason, 'already ran today');
  // a failed attempt is retried after 10 minutes, resuming that run
  dbm.run("INSERT INTO runs(run_date, trigger, status, started_at) VALUES('2031-03-05', 'schedule', 'failed', '2031-03-05T14:30:00Z')");
  assert.equal(scheduleDue({ settings, now: at('2031-03-05T14:35:00Z') }).due, false);
  const retry = scheduleDue({ settings, now: at('2031-03-05T14:45:00Z') });
  assert.equal(retry.due, true);
  assert.ok(retry.resume_run_id);
});

test('search: FTS5 trigram index, same results as the LIKE fallback when FTS is unavailable', async () => {
  const { registerContent } = await import('../src/routes/content.js');
  const routes = {};
  registerContent((m, p, h) => { routes[`${m} ${p}`] = h; });
  const search = (q) => routes['GET /api/search']({ query: { q, type: 'stories,claims,notes' } });
  dbm.run("INSERT INTO stories(title, summary, companies, topics, updated_at) VALUES('Snowflake ships a semantic layer for agents', 'Cortex adds governed metrics.', '[\"Snowflake\"]', '[\"Analytics\"]', '2031-01-01')");
  dbm.run("INSERT INTO notes(text) VALUES('Private: ask about the semantic layer pricing')");
  const a = search('semantic lay');
  assert.equal(a.engine, 'fts5');
  assert.equal(a.stories.length, 1);
  assert.equal(a.counts.notes, 1);
  assert.equal(search('mantic').stories.length, 1, 'a substring inside a word still matches (trigram)');
  assert.equal(search('ai').engine, 'like', 'terms shorter than 3 characters fall back to LIKE');
  // FTS missing (an SQLite build without FTS5): the same query runs on LIKE
  for (const t of Object.keys(dbm.FTS_KINDS)) dbm.db.exec(`DROP TRIGGER IF EXISTS fts_${t}_ai; DROP TRIGGER IF EXISTS fts_${t}_au; DROP TRIGGER IF EXISTS fts_${t}_ad;`);
  dbm.db.exec('DROP TABLE search_fts');
  const b = search('semantic lay');
  assert.equal(b.engine, 'like');
  assert.equal(b.stories.length, 1);
  assert.equal(b.counts.notes, 1);
});

test('morning digest: a brief is pushed to ntfy once per day when push is on and NTFY_TOPIC is set', async () => {
  const { deliverBrief } = await import('../src/delivery.js');
  dbm.run("INSERT INTO briefs(run_date, summary, items_json, quiet) VALUES('2031-04-01', 'Three stories cleared the bar today.', '[]', 0)");
  dbm.setSetting('delivery', { email: false, push: true, email_to: '' });
  const env0 = { ...process.env };
  process.env.NTFY_TOPIC = 'byline-test-topic'; process.env.BYLINE_PUBLIC_URL = 'https://pc.tailnet.ts.net';
  delete process.env.SMTP_USER; delete process.env.RESEND_API_KEY;
  const realFetch = globalThis.fetch; const sent = [];
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return new Response('{}', { status: 200 }); };
  try {
    const r = await deliverBrief('2031-04-01');
    assert.equal(r.push, 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://ntfy.sh/byline-test-topic');
    assert.equal(sent[0].init.headers.Click, 'https://pc.tailnet.ts.net/#/today');
    assert.match(sent[0].init.body, /Three stories/);
    assert.match((await deliverBrief('2031-04-01')).push, /already sent/);
    assert.equal(sent.length, 1, 'not sent twice');
    dbm.setSetting('delivery', { email: false, push: false, email_to: '' });
    dbm.run("INSERT INTO briefs(run_date, summary) VALUES('2031-04-02', 'x')");
    assert.match((await deliverBrief('2031-04-02')).push, /off/);
  } finally { globalThis.fetch = realFetch; for (const k of ['NTFY_TOPIC', 'BYLINE_PUBLIC_URL']) { if (env0[k] === undefined) delete process.env[k]; else process.env[k] = env0[k]; } }
});
