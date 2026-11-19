// v4 data layer, pure parts: findingLine, boilerplate filter, claim cleanup, number marks, honest source counts,
// breakdown reconciliation and the map layout. Plus read-only checks against the real data/byline.db when present.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { findingLine, numberMarks, markedText, isBoilerplate, cleanClaim, usableClaim, sourceCounts, sourceLine, shortTitle, attribute, orgName, groupClaims } from '../src/finding.js';
import { scoreFrom } from '../src/score.js';
import { buildGraph, layout, mulberry32, seedFor } from '../src/maplayout.js';

const marked = (t) => markedText(t, numberMarks(t));

// Fixtures copied from the real DB rows F quotes (story 16: six Google Cloud posts; story 3: Halvorsen study; story 5: Relay).
const G = { source_name: 'Google Cloud — AI & ML blog', domain: 'cloud.google.com', evidence_kind: 'announcement', published_at: null };
const story16 = {
  story: { id: 16, title: 'Gemini at Work 2026: Introducing Gemini agent', summary: 'This article is adapted from Thomas Kurian’s keynote address at Gemini at Work 2026.', topics: ['Agent orchestration'] },
  articles: [22, 23, 24, 25, 26, 27].map((id, i) => ({ ...G, id, fetched_at: `2026-11-18T16:52:02.77${5 + i}Z`, summary: i === 0 ? 'This article is adapted from Thomas Kurian’s keynote address at Gemini at Work 2026. Read on to learn more.' : 'Learn about the latest announcements.' })),
  claims: [
    { id: 47, article_id: 22, has_number: 1, evidence_kind: 'announcement', text: 'This article is adapted from Thomas Kurian’s keynote address at Gemini at Work 2026.' },
    { id: 48, article_id: 22, has_number: 1, evidence_kind: 'announcement', text: 'In the last year, nearly 500 Google Cloud customers each processed more than one trillion tokens.' },
    { id: 56, article_id: 25, has_number: 1, evidence_kind: 'announcement', text: '1 These days, it’s very clear to us that organizations are looking for AI to handle actual day-to-day work.' },
    { id: 61, article_id: 27, has_number: 1, evidence_kind: 'announcement', text: 'Nearly half (49%) of respondents report that relying on on-premises software has actively delayed AI initiatives.' }
  ]
};
const story3 = {
  story: { id: 3, title: 'Study: 62% of enterprise AI pilots launched without defined success metrics', topics: ['Business adoption'] },
  articles: [
    { id: 4, domain: 'halvorsen.example', evidence_kind: 'research', source_name: 'DEMO · Halvorsen Institute papers', published_at: '2026-11-17T00:04:28Z' },
    { id: 5, domain: 'ledger-news.example', evidence_kind: 'reporting', source_name: 'DEMO · The Ledger (tech news)', published_at: '2026-11-17T20:04:28Z' }
  ],
  claims: [
    { id: 5, article_id: 4, has_number: 1, text: 'A Halvorsen Institute survey of 310 enterprises found that 62% of AI pilots launched without defined success metrics, and only 18% measured business outcomes such as revenue or cycle time.' },
    { id: 6, article_id: 4, has_number: 1, text: 'Pilots with a pre-registered evaluation plan were 2.3 times more likely to reach production.' },
    { id: 13, article_id: 5, has_number: 1, text: 'The study found 62% of pilots had no defined metrics.' }
  ]
};
const story5 = {
  story: { id: 5, title: 'Northwind AI releases Relay', topics: [] },
  articles: [
    { id: 1, domain: 'northwind.example', evidence_kind: 'announcement', source_name: 'DEMO · Northwind AI Blog', published_at: '2026-11-17T10:00:00Z' },
    { id: 2, domain: 'ledger-news.example', evidence_kind: 'reporting', source_name: 'DEMO · The Ledger (tech news)', published_at: '2026-11-17T18:00:00Z' },
    { id: 3, domain: 'devcircle.example', evidence_kind: 'commentary', source_name: 'DEMO · DevCircle newsletter', published_at: '2026-11-17T22:00:00Z' }
  ],
  claims: [
    { id: 9, article_id: 1, has_number: 1, text: 'The company says Relay cut task failures by 38% on its internal benchmark of 400 customer-support workflows.' },
    { id: 11, article_id: 2, has_number: 1, text: 'Independent testers at The Ledger ran Relay on 60 workflows and found a 21% reduction in task failures, smaller than the 38% Northwind reported.' }
  ]
};

