# Council E, round 3: motion engineering and performance (v4 HEAD 0504dc2)

Lens: jank is a defect. I re-measured the live build with Playwright and CDP, then looked at every tab as the user would. I scored from scratch; round 2 numbers appear only for comparison.

## How I looked

- **Gates.** Full harness run alone on the machine: `node test/e2e/run.mjs --port 4463 --no-shots` (483 s). Output: `/tmp/claude-0/council-E-r3/gates.txt`.
- **`npm test`:** 75/75 pass.
- **Live app on :4453.** Covered:
  - all 14 routes plus `#/draft/1` and `#/person/4`, in Proof and Night, at 1440 and 390
  - the rail collapsed on Today, Feed and Settings, and collapsed with the dossier open
  - the dossier opened from Feed and from Today, scrolled to the middle and the bottom, closed with Esc
  - hover on Today tiles and Feed rows, tab switches, the load entrance, a Feed filter click, the theme switch
  - no console errors, page errors or horizontal scroll on any route in either theme or width
- **Captures**, all at deviceScaleFactor 1, in `/tmp/claude-0/council-E-r3/`:
  - screenshots: `{proof,night}-{d,m}-<route>.png`, `proof-*-full.png`, `*-collapsed.png`, `*-dossier-*.png`, `today-hover.png`
  - CDP screencast frame sequences: `frames/<scenario>/` (`NNN_<ms>.jpg`), with contact sheets `frames/sheet-*.jpg` and zoomed crops `frames/zoom-533.png` and `zoom-567.png`
  - probe output: `probe-dossier.json`, `probe-e1.json`, `probe-tab_idle_hover_rail.json`
  - scripts: `probe.mjs`, `frost.mjs`, `tabseq.mjs`, `closeseq.mjs`, `trace.mjs`

## Gates: 24 of 25 pass (E2 fails on one check)

| Gate | Result | Notes |
|---|---|---|
| **E1** tab change, phone 4× | **PASS** 34/34 | Every route had 0 long frames in the gate pass, and forced layouts were ≤ 1 per transition. It is marginal, though: my 3-lap run (48 transitions, below) still had 6 frames between 51 and 73 ms. |
| **E2** dossier | **FAIL** 12/13 | Desktop open's longest frame is **60 ms** (limit 50), and only 13 ms of it is script (`onhashchange` app.js). Everything else passes: close 0 ms, rail-collapse p95 at 4× **25.9 ms** (round 2: 42.1), close p95 at 1× 16.7, open p95 at 1× 16.7, drift 0 px, min gap 12 px, phone all 0. |
| E3–E13, C-*, F-* | pass | CLS < 0.01 on every route; idle, ambient, glass, canvas, Map 500-node, rail rhythm, rail pacing, dead interior, entrance, theme, flight, tab swap, rings, filter, contrast, structure, focus and reduced motion all pass. |

## My own measurements

### Dossier, desktop 1440, frame intervals on raw rAF (`probe-dossier.json`)

| Scenario | Flight 0–700 ms p95 / max | After landing 700–2400 ms: frames > 34 ms | Max |
|---|---|---|---|
| Open from Feed, 1× | 16.8 / 33 | **7** (50, 50, 50, 50, 50, 50, 83) | 83 |
| Open from Today, 1× | 16.7 / 16.8 | **5** | 67 |
| Open from Feed, 1×, **`.dossier-frost` disabled** | 16.7 / 16.8 | **0** | 16.8 |
| Open from Today, 1×, frost disabled | 16.8 / 33 | **0** | 16.8 |
| Open from Feed, 4× | 33 / 67 | 6 | 83 |
| Open from Today, 4× | 33 / 50 | **13** | 50 |
| Close, 1× and 4×, both sources | p95 16.8, max 33 | – | – |
| Rail collapse with the dossier open, 1× | p95 16.7–16.8 | – | 33 (expand once 67) |
| Rail collapse with the dossier open, 4× | p95 33.3–33.5 | – | 50 |

**The post-landing stall is the biggest motion defect left, and it happens on every open at 1×.** `frost.mjs` logs every frame:
- `.frosted` lands at 933 ms.
- Between 1.1 and 1.65 s there are 50–83 ms frames. During that window the running-animation count falls from 14 to 1: the deferred-section fades (`fillProgressive`) and the bar `scaleX` animations.
- Once the last animation ends, frames are back at 16.7.
- There are no long tasks (blocking 0).
- So the backdrop blur is recomposited on every frame while content inside the frosted panel animates. With the frost off, the same window is perfectly clean.

