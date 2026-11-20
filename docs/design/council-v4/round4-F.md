# Council F, round 4: type, information and data honesty (v4 at ad8490c, HEAD 468230d)

Lens: the type scale and hierarchy; whether each headline and one-liner states a finding with numbers; data honesty (posts, outlets, first-party and independent counts, ranked not scanned, the threshold read from settings); wording; accessibility (contrast and focus).

## How I looked

I ran the app live on :4454 in Playwright at deviceScaleFactor 1 and covered:
- all 14 routes, plus `#/draft/1` and `#/person/4`, in Proof and Night, at 1440 and 390. I scrolled each page before capturing it.
- the dossier:
  - opened by clicking from Feed (story 5, Relay) and from the Today lead (story 16, Gemini)
  - story 13 (SDK release notes) opened directly
  - each scrolled in four steps, then closed with Esc (it returns to `#/feed`)
- collapsing the rail with the dossier open. I sampled rail.right and dossier.left on every frame: the gap stays 12 px on every frame, from 244/256 down to 76/88.
- the collapsed rail: pitch is 36 px within a group and 44 px across groups, as specified
- a 14-frame Today load, a 12-frame Today→Feed tab switch, a Feed row hover, a 24-stop Tab walk, and theme-switch frames
- the Map range toggle (7 days / 30 days / All) and the Map's selected-story panel
- per-route h1, one-liner, eyebrow and heading text (`sweep.json`), and a computed font-size census of every route (`type.cjs`)
- a gate run: `node test/e2e/run.mjs --port 4464 --only a11y,E1,E2,E12,C-tabswap`. Other council members were running at the same time, so the perf numbers are noisy.
  - **Pass:** F-contrast 28/28, F-structure 60/60, F-focus 9/9, F-reduced 6/6, C-tabswap 10/10.
  - **E1 29/34:**
    - calendar 108 ms (`setTimeout` in calendar.js, 25 ms; Σ blocking 189 ms)
    - feed 80 ms
    - studio 68 ms
    - search 55 ms
  - **E2 10/17:**
    - desktop open's longest frame is 88 ms (`onhashchange` in app.js, 41 ms, of which 20 ms is forced layout)
    - collapse p95 at 4× is 36.6 ms against a limit of 33
    - close p95 at 1× is 33.4 ms
  - **E12 2/6:** today at 4× has a p95 of 116.6 ms.

Captures are in `/tmp/claude-0/council-F-r4/`:
- `<route>_<light|dark>_<1440|390>.png`
- `dos_feed5_*`, `dos_today16_*`, `dos_13_*`, `dos_collapse_f*.png`, `dos_collapsed_light_1440.png`, `ph_dossier_sheet.png`
- `load_sheet.png`, `tab_sheet.png`, `hover_pair.png`, `focus_*.png`, `theme_*.png`
- `map_7d.png`, `search_bottom.png`
- `dark_grid.png`, `phone_grid_*.png`
- `sweep.json`, `dossier.json`, `motion.json`

There were no console or page errors on any route, theme or width, no horizontal scroll at 390, and one h1 per view.

## Round 3 fixes I verified live

- **Today.**
  - The lead tile's Source mix now reads "6 posts · 1 outlet · all first-party".
  - "Named" chips are in Geist, not mono.
  - Mini-map labels use short titles ("Gemini at Work 2026").
  - The mini map uses the Map's wording: "main topic of 6 · tagged on 10".
  - The Run button now sits in the Collection-off band.
  - The weather dots are beeswarmed.
  - The 62, 61 and 59 chips are now told apart (59 is visibly lighter).
- **Dossier.**
  - "Why it's post-worthy" no longer echoes its label: "You can try it · matched available".
  - Release notes collapse to one row: "4 release notes from github.com (23 Oct – 9 Nov): v2.2.0, v2.5.0, v2.6.0, v2.7.0 · no summaries extracted".
  - "No independent" is now said three times, not four, and the header subline is gone.
  - The breakdown reads "bar width = share of 100".
  - On phone, the eyebrow wraps without lines that start with a separator.
  - There are no `--ok` greens.
