# Byline v4 council, round 1: merged implementation plan (chair)

Inputs: round1-B/C/D/E/F critic reports (live v4 at 8eb8113), SPEC-v4 §0 (user's critique, highest priority), DECISIONS-v4, majority.
Gap to bar: overall 37.2 (<38); color_cohesion 7.4, motion_cohesion 7.3, motion_smoothness 6.6 (<8); background_generic 2.9, color_combo_generic 2.9, ai_slop 2.5 (>2). Tabs below target: performance 75.2, career 77.8, studio 79.6, employers 79.6, campaigns 81.8, settings 82, map 82.6, calendar 83, people 84, sources 84.6 (target 85); dossier 84.8, today 86.2 (target 90).

## Conflict rulings (apply everywhere)

1. **Quality ramp.** The user asked for a visible quality gradient (SPEC §0). This overrides the B §2 stop values. The fix keeps B's API (`qualityColor/qualityTier/qualityLabel`).
   - Stop positions become `[-30, -15, -1, 0, +10, +25]`, so 64, 72 and 78 at T=55 land on three different colours.
   - Tier boundaries stay as SPEC says: `top` (deeper colour and glow) still starts at T+15.
   - Colour values are B's, except Proof q-5, which takes C's deeper `#0B2E9E`. All values are listed in the shared brief.
   - Ring arcs get a gradient from qualityColor(threshold) to qualityColor(score) (B and F). C's stroke-width tiers are not adopted: the fill fraction stays the non-colour cue.
2. **Dossier width.** The user praised Glass's dossier for not filling the screen. B, C, D and E agree on a cap. The panel width is `min(1040px, 100vw − var(--rail-w) − 2·var(--shell-inset) − 160px)` on desktop, so at least 160 px of page shows on the right at 1440 with the rail expanded (E's target). On phone it stays a full sheet.
3. **Scrim vs rail** (C and F blockers). The rail sits above the scrim, undimmed and clickable. Clicking a nav item closes the dossier and routes.
4. **Tile hover.** E's ruling: the per-tile cursor-tracking radial (`--mx/--my`) goes; SPEC says "light reaction, not cursor trail". The tile wash becomes a fixed top-centre radial, and B's stronger hover values apply. `#bg-light` is the only light that moves.
5. **Theme switch.** B wants text colour to cross-fade; E found the theme switch already at p95 67 ms. Both outcomes are binding: no sampled frame below 3:1 text/surface contrast, and frame p95 ≤33 ms at 1x. The shared brief gives the approach.
6. **Field vs text.** D and E: the field softens under `.page-head` and Night dash amplitude goes down. B: the pointer light reaction must be stronger. These don't conflict, and all three apply.
7. **Mono caps.** F and C apply DECISIONS ("uppercase mono for eyebrows, column heads and rail group names only"). `.tag` and `.td-label` become sentence-case Geist.
8. **Rail logo** (D). Strokes only in the rail: ink b and y, with the descender/underline stroke in `--accent`. DECISIONS allows this, and it fixes C and F's "underline lost at 26 px". The filled tile stays for the favicon, PWA and apple-touch icons.
9. **"over bar" precision** (F). Every "over/below bar" figure is `round(score) − threshold`, an integer. Only the breakdown's reconciliation sum row keeps one decimal.
10. **Settings sliders.** B's version (neutral fill, blue thumb only on hover/focus) beats F's (blue for weight ≥2), because B owns the blue budget.
11. **Today row 3.** C and D's restructure beats B and F's patch. The 62 tile leaves row 3; This week and Waiting on you share the row.
12. **Performance gates.** E1 and E2 are split: the shared owner handles the router and dossier frame; tab owners handle progressive render, `content-visibility` and fewer animations/nodes.

## Briefs

Each owner brief follows below, in the order shared, feed-dossier, today, career-publish, calendar-studio, search-system, map. They are copied verbatim into the workflow output.

### 1. shared (blocking: motion_smoothness 6.6, color 7.4, background_generic / color_combo_generic 2.9, ai_slop 2.5; E1/E2)

