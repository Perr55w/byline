# Council v4 · Round 1 · Critic B (colour, theme cohesion, ruled field, brand mark, quality ramp)

Build reviewed: branch `v4` HEAD `8eb8113`. Live on :4450, looked at in Playwright at 1440×900 and 390×844, Proof and Night, rail expanded and collapsed (including collapsing with the dossier open), hover, pointer light, theme switch, load entrance, frame diffs of the field. Captures are in `/tmp/claude-0/council-B-r1/` (deviceScaleFactor 1, plus a 3× logo crop).

Gate run (`node test/e2e/run.mjs --port 4460 --route today`): 17 of 18 pass. **E2 fails**: the dossier's open frame is 92 ms on desktop and 73 ms on phone (`Response.json.then`, 36–44 ms of it forced), and phone opens use 2 forced layouts. E8 (glass), E9 (backing store), E11 (rail rhythm), C-rules and F-contrast all pass. Only one live `backdrop-filter` was found at rest (the status pill). Collapsed rail pitch measured 36 px within a group and 44 px across groups, which matches DECISIONS. During the collapse the dossier gap stayed at 12 px on every frame.

Caveat: headless Chromium rejects WebGL2 under `failIfMajorPerformanceCaveat` (SwiftShader), so every field capture here comes from the **Canvas2D fallback**. The WebGL path still needs a check on real hardware.

## Rubric

| | score |
|---|---|
| unique_typography | 8 |
| color_cohesion | 7 |
| theme_cohesion | 8 |
| motion_cohesion | 8 |
| motion_smoothness | 7 |
| generic_typography | 2 |
| background_generic | 3 |
| color_combo_generic | 3 |
| motion_generic | 2 |
| ai_slop | 2 |
| **overall** | **37 / 50** |

**Verdict: not yet at the bar.** It misses on overall (37 < 38), color_cohesion (7), motion_smoothness (7), background_generic (3) and color_combo_generic (3).

Why color_cohesion is 7: in practice the quality ramp shows three flat tiers rather than a gradient. Feed chips 56–64 render the same light blue, and 44 and 14 render the same grey outline. Blue is also spent on non-quality meters (Career radar, Employers coverage, 11 Settings sliders, "open slot" chips), which weakens "blue = cleared your bar".

Why theme_cohesion is 8 and not higher: both themes are well built, but the theme switch has a visible illegible frame. About 100 ms after clicking, titles are already near-white while the tiles are still light. Surfaces cross-fade over 600 ms, but text elements that set their own `color` flip instantly.

Why background_generic is 3: the ruled field is ours and it does read as "typeset rules". At rest, though, it looks like a static dashed notebook grid. The pointer light is a faint wash (very faint in Night), and the dashes barely react to it, so the field never earns the "light reaction" the user asked for. Frame diffs show continuous but tiny motion: about 3% of pixels change by more than 4 levels per 0.5 s.

Why color_combo_generic is 3: white, electric blue and graphite is the default SaaS palette. Only the amber status band adds warmth. The fix is not a new hue. It is making blue rarer and more meaningful, so that each blue mark carries information.

## Per-tab scores (user-style, /100)

