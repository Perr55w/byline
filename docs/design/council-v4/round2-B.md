# Council v4 · Round 2 · Critic B (colour, theme cohesion, ruled field, brand mark, quality ramp)

**Build reviewed:** branch `v4` at `e010f0f`, running live on :4450. I checked it in Playwright at 1440×900 and 390×844, in Proof and Night, with the rail expanded and collapsed. That included collapsing the rail while the dossier was open, plus:
- the dossier opened from Feed, from Today, and by deep link to story 16, on desktop and phone
- draft/1 and person/4
- hover, pointer light, theme switch frames, load entrance frames, tab switch frames, and an rAF log of feed→today

**Captures:** `/tmp/claude-0/council-B-r2/`, at deviceScaleFactor 1. The full sweep logged 0 console errors and 0 page errors.

**Gates:** I did not re-run them. The integrator reports E1 and E2 still failing; every other gate passes.

## Rubric

| | score |
|---|---|
| unique_typography | 8 |
| color_cohesion | 8 |
| theme_cohesion | 8 |
| motion_cohesion | 7.5 |
| motion_smoothness | 7 |
| generic_typography | 2 |
| background_generic | 2 |
| color_combo_generic | 2.5 |
| motion_generic | 2 |
| ai_slop | 2 |
| **overall** | **38 / 50** |

**Verdict: close, but not yet at the bar.** Overall now reaches 38. motion_cohesion (7.5), motion_smoothness (7) and color_combo_generic (2.5) still miss.

### What moved since round 1

- **Quality ramp.**
  - Rings now carry a visible gradient that runs from the threshold colour to the score colour.
  - Rings at 64, 72 and 78 on Today are three different blues.
  - Map nodes use the ramp, with hollow nodes below the bar.
  - Settings sliders are now neutral, and so are the Career, Employers and Campaigns bars and the calendar open slots. That was most of my blue-budget list.
- **Light reaction.** You can now find the pointer from a still frame: dashes near it shift toward blue, and a soft pool sits behind them (`pointer-pair.png`). The field moves: 39% of the right-margin pixels change by more than 4 levels over 2 s, against 3% in round 1. The field also softens under the page head.
- **Dossier geometry.**
  - The panel is about 1024 px wide. At 1440 it leaves about 160 px of page visible on the right.
  - The rail stays above the scrim and collapses; the panel then reflows to left 88 px.
  - Employer connections are grouped, and the quote is shown once.
- **Rail.** The collapsed pitch measures 36/44 exactly.
- **Phone status pill.** It drops zero segments.

### What still holds scores down

1. **Feed score chips are still flat inside each tier.** I read the computed values.
   - `clears` chips at 56, 59, 61 and 62 have backgrounds between L .937 and .925. That is invisible.
   - `top` chips at 72 and 78 are identical, because both use `var(--q-5)` and ignore `--q`.
   - Below-bar chips at 44 and 7 share the same text and border colour. Only a 1.5 px inset `--q` hairline differs, and you can't see it at reading distance.

   So the gradient the user asked for exists in rings and nodes, but not in the most-seen element.
2. **Blue still marks things other than quality.**
   - Every Feed row's main topic pill is blue, including the 12 below-bar rows: 19 blue pills down one page.
   - Search results below the bar do the same.
   - Map "Hottest topics" rank bars are solid blue.
   - The People outreach meter is blue.
   - The tile hover wash is now a full blue tint: tile centre `#FFFFFF → rgb(231,239,255)`, ΔE about 9. That reads as a selected state, not a hover. The user asked for "slightly stronger" than Edition.
3. **The theme switch still has an unreadable frame.** At about 150 ms, regular lede text and button labels are mid-grey on mid-grey (under 1.5:1). Bold spans have already flipped to white. This is unavoidable while both text and surfaces interpolate linearly; the fix is to step text colour at the midpoint (fix 2).
4. **Score rings pop on revisit.**
   - On feed→today, the rAF log shows the lead ring reading **"0"** from 73 ms to 660 ms. The page reaches full opacity at 310 ms, then the ring snaps to 78 at 712 ms.
   - Cause: `scoreRing(count:true)` always renders 0, and `choreograph()` delays `countTo()` with `setTimeout` even when the value has already been counted this session.
   - The user said explicitly that things should fade, not pop.