- **Findings.**
  - Release clusters read "6 releases, v2.1.0 → v2.10.0, 21 Oct – 17 Nov".
  - Title echoes are null and the dek line is omitted (story 15, Hot take).
  - "Why it ranked" says "Post-worthy signals: …" and "full marks for interest, 35 of 35".
- **Search.** Claim chips are plain score chips, and "17 copies" is spelled out.
- **Map.**
  - The lede reads "19 stories updated this week, 36 connections. The biggest bridge, Northwind AI releases Relay, links 10 stories through…".
  - The side card fits at 900 px.
- **Studio.** The hero reads "Story score 72", and group dates appear in the group meta.
- **Calendar.**
  - The legend now has "● story above 55 · ○ below".
  - Past posting days show "missed".
  - The tray rows have hooks.
- **Performance.** The Gemini draft is listed under its story ("LinkedIn · roundup: Weekly roundup · 2026-W47"), and the slot line appears once.
- **Campaigns.** One slot line ("Mon 23 Nov · LinkedIn, Instagram, Video") and a sticky aside (`.cp-aside` is `position: sticky`).
- **Career.**
  - Skills are in sentence case ("Agents · also agentic (4)").
  - The h1 is "Agents tops your skill radar: 10 mentions this week."
  - The one-liner no longer repeats the h1.
- **Employers.**
  - The watchlist column is folded into the employer cell.
  - Rows with identical story sets say "Same 2 stories as …".
  - "No stories yet" is one line.
- **Runs.**
  - The date control reads "Fri 20 Nov".
  - "11 sources failed".
  - "Thu 2 Jan 2020" now uses the same date format as the rest of the app.
- **Settings.** Priority terms wrap to two lines, and the three bottom cards end level.

## What still holds it back

1. **Employer connections still claim "Named in a source" when no source names the company.** This is the one data-honesty error left.
   - **Story 16.** The Google DeepMind card says "Named in a source · Works publicly on Gemini", but the quote ("This article is adapted from Thomas Kurian's keynote address…") does not contain "DeepMind".
     - Cause: `src/ai/local.js` sets `nameHit` true whenever `story.companies` contains the employer, even when the company was added by the product term "Gemini".
     - The quote is the passage with the most term hits, not the one that names the company.
   - The same overmatch keeps the Employers h1 at "4 employers tie for the lead with 2 stories each".
   - `/api/stories/16` disagrees with itself:
     - `breakdown.employers` = ["Google Cloud"]
     - `companies` = ["Google (other teams)", "Google Cloud", "Google DeepMind"]
2. **Story 13 contradicts itself.**
   - The header says "Companies · AWS · the only company named", and the watchlist says "Mentions AWS".
   - Employers lists story 13 under AWS.
   - Yet the dossier's Employer connections says "No grounded connection to your target employers", because the passage corpus is empty: the release notes have no summaries.
3. **Story 5's post-worthy quotes repeat.** "You can try it" and "It changes a process" quote the same sentence.
4. **Story 5's topical overlap is meaningless.** It shows "Topical overlap only, not named: Google DeepMind" on the passage "Relay cut task failures by 38%…".
5. **The lens is boilerplate.** "It could change whether to build orchestration in-house or adopt a framework." and "teams wiring LLM agents into real workflows" appear verbatim on both Relay and Gemini. That reads as template text in a dossier that is otherwise specific.
6. **The Map lede ignores the range toggle.**
   - With "7 days 12" selected, the h1 still says "links 10 of 19 stories" and the lede "19 stories updated this week", while the canvas says "Showing 12 of 19 stories · first seen in the last 7 days".
   - "19 … this week" also contradicts the toggle's own "7 days 12": the lede counts `updated_at` and the toggle counts `first_seen`.
   - Region labels still say "leads 6", where the side list and Today say "main topic of 6".
