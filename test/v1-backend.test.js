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