This confirms C's round-3 finding with a controlled A/B.

**Flight frames** (`frames/sheet-dossier-open-feed-1.jpg`, `frames/zoom-533.png`):
- From about 530 to 580 ms, the flying title "Gemini at Work 2026:" is drawn across the half-faded dek ("Google Cloud says nearly 500…"). That is a double exposure in the signature moment.
- At 533 ms the score ring has already faded in at its final position, and the clip's top inset cuts it off ("78" shows only its lower half).
- The flight composites cleanly otherwise: the fill is opaque, there is no ghosting, and the panel body is never empty after landing (the round 2 blank-sheet beat is fixed).

**Close** (`frames/sheet-dossier-close-0.jpg`, `closeseq.mjs`):
- The panel's opacity reaches 0 at about 380 ms.
- Only then does `html.dz-back` start the 240 ms fade-in of the crumb and top-right chrome, and the field comes back too.
- The result is a second beat: the panel goes, then the chrome arrives about 250 ms later.

### Phone 4× tab-ins, 3 laps over all 16 routes (48 transitions, `probe-e1.json`)

- Six transitions had a frame over 50 ms: campaigns 73, person/4 72, today 57, draft/1 51, map 52 and campaigns 52.
- None of them has script attribution. They are render-bound swap frames.
- A trace of the swap still shows **non-partial layout** (`Layout dirty 9/674 FULL` on Today, `dirty 384/1609 FULL` on person/4). Person/4's frame is style 25 ms + layout 11 + two 9 ms full paints.
- The gate passed this run on 0 ms everywhere, but in my laps 1 transition in 8 still exceeds 50 ms. That is not a stable pass.

### Tab switch, desktop

- **Per frame** (`tabseq.mjs`): old h1 1 → .39 (131 ms) → .05 (181 ms); new h1 .03 → .95 by 314 ms. That is a clean hand-off with no double exposure and no scroll jump.
- **Latency:** the first visible change comes **80–135 ms after the hash changes**, because the old page holds full opacity while the new view renders offscreen.
- **Frame pacing:**
  - At 1×: p95 16.8 on Today and Feed; 33.3 on map, search, studio, calendar, career and settings (1–2 dropped frames each); maximum 50.
  - At 4×: maximum 83 on Today, and calendar p95 66.6.

### Idle, hover, rail and filter

- **Idle** (`?bgidle=1500`, 3 s window, all 16 routes):
  - 0 rAF calls, 0 layouts, 0 recalcs and 0 running animations everywhere.
  - Task time 0.2–4.7 ms per 3 s. Search is fixed: 63 → 3 ms.
  - One permanent `will-change`, and one `backdrop-filter` (the pill).
- **Hover, Today:** 120 moves gave 0 layouts, 79 recalcs and frames p95 16.8. **Hover, Feed:** **17 layouts** and 152 recalcs per 120 moves. Something on row hover reads geometry.
- **Rail collapse without the dossier:** p95 16.8 at 1× on today, feed, map and calendar; ≤ 50 at 4×. Style recalc is 17–32 ms at 1×.
- **Feed filter** (`sheet-feed-filter-0.jpg`): persisting rows stay put at full opacity, which fixes round 2's blank list. The h1 still re-runs a full entrance on every filter click: blank for about 100 ms, then a 300 ms settle.
- **Load entrance** (`sheet-load-today-0.jpg`): the order is right (head, lede, strip, tiles, count-up), and the count-up visibly decelerates into 78. But the rings show a literal **"0"** for about 130–250 ms while their tile fades in, before counting starts. That is a false number on screen.

### Visual

- **Hover pool** (`today-hover.png`): the pool lights the dash rows around the hovered tile in accent blue, which reads as graph paper.
- **Collection-off strip on Today:** it is translucent (`--warn-soft` at .13 alpha mixed 55% with the surface, so the effective alpha is about .5). The field's dash rows run visibly through the strip's text in a static screenshot.

## Rubric (0–10; overall /50)