7. **The type scale is mostly disciplined, with a long tail of off-role sizes.**
   - The role scale is 11 / 12.5 / 13 / 14 / 15 / 18 / 20 / 26 / 32 / 48 / display. The census also finds:
     - 10.5 px: Map labels, People and Employers column mono, Search mono
     - 11.5, 13.5 and 14.5 px
     - Calendar h2 at 21 px and Settings h2 at 22 px
   - The 10.5 px text sits below the 11 px floor.
8. **Invisible tab stops.**
   - `.theme-toggle-mini` has opacity 0 in the expanded rail but is still a Tab stop, after "Night". Its label is "Switch to Night (dark)", so it reads as a duplicate control.
   - The harness also notes transparent focusable controls: `.st-plan` "Plan" in Studio, `.cal-ilink` in Calendar, and a `btn--ghost btn--sm` on every route.
9. **Wording drift.**
   - **Engine name:** "Template engine (free)" in Settings › Collection, "local engine" in AI provider, "Local drafting engine" in Runs, and "Local engine" in the rail.
   - **Draft counts:** Search says "24 drafts" where Studio says "22 open drafts".
   - **Dates:** Search shows "Brief · Wed, 18 Nov 2026" with a comma.
   - **Employer row order:** Employers titles the Google group under "Google (other teams)" and calls Google Cloud, the actual first-party publisher, "Same 2 stories as Google (other teams)".
   - **Campaigns h1:** "No campaigns yet." is an empty state, not a finding.
   - **People:** "4 contacts (2 do-not-contact)" hides that two of the records are one person.
10. **Calendar marks "missed" back to 2 Nov,** before any draft existed (the first was created 18 Nov). It overstates a failure.
11. **Career keeps "Evals" (3) and "Evaluation" (9) as separate rows,** although the round-3 brief folded aliases.
12. **Motion caps the rubric.**
    - E12 today at 4× has a p95 of 116.6 ms.
    - E2 open's longest frame is 88 ms, with 20 ms of forced layout in `onhashchange`.
    - E1 calendar is 108 ms.
    - Some of this is contention, but E1, E2 and E12 have now failed in every round.

## Rubric

| | Score |
|---|---|
| unique_typography | 8.5 |
| color_cohesion | 8 |
| theme_cohesion | 8.5 |
| motion_cohesion | 8 |
| motion_smoothness | 7 |
| generic_typography | 2 |
| background_generic | 2 |
| color_combo_generic | 2 |
| motion_generic | 2 |
| ai_slop | 2 |
| **overall** | **41 / 50** |

**Verdict: passes the overall bar; one dimension is short.** motion_smoothness is still 7, because E1, E2 and E12 fail again. Everything else meets the bar.
- **Type and information:** at their best so far.
  - Every tab's h1 is a finding with numbers (or an honest empty state).
  - The dossier now summarises what each source said.
  - Release notes collapse.
  - The chip ramp reads.
- **What keeps overall below 43:** the employer matcher still claims "named" without a naming passage (dossier and Employers), the Map ignores its own filter, and the lens text is boilerplate.

## Tab scores (out of 100)