| tab | score | why |
|---|---|---|
| rail | 88 | Even collapsed rhythm (36/44 measured), clear group names, sliding highlight, and the by—line mark reads at 26 px in both themes. Footer is clean. Holding it back: on phone the status pill truncates after "0 new". |
| today | 87 | Informative headline and numeric one-liner, a weather chart with a legend, a mini map with the top 3, honest "collection off" band. Under 90 because the ring is a single flat colour, not the quality gradient the user asked for. The secondary tile (62) has about 90 px of dead space. The light reaction is barely visible. |
| dossier | 86 | Aligns to the rail, adapts on collapse, and "What the sources say", the evidence groups and the weighted breakdown are all excellent. Losses: 92 ms open jank (E2), clipped panel text next to legible page text in the 12 px bottom inset, the pointer glow showing through the frost as a blue blob, employer connections repeating one quote three times, and a panel that fills the whole content width. |
| feed | 86 | Size step from headline to meta, top-two topics, independent counts, threshold divider, a field that stays out of the way. The ramp collapses into three flat tiers, and the ■◆○ source glyphs have no legend on this page. |
| map | 82 | A real, clickable graph with a top-3 list. **The two hottest topic labels (Agent orchestration, Business adoption) are hidden (opacity 0)**, so the main regions are unlabelled. The top-left quadrant is empty, and the side panel text is clipped at the bottom at 1440×900. |
| search | 85 | Big bar, quick chips by type, useful grouped results with highlighted numbers. The refine column is heavy and colourless next to the results. |
| studio | 80 | Functional and dense, but it reads as another list page rather than the "distinct workshop space" in SPEC. Nothing about it feels like a writing surface until you open a draft. |
| calendar | 82 | Month grid, no day/date gap, tray, cadence. Five dashed blue "open slot" chips add blue noise to an empty month. Past days carry a grey wash that competes with the today highlight. |
| campaigns | 83 | Data headline and a useful anchor list. The right column is thin. |
| performance | 76 | Honest, but the page is mostly empty. The tracked-metric chips and CSV box don't make up for the missing content. |
| career | 80 | Strong headline and duplicate-post warning. Accent-blue meters on the skill radar mean "mentions", not quality. The saved job posts panel is an empty white box. |
| employers | 80 | Coverage table works. The h1 runs to three lines ("AWS, Google (other teams), Google Cloud and Google DeepMind lead…") and coverage bars are accent blue. |
| people | 84 | Overdue tags, duplicate warning, do-not-contact states, pipeline in neutral ink (the right choice). Dense and honest. |
| sources | 84 | Rich summary header with before/after health bar, expandable rows. The table's health column is monochrome; "was failing" is grey, not error-toned. |
| runs | 85 | Clear stages, cost controls, history. A green "done" on runs that read 0 sources is accurate but reads as more success than it was. |
| settings | 82 | Well sectioned with honest status. 11 solid-blue slider fills are the biggest blue block in the app. The page is 7,200 px long. |

## Fixes (ranked by score impact)

1. **[shared · blocker] Theme switch text flash.** In `public/css/v4/shell.css:259`, the `html.theme-xfade` list transitions `color` only on token surfaces. Children that set `color: var(--text-*)` (tile titles `.td-*`, `.fd-*`, `.dx-*`, table cells, links) flip on frame 1, so white text sits on light tiles for about 300 ms. While `.theme-xfade` is set, add `color` to the transition for `:is(h1,h2,h3,h4,p,li,a,td,th,label,small,strong,[class*="-title"],[class*="-meta"])`, with the same `--dur-theme` and `--ease-ambient`. Target: no sampled frame at 100, 300 or 500 ms has text/surface contrast below 3:1. Add that as a harness check under F-contrast.
2. **[map · blocker] Hottest topic labels are hidden.** `.map-topic.is-hot` for "Agent orchestration" and "Business adoption" has computed opacity 0 at the default view. In `map-engine.js`, label placement around line 985–1009 lets node labels claim space first. The top 3 hot topic labels must always place first and push node labels instead (cull node labels, never the top-3 topic labels). Target: the top 3 regions are labelled at default zoom in both themes and at 390 px.
3. **[shared · blocker for color_cohesion] Make the quality ramp actually read as a ramp.** In `tokens.css`, the Proof stops q-3 `#2E6AF6` and q-4 `#1F5EFF` are nearly identical, and q-0 to q-2 are within a few L* of each other.
   - Proof: `--q-0 #B4B8BF`, `--q-1 #9399A6`, `--q-2 #6B7790`, `--q-3 #5B8BF7`, `--q-4 #1F5EFF`, `--q-5 #0B3BC4`.
   - Night: `--q-0 #55595F`, `--q-1 #69707F`, `--q-2 #7E8BA3`, `--q-3 #3E6CD6`, `--q-4 #5A93FF`, `--q-5 #A3C4FF`.
   - In `components.css:159`, raise the clears chip tint from 14% to 18% and give `[data-q=strong]` 26%. Below chips: draw the outline in `var(--q)` at 1.5 px so 44 vs 14 differ visibly.
   - Re-run `test/contrast.test.js`.
   - Target: in Feed, 56, 64 and 72 are three visibly different chips, and 44 vs 14 are clearly different greys.
