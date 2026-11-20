# Council F, round 3: type, information and data honesty (v4 at 0504dc2)

Lens: the type scale and hierarchy; whether each headline and one-liner states a finding with numbers; data honesty (posts, outlets, first-party and independent counts, ranked not scanned, the threshold read from settings); wording; accessibility (contrast and focus).

## How I looked

I ran the app live on :4454 in Playwright at deviceScaleFactor 1 and covered:
- all 14 routes, plus `#/draft/1` and `#/person/4`, in Proof and Night, at 1440 and 390. I scrolled each page before its full-page capture so `content-visibility` sections render.
- the dossier opened from the Today lead (story 16) and from a Feed row (story 13, the anthropic-sdk-python v2.7.0 release), scrolled through, and closed with Esc (it returns to `#/today`)
- collapsing the rail with the dossier open
- the collapsed rail on a fresh load. Pitch is 36 px within a group and 44 px across groups.
- a 12-frame Today load and a 10-frame Feed→Today tab switch
- a Feed row hover and a 30-step Tab walk
- the phone dossier sheet
- per-route h1, one-liner, eyebrow and pill text, collected in `sweep.json`
- a gate re-run with `node test/e2e/run.mjs --port 4464 --only E1,E2`:
  - **E1 33/34.** Today's longest frame is 51 ms (limit 50).
  - **E2 11/13.** The desktop close's longest frame is 50 ms; rail collapse p95 at 4× is 40.9 ms (limit 33).

Captures are in `/tmp/claude-0/council-F-r3/`:
- `<route>_<light|dark>_<1440|390>.png`
- `load_sheet.png`, `tab_sheet.png`
- `dos_today*.png`, `dos_feed13*.png`, `dos_collapsed.png`, `ph_dossier.png`
- `today_collapsed.png`, `dark_grid.png`, `phone_grid.png`
- `crop_today_*.png`, `sweep.json`, `inter*.json`

There were no console or page errors on any route, theme or width, and one h1 per view.

## What round 2 fixed (verified live)

- **Rings on revisit.** The tab-switch frames show 78 and 72 from the first visible frame, with no "0" flash. The old and new h1 no longer double-expose.
- **Chips.**
  - The top band now ramps: 78 is rgb(14,53,172) and 72 is rgb(21,72,210).
  - The clears band ramps from L 0.883 (64) to 0.946 (56).
- **Employer connections.** Story 16 now shows "Google Cloud · First-party · This is Google Cloud's own post." The contradiction is gone.
- **Dossier claims.**
  - Claims are now shown in full: "Nearly 90% of the Fortune 100 are already using Gemini Enterprise to build, scale and govern agents."
  - Source cards 03–06 clamp at 2 lines.
- **The dossier header** uses "78 of 100 · 23 over your bar of 55", with a single precision.
- **Phone dossier actions** are all visible in a two-row grid.
- **Feed topic chips** are ordered by weight, so "Machine learning 9" comes last.
- **Today.**
  - The eyebrow states the brief's age: "Brief No. 1 · from the Wed 18 Nov run".
  - "Suggested next post" is the top above-bar story with no draft.
  - The weather chart has a "catch-all" row.
- **Studio** groups identical drafts (×5) and shows each draft's hook, and the side column now holds "Above your bar, no draft yet" and "By channel".
- **Campaigns** has a per-row Start campaign button and number highlights. It now reads as a planning page, not a Feed copy.
- **Performance.** "All 22 open drafts were last edited Wed 18 Nov" replaces the one-bar chart, and Closest to publishing is grouped by story.
- **Career** has a visible Weight column (mentions + 2 × job posts) and is sorted by it. The one-liner follows the template.
- **Employers** lists, under each bar, the story titles that mention the employer.
- **Sources** shows the pre-pause health ("was healthy", "was failing") as the primary state, with the last error inline.

## What still holds it back

