#!/usr/bin/env node
// Byline v4 e2e perf + motion + a11y harness. See docs/design/GATES-v4.md.
//
//   node test/e2e/run.mjs                      all gates
//   node test/e2e/run.mjs --only E1,E11,C-rules  some gates (ids, or groups: perf | motion | a11y | shots)
//   node test/e2e/run.mjs --route feed,today   limit route-iterating gates to these routes
//   options: --port 4413  --reuse (test a server already on the port)  --gl (force WebGL2: ?bg=gl)
//            --no-shots  --timeout 240 (s per gate)  --verbose  --list
//            --laps 3 (E1: run the route sequence N times; R3 S15)  --runs 3 (E2: repeat the opens N times, keep the worst)
//
// Starts its own server.js on the port, waits for /api/status, runs the gates, prints a PASS/FAIL table,
// writes test/e2e/results/latest.json, exits 1 if any gate fails (2 on harness error).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './lib/server.mjs';
import { loadPlaywright } from './lib/browser.mjs';
import { PERF_GATES } from './gates/perf.mjs';
import { MOTION_GATES } from './gates/motion.mjs';
import { A11Y_GATES } from './gates/a11y.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS = path.join(ROOT, 'test/e2e/results');
const ALL = { ...PERF_GATES, ...MOTION_GATES, ...A11Y_GATES };
const GROUP = (id) => (id.startsWith('E') ? 'perf' : id.startsWith('C-') ? 'motion' : id.startsWith('F-') ? 'a11y' : 'shots');

// ------------------------------------------------------------------ args
const argv = process.argv.slice(2);
const opt = (name, dflt = null) => { const i = argv.indexOf(`--${name}`); if (i < 0) return dflt; const v = argv[i + 1]; return v && !v.startsWith('--') ? v : true; };
const flag = (name) => argv.includes(`--${name}`);
if (flag('help') || flag('h')) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 12).join('\n')); process.exit(0); }
if (flag('list')) { for (const id of Object.keys(ALL)) console.log(`${id.padEnd(12)} ${GROUP(id)}`); process.exit(0); }
const PORT = Number(opt('port', 4413));
const only = opt('only') ? String(opt('only')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : null;
const routeFilter = opt('route') ? String(opt('route')).split(',').map(s => s.trim()).filter(Boolean) : null;
const GATE_TIMEOUT = Number(opt('timeout', 240)) * 1000;
const VERBOSE = flag('verbose');
const selected = Object.keys(ALL).filter(id => !only || only.includes(id.toLowerCase()) || only.includes(GROUP(id)) || (only.includes('e') && GROUP(id) === 'perf') || (only.includes('c') && GROUP(id) === 'motion') || (only.includes('f') && GROUP(id) === 'a11y'));
if (!selected.length) { console.error(`No gate matches --only ${only}. Use --list.`); process.exit(2); }

// ------------------------------------------------------------------ lifecycle
let server = null, browser = null, shuttingDown = false;
async function cleanup() {
  if (browser) { const b = browser; browser = null; await Promise.race([b.close().catch(() => {}), new Promise(r => setTimeout(r, 5000))]); }
  if (server) { const s = server; server = null; await s.stop().catch(() => {}); }
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, async () => { if (shuttingDown) return; shuttingDown = true; console.error(`\n${sig}: shutting down`); await cleanup(); process.exit(130); });
process.on('uncaughtException', async (e) => { console.error('harness crashed:', e); await cleanup(); process.exit(2); });
process.on('unhandledRejection', (e) => { console.error('unhandled rejection (continuing):', e?.message || e); });

const withTimeout = (p, ms, what) => { let t; return Promise.race([p.finally(() => clearTimeout(t)), new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms); })]); };

