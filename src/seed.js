// First-run defaults: target employers, a few starter watchlists, and real public feeds.
// Everything here is editable in the app.
import { get, run, all, getSettings, setSetting, now, PRIORITIES } from './db.js';

export const EMPLOYERS = [
  { name: 'IBM', topics: ['Enterprise AI governance', 'Agent evaluation', 'Consulting'], terms: ['IBM', 'watsonx', 'Granite', 'IBM Consulting', 'governance', 'agent evaluation', 'consulting'] },
  { name: 'AWS', topics: ['Cloud architecture', 'Agent infrastructure', 'Operating costs'], terms: ['AWS', 'Amazon Web Services', 'Bedrock', 'SageMaker', 'cloud architecture', 'agent infrastructure', 'inference cost'] },
  { name: 'Google Cloud', parent: 'Google', topics: ['AI product decisions', 'Adoption'], terms: ['Google Cloud', 'Vertex AI', 'Gemini Enterprise', 'BigQuery', 'adoption'] },
  { name: 'Google DeepMind', parent: 'Google', topics: ['Model evaluation', 'Research'], terms: ['DeepMind', 'Gemini', 'model evaluation', 'benchmark'] },
  { name: 'Google (other teams)', parent: 'Google', topics: ['AI product decisions', 'Adoption'], terms: ['Google', 'Google Research', 'product decisions'] },
  { name: 'Toyota', topics: ['Process improvement', 'Manufacturing analytics', 'Mobility'], terms: ['Toyota', 'Toyota Research Institute', 'Woven', 'kaizen', 'lean', 'process improvement', 'manufacturing analytics', 'mobility', 'defects'] },
  { name: 'Snowflake', topics: ['Analytics engineering', 'Data quality', 'Data governance'], terms: ['Snowflake', 'Cortex', 'analytics engineering', 'data quality', 'data governance', 'warehouse'] },
  { name: 'Cox Enterprises', topics: ['Corporate strategy', 'AI adoption'], terms: ['Cox Enterprises', 'AI adoption'] },
  { name: 'Cox Automotive', parent: 'Cox Enterprises', topics: ['Automotive technology', 'Dealership workflows', 'AI adoption'], terms: ['Cox Automotive', 'Autotrader', 'Kelley Blue Book', 'Manheim', 'Dealertrack', 'dealership', 'dealer', 'service department', 'automotive'] },
  { name: 'Ally', topics: ['Auto finance', 'Funding operations', 'Risk analytics'], terms: ['Ally', 'Ally Financial', 'auto finance', 'auto loans', 'underwriting', 'funding', 'risk analytics', 'credit risk'] }
];

const SOURCES = [
  ['Google AI Blog', 'blog', 'https://blog.google/technology/ai/rss/', 'Company blogs', 'Google (other teams)'],
  ['Google DeepMind Blog', 'blog', 'https://deepmind.google/blog/rss.xml', 'Company blogs', 'Google DeepMind'],
  ['AWS Machine Learning Blog', 'blog', 'https://aws.amazon.com/blogs/machine-learning/feed/', 'Company blogs', 'AWS'],
  ['Hugging Face Blog', 'blog', 'https://huggingface.co/blog/feed.xml', 'Company blogs', null],
  ['arXiv cs.AI', 'research', 'https://rss.arxiv.org/rss/cs.AI', 'Research', null],
  ['MIT Technology Review — AI', 'rss', 'https://www.technologyreview.com/topic/artificial-intelligence/feed', 'News', null],
  ['Simon Willison', 'rss', 'https://simonwillison.net/atom/everything/', 'Commentary', null]
];