1. **"Google (other teams)" is counted on Google Cloud's posts.**
   - Cause: its seed terms include the bare word `Google` (`src/seed.js:10`), which matches inside "Google Cloud".
   - On Employers, it shows the same 2 stories as Google Cloud. That inflates the h1 "4 employers tie for the lead".
   - In the dossier it is "Named in a source", with a quote that names only Google Cloud.
2. **The dossier's "Why it's post-worthy" repeats its heading as its body:** "You can try it / You can try it." This happens on both stories I opened. The row has `quote: null` and `text` equal to the label.
3. **"Worth a post: you can test it." appears in "Why it ranked" for a story scoring 17** (38 below the bar). It contradicts the score.
4. **Template findings and title echoes still reach the reader.**
   - The dek "Mentions an API and cost or pricing."
   - Feed and Campaigns findings that just repeat the title: "anthropic-sdk-python v2.10.0.", "AI for Science expands to foundations and institutions."
   - The release-notes dossier shows "No summary extracted for this post." four times in a row.
5. **The dossier says "no independent report" four times above the fold:**
   - header: "0 independent"
   - header: "with no independent report yet"
   - callout: "First-party only: No independent outlet has reported this yet"
   - group row: "6 posts from cloud.google.com (first-party)"
6. **"story 16" chips in Search mean *score* 16.** Dossier routes are also numbered (`#/story/16` is Gemini, which scores 78), so the label reads as an ID.
7. **Performance lists "Weekly roundup · 2026-W47" as a story.** It is draft 13 of story 16 (Gemini). Studio files it correctly.
8. **The Map lede says "19 stories from Nov 2024 to Nov 2026"**, which is first_seen taken from old MCP spec releases. Feed says "19 updated in the last 7 days". The lede's bridge sentence is repeated verbatim in the side card, and the side card's last line is clipped at 1440×900 (text bottom 889 px, card bottom 870 px).
9. **Smaller information issues on Today:**
   - The lead tile's Source mix line says the same thing twice in two styles: "6 posts · 1 outlet · 0 independent  6 first-party · 0 primary research · 0 commentary".
   - The "Named" chips are set in mono.
   - Mini-map labels ellipsise mid-word ("Gemini at Work 2026: Introduci…").
   - The mini map says "leads 6, in 10" where the Map tab says "6 of 19 stories · tagged on 10".
   - The clears chips 62, 61 and 59 still look identical (ΔL ≈ 0.02).
10. **Dates and casing.**
    - Native date inputs show "11/20/2026" and "mm/dd/yyyy" (Runs, Person, Draft), against "Wed 18 Nov" everywhere else.
    - Runs mixes "Thu, 2 Jan 2020" and "Wed 18 Nov".
    - Career skills are lower case ("agents", "evaluation") next to "Bedrock" and "AI governance".
    - The Career one-liner repeats the h1's clause.
11. **Motion (outside my lens, but it caps the rubric):** E1 and E2 still miss by 1–8 ms. Rail collapse p95 is 40.9 ms with the dossier open.

## Rubric

| | Score |
|---|---|
| unique_typography | 8 |
| color_cohesion | 8 |
| theme_cohesion | 8 |
| motion_cohesion | 8 |
| motion_smoothness | 7 |
| generic_typography | 2 |
| background_generic | 2 |
| color_combo_generic | 2 |
| motion_generic | 2 |
| ai_slop | 2 |
| **overall** | **40 / 50** |

**Verdict: passes the overall bar; one dimension is short.** motion_smoothness is 7 because E1 (Today 51 ms) and E2 (close 50 ms; collapse p95 40.9 ms against 33) still fail. Everything else is at the bar. Typography is now clearly owned: Newsreader display with opsz, Geist UI, and mono only for eyebrows, column heads and counts. Headlines are findings with numbers on all 14 tabs. What keeps overall from 42+ is data-level: overmatched employers, a dek made from signals, the duplicated post-worthy rows and the Map date span.

## Tab scores (out of 100)

