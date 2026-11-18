// Generated visuals (SVG). Charts only use numbers parsed from source-backed claims.
import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR, run, now } from './db.js';
import { numericFacts, truncate } from './text.js';

// Proof Desk palette for generated images (matches the app tokens).
const C = { paper: '#F3EEE4', sheet: '#FBF8F2', ink: '#1C1A16', ink2: '#4A453C', ink3: '#6B6457', rule: '#D6CDBB', ruleStrong: '#B9AD96', red: '#B3301A', blue: '#1F5F9E',
  ev: { announcement: '#855500', reporting: '#1F5F9E', research: '#2E6A38', commentary: '#8A3560' } };
const F = { display: "'Newsreader', Georgia, serif", body: "'Schibsted Grotesk', 'Helvetica Neue', Arial, sans-serif", data: "'Martian Mono', Menlo, monospace" };

// Images are shown via <img> and exported as PNG, where web fonts don't load, so the woff2 files are embedded.
let fontCss = null;
export function embeddedFonts() {
  if (fontCss !== null) return fontCss;
  const dir = path.resolve('public/fonts');
  const face = (family, file, extra) => {
    try { return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${fs.readFileSync(path.join(dir, file)).toString('base64')}) format('woff2');${extra}}`; }
    catch { return ''; }
  };
  fontCss = face('Newsreader', 'newsreader.woff2', 'font-weight:200 800;') + face('Schibsted Grotesk', 'schibsted-grotesk.woff2', 'font-weight:400 900;') + face('Martian Mono', 'martian-mono.woff2', 'font-weight:100 800;font-stretch:75% 112.5%;');
  return fontCss;
}
const head = (w, h) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>${embeddedFonts()}</style>
<defs><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .11 0 0 0 0 .10 0 0 0 0 .09 0 0 0 .5 -.2"/></filter></defs>
<rect width="100%" height="100%" fill="${C.paper}"/><rect width="100%" height="100%" filter="url(#grain)" opacity=".5"/>`;
const nameplate = (w, h) => `<line x1="72" y1="${h - 118}" x2="${w - 72}" y2="${h - 118}" stroke="${C.ink}" stroke-width="3"/><line x1="72" y1="${h - 112}" x2="${w - 72}" y2="${h - 112}" stroke="${C.ink}" stroke-width="1"/>
<text x="${w - 72}" y="${h - 62}" text-anchor="end" font-family="${F.display}" font-style="italic" font-weight="800" font-size="34" fill="${C.ink}">Byline</text>`;

const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function wrap(text, max) {
  const words = String(text).split(/\s+/); const lines = []; let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) { if (line) lines.push(line); line = w; } else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  return lines;
}

export function cardSvg({ kicker, title, footer, w = 1200, h = 1200 }) {
  const lines = wrap(title, w > h ? 30 : 20).slice(0, 6);
  const fs0 = w > h ? 72 : 84;
  const startY = h / 2 - (lines.length * fs0 * 1.04) / 2 + fs0 * 0.6;
  return `${head(w, h)}
<line x1="72" y1="96" x2="${w - 72}" y2="96" stroke="${C.ink}" stroke-width="1"/>
<rect x="72" y="120" width="28" height="6" fill="${C.red}"/>
<text x="114" y="128" font-family="${F.body}" font-weight="800" font-size="24" letter-spacing="4" fill="${C.ink2}">${esc((kicker || '').toUpperCase())}</text>
${lines.map((l, i) => `<text x="72" y="${startY + i * fs0 * 1.04}" font-family="${F.display}" font-weight="560" font-size="${fs0}" letter-spacing="-1.5" fill="${C.ink}">${esc(l)}</text>`).join('\n')}
<text x="72" y="${h - 62}" font-family="${F.data}" font-size="20" fill="${C.ink3}">${esc(truncate(footer || '', 70).toUpperCase())}</text>
${nameplate(w, h)}
</svg>`;
}

const COMPARABLE = { '%': '%', percent: '%', x: 'x', usd: 'USD', ms: 'ms' };