| | Score | Why |
|---|---|---|
| unique_typography | 8.5 | Newsreader display with the opsz settle, Geist UI, Geist Mono data. Strong title/meta step everywhere, including the dossier and phone. |
| color_cohesion | 8 | The quality ramp is everywhere (rings, chips by band, map nodes, calendar dots), and blue appears only above the bar. Off-key spots: amber alert bands on five tabs, saturated green/red health bars, green "First-party" / "Named in a source" tags in the dossier. |
| theme_cohesion | 8.5 | Proof and Night are one product on all 17 surfaces. The theme switch moves at one speed and contrast holds. |
| motion_cohesion | 8 | Settle, tab hand-off, count-up, rail coupling, Feed filter rows and close now speak one language. Breaks: the title/dek double exposure mid-flight, the ring popping in clipped, chrome returning a beat after close, the "0" ring frame. |
| motion_smoothness | 7.5 | Smooth to the eye at 1× everywhere **except right after every dossier open**: 5–7 frames of 50–83 ms at 1.0–1.8 s, caused by the frost (A/B proven). E2 still fails (60 ms open). E1 passes but is flaky (6/48 over 50 ms). The 4× desktop tab switch peaks at 83 ms. |
| generic_typography | 2 | Not generic. Some mono-caps card eyebrows remain ("ABOVE YOUR BAR, NO DRAFT YET", "BY CHANNEL", "BIGGEST BRIDGE", "LATEST RUN"). |
| background_generic | 2 | The ruled field is ours and correctly paced, and quiet on reading views. Two things pull it toward lined paper: the blue hover pool, and the dashes showing through Today's translucent warn strip. |
| color_combo_generic | 2.5 | Cool white with electric blue is still the stock pro-tool pair. The ramp adds depth; the only second voice is amber/ochre for alerts. |
| motion_generic | 2 | No expo curve, shimmer, sheen, tilt or per-character effects. The motion is specific (settle, FLIP flight, rail-coupled panel). |
| ai_slop | 2 | Honest data and empty states everywhere, real per-source claims, unequal weights shown. A few template remnants: three KPI tiles on Career, "Next open slots" repeated three times on Campaigns and Performance, "You can try it / You can try it." in the dossier. |
| **overall** | **39** | Up from 38. The round 2 motion blockers are mostly gone: the tab switch is clean, the filter is fixed, the collapse with the dossier open is 25.9 ms p95 at 4×, idle is silent everywhere, and close is clean. **Not at the bar:** motion_smoothness is 7.5 (the frost stall plus E2), and color_combo_generic is 2.5. |

## Tab scores (/100, the user's way)

| Tab | Score | Why |
|---|---|---|
| rail | 90 | Groups that explain themselves, sliding highlight, even collapsed rhythm (E11 14/14), a real by—line mark, and a 60 fps collapse with or without the dossier. |
| today | 89 | Issue no. + date, a finding headline, a numeric one-liner, gradient rings with no tick, why-ranked bullets, labelled weather and a real mini-map with top 3. Below 90: the field shows through the translucent "Collection is off" strip, rings flash "0" on load, "This week" spends 140 px on seven empty day tubes, and overlapping weather dots smudge. |
| dossier | 88 | Best content in the app: what each source said, key claims, unequal-weight breakdown, a testable lens. It adapts to the rail with constant width. Below 90: every open stalls for about 0.6 s after landing (frost), the title flies through the dek, the ring pops in clipped, "Why it's post-worthy" prints "You can try it / You can try it.", and green tags mean something else elsewhere. |
| feed | 89 | Clear title/meta step, source glyph key, top two topics, ramp chips, threshold divider, and persisting rows on filter. The h1 re-enters on every filter click, and row hover forces 17 layouts per 120 moves. |
| map | 87 | A real graph with labelled regions, hollow below-bar nodes, top 3 and a bridge card. At 1440×900 the side panel's last line is cut mid-sentence. |
| search | 88 | Big autofocused bar, typed quick chips (topics, watchlist, employers, "no matches yet"), grouped useful results, refine counts. Idle is now silent. |
| studio | 86 | Grouped by story, with a sticky side column (above-bar stories, by channel) and a before-approval checklist. The lead dek shows the raw hook field ("My own locked hook."), the "72 Story" chip is unclear, and the status column jumps on rows with no edit time. |
| calendar | 86 | Month grid with no day/date gap, ramp story dots, tray, cadence by week. The dashed "open slot" chips on five empty days still read as fake entries. |
| campaigns | 85 | Data headline, anchors grouped by topic, honest draft counts, neutral channel bars. "Next open posting slots" lists Mon 23 Nov three times. |
| performance | 85 | Pipeline strip, a sentence instead of the empty chart, grouped "Closest to publishing". "Next open slots" repeats Mon 23 Nov three times, and its card has about 80 px of dead space above the CSV button. |
| career | 86 | Grammatical data h1, honest duplicate warning, neutral weight bars, collapsed long tail, the trend column honestly withheld. "agents" and "agentic" are separate rows, casing is mixed, and the job-title input looks pre-filled ("Associate Product"). |
| employers | 84 | Quieter rows with story titles under each bar. The three Google rows repeat the same two titles, the watchlist column is mostly empty white, and the pinned rows' dark left rule is unlabelled. |
| people | 86 | Overdue, duplicate and do-not-contact states are explicit, with outreach against goal and a pipeline. Red appears twice per overdue row. |
| sources | 87 | Now-versus-before health bar, honest paused state, rich sortable table, expandable rows. |
| runs | 87 | Clear stages with timings, an honest 0-source amber Collect, cost controls and feedback effect. |
| settings | 86 | About 2,390 px, source health summary, neutral sliders, collapsible tail. The terms inputs truncate mid-word ("multi-agent", "risk, s"), and the bottom three summary cards end at different heights. |

