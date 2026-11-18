// Generated visuals (SVG). Charts only use numbers parsed from source-backed claims.
import fs from 'node:fs';
import path from 'node:path';
import { MEDIA_DIR, run, now } from './db.js';
import { numericFacts, truncate } from './text.js';

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
  const lines = wrap(title, w > h ? 34 : 22).slice(0, 6);
  const fs0 = w > h ? 64 : 76;
  const startY = h / 2 - (lines.length * fs0 * 1.15) / 2 + fs0 * 0.5;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><radialGradient id="g" cx="80%" cy="10%" r="90%"><stop offset="0" stop-color="#3b2a72"/><stop offset="0.55" stop-color="#151226"/><stop offset="1" stop-color="#0b0a12"/></radialGradient>
<pattern id="p" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="#ffffff" stroke-opacity="0.04"/></pattern></defs>
<rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#p)"/>
<rect x="72" y="86" width="14" height="14" fill="#f5b544"/>
<text x="100" y="100" font-family="IBM Plex Mono, DejaVu Sans Mono, monospace" font-size="26" letter-spacing="4" fill="#c9b8ff">${esc((kicker || '').toUpperCase())}</text>
${lines.map((l, i) => `<text x="72" y="${startY + i * fs0 * 1.15}" font-family="Fraunces, Georgia, DejaVu Serif, serif" font-weight="600" font-size="${fs0}" fill="#f4f0ff">${esc(l)}</text>`).join('\n')}
<line x1="72" y1="${h - 130}" x2="${w - 72}" y2="${h - 130}" stroke="#9b7bff" stroke-opacity="0.5"/>
<text x="72" y="${h - 84}" font-family="IBM Plex Mono, DejaVu Sans Mono, monospace" font-size="22" fill="#a8a2c4">${esc(truncate(footer || '', 90))}</text>
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
  const barH = 92, gap = 70, top = 330;
  const bars = points.map((p, i) => {
    const bw = Math.max(8, (p.value / max) * (w - 200));
    const y = top + i * (barH + gap);
    return `<text x="72" y="${y - 16}" font-family="Hanken Grotesk, DejaVu Sans, sans-serif" font-size="28" fill="#d8d2ee">${esc(p.label)}</text>
<rect x="72" y="${y}" width="${bw}" height="${barH}" rx="6" fill="${i === 0 ? '#9b7bff' : '#5b4a9e'}"/>
<text x="${72 + bw + 16}" y="${y + barH / 2 + 12}" font-family="IBM Plex Mono, DejaVu Sans Mono, monospace" font-size="34" fill="#f4f0ff">${p.value}${p.unit === '%' ? '%' : ' ' + esc(p.unit)}</text>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="#0d0b16"/>
<text x="72" y="120" font-family="IBM Plex Mono, DejaVu Sans Mono, monospace" font-size="24" letter-spacing="4" fill="#f5b544">BY THE NUMBERS</text>
${wrap(title, 36).slice(0, 2).map((l, i) => `<text x="72" y="${190 + i * 62}" font-family="Fraunces, Georgia, serif" font-weight="600" font-size="54" fill="#f4f0ff">${esc(l)}</text>`).join('\n')}
${bars}
<text x="72" y="${h - 70}" font-family="IBM Plex Mono, DejaVu Sans Mono, monospace" font-size="20" fill="#8f89aa">Values as stated in each source · ${esc(truncate(source || '', 60))}</text>
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
  const boxH = 190, gap = 62, top = 190, x = 110, bw = w - 220;
  const colors = ['#9b7bff', '#7cc4ff', '#6fd3a5', '#f5b544'];
  const parts = steps.map(([label, text], i) => {
    const y = top + i * (boxH + gap);
    const lines = wrap(text, 46).slice(0, 3);
    return `<rect x="${x}" y="${y}" width="${bw}" height="${boxH}" rx="18" fill="#161226" stroke="${colors[i]}" stroke-width="3"/>
<circle cx="${x + 54}" cy="${y + 54}" r="24" fill="${colors[i]}"/><text x="${x + 54}" y="${y + 63}" text-anchor="middle" font-family="IBM Plex Mono, DejaVu Sans Mono, monospace" font-size="24" font-weight="600" fill="#0b0912">${i + 1}</text>
<text x="${x + 96}" y="${y + 63}" font-family="IBM Plex Mono, DejaVu Sans Mono, monospace" font-size="22" letter-spacing="3" fill="${colors[i]}">${label}</text>
${lines.map((l, k) => `<text x="${x + 40}" y="${y + 112 + k * 36}" font-family="Hanken Grotesk, DejaVu Sans, sans-serif" font-size="30" fill="#ece8f7">${esc(l)}</text>`).join('')}
${i < steps.length - 1 ? `<path d="M${w / 2} ${y + boxH + 8} L${w / 2} ${y + boxH + gap - 12}" stroke="#4a3f73" stroke-width="4"/><path d="M${w / 2 - 12} ${y + boxH + gap - 24} L${w / 2} ${y + boxH + gap - 8} L${w / 2 + 12} ${y + boxH + gap - 24}" fill="none" stroke="#4a3f73" stroke-width="4"/>` : ''}`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="100%" height="100%" fill="#0d0b16"/>
<text x="${x}" y="120" font-family="Fraunces, Georgia, DejaVu Serif, serif" font-weight="600" font-size="48" fill="#f4f0ff">How to read this story</text>
${parts}
<text x="${x}" y="${h - 50}" font-family="IBM Plex Mono, DejaVu Sans Mono, monospace" font-size="20" fill="#8f89aa">${credible} credible source${credible === 1 ? '' : 's'} · quotes as stated in sources</text>
</svg>`;
}
