# Byline v4 API contract (server data layer)

Owner: server builder. Tab builders code against this file. Everything here is live on the real DB; every example value below was read from `data/byline.db` on 19 Nov 2026, not invented. Fields marked *(legacy)* exist for the v3 UI and may be ignored.

Conventions:
- All responses are JSON. Errors are `{ "error": "message" }` with status 400/404/409/502.
- Times are ISO-8601 UTC strings. Anything meant for display already has a `*_local` / `*_label` twin formatted in `settings.timezone` (America/New_York). Never format raw UTC for display.
- **Threshold** always comes from the payload (`threshold`, from `settings.publish_threshold`, currently **55**). Never hard-code 60.
- **Number marks** (`*_marks`): arrays of `[start, end)` UTF-16 index pairs into the sibling text field, sorted and non-overlapping. Render with `text.slice(a, b)` inside `<mark>`; escape each slice. Only meaningful numbers are marked (%, currency, ×/times, "N of M", counts followed by a unit or plural noun, comma-grouped counts). Years, versions (`2.10.0`), ISO dates and model names (`Opus 5.5`) are never marked.
- `is_demo` is a boolean everywhere it appears on stories, sources and articles. Demo rows need a visible **Demo** tag.

---

## Shared story facts

Every story payload in `/api/stories`, `/api/stories/:id` (`story`), `/api/today` (`brief.items[]`, `top`), `/api/search` (`stories[]`) and `/api/map` (`nodes[]`) carries these fields, computed on the server by `src/finding.js` and `src/facts.js`:

| field | type | meaning |
|---|---|---|
| `finding` | string | F's finding line. Use it as the dek or one-liner everywhere. **Never** use `summary` as a dek. |
| `finding_marks` | `[[s,e],…]` | number highlights in `finding` |
| `finding_kind` | `'disagreement' \| 'claim' \| 'summary' \| 'signals'` | which rule produced it (a > b > c > d) |
| `posts` | int | articles in the story |
| `outlets` | int | distinct domains |
| `first_party` | int | posts with `evidence_kind = announcement` |
| `primary` | int | `reporting`/`research` posts on the origin's own domain (e.g. the study itself) |
| `independent` | int | `reporting`/`research` posts on a domain other than the origin's |
| `independent_outlets` | int | distinct domains among the independent posts. **Use this in "· N independent".** |
| `commentary` | int | everything else (commentary, community, release notes) |
| `origin_domain` | string | domain of the origin article |
| `source_line` | string | `"6 posts · 1 outlet · 0 independent"` (binding wording) |
| `evidence_qualifier` | string | `"with no independent report yet"` or `"backed by 1 independent outlet"` |
| `short_title` | string | F's short title (prefix before ":"/" — " when it has ≥15 chars and ≥3 words, else the title capped at 60) |

`first_party + primary + independent + commentary === posts` always.

`/api/stories` and `/api/search` stories also carry `main_topic`: the first of the story's topics with priority weight > 1, else its first topic (so "Machine learning" is never the main topic when a weighted topic exists). Map nodes carry the same value as `topic`.

Real examples:
- Story 16: `finding` = "Google Cloud says nearly 500 of its customers each processed more than one trillion tokens in the last year." marks → `500`, `one trillion tokens`; `source_line` = "6 posts · 1 outlet · 0 independent".
- Story 5 (demo): `finding_kind` = `disagreement`, "Independent check: Independent testers at The Ledger ran Relay on 60 workflows and found a 21% reduction in task failures, smaller than the 38% Northwind reported."
- Story 3 (demo): "A Halvorsen Institute survey of 310 enterprises found that 62% of AI pilots launched without defined success metrics, and only 18% measured business outcomes such as revenue or cycle time." marks → `310`, `62%`, `18%`.

### Breakdown (`story.breakdown`, stored in `breakdown_json`, version 2)