| Tab | Score | Why |
|---|---|---|
| rail | 90 | Groups, the sliding highlight, an even collapsed rhythm (36/44) and the by-line mark. Collapsing works with the dossier open, and the dossier tracks the rail's edge. Focus rings are clear on every item. |
| today | 89 | The best headline/one-liner in the app, honest age eyebrow, gradient rings with no tick, numbered why-ranked bullets, a weather chart with a key, and a real "suggested next post". It falls short of 90 on the doubled Source mix line, mid-word mini-map labels, a mini-map vocabulary that differs from the Map tab, and indistinguishable 62/61/59 chips. |
| dossier | 87 | The geometry, rail coupling, first-party callout, reconciling breakdown, full claims and 2-line source summaries are all right. It still prints "You can try it / You can try it", lists Google (other teams) as named from a Google Cloud quote, says "no independent" four times, and gives release-note stories a template dek plus 4× "No summary extracted". |
| feed | 89 | A strong title-to-meta step, two topics, glyph legend, threshold divider and a real chip ramp. Findings that echo the title ("anthropic-sdk-python v2.10.0.") and the S-1 story's FedRAMP finding add nothing. |
| map | 85 | A real map with labelled regions, a legend and the biggest bridge. The lede's "Nov 2024 to Nov 2026" span misleads; the bridge sentence is printed twice; the side card's last line is clipped at 900 px; and node labels ellipsise mid-word. |
| search | 87 | Big bar, chips with counts, muted zero chips, grouped results and notes. The "story 16" chips read as story IDs when they are scores, and the "×17" note badge is unexplained. |
| studio | 86 | Grouped copies with hooks, a sticky side with no-draft stories and channels, and an honest approval checklist. "72 Story" is cryptic, "1d ago" repeats on every row, and one group has no date at all. |
| calendar | 86 | Month grid with no day/date gap, open slots, tray with ×N and cadence. The "N stories" dots are unexplained by the legend, past posting days carry no "missed" mark, and one tray row lacks its hook. |
| campaigns | 85 | Now a planning page: a Start campaign action per row, drafts counted per story, a topic share and next slots. The SDK row's finding echoes its title, "Mon 23 Nov" repeats 3×, and about 540 px of the right column is empty. |
| performance | 85 | An honest pipeline, a sentence where the one-value chart was, and grouping by story. "Weekly roundup · 2026-W47" is listed as a story when it is a Gemini draft, and "Mon 23 Nov" appears 4 times. |
| career | 85 | A visible Weight column, sorted by it, the duplicate warning and the formula footnote are honest. Casing is still mixed, the one-liner repeats the h1, and a "Jobs only" tag sits on AI governance in a card that lists it as a story topic. |
| employers | 83 | The story titles under each bar are the right fix. The tie headline rests on "Google (other teams)" overmatching Google Cloud's posts, the Team watchlists column is empty in 7 of 10 rows, and "Activity →" repeats 10 times. |
| people | 87 | Overdue, duplicate and do-not-contact are dense and honest, and the outreach count admits the duplicate. Dates switch between mono ("Wed 25 Nov") and sans ("Overdue · 18 Nov"). |
| sources | 88 | Pre-pause health, inline last error, a before/after bar, demo tags, articles/stories columns and an untrusted-content note. The error text is only ever "fetch failed". |
| runs | 87 | Stage timeline, honest "Done · 0 sources read", grouped history. The native "11/20/2026" input, "Thu, 2 Jan 2020", and "11 failed" (11 *sources*) are rough. |
| settings | 86 | A data headline, a source-health card and honest provider status. The priority term inputs clip mid-word ("multi-agen", "risk, s"), and the three bottom cards end at ragged heights. |

## Fixes (owner · severity)