test('findingLine: story 16 attributes the best first-party numeric claim, never the boilerplate summary', () => {
  const f = findingLine(story16.story, story16.articles, story16.claims);
  assert.equal(f.kind, 'claim');
  assert.equal(f.text, 'Google Cloud says nearly 500 of its customers each processed more than one trillion tokens in the last year.');
  assert.deepEqual(markedText(f.text, f.marks), ['500', 'one trillion tokens']);
  assert.ok(!/adapted from/i.test(f.text));
});

test('findingLine: story 3 uses the research claim with all three numbers marked', () => {
  const f = findingLine(story3.story, story3.articles, story3.claims);
  assert.equal(f.kind, 'claim');
  assert.match(f.text, /^A Halvorsen Institute survey of 310 enterprises found that 62% of AI pilots/);
  assert.deepEqual(markedText(f.text, f.marks), ['310', '62%', '18%']);
});

test('findingLine: an independent challenge beats everything (disagreement callout)', () => {
  const f = findingLine(story5.story, story5.articles, story5.claims);
  assert.equal(f.kind, 'disagreement');
  assert.match(f.text, /^Independent check: .*smaller than the 38% Northwind reported\.$/);
  assert.equal(f.article_id, 2);
});

test('findingLine: falls back to a clean summary, then to a signals phrase', () => {
  const s = findingLine({ summary: 'Gemini Omni 1.2 Flash is now generally available on Google Cloud: fast, cost-effective video generation via API.' }, [], []);
  assert.equal(s.kind, 'summary');
  const sig = findingLine({ summary: 'Learn about the latest announcements.', breakdown: { impact_hits: ['ga', 'api', 'pricing'] } }, [], []);
  assert.equal(sig.kind, 'signals');
  assert.equal(sig.text, 'Mentions general availability, an API and pricing.');
  const none = findingLine({ summary: 'Bug fixes', topics: ['AI engineering'] }, [], []);
  assert.equal(none.kind, 'signals');
  assert.match(none.text, /^About AI engineering/);
});

test('boilerplate filter: F regex, fewer than 8 words, newline lists, run-together release notes', () => {
  for (const t of ['This article is adapted from Thomas Kurian’s keynote address at Gemini at Work 2026.', 'Learn about the latest announcements, innovations, and guides.',
    'Read on to learn more about everything we shipped this week at the event.', 'Today, we are excited to expand access to Antigravity for even more customers.',
    'We’re highlighting 20 scientific foundations and institutions from around the world.', 'Features\n- one\n- two', 'Bug fixes and performance improvements across the board today.',
    'Anthropic is an AI safety and research company based in San Francisco.', 'Short line here.', 'The API reports a session as terminated . tools: stop the grep tool tools: stop the runner']) {
    assert.ok(isBoilerplate(t), t);
  }
  assert.ok(!isBoilerplate('A Halvorsen Institute survey of 310 enterprises found that 62% of AI pilots launched without metrics.'));
});

test('claim cleanup: footnote digit, spaces before punctuation, minimum 6 words', () => {
  assert.equal(cleanClaim('1 These days, it’s very clear to us .'), 'These days, it’s very clear to us.');
  assert.equal(cleanClaim('Central audit logging : Enable it with a toggle ( one click ) .'), 'Central audit logging: Enable it with a toggle (one click).');
  assert.ok(!usableClaim('Today, we are announcing Gemini.'));
  assert.ok(usableClaim('Pilots with a pre-registered evaluation plan were 2.3 times more likely to reach production.'));
});

