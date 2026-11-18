// TOTP module (RFC 4226 / RFC 6238 vectors) and the optional second factor on sign-in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { base32Encode, base32Decode, hotp, totp, verify, generateSecret, otpauthUrl, groupKey } from '../src/totp.js';

const RFC_KEY = Buffer.from('12345678901234567890');
const RFC_SECRET = base32Encode(RFC_KEY);

test('base32 round-trips and matches RFC 4648 vectors', () => {
  const vectors = { '': '', f: 'MY', fo: 'MZXQ', foo: 'MZXW6', foob: 'MZXW6YQ', fooba: 'MZXW6YTB', foobar: 'MZXW6YTBOI' };
  for (const [plain, enc] of Object.entries(vectors)) {
    assert.equal(base32Encode(Buffer.from(plain)), enc);
    assert.equal(base32Decode(enc).toString(), plain);
  }
  assert.equal(base32Decode('mzxw 6ytb-oi======').toString(), 'foobar');
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.throws(() => base32Decode('MZ1W'));
});

test('HOTP matches RFC 4226 appendix D', () => {
  const want = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  want.forEach((code, c) => assert.equal(hotp(RFC_KEY, c), code));
});

test('TOTP matches RFC 6238 appendix B (SHA-1, 8 digits) and its 6-digit truncation', () => {
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [t, code] of vectors) {
    assert.equal(totp(RFC_SECRET, t * 1000, { digits: 8 }), code);
    assert.equal(totp(RFC_SECRET, t * 1000), code.slice(-6));
  }
});

test('verify accepts ±1 step, rejects replays, malformed and out-of-window codes', () => {
  const secret = generateSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const t = 1_700_000_000_000;
  assert.equal(verify(secret, totp(secret, t - 60e3), 1, t), false, 'two steps back is outside the window');
  assert.equal(verify(secret, '12345', 1, t), false);
  assert.equal(verify(secret, 'abcdef', 1, t), false);
  assert.equal(verify(secret, null, 1, t), false);
  assert.equal(verify('', totp(secret, t), 1, t), false);
  assert.equal(verify(secret, totp(secret, t - 30e3), 1, t), true, 'previous step allowed');
  assert.equal(verify(secret, totp(secret, t - 30e3), 1, t), false, 'same code twice is a replay');
  const cur = totp(secret, t);
  assert.equal(verify(secret, cur.slice(0, 3) + ' ' + cur.slice(3), 1, t), true, 'spaces ignored');
  assert.equal(verify(secret, cur, 1, t), false, 'replay of current step');
  assert.equal(verify(secret, totp(secret, t + 30e3), 1, t), true, 'next step allowed once');
  assert.equal(verify(secret, totp(secret, t), 1, t + 30e3), false, 'an older step after a newer one is refused');
  // Another secret has its own replay state.
  const other = generateSecret();
  assert.equal(verify(other, totp(other, t), 1, t), true);
});

test('otpauth URL and grouped key', () => {
  const u = new URL(otpauthUrl(RFC_SECRET));
  assert.equal(u.protocol, 'otpauth:');
  assert.equal(u.host, 'totp');
  assert.equal(decodeURIComponent(u.pathname), '/Byline');
  assert.equal(u.searchParams.get('secret'), RFC_SECRET);
  assert.equal(u.searchParams.get('issuer'), 'Byline');
  assert.equal(u.searchParams.get('digits'), '6');
  assert.equal(u.searchParams.get('period'), '30');
  assert.equal(decodeURIComponent(new URL(otpauthUrl(RFC_SECRET, 'perry')).pathname), '/Byline:perry');
  assert.equal(groupKey('ABCDEFGHIJ'), 'ABCD EFGH IJ');
});

