// End-to-end acceptance checks against a real server on an isolated data directory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4399;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-test-'));
let server;
const api = async (method, p, body) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  return { status: res.status, data };
};

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { env: { ...process.env, PORT: String(PORT), BYLINE_DATA_DIR: dataDir, ANTHROPIC_API_KEY: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/status`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  // Pause the real feeds so the test never depends on the network.
  for (const s of (await api('GET', '/sources')).data) await api('PATCH', `/sources/${s.id}`, { paused: true });
  await api('POST', '/demo/load');
});
after(() => { server.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('RSS feed can be added from the API', async () => {
  const r = await api('POST', '/sources', { name: 'Test feed', kind: 'rss', url: 'https://feeds.example/rss', grp: 'News' });
  assert.equal(r.status, 200);
  assert.equal(r.data.name, 'Test feed');
});

test('manual URL intake falls back to pasted text and creates a story', async () => {
  const r = await api('POST', '/intake/manual', { url: 'https://paste.example/a', title: 'A pasted article about agent evaluation metrics', text: 'Teams reported that evaluation harnesses reduced agent errors by 12%.' });
  assert.equal(r.status, 200);
  assert.ok(r.data.story_id);
});

test('multiple sources covering one announcement are one story with separate links', async () => {
  const stories = (await api('GET', '/stories')).data;
  const relay = stories.find(s => s.title.includes('Relay'));
  assert.ok(relay, 'Relay story exists');
  assert.equal(relay.article_count, 3);
  const detail = (await api('GET', `/stories/${relay.id}`)).data;
  assert.equal(new Set(detail.articles.map(a => a.url)).size, 3);
  assert.equal(detail.origin.evidence_kind, 'announcement');
});

test('daily run produces a source-backed brief and a draft with a visual; reruns do not duplicate', async () => {
  const today = (await api('GET', '/today')).data;
  assert.ok(today.brief.items.length > 0);
  assert.ok(today.draft, 'draft created');
  const d = (await api('GET', `/drafts/${today.draft.id}`)).data;
  assert.ok(d.image_id, 'visual attached');
  assert.ok(d.articles.length > 0, 'sources attached');
  const before = (await api('GET', '/drafts?all=1')).data.length;
  const rerun = await api('POST', '/runs', {});
  assert.equal(rerun.data.status, 'done');
  assert.equal(rerun.data.stats.draft.created, false);
  assert.equal((await api('GET', '/drafts?all=1')).data.length, before);
});

test('perspective notes and locked edits survive rewrite and regenerate', async () => {
  const id = (await api('GET', '/today')).data.draft.id;
  let d = (await api('GET', `/drafts/${id}`)).data;
  await api('POST', `/drafts/${id}/notes`, { text: 'I would want a baseline before trusting the 38% figure.', include: true });
  await api('POST', `/drafts/${id}/notes`, { text: 'Private: mention this in my interview prep.', include: false });
  d = (await api('POST', `/drafts/${id}/apply-notes`)).data;
  assert.match(d.sections.find(s => s.kind === 'perspective').text, /baseline/);
  const hook = d.sections.find(s => s.kind === 'hook');
  const sections = d.sections.map(s => s.id === hook.id ? { ...s, text: 'My own locked hook.', locked: true } : s);
  d = (await api('PATCH', `/drafts/${id}`, { sections })).data;
  const closing = d.sections.find(s => s.kind === 'closing');
  d = (await api('POST', `/drafts/${id}/regenerate`, { section_id: closing.id })).data;
  d = (await api('POST', `/drafts/${id}/regenerate`, {})).data;
  assert.equal(d.sections.find(s => s.id === hook.id).text, 'My own locked hook.');
  assert.equal(d.notes.length, 2);
  assert.ok(!d.final_text.includes('interview prep'), 'private note stays out of public text');
  assert.ok(d.versions.length >= 3, 'versions saved');
  const locked = await api('POST', `/drafts/${id}/regenerate`, { section_id: hook.id });
  assert.equal(locked.status, 400);
});

test('evidence, copy text, and export work without LinkedIn; private notes excluded', async () => {
  const id = (await api('GET', '/today')).data.draft.id;
  const exp = (await api('GET', `/drafts/${id}/export`)).data;
  assert.ok(exp.text.length > 50);
  assert.match(exp.source_notes, /## Claims and evidence/);
  assert.ok(!exp.source_notes.includes('interview prep'));
  assert.ok(exp.image.filename);
  const img = await fetch(`http://127.0.0.1:${PORT}/media/${exp.image.filename}`);
  assert.equal(img.status, 200);
});