/** Only comparable, unit-bearing figures (e.g. two sources' percentages) become a chart. */
export function chartFromClaims(claims, articles = []) {
  const points = [];
  for (const c of claims) {
    const art = articles.find(a => a.id === c.article_id);
    // One figure per claim (the first comparable one), skipping values another source already stated.
    const f = numericFacts(c.text).find(x => COMPARABLE[x.unit]);
    if (!f || points.some(p => p.value === f.value && p.unit === COMPARABLE[f.unit])) continue;
    const after = c.text.slice(c.text.indexOf(f.match) + f.match.length).split(/\s+/).filter(Boolean).slice(0, 5).join(' ').replace(/[,.;:]+$/, '');
    points.push({ value: f.value, unit: COMPARABLE[f.unit], label: truncate(`${art ? art.domain + ' — ' : ''}${after}`, 54), claim: c.text, article_id: c.article_id });
  }
  const byUnit = {};
  for (const p of points) (byUnit[p.unit] ||= []).push(p);
  const best = Object.values(byUnit).sort((a, b) => b.length - a.length)[0];
  return best && best.length >= 2 ? best.slice(0, 5) : null;
}

export function chartSvg({ title, points, source, w = 1200, h = 1200 }) {
  const max = Math.max(...points.map(p => p.value));
  const barH = 64, gap = 96, top = 380, scaleW = w - 300;
  const ticks = [0, .25, .5, .75, 1].map(t => `<line x1="${72 + t * scaleW}" y1="${top - 30}" x2="${72 + t * scaleW}" y2="${top + points.length * (barH + gap) - gap + 10}" stroke="${C.rule}" stroke-width="1"/><text x="${72 + t * scaleW}" y="${top - 40}" text-anchor="middle" font-family="${F.data}" font-size="16" fill="${C.ink3}">${Math.round(max * t)}</text>`).join('');
  const bars = points.map((p, i) => {
    const bw = Math.max(8, (p.value / max) * scaleW);
    const y = top + i * (barH + gap);
    return `<text x="72" y="${y - 14}" font-family="${F.body}" font-weight="500" font-size="26" fill="${C.ink2}">${esc(p.label)}</text>
<rect x="72" y="${y}" width="${bw}" height="${barH}" fill="${i === 0 ? C.red : C.ink}"/>
<text x="${72 + bw + 18}" y="${y + barH / 2 + 16}" font-family="${F.data}" font-weight="700" font-stretch="75%" font-size="46" fill="${C.ink}">${p.value}${p.unit === '%' ? '%' : ' ' + esc(p.unit)}</text>`;
  }).join('\n');
  return `${head(w, h)}
<line x1="72" y1="96" x2="${w - 72}" y2="96" stroke="${C.ink}" stroke-width="1"/>
<rect x="72" y="120" width="28" height="6" fill="${C.red}"/>
<text x="114" y="128" font-family="${F.body}" font-weight="800" font-size="24" letter-spacing="4" fill="${C.ink2}">BY THE NUMBERS</text>
${wrap(title, 34).slice(0, 2).map((l, i) => `<text x="72" y="${210 + i * 64}" font-family="${F.display}" font-weight="600" font-size="56" letter-spacing="-1" fill="${C.ink}">${esc(l)}</text>`).join('\n')}
${ticks}
${bars}
<text x="72" y="${h - 62}" font-family="${F.data}" font-size="18" fill="${C.ink3}">VALUES AS STATED IN EACH SOURCE · ${esc(truncate(source || '', 40).toUpperCase())}</text>
${nameplate(w, h)}
</svg>`;
}

export function saveSvg(svg, { alt, origin, source_url = null, attribution = 'Generated in Byline', license = 'Own work (generated)' }) {
  const filename = `gen-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.svg`;
  fs.writeFileSync(path.join(MEDIA_DIR, filename), svg);
  const r = run('INSERT INTO images(filename, mime, origin, source_url, attribution, license, generated, alt, created_at) VALUES(?,?,?,?,?,?,1,?,?)',
    filename, 'image/svg+xml', origin, source_url, attribution, license, alt, now());
  return Number(r.lastInsertRowid);
}

