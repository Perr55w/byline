// Council B amendment 1 (docs/design/council-v4/round0-B-color-background.md §6.1): parse
// public/css/v4/tokens.css for both themes and check the contrast pairs every mockup failed.
//   text-1/2/3 + accent-text on bg, surface-solid, raised, inset, surface (tiles) and glass-strong over bg: ≥ 4.5
//   accent, focus, line-ctl, q-0…q-5 on surface-solid: ≥ 3
//   on-accent on accent (Proof) / accent-fill (both), q-on5 on q-5: ≥ 4.5
// Skips (with a message) while tokens.css does not exist yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/css/v4/tokens.css');
const exists = fs.existsSync(FILE);
const SKIP = exists ? false : `public/css/v4/tokens.css does not exist yet (the shell builder creates it); contrast pairs not checked`;

/** Custom-property declarations of every rule whose selector list contains `want`. Later rules win. */
export function themeVars(css, want) {
  const vars = {};
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // only top-level rules (skip @media / @supports bodies: those are responsive overrides, not themes)
  let depth = 0, start = 0, sel = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      if (depth === 0) { sel = src.slice(start, i).trim(); start = i + 1; }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const body = src.slice(start, i);
        const sels = sel.split(',').map(s => s.trim().replace(/\s+/g, ' ').replace(/["']/g, ''));
        if (!sel.startsWith('@') && sels.some(s => want.includes(s))) {
          for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);?/g)) vars[m[1]] = m[2].trim();
        }
        start = i + 1;
      }
    }
  }
  return vars;
}

export function parseColor(v) {
  v = v.trim();
  let m = v.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(c => c + c).join('');
    const n = h.length === 8 ? h : h + 'ff';
    return [0, 2, 4, 6].map((i, k) => (k < 3 ? parseInt(n.slice(i, i + 2), 16) : parseInt(n.slice(i, i + 2), 16) / 255));
  }
  m = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]];
  return null;
}

function resolve(vars, name, seen = new Set()) {
  if (!(name in vars) || seen.has(name)) return null;
  seen.add(name);
  const v = vars[name];
  const ref = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/);
  if (ref) return resolve(vars, ref[1], seen) ?? (ref[2] ? parseColor(ref[2]) : null);
  return parseColor(v);
}

const over = (t, b) => { const a = t[3] + b[3] * (1 - t[3]); return [0, 1, 2].map(i => (t[i] * t[3] + b[i] * b[3] * (1 - t[3])) / a).concat(a); };
const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const css = exists ? fs.readFileSync(FILE, 'utf8') : '';
const proof = exists ? themeVars(css, [':root', '[data-theme=proof]']) : {};
const night = exists ? { ...proof, ...themeVars(css, ['[data-theme=night]']) } : {};
const THEMES = { Proof: proof, Night: night };

/** The colour a token paints, composited over the theme background when translucent. */
function solid(vars, name) {
  const c = resolve(vars, name);
  if (!c) return null;
  if (c[3] >= 1) return c;
  const bg = resolve(vars, '--bg');
  return bg ? over(c, bg) : null;
}
/** The focus ring colour: --focus-c if the file has it, else the 4px ring colour inside --focus. */
function focusColor(vars) {
  const c = resolve(vars, '--focus-c');
  if (c) return c;
  const f = vars['--focus'] || '';
  const cols = [...f.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)].map(m => parseColor(m[0])).filter(Boolean);
  return cols[1] || cols[0] || null;
}

for (const [theme, vars] of Object.entries(THEMES)) {
  test(`contrast · ${theme}: text tokens ≥ 4.5:1 on every surface`, { skip: SKIP }, () => {
    const surfaces = ['--bg', '--surface-solid', '--raised', '--inset', '--surface', '--surface-glass-strong'];
    const fails = [];
    for (const t of ['--text-1', '--text-2', '--text-3', '--accent-text']) {
      const fg = solid(vars, t);
      assert.ok(fg, `${theme}: ${t} is missing or not a parseable colour`);
      for (const s of surfaces) {
        const bg = solid(vars, s);
        assert.ok(bg, `${theme}: ${s} is missing or not a parseable colour`);
        const r = contrast(fg, bg);
        if (r < 4.5) fails.push(`${t} on ${s} = ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(fails, [], `${theme}: below 4.5:1 → ${fails.join('; ')}`);
  });

  test(`contrast · ${theme}: accent, focus, control lines and quality ramp ≥ 3:1 on surface-solid`, { skip: SKIP }, () => {
    const bg = solid(vars, '--surface-solid');
    assert.ok(bg, `${theme}: --surface-solid missing`);
    const fails = [];
    const pairs = [['--accent', solid(vars, '--accent')], ['focus ring', focusColor(vars)], ['--line-ctl', solid(vars, '--line-ctl')], ...[0, 1, 2, 3, 4, 5].map(i => [`--q-${i}`, solid(vars, `--q-${i}`)])];
    for (const [name, fg] of pairs) {
      assert.ok(fg, `${theme}: ${name} is missing or not a parseable colour`);
      const r = contrast(fg, bg);
      if (r < 3) fails.push(`${name} = ${r.toFixed(2)}`);
    }
    assert.deepEqual(fails, [], `${theme}: below 3:1 → ${fails.join('; ')}`);
  });

  test(`contrast · ${theme}: text on filled accents ≥ 4.5:1`, { skip: SKIP }, () => {
    const fails = [];
    const onAccent = solid(vars, '--on-accent');
    assert.ok(onAccent, `${theme}: --on-accent missing`);
    const fills = theme === 'Proof' ? ['--accent', '--accent-fill'] : ['--accent-fill']; // B: white on Night --accent is 3.40, so Night buttons use --accent-fill
    for (const f of fills) {
      const bg = solid(vars, f);
      if (!bg && f === '--accent-fill' && theme === 'Proof') continue; // optional in Proof
      assert.ok(bg, `${theme}: ${f} missing`);
      const r = contrast(onAccent, bg);
      if (r < 4.5) fails.push(`--on-accent on ${f} = ${r.toFixed(2)}`);
    }
    const q5 = solid(vars, '--q-5'), on5 = solid(vars, '--q-on5');
    assert.ok(q5 && on5, `${theme}: --q-5 / --q-on5 missing`);
    const r = contrast(on5, q5);
    if (r < 4.5) fails.push(`--q-on5 on --q-5 = ${r.toFixed(2)}`);
    assert.deepEqual(fails, [], `${theme}: below 4.5:1 → ${fails.join('; ')}`);
  });
}

test('contrast · helpers: WCAG ratio sanity', () => {
  assert.equal(contrast([0, 0, 0, 1], [255, 255, 255, 1]).toFixed(1), '21.0');
  assert.equal(contrast(parseColor('#777777'), parseColor('#ffffff')).toFixed(2), '4.48');
  assert.deepEqual(parseColor('rgba(255,255,255,.82)'), [255, 255, 255, 0.82]);
  assert.deepEqual(themeVars(':root, [data-theme=proof] { --a: #fff; } @media (x) { :root { --a: #000; } } [data-theme=night] { --a: #111 }', [':root']), { '--a': '#fff' });
});
