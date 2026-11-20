# Council E, round 4: motion engineering and performance (v4 HEAD 6e47f75, code = ad8490c)

Lens: jank is a defect. I scored from scratch on the live build. Round 3 numbers appear only for comparison.

## How I looked

- **Live app on :4453**, Playwright + CDP, deviceScaleFactor 1. I covered:
  - all 14 routes plus `#/draft/1` and `#/person/4`, in Proof and Night, at 1440 and 390
  - the rail collapsed on Today, Feed and Settings, and collapsed with the dossier open
  - the dossier opened from Feed and from Today, scrolled to the middle and the bottom, closed with Esc
  - hover on Today tiles and Feed rows, tab switches, the load entrance, Feed filter clicks
- **Gates:** `node test/e2e/run.mjs --port 4463 --no-shots`, full suite → `/tmp/claude-0/council-E-r4/gates.txt`.
- **Noise caveat:** another session's server (port 4452) was alive for the whole run; load average was 1.4–1.9 on 4 cores. The 1× results that sit exactly on 33.3 ms could be one dropped frame of noise. The 4× and per-task findings below are not borderline.
- **Captures** in `/tmp/claude-0/council-E-r4/`:
  - screenshots: `{proof,night}-{d,m}-<route>.png`, `*-full.png`, `*-collapsed.png`, `*-dossier-*.png`, `today-hover.png`
  - CDP screencast frames: `frames/<scenario>/NNN_<ms>.jpg`, with contact sheets `frames/sheet-collapse-dz-crop.jpg` (rail collapse with the dossier open, top-left crop) and `frames/sheet-open-feed-crop.jpg`
  - probe output: `probe-dossier_e1_tab_hover_rail.json`, `probe-idle4x.json`, `samp.json` (per-frame samplers), `trace-dz.json` (CDP trace of open, collapse, expand and close at 4×)
  - scripts: `probe.mjs`, `idle4x.mjs`, `samp.mjs`, `trace-dz.mjs`, `cap2.mjs`, `mksheet.mjs`, `lat.mjs`

## Gates: 18 of 25 pass (the integrator had 21)

| Gate | Result | What failed |
|---|---|---|
| **E1** tab change, phone 4× | FAIL 32/34 | Feed **58 ms** (`fillRest` idle chunk). sources→settings had 2 forced layouts (`settings.js:551 clipOne` + `motion.js:85`). |
| **E2** dossier | **FAIL 10/17** | Desktop click open **73 ms**. Desktop close **70 ms**. Collapse with the dossier open p95 **39.6 ms** at 4× (≤ 33). Close p95 33.4 at 1× (≤ 20). Phone click open **70 ms**. Open at 1× had 2 frames over 34 ms from Feed and 1 from Today (limit 0). The frost-at-rest checks pass. |
| **E4** idle | FAIL 4/5 | Search 8.43 ms of task time per 3 s (< 6). |
| **E6** pointermove | FAIL 1/2 | 5 layouts per 180 moves (pass), but **1 long frame**. |
| **E12** rail pacing | **FAIL 2/6** | p95 at 1×: today 33.3, feed 33.4 (≤ 33). At 4×: today 50.1, feed **83.4** (≤ 50). |
| **C-theme** | FAIL 10/12 | Frame p95 33.3 and 33.4 at 1×. Contrast holds. |
| **C-tabswap** | FAIL 9/10 | One frame at 305 ms with both h1s below .15. First visible change is 19 ms after the hash change, which fixes R3's 80–135 ms. |
| E3, E5, E7–E11, E13, C-entrance, C-pacing, C-rules, C-flight, C-rings, C-filter, all F-* | pass | |

## My own measurements

### Fixed since round 3 (verified)

**Dossier frost stall.**
- Open from Feed at 1×: after landing, 1 frame of 50 ms. Round 3 had 7 frames of 50–83 ms.
- Open from Today at 1×: 0 frames over 34 ms.
- The frost goes live with 0 running animations in the panel.

**Flight double exposure.** 0 frames where the flying title overlaps a dek with both opacities over .15, from Feed and from Today.