// ------------------------------------------------------------------ table
const pad = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n); };
const C = process.stdout.isTTY ? { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m` } : { g: (s) => s, r: (s) => s, y: (s) => s, d: (s) => s, b: (s) => s };
function printGate(g) {
  const st = g.status === 'pass' ? C.g('PASS') : g.status === 'fail' ? C.r('FAIL') : g.status === 'error' ? C.r('ERROR') : C.y(g.status.toUpperCase());
  console.log(`\n${C.b(`${g.id} · ${g.title}`)}  ${st}  ${C.d(`(${(g.ms / 1000).toFixed(1)} s)`)}`);
  console.log(C.d(`  ${g.spec}`));
  for (const c of g.checks) {
    const res = c.op === 'info' ? C.d('info') : c.pass ? C.g('pass') : C.r('FAIL');
    console.log(`  ${pad(c.scope, 26)} ${pad(c.name, 46)} ${pad(c.shown, 18)} ${pad(c.limit, 12)} ${res}`);
    if (c.detail && (VERBOSE || (!c.pass && c.op !== 'info'))) console.log(C.d(`  ${' '.repeat(27)}↳ ${c.detail.slice(0, VERBOSE ? 600 : 220)}`));
  }
  for (const n of g.notes) console.log(C.y(`  note: ${n.slice(0, 300)}`));
  if (g.error) console.log(C.r(`  error: ${g.error}`));
}

// ------------------------------------------------------------------ main
async function main() {
  fs.mkdirSync(RESULTS, { recursive: true });
  const shotDir = flag('no-shots') ? null : path.join(RESULTS, 'shots');
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  const t0 = Date.now();
  console.log(`Byline v4 e2e harness: ${selected.length} gate(s): ${selected.join(', ')}`);
  server = await startServer({ root: ROOT, port: PORT, reuse: flag('reuse'), logFile: path.join(RESULTS, 'server.log') });
  console.log(`  server ${server.reused ? 'reused' : `started (pid ${server.pid})`} at ${server.base}`);

  // a real story id for deep-link fallbacks (highest score on the map)
  let storyId = null;
  try { const m = await (await fetch(`${server.base}/api/map`)).json(); storyId = (m.nodes || []).slice().sort((a, b) => b.score - a.score)[0]?.id ?? null; } catch { /* fallback below */ }
  if (storyId == null) { try { const t = await (await fetch(`${server.base}/api/today`)).json(); storyId = (t.stories || t.lead ? [t.lead, ...(t.stories || [])] : []).filter(Boolean)[0]?.id ?? null; } catch { /* none */ } }

  const { chromium } = loadPlaywright();
  browser = await chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }); // our handlers close it in order
  console.log(`  chromium ${browser.version()}${flag('gl') ? ' · forcing WebGL2 (?bg=gl)' : ''} · story id ${storyId}`);

  const results = [];
  for (const id of selected) {
    const tracked = new Set();
    const ctx = {
      browser, base: server.base, root: ROOT, storyId, shotDir,
      bgQuery: flag('gl') ? '&bg=gl' : '',
      laps: Math.max(1, Number(opt('laps', 1)) || 1), runs: Math.max(1, Number(opt('runs', 3)) || 3),
      routes: (list) => { if (!routeFilter) return list; const hit = list.filter(r => routeFilter.includes(r)); return hit.length ? hit : routeFilter; },
      track: (P) => tracked.add(P)
    };
    const start = Date.now();
    let g;
    process.stdout.write(C.d(`  running ${id}…\n`));
    try { g = await withTimeout(ALL[id](ctx), GATE_TIMEOUT, id); }
    catch (e) { g = { id, title: id, group: GROUP(id), spec: '', status: 'error', checks: [], notes: [], shots: [], error: e.message }; }
    for (const P of tracked) await P.close().catch(() => {});
    g.ms = Date.now() - start;
    if (g.status !== 'error') {
      const real = g.checks.filter(c => c.op !== 'info');
      g.status = real.length ? (real.every(c => c.pass) ? 'pass' : 'fail') : (g.group === 'shots' ? 'info' : 'fail');
      if (!real.length && g.group !== 'shots') g.notes.push('no measurable checks ran');
    }
    results.push(g);
    printGate(g);
  }

  // summary table
  console.log(`\n${C.b('Summary')}`);
  console.log(`  ${pad('gate', 12)} ${pad('result', 7)} ${pad('checks', 10)} title`);
  for (const g of results) {
    const real = g.checks.filter(c => c.op !== 'info');
    const st = g.status === 'pass' ? C.g('PASS   ') : g.status === 'info' ? C.d('info   ') : C.r(pad(g.status.toUpperCase(), 7));
    console.log(`  ${pad(g.id, 12)} ${st} ${pad(`${real.filter(c => c.pass).length}/${real.length}`, 10)} ${g.title}`);
  }
  const failed = results.filter(g => g.status === 'fail' || g.status === 'error');
  const gates = results.filter(g => g.group !== 'shots');
  console.log(`\n  ${gates.length - failed.length}/${gates.length} gates pass · ${((Date.now() - t0) / 1000).toFixed(0)} s`);

  const out = {
    generated_at: new Date().toISOString(), base: server.base, chromium: browser.version(), argv, storyId,
    summary: { gates: gates.length, passed: gates.length - failed.length, failed: failed.map(g => g.id) },
    gates: results.map(g => ({ ...g, shots: g.shots.map(s => path.relative(ROOT, s)) }))
  };
  fs.writeFileSync(path.join(RESULTS, 'latest.json'), JSON.stringify(out, null, 2));
  console.log(`  results → ${path.relative(ROOT, path.join(RESULTS, 'latest.json'))}${shotDir ? ` · screenshots → ${path.relative(ROOT, shotDir)}/` : ''}`);
  return failed.length ? 1 : 0;
}

main().then(async (code) => { await cleanup(); process.exit(code); }, async (e) => { console.error(`harness error: ${e.stack || e.message}`); await cleanup(); process.exit(2); });