```jsonc
{
  "version": 2,
  "interest": 1, "novelty": 0.933, "evidence": 0.4, "impact": 1,      // components 0..1, 3 decimals
  "recency": 0.93, "feedback": 0, "source_pref": 1, "penalty": 1,     // multipliers, 2 decimals (feedback is the +/- fraction)
  "weights": { "interest": 35, "novelty": 20, "evidence": 25, "impact": 20 },
  "points": { "interest": 35, "novelty": 18.7, "evidence": 10, "impact": 20 },  // round1(component × weight)
  "base": 83.7,                                                        // round1(Σ points), out of 100
  "score": 77.8,                                                       // = stories.score
  "newest_hours": 6.6, "ranked_at": "2026-11-18T23:28:18.203Z",
  "interest_raw": 25.48, "interest_cap": 9,
  "priorities": [{ "topic": "Agent orchestration", "weight": 2, "hits": ["agent","agents","agentic","orchestration","multi-agent","workflow"], "rank": 1, "de_emphasis": false }],
  "watch": ["How are teams measuring whether AI agents improve business outcomes?"],
  "watch_terms": [{ "name": "How are teams measuring…", "kind": "question", "pinned": true, "weight": 1.5, "terms": ["agent","outcomes","metrics"] }],
  "employers": ["Google Cloud"], "employer_hits": [{ "name": "Google Cloud", "pinned": false }],
  "impact_hits": ["available","general availability","enterprise", "…"],
  "signals": { "testable": true, "challenges": false, "process": true, "numbers": true },
  "signal_hits": { "testable": ["available"], "challenges": [], "process": ["workflow"] },
  "signal_quotes": { "testable": "…sentence…", "challenges": null, "process": "…", "numbers": "…" },
  "numbers_found": ["28","500","one trillion tokens","90%","49%","1,250"],
  "similar_to": null,                         // { id, title, similarity } when the closest opened story has Jaccard ≥ 0.15
  "source_counts": { "posts": 6, "outlets": 1, "first_party": 6, "primary": 0, "independent": 0, "commentary": 0, "independent_outlets": 0, "origin_domain": "cloud.google.com" },
  "sources": 1, "all_sources": 1,             // (legacy) "credible" outlets incl. first-party; do not display
  "engagement": {}
}
```

**Reconciliation (binding):** `score === round1(base × recency × (1 + feedback) × source_pref × penalty)` where `base === round1(Σ points)` and `points.k === round1(k × weights.k)`. Implemented once in `src/score.js` (`scoreFrom(b)`); `npm test` checks every story. Display the numbers as stored and the sum will always match.

The DB was re-ranked with `node --disable-warning=ExperimentalWarning src/rerank.js`, which scores as of the last pipeline rank time (`2026-11-18T23:28:18Z`) so recency is not silently aged between runs (`--now` re-ranks as of now). Because components are now rounded before multiplying, a few scores moved by ≤0.3 (story 16: 78.1 → 77.8). Cleared count is unchanged (7 of 19).

`explanation` (string, " · "-joined) no longer contains "credible independent source". The source clause now reads e.g. "6 posts from 1 outlet (6 first-party, 0 independent)". Prefer the structured `evidence` groups in the dossier over parsing it.

---

## GET /api/stories

Query: `days`, `topic`, `company`, `q`, `status=archived`, `limit` (default 60). Returns an **array** of hydrated story rows ordered by score desc:

`id, title, summary, first_seen, updated_at, score, breakdown (v2 object), explanation, topics[], companies[], last_viewed_at, status, lens (raw), is_demo, viewed_score, article_count, domain_count, new_since_view, collections` + all **shared story facts** + `main_topic`.

## GET /api/stories/:id

Query: `mark_viewed=0` to avoid marking it seen (use for prefetch on hover). Response:

```jsonc
{
  "story": { /* story row + shared facts + main_topic + threshold + prev_score */ },
  "articles": [ArticleView],          // ordered per F §3: announcement/research → reporting → commentary → community/application, then date
  "claims": [{ "id", "story_id", "article_id", "text", "evidence_kind", "has_number", "text_clean", "marks" }],   // flat list (legacy + search)
  "claim_duplicates": [{ "id", "duplicate_of", "article_id" }],
  "domain_groups": [{ "domain": "cloud.google.com", "posts": 6, "roles": ["first_party"], "collapse": true, "label": "6 posts from cloud.google.com (first-party)" }],
  "sources_header": {
    "sentence": "6 posts from 1 outlet: 6 first-party, 0 independent, 0 commentary/community.",
    "line": "6 posts · 1 outlet · 0 independent",
    "counts": { /* source counts */ },
    "callout": { "kind": "all_first_party", "text": "No independent outlet has reported this yet; every figure below is the company’s own.", "marks": [] }
      // kind: "disagreement" (text "Independent check: …", marks, article_id, claim_id) | "all_first_party" | "no_independent" | null
  },
  "breakdown": BreakdownView,
  "evidence": EvidenceGroups,
  "why_ranked": ["Fits Agent orchestration and AI governance (interest maxed, 35 of 35).",
                 "Evidence is thin: 6 posts from 1 outlet, no independent report (10 of 25).",
                 "Worth a post: you can test it, it changes a process and it has checkable numbers."],
  "lens": { "who": ["teams wiring LLM agents into real workflows", "operations leaders deciding where AI pays off"], "decision": "…", "test": ["…", "…"], "provider": "local heuristic" },
  "lens_raw": { /* original lens_json incl. learn — do not display learn */ },
  "employer_connections": [{ "employer", "matched": [], "why", "source": { "url", … } }],
  "drafts": [{ "id", "channel", "format", "status", "title", "updated_at" }],
  "projects": [{ "id", "title", "status" }],
  "origin": { /* raw origin article */ }, "saved": [], "feedback": []
}
```

**ArticleView**
```jsonc
{
  "id": 22, "domain": "cloud.google.com", "title": "…", "url": "…",
  "kind": "announcement", "evidence_kind": "announcement",
  "kind_label": "Primary",            // Primary | Research | Independent | Reporting | Commentary | Community | Release notes
  "role": "first_party",              // first_party | primary | independent | commentary
  "source_id": 23, "source_name": "Google Cloud — AI & ML blog",
  "published_at": null, "fetched_at": "2026-11-18T16:52:02.775Z",
  "date_basis": "fetched",            // show "fetched 18 Nov" when published_at is null
  "summary": null,                    // cleaned summary, or null when it is boilerplate
  "says": { "text": "In the last year, nearly 500 Google Cloud customers…", "marks": [[25,28],[77,96]], "from": "claim", "claim_id": 48 },
                                      // "What it says": the summary if usable, else the article's best claim; null if neither
  "is_new": false, "is_demo": false, "is_origin": true, "domain_posts": 6,
  "claims": [{ "id", "text", "marks", "evidence_kind", "has_number", "also_reported_by": ["b.example"], "used_as_summary": false }],
  "claims_total": 0                   // show up to 3 (has_number first, already sorted), then "+N more claims"
}
```
Claims shown in `says`, claims contained in the summary, boilerplate claims, claims under 6 words and run-together release-note lists are already excluded. Near-duplicates across articles (Jaccard > 0.6) are folded into the first one's `also_reported_by`. When `domain_posts >= 5`, collapse to the `domain_groups[].label` and show the first 2.

**BreakdownView** (track lengths ∝ maxima; fill = `fraction`)
```jsonc
{
  "version": 2, "score": 77.8, "threshold": 55, "base": 83.7, "base_max": 100,
  "rows": [
    { "key": "interest", "label": "Interest", "value": 1,    "points": 35,   "max": 35, "weight_pct": 35, "fraction": 1,     "track": 1,     "note": "maxed" },
    { "key": "evidence", "label": "Evidence", "value": 0.4,  "points": 10,   "max": 25, "weight_pct": 25, "fraction": 0.4,   "track": 0.714, "note": "1 outlet, first-party only" },
    { "key": "novelty",  "label": "Novelty",  "value": 0.933,"points": 18.7, "max": 20, "weight_pct": 20, "fraction": 0.935, "track": 0.571, "note": "unlike stories you’ve opened" },
    { "key": "impact",   "label": "Impact",   "value": 1,    "points": 20,   "max": 20, "weight_pct": 20, "fraction": 1,     "track": 0.571, "note": "availability, general availability · testable, process change, numbers" }
  ],
  "multipliers": [
    { "key": "recency",     "label": "recency",     "value": 0.93, "note": "newest post ~7 h old" },
    { "key": "feedback",    "label": "feedback",    "value": 1,    "note": "no feedback on these topics" },
    { "key": "source_pref", "label": "source pref", "value": 1,    "note": "no source marked low quality" },
    { "key": "penalty",     "label": "de-emphasis", "value": 1,    "note": "no de-emphasized topics" }
  ],
  "computed": 77.8, "reconciles": true, "newest_hours": 6.6, "ranked_at": "…", "formula": "…"
}
```
Legacy (pre-v2) stories return `{ version: 1, legacy: true, score, reconciles: false }`; show only the score.

