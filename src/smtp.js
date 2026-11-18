// Minimal SMTP client (implicit TLS, AUTH LOGIN) with no dependencies.
// Works with Gmail using an App Password: SMTP_USER=you@gmail.com, SMTP_PASS=<16-char app password>.
import tls from 'node:tls';
import net from 'node:net';
import crypto from 'node:crypto';

export const smtpConfig = () => ({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  secure: process.env.SMTP_SECURE !== 'false'
});
export const smtpConfigured = () => { const c = smtpConfig(); return !!(c.user && c.pass); };

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const encodeHeader = (s) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
const addr = (s) => (String(s).match(/<([^>]+)>/) || [null, String(s)])[1].trim();

export function buildMessage({ from, to, subject, text, html, messageId }) {
  const boundary = `b_${crypto.randomBytes(8).toString('hex')}`;
  const lines = [
    `From: ${from}`, `To: ${to}`, `Subject: ${encodeHeader(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${messageId || crypto.randomUUID()}@byline.local>`, 'MIME-Version: 1.0'
  ];
  const part = (type, body) => [`Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', b64(body).replace(/.{76}/g, '$&\r\n')].join('\r\n');
  if (html) lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, '', `--${boundary}`, part('text/plain', text || ''), `--${boundary}`, part('text/html', html), `--${boundary}--`);
  else lines.push(part('text/plain', text || ''));
  // Dot-stuffing per RFC 5321.
  return lines.join('\r\n').replace(/\r\n\./g, '\r\n..');
}

export function sendMail(msg, cfg = smtpConfig()) {
  return new Promise((resolve, reject) => {
    const sock = cfg.secure ? tls.connect({ host: cfg.host, port: cfg.port, servername: cfg.host }) : net.connect({ host: cfg.host, port: cfg.port });
    sock.setTimeout(20000, () => { sock.destroy(); reject(new Error('SMTP timeout')); });
    let buf = '';
    const queue = [];
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let m;
      // A complete reply ends with a line "NNN text" (space after the code).
      while ((m = buf.match(/^(?:\d{3}-.*\r\n)*(\d{3}) .*\r\n/))) { buf = buf.slice(m[0].length); queue.shift()?.(Number(m[1]), m[0]); }
    });
    sock.on('error', reject);
    const expect = (codes) => new Promise((res, rej) => queue.push((code, line) => codes.includes(code) ? res(code) : rej(new Error(`SMTP ${code}: ${line.trim().slice(0, 160)}`))));
    const cmd = (line, codes) => { const p = expect(codes); sock.write(line + '\r\n'); return p; };
    (async () => {
      await expect([220]);
      await cmd('EHLO byline.local', [250]);
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(cfg.user), [334]);
      await cmd(b64(cfg.pass), [235]);
      await cmd(`MAIL FROM:<${addr(msg.from || cfg.from)}>`, [250]);
      await cmd(`RCPT TO:<${addr(msg.to)}>`, [250, 251]);
      await cmd('DATA', [354]);
      await cmd(`${buildMessage({ ...msg, from: msg.from || cfg.from })}\r\n.`, [250]);
      await cmd('QUIT', [221]).catch(() => {});
      sock.end();
      resolve({ ok: true });
    })().catch((e) => { sock.destroy(); reject(e); });
  });
}
