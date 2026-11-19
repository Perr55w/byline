# v4 decisions: the council's round 0, consolidated

Read with `SPEC-v4.md`. Where they conflict, **this file wins**. Full critic reports are in `docs/design/council-v4/round0-*.md`, and builders should read the ones for their area. This file records each decision and settles the cases where critics disagreed.

## Data honesty (F, binding everywhere)
- **Threshold.** Always `settings.publish_threshold`, which is **55** in the current DB. Never hard-code 60.
- **Mockup data.** `docs/mockups-v4/data.js` has made-up values. Don't copy any of them.
- **Source vocabulary:**
  - *post* = an article
  - *outlet* = a distinct domain
  - *first-party* = `announcement`
  - *independent* = `reporting` or `research` on a domain other than the origin's
  - *commentary* / *community* / *release notes* = everything else
  - The phrase "credible independent source(s)" is banned. Story 16 reads "6 posts · 1 outlet · 0 independent".
- **Run wording.** Say "ranked", not "scanned". The issue number is the count of briefs up to that date; if that's awkward, drop "No." entirely. Times are shown in `settings.timezone`.
- **Surfacing data problems.** Show the state honestly in the UI:
  - all sources paused
  - schedule off
  - the brief is from yesterday
  - demo rows (with a visible **Demo** tag)
  - duplicate demo job posts
  - one site posting six times
- **Headline topic.** Choose it by `count × priority weight`. "Machine learning" (weight ≤ 1) never wins.
- **Headlines and one-liners.** Use F's per-tab templates (F report §2) verbatim, including the fallbacks. "Is running hot" is only allowed when history supports it.
- **The finding line.** `findingLine()` (F amendment 3) is computed **on the server** as `story.finding` and used by Today tiles, Feed, Map cards, Search and the dossier dek. Never use a boilerplate `summary` as the dek.

## Identity
- **Logo: B's "by—line".** The mark spells "by", and the y's descender becomes the underline, which is the line in "byline".
  - Geometry, 64-grid tile, `rx` 15, stroke 5.5 round:
    - b stem `M15 11 V37`
    - b bowl circle (22.5, 30.5) r 7.5
    - y arm `M36 23 L43.5 38`
    - y arm, descender and underline `M51 23 L41 45 Q38.6 50.5 33 50.5 H13`
  - Favicon: stroke 6.5, `rx` 13.
  - App icon: white strokes on a `#1F5EFF` tile.
  - Rail: the mark drawn in `currentColor` strokes on a small accent tile, or strokes only. The builder chooses whichever reads best at 26 px in both themes.
  - Lockup: the mark plus "Byline" set in Newsreader 23, opsz 36, wght 560.
  - On first load the underline draws leftward over 700 ms. Skip this under reduced motion.
  - D's nib concept is rejected; B's render showed the nib reads as a generic pen tool.
- **Colour tokens: B §1, verbatim.** These are AA-checked. Every mockup's text-3 failed AA.
  - Proof `--bg #F5F6F8`, `--accent #1F5EFF`, `--accent-text #1A50E0`.
  - Night `--bg #121316`, `--accent #4D86FF`, `--accent-text #8AB0FF`, `--accent-fill #2F6BF0` (primary buttons).
- **Quality ramp: B §2**, using the `--q-0…5` stops, `qualityColor()`, `qualityTier()`, `qualityLabel()` and the non-colour cues.
  - The function lives in `public/js/quality.js`.
  - The inline computed `--q` is the only literal colour allowed outside `tokens.css`.
  - The threshold argument always comes from settings.
- **Blue budget: B amendment 2.**
- **Surfaces, radii, buttons, inputs, chips, tables, sheets and toasts: D §2.** Exceptions:
  - Radius cap (C): rail and dossier **16**, tiles **12**, controls **8**, tags **5**, chips **999**.
  - Glass placement and values follow **B §4**. Tiles are never glass.
