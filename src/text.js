const STOP = new Set(('a an the and or but if of to in on for with by from at as is are was were be been being it its this that these those ' +
  'has have had do does did will would can could should may might must not no new now how what why who when where which ' +
  'their there they them we our you your he she his her i me my about into over after before more most than then so such ' +
  'just also up out via vs per says said say get gets make makes using use uses one two').split(' '));

export const decodeEntities = (s = '') => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&rsquo;|&lsquo;/g, "'")
  .replace(/&rdquo;|&ldquo;/g, '"').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…');

export const stripHtml = (s = '') => decodeEntities(
  decodeEntities(s)
    .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

export const tokens = (s = '') => (s.toLowerCase().match(/[a-z0-9][a-z0-9\-\.]*[a-z0-9]|[a-z0-9]/g) || [])
  .filter(t => !STOP.has(t) && t.length > 1);

export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export const sentences = (s = '') => s.replace(/\s+/g, ' ')
  .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map(x => x.trim()).filter(x => x.length > 25 && x.length < 400);

export const wordCount = (s = '') => (s.match(/\S+/g) || []).length;

export const domainOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Capitalized multi-word names, e.g. "Google DeepMind", "Model Context Protocol". */
export function entities(text = '') {
  const found = new Map();
  const re = /\b([A-Z][a-zA-Z0-9]+(?:[ \-][A-Z][a-zA-Z0-9]+){0,3})\b/g;
  let m;
  while ((m = re.exec(text))) {
    const e = m[1];
    if (e.length < 3 || STOP.has(e.toLowerCase())) continue;
    found.set(e, (found.get(e) || 0) + 1);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
}

export const hasNumber = (s) => /\b\d[\d,\.]*\s?(%|percent|x|times|million|billion|k|ms|tokens|hours|days)?\b/i.test(s);

/** Pull "label: value" style numeric facts from sentences for charts. */
export function numericFacts(sentence) {
  const out = [];
  const re = /(\$?\d[\d,]*\.?\d*)\s?(%|percent|x|million|billion|ms|tokens|hours)?/gi;
  let m;
  while ((m = re.exec(sentence))) {
    const raw = m[1].replace(/[$,]/g, '');
    const value = parseFloat(raw);
    if (!isFinite(value)) continue;
    if (!m[2] && (value > 1900 && value < 2100)) continue; // skip years
    if (!m[2] && !m[1].startsWith('$') && value < 2) continue;
    out.push({ value, unit: (m[2] || (m[1].startsWith('$') ? 'USD' : '')).toLowerCase(), match: m[0] });
  }
  return out;
}

export const termHits = (text, terms) => {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\-\. ]/g, ' ')} `;
  return terms.filter(term => t.includes(` ${term.toLowerCase()} `) || t.includes(` ${term.toLowerCase()}s `));
};

export const readingMinutes = (words) => Math.max(1, Math.round((words / 230) * 10) / 10);

export const truncate = (s = '', n = 200) => s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s;

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}
