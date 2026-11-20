# Council E, round 1: motion engineering and performance (v4 HEAD 8eb8113)

Lens: jank is a defect. I measured the live build with Playwright and CDP: long frames at 4× CPU on phone, forced layouts, idle rAF on every route, ambient budget, per-frame cost of the rail collapse, the dossier flight and the hover, plus frame sequences of every motion moment. I then looked at every tab as the user would.

## How I looked

- App on :4453 (Canvas2D field: SwiftShader rejects WebGL2 under `failIfMajorPerformanceCaveat`, as designed). Covered all 14 routes, `#/draft/1` and `#/person/4`, and the dossier opened from Feed and from Today. Proof and Night, 1440×900 and 390×844, rail expanded and collapsed (including collapsing with the dossier open), hover, theme switch, the load entrance and tab switches.
- Captures in `/tmp/claude-0/council-E-r1/` at deviceScaleFactor 1: `{proof,night}-{d,m}-<route>.png` plus `-full.png`; `frames/<scenario>/` holds CDP screencast frame sequences with timestamps; `sheet-*.jpg` are contact sheets of them.
- Raw numbers: `gates.txt` (full harness), `probe.txt` (idle per route, phone 4× tab-ins), `trace.txt` (trace breakdown of the long frames), `rail.txt` (rail-collapse cost per route), `frames.txt` (frame intervals per scenario).
- `npm test`: 63/63 pass.

## Gates (`node test/e2e/run.mjs --port 4463`): 17 of 19 pass, exit 1

| Gate | Result | Notes |
|---|---|---|
| **E1** tab change, phone 4× | **FAIL 23/32** | Longest LoAF on **all 8 routes** is 62–97 ms against a 50 ms limit. Feed has 4 ms forced per LoAF. Σ blocking passes (23–65 ms). Forced layouts per transition = 1 (pass). |
| **E2** dossier | **FAIL 5/9** | Desktop open 66 ms, close 70 ms, **2 forced layouts per open** (`dossier.js:131`). Phone open 60 ms (`Response.json.then`, 32 ms of it forced). Rail-coupling drift 0 px, minimum gap 12 px (pass). |
| E3 CLS | pass | But **every route reads exactly 0.0182**, which is 91% of the 0.02 limit. That is one shell-level shift repeated on every load; one more shifting node anywhere fails all 14 routes. |
| E4 idle | pass | 0 rAF, 0.65 ms of tasks, 0 layouts. |
| E5 ambient | pass | 19.8 draws/s, 182 ms of tasks per 5 s on desktop; Feed dims to .35 at 18 draws/s; phone is static. |
| E6–E11 | pass | Pointer moves cause 4 layouts per 180 moves. Glass: 1 surface at rest, 2 with the dossier, 3 with ⌘K over it. Backing store 2.40 MP. Map p95 is fine. Collapsed rail pitch set is {36, 44}. |
| C-entrance, C-pacing, C-rules | pass | No expo curve, no animated layout properties, pacing correct. |
| F-* | pass | |

## My own measurements

**Idle (desktop, `?bgidle=1500`, 3 s window after 4.5 s settle), every route:** 0 rAF callbacks, 0 layouts, 0 style recalcs, 0 running animations, 1 `backdrop-filter`. This is exemplary. Two exceptions:
- Map holds **6 permanent `will-change`** elements against a limit of 4: `#bg-light`, `.rail-hl`, two `.map-canvas`, `.map-topic-labels`, `.map-node-labels`.
- Search uses 60 ms of task time in an idle 3 s window. Some timer keeps running there.