## Fixes (ranked by score movement; one owner each)

1. **[shared · blocker] Post-landing frost stall.**
   - **Where:** `dossier.js` ~294 adds `.frosted` 220 ms after landing, while `afterFlight` sections (`story-dossier.js` `fillProgressive`) and the bar `scaleX` animations are still running. The backdrop blur recomposites every frame: 5–7 frames of 50–83 ms at 1×, and 0 with the frost disabled.
   - **Fix:** add `.frosted` only when the panel is quiet. Both of these must hold for 2 consecutive frames, with a cap of 2000 ms:
     - `panel.getAnimations({ subtree: true }).every(a => a.playState !== 'running')`
     - there is no `[data-defer]` or `.dx-cv` left in the body (MutationObserver)
   - **Later in-panel expansions** ("Show all 6 in full", "+3 more") should animate with the panel temporarily on the opaque fill: add `.dossier.is-busy` → `.dossier-frost{display:none}` + `.dossier-fill{opacity:1}`, and remove it at `finished`. The frost is .82 white + blur against the .98 fill, so the swap isn't visible.
   - **Target:** desktop open from Feed and from Today at 1×: **0 frames over 34 ms in 0–2400 ms**.
2. **[shared · blocker] E2 desktop open is 60 ms at 4×, render-bound** (only 13 ms of script).
   - **Cause:** the prebuilt dossier is detached until `open()` (`dossier.js` ~86), so the click frame pays the full style, layout and paint of the panel.
   - **Fix:** keep the prebuilt root attached in a host:
     - The host is `position: fixed; left: <final left>; top: 12px; width: <final width>; visibility: hidden; pointer-events: none; contain: strict`, sized to `finalRect()`.
     - Strip `id` and `aria-*` from it until open.
     - `open()` then moves it into place without a relayout (only visibility, transform or clip change).
     - Invalidate it on rail toggle or resize (the `geomKey()` you already have).
   - **Target:** E2 desktop open longest LoAF under 50 ms in 3 consecutive runs.
3. **[shared] The flight title is double-exposed with the dek, and the ring pops in clipped.**
   - **Problem:** at about 530–580 ms the flying title is drawn over the half-faded dek and action row (`frames/zoom-533.png`), and the ring fades in at its final spot while the clip's top inset still cuts it.
   - **Fix, in `dossier.js` (open stagger, ~271):**
     - Head units that the title's path crosses (dek, actions, facts column) start at `max(160, DUR.morphOpen * .7)`, not 160.
     - The chip→ring cross-fade starts at offset .75 of the flight, when the clip top is above the ring.
   - **Target:** in a 60 fps sampler, there are 0 frames where the title's rect intersects the dek or actions rect with both effective opacities over .15, and no ring glyph is clipped.
