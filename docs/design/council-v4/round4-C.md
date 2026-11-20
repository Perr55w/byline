# Council C, round 4: motion feel and whole-product verdict (v4 HEAD ad8490c)

Lens: overall lead and motion feel (heading settle, tab switches, dossier flight, count-ups, fades versus pops), plus the A-tier verdict. I scored from scratch on the live build.

## How I looked

- **Live app on :4451** with Playwright at deviceScaleFactor 1. I loaded all 14 routes plus `#/draft/1`, `#/person/4` and `#/story/16`, in Proof and Night, at 1440 and 390.
  - No console errors, no page errors, and no sideways scroll on any route.
  - I took scroll-through full-page captures, because lazily entering tiles show up blank in a plain `fullPage` shot.
- **Dossier**
  - Opened from a Feed row and from the Today lead, in both themes and on phone.
  - Scrolled to the bottom, collapsed and re-expanded the rail with the dossier open, and closed it with Esc.
- **Rail**
  - The collapsed rhythm is measured: items sit at a 36 px pitch within a group and 44 px across groups.
  - Hover states checked on Today tiles (both themes) and Feed rows.
- **Motion evidence**
  - An in-page rAF sampler (`motion.cjs`, `flight2.cjs`, `flight3.cjs`) records per-frame gaps, the opacity of every h1, scrollY, and the title, dek and ring rects. It also records the panel's clip-path during the flight and `rail.right` against `dossier.left`.
  - Direct CDP frame captures at 150, 300 and 420 ms into the open (`frames/open-caps.png`).
  - Video contact sheets for load, tab switch, open and close (`frames/*-sheet.png`).
  - **Video caveat:** the screencast video drops the panel for ~200 ms mid-flight. The CDP captures and the clip-path sampler show it is there and expanding smoothly, so that gap is an artefact of the recording, not of the app.
- **Gates on :4461**
  - `--only E2,E12,C-tabswap,C-flight,C-entrance,C-theme`: C-entrance, C-flight and C-tabswap pass. E2 is 11/17, E12 3/6, and C-theme 11/12 (Night p95 33.3 ms against a 33 ms limit).
  - `--only E1 --route feed,studio,settings,calendar,people,search`: 20/22. Feed fails at 57 ms (render-bound, 7 ms blocking). Search fails at 63 ms, mostly an 18 ms idle callback in search.js.
- **Captures:** `/tmp/claude-0/council-C-r4/` (`*-d-light-full.png`, `*-{d,p}-{light,dark}.png`, `dos-*.png`, `ph-*.png`, `frames/`).

## What changed since round 3 (verified live)

Fixed, and it shows:
- **The post-landing frost stall is gone.**
  - The 12–13 frames of 50–67 ms between 1.0 and 1.8 s are down to 0–1 frames over 34 ms.
  - The frost goes live at about 1.7 s, with zero running animations in the panel at that moment (E2 check).
- **The flight collision is gone.**
  - The dek stays at 0 until the title is home: dek .01 at 536 ms with the title at y 89 (home is 72), then .57 at 636 ms.
  - From Today, the dek starts at 547 ms.
  - The C-flight R3 checks pass: 0 frames of title over the dek, title over the action row, or ring cut by the clip.
- **The tab hand-off is tighter.**
  - Today→Feed: the old h1 is at .03 by 203 ms, the new h1 at .04 by 320 ms, .27 at 370 ms and .91 at 503 ms.
  - The empty band shrank from about 200 ms to about 120 ms, with no double exposure and no scroll jump.
  - The first visible change comes 3–5 ms after the hashchange.
- **The dossier wording is cleaned up.**
  - "You can try it / You can try it." is now a single label.
  - "First-party" is an amber outline tag and "Named in a source" a neutral one, so green now means health and Sent only.
- **Today**
  - This week's day pills are compact.
  - The mini-map labels sit next to their nodes.
  - Today lands calmly: the h1 reaches .54 at 425 ms and 1.0 by 825 ms with the opsz/blur focus pull, then the tiles follow and the ring counts.
- **Weak tabs**
  - **Employers:** story titles and one "No stories yet" line.
  - **Campaigns:** a non-redundant, sticky side column.
  - **Studio, Campaigns, Search:** sticky side columns.
  - **Studio:** status pills line up.
  - **Settings:** term inputs wrap.
  - **Sources and Settings:** the health bars are desaturated.
  - **Calendar:** the phone tray rows are on one line.

Still rough:
1. **E2 desktop click-open, longest frame 85 ms (worst of 3).**
   - It is attributed to `DOMWindow.onhashchange` in app.js: 45 ms, of which 19 ms is forced layout.
   - It is worse than round 3's 58 ms, and it is the first frame of the signature moment.
   - The cause is that the hashchange task calls `dossier.open()`. When there is no prebuild, open reads `dst.getBoundingClientRect()` on a freshly inserted body that is 2,300 px tall.