**EvidenceGroups** (each group has a `title`, rows with a ready plain-language `text`, and `empty` text when there are no rows)
```jsonc
{
  "priorities": { "title": "Matches your priorities", "rows": [{ "topic", "weight", "rank", "hits", "strong": true /* weight ≥ 2 → blue chip */, "text": "Agent orchestration: your #1 priority, matched “agent”, “agents”, “agentic” and “orchestration”." }],
                  "interest_points": 35, "interest_max": 35, "maxed": true, "summary": "Interest maxed: 35 of 35.", "empty": null },
  "watchlist":  { "title": "On your watchlist", "rows": [{ "name", "kind", "pinned", "terms", "text" }], "employers": [{ "name", "pinned", "text": "Mentions Google Cloud." }], "empty": null },
  "practical":  { "title": "Practical signals", "hits": [], "mapped": ["general availability", "an API"], "text": "Mentions …", "empty": null },
  "post_worthy":{ "title": "Why it’s post-worthy", "rows": [{ "signal": "testable|challenges|process|numbers", "label": "You can try it", "quote": "…", "terms": [], "text": "You can try it: “…”" }], "empty": null },
  "de_emphasis":{ "title": "Marked down", "rows": [{ "topic", "hits", "factor" }], "text": "Marked down 30% for funding & valuation (matched “raises”, “series b”)." /* or null */ },
  "notes": ["Similar to a story you’ve opened (novelty 9 of 20).", "Your feedback on these topics adds 12%."]
}
```

---

## GET /api/today

Existing fields kept (`date, brief, draft, awaiting, outreach_awaiting, followups, evergreen_candidates, last_run, threshold`). Added:

```jsonc
{
  "today": "2026-11-19", "brief_date": "2026-11-18", "run_date": "2026-11-18", "is_today": false, "brief_date_label": "Wed 18 Nov",
  "ranked": 19, "cleared": 7, "below": 12, "window_days": 7,          // same 7-day window as /api/stories?days=7
  "topic_counts": [                                                   // over cleared stories, sorted by weighted desc
    { "topic": "Agent orchestration", "count": 6, "weight": 2,   "weighted": 12, "share": 0.857, "eligible": true },
    { "topic": "AI governance",       "count": 4, "weight": 2,   "weighted": 8,  "share": 0.571, "eligible": true },
    { "topic": "Machine learning",    "count": 5, "weight": 1,   "weighted": 5,  "share": 0.714, "eligible": false }, …
  ],
  "headline_topic": "Agent orchestration", "second_topic": "AI governance",   // argmax weighted over eligible (weight > 1); fallback all
  "top": { "id": 16, "title": "…", "short_title": "Gemini at Work 2026", "score": 77.8, "independent_outlets": 0,
           "evidence_qualifier": "with no independent report yet", "finding": "…", "finding_marks": [[25,28],[71,90]] },
  "sources_total": 26, "sources_paused": 26, "schedule_enabled": false,
  "last_run_summary": RunSummary
}
```
`brief.items[]` are the brief snapshot overlaid with the **live** story: `score` (live), `brief_score` (snapshot), `explanation` (live), `brief_explanation`, `topics`, `main_topic`, `qualifies` (live score ≥ threshold), `is_demo`, `why` (3 "Why it ranked" bullets), all shared story facts, `companies`, `status`, `first_seen`, `updated_at`. `summary` on an item is the brief's text and may be boilerplate: do not use it as a dek.

F's Today templates map directly: "{cleared} of {ranked} ranked stories cleared your threshold of {threshold}. {headline_topic} is in {topic_counts[0].count} of them; …" and "Top: {top.short_title} at {round(top.score)}, {top.evidence_qualifier}." "Dominates" when `share ≥ 0.5`. When `is_today` is false, use the "From {brief_date_label}'s run" eyebrow.