4. **[shared] Chrome returns a beat after close.**
   - **Problem:** `html.dz-back` (the crumb and top-right fade-in) starts only once the close has finished (about 380 ms), so the chrome arrives about 250 ms after the panel has gone.
   - **Fix:** in `close()`, swap `dossier-open` for `dz-back` at close start, and run the 240 ms chrome fade and the `#bg` fade-back alongside the scrim fade.
   - **Target:** the crumb and `.topbar-right` reach opacity 1 within 60 ms of the panel reaching opacity 0.
5. **[shared] Rings show a literal "0" before the count-up.**
   - **Problem:** at about 1173–1306 ms of load, rings read "0" while their tile fades in, before `countTo` starts.
   - **Fix:** in `ui.js` `scoreRing()`, a pending-count ring renders an empty number box (fixed tabular width, so no shift), with the final value in `aria-label`. `countTo` writes the first value on its first frame.
   - **Target:** no captured frame shows a ring number that is not on the running count path.
6. **[shared] The swap frame's layout is still non-partial, so E1 is flaky.**
   - **Evidence:** traces show `Layout … FULL` (Today dirty 9/674, person/4 dirty 384/1609). In my 3-lap run, 6/48 phone 4× transitions were over 50 ms (campaigns 73, person/4 72, today 57) with no script attribution.
   - **Fix:**
     - Give `#view > .page` the rule `contain: layout style`, so each page is a layout root.
     - Take the leaving page out of flow (`position: absolute; inset: 0 0 auto 0`) in the same task as the insert, so the insert doesn't relayout the grid.
   - **Target:** swap-frame Layout `partialLayout: true` and under 15 ms at phone 4×; 0 of 48 transitions over 50 ms in a 3-lap run.
7. **[today] The warn strip is translucent.**
   - **Problem:** `.td-strip[data-tone=warn]` mixes `--warn-soft` (alpha .13) with the surface, so the effective alpha is about .5, and the field's dash rows run through the "Collection is off" text.
   - **Fix:** use an opaque mix, `background: color-mix(in oklab, var(--warn) 8%, var(--surface-solid))`, and confirm `--surface-solid` is alpha 1 in both themes.
   - **Target:** dash contrast under the strip's text below 1.05:1 in Proof and Night.
8. **[shared] The hover pool reads as graph paper.** In `bg.js`, the tile-hover pool brightens the dash rows around the hovered tile in accent blue across about 300 px. Cut the pool's dash gain by 40% and tint it toward `--text-3`, keeping blue only within 40 px of the tile edge (the light reaction stays). Target: under the pool, the dash colour's ΔE from the resting field is no more than half of today's value.
9. **[feed-dossier] Duplicate post-worthy copy.** "Why it's post-worthy" prints "You can try it" as a label and then "You can try it." as the body when no quote exists (`src/dossier.js` `LBL` text falls back to the label). In `story-dossier.js`, render the label line only when `quote` and `terms` are empty, or append the matched terms ("You can try it: …"). Target: no group repeats its label as its body.
10. **[feed-dossier] Feed row hover forces layouts.** 120 pointer moves over the rows cost **17 layouts** (Today: 0). Find the geometry read: likely the row-actions reveal triggering the `clampCheck` ResizeObserver, or a prefetch path that measures. Hover must only toggle classes. Target: ≤ 2 layouts per 120 moves on `#/feed`, with frames p95 16.8.
11. **[feed-dossier] A filter click re-runs the full h1 entrance.** The h1 is blank for about 100 ms, then settles over 300 ms, on every chip click. Keep the h1 in place and swap only the changed figures, with an opacity dip to no less than .5 over 160 ms. Use the full `enterHeading` only on route entry. Target: the h1's effective opacity never drops below .5 during a filter change.
12. **[feed-dossier] Green tags in Employer connections.** "First-party" and "Named in a source" are green, but green means healthy or sent elsewhere. Use a neutral tag for "Named in a source", and an accent-outlined tag for "First-party", matching the amber first-party callout's meaning. Target: no `--ok` colour inside the dossier.
13. **[today] "This week" with nothing planned.** Seven 140 px empty day tubes. When 0 posts are planned, collapse the strip to a 40 px row of day letters with the posting-day dots, and give the height to "Suggested next post". Target: no empty block over 60 px inside the tile at 1440.
14. **[today] Overlapping weather dots smudge** (the Machine learning and AI governance rows). When two dots on a row are within 6 px, offset them vertically by ±4 px (beeswarm). Target: no two dot centres closer than 7 px.
15. **[calendar-studio] Calendar "open slot" chips.** Dashed "open slot" chips on Fri 20, Mon 23, Wed 25, Fri 27 and Mon 30 read as fake entries in an empty month (round 2 fix 17 was not applied). Replace them with a 4 px `--text-3` dot under the day number, plus the legend "● posting day, nothing planned". Target: an empty month shows no chip-shaped elements.
16. **[calendar-studio] Studio lead and rows.**
    - The lead's dek shows the raw hook field ("My own locked hook."). Label it ("Hook · …") or show the draft's first line.
    - The "72 Story" chip should read "Story score 72".
    - Rows without an edit time ("Hot take") shift the status tag right. Reserve the time column (`min-width: 56px`).