2. **From Feed, the score disappears for half a second.**
   - The 78 chip hides on frame 1, and the ring doesn't start fading in until about 556 ms (.39 at 606 ms).
   - The DECISIONS chip→ring cross-fade in flight isn't happening, so the most important number blinks out.
3. **Scattered single hitches on tab switches at 1×.** My sampler, one or two frames per switch:

   | Switch | Frames |
   |---|---|
   | Studio | 83 ms |
   | Settings | 83 ms |
   | Calendar | 67 ms |
   | Search | 67 ms |
   | People | 4 × 50 ms |

   E1 still fails on Feed and Search at phone 4×. E12 fails on Feed (style recalc 31.9 per collapse; 4× p95 50.1 ms).
4. **Rail collapse with the dossier open:** p95 35.3 ms at 4× (limit 33), max 64.9 ms.
5. **Close p95 at 1× is 33.4 ms** (limit 20).

## Rubric (0–10; overall /50)

| | Score | Why |
|---|---|---|
| unique_typography | 8.5 | Newsreader display with the opsz settle, Geist UI and Geist Mono data. A strong title/meta step on every tab and in the dossier. |
| color_cohesion | 8.3 | The quality ramp reads everywhere; blue only above the bar. Greens and reds are now reserved for health and state, and the health bars are toned down. Loudest left: amber is used for Demo, warn strips, first-party callouts and overdue at once. |
| theme_cohesion | 8.5 | Proof and Night are one product on all 17 surfaces, with one theme-switch speed and a shared head, tile and table language. |
| motion_cohesion | 8.4 | Settle, tab hand-off, flight (title first, then the head band), count-up, hover and rail coupling speak one language. Break: the Feed score chip vanishes instead of handing off to the ring. |
| motion_smoothness | 7.8 | Smooth to the eye at 1×: the frost stall and collision are gone, and open, close and tab changes are clean in the sampler. Held under 8 by gates that still fail: E2 click-open at 85 ms in the router task, collapse with the dossier open at 35.3 ms p95 at 4×, E1 on Feed and Search, E12 on Feed, and single 67–83 ms frames on about a third of the tab switches. |
| generic_typography | 2 | Not generic. Residual mono-caps card eyebrows on some tabs only: "ABOVE YOUR BAR, NO DRAFT YET", "BY CHANNEL", "UNSCHEDULED DRAFTS", "CADENCE", "BIGGEST BRIDGE", "LATEST RUN", "OVERDUE · 2". Campaigns, Performance and Career already use sentence case, so the system is split. |
| background_generic | 2 | The ruled field is quiet on reading views and neutral at rest. The Night hover pool still lays a ~60 px blue dash band around the hovered tile. |
| color_combo_generic | 2 | The field at rest is neutral ink, blue arrives only with heat and above-bar scores, and green and red are confined to state. Still the cool-white-plus-blue family, but no longer stock. |
| motion_generic | 1.5 | No banned curves, shimmer, sheen, tilt, per-character or pulsing effects. The clip-path flight and opsz settle are this product's own. |
| ai_slop | 2 | Headlines are findings and the numbers are real. Residual: "You can try it · matched available" reads like a template bug, and Employers' "4 employers tie for the lead" counts the same two Google stories three times. |
| **overall** | **42** | The most finished Byline yet and clear of 38. Not A-tier (45+) while the first frame of opening a story costs 85 ms and the Feed score blinks out mid-flight. Two hard perf gates (E1, E2) and E12 also still fail. |

Against the bar: only motion_smoothness (7.8) misses.

## Tab scores (out of 100)