// Sources added after the alignment questionnaire (credibility order: official/papers → X/newsletters → community → applied).
const ALIGNED_SOURCES = [
  ['Anthropic News', 'page', 'https://www.anthropic.com/news', 'Company blogs', 'announcement', null],
  ['OpenAI News', 'blog', 'https://openai.com/news/rss.xml', 'Company blogs', 'announcement', null],
  ['IBM Research Blog', 'page', 'https://research.ibm.com/blog', 'Company blogs', 'announcement', 'IBM'],
  ['Snowflake Blog', 'page', 'https://www.snowflake.com/en/blog/', 'Company blogs', 'announcement', 'Snowflake'],
  ['Google Cloud — AI & ML blog', 'page', 'https://cloud.google.com/blog/products/ai-machine-learning', 'Company blogs', 'announcement', 'Google Cloud'],
  ['Hacker News — agents & evals', 'community', 'https://hnrss.org/newest?q=AI+agents+OR+LLM+evals&points=40', 'Industry climate', 'community', null],
  ['GitHub — MCP spec releases', 'github', 'https://github.com/modelcontextprotocol/modelcontextprotocol/releases.atom', 'Applied practice', 'application', null],
  ['GitHub — Anthropic Python SDK releases', 'github', 'https://github.com/anthropics/anthropic-sdk-python/releases.atom', 'Applied practice', 'application', null]
];
/**
 * Known alternate addresses for the seeded feeds. go-live tries these when a source's own URL fails and switches the
 * source to the first one that returns items. (Checked 2026-11: the primaries are the publishers' documented feeds;
 * the sandbox these were written in could not reach most hosts, so each is verified on first sync.)
 */
export const FEED_ALTERNATES = {
  'https://blog.google/technology/ai/rss/': ['https://blog.google/rss/'],
  'https://deepmind.google/blog/rss.xml': ['https://deepmind.google/discover/blog/rss.xml', 'https://deepmind.com/blog/feed/basic/'],
  'https://aws.amazon.com/blogs/machine-learning/feed/': ['https://aws.amazon.com/blogs/aws/feed/'],
  'https://rss.arxiv.org/rss/cs.AI': ['https://export.arxiv.org/rss/cs.AI', 'https://rss.arxiv.org/atom/cs.AI'],
  'https://www.technologyreview.com/topic/artificial-intelligence/feed': ['https://www.technologyreview.com/feed/'],
  'https://simonwillison.net/atom/everything/': ['https://simonwillison.net/atom/entries/'],
  'https://openai.com/news/rss.xml': ['https://openai.com/blog/rss.xml'],
  'https://research.ibm.com/blog': ['https://research.ibm.com/rss'],
  'https://www.snowflake.com/en/blog/': ['https://www.snowflake.com/feed/'],
  'https://hnrss.org/newest?q=AI+agents+OR+LLM+evals&points=40': ['https://hnrss.org/newest?q=LLM+agents&points=40']
};
/** The connector kind for an alternate URL (a listing page that has an RSS alternate becomes an rss source). */
export const altKind = (url, kind) => (/\/(rss|feed|atom)(\/|\.xml|$)|\.xml$|\/rss\/|hnrss\.org/.test(url) ? (kind === 'page' ? 'rss' : kind) : kind);

const BIG_PUSH = ['IBM', 'Toyota', 'Cox Automotive', 'Cox Enterprises'];
const EXISTING_PROJECTS = [
  ['Lot Intelligence', 'dashboard', 'Existing project — add what it does, its data, and what you want to extend.'],
  ['Research Bench', 'experiment', 'Existing project — add what it does, its data, and what you want to extend.'],
  ['New analytics dashboard', 'dashboard', 'Which business question should a dashboard answer for a target employer?'],
  ['Agent evaluation project', 'experiment', 'How do you measure whether an AI agent improves a business outcome, not just a demo?']
];