1. **shared · blocker: employer overmatch** (`src/seed.js:10` terms plus the employer matcher used by `/api/employers` and the dossier).
   - Make the longest match win among siblings that share a parent. A `Google` hit inside a "Google Cloud" or "Google DeepMind" match span does not count for Google (other teams).
   - Recompute `story_count`.
   - Acceptance:
     - Google (other teams) has 0 stories unless "Google" appears on its own.
     - The Employers h1 changes from a 4-way tie.
     - Story 16's dossier no longer lists Google (other teams) as "Named in a source".
2. **feed-dossier · blocker (dossier): post-worthy rows repeat the label** (`story-dossier.js` `pwRows`).
   - When `r.quote` is null, render `<b>label</b>` + "matched" + `tokens(r.terms)`, e.g. "You can try it · matched available".
   - Never render `r.text` when it equals `label + '.'`.
3. **shared · major: "Worth a post" on below-bar stories, and jargon** (`src/facts.js:79`).
   - Use "Post-worthy signals: …" whatever the score.
   - "(interest maxed, 35 of 35)" becomes "(full marks for interest, 35 of 35)".
4. **shared · major: template deks and title echoes** (`src/finding.js:302`).
   - For release-note clusters, build the finding from the article titles: "4 releases, v2.2.0 → v2.7.0, 23 Oct – 9 Nov".
   - Use the `signals` fallback only if it contains a number.
   - If the finding's normalised token overlap with the title is ≥ 0.8, return null, and Feed, Campaigns and Search hide the line.
5. **feed-dossier · major: "no independent" stated four times above the fold.**
   - Drop the header subline "with no independent report yet" whenever the first-party/no-independent callout renders. The fact then appears twice: the count and the callout.
6. **feed-dossier · major: repeated "No summary extracted for this post."**
   - Collapse consecutive no-summary posts from one outlet into one row: "4 release notes from github.com (23 Oct – 9 Nov): v2.2.0, v2.5.0, v2.6.0, v2.7.0 · no summaries extracted". Each version links to its post.
7. **feed-dossier · minor: phone eyebrow and breakdown wording.**
   - At < 600 px the eyebrow wraps into 3 lines that start with "·". Render "Agent orchestration · 18 Nov · updated 2d ago", and never start a line with a separator (put the separators in `::before` on items after the first, inside a flex-wrap with `column-gap`).
   - "track length = weight" becomes "bar width = share of 100".
8. **today · major: lead tile Source mix and Named chips.**
   - Replace the two runs with one sans 13 px tabular line, omitting zero categories: "6 posts · 1 outlet · all first-party".
   - "Named" chips use Geist 12 px, not mono. They are names, not code.
9. **today · major: mini-map labels and vocabulary.**
   - Use `short_title` (the text before ":" or " — ") or a word-boundary truncation at ≤ 28 characters: "Gemini at Work 2026", "Digital Standards Office".
   - "leads 6, in 10" becomes the Map tab's wording, "main topic of 6 · tagged on 10", and the legend line is updated to match.
10. **shared · minor: the clears-band chip ramp is too flat** (`components.css:171`).
    - Change it to `calc(16% + var(--qd) * 2.4%)`, capped at 50%.
    - Acceptance: ΔE ≥ 5 between 59 and 64 in both themes, and text contrast ≥ 4.5:1.
11. **today · minor: weather-chart dot overlap.** In the Agent orchestration and Machine learning rows, dots within 9 px merge into blobs. Apply a 1-D beeswarm with vertical offsets of ±4 px.
12. **today · minor: the "Run today's workflow" button floats** at mid-height beside the h1. Move it into the "Collection is off" banner's action group, since running now reads 0 sources, or top-align it with the eyebrow.
13. **map · major: clipped side card and duplicated sentence.**
    - The side card's last line is cut at 1440×900 (text bottom 889 px, card 870 px).
    - Remove the bridge sentence from the card, since the lede already says it. Keep the chip, the title, "links 10 stories" and the button, and let `.map-side` scroll with its existing fade.