| Tab | Score | Why |
|---|---|---|
| rail | 90 | Groups, sliding highlight, by—line mark. The collapsed rhythm measures exactly 36/44. It stays live over the dossier and moves it in sync (0 violations, gap 12 px on every frame). |
| today | 91 | Every SPEC §0 ask is met, and the dead interior is gone: compact This week strip, labels next to nodes. Holding it at 91: the lead tile says the same counts twice ("Evidence is thin: 6 posts from 1 outlet" and then "Source mix 6 posts · 1 outlet · all first-party"), and the Night hover pool is a blue band. |
| dossier | 90 | The best content in the product, now with a sequenced flight and no landing stall. It adapts to the rail and doesn't fill the screen. Below 92: from Feed the score blinks out for ~500 ms; the click frame is 85 ms in the router task; the mono middot eyebrow "AGENT ORCHESTRATION · FIRST SEEN … · UPDATED 2D AGO" repeats the main pill; "matched available". |
| feed | 90 | Big headline/meta step, banded chips, top-two topics, glyph legend, threshold divider, quiet field, clean filter. E1 phone 4× at 57 ms (render). |
| map | 87 | Real, clickable, labelled; the side panel no longer clips. But the graph sits low: about 65 px of empty band at the top, while the bottom node and the Agent orchestration hull run under the legend bar. On phone the "Business adoption" label is cut at the canvas edge. "Business adoption · leads 4" has no hull although it has 4 nodes. |
| search | 88 | Big bar, keyboard hints, labelled chip rows with an honest "No matches yet", grouped results, sticky Refine. E1 at 63 ms from its idle callback. |
| studio | 87 | Review card with checklist, grouped ×N rows that now line up, sticky side column. The side cards still use mono-caps eyebrows, unlike Campaigns next door. |
| calendar | 88 | Month grid with story counts and quality dots, open slots, honest "missed", tray with ×N, cadence, filled legend. Phone tray fixed. |
| campaigns | 87 | Grouped by topic with one Start campaign each. The side column is now non-redundant (channel bars, the 95% finding, the next slot) and sticky. |
| performance | 86 | Compact funnel, honest edit-date sentence, "18 of 22 open drafts are for one story", grouped closest-to-publishing. The channel bar's segments are only explained by the list below. |
| career | 86 | Duplicate-job honesty, "also a job-post skill" replaces the contradiction. "Evaluation" (9) and "Evals" (3) are still separate radar rows, while "Agents" already folds in "agentic". |
| employers | 86 | Story titles behind every count, one "No stories yet" line, quiet Activity links. Each row has ~400 px of dead band between the titles and Activity, and AWS's link to the SDK releases isn't explained. Three Google rows repeat "Same 2 stories". |
| people | 87 | Overdue follow-ups, a duplicate warning with both records, pipeline by stage, do-not-contact flags. |
| sources | 88 | The information asked for, with a toned health bar and the "Paused · was failing" filter. 17 identical Sync buttons on rows that are all paused. |
| runs | 88 | Clear stage timeline, honest $0.00, grouped repeats. |
| settings | 87 | Health summary, weighted priorities with wrapped terms, collapsed long groups, aligned summary cards. |

## Fixes (priority order; one owner each)

1. **[blocker] shared: the click-open frame (E2 85 ms; `onhashchange` 45 ms, forced 19 ms).**
   - In `dossier.js` open, never read `dst.getBoundingClientRect()` on the freshly inserted body.
   - If the prebuild (`pre.rects`) isn't ready, take the no-fly path: panel opacity .0→1 plus scale .98→1 over 280 ms `--ease-move`, the body filled after one rAF.
   - Make sure `pointerover` prefetch also builds the attached hidden prebuild host, so the fly path almost always has cached rects.
   - Target: E2 desktop click open, longest frame < 50 ms worst of 3; forced layouts per open 0.
2. **[major] shared: Feed score chip → ring hand-off.**
   - The chip is hidden on frame 1 and the ring only fades in from about 556 ms.
   - Fly a clone of the row's score chip to the ring's rect on the same 600 ms `--ease-move`. The chip clone goes 1→0 over 40–75% of the flight; the ring goes 0→1 over 60–100% (DECISIONS C §3).
   - Accept: on every sampled frame of the flight, chip + ring opacity ≥ .8.
3. **[major] shared: rail collapse with the dossier open, p95 35.3 ms at 4× (limit 33, max 64.9).**
   - While `.dossier` is open, freeze the page under the scrim. Step `.main`'s padding to the end value once at collapse start, and animate `#view > .page` with `transform: translateX(Δ→0)` only.
   - Give `.page` `contain: strict` for the 420 ms.
   - Keep the rail's `--rail-w` width and the dossier coupling.
   - Target: p95 ≤ 33 ms at 4×; the `dossier.left ≥ rail.right` check stays at 0 violations.
4. **[major] shared: hitches after tab switches at 1× (single 67–83 ms frames on Studio, Settings, Calendar and Search, 4 × 50 ms on People, at 140–760 ms).**
   - `decorate()` re-runs `countUp(scope)` plus a full `scope.querySelectorAll('td')` regex pass on every MutationObserver batch for the whole page.
   - Change it to process only the added nodes from the mutation records, and to run on `requestIdleCallback` with ≤ 6 ms slices.
   - Add a harness check (C-tabswap): no frame > 50 ms at 1× for 900 ms after a switch, on all 14 routes.
5. **[major] feed-dossier: E1 Feed 57 ms (blocking 7 ms, so render) and E12 Feed style recalc 31.9/collapse.**
   - Rows after the first 8 get `content-visibility: auto` with `contain-intrinsic-size: auto 104px` (desktop) or `auto 180px` (≤ 480 px).
   - Render the below-bar group in the idle chunk, not in the swap frame.
   - Make the row hover backing a single shared absolutely positioned element moved with transform, not a `::before` per row.
   - Target: E1 feed < 50 ms; E12 recalcs ≤ 30.