17. **[career-publish] The same slot repeated three times.** Campaigns' "Next open posting slots" and Performance's "Next open slots" list Mon 23 Nov three times. Collapse them to one line, "Next open posting day: Mon 23 Nov · LinkedIn, Instagram, Video", and remove the dead space above Performance's CSV button. Target: no repeated date rows.
18. **[career-publish] Employers' repeated Google rows.**
    - The three Google rows (other teams, Cloud, DeepMind) show the same two story titles. Group them under a "Google" parent row that lists the stories once, with sub-team rows showing only their own watchlists and pins.
    - Move team watchlists into the name cell as tags and drop the mostly empty column.
    - Label the pinned left rule ("▌ pinned" in the caption).
19. **[career-publish] Career radar hygiene.**
    - Fold "agentic" into "agents" as an alias ("also agentic"), as "evals" already does.
    - Keep source casing consistent.
    - The job "Title" input shows "Associate Product" as if pre-filled. Use the placeholder "Job title".
20. **[search-system] Settings polish.** The Priorities terms inputs truncate mid-word ("multi-agent", "risk, s"). Make them auto-height 2-line textareas, or show the first terms plus "+N". Stretch the bottom Writing, Publishing and System summary cards to equal height. Target: no truncated term at 1440.
21. **[map] The side panel clips at 1440×900.** "Select a story to light up its links and list its…" is cut at the panel's bottom edge. Let `.map-side` scroll (`overflow: auto; overscroll-behavior: contain`), or tighten the bridge card so the hint fits. Target: no clipped text in the side panel at 1440×900.
22. **[shared] Tab-switch first-motion latency.** The old page holds full opacity for 80–135 ms after the click while the new view renders offscreen. Start the 220 ms leave fade on hashchange; the offscreen render still runs and the swap still happens when it's ready. Target: the first visible `#view` change is ≤ 34 ms after the hash changes.
23. **[shared · test] Harness checks for this round's findings** (`test/e2e/gates/perf.mjs` / `motion.mjs`):
    - **E2:** desktop open at 1×, frames 0–2400 ms after the click, count over 34 ms = 0. This catches the frost stall.
    - **E2:** open run 3 times, keeping the max.
    - **E1:** a `--laps 3` mode.
    - **C-flight:** title rect versus dek/actions rect intersection with both opacities over .15 = 0 frames.
    - **C-rings:** no ring text "0" for a non-zero score during load.

## Verdict

Round 2's motion blockers are mostly fixed:
- the tab switch hand-off, with no double exposure and no scroll jump
- the Feed filter, where persisting rows stay put
- ring revisits
- the theme switch
- the dossier body no longer lands empty
- collapse with the dossier open is 25.9 ms p95 at 4× (from 42)
- close is clean
- idle is silent on every route, Search included

What still drops frames is concentrated in one place: **right after every dossier open**, the frost recomposites the blur on every frame while the deferred sections fade in. That is 0.6 s of 50–83 ms frames at 1×, proven by A/B. Add E2's render-bound open frame (60 ms at 4×), and E1 swap frames that still lay out the whole document.

Fixes 1–3 make the dossier, the product's signature moment, clean. Fix 6 makes E1 stable. Fixes 7–8 take background_generic safely to 2. With those, plus 9 and 13–18 on the weak tabs, I expect motion_smoothness 8, the dossier and Today at 90 or above, every tab at 85 or above, and overall about 40.