14. **map · major: misleading date span and run-on lede.**
    - "19 stories from Nov 2024 to Nov 2026" becomes "19 stories updated this week, 36 connections".
    - Reorder the bridge clause: "The biggest bridge, Northwind AI releases Relay, links 10 stories through shared topics (9), watchlist hits (9) and sources (3)."
    - Node labels use the same short-title rule as fix 9.
15. **search-system · major: "story 16" chips are scores** (`search.js:187`).
    - Replace the "story" prefix with the plain quality chip, keeping the tooltip "Story score 16".
    - Label the "×17" note badge "17 copies".
16. **search-system · minor: Runs and Settings wording.**
    - Runs:
      - "11 failed" becomes "11 sources failed".
      - "Thu, 2 Jan 2020" becomes "Thu 2 Jan 2020".
      - Show the native date input's value as "Fri 20 Nov", as a formatted button that opens the picker.
    - Settings: priority term inputs clip mid-word. Show at most the terms that fit, plus "+N more", or auto-grow to 2 lines.
17. **calendar-studio · major: Calendar cell dots are unexplained.**
    - Add a legend entry ("● story above 55 · ○ below") and a per-cell title ("5 stories first seen, 3 above your bar").
    - Past posting days with no post (Mon 16, Wed 18) get a muted "missed" label.
    - The tray row "LinkedIn · article ×5" needs its hook line.
18. **calendar-studio · minor: Studio labels.**
    - Hero "72 Story" becomes "Story score 72".
    - Show "edited 1d ago" once in the group head, not on every row. The Hot take group currently has no date at all.
    - The draft view's date input shows a formatted date, not "mm/dd/yyyy".
19. **career-publish · major (performance): a draft listed as a story.**
    - Closest to publishing shows "Weekly roundup · 2026-W47", which is draft 13 with `story_id` 16.
    - Group by `story_id` and title the row with the story ("Gemini at Work 2026: Introducing Gemini agent"). The draft chip reads "LinkedIn · roundup — Weekly roundup · 2026-W47".
    - "Next open slot Mon 23 Nov" shows once per page, not per row.
20. **career-publish · major (employers): empty column and repeated links.**
    - Fold Team watchlists into the employer cell as a subline ("Watching: Bedrock Agents · following") and drop the column, which is empty in 7 of 10 rows.
    - Widen the stories column and use short titles ("Gemini at Work 2026").
    - Show "Activity →" on row hover or focus only.
21. **career-publish · minor (career): casing and repetition.**
    - Display skills in sentence case with acronyms preserved ("Agents", "Evaluation", "MCP", "SQL").
    - The h1 becomes "Agents tops your skill radar: 10 mentions this week."
    - The one-liner drops its repeated first clause: "Also named in your 1 saved job post (7 copies counted once). AI governance…".
    - Remove the "Jobs only" tag in the Story topics card.
22. **career-publish · minor (campaigns): repeated slots and dead space.**
    - "Next open posting slots" becomes one line: "Mon 23 Nov · LinkedIn, Instagram, Video".
    - Make the right column sticky so it doesn't leave about 540 px of empty space.
23. **career-publish · minor (people): date styles.** Use one style for dates. Next-step dates are mono ("Wed 25 Nov") while the overdue tag is sans ("Overdue · 18 Nov"). Use sans tabular for both.
24. **shared · major (motion): E2 rail collapse p95 40.9 ms at 4× with the dossier open.**
    - During the `--rail-w` transition, lock the dossier's inner content width to its final value (`width: calc(final)`, `contain: strict` on the panel), so only the panel box moves and the text doesn't reflow every frame. Unlock at `transitionend`.
    - Re-check close's longest frame (50 ms) and E1 today (51 ms) after this.

## Owner summary

- shared: 1 (blocker), 3, 4, 10, 24
- feed-dossier: 2 (blocker), 5, 6, 7
- today: 8, 9, 11, 12
- map: 13, 14
- search-system: 15, 16
- calendar-studio: 17, 18
- career-publish: 19, 20, 21, 22, 23