## GET /api/status

Existing fields kept. Added/changed:
```jsonc
{
  "counts": { "stories": 19, "articles": 48, "sources": 26, "awaiting": 22, "demo_articles": 13,
              "claims": 65, "drafts_open": 22, "notes": 35, "briefs": 1, "sources_paused": 26, "contacts": 4, "schedule_enabled": false },
  "schedule": { "enabled": false, "time": "07:00" },
  "last_run": RunSummary,
  "issue": { "number": 1, "brief_date": "2026-11-18", "date_label": "Wed 18 Nov", "is_today": false },   // number = briefs up to that date; null if no brief
  "timezone_abbr": "EST"
}
```
`drafts_open` = drafts not published and not archived.

**RunSummary**
```jsonc
{ "id": 16, "run_date": "2026-11-18", "trigger": "manual", "status": "done", "started_at": "…", "finished_at": "…",
  "time_local": "6:28 PM", "date_local": "Wed 18 Nov", "timezone": "America/New_York", "timezone_abbr": "EST",
  "sources_read": 0, "sources_failed": 0, "sources_skipped": 0, "new_articles": 0, "ranked": 19, "brief_items": 6,
  "failed_stage": null, "error": null, "cost_usd": 0 }
```
Status pill: "No. {issue.number} · {issue.date_label} · ● Ran {last_run.time_local} · {new_articles} new · {ranked} ranked · {today.cleared} above {threshold}". The dot is amber when `sources_read === 0`.

---

## GET /api/search

Query: `q`, `type` (comma list; default `stories,claims,briefs,drafts,notes,contacts`), `topic`, `company`, `source`, `status`, `employer` (contacts), `min_score`, `from`, `to`, `limit` (default 50, max 200). Empty `q` matches everything (idle state).

```jsonc
{
  "q": "agent",
  "stories":  [{ "id", "title", "summary", "topics", "companies", "status", "score", "first_seen", "updated_at", "is_demo", "main_topic", /* + shared story facts */ }],
              // title matches first, then score desc
  "claims":   [{ "id", "text", "text_clean", "marks", "evidence_kind", "has_number", "story_id", "article_id", "url", "domain",
                 "article_title", "story_title", "story_short_title", "story_score" }],
  "briefs":   [{ "id", "run_date", "summary", "quiet" }],
  "drafts":   [{ "id", "title", "channel", "format", "status", "updated_at", "planned_date", "story_id", "story_score" }],
  "notes":    [{ "id", "text", "kind", "draft_id", "story_id", "include", "created_at", "draft_title" }],
  "contacts": [{ "id", "name", "role", "org", "employer", "team", "stage", "dnc" /* bool */, "next_step", "next_date", "updated_at" }],
  "counts":   { "stories": 10, "claims": 8, "briefs": 1, "drafts": 21, "notes": 0, "contacts": 1, "total": 41 },   // true match counts (not capped by limit)
  "totals":   { "stories": 19, "claims": 65, "drafts": 24, "notes": 35, "briefs": 1, "contacts": 4 }                // table sizes, for the idle headline
}
```
Contacts match on name, role, org, employer, team and why.

---

## GET /api/sources

Still an **array** (one row per source), ordered by group then name. Each row: all `sources` columns (`paused` and `is_demo` are booleans) plus:

| field | meaning |
|---|---|
| `article_count` | all-time articles |
| `articles_7d` | articles fetched in the last 7 days |
| `stories_count` | distinct stories its articles belong to |
| `last_article_at` | newest `COALESCE(published_at, fetched_at)` |
| `health` | `paused` (paused) > `error` (has `last_error`) > `stale` (never synced, or last sync ≥ 48 h ago) > `ok` |
| `health_unpaused` | what `health` would be if un-paused (lets the UI say "paused · was failing") |
| `connector`, `connector_status` | as before |

