// Re-rank every story so breakdown_json carries the v2 structured breakdown and reconciles with the score.
// Usage: node --disable-warning=ExperimentalWarning src/rerank.js [--now]
//   default: scores as of the last pipeline rank (no silent ageing of recency between runs)
//   --now:   scores as of the current time (what the next pipeline run would do)
import { all } from './db.js';
import { rankStories, lastRankTime } from './pipeline.js';
import { scoreFrom } from './score.js';
import { parse } from './db.js';

const asOf = process.argv.includes('--now') ? Date.now() : lastRankTime();
const r = rankStories({ days: 36500, asOf });
const rows = all("SELECT id, score, breakdown_json FROM stories WHERE status != 'archived'");
let bad = 0;
for (const s of rows) {
  const b = parse(s.breakdown_json, {});
  if (b.version !== 2 || scoreFrom(b).score !== s.score) { bad++; console.error(`story ${s.id}: breakdown does not reconcile`); }
}
console.log(JSON.stringify({ ranked: r.ranked, as_of: new Date(asOf).toISOString(), checked: rows.length, mismatches: bad }));
process.exit(bad ? 1 : 0);
