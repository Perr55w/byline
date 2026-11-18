import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.BYLINE_DATA_DIR || path.resolve('data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'byline.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'rss',
  url TEXT, grp TEXT DEFAULT 'General', evidence_kind TEXT DEFAULT 'reporting',
  employer TEXT, paused INTEGER DEFAULT 0, last_sync_at TEXT, last_error TEXT,
  last_count INTEGER DEFAULT 0, is_demo INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(kind, url)
);

CREATE TABLE IF NOT EXISTS stories (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, summary TEXT, first_seen TEXT, updated_at TEXT,
  score REAL DEFAULT 0, breakdown_json TEXT DEFAULT '{}', explanation TEXT, topics TEXT DEFAULT '[]',
  companies TEXT DEFAULT '[]', last_viewed_at TEXT, status TEXT DEFAULT 'new',
  lens_json TEXT, is_demo INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY, source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  url TEXT UNIQUE NOT NULL, domain TEXT, title TEXT NOT NULL, summary TEXT, content TEXT,
  author TEXT, image_url TEXT, published_at TEXT, fetched_at TEXT, evidence_kind TEXT,
  engagement_json TEXT, story_id INTEGER REFERENCES stories(id) ON DELETE SET NULL,
  is_demo INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY, story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE, text TEXT NOT NULL,
  evidence_kind TEXT, has_number INTEGER DEFAULT 0, UNIQUE(story_id, text)
);

CREATE TABLE IF NOT EXISTS watchlists (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, terms TEXT DEFAULT '[]',
  weight REAL DEFAULT 1, pinned INTEGER DEFAULT 0, employer TEXT, notes TEXT
);

CREATE TABLE IF NOT EXISTS employers (
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, parent TEXT, topics TEXT DEFAULT '[]',
  terms TEXT DEFAULT '[]', pinned INTEGER DEFAULT 0, notes TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY, run_date TEXT NOT NULL, trigger TEXT, status TEXT, started_at TEXT,
  finished_at TEXT, stats_json TEXT DEFAULT '{}', cost_usd REAL DEFAULT 0, error TEXT
);
CREATE TABLE IF NOT EXISTS run_stages (
  id INTEGER PRIMARY KEY, run_id INTEGER REFERENCES runs(id) ON DELETE CASCADE, stage TEXT,
  status TEXT, started_at TEXT, finished_at TEXT, detail_json TEXT DEFAULT '{}', error TEXT
);