Files: public/index.html, public/js/{app,ui,motion,bg,bg2d,bg2d-worker,dossier,quality,index-menu,api}.js, sw.js, css/v4/{tokens,shell,components}.css, icons, server.js, src/**, test/**.

**P0: frame drops (do these first)**

- **S1. Rail collapse restyles the whole document** (E, blocker).
  - Problem: tokens.css:22-23 registers `--rail-w` and `--grp-h` with `inherits:true` and transitions them on `html` (shell.css:9). One collapse costs 250 ms of style recalc at 1x and 440 ms at 4x; frame p95 is 217 ms.
  - Fix:
    - Register both with `inherits:false` and remove the `html` transition.
    - Declare `--rail-w`, its `html.rail-collapsed` value and its own `transition: --rail-w var(--dur-layout) var(--ease-move)` on each consumer: `.main`, `.rail`, `.dossier-panel` (components.css:330), `.toasts` (:237) and the rail tip (shell.css:167).
    - Put `--grp-h` and its transition on `.rail-group` and `.rail-hl`.
    - Move app.js's transitionend listener to `.main`.
  - Targets:
    - Recalc per collapse ≤30 ms at 1x.
    - Frame p95 ≤33 ms at 1x and ≤50 ms at 4x on Today, Feed and with the dossier open.
    - E2 drift stays 0, E11 still passes, and `dossier.left ≥ rail.right` holds on every frame.
- **S2. Router swap** (E1 fails on every route, 62–121 ms at phone 4x; E, C, D).
  - Cause: a full-document Layout happens because `.leaving` and `.is-pending` toggle `position:absolute` in the same frame.
  - Fix in shell.css:244-256:
    - `#view{display:grid}`.
    - `.page{grid-area:1/1; contain:layout style}`.
    - `.is-pending` keeps only `visibility:hidden; pointer-events:none`.
    - `.leaving` keeps only opacity, transform and `pointer-events:none`.
  - Fix in app.js: no `style.top` write in leave() (~280-284), and no `offsetTop` reads in routeTo (~358).
  - Exit motion: the old page leaves in place with `translateY(0→-6px)` over 220 ms `--ease-exit`. This fixes the 9 px downward drop.
  - Enter motion:
    - The new page's head actions and chips (`.page-head .btn, .page-head .actions, .chips, [data-enter]`) start at opacity 0.
    - They join enterItems with the lede, starting once the old page's opacity is below 0.3 (about 120 ms).
    - Acceptance: no frame where the two h1s' combined opacity exceeds 1.2, and nothing shows at full opacity on frame 0.
  - Utilities for tab owners: add `.cv{content-visibility:auto;contain-intrinsic-size:auto 320px}` and `.cv-row{…auto 56px}`. Keep `byline:routed` (app.js:327) as the signal for deferred work.
  - Targets: swap Layout <15 ms in a 4x trace; E1 <50 ms on every route, together with the tab owners' work.
- **S3. Dossier open** (E2 fails at 66–123 ms with 2 forced layouts; B, C, E).
  - Prebuild:
    - When `prefetch(id)` resolves, call `requestIdleCallback`.
    - In it, `build()` plus `fill(phase:'open')` into a hidden attached container at final width (`visibility:hidden; contain:strict`).
    - Measure the shared destination rects there and cache root and rects by id (LRU of 3).
  - `open()` appends the prebuilt root with 0 layout reads after insert (remove the dossier.js:130 read when cached) and starts the clip-path flight in the click frame.
  - Without a prebuild, fly at once with the placeholder; drop the 120 ms wait.
  - Call `afterFlight()` only after the flight's finished promise.
  - Targets: open and close <50 ms on desktop and phone at 4x; ≤1 forced layout per open; first motion ≤1 frame after the click.
- **S4. Flight compositing** (C, E blockers).
  - Panel fill:
    - `.dossier-fill` is opaque (≥0.94) from frame 1, independent of the scrim.
    - The scrim reaches ≥0.6 within 120 ms (`--ease-fade`).
    - Raise `--scrim` so the final wash is ≥0.7 in both themes (B).
  - Shared clones (title, ring, topic pill):
    - They live inside the panel's clipped layer, or take its current inset clip-path, so they never paint over the page h1.
    - The pill flies on the title's 600 ms `--ease-move` timing.
    - When the source is a `.score-chip`, cross-fade the ring in place over the first 40% of the flight.
  - Source tile:
    - Hide only its shared elements on frame 1, and fade the rest over 120 ms `--ease-exit`.
    - The source element stays in flow with `visibility:hidden` until the last close frame, never `display:none`. This fixes the 36 px Feed pop on close (C).
  - Body sections and the right-column card, border included, start at opacity 0 and enter with the section stagger.
  - Acceptance:
    - In a 30 fps capture, no page text appears inside the panel clip and no empty bordered box shows.
    - Open frame p95 ≤20 ms at 1x.
- **S5. Dossier close runs at about 10 fps** (E). In `close()`, set `.dossier-frost{display:none}` synchronously before any animation, and start the body fade and the clip in the same frame. Target: p95 ≤20 ms at 1x, and E2 close <50 ms at 4x.
- **S6. Dossier geometry and the rail** (user §0; B, C, D, E, F).
  - Desktop panel width: `min(1040px, 100vw − var(--rail-w) − 2*var(--shell-inset) − 160px)`. The left edge stays tied to `--rail-w`, and top and bottom stay aligned to the rail.
  - Target: ≥160 px of page visible to the right at 1440 with the rail expanded. On phone it stays a full sheet.
  - Put `.rail` above the dossier layer:
    - The rail stays undimmed.
    - `#rail-collapse` collapses it with one click, and the panel reflows.
    - A nav click closes the dossier, then routes.
  - While the dossier, ⌘K or a sheet is open, fade `#bg-light` to 0 over 240 ms and stop the tile-pool easing; restore both on close.
- **S7. Theme switch: light text on light tiles for about 300 ms** (B blocker; E perf).
  - In `html.theme-xfade`, transition `color` only on `:is(h1,h2,h3,h4,p,li,a,td,th,label,small,strong,[class*='-title'],[class*='-meta'])` with `--dur-theme`/`--ease-ambient`.
  - Remove `.chip, .tag, .eyebrow` from the multi-property list (shell.css:259). Swap them at the midpoint instead, using a `theme-mid` class set at 300 ms.
  - Acceptance: harness frames at 100, 300 and 500 ms all have text/surface contrast ≥3:1, and frame p95 ≤33 ms at 1x. If both can't hold, contrast wins and `--dur-theme` drops to 400 ms.

**P1: colour, field and slop**

- **S8. Quality ramp** (user §0; B, C, F).
  - Proof: q-0 #B4B8BF, q-1 #9399A6, q-2 #6B7790, q-3 #5B8BF7, q-4 #1F5EFF, q-5 #0B2E9E.
  - Night: q-0 #55595F, q-1 #69707F, q-2 #7E8BA3, q-3 #3E6CD6, q-4 #5A93FF, q-5 #A3C4FF.
  - quality.js: `D=[-30,-15,-1,0,10,25]`. qualityTier boundaries are unchanged (top ≥ T+15 keeps the glow).
  - components.css:159:
    - The clears chip tint goes from 14% to 18%.
    - `[data-q=strong]` gets 26%.
    - Below-bar chips get a 1.5 px outline in `var(--q)`.
  - Re-run test/contrast.test.js. q-3 must be ≥3:1 on the tile surface; if not, use #5585F2.
  - Acceptance:
    - Feed chips at 56, 60 and 64 read as three steps.
    - Today rings at 64, 72 and 78 have ΔE ≥8 between neighbours.
    - 44 and 14 are distinct.
- **S9. Ring gradient** (user §0; B, F).
  - In ui.js scoreRing and components.css:148, stroke `.ring-arc` with a per-ring SVG linearGradient. Give it a unique id and `userSpaceOnUse`, oriented from the arc start to the arc end.
  - Colours run from qualityColor(threshold) to qualityColor(score). Below-bar rings stay single slate. No tick, no bar.
  - The count-up drives the dashoffset and the end-stop colour on the same progress.
  - The ring caption (qualityLabel) stays at opacity 0 until the count-up ends (F).
  - Repaint on `byline:theme`.
- **S10. Mono caps out of tags and labels** (F, C; DECISIONS).
  - `.tag`, `.section-label` and `.divider-label` become Geist 12/16, wght 500, `text-transform:none`, letter-spacing 0, keeping their borders and tones.
  - Mono caps remain only on `.eyebrow`, `th` and rail group labels.
  - Tab owners will sentence-case any hard-coded uppercase strings.
- **S11. Numeric table heads** (C, D, F). Add `.table th.num{font-size:var(--fs-label);letter-spacing:var(--tr-label)}` and keep 13 px only on `td.num`.
- **S12. Hover** (B, E).
  - Proof: `--hover-wash .05`, `--hover-spot .10`, `--hover-line .34`. Night: `--hover-spot .14`.
  - Delete the app.js:422-428 `--mx/--my` pointermove writer. `.tile::after` becomes a fixed radial at 50% 0%.
  - Keep the 240/360 ms timing.
  - Targets: 0 style recalcs per pointermove inside a tile; hovered vs resting tile ΔE ≥3 in Proof.
- **S13. Field**
  - (a) Seam (B, C, E):
    - Set `#bg{max-width:none}` and size it explicitly to innerWidth × innerHeight in px.
    - The backing store is `round(innerWidth×scale)`, with the same W sent to bg2d-worker.
    - Acceptance: `getBoundingClientRect().width === innerWidth` and `stats().backing.w === round(innerWidth×scale)` on every route and theme. Add this to E9.
  - (b) Text band (D, E):
    - Pass the `.page-head` rect as a uniform (like the rail rect), updated only on `byline:routed` and by ResizeObserver.
    - Inside it, dash alpha is ×0.35 with a 48 px feather. The 2D fallback does the same.
    - Target: dash contrast under the h1 and lede <1.15:1 against `--bg`.
  - (c) Night `--fd-amax` .15 → .10 (E).
  - (d) Stronger light reaction (B):
    - Proof `--fd-glow .075`, `--fd-pool .10`; Night `--fd-glow .11`, `--fd-pool .13`.
    - Dashes within 160 px of the pointer gain +0.08 alpha over `--fd-amax` and mix 35% toward `--fd-hot` with a smoothstep falloff, in both the shader and the 2D path.
    - Acceptance: the pointer is locatable from a still frame at full intensity and invisible at dim.
  - Report which render path the harness ran, and capture the WebGL path once with a swiftshader/ANGLE flag.
- **S14. Rail logo** (D; ruling 8).
  - In the rail lockup and the collapsed rail: strokes only at 26 px, b and y in ink, and the descender/underline stroke in `--accent`.
  - The filled tile stays for the favicon, PWA and apple-touch icons.
- **S15. Topbar backing** (C, D).
  - A fixed `.topbar::before`, 72 px tall: `linear-gradient(var(--bg) 55%, transparent)`, `pointer-events:none`, below the pill.
  - Show it when `scrollY>8` with a 240 ms opacity fade, from a passive, rAF-throttled listener that writes only on change.
  - No backdrop-filter.
- **S16. Status pill** (B, D, E, F).
  - At ≤600 px, render a short form: `No. 1 · ● 6:28 PM · 19 ranked · 7 above 55`. Drop the date and zero-valued segments, and drop `No. N` too if the pill still overflows at 360 px. Never clip a number.
  - CLS (E): reserve `.pill-text` min-width in ch, and paint from the last cached status before the fetch.
  - Target: CLS ≤0.005 per route; then tighten E3 to 0.01.
- **S17. Server data for tab owners**
  - (a) `/api/status` `counts.in_review` and `counts.drafts_open`, for Today (F blocker).
  - (b) `/api/map` `hot_topics[]` and `clusters[]` add `in_count` (stories carrying the topic anywhere) beside `count` (main topic).
  - (c) Nodes get a `short_title`: the text before the first ':', ' — ' or ',' when that is ≥20 characters, with the `org/` repo prefix stripped.
  - (d) src/finding.js (F):
    - SIGNAL_MAP gains `standard→'a standard'` and `cost→'cost or pricing'`.
    - The boilerplate regex gains `/^today,? we(?:'|’)?re|^today,? we are (announcing|introducing|launching|excited)/i` and `/^we are expanding our partnership/i`.
    - Drop the `Independent check: ` prefix when the claim already starts with "Independent".
  - (e) Expose `summary_is_boilerplate` on `/api/stories/:id` articles.
  - (f) Router: `#/draft/*` routes get `data-bg="still"`.
  - Tests for each.
- **S18. Harness additions** (perf.mjs/motion.mjs; E, B, C):
  - rail-collapse frame p95 at 4x on Today and with the dossier open (≤50 ms)
  - dossier close frame p95 at 1x (≤20 ms)
  - forced layouts per dossier open ≤1
  - `#bg` width equals the viewport
  - permanent will-change ≤4 on all 16 routes
  - theme-switch contrast frames
  - flight overlap: no page text box intersects panel text on any sampled frame
  - a `deadInterior` helper: per `.tile`, unused height under the last child ≤32 px at 1440×900 and 1280×800, reported per route

Acceptance: `npm test` is green, and every gate in `node test/e2e/run.mjs` passes, including E1, E2, E3, E9 and E11. Provide Today captures in Proof and Night with the pointer, a dossier flight frame sheet, and theme-switch frames.

### 2. feed-dossier (dossier 84.8 → 90, feed; E2 split)

Files: public/js/views/feed.js, story-dossier.js, css/v4/feed.css, dossier.css.

What to expect from shared:
- The panel is ≤1040 px wide, and `.rail` sits above it.
- dossier.js may call `renderDossier(body,{id,data,phase:'open'})` during an idle prebuild into a hidden attached container. The render must therefore be idempotent, do no layout reads, and not depend on visibility. `afterFlight()` is called after the flight lands.
- The ring gradient and caption come from ui.js.
- `.tag` is sentence case: replace any hard-coded uppercase strings.
- New utilities and data: `.cv`/`.cv-row`, `byline:routed`, and `summary_is_boilerplate` on articles.
- The source row is kept in flow by shared.

- **D1. E2, progressive render** (B, C, E blocker).
  - The `phase:'open'` markup renders only:
    - the header (eyebrow, title, finding dek, ring, pills, actions, sources line)
    - Why it ranked plus the breakdown
    - the first two source cards
  - Everything else (remaining cards, Evidence, Lens, Employer connections, Make/drafts, Tune) renders in `afterFlight`:
    - one section per requestIdleCallback chunk, ≤8 ms each (`timeRemaining`, with a setTimeout fallback)
    - aborted if `body._dx` changes
  - Remove the `getBoundingClientRect` in the layoutObserver balancing step. Observe the movable sections with the same ResizeObserver and use their entry sizes.
  - Bars animate only after the flight.
  - Target: with shared S3, E2 <50 ms and ≤1 forced layout per open on phone.
- **D2. Layout at the new width** (D, B).
  - Two balanced columns (7/5) inside 1040 px.
  - The close button is absolute at top 16, right 16, with symmetric 36/36 padding. Right-align the header meta to the body grid.
  - Both columns are flat. The right column has a 1 px `--line` left border and 32 px left padding, and no tile only on one side.
  - The scrolling `.dossier-body` gets `mask-image:linear-gradient(to bottom,#000 calc(100% - 28px),transparent)` plus 32 px bottom padding.
  - Target: ≤2 screens at 1440×900.
- **D3. Employer connections** (B, C, D, F).
  - A full card only for employers the sources name directly.
  - The rest collapse into one row: "Topical overlap only, not named:" followed by company chips. The caveat appears once at the section foot.
  - A quote shared by several employers is shown once.
  - De-duplicate topic hits case-insensitively ("AI adoption, AI adoption").
  - At most 3 full rows, plus "Show N more".
- **D4. Redundancy** (F, D).
  - Drop the ■ glyph row beside SOURCES in the header.
  - "6 posts · 1 outlet · 0 independent" appears once, in the fact strip. Drop the section-head count and the repeated summary sentence.
  - Skip any claim that equals the dek.
  - Cards whose summary is boilerplate show their best claim, or else the title only.
  - Evidence shows the top 3 priority matches plus "+N more".
- **D5. Checkable numbers** (C).
  - At most 4. Each number is highlighted inside its claim fragment (about ±8 words), with the source domain in `--text-3`.
  - Drop the row when no fragment is available.
- **D6. Precision** (ruling 9). The breakdown's "over your bar" is the integer `round(score) − threshold`. The sum row keeps its decimal ("77.8 → 78").

Feed:
- **F1. Glyph legend** (B, C, D, F).
  - Add a legend in the list header: `■ first-party · ◆ independent · ○ commentary/community`, 12 px `--text-3`.
  - Each row's strip becomes one glyph per kind present, followed by its count (`■ 6`, or `■ 4 ◆ 1 ○ 2`), with an aria-label/title such as "4 first-party, 1 independent, 2 commentary".
- **F2. Finding clamp** (F). Clamp the finding at 2 lines, or 3 if the clamp would cut inside a `<mark>`.
- **F3. List ending** (C, D). Remove the list's min-height and bottom padding so the card ends 16 px after the last row. The date gets a fixed 64 px column after the meta.
- **F4. "replys" typo** (F). Map the keys explicitly: `{reply_count:'replies', like_count:'likes', retweet_count:'reposts', quote_count:'quotes'}`.
- **F5. Filter-click pop** (E).
  - Delete the h1 flash at feed.js:268.
  - Wrap the headline and one-liner figures in `<b>`. On repaint, fade only the changed `<b>` from 0 to 1 over 240 ms (`EASE.fade`).
  - Target: no opacity drop >0.35 per frame.
- **F6. Feed tab-in** (78–81 ms; E).
  - Render the first 12 rows synchronously and the rest in one idle chunk after `byline:routed`, with `.cv-row` on below-fold rows.
  - Cap the enterItems stagger at 8 items and animate the list container for the rest.
- **F7. Chip colours.** No local quality-colour overrides on chips, so the new ramp shows.

Acceptance:
- E1 on `#/feed` <50 ms, and E2 passes.
- Captures: Feed at 1440 (legend, no empty band), dossier at 1440 with the rail expanded (≥160 px of page on the right, ≤2 screens, one employer quote), and a filter-click frame sheet.

### 3. today (86.2 → 90)

Files: public/js/views/today.js, css/v4/today.css.

What to expect from shared:
- `/api/status` `counts.in_review` and `counts.drafts_open`
- `/api/map` `hot_topics[].in_count`
- the ring gradient, with the caption hidden until the count-up ends
- sentence-case `.tag`, `.cv` and `byline:routed`
- the `deadInterior` harness check

- **T1. Row 3 dead space** (blocker; B, C, D, F).
  - Move the third secondary story (the 62 tile) out of row 3, into the secondary stack under the other two or into "Also in the brief", sized by importance.
  - Row 3 becomes This week (7 columns, with the 7-day strip and Suggested side by side) plus Waiting on you (5 columns), with `align-items:start`.
  - Give `.td-open` `position:relative; z-index:2` so it gets its own hover.
  - Acceptance: no tile has >32 px unused below its last element at 1440×900 or 1280×800.
- **T2. Lead tile** (D, E).
  - `grid-template-columns:1fr auto`, with the ring at `grid-row:1/3`. The dek sits ≤24 px under the title.
  - At ≤480 px, show a 64 px ring inline with the topic pills so the title gets the full width.
- **T3. Waiting on you** (data-honesty blocker; F).
  - The label reads "1 in review · 21 open drafts", from `counts.in_review` and `counts.drafts_open`.
  - If those counts are missing, count statuses from the list and say "of the 12 most recent".
  - List in-review groups first, and keep "All drafts →".
- **T4. Load order** (C, E, F).
  - The lede starts at h1 line-2 start + 120 ms (about 450 ms).
  - The run strip, "Run today's workflow", `···` and the amber banner fade in with the lede (450 ms `--ease-fade`, 6 px rise; banner +90 ms).
  - The tile cascade starts at lede start + 200 ms.
  - Nothing is visible before the h1 starts.
- **T5. Animation count** (E).
  - Replace the per-`<circle>` mini-map animations (today.js:500) and the per-dot weather animations (492-497) with one opacity+transform animation per group: `.td-map-nodes`, `.td-map-edges` and each `.td-wx-row`, with a 40 ms stagger.
  - Targets: ≤30 Animation objects on load; E1 Today <50 ms at 4x.
- **T6. Mini map** (D, F).
  - Fit the node bounds with 12% padding, show ≤3 collision-free region labels, and cap the canvas height so no empty band remains.
  - Hot rows read `{topic} — leads {count}, in {in_count}`. Drop "· N this week" when it equals the count.
  - Remove the unlabelled meter, or label it "Heat" visibly.
- **T7. Weather sentence** (F).
  - No "run hot" wording. Write: "Agent orchestration and AI governance are in half or more of the 7 stories above your bar; Analytics is in none."
  - Use the chart's own counts, and exclude weight ≤1 topics from the sentence while keeping their chart rows.
- **T8. Labels and hover** (C).
  - `.td-label` becomes Geist 12.5/560, sentence case, `--text-2`; mono caps stay only on the page eyebrow.
  - Remove the tile-title hover underline.

Acceptance: captures in Proof and Night at 1440, 1280 and 390; a load frame sheet from 0 to 1500 ms; E1; and the `deadInterior` check.

### 4. career-publish (performance 75.2, career 77.8, employers 79.6, campaigns 81.8, people 84 → 85)

Files: public/js/views/{campaigns,performance,career,employers,people}.js and their css/v4 files.

What to expect from shared: the `th.num` size fix, sentence-case `.tag` (replace hard-coded uppercase strings), `.cv-row` and `deadInterior`.

- **P1. Performance** (blocker; B, C, D, E, F).
  - Row 1, full width: the "On the way to publishing" funnel (real status counts). Beside it, a 14-day draft activity strip (drafts created and moved to review per day, from real draft timestamps). If the timestamps aren't in the API, omit the strip rather than estimate.
  - Row 2, left: "Closest to publishing", the top 3 drafts ordered approved > in_review > draft, then by updated_at, each with its status tag and the next open slot from `/api/calendar` if one exists. Add a "drafts by channel" line.
  - Row 2, right: the Import CSV card inside a `<details>`, with "What will be tracked" inside it.
  - CSV placeholder: `draft_id,impressions,reactions,comments` / `<id>,<number>,<number>,<number>`, with no sample numbers.
  - Acceptance: the columns end within 40 px of each other at 1440×900, and no white block is taller than one tile row.
- **P2. Career** (blocker; C, D, F, B).
  - Make `headline()` name the same skill in the headline and the one-liner, chosen as the top skill by weighted mentions. For example:
    - H: "Agents leads your skill radar: 10 mentions this week."
    - L: "In 1 of 1 saved job post (7 identical copies counted once). AI governance came up on 3 days, only in job posts."
  - Keep the fallbacks.
  - With no history (no articles older than a week):
    - Drop the per-row NEW THIS WEEK tags.
    - Put "Trend needs 2+ weeks of history" once in the Trend head.
    - Hide "This week" while it equals "Source mentions" on every row.
  - Skill column: min-width 200 px, nowrap.
  - Meters use neutral ink (`--text-3` at 60% on `--track`), not `--accent`.
  - Saved job posts: render the unique post (title, employer, saved date, Demo tag, ×7 copies tag), never an empty box.
  - Replace the 0/0 KPI with "No experiences yet · Add one", or drop it.
  - The right column is `position:sticky; top:72px; align-self:start`.
- **P3. Employers** (B, C, D, E, F).
  - With 3 or more ties, the headline reads "4 employers tie for the lead with 2 stories each." and the names move to the one-liner.
  - Hide the People column while every value is 0.
  - Pin and Unpin are both bordered secondary sm buttons.
  - Coverage bars use neutral ink.
- **P4. Campaigns** (C, D, E).
  - The right column is sticky at top 72.
  - "How approvals work" becomes a one-line footer with a link.
  - Each row's "Start campaign" becomes a ghost button revealed on hover or focus-within, always visible at ≤760 px and on touch.
  - Add a summary computed from the list (e.g. "7 stories above 55 could anchor a campaign; 3 already have drafts").
- **P5. People** (D, F).
  - The Person column is 34% wide.
  - Drop the repeated "(do not contact)" under Next step.
  - Rows are 2–3 lines at 1440, and the right column is sticky.
- **P6. Performance gate.** Tables over 20 rows use `.cv-row`; cap enterItems at 8; E1 <50 ms on these routes.

Acceptance: captures at 1440×900 and 390 for each tab, plus the `deadInterior` check.

### 5. calendar-studio (studio 79.6, calendar 83 → 85)

Files: public/js/views/{calendar,studio}.js (plus their draft sub-view module) and css/v4/{calendar,studio}.css.

What to expect from shared: `#/draft/*` gets `data-bg="still"`, plus sentence-case `.tag`, `.cv` and `byline:routed`.

- **C1. Studio as a workshop** (B, C, D, F).
  - Lead with the newest in-review draft as a large writing-surface card:
    - its Newsreader title
    - a 3-line preview in Newsreader 18/1.65
    - the approval checklist, from existing data only
    - "Open draft"
  - The grouped list follows, with the chip rows reduced to one compact filter bar.
  - Rows:
    - Titles wrap to 2 lines.
    - Drop the visible `#24` IDs (keep them in aria/title).
    - Show a date only when one is planned; otherwise a hover/focus "Plan" ghost action.
    - Show the angle only when it differs from the group's, labelled "Angle: …".
  - The right column is sticky at top 72.
- **C2. Draft view** (C, D, F).
  - Editor measure 680–720 px, Newsreader 18/1.65.
  - Format, Angle and Regenerate sit in one compact toolbar row.
  - The tab strip scrolls horizontally with a 16 px fade mask, so "History" is never clipped.
  - The review panel body is `max-height:calc(100dvh - 96px); overflow:auto`.
  - Consecutive identical perspective paragraphs collapse in the display with a "repeated note ×3" marker. Never modify the stored text.
- **C3. Draft tab-in** (83 ms; E). Run the section enterItems on `byline:routed`, cap it at 6, and put `.cv` on every `.st-sec` after the first two.
- **K1. Calendar tab-in** (121 ms with 7 ms forced; E).
  - Run the chip enterItems and fillTray after `byline:routed` plus one frame.
  - Cap the stagger at 12, with one animation per `.cal-week` row.
  - Remove fillTray's layout reads, or batch them before any write.
  - Target: <50 ms at 4x and 0 ms forced.
- **K2. Colour** (B).
  - Open-slot chips are `--line-3` dashed with `--text-3` text, turning blue only on hover or drag-over.
  - The past-day wash becomes `--tint-1`.
- **K3. Month markers** (C). Show "2 stories" in `--text-3` plus up to 5 dots coloured by qualityColor, with a title listing the stories.
- **K4. Week view** (C, F).
  - Each story is a block: a score chip on line 1, then the title clamped to 2 lines at full cell width.
  - Empty POSTS and OUTREACH lanes collapse to a 28 px "No posts planned" row, and the Stories lane takes the freed height.
- **K5. Details** (D).
  - Chips truncate only after 14 characters, with the full name in a title.
  - The day hint wraps to 2 lines.
  - Use `var(--r-tag)`/`var(--r-ctl)` instead of the literal 6 px radii.

Acceptance: captures of Studio, draft/1, and the Calendar month and week views at 1440; E1. Don't click run, approve, publish or schedule paths.

### 6. search-system (settings 82, sources 84.6 → 85; search, runs)

Files: public/js/views/{search,sources,settings,runs}.js and css/v4/{search,sources,settings,runs}.css.

What to expect from shared: sentence-case `.tag`, `.cv-row`, and the `th.num` fix.

Settings:
- **G1. Sliders** (B; ruling 10). A neutral `--line-3` fill, with a blue thumb only on hover or focus. Negative weights get a `--warn` thumb plus their text value.
- **G2. Save buttons** (F). Each section's Save is secondary until that section is dirty.
- **G3. Page length** (all five critics flagged it).
  - Put Writing, Publishing and System behind disclosures. They expand on click, or when the section nav or a hash targets them.
  - Keep the source-health summary at the top.
  - Target: about 3,500 px by default at 1440.
- **G4. Nav highlight** (C). Drive it with an IntersectionObserver on `.sg-sec`, `rootMargin '-80px 0px -60% 0px'`, picking the topmost intersecting section.

Sources:
- **R1. Health** (B, F).
  - A 7 px health dot before the state label (`--ok`, `--warn`, `--err`, or neutral for paused).
  - "was failing" in `--err-text`, with last_error as its title.
- **R2. Demo rows** (C, D, F).
  - When is_demo, strip the "DEMO · " prefix from the displayed name.
  - Keep the Demo tag inline with nowrap on the URL line.
  - Fixed 56 px rows, and a muted "demo" in the Sync cell.
- **R3. Stat row** (F).
  - Replace the four zeros with one state cell: "All 26 paused · 0 collecting", plus 48 articles (7 d) and 9 demo.
  - Hide the 7D column while it equals TOTAL on every row.

Search:
- **Q1. Grouping** (C, F).
  - Group draft results by story: the title once, channel chips, the count and the newest edit.
  - Collapse identical notes into one row with "×2".
- **Q2. Zero-count chips** (D, F). Hide quick chips with 0 matches, or show them muted, non-interactive and last.
- **Q3. Refine** (D, F). Remove the Refine underline bars, keep the counts, and align the Refine tile top with the first results header.
- **Q4. Typing pops and idle cost** (E).
  - Delete the h1 0.35 flash (search.js:336) and use the changed-figure fade.
  - Debounce the headline by 200 ms after the last keystroke.
  - Stop the timer that runs while idle. Target: idle task time <5 ms per 3 s.

Runs:
- **U1.** Runs that read 0 sources show "Done · 0 sources read" in amber or neutral, not a green check (B, F).
- **U2.** All column heads use one style, mono caps `th` (F).

Performance: put `.cv-row` on long tables and build Sources' expandable row content lazily; E1 <50 ms on these routes.

Acceptance: captures of Settings (default height), Sources, Search browse and query states, and Runs.

### 7. map (82.6 → 85)

Files: public/js/views/map.js, public/js/map-engine.js, public/css/v4/map.css.

What to expect from shared: `in_count` on `hot_topics` and `clusters`, `short_title` on nodes, the new quality ramp (applied automatically through qualityColor), and `byline:routed`.

- **M1. Top-3 labels** (blocker; B, C, D, F).
  - The top-3 hot-topic region labels are always visible at the default view, in both themes and at 390 px. Today "Agent orchestration" and "Business adoption" sit at opacity 0.
  - Place them first (map-engine.js ~985-1009), then cull or nudge node labels around them.
  - Anchor each region label at the top-centre of its hull.
- **M2. Counts** (F).
  - Canvas region labels read `{topic} · leads {count}`, or carry no number.
  - The side panel reads "Leads 6 · in 10", adding "N this week" only when it differs.
- **M3. Initial view** (B, D). Fit the initial camera to the node bounding box with 48 px padding, so no quadrant is empty at 1440×900.
- **M4. Sizing** (B, D, F).
  - The tile and side panel are `calc(100dvh - tileTop - 12px)` tall, minimum 520 px.
  - The panel is `overflow:auto` with a 28 px bottom fade, so nothing clips.
- **M5. Node labels, sizes and hulls** (C, D).
  - Label only nodes at or above the threshold, plus hovered and selected ones, using `short_title`.
  - Run a collision pass that drops labels overlapping another label or a node with r≥6.
  - Map node radius to 8–22 px by score.
  - Draw a hull or contour for every topic at 0.06–0.10 fill.
- **M6. One-liner** (F). Use the bridge story's short title, not a mid-phrase truncation, and name the edge types it bridges.
- **M7. Performance** (E).
  - Remove the static `will-change` on `.map-canvas` (×2, map.css:248) and on the label layers (map.css:45). Set it from JS on pointerdown or wheel, clear it 300 ms after the camera settles, and set it during the 240 ms list/graph swap.
  - Defer the first full draw (map-engine.js:87) to requestIdleCallback after `byline:routed`, painting the cached low-res canvas first.
  - Targets: ≤4 permanent will-change at rest; tab-in <50 ms at 4x; E10 passes.

Acceptance: default-view captures at 1440×900 in Proof and Night and at 390, with the top 3 labelled and nothing clipped; E1 and E10.