## GET /api/sources/summary
```jsonc
{ "sources": 26, "ok": 0, "stale": 0, "error": 0, "paused": 26, "all_paused": true, "with_error": 12, "demo": 9,
  "articles_7d": 48, "articles_total": 48, "last_sync_at": "2026-11-18T16:52:03.375Z",
  "most_stories": { "id": 19, "name": "Anthropic News", "stories_count": 3 },
  "most_articles": { "id": 26, "name": "GitHub — Anthropic Python SDK releases", "article_count": 10 },
  "unpaused_health": { "ok": 13, "stale": 1, "error": 12 } }
```

## GET /api/sources/:id/articles?limit=5
Array (limit 1–50, default 5), newest first: `{ id, title, url, domain, evidence_kind, published_at, fetched_at, story_id, story_title, story_score, is_demo }`. 404 if the source does not exist.

---

## GET /api/calendar?month=YYYY-MM
```jsonc
{
  "month": "2026-11",
  "drafts":   [{ "id", "title", "channel", "format", "status", "planned_date", "published_at", "story_id", "score", "story_title", "approved" /* bool */ }],
  "unplanned":[{ "id", "title", "channel", "format", "status", "story_id", "score", "story_title" }],   // LIMIT 30
  "unplanned_total": 22,                                                                             // true count for "30+"
  "outreach": [{ "id", "channel", "status", "send_at", "name" }],
  "history":  [{ "id", "title", "channel", "format", "published_at", "story_id", "score" }]
}
```
`score` is the linked story's score (null when the draft has no story); feed it to `qualityColor(score, threshold)`.

## POST /api/drafts/:id/plan (calendar drag-to-day)
Body `{ "date": "YYYY-MM-DD" }` to plan, `{ "date": null }` to move back to the tray.
- Changes `planned_date` only. **Status, approval, content and `updated_at` are untouched**, so a scheduled post stays scheduled and approved.
- 200 `{ "ok": true, "id": 31, "planned_date": "2026-11-15", "previous_date": null, "status": "draft" }` (use `previous_date` for Undo).
- 400 bad date format · 404 unknown draft · 409 the draft is published.

## POST /api/drafts/:id/schedule (unchanged, approval-gated)
Only for approved drafts: 400 "Approve the current text and media before scheduling." otherwise. Sets status `scheduled`. Offer it as a separate action, never on drag.

---

## GET /api/map

Every story (including archived; filter on `status` client-side) as a node, with similarity edges, topic clusters and a seeded server-side layout (`src/maplayout.js`).

Headers: `ETag: "map-v1-<fingerprint>"`, `Cache-Control: no-cache`, `Server-Timing: map;dur=<ms>`. Send `If-None-Match` with the stored ETag to get **304** with no body. Cache the body in `localStorage['byline-map-v1']`, draw it immediately, then revalidate.

```jsonc
{
  "nodes": [{
    "id": 16, "title": "…", "short_title": "Gemini at Work 2026", "score": 77.8, "topics": ["Agent orchestration", …], "topic": "Agent orchestration",
    "companies": ["Google Cloud", …], "first_seen": "…", "updated_at": "…", "status": "seen", "is_demo": false,
    "finding": "…", "finding_marks": [[25,28],[71,90]],
    "posts": 6, "outlets": 1, "first_party": 6, "independent": 0, "independent_outlets": 0, "commentary": 0, "source_line": "6 posts · 1 outlet · 0 independent",
    "watch": ["How are teams measuring…"], "sources": ["Google Cloud — AI & ML blog"],
    "x": 43.2, "y": 121, "r": 15.1,      // world units; r = 5 + 13 × score/100 (collision radius used by the layout)
    "degree": 4
  }],
  "edges": [{ "a": 3, "b": 5, "weight": 4.55,                 // a < b; sorted by (a, b)
              "reasons": { "companies": [], "watchlist": ["How are teams measuring…", "Evals"], "sources": ["DEMO · The Ledger (tech news)"], "topics": ["Evaluation", "Agent orchestration"] } }],
  "clusters": [{ "topic": "Agent orchestration", "label": "Agent orchestration", "count": 6, "x": 55.2, "y": 21.9, "anchor": [38.4, 0],
                 "radius": 163.1, "recent": 6, "mean_score": 49.9, "heat_raw": 2.996, "heat": 1 }],   // sorted by heat; topic null → label "Unsorted"
  "topic_counts": [{ "topic": "Agent orchestration", "count": 10, "weight": 2 }, …],   // membership over all nodes ("links 10 of 19 stories")
  "hot_topics": [{ "topic", "heat", "count", "recent" }],                               // top 3 clusters by heat
  "bridge": { "id": 5, "short_title": "…", "degree": 10, "via": "topics" },              // highest-degree node; via = dominant reason type
  "range": { "first_seen_min": "2024-11-06T10:59:59.000Z", "first_seen_max": "2026-11-18T23:27:27.280Z" },
  "bounds": { "x0": -411.1, "y0": -230.3, "x1": 346.5, "y1": 233.2 },                  // fit-to-view box incl. radii
  "threshold": 55,
  "meta": { "version": 1, "n": 19, "e": 36, "layout": "full|relaxed|kept|empty", "iterations": 300, "scale": 261.5, "compute_ms": 34.1, "generated_at": "…", "etag": "…" }
}
```

