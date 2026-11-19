// Own server lifecycle for the e2e harness: spawn server.js on a fixed port, wait for /api/status,
// and always shut it down (SIGTERM, then SIGKILL) — including on Ctrl-C, uncaught errors and timeouts.
// A pid file guards against zombies: if a previous harness run died, its server is killed on the next start.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function ping(base, ms = 1500) {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    const r = await fetch(`${base}/api/status`, { signal: ac.signal });
    clearTimeout(t);
    return r.ok;
  } catch { return false; }
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function cmdline(pid) { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { return ''; } }
function envPort(pid) {
  try { const m = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').find(s => s.startsWith('PORT=')); return m ? m.slice(5) : null; } catch { return null; }
}

/** Kill a server a previous (crashed) harness run left behind, but only if it is provably ours. */
async function reapStale(pidFile, port) {
  if (!fs.existsSync(pidFile)) return null;
  const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  fs.rmSync(pidFile, { force: true });
  if (!pid || !alive(pid)) return null;
  const cl = cmdline(pid), ep = envPort(pid);
  if (!cl.includes('server.js') || (ep && ep !== String(port))) return null; // not ours: leave it alone
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 30 && alive(pid); i++) await sleep(100);
  if (alive(pid)) process.kill(pid, 'SIGKILL');
  return pid;
}

/**
 * Start server.js. Returns { base, pid, stop() }.
 * opts: { root, port, reuse, logFile, timeoutMs }
 */
export async function startServer({ root, port = 4413, reuse = false, logFile, timeoutMs = 25000 } = {}) {
  const base = `http://127.0.0.1:${port}`;
  const pidFile = path.join(root, 'test/e2e/results/server.pid');
  const reaped = await reapStale(pidFile, port);
  if (reaped) console.log(`  (reaped stale harness server pid ${reaped})`);
  if (await ping(base)) {
    if (reuse) return { base, pid: null, reused: true, stop: async () => {} };
    throw new Error(`Port ${port} is already serving Byline and it is not a server this harness started. ` +
      `Stop it, or pass --reuse to test against it, or --port to use another port.`);
  }
  const out = logFile ? fs.openSync(logFile, 'w') : 'ignore';
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), NODE_USE_ENV_PROXY: '1' },
    stdio: ['ignore', out, out],
    detached: false
  });
  fs.writeFileSync(pidFile, String(child.pid));
  let exited = null;
  child.on('exit', (code, sig) => { exited = { code, sig }; });

  let stopped = false;
  const stopSync = () => { if (!stopped && child.exitCode === null && !child.killed) { try { child.kill('SIGKILL'); } catch {} } try { fs.rmSync(pidFile, { force: true }); } catch {} };
  process.on('exit', stopSync);
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    process.off('exit', stopSync);
    if (child.exitCode === null && exited === null) {
      child.kill('SIGTERM');
      for (let i = 0; i < 40 && exited === null; i++) await sleep(100);
      if (exited === null) { try { child.kill('SIGKILL'); } catch {} await sleep(200); }
    }
    fs.rmSync(pidFile, { force: true });
    if (typeof out === 'number') { try { fs.closeSync(out); } catch {} }
  };

  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (exited) { await stop(); throw new Error(`server.js exited during startup (${JSON.stringify(exited)}); see ${logFile || 'server log'}`); }
    if (await ping(base, 1000)) return { base, pid: child.pid, reused: false, stop };
    await sleep(200);
  }
  await stop();
  throw new Error(`server.js did not answer ${base}/api/status within ${timeoutMs} ms`);
}