/** Recommend and create the best visual for a story: verified chart if numbers exist, else a title card. */
export function generateVisual(story, claims, articles) {
  const points = chartFromClaims(claims, articles);
  const lead = articles.find(a => a.evidence_kind === 'announcement') || articles[0];
  if (points) {
    const src = articles.find(a => a.id === points[0].article_id) || lead;
    return {
      kind: 'chart',
      id: saveSvg(chartSvg({ title: story.title, points, source: src?.domain }), {
        origin: 'chart', source_url: src?.url,
        alt: `Bar chart of figures reported for “${story.title}”: ${points.map(p => `${p.label} ${p.value}${p.unit}`).join('; ')}. Source: ${src?.domain}.`
      })
    };
  }
  return {
    kind: 'card',
    id: saveSvg(cardSvg({ kicker: (story.topics || [])[0] || 'AI briefing', title: story.title, footer: `Sources: ${[...new Set(articles.map(a => a.domain))].slice(0, 3).join(' · ')}` }), {
      origin: 'illustration', alt: `Text card reading “${story.title}”.`
    })
  };
}

/** Shape-based process diagram: what changed → evidence → who it affects → what to test. */
export function diagramSvg({ story, claims = [], articles = [], w = 1200, h = 1200 }) {
  const ann = claims.find(c => c.evidence_kind === 'announcement');
  const ind = claims.find(c => ['reporting', 'research'].includes(c.evidence_kind));
  const credible = new Set(articles.filter(a => ['announcement', 'research', 'reporting'].includes(a.evidence_kind)).map(a => a.domain)).size;
  const steps = [
    ['WHAT CHANGED', truncate(story.title, 70)],
    ['WHAT IT CLAIMS', truncate(ann?.text || claims[0]?.text || 'See sources', 80)],
    ['WHAT OTHERS FOUND', truncate(ind?.text || 'No independent measurement yet', 80)],
    ['WHAT TO TEST', 'Narrow task · baseline · one outcome metric']
  ];
  const boxH = 176, gap = 54, top = 200, x = 100, bw = w - 200;
  const marks = [C.ink, C.ev.announcement, C.ev.reporting, C.red];
  const parts = steps.map(([label, text], i) => {
    const y = top + i * (boxH + gap);
    const lines = wrap(text, 52).slice(0, 3);
    return `<rect x="${x + 4}" y="${y + 4}" width="${bw}" height="${boxH}" fill="${C.rule}"/><rect x="${x}" y="${y}" width="${bw}" height="${boxH}" fill="${C.sheet}" stroke="${C.ruleStrong}" stroke-width="1.5"/>
<rect x="${x}" y="${y}" width="6" height="${boxH}" fill="${marks[i]}"/>
<text x="${x + 34}" y="${y + 52}" font-family="${F.display}" font-style="italic" font-weight="700" font-size="40" fill="${marks[i]}">${i + 1}.</text>
<text x="${x + 90}" y="${y + 48}" font-family="${F.body}" font-weight="800" font-size="21" letter-spacing="3" fill="${C.ink2}">${label}</text>
${lines.map((l, k) => `<text x="${x + 90}" y="${y + 92 + k * 34}" font-family="${F.display}" font-size="28" fill="${C.ink}">${esc(l)}</text>`).join('')}
${i < steps.length - 1 ? `<path d="M${x + 52} ${y + boxH + 6} L${x + 52} ${y + boxH + gap - 6}" stroke="${C.ink}" stroke-width="2" stroke-dasharray="4 5"/>` : ''}`;
  }).join('\n');
  return `${head(w, h)}
<text x="${x}" y="130" font-family="${F.display}" font-weight="600" font-size="52" letter-spacing="-1" fill="${C.ink}">How to read this story</text>
${parts}
<text x="72" y="${h - 62}" font-family="${F.data}" font-size="18" fill="${C.ink3}">${credible} CREDIBLE SOURCE${credible === 1 ? '' : 'S'} · QUOTES AS STATED IN SOURCES</text>
${nameplate(w, h)}
</svg>`;
}