test('number marks: %, currency, ×/times, N of M, counts with units; never years, versions or model names', () => {
  assert.deepEqual(marked('Relay cut failures by 38% on 400 customer-support workflows.'), ['38%', '400']);
  assert.deepEqual(marked('Prices between $70.00 and $78.00; $200 million committed.'), ['$70.00', '$78.00', '$200 million']);
  assert.deepEqual(marked('Pilots were 2.3 times more likely; 4 of 10 answers needed fixes.'), ['2.3 times', '4 of 10']);
  assert.deepEqual(marked('Clinicians spend nearly 28 hours a week; 1,250 decision-makers surveyed.'), ['28', '1,250']);
  assert.deepEqual(marked('Nearly 90% of the Fortune 100 use it.'), ['90%']);
  assert.deepEqual(marked('Claude Opus 5.5 and Gemini 4 Argon shipped in 2026 as v2.10.0 on 2025-11-25.'), []);
  assert.deepEqual(marked('Released under the Apache 2.0 license.'), []);
});

test('attribution: first-party claims read "{Org} says …" or end "(company claim)"', () => {
  assert.equal(orgName({ source_name: 'DEMO · Northwind AI Blog' }), 'Northwind AI');
  assert.equal(orgName({ source_name: 'Google Cloud — AI & ML blog' }), 'Google Cloud');
  assert.equal(attribute('We are expanding our partnership with the GSA through a new agreement.', { source_name: 'Anthropic News' }), 'We are expanding our partnership with the GSA through a new agreement (company claim).');
  assert.equal(attribute('The company says Relay cut task failures by 38%.', { source_name: 'Northwind AI Blog' }), 'The company says Relay cut task failures by 38%.');
});

test('honest source counts: story 16 is 6 posts · 1 outlet · 0 independent', () => {
  const c = sourceCounts(story16.articles);
  assert.deepEqual({ posts: c.posts, outlets: c.outlets, first_party: c.first_party, independent: c.independent, commentary: c.commentary }, { posts: 6, outlets: 1, first_party: 6, independent: 0, commentary: 0 });
  assert.equal(sourceLine(c), '6 posts · 1 outlet · 0 independent');
  const r = sourceCounts(story5.articles);
  assert.deepEqual([r.first_party, r.independent, r.commentary, r.independent_outlets], [1, 1, 1, 1]);
  const s3 = sourceCounts(story3.articles);   // the study itself is primary research, not independent
  assert.deepEqual([s3.primary, s3.independent], [1, 1]);
});

test('claim grouping collapses near-duplicates across articles into "also reported by"', () => {
  const arts = [{ id: 1, domain: 'a.example', evidence_kind: 'announcement' }, { id: 2, domain: 'b.example', evidence_kind: 'reporting' }];
  const cl = [{ id: 1, article_id: 1, has_number: 1, text: 'Relay cut task failures by 38% on 400 internal workflows last quarter.' },
    { id: 2, article_id: 2, has_number: 1, text: 'Relay cut task failures by 38% on 400 internal workflows last quarter, the company said.' }];
  const { groups, duplicates } = groupClaims(arts, cl);
  assert.equal(groups.get(1).length, 1);
  assert.deepEqual(groups.get(1)[0].also_reported_by, ['b.example']);
  assert.equal(groups.get(2).length, 0);
  assert.deepEqual(duplicates.map(d => [d.id, d.duplicate_of]), [[2, 1]]);
});

test('shortTitle follows F: prefix before ":" when substantial, else capped at 60', () => {
  assert.equal(shortTitle('Gemini at Work 2026: Introducing Gemini agent'), 'Gemini at Work 2026');
  assert.equal(shortTitle('Study: 62% of enterprise AI pilots launched without defined success metrics'), 'Study: 62% of enterprise AI pilots launched without…');
});

test('breakdown reconciles: score = round1(Σ round1(component × weight) × multipliers)', () => {
  const b = { interest: 1, novelty: 0.933, evidence: 0.4, impact: 1, recency: 0.93, feedback: 0, source_pref: 1, penalty: 1 };
  const r = scoreFrom(b);
  assert.deepEqual(r.points, { interest: 35, novelty: 18.7, evidence: 10, impact: 20 });
  assert.equal(r.base, 83.7);
  assert.equal(r.score, 77.8);
  assert.equal(scoreFrom({ ...b, feedback: 0.12, penalty: 0.7 }).score, Math.round(83.7 * 0.93 * 1.12 * 0.7 * 10) / 10);
});

