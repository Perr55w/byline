// Checks for the behaviour added after the alignment questionnaire.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4398, PW_PORT = 4397;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-align-'));
const pwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-pw-'));
const procs = [];
const start = async (port, dir, extra = {}) => {
  procs.push(spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { env: { ...process.env, PORT: String(port), BYLINE_DATA_DIR: dir, ANTHROPIC_API_KEY: '', RESEND_API_KEY: '', NTFY_TOPIC: '', ...extra }, stdio: 'ignore' }));
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
};
const api = async (method, p, body, port = PORT, headers = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}/api${p}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
};

before(async () => {
  await start(PORT, dataDir);
  await start(PW_PORT, pwDir, { BYLINE_PASSWORD: 'correct horse' });
  for (const s of (await api('GET', '/sources')).data) await api('PATCH', `/sources/${s.id}`, { paused: true });
  await api('POST', '/demo/load');
});
after(() => { procs.forEach(p => p.kill()); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(pwDir, { recursive: true, force: true }); });

test('aligned defaults: local engine, raised priorities, de-emphasis, posting days, pinned big-push employers', async () => {
  const s = (await api('GET', '/settings')).data;
  assert.equal(s.ai.provider, 'local');
  assert.equal(s.priorities.find(p => p.topic === 'Agent orchestration').weight, 2);
  assert.ok(s.priorities.some(p => p.weight < 0), 'has de-emphasized topics');
  assert.deepEqual(s.posting_days, ['Mon', 'Wed', 'Fri']);
  const pinned = (await api('GET', '/employers')).data.filter(e => e.pinned).map(e => e.name);
  for (const n of ['IBM', 'Toyota', 'Cox Automotive', 'Cox Enterprises']) assert.ok(pinned.includes(n), n);
  const projects = (await api('GET', '/projects')).data.map(p => p.title);
  assert.ok(projects.includes('Lot Intelligence') && projects.includes('Research Bench'));
  const sources = (await api('GET', '/sources')).data;
  assert.ok(sources.some(x => x.name === 'Anthropic News' && x.kind === 'page'));
});

test('daily auto-draft is a long analysis with an evidence section', async () => {
  const today = (await api('GET', '/today')).data;
  const d = (await api('GET', `/drafts/${today.draft.id}`)).data;
  assert.ok(['long', 'roundup'].includes(d.format));
  const relay = (await api('GET', '/stories')).data.find(s => s.title.includes('Relay'));
  const id = (await api('POST', `/stories/${relay.id}/drafts`, { channel: 'linkedin', format: 'long' })).data.draft_id;
  const long = (await api('GET', `/drafts/${id}`)).data;
  const ev = long.sections.find(s => s.kind === 'evidence');
  assert.ok(ev && /northwind\.example/.test(ev.text) && /ledger-news\.example/.test(ev.text), 'contrasts announcement with independent coverage');
});

test('article format has headline, dek, takeaways, and what-I-would-test', async () => {
  const relay = (await api('GET', '/stories')).data.find(s => s.title.includes('Relay'));
  const id = (await api('POST', `/stories/${relay.id}/drafts`, { channel: 'linkedin', format: 'article' })).data.draft_id;
  const d = (await api('GET', `/drafts/${id}`)).data;
  for (const k of ['headline', 'dek', 'evidence', 'test', 'takeaways', 'sources']) assert.ok(d.sections.some(s => s.kind === k), k);
});

test('approval requires two credible independent sources; commentary does not count', async () => {
  const stories = (await api('GET', '/stories')).data;
  const single = stories.find(s => s.title.startsWith('Hot take'));
  const id = (await api('POST', `/stories/${single.id}/drafts`, { channel: 'linkedin', format: 'short' })).data.draft_id;
  const d = (await api('GET', `/drafts/${id}`)).data;
  const thin = d.flags.find(f => f.type === 'thin_evidence');
  assert.ok(thin && thin.blocking);
  assert.equal((await api('POST', `/drafts/${id}/approve`, { hash: d.current_hash })).status, 400);
});

test('de-emphasized topics lower a story and the explanation says why', async () => {
  const r = await api('POST', '/intake/manual', { url: 'https://paste.example/funding', title: 'Startup raises Series B funding round at record valuation for AI agents', text: 'The company raised a Series B funding round at a record valuation, investors said.' });
  const st = (await api('GET', `/stories/${r.data.story_id}?mark_viewed=0`)).data.story;
  assert.match(st.explanation, /de-emphasized/);
});

test('weekly roundup is idempotent per week', async () => {
  const a = (await api('POST', '/weekly-roundup', {})).data;
  const b = (await api('POST', '/weekly-roundup', {})).data;
  assert.ok(a.draft_id);
  assert.equal(b.created, false);
  assert.equal(b.draft_id, a.draft_id);
});

test('next open posting slot lands on a posting day', async () => {
  const { date } = (await api('GET', '/slots/next')).data;
  assert.ok(['Mon', 'Wed', 'Fri'].includes(new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })));
});

test('calendar feed needs its token and returns iCalendar', async () => {
  const st = (await api('GET', '/status')).data;
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/calendar.ics?token=wrong`)).status, 403);
  const res = await fetch(`http://127.0.0.1:${PORT}${st.ics_path}`);
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /BEGIN:VCALENDAR/);
  assert.match(body, /open posting slot/);
});

test('digest renders and delivery reports unconfigured channels without failing', async () => {
  const date = (await api('GET', '/today')).data.brief.run_date;
  assert.match((await api('GET', `/briefs/${date}/digest`)).data.html, /Today’s briefing/);
  const r = (await api('POST', `/briefs/${date}/deliver`, { force: true })).data;
  assert.match(r.email, /not configured/);
  assert.match(r.push, /not configured/);
});

test('diagram visual is generated with alt text', async () => {
  const id = (await api('GET', '/today')).data.draft.id;
  const d = (await api('POST', `/drafts/${id}/visual`, { kind: 'diagram' })).data;
  assert.equal(d.image.origin, 'diagram');
  assert.match(d.image.alt, /Four-step diagram/);
});

test('password mode: API locked until sign-in; proxied access refused without a password', async () => {
  assert.equal((await api('GET', '/status', null, PW_PORT)).status, 401);
  assert.equal((await api('POST', '/login', { password: 'nope' }, PW_PORT)).status, 401);
  const ok = await api('POST', '/login', { password: 'correct horse' }, PW_PORT);
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await api('GET', '/status', null, PW_PORT, { Cookie: cookie })).status, 200);
  // No-password server refuses tunnel/proxy traffic.
  assert.equal((await api('GET', '/status', null, PORT, { 'CF-Connecting-IP': '203.0.113.9' })).status, 403);
});

test('contacts keep segment and KSU alumni flag', async () => {
  const c = (await api('POST', '/contacts', { name: 'Test Alumna', segment: 'ksu_alumni', ksu_alumni: true })).data;
  assert.equal(c.segment, 'ksu_alumni');
  assert.equal(c.ksu_alumni, 1);
  const fu = (await api('GET', '/followups')).data;
  assert.equal(fu.week.goal, 3);
});