- **Type: F §1.** Newsreader, Geist and Geist Mono, self-hosted. The role scale is verbatim.
  - Score maths, arrows and status dots are set in Geist, never Newsreader; its subset lacks those glyphs.
  - The ⌘ glyph comes from SVG or a system font.
  - Uppercase mono is for eyebrows, column heads and rail group names only. No middot eyebrows stacked on every block (C slop #9).
- **Default theme: Proof.** Night is the alternative. The theme switch is a segmented control in the rail footer. It cross-fades colour properties on token surfaces only (B amendment 4 / D), over `--dur-theme` 600 ms. No wipe, and no `transition: … !important` on `*`.

## Shell
- **Rail: D §1 dimensions.** Floating glass panel, inset 12, expanded 232 / collapsed 64.
  - Collapsed rhythm: group rows shrink from 24 px to 4 px and show 16 px hairlines, so the pitch is 36 within a group and 44 across groups.
  - A Playwright assertion checks this (D's rhythm assertion).
  - Icons: D's table (sunrise, ranked list, constellation…), hand-written inline SVG at a 1.5 px stroke.
  - Groups: **Briefing** (Today, Feed, Map, Search) · **Publish** (Studio, Calendar, Campaigns, Performance) · **Career** (Career, Employers, People) · **System** (Sources, Runs, Settings).
  - "People" everywhere; no "Next edition" footer.
- **Rail width and dossier coupling.** A registered `@property --rail-w`, transitioned with `--dur-layout` 420 ms and `--ease-move` (C §3), drives the rail width, the `.main` padding and the dossier `left`. A test asserts `dossier.left ≥ rail.right` on every sampled frame.
- **Layout grid and page head: D §3.**
- **Status pill.**
  - Glass-strong, sticky.
  - Wording (F): "No. N · Wed 18 Nov · ● Ran 6:28 PM · 0 new · 19 ranked · 7 above 55".
  - The dot is static (C), amber when the run read 0 sources.
  - There is no unlabelled sparkline. If one is shown, it's labelled "Scores of 19 ranked stories".
- **⌘K Index: F amendment 5.**

## Background: B's "ruled field"
- **Base: B §3, verbatim.**
  - Rows of short typeset dashes move like satin, using three sines plus ripples.
  - The pointer light gives a sheen.
  - Heat modulates the field.
  - A tile-hover pool.
  - Per-view intensity follows B's table.
- **Pacing.** Half rate means rendering every second rAF, never a timestamp gate (B and C agree). Smoothing is frame-rate independent. No per-frame noise. Idle freeze eases in and out. Pause when hidden.
- **C's isobar idea is taken up on the Map tab only.** Soft contour lines mark topic regions there; the global field stays the ruled field. The Map's cluster centres are the ripple sources.
- **Blue coverage.** Blue covers at most 25% of the viewport.
- **Prototype.** `docs/design/council-v4/B-field-prototype.html` (3.1 ms per frame) is the starting point.

## Motion: C §1–4, verbatim
- **Easing.** Use C's tokens. **`cubic-bezier(.16,1,.3,1)` is banned app-wide.** D's 460 ms expo rail becomes 420 ms `--ease-move`.
- **Heading entrance: "Settle"** (C §1). Lines are split while preserving inline markup, with `nowrap` and per-property curves. The opsz, weight and tracking morph applies to the page h1 only. There is a tab variant at 600 ms.
- **Today choreography: C §2.**
- **Tab switch and dossier open/close: C §3.**
  - FLIP on transform and clip-path.
  - The title, ring and main topic pill are shared elements.
  - Interruptible, with no busy flags.
- **Skeleton.** Shown only if data takes longer than 120 ms. Hold it at least 320 ms, breathe it on an 1800 ms sine, and crossfade over 240 ms. **No shimmer** (C overrides D's sheen).
- **Count-up.** `easeCount(t, k=4)`, with the ring fill and colour on the same progress. It runs once per session per value, and never in the dossier or on Feed chips.
- **Hover.** Lift −2 px, a hue tint (B `--hover-*`) and the pointer-light pool. 240 ms in, 360 ms out. No tilt, no scale.
- **Banned (C slop audit):**
  - gradient text
  - sheen sweeps
  - per-character splits and scan lines
  - blur on anything except the h1 lines
  - pulsing live dots
  - shimmer
- **Performance whitelist (C amendment 2).**
  - Animate transform, opacity and clip-path only.
  - filter, letter-spacing and font-variation-settings only on the page h1.
  - Never animate left, top, width or height, except the `--rail-w` custom property.
- **Motion helpers.** All live in `public/js/motion.js`: `enterHeading`, `enterItems`, `exitView`, `flip`, `countTo`.

## Server changes (owned by the server builder)
1. `pipeline.js` stores a structured breakdown (F amendment 2): `base`, `penalty`, `source_pref`, `newest_hours`, `priorities[]`, `watch_terms`, `impact_hits`, `signal_quotes`. Re-rank so the stored values reconcile with the score, and add a test.
2. `story.finding` uses F's `findingLine` rules: boilerplate filter, claim cleanup, number-highlight rules. Expose `finding` and the honest source counts `posts`, `outlets`, `first_party`, `independent` and `commentary` on `/api/stories`, `/api/stories/:id`, `/api/today` and `/api/search`.
3. Counts:
   - `/api/today` adds `ranked`, `cleared`, `topic_counts` (weighted) and `threshold`.
   - `/api/status` adds `claims`, `drafts_open`, `notes`, `briefs`, `sources_paused` and `schedule_enabled`.
4. `/api/search` returns stories with score, topics and `finding`, claims with the story title, and a new `contacts` type.
5. `/api/sources` adds `articles_7d`, `stories_count`, `last_article_at` and a computed `health` (ok, stale, error, paused). Add a new `GET /api/sources/:id/articles?limit=5`.
6. `/api/calendar` joins stories to return `score` and `story_id`. The calendar drag uses **`POST /api/drafts/:id/plan`**; `/schedule` is approval-gated and used only for approved drafts (D amendment 1).
7. A new `GET /api/map` in `src/routes/map.js` returns nodes and edges for all stories:
   - Nodes carry score, topics, companies, first_seen, finding and sources.
   - Edges come from shared companies, watchlist hits, sources and topics, with a weight.
   - The seeded layout is computed server-side and cached; E's engine notes apply.
8. Tests for every new or changed endpoint. `npm test` stays green.

## Pages
Each tab follows SPEC §5, and these reports refine it:
- Calendar and Sources follow D §5's sketches.
- The dossier follows D §5's layout and F §3's information architecture. F's ordering, wording and breakdown display are binding.
- Feed and Search rows follow F §4.
- Accessibility follows F §5 for every builder.

## Removed in v4
- The voice briefing: `player.js`, `player.css`, the Today slot and the TTS settings section.
- Newspaper-era effects: `fx/type.js` cast/flap/ink, the `fx/surface.js` halftone/newsprint/live screen, the stamps and spatter in `fx/micro.js`, the dither theme wipe, and the old CSS files.
- Glass hover tilt and the "Next edition" footer.

## Engineering (E, binding; overrides B and D where they conflict)

**Background engine** (`public/js/bg.js`)
- Use **B's look** (the ruled field of typeset dashes, satin waves, heat, ripples, sheen) on **E's engine**:
  - WebGL2 first, with `failIfMajorPerformanceCaveat:true`.
  - The shader draws the dash rows with a `fract`-based row and dash mask, three sines, a 64×40 R8 heat texture and a pointer-sheen uniform.
  - No noise/fbm and no derivative lighting.
  - Canvas2D fallback: B's bucketed implementation, maximum 20 fps; a static frame on phone.
- **Backing store.** Scale by min(DPR, 1.5), with at most 2.4 MP on desktop and 0.6 MP on phone.
- **Frame pacing.** Measure the refresh rate, draw every Nth frame (about 30 fps; about 20 when dim), and advance time by drawn frames × a fixed step.
  - Idle freeze after 20 s of no input: one settled frame, then zero rAF calls.
  - When input resumes, ease the speed back in over 600 ms.
  - Pause when the page is hidden.
  - Expose `window.__byline.bg.stats()` and `hold(ms)`, and support the `?bgidle=` query parameter.
- **Pointer light** has two parts:
  - The glow is a fixed `#bg-light` div moved with `translate3d`, so it runs at 60 fps on the compositor.
  - The subtle sheen is a shader uniform drawn at canvas rate.
  - The tile-hover pool eases `#bg-light` to the tile centre.
  - None of it appears on touch devices.
- **Per-view intensity.** `html[data-bg="full|dim|still"]`. Dim is canvas `opacity: .35` with a 600 ms transition. The engine only changes its draw rate; it does not tween per frame.

**Glass budget**
- **Two live `backdrop-filter` surfaces at most:** the status pill plus one transient surface (dossier, ⌘K, phone sheet or phone bottom bar). Three are allowed only for a modal over the dossier.
- **The rail is not backdrop-filtered.** It uses a translucent fill. The shader receives the rail rect as a uniform and draws the field softened (area-mean) inside it, which gives the frosted look for free.
- **Blur and saturation limits.** Blur ≤ 20 px and saturation ≤ 175%. Never animate blur.
- **Dossier frost** fades in on a child layer after the flight. The panel fill is 0.94 during the flight.
- **No other effects on tiles:**
  - no tilt
  - no `mix-blend-mode`
  - no `box-shadow` transitions; the hover shadow is a pre-rendered `::before` that fades its opacity.
- **will-change** is permanent on 4 elements or fewer. Otherwise JS sets it per animation.
- **Containment.** `contain: layout paint` on tiles, the panel and the pill. `content-visibility: auto` on long lists.

**Router**
- One forced layout per transition at most. Rail positions are cached.
- The tab switch is E §3 steps 1–6. Remove `startViewTransition` entirely.
- **The dossier is an overlay** (`dossier.open(id, srcEl)`), not a page swap.
  - A deep link renders Feed underneath it.
  - Prefetch on tile hover.
  - Use E's FLIP order.
  - Below-fold sections render after the flight.
- **`--rail-w`** is registered with `@property`, and both the shell grid and the dossier `left` read it. Canvases resize at `transitionend`.

**Map engine: E §4.**
- Server-side seeded force layout with an ETag cache, plus a localStorage client cache.
- Canvas2D on-demand draw.
- Hit-test grid, inertial zoom and pan, label culling, and a hidden DOM list for keyboard and screen-reader access.

**Performance gates: E §5 (gates 1–11)** are the acceptance tests for every builder. C's motion harness (C amendment 6) also runs. Put them together in `test/e2e/` as a Playwright script, run with `node test/e2e/run.mjs`, separately from `npm test`.

**Count-up.** Use `tabular-nums` in a fixed box and change only `textContent`. The ring uses `stroke-dashoffset`.