// ----- server: enrollment and sign-in with a code -----
const PORT = 4391;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-totp-'));
let proc;
const call = async (method, p, { body, cookie, headers = {} } = {}) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api${p}`, { method, redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};

before(async () => {
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    env: { ...process.env, PORT: String(PORT), BYLINE_DATA_DIR: dir, BYLINE_PASSWORD: 'pw', BYLINE_TOTP_ALWAYS: '1', BYLINE_TOTP_SECRET: '', ANTHROPIC_API_KEY: '', RESEND_API_KEY: '', NTFY_TOPIC: '' }, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/login`); return; } catch { await new Promise(r => setTimeout(r, 100)); } }
});
after(() => { proc?.kill(); fs.rmSync(dir, { recursive: true, force: true }); });

test('enroll, sign in with a code, never leak the secret, disable', async () => {
  // Before enrollment the password alone signs in, even with BYLINE_TOTP_ALWAYS.
  assert.deepEqual((await call('GET', '/login')).data, { totp: false });
  const first = await call('POST', '/login', { body: { password: 'pw' } });
  assert.equal(first.status, 200);
  const cookie = first.cookie;
  assert.match(cookie, /^byline_session=/);
  assert.equal((await call('GET', '/security')).status, 401, 'security API needs a session');
  const sec0 = (await call('GET', '/security', { cookie })).data;
  assert.equal(sec0.password_set, true);
  assert.equal(sec0.totp_enabled, false);
  assert.equal(sec0.totp_required_now, false);

  // Stay clear of a step boundary so the -1/0/+1 codes below all fall in one window.
  const into = (Date.now() / 1000) % 30;
  if (into > 24) await new Promise(r => setTimeout(r, (30 - into + 0.5) * 1000));

  const begin = await call('POST', '/security/totp/begin', { cookie });
  assert.equal(begin.status, 200);
  const { secret, otpauth } = begin.data;
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.ok(otpauth.includes(`secret=${secret}`));
  assert.equal((await call('GET', '/security', { cookie })).data.totp_enabled, false, 'pending is not active');
  assert.equal((await call('POST', '/security/totp/confirm', { cookie, body: { code: '000000' } })).status, 400);
  const conf = await call('POST', '/security/totp/confirm', { cookie, body: { code: totp(secret, Date.now() - 30e3) } });
  assert.equal(conf.status, 200, JSON.stringify(conf.data));

  const sec1 = (await call('GET', '/security', { cookie })).data;
  assert.equal(sec1.totp_enabled, true);
  assert.equal(sec1.totp_required_now, true);
  assert.ok(!JSON.stringify(sec1).includes(secret));
  const settings = await call('GET', '/settings', { cookie });
  assert.ok(!JSON.stringify(settings.data).includes(secret), 'settings API never returns the secret');
  assert.equal((await call('PUT', '/settings', { cookie, body: { totp_secret: null } })).status, 200);
  assert.equal((await call('GET', '/security', { cookie })).data.totp_enabled, true, 'settings API cannot clear it');
  assert.equal((await call('POST', '/security/totp/begin', { cookie })).status, 409, 'no re-enroll while active');

  // Sign-in now needs the code.
  assert.deepEqual((await call('GET', '/login')).data, { totp: true });
  const noCode = await call('POST', '/login', { body: { password: 'pw' } });
  assert.equal(noCode.status, 401);
  assert.equal(noCode.data.code_required, true);
  assert.equal((await call('POST', '/login', { body: { password: 'pw', code: '123456' } })).status, 401);
  assert.equal((await call('POST', '/login', { body: { password: 'nope', code: totp(secret) } })).status, 401);
  const ok = await call('POST', '/login', { body: { password: 'pw', code: totp(secret) } });
  assert.equal(ok.status, 200);
  assert.match(ok.cookie, /^byline_session=/);
  assert.equal((await call('POST', '/login', { body: { password: 'pw', code: totp(secret) } })).status, 401, 'a code works once');

  assert.equal((await call('POST', '/security/totp/disable', { cookie, body: { code: '111111' } })).status, 400);
  const off = await call('POST', '/security/totp/disable', { cookie, body: { code: totp(secret, Date.now() + 30e3) } });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal((await call('GET', '/security', { cookie })).data.totp_enabled, false);
  assert.deepEqual((await call('GET', '/login')).data, { totp: false });
});
