// Sample data so the whole workflow can be exercised without credentials or network access.
// All organizations, people, and events below are FICTIONAL and every record is flagged as demo.
import { all, get, run, now, getSettings, setSetting, tx } from './db.js';
import { ingestItem, clusterArticles, rankStories, runDaily, todayIn } from './pipeline.js';

const h = (hoursAgo) => new Date(Date.now() - hoursAgo * 36e5).toISOString();

const SOURCES = [
  { key: 'nw', name: 'DEMO · Northwind AI Blog', kind: 'blog', url: 'https://northwind.example/feed', grp: 'Demo', evidence_kind: 'announcement' },
  { key: 'ledger', name: 'DEMO · The Ledger (tech news)', kind: 'rss', url: 'https://ledger-news.example/feed', grp: 'Demo', evidence_kind: 'reporting' },
  { key: 'dev', name: 'DEMO · DevCircle newsletter', kind: 'rss', url: 'https://devcircle.example/feed', grp: 'Demo', evidence_kind: 'commentary' },
  { key: 'halv', name: 'DEMO · Halvorsen Institute papers', kind: 'research', url: 'https://halvorsen.example/feed', grp: 'Demo', evidence_kind: 'research' },
  { key: 'edso', name: 'DEMO · Digital Standards Office', kind: 'docs', url: 'https://edso.example/feed', grp: 'Demo', evidence_kind: 'announcement' },
  { key: 'contoso', name: 'DEMO · Contoso Analytics release notes', kind: 'docs', url: 'https://contoso.example/releases/feed', grp: 'Demo', evidence_kind: 'announcement' },
  { key: 'plant', name: 'DEMO · Plant Floor Weekly', kind: 'rss', url: 'https://plantfloor.example/feed', grp: 'Demo', evidence_kind: 'reporting' },
  { key: 'autofin', name: 'DEMO · AutoFinance Today', kind: 'rss', url: 'https://autofinance.example/feed', grp: 'Demo', evidence_kind: 'reporting' },
  { key: 'xs', name: 'DEMO · X search: "AI agents"', kind: 'rss', url: 'https://x-demo.example/feed', grp: 'Demo', evidence_kind: 'commentary' }
];