/** One-time alignment migration (questionnaire answers). Safe to re-run; only applies once. */
function alignV1() {
  if (getSettings().alignment_version >= 1) return;
  const s = getSettings();
  // Keep any custom topics the user added; replace the built-in ones with the aligned weights.
  const builtIn = new Set(PRIORITIES.map(p => p.topic).concat(['Agent orchestration', 'AI governance', 'Evaluation', 'Analytics', 'Business adoption', 'Product management', 'Business analysis', 'Machine learning']));
  setSetting('priorities', [...PRIORITIES, ...(s.priorities || []).filter(p => !builtIn.has(p.topic))]);
  setSetting('posting_days', ['Mon', 'Wed', 'Fri']);
  setSetting('editorial', { block_unsupported_numbers: true, min_independent_sources: 2, block_hype: false });
  setSetting('ai', { ...s.ai, provider: 'local' });
  setSetting('budget', { monthly_usd: 0 });
  setSetting('writing_profile', { ...s.writing_profile, tone: 'story-driven and investigative, analytical and measured, fair-minded', length: 'long', humor: 'variant-only (I vet every joke)', avoid: 'hype, emojis, hashtag spam, assuming motives' });
  setSetting('schedule', { ...s.schedule, weekly_roundup_day: 'Fri' });
  for (const [name, kind, url, grp, ev, employer] of ALIGNED_SOURCES)
    run('INSERT OR IGNORE INTO sources(name, kind, url, grp, evidence_kind, employer) VALUES(?,?,?,?,?,?)', name, kind, url, grp, ev, employer);
  for (const n of BIG_PUSH) run('UPDATE employers SET pinned = 1 WHERE name = ?', n);
  for (const [title, kind, question] of EXISTING_PROJECTS)
    if (!get('SELECT id FROM projects WHERE title = ?', title))
      run("INSERT INTO projects(title, kind, question, status, created_at, updated_at) VALUES(?,?,?,?,?,?)", title, kind, question, title.startsWith('New') || title.startsWith('Agent') ? 'idea' : 'active', now(), now());
  setSetting('alignment_version', 1);
}

export function seedDefaults() {
  if (get('SELECT COUNT(*) AS n FROM employers').n === 0) {
    for (const e of EMPLOYERS) run('INSERT INTO employers(name, parent, topics, terms) VALUES(?,?,?,?)', e.name, e.parent || null, JSON.stringify(e.topics), JSON.stringify(e.terms));
    run("INSERT INTO watchlists(kind, name, terms, weight, pinned) VALUES('question', 'How are teams measuring whether AI agents improve business outcomes?', ?, 1.5, 1)", JSON.stringify(['agent', 'outcomes', 'measure', 'roi', 'metrics', 'evaluation']));
    run("INSERT INTO watchlists(kind, name, terms, weight) VALUES('framework', 'Model Context Protocol', ?, 1)", JSON.stringify(['MCP', 'Model Context Protocol']));
    run("INSERT INTO watchlists(kind, name, terms, weight) VALUES('skill', 'Evals', ?, 1)", JSON.stringify(['evals', 'eval harness', 'evaluation']));
    run("INSERT INTO watchlists(kind, name, terms, weight, employer, pinned) VALUES('team', 'Bedrock Agents', ?, 1, 'AWS', 1)", JSON.stringify(['Bedrock', 'AgentCore']));
    run("INSERT INTO watchlists(kind, name, terms, weight, employer) VALUES('team', 'Vertex AI', ?, 1, 'Google Cloud')", JSON.stringify(['Vertex AI']));
    run("INSERT INTO watchlists(kind, name, terms, weight, employer) VALUES('team', 'watsonx.governance', ?, 1, 'IBM')", JSON.stringify(['watsonx.governance', 'watsonx']));
    for (const [name, kind, url, grp, employer] of SOURCES)
      run('INSERT OR IGNORE INTO sources(name, kind, url, grp, evidence_kind, employer) VALUES(?,?,?,?,?,?)', name, kind, url, grp,
        { blog: 'announcement', research: 'research' }[kind] || (grp === 'Commentary' ? 'commentary' : 'reporting'), employer);
  }
  alignV1();
}