| Tab | Score | Why |
|---|---|---|
| rail | 91 | Groups, the sliding highlight, an even collapsed rhythm (36/44 measured), the by-line mark and clear focus rings. The dossier tracks the rail edge on every frame. One invisible tab stop (`.theme-toggle-mini`). |
| today | 90 | **Strengths:** the informative h1 and numeric one-liner, an honest age eyebrow, the gradient ring with no tick, numbered why-ranked bullets, one honest Source mix line, short map labels, and a weather chart with a key. The Run button now sits in the Collection-off band. **Gaps:** "Named" still lists Google DeepMind and Google (other teams), and the map's Hottest regions order (Business adoption 2nd) differs from the lede's (AI governance in 4) without saying why. |
| dossier | 89 | **Strengths:** rail-height geometry and collapse coupling, per-source summaries, a collapsed release-notes row, the first-party callout and a reconciling breakdown. **Gaps:** "Named in a source" for DeepMind on a quote that never names it; story 13 says AWS is named, then "No grounded connection"; one quote is reused for two signals; and the boilerplate lens. |
| feed | 90 | A strong title/meta step, two topics, a glyph legend, a threshold divider and a readable chip ramp. Release findings now carry numbers and echo deks are gone. Story 18's finding still restates its title, and the S-1 finding is a marketing tail. |
| map | 86 | A real map with regions, a legend, a selected-story panel and related stories. The h1 and lede don't follow the 7-day/30-day toggle. "19 … this week" contradicts "7 days 12". Region labels say "leads N" instead of the app's "main topic of N". |
| search | 88 | Big bar, chips with counts, plain score chips, grouped results including contacts and briefs, and a sticky Refine. Minor: "24 drafts" against Studio's 22, a comma date on the brief, and Google overmatch in the Employers chips. |
| studio | 88 | A clear hero with its approval checklist, grouped copies with hooks, and a side column with no-draft stories and channels. Hooks truncate mid-word ("Northwind AI released Rel…"), and a hover-only "Plan" button is invisible when focused. |
| calendar | 88 | Month grid, no day/date gap, open slots, a legend with story dots, today's panel and cadence. "missed" is stamped back to 2 Nov before any draft existed, the h2 is off-scale at 21 px, and E1 fails here at 108 ms. |
| campaigns | 86 | A planning page: per-row Start campaign, drafts counted per story, a 95% topic share, one slot line and a sticky aside. The h1 "No campaigns yet." states an absence where it could state the 7 candidates. |
| performance | 87 | An honest pipeline, the "all 22 edited Wed 18 Nov" sentence and grouping by story. The draft is correctly filed under Gemini. The Drafts-by-channel bar relies on the list below for its numbers, and one title truncates mid-phrase. |
| career | 87 | Weight column, sentence case, alias notes, the duplicate warning and an honest formula footnote. "Evals" and "Evaluation" are separate rows, so the radar double-counts one skill. |
| employers | 85 | Much cleaner: watchlists in the cell, "Same 2 stories as …" and one no-stories line. The 4-way-tie headline still rests on product-term and bare-word matches. The first-party employer (Google Cloud) is the row that says "Same as Google (other teams)". |
| people | 88 | Overdue, duplicate and do-not-contact are dense and honest. The one-liner's "4 contacts" should say 3 people, 4 records. |
| sources | 88 | Pre-pause health, a before/after bar, demo tags, articles/stories columns and an untrusted-content note. Twelve identical "Last error fetch failed" lines (all never synced) should be summarised once. |
| runs | 88 | Stage timeline, honest "Done · 0 sources read", grouped history and a formatted date. The READ, NEW and FAILED column heads don't say they mean sources, articles and sources. |
| settings | 87 | A data headline, a source-health card, honest provider status, and terms that wrap. The engine name changes between cards, and the h2 is 22 px, off the 20/26 scale. |

## Fixes (owner · severity)

1. **shared · blocker (dossier, employers): "Named in a source" must name the company** (`src/ai/local.js` employer connections, plus the code that builds `story.companies`).
   - Set `nameHit` only when a passage contains the employer's name or a name alias (e.g. "AWS", "Amazon Web Services"), not product terms such as "Gemini" or "Bedrock".
   - Quote the passage that contains the name hit.
   - When the only link is a product term, emit `kind: 'product'` and render "Linked by product: Gemini (no source names Google DeepMind)" with a neutral tag.
   - Make `story.companies` hold named employers only, and expose product links separately (`companies_via`), so the header, the Today "Named" chips and `/api/employers` agree with `breakdown.employers`.
   - Acceptance:
     - Story 16's DeepMind card either quotes a passage containing "DeepMind" or shows the product label.
     - Today's "Named" row for story 16 lists only employers a passage names.
     - The Employers h1 is recomputed.
