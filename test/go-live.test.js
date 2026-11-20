// scripts/go-live.js: dry run changes nothing; a real run (without network: --no-sync) removes demo sources and
// articles but keeps demo people, unpauses real sources, turns the schedule on, and is idempotent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-golive-'));
const env = { ...process.env, BYLINE_DATA_DIR: dataDir, NTFY_TOPIC: 'byline-test-topic', X_BEARER_TOKEN: '' };
const node = (args) => execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], { env, encoding: 'utf8', cwd: path.resolve('.') });
const snapshot = () => JSON.parse(node(['--input-type=module', '-e', `
  const { get, getSettings } = await import('./src/db.js');
  const n = (sql) => get(sql).n;
  console.log(JSON.stringify({ demo_sources: n('SELECT COUNT(*) AS n FROM sources WHERE is_demo = 1'), demo_articles: n('SELECT COUNT(*) AS n FROM articles WHERE is_demo = 1'),
    stories: n('SELECT COUNT(*) AS n FROM stories'), contacts: n('SELECT COUNT(*) AS n FROM contacts'), jobs: n('SELECT COUNT(*) AS n FROM job_posts'),
    experiences: n('SELECT COUNT(*) AS n FROM experiences'), paused: n("SELECT COUNT(*) AS n FROM sources WHERE paused = 1 AND kind != 'manual'"),
    real: n("SELECT COUNT(*) AS n FROM sources WHERE is_demo = 0 AND kind != 'manual'"), schedule: getSettings().schedule, push: !!getSettings().delivery?.push }));`]));

test('go-live: dry run, real run, second run', () => {
  // a database like the container's: seeded, demo loaded, every source paused, one placeholder source
  node(['--input-type=module', '-e', `
    const { run, all } = await import('./src/db.js');
    const { seedDefaults } = await import('./src/seed.js'); seedDefaults();
    const { loadDemo } = await import('./src/demo.js'); loadDemo();
    run("INSERT INTO sources(name, kind, url) VALUES('Test feed', 'rss', 'https://feeds.example/rss')");
    run('UPDATE sources SET paused = 1');`]);
  const before = snapshot();
  assert.ok(before.demo_sources > 0 && before.demo_articles > 0 && before.contacts > 0);
  assert.equal(before.schedule.enabled, false);

  const dry = node(['scripts/go-live.js', '--dry-run', '--no-sync']);
  assert.match(dry, /dry run/i);
  assert.match(dry, /would remove \d+ demo sources/);
  assert.deepEqual(snapshot(), before, 'the dry run changed nothing');
  assert.ok(!fs.existsSync(path.join(dataDir, 'backups')), 'no backup in a dry run');

  const real = node(['scripts/go-live.js', '--no-sync']);
  assert.match(real, /1\. Backup: /);
  const after = snapshot();
  assert.equal(after.demo_sources, 0);
  assert.equal(after.demo_articles, 0);
  assert.ok(after.stories < before.stories);
  assert.equal(after.contacts, before.contacts, 'demo contacts stay');
  assert.equal(after.jobs, before.jobs, 'demo job posts stay');
  assert.equal(after.experiences, before.experiences, 'experiences stay');
  assert.equal(after.paused, 1, 'only the placeholder source stays paused');
  assert.deepEqual([after.schedule.enabled, after.schedule.time], [true, '07:00']);
  assert.equal(after.push, true, 'push on because NTFY_TOPIC is set');
  assert.equal(fs.readdirSync(path.join(dataDir, 'backups')).length, 1);

  const again = node(['scripts/go-live.js', '--no-sync']);
  assert.match(again, /Demo data: none left/);
  assert.match(again, /already on at 07:00/);
  assert.deepEqual(snapshot(), after, 'a second run changes nothing');
  fs.rmSync(dataDir, { recursive: true, force: true });
});