const ARTICLES = [
  ['nw', 30, 'https://northwind.example/blog/relay-open-source-agent-orchestration', 'Northwind AI releases Relay, an open-source agent orchestration framework with a built-in eval harness',
    'Northwind AI released Relay, an open-source framework for orchestrating multi-agent workflows, under the Apache 2.0 license. The company says Relay cut task failures by 38% on its internal benchmark of 400 customer-support workflows. Relay supports the Model Context Protocol (MCP) for tool connections and ships with an evaluation harness that logs every agent step. Pricing for the hosted version starts at $0.40 per 1,000 agent steps.'],
  ['ledger', 22, 'https://ledger-news.example/2026/northwind-relay-hands-on', 'Hands-on: Northwind’s Relay agent orchestration framework is promising, but the eval numbers need context',
    'Independent testers at The Ledger ran Relay on 60 workflows and found a 21% reduction in task failures, smaller than the 38% Northwind reported. The evaluation harness made it easy to see where agents looped or called the wrong tool. Testers noted that Relay’s orchestration framework still needs a human approval step for any action that changes customer records. Northwind says its benchmark used longer, multi-step workflows.'],
  ['dev', 18, 'https://devcircle.example/issues/212', 'Why Relay’s agent orchestration eval harness matters more than its benchmark',
    'The interesting part of Northwind’s Relay release is the evaluation harness, not the benchmark headline. Teams adopting agent orchestration need step-level logs to decide where a human should approve actions. Expect other frameworks to copy this.'],
  ['halv', 40, 'https://halvorsen.example/papers/ai-pilot-metrics-2026', 'Study: 62% of enterprise AI pilots launched without defined success metrics',
    'A Halvorsen Institute survey of 310 enterprises found that 62% of AI pilots launched without defined success metrics, and only 18% measured business outcomes such as revenue or cycle time. Pilots with a pre-registered evaluation plan were 2.3 times more likely to reach production. The researchers recommend defining a baseline and one outcome metric before any build begins.'],
  ['ledger', 20, 'https://ledger-news.example/2026/ai-pilots-no-metrics', 'Most enterprise AI pilots have no success metrics, Halvorsen study finds',
    'Most enterprise AI pilots launched without success metrics, according to a new Halvorsen Institute study of 310 companies. The study found 62% of pilots had no defined metrics. Analysts interviewed by The Ledger said evaluation and governance practices are lagging behind adoption, especially for agent projects.'],
  ['edso', 12, 'https://edso.example/guidance/agent-audit-logs-draft', 'Digital Standards Office publishes draft guidance on audit logs for AI agents',
    'The Digital Standards Office published draft guidance requiring organizations that deploy AI agents in regulated processes to keep audit logs of each automated decision. The draft proposes a 90-day public comment period and says logs should record the model version, the tools called, and any human approval. The guidance is a draft and is not yet binding.'],
  ['ledger', 8, 'https://ledger-news.example/2026/agent-audit-log-guidance', 'Regulator’s draft guidance on AI agent audit logs puts governance teams on notice',
    'Draft guidance on AI agent audit logs from the Digital Standards Office would require organizations to record model versions, tool calls, and human approvals for agents used in regulated processes. Compliance leaders said the draft guidance on audit logs mirrors existing model risk management practices, but agent tool calls are new territory.'],
  ['contoso', 50, 'https://contoso.example/releases/2026-11-ask', 'Contoso Analytics adds natural-language questions to its data warehouse',
    'Contoso Analytics launched Ask, a natural-language query feature for its cloud data warehouse, now in public beta. Ask generates SQL from plain-English questions and shows the query before it runs. Contoso says Ask respects existing row-level data governance policies and logs every generated query.'],
  ['dev', 26, 'https://devcircle.example/issues/211', 'I tried Contoso Ask on a real dashboard — 4 of 10 answers needed fixes',
    'In a reviewer’s test of Contoso’s natural-language query feature, 4 of 10 answers needed corrections, mostly because of ambiguous metric definitions. The reviewer argues a semantic layer with agreed metric definitions matters more than the language model. Data quality issues in source tables also caused wrong answers.'],
  ['plant', 60, 'https://plantfloor.example/2026/fabrikam-paint-defects', 'Fabrikam Motors cuts paint-line defects 17% with machine-learning inspection',
    'Fabrikam Motors reported a 17% reduction in paint-line defects after deploying machine-learning visual inspection at one plant over six months. The project paired camera data with existing process-improvement routines, and line workers review every flagged defect. Fabrikam plans to expand to two more plants in 2027. Manufacturing analytics teams tracked defects per 1,000 vehicles as the main metric.'],
  ['autofin', 34, 'https://autofinance.example/2026/litware-ai-underwriting', 'Litware Finance pilots AI assistant for auto loan underwriting; regulators ask about explainability',
    'Litware Finance is piloting an AI assistant that summarizes applicant documents for auto loan underwriting staff. The company says underwriters made the final decision on 100% of applications in the pilot and that review time fell from 14 minutes to 9 minutes per file. State regulators asked Litware how it would explain decisions and monitor risk analytics for bias.'],
  ['autofin', 14, 'https://autofinance.example/2026/tailspin-service-scheduling', 'Tailspin Auto launches AI scheduling assistant for dealership service departments',
    'Dealer software vendor Tailspin Auto launched an AI assistant that books service appointments by text message. In a pilot with 40 dealerships, the company says booked appointments rose 12% and missed calls fell by a third. Dealership service managers can review and edit every booking. The assistant integrates with existing dealer management systems.'],
  ['xs', 6, 'https://x-demo.example/status/1', 'Hot take: prompt engineering is dead, agents will replace every analyst by next year',
    'Prompt engineering is dead. Agents will replace every analyst by next year. If your company is not all-in on agents it is already over.']
];

const ENGAGEMENT = { 'https://x-demo.example/status/1': { like_count: 4200, retweet_count: 900, reply_count: 610 } };