How it is computed (E §4):
- **Edges.** Each shared feature adds `base × sqrt(2 / df)` (df = how many stories carry the feature; companies 3, watchlist 2, sources 1.5, topics 1 × max(0.5, priority weight / 2)), so a watchlist item firing on most stories links them only weakly. Each node keeps its top 4 edges with weight ≥ 0.9 (union), about 2n edges.
- **Layout.** mulberry32 seeded by a hash of the sorted ids; topic anchors on a golden-angle spiral; 300 iterations of Barnes–Hut repulsion (θ 1.2), weighted link springs, anchor pull and grid collision. Deterministic for the same input. 19 nodes: ~3 ms warm (34 ms first call incl. JIT); synthetic 500 nodes: ~120 ms warm / ~200 ms cold.
- **Stability.** Positions persist in the `cache` table (`map:positions:v1`). When more than half the nodes already have positions, those stay pinned and new stories start next to their most similar positioned neighbour, then relax 50 iterations (`meta.layout = "relaxed"`); if nothing is new, positions are returned as stored (`"kept"`). Old nodes never move.
- **Cache.** In memory, keyed by a fingerprint of story ids/scores/updated_at/topics/companies, article and claim counts, watchlists and priority weights, plus the map version.

---

## Shared server modules (for other server-side code)

- `src/finding.js` (pure, no DB): `findingLine(story, articles, claims) → { text, marks, kind, article_id, claim_id }`, `numberMarks(text)`, `markedText(text, marks)`, `isBoilerplate(text)`, `BOILERPLATE`, `cleanClaim(text)`, `usableClaim(clean, raw)`, `sourceCounts(articles)`, `sourceLine(counts)`, `sourceSummary(counts)`, `evidenceQualifier(counts)`, `shortTitle(title)`, `originOf`, `roleOf`, `kindLabel`, `orderArticles`, `groupClaims`, `mapSignals`, `listJoin`, `attribute`, `orgName`.
- `src/score.js` (pure): `WEIGHTS`, `BREAKDOWN_VERSION`, `scoreFrom(breakdown) → { points, base, multiplier, score }`.
- `src/facts.js`: `enrich(rows)`, `storyFacts(story, articles, claims)`, `loadMany(ids)`, `mainTopic(topics, weights)`, `whyRanked(story, counts)`.
- `src/dossier.js`: `breakdownView`, `evidenceGroups`, `legacyEvidence`, `lensView`, `articlesView`, `sourcesHeader`.
- `src/maplayout.js` (pure): `buildGraph`, `layout`, `clusters`, `mulberry32`, `seedFor`, `radiusFor`, `MAP_VERSION`.
- `src/routes/content.js` exports `runSummary(run, tz)`, `windowCounts(settings, days)`, `sourceHealth(src)`, `sourceRows()`, `sourceSummaryTotals(rows)`.
- `src/timefmt.js`: `timeLocal(iso, tz)`, `dateLocal(iso, tz)`, `dayLabel(ymd)`, `tzAbbr(tz)`.
- `src/rerank.js`: CLI that re-ranks every story and verifies reconciliation.
- `server.js`: route handlers now also receive `res`; a handler that writes its own response (as `/api/map` does for ETag/304) is left alone.
