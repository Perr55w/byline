// Quality ramp (council B §2). One continuous colour from score to colour, interpolated in OKLab between
// the theme's --q-0…--q-5 stops, placed by delta = score − threshold.
// The threshold ALWAYS comes from settings/status (DECISIONS): pass it in. If omitted, the value published
// by the shell from /api/status (window.__byline.threshold) is used.
// The computed inline `--q` is the only literal colour allowed outside tokens.css.

const D = [-30, -15, -1, 0, 8, 15];
let memo = { theme: null, S: null };

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
function lab(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  const r = lin(n >> 16), g = lin((n >> 8) & 255), b = lin(n & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function rgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return `rgb(${gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)} ${gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)} ${gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)})`;
}
const th0 = (t) => (t == null || Number.isNaN(Number(t)) ? (window.__byline?.threshold ?? 55) : Number(t));

function stops() {
  const theme = document.documentElement.dataset.theme;
  if (memo.theme !== theme || !memo.S) {
    const cs = getComputedStyle(document.documentElement);
    memo = { theme, S: D.map((_, i) => lab(cs.getPropertyValue(`--q-${i}`).trim() || '#808080')) };
  }
  return memo.S;
}

/** CSS colour for a score against the user's threshold. */
export function qualityColor(score, threshold) {
  const S = stops(), d = Number(score) - th0(threshold);
  if (!(d > D[0])) return rgb(S[0]);
  for (let i = 1; i < D.length; i++) {
    if (d <= D[i]) { const t = (d - D[i - 1]) / (D[i] - D[i - 1]); return rgb(S[i - 1].map((v, k) => v + (S[i][k] - v) * t)); }
  }
  return rgb(S[5]);
}
/** 'below' | 'clears' | 'strong' | 'top' — drives the non-colour cues (dotted track, halo, chip style). */
export const qualityTier = (s, t) => { const d = Number(s) - th0(t); return d < 0 ? 'below' : d < 8 ? 'clears' : d < 15 ? 'strong' : 'top'; };
/** "12 below bar" / "+18 over bar" — the text cue under every ring. */
export const qualityLabel = (s, t) => { const d = Math.round(Number(s) - th0(t)); return d < 0 ? `${-d} below bar` : `+${d} over bar`; };
/** Apply --q and data-q to an element (re-run on theme change; the shell fires `byline:theme`). */
export function paintQuality(el, score, threshold) {
  if (!el) return;
  el.style.setProperty('--q', qualityColor(score, threshold));
  el.dataset.q = qualityTier(score, threshold);
}
/** Re-paint every element carrying data-q-score (rings/chips made by ui.js) after a theme change. */
export function repaintAll(root = document) {
  memo.theme = null;
  root.querySelectorAll('[data-q-score]').forEach(el => paintQuality(el, Number(el.dataset.qScore), el.dataset.qThreshold != null ? Number(el.dataset.qThreshold) : undefined));
}