const CONTACTS = [
  { name: 'Jordan Ellery (demo)', role: 'Product Manager, Agent Platform', org: 'Northwind AI (fictional)', employer: '', team: 'Relay',
    why: 'Leads the product behind an open-source agent framework; I want to learn how they decide what to evaluate.',
    details: [{ detail: 'the Relay launch post describing its step-level evaluation harness', source: 'https://northwind.example/blog/relay-open-source-agent-orchestration' }] },
  { name: 'Priya Natarajan (demo)', role: 'Senior Data Analyst', org: 'Fabrikam Motors (fictional)', employer: '', team: 'paint-line analytics',
    why: 'Worked on manufacturing analytics with a clear defect metric — a model for my own portfolio projects.',
    details: [{ detail: 'the paint-line defect project that tracked defects per 1,000 vehicles', source: 'https://plantfloor.example/2026/fabrikam-paint-defects' }] }
];

export function loadDemo() {
  const ids = { sources: [], contacts: [], projects: [], jobs: [] };
  tx(() => {
    const srcId = {};
    for (const s of SOURCES) {
      run('INSERT OR IGNORE INTO sources(name, kind, url, grp, evidence_kind, is_demo, last_sync_at) VALUES(?,?,?,?,?,1,?)', s.name, s.kind, s.url, s.grp, s.evidence_kind, now());
      srcId[s.key] = get('SELECT id FROM sources WHERE kind = ? AND url = ?', s.kind, s.url).id;
      ids.sources.push(srcId[s.key]);
    }
    for (const [key, hrs, url, title, text] of ARTICLES) {
      const src = SOURCES.find(s => s.key === key);
      ingestItem({ url, title, summary: text.split('. ').slice(0, 2).join('. ') + '.', content: text, published_at: h(hrs), fetched_at: h(Math.max(0, hrs - 1)), evidence_kind: src.evidence_kind, engagement: ENGAGEMENT[url], author: key === 'nw' ? 'Jordan Ellery' : '' }, { id: srcId[key], evidence_kind: src.evidence_kind }, { demo: true });
    }
    for (const c of CONTACTS) {
      if (get('SELECT id FROM contacts WHERE name = ?', c.name)) continue;
      const r = run('INSERT INTO contacts(name, role, org, employer, team, why, details_json, next_step, next_date, stage, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        c.name, c.role, c.org, c.employer, c.team, c.why, JSON.stringify(c.details), 'Draft a mentorship question', new Date().toISOString().slice(0, 10), 'researching', now(), now());
      ids.contacts.push(Number(r.lastInsertRowid));
    }
    const jr = run('INSERT INTO job_posts(title, employer, url, text, created_at) VALUES(?,?,?,?,?)', 'DEMO · Associate Product Manager, AI Platform', 'Fictional Co.', '',
      'We are looking for an Associate Product Manager to own evaluation and rollout of AI agent features. You will write PRDs, define success metrics, run A/B testing, and partner with analytics on SQL dashboards. Experience with evals, agents, stakeholder management, and data quality is a plus. Familiarity with AI governance and risk management frameworks preferred.', now());
    ids.jobs.push(Number(jr.lastInsertRowid));
  });
  clusterArticles();
  rankStories();
  setSetting('demo', ids);
  return runDaily({ date: todayIn(getSettings().timezone), trigger: 'demo' }).then(r => ({ loaded: true, run: r }));
}

export function clearDemo() {
  const ids = getSettings().demo || { sources: [], contacts: [], jobs: [] };
  tx(() => {
    const storyIds = all('SELECT DISTINCT story_id FROM articles WHERE is_demo = 1 AND story_id IS NOT NULL').map(r => r.story_id);
    run('DELETE FROM articles WHERE is_demo = 1');
    for (const sid of storyIds) {
      if (get('SELECT COUNT(*) AS n FROM articles WHERE story_id = ?', sid).n === 0) {
        run('DELETE FROM drafts WHERE story_id = ?', sid);
        run('DELETE FROM stories WHERE id = ?', sid);
      }
    }
    for (const id of ids.sources || []) run('DELETE FROM sources WHERE id = ? AND is_demo = 1', id);
    for (const id of ids.contacts || []) run('DELETE FROM contacts WHERE id = ?', id);
    for (const id of ids.jobs || []) run('DELETE FROM job_posts WHERE id = ?', id);
    run("DELETE FROM briefs WHERE items_json LIKE '%\"is_demo\":true%'");
  });
  setSetting('demo', null);
  return { cleared: true };
}