5. **The dossier frost drops out during a rail collapse.** For roughly the first 270 ms of the collapse (frames 0–2), Feed's h1 "7 of 19 stories this week are worth a post." shows through the panel behind the dossier text (`dcollapse-strip.png`).

## Per-tab scores (user-style, /100)

| tab | score | why |
|---|---|---|
| rail | 89 | Even collapsed rhythm (36/44 measured), clear groups, sliding highlight, clean footer. The by—line mark is distinctive, but at about 22 px it is visibly lighter and smaller than the Newsreader wordmark next to it. |
| today | 88 | Informative headline and numeric one-liner, gradient rings, weather chart with legend, hottest-regions list, honest collection-off band. Below 90: the lead ring shows "0" and then snaps on every revisit, the lead tile has two dead gaps (about 60 px under the finding and about 50 px above the footer), and the hover wash is too blue. |
| dossier | 88 | Aligned to the rail, adapts on collapse, doesn't fill the screen. "What the sources say", the grouped evidence and the unequal-weight breakdown are excellent. Losses: page text bleeds through during a rail collapse, and the first source card has a title but no summary or claim. Page text is also legible in the 12 px gap under the panel, and the ⌘K trigger is cut in half at the panel edge. |
| feed | 87 | Strong headline-to-meta size step, source glyph key, top two topics, threshold divider. Chips inside a tier look identical (56 to 62, 72 and 78, 44 and 7), and below-bar rows still get a blue main-topic pill. |
| map | 86 | Real graph, top-3 regions labelled, ramp nodes with hollow below-bar nodes, legend. The Hottest-topics bars spend blue on counts, and the top-left and right edges of the stage are still empty. |
| search | 86 | Big bar, chips by type, useful grouped results. Below-bar results carry blue topic pills. The refine column is plain. |
| studio | 83 | The new workshop card is the right idea. The right column ends at about 740 px next to a list about 1,550 px tall, leaving dead white space. Draft rows repeat "Video · explainer" and "Instagram · carousel" with nothing to tell them apart. |
| calendar | 85 | Month grid, no day/date gap, neutral open slots, tray, cadence. The past-day grey wash still competes with the today cell, and four of six rows are empty by honest data. |
| campaigns | 83 | Data headline, anchor list, neutral channel bars. The right column ends at 815 px beside a 1,550 px list, and the anchor list mostly repeats Feed's top 7. |
| performance | 83 | Much better: a pipeline strip, closest-to-publishing list and next slots. But "Closest to publishing" lists the same Northwind title three times, and the 14-day chart is 13 empty grey columns and one bar. |
| career | 83 | Strong duplicate warning, honest trend column, neutral bars. The h1 "Agents leads your skill radar" is ungrammatical. The right column ends at 1,265 px beside a 1,815 px table, and the long tail of 1-mention skills dilutes it. |
| employers | 84 | The h1 is fixed (four tie at 2 stories) and the bars are neutral. Thirty identical Pin/Edit/Activity buttons make it the most chrome-heavy page. |
| people | 85 | Overdue tags, duplicate warning, do-not-contact states, neutral pipeline. The "LAST CONTACT" column touches the card's right edge, and the outreach meter is blue. |
| sources | 86 | Rich header with before/after health bar, "was failing" in error tone, expandable rows. The health column's dots are all the same hollow grey, so they add nothing. |
| runs | 86 | Clear stages: Collect is amber when 0 sources were read, then cost controls, then feedback. Honest and dense. |
| settings | 85 | Neutral sliders with amber negative thumbs, source-health summary, collapsible tail sections. Still about 3,450 px long. |

## Fixes (ranked by score impact)

1. **[shared · blocker: today ≥ 90, motion_cohesion] Ring count-up pops on revisit.**
   - In `public/js/motion.js`, export `hasCounted(key, final)`, which returns `counted().has(\`${key}:${final}\`)`.
   - In `public/js/ui.js` `scoreRing()`, when `count && hasCounted(key, shown)`, render the final number, final dashoffset, final `--q` and the full gradient stop, and omit `is-counting`. This is the same markup as `count:false`.
   - `countTo()` already paints the target immediately for counted keys, so Today's `setTimeout` becomes harmless.
   - Target: on any revisit, no frame shows a ring value other than the final one (rAF log over feed→today).