test('map layout is deterministic, overlap-free and stable when a story is added', () => {
  const r = mulberry32(7);
  const topics = ['A', 'B', 'C'];
  const nodes = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, topic: topics[i % 3], score: Math.round(r() * 90), topics: [topics[i % 3]], companies: i % 5 ? [] : ['Co'], watch: i % 2 ? ['W'] : [], sources: [{ id: i % 7, name: `s${i % 7}` }] }));
  const edges = buildGraph(nodes);
  assert.ok(edges.length > 0 && edges.length <= 4 * nodes.length);
  assert.ok(edges.every(e => e.weight >= 0.9 && e.reasons));
  const a = layout(nodes, edges), b = layout(nodes, edges);
  assert.deepEqual(a.positions, b.positions);
  assert.equal(seedFor([3, 1, 2]), seedFor([1, 2, 3]));
  const plus = [...nodes, { id: 99, topic: 'A', score: 50, topics: ['A'], companies: ['Co'], watch: ['W'], sources: [{ id: 1, name: 's1' }] }];
  const c = layout(plus, buildGraph(plus), { prev: a.positions });
  assert.equal(c.mode, 'relaxed');
  for (const n of nodes) assert.deepEqual(c.positions[n.id], a.positions[n.id], 'old nodes stay pinned');
  assert.ok(c.positions[99]);
  const kept = layout(nodes, edges, { prev: a.positions });
  assert.equal(kept.mode, 'kept');
  assert.equal(kept.iterations, 0);
});

// ---------- read-only checks on the real database (skipped when it isn't there) ----------
const REAL = path.resolve('data/byline.db');
const real = fs.existsSync(REAL) ? new DatabaseSync(REAL, { readOnly: true }) : null;

test('real DB: story 16 counts are 6 posts · 1 outlet · 0 independent', (t) => {
  if (!real) return t.skip('no data/byline.db');
  const arts = real.prepare("SELECT a.*, s.name AS source_name FROM articles a LEFT JOIN sources s ON s.id = a.source_id WHERE a.story_id = 16").all();
  if (arts.length !== 6 || !arts.every(a => a.domain === 'cloud.google.com')) return t.skip('story 16 is not the Gemini at Work bundle in this DB');
  const c = sourceCounts(arts);
  assert.equal(sourceLine(c), '6 posts · 1 outlet · 0 independent');
  assert.equal(c.first_party, 6);
  const claims = real.prepare('SELECT * FROM claims WHERE story_id = 16 ORDER BY has_number DESC, id').all();
  const story = real.prepare('SELECT * FROM stories WHERE id = 16').get();
  const f = findingLine({ ...story, topics: JSON.parse(story.topics) }, arts, claims);
  assert.match(f.text, /^Google Cloud says nearly 500 of its customers/);
});

test('real DB: every v2 breakdown reconciles with its stored score and never says "credible independent"', (t) => {
  if (!real) return t.skip('no data/byline.db');
  const rows = real.prepare("SELECT id, score, breakdown_json, explanation FROM stories WHERE status != 'archived'").all();
  const v2 = rows.filter(r => JSON.parse(r.breakdown_json || '{}').version === 2);
  if (!v2.length) return t.skip('DB not re-ranked yet (run src/rerank.js)');
  for (const r of v2) {
    const b = JSON.parse(r.breakdown_json);
    assert.equal(scoreFrom(b).score, r.score, `story ${r.id}`);
    assert.equal(b.score, r.score);
    for (const k of ['base', 'penalty', 'source_pref', 'newest_hours', 'priorities', 'watch_terms', 'impact_hits', 'signal_quotes']) assert.ok(k in b, `story ${r.id} has ${k}`);
    assert.ok(!/credible independent/i.test(r.explanation), `story ${r.id} explanation`);
  }
});