6. **[major] search-system: E1 Search 63 ms (`IdleRequestCallback` search.js 18 ms).** Split the idle render into one result group per callback, and loop with `deadline.timeRemaining() > 4`. No callback over 8 ms.
7. **[major] map: fit the graph to the visible canvas.**
   - Compute the bounds from nodes plus hull padding (24 px) plus label extents.
   - Fit them into the canvas rect minus the legend bar (40 px) and 24 px margins, centred vertically.
   - Today there's about 65 px empty at the top while the bottom node and the hull run under the legend. On phone the "Business adoption" label is cut at the bottom edge.
8. **[major] map: draw a hull for every top-3 topic with ≥ 3 nodes.** "Business adoption · leads 4" has 4 main-topic nodes but no region, so its label floats. If a topic still gets no hull, render its label as plain text-3 without the pill.
9. **[major] today: lead tile repeats itself.** "Evidence is thin: 6 posts from 1 outlet" sits right above "Source mix · 6 posts · 1 outlet · all first-party". When the evidence bullet already states posts and outlets, drop the Source mix block, or replace it with the outlet list only. That removes about 60 px of dead height so the lead and the right column end together.
10. **[major] shared: one eyebrow vocabulary.**
    - In `components.css`, card-level labels inside `.tile`/`.card` become sentence-case Geist 12/500 `--text-2` with no tracking, as Campaigns, Performance and Career already do.
    - That covers "Above your bar, no draft yet", "By channel" (Studio), "Unscheduled drafts", "Cadence" (Calendar), "Biggest bridge" (Map), "Latest run" (Runs) and "Overdue · 2" (People).
    - Keep mono caps for rail groups, column heads and the page eyebrow (DECISIONS).
11. **[minor] feed-dossier: dossier eyebrow.** "AGENT ORCHESTRATION · FIRST SEEN 18 NOV, 11:52 AM · UPDATED 2D AGO" repeats the main topic pill and is the mono-middot pattern from slop #9. Drop the topic, and set "First seen 18 Nov, 11:52 AM · updated 2 days ago" in Geist 12 `--text-3`.
12. **[minor] feed-dossier: "matched available".** In "Why it's post-worthy", render the matched term as a quoted chip with a verb: "You can try it · the post says "available"". The bare "matched available" reads as a template bug.
13. **[minor] shared: Night hover pool.** In Night, the tile-hover pool turns a ~60 px band of dash rows solid blue around the hovered tile. Apply the R10 Proof treatment to Night as well: pool tinted toward `--text-3`, blue only within 40 px of the edge, gain −40%.
14. **[minor] shared: hold the field during the flight and the theme switch.**
    - Open and close p95 are 33.3/33.4 ms (limit 20), and C-theme Night p95 is 33.3 ms (limit 33).
    - Call `bg.hold(dur)` at open (600 ms), close (440 ms) and theme switch (600 ms), so the canvas draws no frames under those transitions. The canvas is at 35% under a scrim anyway.
15. **[minor] career-publish: Employers dead band and match evidence.**
    - Prefix each story title with its quality-coloured score chip, and add the matched term in `--text-3` ("matched "Bedrock"").
    - That fills the ~400 px band and explains why AWS links to two SDK release notes.
    - When two or more employers have an identical story set, merge their rows: "Google Cloud, Google DeepMind · same 2 stories as Google (other teams)".
16. **[minor] career-publish: Career radar synonyms.** Fold "Evals" (3) into "Evaluation" (9) as "also evals (3)", the same way "Agents" shows "also agentic (4)", using the radar's alias list.
17. **[minor] search-system: Sources Sync buttons.** With collection off and every row paused, show the per-row Sync only on row hover or focus (opacity 0 → 1 over 160 ms). Keep it visible on touch and phone widths. Removes 17 identical buttons from the resting table.
18. **[minor] career-publish: Performance channel bar.** Label the segments in place, "LinkedIn 12 · Instagram 5 · Video 5", in text-3 under the bar, so it isn't explained only by the list below.

## Verdict

Round 3 fixed what made the signature moment look wrong:
- The title now lands before the dek.
- The frost no longer stalls the panel after landing.
- The tab hand-off is tight.
- Today and the weak tabs lost their dead interiors.

Every tab is at or above 85, Today and Dossier are at 90 or above, and the product clears the bar on every rubric line except motion smoothness (7.8).

It is not A-tier yet (42 of 50), for two reasons:
- **The first frame of opening a story costs 85 ms in the router task.**
- **From Feed, the score blinks out for half a second mid-flight.**

Fixes 1–4 make the open, the collapse and the tab switches frame-clean and should turn E2 green. Fixes 5–6 clear E1 and E12. Fixes 7–10 take Map, Today and the eyebrow system up a step.
