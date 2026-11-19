import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR, getSettings, setSetting } from './src/db.js';
import { registerContent } from './src/routes/content.js';
import { registerDrafts } from './src/routes/drafts.js';
import { registerCareer } from './src/routes/career.js';
import { registerMap } from './src/routes/map.js';
import { startScheduler } from './src/scheduler.js';
import { seedDefaults } from './src/seed.js';
import crypto from 'node:crypto';
import { icsFeed, icsToken } from './src/ics.js';
import * as totp from './src/totp.js';

seedDefaults();

const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.resolve('public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.srt': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.ics': 'text/calendar' };

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};
registerContent(route);
registerDrafts(route);
registerCareer(route);
registerMap(route);

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > 300e6) throw Object.assign(new Error('Body too large'), { status: 413 }); chunks.push(c); }
  if (!size) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Invalid JSON body'), { status: 400 }); }
}

function sendFile(res, file, download) {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': stat.size, 'X-Content-Type-Options': 'nosniff' };
  if (ext === '.svg') headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; font-src data:";
  if (download) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
  // App code must never go stale in the browser; fonts and icons rarely change and can be cached.
  if (['.html', '.js', '.css', '.webmanifest'].includes(ext)) headers['Cache-Control'] = 'no-cache';
  else if (ext === '.woff2' || file.includes(`${path.sep}icons${path.sep}`)) headers['Cache-Control'] = 'public, max-age=604800';
  res.writeHead(200, headers);
  fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
}