**Rings.** The count-up never shows a literal "0": figure spaces hold the width until counting starts. `samp.json` `ringLoad` has no off-path value.

**Feed filter.** The h1's minimum effective opacity is .50 on both chip clicks, against 0 in round 3.

**Feed row hover.** 2 layouts per 120 moves (round 3: 17).

**Close is one beat.**
- The crumb is back at 258–267 ms, while the panel is gone at 446 ms (from Feed) and 561 ms (from Today).
- There is no second beat any more.

**Tab switch.** First motion is 19 ms after the hash change, against 80–135 ms in round 3.

### Still wrong, or worse

**1. Collapsing the rail with the dossier open: jank and ghosting. Worse than round 3.**

| Reps at 4× (`probe-idle4x.json`) | p95 | max |
|---|---|---|
| From Today | 50, 50, 66.7 | 83–100 |
| From Feed | 33.4, 50, **166.7** | 66.7–166.7 |

- **The click task alone is 72–118 ms at 4×** (`BUTTON#rail-collapse.onclick` → `check@today.js:6`, the Today lead's ResizeObserver behind the scrim).
- **Round 3 measured p95 25.9.**
- **Cause, from the trace:**
  - `.main` steps its padding in the click frame. That is a full-document Layout, `dirty 82/2487 FULL`, plus the page's ResizeObservers.
  - While the rail's width transitions, there are more `Layout … dirty 7/2487 FULL` passes. A 7-object change re-lays out the whole document, because the rail is not a layout root.
- **Ghosting** (`frames/sheet-collapse-dz-crop.jpg`, 202–386 ms):
  - `.main` has already jumped left under a rail that is still 232 px wide.
  - The rail's fill is translucent, so the Feed h1 ("week", "19 updated…") shows through the rail labels for about 180 ms.
- This is the user's "never slides under" complaint, made visible.

**2. Opening from Feed blanks the score for about 500 ms.**
- `samp.json`: the source chip and the panel ring are both below .2 opacity from 68 to 563 ms, which is 31 frames.
- The chip is covered by the opaque panel at once, and the ring's fade now starts at .75 of the flight.
- From Today, where the source is a ring, there is no blank.

**3. Click → first dossier frame.** 38–42 ms at 1×, **103–112 ms at 4×** (`lat.mjs`). The trace of the click task at 4× shows:
- 22 ms of script in `hashchange` → `route`
- style 18 ms (138 elements), layout 7 and paint 8

**4. Progressive fill after landing.**
- `story-dossier.js` `step` runs every 50–80 ms from 734 to 1088 ms.
- Each step is 8–13 ms of script plus a 6–12 ms partial layout at 4×, while head-band fades are still running.
- That is where E2's 1–2 frames over 34 ms at 1× come from.

**5. Close.**
- The first close frame is a 20 ms rAF callback plus a document restyle at 4×: `chromeBack()` flips html classes in the same frame that drops `.frosted` and starts the clip.
- E2 close: 70 ms worst of 3, and p95 33.4 at 1×.

**6. Phone 4× laps (2 laps × 8 routes).**
- Frames over 50 ms on Today (58, from `IdleRequestCallback@today.js`), Feed (61, 68), Studio (50, 62), Campaigns (52) and Career (51, **121**).
- In the gate-style pass, Career had **142 ms with 79 ms forced style+layout inside `IdleRequestCallback@dossier.js`**. That is the dossier prebuild doing a full layout inside an idle callback, past its deadline.

**7. Rail collapse without the dossier.**
- p95 at 1× is 33.3 on Today, Feed, Map and Calendar. Round 3 was 16.8.
- At 4×, Feed is 66.7–83.4.
- `.main` re-wraps every frame (full layout of about 2,490 objects).

**8. The field worker during a collapse with the dossier open.** It still runs 15 ms frames for the `setRail` animation while `#bg` is `visibility: hidden`. This is off the main thread, but wasted.

### Visual sweep

- No console or page errors, and no horizontal scroll at 390 in either theme.
- The h1s agree across tabs (7 of 19 above the bar, 22 open drafts, 1 in review).
- Today's warn strip is opaque now.
- The hover pool is a soft blue edge, no longer graph paper.
- Settings terms wrap, and the bottom cards are equal height.
- The Map side panel fits at 1440×900.
- Campaigns and Performance no longer repeat the same slot.
- Employers collapses the duplicate Google rows.
- **Still there:**
  - The Calendar "open slot" chips. This is the third round they've been flagged.
  - "maxed" under Interest in the dossier's score breakdown, while everything else says "full marks".
  - Career's three KPI tiles.

## Rubric (0–10; overall /50)

| | Score | Why |
|---|---|---|
| unique_typography | 8.5 | Newsreader display with the opsz settle, Geist UI, Geist Mono data. A strong title/meta step on every tab, the dossier and phone. |
| color_cohesion | 8 | The quality ramp is everywhere, blue appears only above the bar, and first-party amber is consistent. Still off-key: amber bands on five tabs, and red overdue chips twice per row on People. |
| theme_cohesion | 8.5 | Proof and Night are one product on every surface. The theme switch keeps contrast (C-theme contrast checks all pass). |
| motion_cohesion | 8 | Settle, tab hand-off, count-up, filter, one-beat close and the sequenced flight now speak one language. Breaks: the score disappears for half a second on Feed opens, and the page ghosts through the rail on a collapse with the dossier open. |
| motion_smoothness | 7.3 | Smooth to the eye at 1× on every ordinary path, and the frost stall is gone. But gates dropped from 21 to 18 of 25. The collapse with the dossier open regressed to p95 39.6 (gate) and up to 167 ms frames at 4×. E2's open and close frames are 70–73 ms. E12 1× p95 went from 16.8 to 33.3. A 142 ms idle-callback frame on phone Career. |
| generic_typography | 2 | Not generic. A few mono-caps card eyebrows remain ("ABOVE YOUR BAR, NO DRAFT YET", "BY CHANNEL", "BIGGEST BRIDGE"). |
| background_generic | 2 | The ruled field is ours, correctly paced and quiet on reading views. The pool is tamed, and the strip is opaque. |
| color_combo_generic | 2.4 | Cool white with electric blue is still the stock pro-tool pair. The ramp and the amber first-party voice add some depth, but no second hue owns anything. |
| motion_generic | 2 | No expo curve, shimmer, tilt or per-character effects. The FLIP flight, the rail coupling and the count-up are specific to the product. |
| ai_slop | 2 | Honest data and empty states, real per-source claims, unequal weights shown. Template remnants: Career's three KPI tiles, and "maxed". |
| **overall** | **40** | Clear of 38, and the product looks finished. **Not at the bar:** motion_smoothness is 7.3, and the regression sits in the signature interaction (dossier plus rail). color_combo_generic is 2.4. |

## Tab scores (/100, the user's way)

| Tab | Score | Why |
|---|---|---|
| rail | 89 | Groups, icons, a sliding highlight, even collapsed rhythm (E11 pass) and a real by—line mark. Collapsing with the dossier open lets the page ghost through the translucent rail for about 180 ms, and it janks at 4× (up to 167 ms). E12 1× p95 doubled. |
| today | 90 | Issue no. + date, a finding headline, a numeric one-liner, gradient rings with no tick, why-ranked bullets, labelled weather, a map with top 3, a compact week strip, and an opaque collection-off strip. Held at 90: the lead repeats "6 posts · 1 outlet" in why-ranked and in Source mix, and the 78 count-up drags (1.3 s, the last 3 points take 350 ms). |
| dossier | 88 | The best content in the app, and the frost stall and title/dek collision are fixed. Below 90: on Feed opens the score is absent for about 500 ms mid-flight, collapsing the rail with it open ghosts and janks, the click frame is 73 ms and the close frame 70 ms at 4× (E2 10/17), and "maxed" contradicts "full marks". |
| feed | 89 | Clear title/meta step, source glyph key, top two topics, ramp chips, filter keeps rows and h1 (≥ .5), and hover is clean. The deferred-row idle chunk makes E1's only route over 50 ms (58), and E12 at 4× is 83. |
| map | 87 | A real graph with regions, hollow below-bar nodes, top 3 and a bridge card, and the side panel now fits. The "Digital Standards Office…" and region labels sit on edges and nodes. |
| search | 88 | Big autofocused bar, typed quick chips including "no matches yet", grouped results, refine counts. Idle is 8.4 ms per 3 s, just over E4's budget. |
| studio | 86 | Lead with a labelled hook, "Story score 72", before-approval checklist, sticky side column. The story groups come in an unexplained order (72, 42, 78, 59). |
| calendar | 85 | Month grid with no day/date gap, ramp dots, tray, cadence. For the third round, dashed "open slot" chips on five days read as fake entries in an empty month. |
| campaigns | 86 | Data headline, anchors grouped by topic, honest draft counts, one "next open slot" line. |
| performance | 86 | Pipeline strip, honest empty chart sentence, "Closest to publishing", and no more repeated slots. |
| career | 86 | Grammatical data h1, honest duplicate warning, "also agentic" folded in. The three KPI tiles are still a template row. |
| employers | 85 | Duplicates collapsed ("Same 2 stories as…"), watchlist column gone. There is about 400 px of dead band between the titles and Activity; titles have no score and aren't links; and AWS's match to the SDK releases is unexplained. |
| people | 86 | Overdue, duplicate and do-not-contact are explicit, with a pipeline and outreach against goal. Red appears twice per overdue row. |
| sources | 87 | Now-versus-before health bar, honest paused state, rich table. |
| runs | 87 | Clear stages with timings, honest 0-source Collect, cost controls, feedback effect. |
| settings | 87 | Terms wrap, the source health summary is rich, the cards are equal height. sources→settings costs 2 forced layouts. |

## Fixes (ranked by score movement; one owner each)

1. **[shared · blocker: rail, dossier, motion_smoothness] Rail collapse with the dossier open: ghosting and the 72–118 ms click task.**
   - **(a)** `html.dossier-open .rail { background: var(--surface-solid) }`. The field is hidden while the dossier is open, so the translucency buys nothing and only lets the page show through.
   - **(b)** With the dossier open, `.main` must not take its new padding in the click frame. In `app.js` `setCollapsed()`, set `html.rail-hold-main` before toggling `rail-collapsed`, with `html.rail-hold-main .main { --rail-w: <old value>; transition: none }`. Remove the hold at the panel's `railAnims` finish, inside `railDidChange()`. The page then re-lays out once, at rest and under the scrim.
   - **(c)** Make the rail a layout root (`.rail { contain: layout style paint }` with its height from the insets), so the per-frame width change is a partial layout and not `dirty 7/2487 FULL`.
   - **Target:**
     - E2 collapse p95 ≤ 33 at 4× and click task < 50 ms, over 3 reps from Today and from Feed
     - 0 sampled frames with page text visible inside the rail rect
     - collapse-time Layout events all `partialLayout: true`
2. **[shared · blocker: dossier] The score blanks for about 500 ms on Feed opens.**
   - **Problem:** chip and ring are both below .2 opacity from 68 to 563 ms.
   - **Fix, in `dossier.js` open:** when the source is a `.score-chip`, add a `.dz-fly-score` element inside the panel's clipped layer.
     - It shows the chip's number at the chip's rect.
     - It is translated and scaled on the title's curve to the ring centre.
     - It cross-fades out over .6–.85 of the flight, while the ring fades in from .6.
     - Compute the ring's fade start from geometry (the flight offset where the clip's top inset passes the ring's top), not a fixed .75.
   - **Target:** 0 frames after the click with both the score element and the ring below .2. No ring glyph cut by the clip.
3. **[shared · blocker: dossier, E2] Click-open frame of 73 ms (desktop) and 70 ms (phone) at 4×.**
   - **Fix 1:** start `dossier.open(id, src)` from the story link's click handler (capture, delegated in `app.js`), not after `hashchange` → `route`. The route guard (`isOpenOn`) already ignores the hash that follows. This removes about 22 ms of router script from the reveal task at 4×.
   - **Fix 2:** in the open phase, give every body section after the second `content-visibility: auto; contain-intrinsic-size: auto 480px`, so the reveal frame styles, lays out and paints only the visible panel. Drop it at `landed`.
   - **Target:** E2 desktop and phone click open, longest frame < 50 ms, worst of 3.
4. **[shared · E2] Close: a 70 ms frame at 4×, and p95 33.4 at 1×.**
   - **Problem:** `close()` drops `.frosted`, starts the clip and calls `chromeBack()` (an html class flip, which restyles the document) all in one frame.
   - **Fix:**
     - Drop the frost (`.is-busy`) in the Esc/× handler's own task.
     - Start the panel animations in the next frame.
     - Call `chromeBack()` one frame after that, mirroring the open.
   - **Target:** E2 close < 50 ms at 4×, p95 ≤ 20 at 1×.
5. **[feed-dossier · E2] Progressive fill steps land during the head fades.**
   - **Problem:** `story-dossier.js` `step` (around line 733) runs every 50–80 ms from 734 to 1088 ms, each 8–13 ms plus a 6–12 ms partial layout at 4×.
   - **Fix:** drive `step` with `requestIdleCallback`. Insert one chunk only when `timeRemaining() > 8`, and don't start until the head-band animations have finished (await their `finished`).
   - **Target:** E2 "frames > 34 ms in 0–2400 ms" = 0 at 1×, worst of 3, from Feed and from Today.
6. **[feed-dossier · E1, E12] The Feed deferred-row idle chunk** (`fillRest`: about 23 ms at 1×, 58–68 ms at phone 4×).
   - Append the rest in batches of at most 4 rows per idle callback, checking `timeRemaining()`.
   - Move `clampCheck` to a ResizeObserver callback, not a synchronous read after the insert.
   - Pause batching while `html` has a rail transition in flight.
   - **Target:** E1 Feed < 50 ms over `--laps 3`; E12 Feed at 4× p95 ≤ 50.
7. **[shared · E6, phone] The dossier prebuild runs a full layout inside an idle callback.**
   - **Problem:** 79 ms forced style+layout and a 142 ms frame on phone Career at 4×. It is probably also E6's long frame on Today hover (prefetch → prebuild).
   - **Fix:**
     - Skip `prebuild` when `phone()`: the sheet doesn't use the rects.
     - On desktop, split build/fill and attach+measure into separate idle callbacks. Run the measure only if `timeRemaining() > 12`, otherwise in the next idle callback.
     - Never prebuild in the first 2 s after `byline:routed`.
   - **Target:** E6 0 long frames, and no LoAF over 50 ms attributed to `IdleRequestCallback@dossier.js` in 2 phone laps.
8. **[shared · E12] Rail collapse without the dossier** (1× p95 33.3, was 16.8 in round 3; Feed at 4× is 83).
   - **Problem:** `.main` re-lays out the whole document every frame.
   - **Fix:** apply the R3 S5 technique to the page.
     - Step `.main`'s padding once at the start.
     - Carry `#main` with a WAAPI `translateX(oldRail − newRail → 0)` on `--dur-layout` / `--ease-move`, frame-locked to the rail.
     - This keeps DECISIONS' coupling (rail and content move together on one curve), and moves the per-frame work to the compositor.
     - Together with 1(c), only the rail lays out per frame.
   - **Target:** E12 1× p95 ≤ 20 and 4× p95 ≤ 50 on Today and Feed.
9. **[calendar-studio · blocker: calendar] "Open slot" chips (third round).** Remove `.cal-open` and `.cal-slot.is-open` as chip-shaped elements. On open posting days, render a 4 px `--text-3` dot under the day number, with the legend "● posting day, nothing planned". Keep "missed" as plain text. **Target:** an empty month shows no chip-shaped element in an empty cell.
10. **[shared] "maxed" vs "full marks".** `src/dossier.js:28` emits `interest: 'maxed'`, which the score breakdown prints under the Interest bar. Change it to "full marks", matching why_ranked and the evidence summary. Update the unit test that asserts the string. **Target:** the word "maxed" appears nowhere in the UI.
11. **[career-publish · employers ≥ 87] Employers' dead band.** Each story line in the stories column gets:
    - its score chip (`scoreChip`, ramp colours)
    - a link to `#/story/:id`
    - the matched term in muted text ("matched 'Bedrock'", which explains AWS → SDK releases)

    Cap the stories column at 560 px, so Activity sits next to the content. **Target:** no empty horizontal band over 200 px inside a row at 1440.
12. **[today] The lead repeats counts.** "Evidence is thin: 6 posts from 1 outlet…" in why-ranked is followed by "Source mix: 6 posts · 1 outlet · all first-party". When the evidence bullet already states posts and outlets, show Source mix as the outlet names plus first-party/independent only ("cloud.google.com · first-party"), or drop the row. **Target:** no count stated twice in one tile.
13. **[shared] The count-up tail.**
    - **Problem:** `ui.js` `countTo` takes 1.33 s for 78, and the last 3 points take 350 ms.
    - **Fix:** cap the duration at 900 ms, using the settle curve on value (not per-integer steps at the end).
    - **Target:** the ring reaches its value ≤ 1000 ms after its tile starts fading in.
14. **[search-system · E4] Search idle at 8.43 ms per 3 s** (limit 6). Find the recurring timer (likely the quick-chip "no matches yet" refresh or the focus/keytip watcher) and stop it once the page is idle. **Target:** E4 Search < 6 ms.
15. **[search-system · E1] sources→settings costs 2 forced layouts** (`settings.js:551 clipOne` + `motion.js:85`). Run `clipOne`'s reads after `byline:routed` in a single rAF read phase, or read `scrollHeight` inside the motion read batch. **Target:** ≤ 1 forced layout on that transition.
16. **[shared · C-tabswap] One blank frame at 305 ms** (old h1 0, new .10). Start the new heading's entrance when the old h1's effective opacity is ≤ .3, not at 0. **Target:** 0 frames after 300 ms with both h1s below .15.
17. **[shared] The field worker draws while hidden.** In `bg.js` `setRail`, when `html.dossier-open` or `html.dz-field-hold` is set, snap to the final rect without animating, and post nothing to the worker until the field is visible again. **Target:** 0 worker frames during a collapse with the dossier open.
18. **[calendar-studio] Studio group order.** Groups appear as 72, 42, 78, 59. Sort by status (in review first), then story score, and say so in the toolbar ("in review first, then by score").
19. **[career-publish] Career's KPI tiles.** Merge the three tiles into one sentence row: "22 skills in 30 days (19 this week, 9 in your saved job post) · 4 projects (2 active) · 0 experiences, add one". **Target:** no row of three same-shaped stat cards.
20. **[map] Label collisions.** "Digital Standards Office…" and "Business adoption · leads 4" sit on edges and nodes. Add a collision pass: label boxes get 4 px padding and nudge vertically by at most 12 px away from nodes and edges. **Target:** no label box intersecting a node circle at 1440×900.
21. **[shared · test] Harness additions** (`test/e2e/gates/perf.mjs` / `motion.mjs`):
    - **E2 collapse:** a pixel-diff check of the rail rect against a run with the page text hidden, to catch ghosting; run 3 reps and keep the worst.
    - **E2 open from Feed:** a score-continuity check (chip/fly-score/ring max opacity ≥ .2 on every frame).
    - **E1:** default `--laps 2`.

## Verdict

Round 3's motion asks mostly landed:
- the frost goes live only at rest
- no title/dek collision
- no false "0" on the rings
- the filter keeps its h1
- clean Feed hover
- a one-beat close
- tab-switch latency of 19 ms

The ordinary 1× paths look smooth.

**The weak spot moved, it didn't disappear.**
- Collapsing the rail with the dossier open is now worse than in round 3: a 72–118 ms click task, frames up to 167 ms at 4×, and the page visibly ghosting through the translucent rail. That is exactly the "never slides under" moment the user called out.
- The dossier's open and close frames are still 70 ms at 4×.
- Feed opens lose the score for half a second.
- Gates went from 21 to 18 of 25.

Fixes 1–4 are the dossier and rail. With them, plus 6–8, I expect motion_smoothness 8, the dossier at 90 or above and the rail at 90. Calendar (9) and Employers (11) need their own fixes to stay at 85 or above.