4. **[shared] Score ring as a quality gradient (user §0: "use a colour gradient for quality").** In `ui.js` scoreRing and `components.css:148`, stroke `.ring-arc` with a per-ring SVG `linearGradient` (`gradientUnits="userSpaceOnUse"`, rotated along the arc). It runs from `qualityColor(threshold)` at the arc start to `qualityColor(score)` at the arc end. Below-bar rings stay single-colour slate. No tick, no bar. The count-up keeps driving both the dashoffset and the end stop.
5. **[shared] Light reaction strength (user: "reactive/ambient background, light reaction").**
   - Proof: `--fd-glow .05→.075`, `--fd-pool .07→.10`.
   - Night: `--fd-glow .07→.11`, `--fd-pool .09→.13`.
   - In `bg.js` (shader sheen) and `bg2d.js` (fallback), dashes within 160 px of the pointer lift alpha by +0.08 over `--fd-amax` and mix 35% toward `--fd-hot`, with smoothstep falloff.
   - Target: the pointer is locatable from a still frame in both themes at 100% field (Today, Map), and invisible at dim.
6. **[feed-dossier] Dossier open jank (E2 fail, 92 ms desktop and 73 ms phone).** `story-dossier.js` renders the whole body in the `Response.json` continuation. Render the head, the sources' first two cards and the score block first. Render evidence, lens, employer connections, drafts and tune after the flight `finished` promise, in `requestIdleCallback` chunks of 12 ms or less. Remove the second forced layout on phone (`dossier.js:134` then a visibility style read). Target: E2 passes.
7. **[feed-dossier] Bottom edge of the dossier.** Text clipped at the panel's bottom (888 px) butts against legible page text in the 12 px inset gap below it, which reads as overlap.
   - Add `mask-image: linear-gradient(to bottom, #000 calc(100% - 28px), transparent)` to the scrolling `.dossier-body`, not the frost.
   - Add 32 px bottom padding inside it.
   - Set `.dossier-scrim` opacity to give at least a 0.7 effective wash in Proof (also 0.7 in Night).