2. **shared · major (dossier): story 13 contradicts itself.** When the passage corpus is empty (release notes with no summaries), fall back to article titles and bodies for employer matching. If that still finds no passage, render "AWS · named in 4 release notes (matched Bedrock); no passage extracted" instead of "No grounded connection". Acceptance: no dossier shows a company in the header and "No grounded connection" below it.
3. **shared · major (dossier): one quote reused for two post-worthy signals.**
   - Story 5 uses "Northwind AI released Relay… Apache 2.0 license." for both "You can try it" and "It changes a process".
   - In the post-worthy builder, pick a distinct sentence per signal. If none is left, use the `· matched <terms>` form already used for null quotes.
4. **shared · major (dossier): topical overlap on an irrelevant passage.** Show a "Topical overlap" chip only when the passage contains ≥ 2 of the employer's topic terms. Story 5's DeepMind overlap on "Relay cut task failures by 38%" must disappear.
5. **shared · minor (dossier): the lens is boilerplate** (`src/ai/local.js` lens).
   - "What it could change" and "Who it matters to" repeat across stories.
   - Build "What it could change" from the story's finding: for Gemini, "Whether 1-trillion-token customer volumes change how you budget agent pilots", using numbers from `finding_marks`. Otherwise omit the line.
   - Never show the same sentence for two different stories in one brief.
6. **shared · major (motion): E2 open's forced layout and E12 at 4×.**
   - **E2:** `onhashchange` in app.js costs 41 ms, 20 ms of it forced layout. Read every rect before the first style write, and reuse the cached rail rects.
   - **E12:** Today at 4× has p95 116.6 ms during rail collapse. Step `.main`'s padding once and animate `translateX` on `.page`, as S5 did for the dossier, with `contain: layout paint` on the Today tiles.
   - Re-run E2 and E12 on an idle machine.
7. **shared · minor (a11y): invisible tab stops.**
   - Give `.theme-toggle-mini` `visibility: hidden` (or `inert`) while the rail is expanded.
   - Add a shared rule so hover-revealed actions get `opacity: 1` on `:focus-visible`, and when their row has `:focus-within`. This covers the ghost buttons, Studio's `.st-plan` and Calendar's `.cal-ilink`.
   - Turn the F-structure "focusable but fully transparent" note into a failing check.
8. **shared · minor (type): enforce the role scale.**
   - Add an F-structure check that every text node's font-size is in {11, 12, 12.5, 13, 14, 15, 17, 18, 20, 26, 32, 36, 48, display} and ≥ 11 px.
   - Owners then map 10.5 → 11, 13.5 → 13, 14.5 → 15, 21 or 22 → 20, and 16 or 28 → 17 or 26.
9. **shared · minor (findings): echoes the filter misses** (`src/finding.js`).
   - Story 18's "The company raised a Series B funding round at a record valuation, investors said." restates its title. Lower the echo threshold to a content-token overlap of ≥ 0.6 after stop-words.
   - Story 14's FedRAMP finding ends in "marking the next evolution of how we are bringing…". Cut clauses that start with "marking", "underscoring" or "as we", and prefer a sentence with a number when the story has one.
10. **shared · minor (checks): unsupported employer sentence.** Draft 1's closing "Snowflake has written about data quality checks for this." shows 0 flags, although Snowflake has no story or source. The editorial check should flag any sentence that names a target employer without a cited source as an advisory "unsupported affiliation".
11. **feed-dossier · minor: repeated independent count.** The dossier header says "1 independent" and then "backed by 1 independent outlet". Drop the subline when it restates the count.
12. **feed-dossier · minor: the draft title wraps mid-token.** In the dossier's Drafts list, "Weekly roundup · 2026-W47" breaks as "2026-" / "W47". Put `white-space: nowrap` on the ISO-week token.
13. **feed-dossier · minor: hover hue.** The Feed row hover is `rgba(31,94,255,.05)`. The user asked for a slightly stronger hover: use .07 in Proof, check the Night equivalent, and keep text contrast ≥ 4.5:1.
14. **map · major: the h1 and lede must follow the range toggle and its date field.**
    - Recompute on toggle, using `first_seen` like the chips:
      - **7 days:** "12 stories first seen in the last 7 days, N connections."
      - **All:** "All 19 stories (first seen 26 Mar 2025 – 18 Nov 2026), 36 connections."
    - The h1 count changes too ("links N of 12 stories").
    - Never say "this week" for All.
