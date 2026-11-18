import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR } from './src/db.js';
import { registerContent } from './src/routes/content.js';
import { registerDrafts } from './src/routes/drafts.js';
import { registerCareer } from './src/routes/career.js';
import { startScheduler } from './src/scheduler.js';
import { seedDefaults } from './src/seed.js';
import crypto from 'node:crypto';
import { icsFeed, icsToken } from './src/ics.js';

seedDefaults();

const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.resolve('public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.srt': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ics': 'text/calendar' };

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};
registerContent(route);
registerDrafts(route);
registerCareer(route);

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
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

// ----- access control -----
// Local use needs no password. Before exposing Byline (Cloudflare Tunnel, LAN, VPS), set BYLINE_PASSWORD.
const PASSWORD = process.env.BYLINE_PASSWORD || '';
const SECRET = crypto.createHash('sha256').update(`byline-session:${PASSWORD}`).digest();
const PUBLIC_PATHS = new Set(['/login', '/login.html', '/api/login', '/manifest.webmanifest', '/sw.js', '/styles.css']);
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
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'byline_session=; Path=/; Max-Age=0' });
      return res.end('{"ok":true}');
    }
    if (!PASSWORD && proxied(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Byline is being reached through a proxy or tunnel but no password is set. Set BYLINE_PASSWORD and restart before exposing it.');
    }
    if (PASSWORD && !PUBLIC_PATHS.has(url.pathname) && !url.pathname.startsWith('/icons/') && !validSession(req)) {
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
        const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
        const out = await r.handler({ params, query: Object.fromEntries(url.searchParams), body, req });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(out ?? { ok: true }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not found' }));
    }
    if (url.pathname.startsWith('/media/')) {
      const file = path.join(MEDIA_DIR, path.basename(decodeURIComponent(url.pathname.slice(7))));
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
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