2. **[shared · blocker: theme_cohesion] Theme switch midpoint.**
   - In `shell.css` `html.theme-xfade`, keep surfaces and background on `--dur-theme` (600 ms).
   - For every text-bearing element (`:is(h1,h2,h3,h4,p,li,a,td,th,label,small,strong,b,span,button,.btn,.chip,.tag)`), replace the colour cross-fade with a stepped switch: `transition: color 1ms linear calc(var(--dur-theme) / 2)`.
   - Surfaces are mid-grey at the midpoint, so dark-on-light-half and light-on-dark-half each stay at 4:1 or better.
   - Add a harness sample at 150 ms to C-theme. Target: text/surface contrast of 3:1 or better at 60, 150, 300, 450 and 600 ms.
3. **[shared · blocker: dossier ≥ 90] Frost dropout during rail collapse.**
   - While `--rail-w` transitions with the dossier open, the panel shows the page behind it.
   - In `components.css` and `dossier.js`, keep `.dossier-fill` at an opacity of 0.96 or more for the whole collapse. Use the same opaque fill as the flight, and restore the frost layer at `transitionend`.
   - Don't toggle the frost off during the resize.
   - Target: in a 30 fps capture of a collapse with the dossier open, no page glyphs appear inside the panel rect.
4. **[shared · blocker: color_cohesion and color_combo_generic] Make chips show the ramp inside each tier.** In `ui.js` `scoreChip()`, set inline `--qmix` from the delta d = round(score) − threshold, as follows:
   - `clears`/`strong` (0 ≤ d < 15): `--qmix: calc(12% + d*1.6%)`. So 56 is 13.6%, 62 is 23%, and 69 is 34%.
   - `top`: background `var(--q)`, not `var(--q-5)`, so 72 and 78 differ. White text still measures 6.9:1 or better on `--q` at +17 (check q-4 to q-5 interpolation stays AA; `test/contrast.test.js`).
   - Below the bar, from −15 to −1 (a near miss): background `color-mix(in oklab, var(--q) 10%, var(--surface-solid))` plus the 1.5 px `--q` outline.
   - Below −15: outline only, with text in `--text-3`.
   - In `components.css:165-168`, use `color-mix(in oklab, var(--q) var(--qmix,18%), var(--surface-solid))`.
   - Target: on Feed, 56 vs 62 and 72 vs 78 each differ by ΔE ≥ 4, and 44 (near miss, filled) is visibly distinct from 7 (outline).
5. **[feed-dossier] Blue main-topic pill only when the row clears the bar.**
   - In `feed.js` rows, and in the dossier head for stories below the threshold, render the first topic pill as the neutral pill (`--inset` fill, `--text-1` text, 600 weight, so it is still the "main" one).
   - Keep the blue `--accent-soft` pill for rows ≥ threshold.
   - Target: Feed shows at most 7 blue pills, which matches "7 above 55".
6. **[search-system] Same pill rule in Search results.** Story results below the threshold use the neutral main-topic pill, and the chip follows fix 4. Blue then marks only results that cleared your bar.
7. **[shared] Tile hover wash is too strong.**
   - Proof: `--hover-spot .10 → .07`, with the radial at 70% of the tile width so the tile edges stay at or near `#FDFEFF`.
   - Night: `--hover-spot .14 → .11`.
   - Keep `--hover-line .34` and the background pool, which carry the "stronger" feel.
   - Target: hovered vs rest at the tile centre, ΔE 3–5 in Proof. It is about 9 now.
8. **[today] Lead tile dead space.**
   - In `today.css`, `.td-lead` shows about 60 px of empty space under the finding and about 50 px above the footer.
   - Remove `margin-top:auto` and any `min-height` on the "Why it ranked" block, and let the lead row align `start`.
   - If height must match the right column, move "Named" chips directly under the bullets and put `.td-lead-foot` right after them, so leftover space falls below the footer and outside the tile (grid `align-self:start`).
   - Target: no internal vertical gap over 32 px at 1440 with the rail expanded or collapsed.
9. **[feed-dossier] Every visible source card gets a summary.**
   - The first primary card (Gemini at Work 2026) shows only a title. Render `articles.summary` (1–2 sentences, numbers highlighted) under the title for each of the first two cards, as the second card does with its key claim.
   - If summary and claim are both missing, show the honest line "No summary extracted for this post." in `--text-3`.