15. **map · minor: region labels.** "Business adoption · leads 4" becomes "Business adoption · main topic of 4", the wording of the side list and Today's mini map.
16. **today · minor: two top-topic rankings with no explanation.** The lede ranks AI governance second (in 4 above the bar), while News map's Hottest regions ranks Business adoption second (main topic of 4). Add "by heat (score-weighted)" to the Hottest regions head, and in the legend: "differs from the brief's count above the bar".
17. **search-system · minor: Search wording.**
    - The one-liner's "24 drafts" becomes "24 drafts (22 open)".
    - The brief card's "Brief · Wed, 18 Nov 2026" becomes "Brief · Wed 18 Nov 2026".
18. **search-system · minor: Sources error summary.**
    - Twelve rows repeat "Last error fetch failed" and "never".
    - Add one line in the health card: "12 failing sources have never synced; every one reports 'fetch failed'."
    - In each row, render "never synced · fetch failed" in one line.
19. **search-system · minor: Runs and Settings labels.**
    - Runs history heads become "SOURCES READ", "NEW ARTICLES" and "SOURCES FAILED", or keep the short heads with a `title` tooltip.
    - Use one engine name everywhere: "Local engine (template, free)" in Settings › Collection, Settings › AI provider and Runs › Cost controls. The rail already says "Local engine".
    - Set the Settings card h2 to `t-title` (20 px), not 22.
20. **calendar-studio · major (perf): E1 calendar at 108 ms** (`setTimeout` in calendar.js, 25 ms; Σ blocking 189 ms). Render the visible month first, defer the tray, cadence and the outreach join to `requestIdleCallback` with a 300 ms timeout, and chunk by week.
21. **calendar-studio · minor: "missed" before any history.** Mark a posting day "missed" only from the first draft's `created_at` (18 Nov) or the date the cadence was set. Before that, show nothing. Also set the Calendar h2 to 20 px.
22. **calendar-studio · minor: Studio hooks truncate mid-word** ("What happened: Northwind AI released Rel…"). Truncate at a word boundary at ≤ 44 characters, and keep the full hook in `title`.
23. **career-publish · major (employers): row order and match kind.**
    - In a tie, title the group with the first-party employer (Google Cloud) and mark the others "Same 2 stories as Google Cloud".
    - Add each row's match kind: "first-party on 2", "named on 1", "via product term Gemini on 2".
    - After fix 1, recompute the h1 with F's template. Count distinct story sets: if siblings share one parent's posts, the h1 reads "AWS and Google Cloud lead with 2 stories each."
24. **career-publish · minor (career): fold "Evals" into "Evaluation"** as "also evals (3)", the same way "agentic" folds into Agents, and recompute the Evaluation weight.
25. **career-publish · minor (campaigns, people): headlines.**
    - Campaigns h1 "No campaigns yet." becomes "7 stories could anchor a campaign; none has started." The one-liner keeps "Gemini at Work 2026… scores highest."
    - People one-liner "4 contacts (2 do-not-contact)" becomes "4 contact records for 3 people (Test Alumna is saved twice; both do-not-contact)."

## Owner summary

- shared: 1 (blocker), 2, 3, 4, 5, 6, 7, 8, 9, 10
- feed-dossier: 11, 12, 13
- map: 14, 15
- today: 16
- search-system: 17, 18, 19
- calendar-studio: 20, 21, 22
- career-publish: 23, 24, 25