test('publishing requires approval of the current text and image; edits return to review', async () => {
  const id = (await api('GET', '/today')).data.draft.id;
  let d = (await api('GET', `/drafts/${id}`)).data;
  assert.equal((await api('POST', `/drafts/${id}/mark-published`, {})).status, 400);
  assert.equal((await api('POST', `/drafts/${id}/approve`, { hash: 'stale' })).status, 409);
  d = (await api('POST', `/drafts/${id}/approve`, { hash: d.current_hash })).data;
  assert.equal(d.status, 'approved');
  // Direct publishing is not connected in tests → refused with guidance, never silently posted.
  const pub = await api('POST', `/drafts/${id}/publish`, { confirm_hash: d.current_hash });
  assert.equal(pub.status, 400);
  // Editing alt text of the approved image returns the draft to review.
  await api('PATCH', `/images/${d.image_id}`, { alt: 'Changed alt text' });
  d = (await api('GET', `/drafts/${id}`)).data;
  assert.equal(d.status, 'in_review');
  assert.equal(d.approval_valid, false);
});

test('a public source becomes LinkedIn, Instagram, video, and mentoring drafts', async () => {
  const id = (await api('GET', '/today')).data.draft.id;
  const ig = (await api('POST', `/drafts/${id}/adapt`, { channel: 'instagram', format: 'carousel' })).data.draft_id;
  const vid = (await api('POST', `/drafts/${id}/adapt`, { channel: 'video', format: 'explainer' })).data.draft_id;
  const igd = (await api('GET', `/drafts/${ig}`)).data;
  assert.ok(igd.sections.filter(s => s.kind === 'slide').length >= 4);
  assert.deepEqual(igd.articles.map(a => a.url).sort(), (await api('GET', `/drafts/${id}`)).data.articles.map(a => a.url).sort());
  const render = await api('POST', `/drafts/${vid}/render`, { orientation: 'vertical' });
  assert.equal(render.status, 200, JSON.stringify(render.data));
  assert.ok(fs.existsSync(path.join(dataDir, 'media', render.data.mp4)));
  assert.ok(fs.existsSync(path.join(dataDir, 'media', render.data.srt)));
  const contact = (await api('GET', '/contacts')).data[0];
  const o = (await api('POST', `/contacts/${contact.id}/outreach`, { purpose: 'mentorship', channel: 'email' })).data;
  assert.ok(o.body.length > 20);
  assert.ok(o.basis.length > 0, 'shows what informed the draft');
});

test('outreach: approval covers recipient, message, and time; sends are idempotent; DNC blocks', async () => {
  const contact = (await api('GET', '/contacts')).data[0];
  let o = (await api('POST', `/contacts/${contact.id}/outreach`, { purpose: 'informational', channel: 'short' })).data;
  assert.ok(o.body.length <= 200);
  o = (await api('PATCH', `/outreach/${o.id}`, { recipient: 'https://linkedin.example/in/demo', send_at: '2026-12-01T10:00' })).data;
  o = (await api('POST', `/outreach/${o.id}/approve`, { hash: o.current_hash })).data;
  assert.equal(o.status, 'approved');
  o = (await api('PATCH', `/outreach/${o.id}`, { send_at: '2026-12-02T10:00' })).data;
  assert.equal(o.status, 'in_review');
  o = (await api('POST', `/outreach/${o.id}/approve`, { hash: o.current_hash })).data;
  await api('POST', `/outreach/${o.id}/sent`);
  await api('POST', `/outreach/${o.id}/sent`);
  const c = (await api('GET', `/contacts/${contact.id}`)).data;
  assert.equal(c.interactions.filter(i => i.kind === 'message_sent').length, 1);
  await api('PATCH', `/contacts/${contact.id}`, { dnc: true });
  assert.equal((await api('POST', `/contacts/${contact.id}/outreach`, { purpose: 'peer', channel: 'email' })).status, 400);
});

test('employer tag can be removed without rewriting the post', async () => {
  const id = (await api('GET', '/today')).data.draft.id;
  let d = (await api('GET', `/drafts/${id}`)).data;
  const sections = d.sections.map(s => s.kind === 'closing' ? { ...s, text: 'Snowflake has written about data quality checks for this.' } : s);
  d = (await api('PATCH', `/drafts/${id}`, { sections })).data;
  d = (await api('POST', `/drafts/${id}/tags/suggest`)).data;
  const tag = d.tags.find(t => t.name === 'Snowflake');
  assert.ok(tag && tag.sentence.includes('Snowflake'));
  d = (await api('PATCH', `/drafts/${id}`, { tags: d.tags.map(t => ({ ...t, enabled: t.name === 'Snowflake' })) })).data;
  assert.match(d.final_text, /@Snowflake/);
  const textBefore = JSON.stringify(d.sections);
  d = (await api('PATCH', `/drafts/${id}`, { tags: d.tags.map(t => ({ ...t, enabled: false })) })).data;
  assert.ok(!d.final_text.includes('@Snowflake'));
  assert.equal(JSON.stringify(d.sections), textBefore);
});
