// Integration checks with local fakes (no network, no cost): SMTP, Ollama, and the Claude request shape.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---- fake SMTP server (plain TCP) ----
const mail = [];
let smtpPort;
const smtp = net.createServer((sock) => {
  let data = false, body = '', msg = { cmds: [] };
  sock.write('220 fake ESMTP\r\n');
  sock.on('data', (chunk) => {
    for (const line of chunk.toString().split('\r\n')) {
      if (data) {
        if (line === '.') { data = false; msg.body = body; mail.push(msg); sock.write('250 queued\r\n'); msg = { cmds: [] }; body = ''; }
        else body += line + '\r\n';
        continue;
      }
      if (!line) continue;
      msg.cmds.push(line);
      if (/^EHLO/.test(line)) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
      else if (line === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
      else if (msg.cmds.length === 3) sock.write('334 UGFzc3dvcmQ6\r\n');
      else if (msg.cmds.length === 4) sock.write(Buffer.from(line, 'base64').toString() === 'app-pass' ? '235 ok\r\n' : '535 bad\r\n');
      else if (line === 'DATA') { data = true; sock.write('354 go\r\n'); }
      else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 ok\r\n');
    }
  });
});

const PORT = 4396;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-int-'));
let server;
const api = async (method, p, body) => {
  const res = await fetch(`http://127.0.0.1:${PORT}/api${p}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
};

before(async () => {
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  smtpPort = smtp.address().port;
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    env: { ...process.env, PORT: String(PORT), BYLINE_DATA_DIR: dataDir, ANTHROPIC_API_KEY: '', SMTP_HOST: '127.0.0.1', SMTP_PORT: String(smtpPort), SMTP_SECURE: 'false', SMTP_USER: 'me@example.com', SMTP_PASS: 'app-pass' },
    stdio: 'ignore'
  });
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/status`); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
});
after(() => { server.kill(); smtp.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('SMTP client authenticates and sends a MIME message', async () => {
  const { sendMail } = await import('../src/smtp.js');
  const before = mail.length;
  await sendMail({ to: 'Friend <friend@example.com>', subject: 'Héllo from Byline', text: 'Plain body', html: '<p>HTML body</p>' },
    { host: '127.0.0.1', port: smtpPort, user: 'me@example.com', pass: 'app-pass', from: 'me@example.com', secure: false });
  const m = mail[before];
  assert.ok(m.cmds.includes('RCPT TO:<friend@example.com>'));
  assert.match(m.body, /Subject: =\?UTF-8\?B\?/);
  assert.match(m.body, /multipart\/alternative/);
});

test('SMTP rejects a wrong password with a clear error', async () => {
  const { sendMail } = await import('../src/smtp.js');
  await assert.rejects(sendMail({ to: 'a@example.com', subject: 's', text: 't' }, { host: '127.0.0.1', port: smtpPort, user: 'me@example.com', pass: 'wrong', from: 'me@example.com', secure: false }), /SMTP 535/);
});

test('approved outreach email sends once through Gmail/SMTP; future send time queues instead', async () => {
  const c = (await api('POST', '/contacts', { name: 'Mail Test', email: 'mentor@example.com', email_source: 'given at career fair', details: [{ detail: 'a talk on data quality', source: 'https://example.com/talk' }] })).data;
  let o = (await api('POST', `/contacts/${c.id}/outreach`, { purpose: 'mentorship', channel: 'email' })).data;
  o = (await api('PATCH', `/outreach/${o.id}`, { send_at: new Date(Date.now() - 60e3).toISOString().slice(0, 16) })).data;
  o = (await api('POST', `/outreach/${o.id}/approve`, { hash: o.current_hash })).data;
  const before = mail.length;
  const sent = (await api('POST', `/outreach/${o.id}/send`)).data;
  assert.equal(sent.status, 'sent');
  assert.equal(mail.length, before + 1);
  await api('POST', `/outreach/${o.id}/send`);
  assert.equal(mail.length, before + 1, 'no duplicate send');
  const log = (await api('GET', `/contacts/${c.id}`)).data.interactions.filter(i => i.kind === 'message_sent');
  assert.equal(log.length, 1);

  let q = (await api('POST', `/contacts/${c.id}/outreach`, { purpose: 'informational', channel: 'email' })).data;
  q = (await api('PATCH', `/outreach/${q.id}`, { send_at: new Date(Date.now() + 864e5).toISOString().slice(0, 16) })).data;
  q = (await api('POST', `/outreach/${q.id}/approve`, { hash: q.current_hash })).data;
  q = (await api('POST', `/outreach/${q.id}/send`)).data;
  assert.equal(q.status, 'queued');
  // Editing a queued message pulls it back to review (cancels the queued send).
  q = (await api('PATCH', `/outreach/${q.id}`, { body: q.body + ' Thanks!' })).data;
  assert.equal(q.status, 'in_review');
});

test('Ollama provider parses JSON drafts and falls back to the template engine on failure', async () => {
  const { makeOllama } = await import('../src/ai/ollama.js');
  const fakeFetch = async (url, opts) => {
    const req = JSON.parse(opts.body);
    assert.equal(req.format, 'json');
    assert.match(req.messages[0].content, /untrusted_source/);
    return { ok: true, json: async () => ({ message: { content: JSON.stringify({ summary: 'Model summary.' }) }, prompt_eval_count: 10, eval_count: 5 }) };
  };
  const usage = [];
  const p = makeOllama({ model: 'qwen2.5:7b', fetchImpl: fakeFetch, onUsage: (u) => usage.push(u) });
  const story = { title: 'Test story', topics: [] };
  assert.equal(await p.summarize({ story, articles: [], claims: [] }), 'Model summary.');
  assert.equal(usage[0].cost_usd, 0);
  const broken = makeOllama({ model: 'x', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  const fallback = await broken.summarize({ story, articles: [], claims: [] });
  assert.equal(fallback, 'Test story');
});

test('Claude provider sends the documented request shape (per-task effort, fallbacks) and records cost', async () => {
  const { makeClaude } = await import('../src/ai/claude.js');
  const calls = [];
  const client = { beta: { messages: { create: async (req) => { calls.push(req); return { stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 500 }, content: [{ type: 'text', text: '{"summary":"Claude summary."}' }] }; } } } };
  const usage = [];
  const p = makeClaude({ model: 'claude-opus-5-5', client, effortFor: (op) => op === 'summarize' ? 'low' : 'medium', onUsage: (u) => usage.push(u) });
  assert.equal(await p.summarize({ story: { title: 'T', topics: [] }, articles: [], claims: [] }), 'Claude summary.');
  assert.equal(calls[0].model, 'claude-opus-5-5');
  assert.deepEqual(calls[0].output_config, { effort: 'low' });
  assert.equal(calls[0].fallbacks, 'default');
  assert.ok(!('thinking' in calls[0]) && !('temperature' in calls[0]));
  assert.equal(usage[0].cost_usd, (1000 * 4 + 500 * 20) / 1e6);
});
