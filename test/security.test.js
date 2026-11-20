// Security hardening (A2): Origin check, settings allow-list, SSRF guard on fetch routes, body cap, remote access
// without a password, read-only GET /api/stories/:id, and running behind `tailscale serve` (X-Forwarded-* headers).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const servers = [];
async function boot(port, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-sec-'));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    env: { ...process.env, PORT: String(port), BYLINE_DATA_DIR: dataDir, BYLINE_PASSWORD: '', BYLINE_TOTP_SECRET: '', BYLINE_PUBLIC_URL: '', BYLINE_ALLOWED_ORIGINS: '', ANTHROPIC_API_KEY: '', NTFY_TOPIC: '', ...env },
    stdio: process.env.SEC_DEBUG ? 'inherit' : 'ignore'
  });
  servers.push({ child, dataDir });
  for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/api/login`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  return async (method, p, { body, headers = {} } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${p}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, headers: res.headers, data };
  };
}

let open, locked;
const LOCKED_PORT = 4386;
before(async () => {
  open = await boot(4385);
  locked = await boot(LOCKED_PORT, { BYLINE_PASSWORD: 'pw', BYLINE_ALLOWED_ORIGINS: 'https://byline.example.org' });
});
after(() => { for (const s of servers) { s.child.kill(); fs.rmSync(s.dataDir, { recursive: true, force: true }); } });

test('Origin check: cross-site writes are refused, same-origin and header-less writes pass', async () => {
  const body = { brief_size: 6 };
  assert.equal((await open('PUT', '/settings', { body, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await open('PUT', '/settings', { body, headers: { Origin: 'null' } })).status, 403);
  assert.equal((await open('PUT', '/settings', { body, headers: { Referer: 'https://evil.example/page' } })).status, 403);
  assert.equal((await open('PUT', '/settings', { body, headers: { Origin: 'http://127.0.0.1:4385' } })).status, 200);
  assert.equal((await open('PUT', '/settings', { body, headers: { Origin: 'http://localhost:4385' } })).status, 200);
  assert.equal((await open('PUT', '/settings', { body })).status, 200, 'no Origin/Referer (curl, scripts) passes');
  assert.equal((await open('GET', '/settings', { headers: { Origin: 'https://evil.example' } })).status, 200, 'reads are not blocked');
});

test('settings allow-list: unknown and protected keys are refused, known keys save', async () => {
  const bad = await open('PUT', '/settings', { body: { ics_token: 'x', brief_size: 7 } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /ics_token/);
  assert.equal((await open('PUT', '/settings', { body: { made_up: 1 } })).status, 400);
  assert.equal((await open('PUT', '/settings', { body: [1, 2] })).status, 400);
  const ok = await open('PUT', '/settings', { body: { brief_size: 7, posting_days: ['Mon', 'Thu'] } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.brief_size, 7);
  assert.notEqual((await open('GET', '/settings')).data.ics_token, 'x');
});

test('SSRF: intake and image import refuse loopback, private and metadata addresses', async () => {
  for (const url of ['http://127.0.0.1:4385/api/settings', 'http://localhost:4385/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'http://[::1]:4385/', 'file:///etc/passwd']) {
    const r = await open('POST', '/intake/url', { body: { url } });
    assert.equal(r.status, 400, `${url} → ${r.status} ${JSON.stringify(r.data)}`);
  }
  const img = await open('POST', '/images/import', { body: { url: 'http://192.168.1.1/a.png', attribution: 'x', license: 'y' } });
  assert.equal(img.status, 400);
  assert.match(img.data.error, /Blocked/);
});

test('body cap: requests over 25 MB are refused with 413', async () => {
  const res = await fetch('http://127.0.0.1:4385/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': String(26e6) }, body: 'x'.repeat(1024) }).catch(e => ({ status: e.cause?.code || 'reset' }));
  assert.ok(res.status === 413 || typeof res.status === 'string', `got ${res.status}`);
});

test('GET /api/stories/:id is read-only; POST /viewed marks it seen', async () => {
  const made = await open('POST', '/intake/manual', { body: { url: 'https://example.com/a-new-eval-benchmark', title: 'A new agent evaluation benchmark for enterprise workflows', text: 'Researchers released a benchmark that measures agent orchestration on 40 enterprise workflows.' } });
  const id = made.data.story_id;
  assert.ok(id, JSON.stringify(made.data));
  await open('GET', `/stories/${id}`);
  await open('GET', `/stories/${id}`);
  const list = (await open('GET', '/stories')).data.find(s => s.id === id);
  assert.equal(list.last_viewed_at, null, 'GET did not mark it viewed');
  assert.equal(list.lens_json ?? list.lens ?? null, null, 'GET did not store a lens');
  const v = await open('POST', `/stories/${id}/viewed`);
  assert.equal(v.status, 200);
  const after = (await open('GET', '/stories')).data.find(s => s.id === id);
  assert.ok(after.last_viewed_at);
  assert.notEqual(after.status, 'new');
});

test('remote access without a password is refused (LAN or proxied)', async () => {
  const r = await open('GET', '/status', { headers: { 'X-Forwarded-For': '100.101.102.103' } });
  assert.equal(r.status, 403);
  assert.match(String(r.data), /no password is set/);
});

test('behind tailscale serve: login over the forwarded HTTPS origin, Secure cookie, Origin accepted', async () => {
  const ts = { Host: 'pc-name.tailnet-abc.ts.net', 'X-Forwarded-For': '100.64.1.2', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'pc-name.tailnet-abc.ts.net', Origin: 'https://pc-name.tailnet-abc.ts.net' };
  assert.equal((await locked('GET', '/status', { headers: ts })).status, 401, 'signed out');
  const login = await locked('POST', '/login', { body: { password: 'pw' }, headers: ts });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /HttpOnly/);
  const session = cookie.split(';')[0];
  assert.equal((await locked('GET', '/status', { headers: { ...ts, Cookie: session } })).status, 200);
  assert.equal((await locked('PUT', '/settings', { body: { brief_size: 5 }, headers: { ...ts, Cookie: session } })).status, 200, 'ts.net origin accepted');
  // Host rewritten by the proxy to 127.0.0.1: the origin still matches through X-Forwarded-Host
  assert.equal((await locked('PUT', '/settings', { body: { brief_size: 5 }, headers: { ...ts, Host: `127.0.0.1:${LOCKED_PORT}`, Cookie: session } })).status, 200);
  // and through BYLINE_ALLOWED_ORIGINS when no forwarded host is sent at all
  assert.equal((await locked('PUT', '/settings', { body: { brief_size: 5 }, headers: { Origin: 'https://byline.example.org', 'X-Forwarded-For': '100.64.1.2', Cookie: session } })).status, 200);
  assert.equal((await locked('PUT', '/settings', { body: { brief_size: 5 }, headers: { ...ts, Origin: 'https://evil.example', Cookie: session } })).status, 403);
  const plain = await locked('POST', '/login', { body: { password: 'pw' } });
  assert.doesNotMatch(plain.headers.get('set-cookie'), /Secure/, 'plain loopback http gets no Secure flag');
});

test('a proxy that only sends X-Forwarded-Proto or the original Host still counts as remote', async () => {
  assert.equal((await open('GET', '/status', { headers: { 'X-Forwarded-Proto': 'https' } })).status, 403);
  // fetch() won't send a custom Host, so this one goes through node:http
  const { request } = await import('node:http');
  const viaHost = await new Promise((resolve, reject) => request({ host: '127.0.0.1', port: 4385, path: '/api/status', headers: { Host: 'pc-name.tailnet-abc.ts.net' } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject).end());
  assert.equal(viaHost, 403);
  assert.equal((await open('GET', '/status', { headers: { 'Tailscale-User-Login': 'me@example.com' } })).status, 403);
  assert.equal((await open('GET', '/status')).status, 200, 'plain localhost without a password still works');
  assert.deepEqual((await locked('GET', '/health')).data, { ok: true }, 'health is public');
});