// ----- access control -----
// Local use needs no password. Before exposing Byline (Cloudflare Tunnel, LAN, VPS), set BYLINE_PASSWORD.
const PASSWORD = process.env.BYLINE_PASSWORD || '';
const SECRET = crypto.createHash('sha256').update(`byline-session:${PASSWORD}`).digest();
const PUBLIC_PATHS = new Set(['/login', '/login.html', '/api/login', '/manifest.webmanifest', '/sw.js', '/css/v4/tokens.css']);
const attempts = new Map();
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('base64url');
const cookieOf = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(([k]) => k));
function validSession(req) {
  const [exp, sig] = (cookieOf(req).byline_session || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp);
  return good.length === sig.length && crypto.timingSafeEqual(Buffer.from(good), Buffer.from(sig));
}
const proxied = (req) => !!(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']);
const loopback = (addr = '') => addr === '::1' || addr.startsWith('127.') || addr.startsWith('::ffff:127.');
// Remote = arrived through a proxy/tunnel, or from another machine on the network.
const remote = (req) => proxied(req) || !loopback(req.socket.remoteAddress);

// ----- optional TOTP second factor -----
// The secret comes from BYLINE_TOTP_SECRET, or from the `totp_secret` setting enrolled in Settings → Security.
// A code is required at sign-in for remote requests, or always with BYLINE_TOTP_ALWAYS=1. It only ever applies
// on top of BYLINE_PASSWORD: plain localhost without a password never asks for one.
const ENV_TOTP = (process.env.BYLINE_TOTP_SECRET || '').replace(/[\s=-]/g, '').toUpperCase();
const TOTP_ALWAYS = process.env.BYLINE_TOTP_ALWAYS === '1';
const TOTP_KEYS = ['totp_secret', 'totp_pending'];
const totpSecret = () => ENV_TOTP || getSettings().totp_secret || '';
const totpRequired = (req) => !!PASSWORD && !!totpSecret() && (TOTP_ALWAYS || remote(req));
// Settings rows that hold TOTP material never leave the server or change through the generic settings API.
const redactSettings = (pathname, out) => {
  if (pathname === '/api/settings' && out && typeof out === 'object') for (const k of TOTP_KEYS) delete out[k];
  return out;
};
const guardSettingsBody = (pathname, body) => {
  if (pathname === '/api/settings' && body && typeof body === 'object') for (const k of TOTP_KEYS) delete body[k];
  return body;
};
const fail = (msg, status = 400) => Object.assign(new Error(msg), { status });
const notEnvManaged = () => { if (ENV_TOTP) throw fail('Two-step sign-in is set by BYLINE_TOTP_SECRET on the server. Change or remove it there.', 409); };

route('GET', '/api/security', ({ req }) => ({
  password_set: !!PASSWORD, totp_enabled: !!totpSecret(), totp_source: ENV_TOTP ? 'env' : (totpSecret() ? 'settings' : null),
  totp_always: TOTP_ALWAYS, totp_required_now: totpRequired(req), totp_pending: !!getSettings().totp_pending?.secret
}));
route('POST', '/api/security/totp/begin', () => {
  notEnvManaged();
  if (totpSecret()) throw fail('Two-step sign-in is already on. Turn it off first to enroll a new device.', 409);
  const secret = totp.generateSecret();
  setSetting('totp_pending', { secret, created_at: new Date().toISOString() });
  return { secret, otpauth: totp.otpauthUrl(secret) };
});
route('POST', '/api/security/totp/confirm', ({ body }) => {
  notEnvManaged();
  const pending = getSettings().totp_pending;
  if (!pending?.secret) throw fail('Start enrollment first.', 409);
  if (Date.now() - Date.parse(pending.created_at) > 30 * 60e3) { setSetting('totp_pending', null); throw fail('Enrollment expired. Start again.', 410); }
  if (!totp.verify(pending.secret, body.code)) throw fail('That code didn’t match. Check the time on your phone and try the next code.', 400);
  setSetting('totp_secret', pending.secret);
  setSetting('totp_pending', null);
  return { ok: true, totp_enabled: true };
});
route('POST', '/api/security/totp/disable', ({ body }) => {
  notEnvManaged();
  const secret = totpSecret();
  if (!secret) throw fail('Two-step sign-in is not on.', 409);
  if (!totp.verify(secret, body.code)) throw fail('That code didn’t match.', 400);
  setSetting('totp_secret', null);
  return { ok: true, totp_enabled: false };
});

async function handleLogin(req, res) {
  const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress;
  const a = (attempts.get(ip) || []).filter(t => Date.now() - t < 15 * 60e3);
  if (a.length >= 10) { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Too many attempts. Try again in 15 minutes.' })); }
  const body = await readBody(req);
  const given = crypto.createHash('sha256').update(String(body.password || '')).digest();
  const want = crypto.createHash('sha256').update(PASSWORD).digest();
  if (!PASSWORD || !crypto.timingSafeEqual(given, want)) {
    attempts.set(ip, [...a, Date.now()]);
    res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Wrong password.' }));
  }
  if (totpRequired(req)) {
    // Wrong or missing codes count against the same limiter as wrong passwords.
    const code = String(body.code || '').replace(/\s/g, '');
    if (!code) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Enter the 6-digit code from your authenticator app.', code_required: true })); }
    if (!totp.verify(totpSecret(), code)) {
      attempts.set(ip, [...a, Date.now()]);
      res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'That code didn’t match. Wait for the next one and try again.', code_required: true }));
    }
  }
  const exp = String(Date.now() + 30 * 864e5);
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `byline_session=${exp}.${sign(exp)}; Path=/; Max-Age=${30 * 86400}; HttpOnly; SameSite=Lax${secure}` });
  res.end(JSON.stringify({ ok: true }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/calendar.ics') {
      if (url.searchParams.get('token') !== icsToken()) { res.writeHead(403); return res.end('Invalid calendar token'); }
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
      return res.end(icsFeed());
    }
    if (url.pathname === '/api/login' && req.method === 'POST') return handleLogin(req, res);
    if (url.pathname === '/api/login' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ totp: totpRequired(req) }));
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'byline_session=; Path=/; Max-Age=0' });
      return res.end('{"ok":true}');
    }
    if (!PASSWORD && proxied(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Byline is being reached through a proxy or tunnel but no password is set. Set BYLINE_PASSWORD and restart before exposing it.');
    }
    if (PASSWORD && !PUBLIC_PATHS.has(url.pathname) && !url.pathname.startsWith('/icons/') && !url.pathname.startsWith('/fonts/') && !validSession(req)) {
      if (url.pathname.startsWith('/api/')) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Sign in required' })); }
      res.writeHead(302, { Location: '/login' }); return res.end();
    }
    if (url.pathname === '/login') return sendFile(res, path.join(PUBLIC, 'login.html'));
    if (url.pathname.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = guardSettingsBody(url.pathname, ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {});
        const out = redactSettings(url.pathname, await r.handler({ params, query: Object.fromEntries(url.searchParams), body, req, res }));
        if (res.headersSent) return; // handler wrote its own response (e.g. /api/map with ETag / 304)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(out ?? { ok: true }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not found' }));
    }
    if (url.pathname.startsWith('/media/')) {
      const file = path.join(MEDIA_DIR, path.basename(decodeURIComponent(url.pathname.slice(7))));
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); } // '/media/' alone is the directory: never stream it
      return sendFile(res, file, url.searchParams.has('download'));
    }
    let file = path.join(PUBLIC, path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, ''));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    return sendFile(res, file);
  } catch (e) {
    if (!e.status) console.error(e);
    res.writeHead(e.status || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Byline running at http://${HOST}:${PORT}`);
  startScheduler();
});