**Phone 4× tab-ins (my sequence, which differs from E1's):** today 105 ms, calendar **121 ms (7 ms forced)**, draft/1 83 ms, feed 81, map 80, runs 80, sources 71, search 64. The dossier opens in 91 ms.

**Why the tab-in frames are long (trace, phone 4×):** script is small, 10–25 ms. The long frame is rendering:
- Feed→Today: one task of 104–155 ms. **Layout 52–71 ms** is a *full* layout (`partialLayout:false`, 58 dirty of 1,787 objects), followed by Paint 26–37 ms and style 19–21 ms.
- Today→Calendar: 112 ms, of which Layout is 76 ms.
- The swap moves the old page from in-flow to `position:absolute` (`.leaving`) and the new page from `position:absolute; visibility:hidden` (`.is-pending`) into flow in the same frame. Both subtrees change containing block, so the whole document lays out twice over.
- The hidden page was already laid out once while pending: a separate 77 ms layout with 9 dirty objects. So the router pays for layout twice.
- An A/B with `text-wrap: wrap !important` on everything cut the swap layout by roughly 15–25%. The 26 `text-wrap: pretty|balance` declarations contribute, but they are not the main cause.

**Rail collapse cost (the most important new finding).** Measured while collapsing on each route; frame intervals in ms:

| | p50 | p95 | max | Style recalc during collapse | Layout |
|---|---|---|---|---|---|
| 1× Today | 17 | 33 | 33 | **250 ms** | 32 ms |
| 1× dossier open | 17 | 83 | 83 | 101 ms | 10 ms |
| 4× Today | **83** | **217** | 217 | **440 ms** | 41 ms |
| 4× Feed | 17 | 117 | 117 | 408 ms | 49 ms |
| 4× dossier open | 67 | 167 | 167 | 365 ms | 45 ms |

The cause is in `tokens.css:22–23`:
- `@property --rail-w { inherits: true }` and `--grp-h { inherits: true }` are transitioned on `html`.
- Every frame of the 420 ms collapse therefore restyles all ~1,800 elements.
- Layout is cheap here; style recalc is ten times layout.
- On a mid phone or tablet in landscape the "adapting dossier" the user asked for runs at about 6–12 fps.

This was my own round-0 recommendation (inherits:true on the shell), and it is wrong. Fix 1 corrects it.

**Dossier flight and close (desktop, 1×, screencast plus an in-page frame sampler):**
- Open: frame interval p50 **33 ms**, p95 50, max 83. That is a 30 fps flight on an unthrottled desktop.
- The first visible motion comes about 250–300 ms after the click. That includes the 120 ms data race and the synchronous `fill()`. The harness clicks without a hover dwell, so a real user will see less of this delay, but the render still lands mid-flight.
- At 480 ms the panel is translucent, so the Feed h1 and the topic chips show through it. The right-hand "Why it ranked" card is an **empty outlined box** (its border paints before its content). The ring is absent: it flies from a Feed `score-chip` at opacity 0 until 40% of the flight.
- At 530 ms the flying title sits directly over the page h1 ("week are worth a post." / "Introducing Gemini agent").
- Close: frames at 148, 248 and 348 ms, so **about 10 fps** (p95 100 ms, max 117 ms). Removing `.frosted` (the backdrop-filter layer) while clip-path animates a full-viewport panel re-blurs every frame.

**Tab switch (Today→Feed):** p50 17 ms, p95 33 ms on desktop. Around 268 ms both h1s are on screen at once: the old Today heading drops about 9 px *down* while the new eyebrow fades in above it. The spec says the old view drifts −6 px up.

**Load entrance:**
- The settle itself is clean: opsz, blur and line fades, no re-wrap.
- At 514 ms the rail, the pill and "Run today's workflow" are fully visible before the h1 has started.
- The Today choreography creates about 120 Animation objects, including per-`<circle>` opacity animations on the mini-map SVG (up to 60). SVG opacity is not composited, so the mini-map repaints on every frame of the entrance.
- The ring count-up is correct.

**Hover:** 120 pointer moves inside the lead tile give 120 style recalcs and 313 ms of tasks (about 2.6 ms per move), because `--mx/--my` is written to the tile every frame for the radial tint. Layout count is 0, so it is acceptable on cost. In feel, though, it is cursor tracing inside the tile, which the user explicitly did not want ("light reaction, not cursor tracing").

**Background:**
- `#bg` lays out at **1425 CSS px wide** on a 1440 viewport while its backing store is 1440 px. The result is a 15 px strip with no field down the right edge, and the dashes resampled by 0.99 (soft).
- In Night, the dash rows are bright enough to read as dashed rules running *through* the h1 and the one-liner.

**Filter and search repaint flashes (pops):**
- `feed.js:268` animates the h1 from opacity 0.4 to 1 after every filter change.
- `search.js:336` animates it from 0.35 to 1 on every query change.
- Both are a one-frame opacity drop of 0.6 (the C-entrance definition of a snap), repeated on every chip click and keystroke.

**Phone:** the status pill truncates mid-figure ("0 new · 1|") on every route at 390 px.

## Rubric (0–10; overall /50)

| | Score | Why |
|---|---|---|
| unique_typography | 8 | Newsreader display with the opsz settle, Geist UI and Geist Mono data. Consistent and deliberate. |
| color_cohesion | 7.5 | Calm white with blue and AA throughout, but the quality ramp reads as 2–3 flat tiers. Amber banners appear on five tabs. |
| theme_cohesion | 8 | Proof and Night are one product. Night's field is too loud behind text. |
| motion_cohesion | 7 | The settle, staggers, count-up and hover speak one language. The dossier flight, the tab exit (drifting down) and the filter flashes do not. |
| motion_smoothness | **5** | Idle is perfect, but the moments the user feels are janky: E1 fails on every route, E2 fails, the rail collapse runs at about 12 fps at 4× because the whole document restyles each frame, the dossier flight runs at 30 fps and the close at about 10 fps unthrottled, and the flight composites the page through the panel. |
| generic_typography | 2 | Not generic. Uppercase mono labels are slightly overused inside tiles. |
| background_generic | 3 | The ruled field is ours and correctly paced. In Night it reads as dashed underlines through text, and it has a 15 px seam. |
| color_combo_generic | 3 | White with electric blue is the stock pro-tool pairing. Only the amber band adds anything else. |
| motion_generic | 2 | No expo curve, shimmer, sheen, tilt or per-character effects. |
| ai_slop | 2 | Honest data and empty states. A few stacked mono eyebrows. |
| **overall** | **36** | The most honest and information-dense Byline yet, and silent at idle. But the motion the user touches most (tab-in, dossier open and close, rail collapse with the dossier open) drops frames on desktop and badly on phone. **Not at the bar:** overall < 38, motion_smoothness and motion_cohesion < 8, color_cohesion < 8, and two negatives at 3. |

## Tab scores (/100, the user's way)

| Tab | Score | Why |
|---|---|---|
| rail | 86 | Groups, sliding highlight, an even collapsed rhythm (E11: {36, 44}) and a real by—line mark. The collapse itself restyles the whole app every frame: p95 117–217 ms at 4×, so it visibly stutters. |
| today | 86 | Issue number, date, an informative headline and a numeric one-liner, weather, mini-map with the top 3, why-ranked bullets. Held back by the 97–105 ms tab-in frame, a load order that shows the action button before the headline, and about 200 px of dead space between the lead title and its finding. |
| dossier | 82 | The content is the best in the app: what each source said, weighted breakdown, adapts to the rail. The flight is broken: translucent panel, empty card outlines, the title over the page h1, a 30 fps open and a ~10 fps close, 66–91 ms long frames. The panel also fills the full content width, which the user said it should not. |
| feed | 86 | Clear title-to-meta step, independent markers, top two topics, a quiet background. Every filter click flashes the h1 to 0.4, and the tab-in frame is 78–81 ms at 4×. |
| map | 84 | A real clickable graph with region contours, top 3 and a biggest-bridge card. Over budget on `will-change` (6), an 80–83 ms tab-in, and the side panel is clipped at 900 px tall. |
| search | 85 | Big bar, typed quick chips and useful grouped results. The h1 flashes on every query; the tab-in frame is 64–70 ms. |
| studio | 80 | Functional and dense. Still a list page more than a workshop. The draft editor is good, but the draft/1 tab-in is 83 ms. |
| calendar | 82 | Month grid, no day/date gap, tray and cadence. The worst tab-in (121 ms, 7 ms forced at 4×). Dashed "open slot" chips are noise in an empty month. |
| campaigns | 82 | A useful candidate list with real counts. The right column is thin, and the explainer card is filler. |
| performance | 74 | Honest empty state, but most of the page is empty space beside a chip list; the right column ends after 230 px. |
| career | 82 | Strong headline, the duplicate-post warning, a real skill table. The KPI cards are generic number tiles. |
| employers | 80 | The coverage table works. The h1 runs to three lines, and the right half of the rows is sparse action buttons. |
| people | 83 | Overdue items, do-not-contact and duplicate warnings, pipeline. Dense and honest. |
| sources | 84 | A rich summary with a now-versus-before-the-pause health bar and expandable rows. The 71–77 ms tab-in. |
| runs | 84 | Stages, cost controls, history; clear about the 0-source runs. |
| settings | 81 | Well sectioned with a source-health summary, but about 7,000 px long, with many solid-blue slider fills. |

## Fixes (ranked by score movement)

1. **[shared · blocker] Stop the whole-document restyle on rail collapse.**
   - In `public/css/v4/tokens.css:22–23`, register `--rail-w` and `--grp-h` with `inherits: false`.
   - Remove the `--rail-w` transition from `html` (`shell.css:9`). Instead, declare `--rail-w: var(--rail-expanded)` and `html.rail-collapsed & { --rail-w: var(--rail-collapsed) }`, each with `transition: --rail-w var(--dur-layout) var(--ease-move)`, on each consumer separately: `.main`, `.rail`, `.dossier-panel` (`components.css:330`), `.toasts` (`components.css:237`) and the rail tip (`shell.css:167`).
   - Move `--grp-h` and its transition onto `.rail-group` and `.rail-hl`.
   - Update the `transitionend` listener in `app.js` to listen on `.main`.
   - Targets:
     - Style recalc during a collapse ≤ 30 ms at 1× (now 250 ms).
     - Frame p95 ≤ 33 ms at 1× and ≤ 50 ms at 4× on Today, Feed and with the dossier open (now 217 and 167 ms).
     - E2 drift stays 0.
   - Add the 4× collapse frame p95 to E2 in `test/e2e/gates/perf.mjs`.
2. **[shared · blocker] Make the route swap stop relaying out the whole document (E1).**
   - In `shell.css:244–256` make `#view { display: grid }` and give every `.page` `grid-area: 1 / 1; contain: layout style;`.
   - `.is-pending` keeps only `visibility: hidden; pointer-events: none` (no `position: absolute`).
   - `.leaving` keeps only opacity, transform and `pointer-events: none` (no `position: absolute`, no `style.top` write in `app.js` `leave()`).
   - Then no subtree changes containing block at swap, and the `offsetTop` read in `routeTo` can go.
   - Add `content-visibility: auto; contain-intrinsic-size: auto 320px` to below-the-fold tiles via a shared `.cv` class that views can opt into.
   - Targets: E1 longest LoAF < 50 ms on all 8 routes at phone 4× (now 62–97 ms), and the swap Layout < 15 ms in the trace (now 52–76 ms).
3. **[shared · blocker] The dossier's open render and its forced layouts (E2).**
   - In `dossier.js` `prefetch(id)`, after the data resolves, build the panel offscreen in a `requestIdleCallback`: call `build()` and `fill()` into a detached root and cache it by id. `open()` then only appends the prebuilt root.
   - Replace the read of `dst.getBoundingClientRect()` at `dossier.js:131` with a measurement taken during the prebuild (in a hidden attached container at final width), so open performs 0 reads after insert.
   - Start the clip-path flight in the same frame as the click when the prebuild exists. Otherwise fly with `placeholderHtml` immediately rather than waiting 120 ms.
   - Targets: E2 open and close < 50 ms on desktop and phone at 4×, ≤ 1 forced layout per open, first visible motion ≤ 1 frame after the click.
4. **[shared · blocker] Clean up the dossier flight composition.**
   - `.dossier-fill` must be opaque (`--surface-solid` at alpha 1, or the 0.94 DECISIONS allows) **from the first frame**. It must not fade with the scrim, so the page never shows through the panel mid-flight.
   - Body sections and the right column, including the `.dx` side card's border, must start at opacity 0 and arrive with the section stagger. Today the side card's outline paints empty at 480 ms.
   - When the source score element is a Feed `.score-chip`, cross-fade the ring in place over the first 40% instead of leaving it invisible.
   - Target: no frame shows page text inside the panel's clip, and no empty bordered box is visible during the flight (C-entrance appear-at-full-opacity check on `.dossier`).
5. **[shared] The dossier close runs at about 10 fps.**
   - In `close()`, before animating, hide `.dossier-frost` with `display: none`, not by removing `.frosted`, which fades a live backdrop-filter. The clip-path animation must never run over a backdrop-filter descendant.
   - Animate the body fade and the clip on the same frame.
   - Target: close frame p95 ≤ 20 ms at 1× (now 100 ms), and E2 close < 50 ms at 4×.
6. **[shared] The tab exit drifts down and overlaps.** Once fix 2 lands, the old page leaves in place with `translateY(-6px)`, so the 9 px downward jump disappears. Also start the new page's head (`.page-head`, actions and chips) only after the old page's opacity is below 0.3 (delay the enter by 120 ms). Target: no frame shows both h1s at combined opacity > 1.2.
7. **[today] Load order and Animation count.**
   - The run strip, "Run today's workflow" and the "···" button must start fading no earlier than 300 ms after the h1's first line (C §2 order: headline, then one-liner, then tiles).
   - Replace the per-`<circle>` opacity animations on `.td-map-nodes circle` (`today.js:500`, up to 60 Animations) and the per-dot weather animations (`today.js:492–497`, up to 80) with one opacity and transform animation per group (`.td-map-nodes`, and each `.td-wx-row`), staggered by row.
   - Targets: ≤ 30 Animation objects on Today load, and E1 Today < 50 ms.
8. **[shared] Tile tint is cursor tracing.** The user asked for light reaction, not cursor tracing. Drop the per-frame `--mx/--my` writes for the tile tint (the pointermove handler in `app.js` belongs to the shared owner, so the shared owner removes it). In `components.css` `.tile::after`, use a fixed radial at 50% / 0% (top-centre wash) at the slightly stronger `--hover-wash` the user asked for, and let the background pool (`bg.js` pool tween) be the only light that moves. Targets: 0 style recalcs per pointermove within a tile; the hover tint is visible but static.
9. **[shared] The background canvas seam.** `#bg` measures 1425 CSS px against a 1440 px backing store. Size both from the same number in `bg.js` `resize()` (use `document.documentElement.clientWidth`, or `innerWidth` when there is no classic scrollbar), set `canvas.style.width` from it explicitly instead of relying on `100vw`, and send the same W to the worker. Target: `getBoundingClientRect().width × scale === canvas.width` on every route, and no unpainted strip.
10. **[shared] Night field contrast behind text.** In `tokens.css`, Night `--fd-amin`/`--fd-amax` are too high: dashes read as rules through the h1. Lower Night `--fd-amax` by about 35%. Have the shader's `u_alpha` multiply by 0.5 inside a "text band" rect, passed like the rail rect, covering the `.page-head` box: it updates on route and resize only, from a ResizeObserver, never read per frame. Target: dash contrast under the h1 and lede < 1.15:1 against `--bg`.
11. **[feed-dossier] Filter clicks flash the h1.** Delete `feed.js:268`. When the count text changes, cross-fade only the changed numbers: wrap each figure in `<b>` and run a 240 ms opacity 0→1 with fill backwards on the new `<b>` only, never on the whole h1. Target: no element's opacity drops by more than 0.35 in one frame on a filter click.
12. **[search-system] The query flash.** Delete the h1 0.35→1 flash at `search.js:336`. Apply the same changed-number cross-fade as fix 11, and debounce headline changes to ≥ 200 ms after the last keystroke. Also find the timer that uses 60 ms of task time per 3 s at idle on Search and stop it when the bar is idle.
13. **[map] Over the `will-change` budget.**
    - Remove `will-change: opacity` from `.map-canvas` (`map.css:248`). Set it from JS only during the 240 ms list/graph swap.
    - Remove `will-change: transform` from `.map-node-labels` and `.map-topic-labels` (`map.css:45`). Set it on pointerdown and wheel start and clear it 300 ms after the camera settles.
    - Targets: ≤ 4 permanent `will-change` on `#/map` at rest, E10 still passing, and the Map tab-in < 50 ms at phone 4× (now 80–83 ms; `map-engine.js:87` runs a 30 ms first draw inside the swap frame, so defer it to an idle callback after `byline:routed`).
14. **[calendar-studio] The Calendar tab-in is the worst: 121 ms with 7 ms forced.**
    - `calendar.js:410` calls `enterItems` on every chip and item in a rAF inside the swap, and `fillTray` reads layout.
    - Defer both until after `byline:routed` plus one frame.
    - Cap the chip stagger at 12 elements and animate the week rows as groups.
    - Target: < 50 ms at phone 4× and 0 ms forced per LoAF.
15. **[calendar-studio] The draft/1 tab-in is 83 ms.** `studio.js:593` animates every `.st-sec` in the same frame as the swap. Defer it to `byline:routed`, cap it at 6 sections, and render editor sections below the fold with `content-visibility: auto`. Target: < 50 ms at 4×.
16. **[shared] CLS sits at 0.0182 on every route.** Find the shared node shifting on load (likely the status pill text filling in or the crumb), reserve its box (`min-width` in `ch` on `.pill-text`, fixed crumb width), and target CLS ≤ 0.005 per route. Tighten E3 to 0.01 once this is fixed so one regression doesn't fail all routes at once.
17. **[shared] The phone status pill truncates mid-figure.** At ≤ 760 px, render a short form ("No. 1 · Wed 18 · 19 ranked · 7 ≥ 55") or let `.pill-text` scroll horizontally with a fade mask. Never cut a number.
18. **[shared] The dossier fills the content width.** The user liked a dossier that "doesn't fill the screen". Cap `.dossier-panel` width at `min(1120px, 100vw − rail − 3×inset)`. Anchor it to the rail side (left follows `--rail-w`), with the scrim showing the page on the right. This keeps the rail coupling and stays within DECISIONS (the inset alignment to rail top and bottom is kept). The panel geometry is in shared `components.css:330`, the content columns in `dossier.css`; the shared owner sets the width and feed-dossier rebalances the 7/5 columns.
19. **[today] Dead space in the lead tile.** The ring column forces about 90–200 px of empty space between the title and the finding at 1440 px. Put the finding in the left column directly under the title, with the ring top-right spanning title and finding (`grid-template-rows: auto auto` with the ring `grid-row: 1 / 3`).
20. **[career-publish] Performance's empty right column.** Move "What will be tracked" into the left card under the pipeline and make the CSV import a right-column card (it fits at 5/12), so neither column ends with 400 px of empty space at 1440×900.
21. **[shared] Theme switch frame rate.** The theme switch shows p95 67 ms frames at 1× because about 20 selector groups transition colour on every tile. Keep the token-surface list, but drop `.chip` and `.tag` from the cross-fade list in `shell.css:259` (dozens per page) and let them switch at the 300 ms midpoint under the surfaces. Target: theme switch frame p95 ≤ 33 ms at 1×.
22. **[test] Add the measurements this round relied on to the harness.** In `test/e2e/gates/perf.mjs`:
    - rail-collapse frame p95 at 4× on Today and with the dossier open (≤ 50 ms);
    - dossier close frame p95 at 1× (≤ 20 ms);
    - canvas CSS width equal to the viewport;
    - permanent `will-change` per route, all 16 routes, ≤ 4.

## Verdict

v4 is silent at rest: zero rAF and zero layouts on all 16 routes, correctly paced, and the heading settle fixes the user's "rushed" complaint. But everything the user *does* has frame drops:
- Tab-ins exceed 50 ms on every route at 4×.
- The dossier opens at 30 fps and closes at about 10 fps on an unthrottled desktop, with the page showing through the panel.
- Collapsing the rail restyles the whole app on every frame.

Fixes 1–5 are blockers; they are mostly CSS-scoping and order-of-work changes, not redesigns. With those plus fixes 7, 9 and 11, I expect motion_smoothness at 8 and overall at about 40.