CREATE TABLE IF NOT EXISTS briefs (
  id INTEGER PRIMARY KEY, run_date TEXT UNIQUE NOT NULL, run_id INTEGER, summary TEXT,
  items_json TEXT DEFAULT '[]', quiet INTEGER DEFAULT 0, reading_minutes REAL, draft_id INTEGER,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY, filename TEXT NOT NULL, mime TEXT, origin TEXT, source_url TEXT,
  attribution TEXT, license TEXT, generated INTEGER DEFAULT 0, alt TEXT, kind TEXT DEFAULT 'image',
  rights_json TEXT DEFAULT '{}', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, story_id INTEGER, project_id INTEGER,
  goal TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY, auto_key TEXT UNIQUE, story_id INTEGER REFERENCES stories(id) ON DELETE SET NULL,
  project_id INTEGER, campaign_id INTEGER, channel TEXT NOT NULL DEFAULT 'linkedin',
  format TEXT NOT NULL DEFAULT 'short', title TEXT, angle TEXT, status TEXT DEFAULT 'draft',
  sections_json TEXT DEFAULT '[]', image_id INTEGER, tags_json TEXT DEFAULT '[]',
  source_ids_json TEXT DEFAULT '[]', planned_date TEXT, approved_hash TEXT, approved_at TEXT,
  published_at TEXT, publish_ref TEXT, metrics_json TEXT DEFAULT '{}', meta_json TEXT DEFAULT '{}',
  created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS draft_versions (
  id INTEGER PRIMARY KEY, draft_id INTEGER REFERENCES drafts(id) ON DELETE CASCADE,
  sections_json TEXT, note TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY, draft_id INTEGER REFERENCES drafts(id) ON DELETE CASCADE,
  story_id INTEGER, text TEXT NOT NULL, kind TEXT DEFAULT 'observation',
  include INTEGER DEFAULT 0, public_ok INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS experiences (
  id INTEGER PRIMARY KEY, text TEXT NOT NULL, public_ok INTEGER DEFAULT 0, created_at TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY, story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, topics TEXT, source_ids TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS saved (
  id INTEGER PRIMARY KEY, story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  collection TEXT NOT NULL, note TEXT, created_at TEXT, UNIQUE(story_id, collection)
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY, story_id INTEGER, title TEXT, kind TEXT DEFAULT 'experiment',
  question TEXT, inputs TEXT, deliverable TEXT, success TEXT, extension TEXT,
  status TEXT DEFAULT 'idea', tested TEXT, findings TEXT, next_steps TEXT, employer TEXT,
  created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS job_posts (
  id INTEGER PRIMARY KEY, title TEXT, employer TEXT, url TEXT, text TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, org TEXT, employer TEXT, team TEXT,
  email TEXT, email_source TEXT, linkedin TEXT, instagram TEXT, why TEXT,
  details_json TEXT DEFAULT '[]', dnc INTEGER DEFAULT 0, next_step TEXT, next_date TEXT,
  private_note TEXT, stage TEXT DEFAULT 'researching', created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS interactions (
  id INTEGER PRIMARY KEY, contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  kind TEXT, date TEXT, notes TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS outreach (
  id INTEGER PRIMARY KEY, contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
  purpose TEXT, channel TEXT, subject TEXT, body TEXT, personal_detail TEXT,
  basis_json TEXT DEFAULT '[]', status TEXT DEFAULT 'draft', send_at TEXT, recipient TEXT,
  approved_hash TEXT, approved_at TEXT, sent_at TEXT, idempotency_key TEXT UNIQUE,
  campaign_id INTEGER, story_id INTEGER, created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, employer TEXT, title TEXT, date TEXT, notes TEXT, kind TEXT DEFAULT 'event'
);

CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY, run_id INTEGER, provider TEXT, operation TEXT,
  input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_story ON articles(story_id);
CREATE INDEX IF NOT EXISTS idx_claims_story ON claims(story_id);
CREATE INDEX IF NOT EXISTS idx_drafts_story ON drafts(story_id);
`);

// Additive migrations for databases created by earlier versions.
for (const [table, col, def] of [['contacts', 'segment', "TEXT DEFAULT 'target_team'"], ['contacts', 'ksu_alumni', 'INTEGER DEFAULT 0'], ['briefs', 'delivered_json', "TEXT DEFAULT '{}'"], ['outreach', 'last_error', 'TEXT']]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

export const now = () => new Date().toISOString();
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

export const parse = (v, fallback) => {
  if (v == null || v === '') return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
};

/** Expand *_json columns into parsed fields (sections_json -> sections). */
export function hydrate(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith('_json')) out[k.slice(0, -5)] = parse(v, null);
    else if (['topics', 'companies', 'terms'].includes(k)) out[k] = parse(v, []);
    else out[k] = v;
  }
  return out;
}

export const PRIORITIES = [
  { topic: 'Agent orchestration', weight: 2.0, terms: ['agent', 'agents', 'agentic', 'orchestration', 'multi-agent', 'tool use', 'mcp', 'workflow'] },
  { topic: 'AI governance', weight: 2.0, terms: ['governance', 'regulation', 'policy', 'compliance', 'risk', 'safety', 'audit', 'eu ai act', 'responsible ai'] },
  { topic: 'Product management', weight: 1.9, terms: ['product manager', 'product management', 'roadmap', 'pricing', 'launch', 'user research', 'pm', 'prd'] },
  { topic: 'Evaluation', weight: 1.4, terms: ['eval', 'evals', 'evaluation', 'benchmark', 'measure', 'metrics', 'accuracy'] },
  { topic: 'Analytics', weight: 1.3, terms: ['analytics', 'dashboard', 'data quality', 'sql', 'bi', 'data warehouse', 'snowflake', 'dbt', 'semantic layer'] },
  { topic: 'Business adoption', weight: 1.3, terms: ['enterprise', 'adoption', 'customers', 'roi', 'productivity', 'deployment', 'pilot', 'business'] },
  { topic: 'AI engineering', weight: 1.2, terms: ['python', 'sdk', 'rag', 'retrieval', 'fine-tuning', 'inference', 'mlops', 'llmops', 'api'] },
  { topic: 'Business analysis', weight: 1.1, terms: ['business analyst', 'requirements', 'process', 'process improvement', 'stakeholder', 'kpi'] },
  { topic: 'Machine learning', weight: 1.0, terms: ['model', 'models', 'training', 'llm', 'open-weight', 'machine learning'] },
  { topic: 'De-emphasize: model horse-races', weight: -1.2, terms: ['leaderboard', 'tops leaderboard', 'beats gpt', 'state-of-the-art', 'sota', 'arena'] },
  { topic: 'De-emphasize: funding & valuation', weight: -1.5, terms: ['funding round', 'series a', 'series b', 'series c', 'valuation', 'raises', 'raised', 'investors', 'ipo', 'initial public offering', 's-1', 'market cap', 'share price'] }
];

const DEFAULT_SETTINGS = {
  timezone: 'America/New_York',
  schedule: { enabled: false, time: '07:00', weekly_roundup_day: 'Fri' },
  publish_threshold: 55,
  brief_size: 6,
  priorities: PRIORITIES,
  posting_days: ['Mon', 'Wed', 'Fri'],
  editorial: { block_unsupported_numbers: true, min_independent_sources: 2, block_hype: false },
  delivery: { email: false, push: false, email_to: '' },
  ai: { provider: 'local', model: 'claude-opus-5-5', effort: 'low' },
  budget: { monthly_usd: 0 },
  writing_profile: { tone: 'story-driven and investigative, analytical and measured, fair-minded', length: 'long', depth: 'analytical',
    humor: 'variant-only (I vet every joke)', avoid: 'hype, emojis, hashtag spam, assuming motives', samples: [] },
  synthetic_media_opt_in: false,
  outreach_goal_per_week: 3,
  intro_format: 'I\'m Perry, a KSU student focused on AI product management and analytics.'
};

export function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const s = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) s[r.key] = parse(r.value, s[r.key]);
  return s;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export function cacheGet(key, maxAgeHours = 24) {
  const r = get('SELECT value, created_at FROM cache WHERE key = ?', key);
  if (!r) return null;
  if (Date.now() - Date.parse(r.created_at) > maxAgeHours * 3600e3) return null;
  return parse(r.value, null);
}
export function cacheSet(key, value) {
  run('INSERT INTO cache(key, value, created_at) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at', key, JSON.stringify(value), now());
}
