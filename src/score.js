// Pure scoring arithmetic shared by pipeline.js (writes) and the dossier/tests (reads). No DB access.
export const WEIGHTS = { interest: 35, novelty: 20, evidence: 25, impact: 20 };
export const BREAKDOWN_VERSION = 2;
export const r1 = (x) => Math.round(x * 10) / 10;
export const r2 = (x) => Math.round(x * 100) / 100;
export const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Score = round1(base × recency × (1 + feedback) × source_pref × penalty), where
 * base = round1(Σ points) and points.c = round1(component_c × weight_c). Components are stored to 3 decimals and
 * multipliers to 2, and the score is computed from exactly those stored numbers, so the breakdown always reconciles.
 */
export function scoreFrom(b, weights = WEIGHTS) {
  const points = Object.fromEntries(Object.entries(weights).map(([k, w]) => [k, r1(b[k] * w)]));
  const base = r1(Object.values(points).reduce((m, x) => m + x, 0));
  const multiplier = b.recency * (1 + (b.feedback || 0)) * (b.source_pref ?? 1) * (b.penalty ?? 1);
  return { points, base, multiplier, score: r1(base * multiplier) };
}