8. **[shared] The pointer glow shows through the dossier frost** as a blue blob over "Why it's post-worthy". While a dossier, ⌘K or sheet is open, set `#bg-light` opacity to 0 (240 ms fade) and stop the tile-pool easing.
9. **[feed-dossier] Employer connections repeat one quote.** Cox Enterprises, Google Cloud and Cox Automotive all print the same "New survey reveals…" quote and the same "Topical overlap only" line. Group companies that share the same evidence under one quote and list them as chips. Show the quote once.
10. **[today] Secondary tile dead space.** The 62 tile (Gemini Omni) has about 90 px of empty space between the bullets and the footer because it stretches to the This week/Waiting row height. Either move the footer up (no `margin-top:auto`) and add the "Named" chips row the lead tile has, or let that row align `start` and balance the heights by moving "Also in the brief" up into the gap. Also give `.td-open` `position:relative; z-index:2` so it receives its own hover; it is currently covered by `.td-stretch`.
11. **[shared] Slightly stronger hover hue (user §0).** Proof: `--hover-wash .035→.05`, `--hover-spot .075→.10`, `--hover-line .26→.34`. Night: `--hover-spot .11→.14`. Keep the 240/360 ms timing. Target: hovered vs rest tile ΔE ≥ 3 in Proof.
12. **[map] Dead quadrant and clipped side panel.** Fit the initial view to the node bounding box with 48 px padding, so the top-left quadrant isn't empty at 1440×900. Make the side panel `overflow:auto` with the same 28 px bottom fade as fix 7, so "Select a story to light up what it connects to" isn't cut mid-line.
13. **[feed-dossier] Feed source glyphs need a key.** The ■◆○ strip in each row has no legend on Feed. Add one line in the list header: "■ first-party · ◆ independent · ○ commentary". Use the same glyphs as the dossier's key, in `--text-3`.
14. **[career-publish] Blue is for quality, not counts.** Career skill-radar meters and Employers coverage bars use `--accent`. Switch them to neutral ink (`--text-3` at 60% for the fill, `--track` for the track), as People's pipeline already does. If a bar must signal "new this week", use the tag, not blue.
15. **[search-system] Settings sliders.** All 11 priority sliders have solid blue fills, the largest blue block in the app. Use a neutral `--line-3` fill with a blue thumb only on hover or focus. Negative weights get a `--warn` thumb with a text label.
16. **[calendar-studio] "Open slot" chips.** Five dashed blue chips in an empty month. Make them `--line-3` dashed with `--text-3` text, and turn blue only on drag-over or hover. Lighten the past-day wash to `--tint-1` so the blue today cell is the only emphasis.
17. **[search-system] Sources health needs colour plus text.** Add a health dot before "Paused" or "Active" using `--ok`, `--warn`, `--err` or neutral, and set "was failing" in `--err-text`. This gives the table the scan-ability SPEC asks for ("health dot").
18. **[career-publish] Performance is mostly empty (76).** Use real data already on the page:
    - a "Closest to publishing" list of the top 3 drafts with status and next open slot;
    - an 8-week cadence strip from `/api/calendar` (0/3, honest);
    - drafts by channel.

    Shrink the CSV import into a collapsed disclosure. Target: no white block taller than one row at 1440×900.
19. **[career-publish] Career saved-posts panel** is an empty white box of about 120 px. Show the one unique saved post as a row, or collapse the panel into the "Add a job description" card.
20. **[career-publish] Employers h1 runs to three lines.** When three or more employers tie, use the fallback "4 employers tie at 2 stories each." and put the names in the one-liner.
21. **[calendar-studio] Studio as a workshop.** On the index, lead with the draft awaiting review as a large writing-surface card: Newsreader 18 preview of its first three lines, approval checklist and "Open draft". Put the grouped list below it, and drop the second-level chrome (chip rows) into a compact filter bar.
22. **[shared] Phone status pill.** At 390 px the pill truncates after "0 new". Drop zero-valued segments on phone and keep "19 ranked · 7 above 55".
23. **[shared] Field canvas width.** `#bg` measures 1425 px in a 1440 viewport. `html { scrollbar-gutter: stable }` narrows the body, and a global `canvas { max-width:100% }` clamps it. Set `#bg { max-width:none }` so the field reaches the edge on overlay-scrollbar systems.
24. **[feed-dossier] Panel width.** The user liked the Glass dossier because it didn't fill the screen. Cap `.dossier` at `max-width: 1120px` (left still `rail.right + 12`), so with the rail collapsed at 1440 the dimmed page and field stay visible on the right.

## Notes on my area that are right and should not change
- Tokens are B §1 verbatim. AA passes in both themes (F-contrast gate). Status hues are never blue and always carry text labels.
- The glass budget is respected: one live surface at rest, the rail has no backdrop, and tiles are never glass.
- The by—line mark is good at 16, 26 and 512 px. It isn't generic, and the underline draw on load is calm.
- Heat on the field (blue dashes where topics are hot) reads as weather without words, and dim mode on reading views truly stays out of the way.