10. **[shared] Topbar under the dossier.** With the dossier open, the ⌘K trigger and status pill are cut by the panel's right edge ("r jump Ctrl K"). While `html.dossier-open` is set, fade `.topbar` children to opacity 0 over 160 ms, and restore them on close.
11. **[feed-dossier] Bottom inset legibility.** Page text is legible in the 12 px gap under the panel, and it reads as overlap. Add a `.dossier-scrim` bottom band: `linear-gradient(to top, var(--bg) 0, var(--bg) 24px, transparent 64px)` layered over the existing scrim, in both themes.
12. **[map] Hottest-topics bars spend blue on counts.** Make the `map.css` side-panel rank bars neutral (`--text-3` at 60% fill, `--track` track). Blue stays on the map's ramp nodes only.
13. **[calendar-studio] Studio right column dead space.**
   - Make the right column `position:sticky; top:76px`.
   - Add a compact "By channel" block that uses existing counts (12 LinkedIn · 5 Instagram · 5 Video, with in review / draft per channel).
   - Target: no white column taller than one row at 1440.
14. **[calendar-studio] Identical draft rows.** In the Studio list and in the calendar tray, append the first 6–8 words of each draft's hook, or its version and created time, after the format ("Video · explainer · 'Agents stop being demos when…'"), so the two "Video · explainer" rows can be told apart.
15. **[calendar-studio] Draft page tab overflow.** On draft/1, the right panel tabs clip ("Sources |H…"). Allow horizontal scroll with a 24 px edge fade, or shorten the labels ("Notes 6" → icon plus count) so all tabs fit in 336 px.
16. **[career-publish] Performance repeats one story three times.**
    - "Closest to publishing" lists the Northwind title three times. Group by story: one row with the title, then channel chips (LinkedIn · in review, Video · draft, Instagram · draft) and the next slot.
    - Replace the 14-day "Last edit per open draft" chart, which is 13 empty columns, with one sentence ("All 22 open drafts were last edited Wed 18 Nov.") until edits span at least 3 days.
17. **[career-publish] Campaigns and Career right columns end early.** Make the side columns `position:sticky; top:76px` on Campaigns (`campaigns.css`) and Career (`career.css`), so the 815 px and 1,265 px columns stay in view beside the long lists.
18. **[career-publish] Career h1 grammar.** "Agents leads your skill radar" should name the skill as a term: `"agents" leads your skill radar: 10 mentions this week.` (quoted, lower case), or use the F fallback "Your top skill this week is agents (10 mentions)."
19. **[career-publish] Employers button chrome.** Thirty Pin/Edit/Activity buttons. Show Pin and Edit only on row hover or `:focus-within`, keeping their space so nothing shifts, and keep "Activity →" as a quiet link. Pinned rows keep the "Pinned" tag.
20. **[career-publish] People table and meter.**
    - "LAST CONTACT" touches the card's right edge. Give the last column `padding-right:24px` or let the header wrap.
    - The outreach meter (2 of 3) uses `--accent`. Switch it to neutral ink, which matches the pipeline.
21. **[search-system] Sources health dots.** All 26 health dots are the same hollow grey. Paused sources that were failing get a small `--err` ring dot and healthy paused sources a `--ok` ring dot, both still hollow so "paused" reads. The text labels stay.
22. **[calendar-studio] Calendar past-day wash.** Lighten past-day cells from the current grey to `--tint-1` (or rgba(14,18,28,.02)), so the blue today cell is the only emphasis.
23. **[shared] Rail mark weight.** The rail by—line mark renders at about 22 px with strokes lighter than the wordmark's stems. Render it at 26 px, as DECISIONS says, with a stroke width matching about 2.2 px at that size, keeping the descender/underline in `--accent`. Target: the mark's cap height is at least the wordmark's x-height.

## Holding firm (don't change)
- Tokens and AA in both themes; status hues are never blue and always labelled.
- One live backdrop-filter at rest (pill). Tiles are never glass.
- Field: pointer-sheen plus heat plus page-head softening is the right balance. Don't strengthen it further.
- Ring gradient from the threshold colour to the score colour, with no tick and no bar, matches the user's ask exactly.
