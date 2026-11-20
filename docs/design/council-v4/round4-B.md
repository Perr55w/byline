# Council v4 · Round 4 · Critic B (colour, theme cohesion, ruled field, brand mark, quality ramp)

**Build reviewed:** branch `v4` at `ad8490c`, live on :4450. I checked it in Playwright at 1440×900 and 390×844, in Proof and Night, at deviceScaleFactor 1. Coverage:
- all 14 tabs, plus draft/1 and person/4, as full-page captures (4 × 16)
- the dossier opened by clicking from Feed and from Today, in both themes, scrolled through to the end
- the dossier on phone
- the rail collapsed and re-expanded with the dossier open: a real-time strip, plus an 8%-speed strip (CDP `Animation.setPlaybackRate`) with a rAF log of rail.right, dossier.left and the underlying h1.left
- the collapsed rail rhythm, measured
- tile hover in both themes
- the bare field with all chrome hidden and the pointer light parked
- the theme switch Proof→Night, logging colours on every rAF
- the cold-load entrance on Today and the Today→Feed tab switch, both at 25% / 20% speed

**Captures:** `/tmp/claude-0/council-B-r4/`. The sweep logged 0 console errors, 0 page errors and no horizontal scroll on any route.

**Gates I ran** (`node test/e2e/run.mjs --port 4460 --only C-theme,E8,E2,E5,C-rules,F-contrast`, 225 s):

| Gate | Result | Checks | Notes |
|---|---|---|---|
| E5 | PASS | 10/10 | |
| E8 | PASS | 19/19 | glass budget held |
| C-rules | PASS | 4/4 | |
| F-contrast | PASS | 28/28 | only separators fall below AA (reported, not failed) |
| C-theme | FAIL | 11/12 | every contrast frame passes (lowest 3.07); Proof→Night p95 is 33.4 against a limit of 33. My own rAF log of the same switch gave p95 16.8 with one 33 ms frame at the ink step. |
| E2 | FAIL | 10/17 | open longest 60 ms; close longest 66–67 ms; close p95 at 1× 33.4 (limit 20); rail collapse with dossier open, p95 at 4× 38.9 (limit 33) |

## Rubric

| | round 3 (mine) | round 4 |
|---|---|---|
| unique_typography | 8.3 | 8.4 |
| color_cohesion | 8.4 | 8.5 |
| theme_cohesion | 8.3 | 8.5 |
| motion_cohesion | 8 | 8.1 |
| motion_smoothness | 7.5 | 7.5 |
| generic_typography | 2 | 2 |
| background_generic | 1.8 | 1.8 |
| color_combo_generic | 2 | 1.9 |
| motion_generic | 2 | 2 |
| ai_slop | 1.8 | 1.8 |
| **overall** | **40** | **41 / 50** |

**Verdict:** my lens clears the bar on colour, theme, field and brand. motion_smoothness stays at 7.5: E2 close frames are 66 ms, and collapsing the rail with the dossier open both janks at 4× and briefly shows the page through the rail. Today now reaches 90. The dossier sits at 89 because of that collapse ghosting, which is exactly what the user complained about.

### Verified fixed since round 3
- **Dossier tag colours.** 0 `.tag--ok` in the panel. "First-party" is amber, matching the amber First-party-only callout, and "Named in a source" is neutral.
- **Why-ranked markers.** The dossier now uses the same blue dashes as Today.
- **Today.**
  - "This week" is a compact 7-day strip with no empty tubes.
  - "Run today's workflow" sits in the collection-off band, so no control floats beside the h1.
  - Weather dots now use a 2-lane offset (still not fully separated, see fix 4).
- **Resting field is neutral ink** (S10). With chrome hidden, blue dashes appear only in the heat region at lower right. The rail area is area-mean softened.
- **Theme switch.** Ink holds at the strong value through the mid-tones and steps once at about 250 ms, with one 33 ms frame. The hierarchy returns at about 660 ms, after the surface has settled; that is one step, not two.
- **Employers.** Google's duplicate blocks now collapse to "Same 2 stories as Google (other teams)", the watchlist column is gone, and titles are in the UI sans on one line.
- **Search** claim chips now show the score, not "story N".
- **Studio** status tags align down the list.
- **Settings** summary cards end at equal heights, and Priority terms wrap in full.
- **Campaigns / Performance** slot lines are now one line ("Mon 23 Nov: open on LinkedIn, Instagram and Video").
- **Collapsed rail rhythm, measured:** item tops 76, 112, 148, 184 | 228 … gives 36 within a group and 44 across groups, identical in both themes.
- **Ramp.**
  - Ring gradients run from threshold to score, with no tick.
  - Chips step visibly 56 → 64 → 72 → 78.
  - Below-bar chips are outline only, with 44 and 42 as darker near-miss outlines.
  - Map nodes below the bar are hollow; 70+ nodes get a double ring.
  - Night inverts the lightness consistently in chips, rings and map nodes.

### What still holds my lens back
1. **Collapsing the rail with the dossier open.** The underlying page's `.main` padding snaps to the collapsed width on the first frame. The rAF log shows the Feed h1 at 131 px from t=0 while rail.right is still 244 → 76. For the first ~60% of the 420 ms move, the Feed eyebrow, h1 and lede show through the translucent rail and in the 12 px gap between the rail and the panel (`slow-collapse-dos-strip.png`, frames 0–1). The SPEC says "nothing may slide under anything". E2 also measures this path at p95 38.9 ms at 4×.
2. **Employers pin glyph inverts its meaning.** On AWS, Google (other teams), Google Cloud and DeepMind (all `pinned: 0` in `/api/employers`), the unpressed pin toggle is a grey outline pin. The "No stories yet" line uses a filled pin to mean "pinned". The four rows with pins are therefore the unpinned ones, while the caption says "4 pinned". This is a colour and state cue that says the opposite of the data.
3. **The pointer light disc has a visible edge.** `#bg-light` is `radial-gradient(closest-side, … 45%, transparent)`, a linear ramp that ends with non-zero slope at r = 360 px. Sampled radially, Night falls from (35,48,76) at the centre to (18,19,22) at 360 px with no ease. The eye reads a Mach-band ring at the edge, clearest in Night (`field-bare-dark.png`). It's small, but it is the one place the field looks like a CSS blob rather than light.
4. **Weather beeswarm still overlaps.** The lane offset is about 4 px on 7 px-radius dots. Agent orchestration's hollow pair at about 43, its filled pair at 58/60, and the hollow pairs in Machine learning and AI engineering still overlap by roughly half a dot (`weather-zoom.png`).
5. **The theme hold flattens colour for about 660 ms.** Links, "Hot", amber and red all go to one ink until the cross-fade ends, then return together. It is legible and now a single step, but the blue and status colours visibly blink back after the motion has stopped.

## Per-tab scores (user-style, /100)

| tab | score | why |
|---|---|---|
| rail | 90 | Measured even rhythm (36 within / 44 across groups), groups that explain themselves, sliding highlight, mark-only "by—line" that holds its weight collapsed, and a clean footer in both themes. |
| today | 90 | Issue number and date, a finding headline and numeric one-liner, gradient rings with no tick, dashed why-ranked bullets, a labelled weather chart and map with top-3, an honest collection-off band holding the run button, a compact week strip, and a calm blue hover. Only the weather dot overlap keeps it from higher. |
| dossier | 89 | Aligned to the rail, does not fill the screen, per-source key claims, unequal-weight breakdown, amber first-party cues that now agree with each other. Capped by the page ghosting through the rail while the rail collapses, which is the user's "slides under" complaint, and by "maxed" under the Interest bar while every other place says "Full marks". |
| feed | 89 | Visible chip ramp, blue main pills only above the bar, a strong title/meta step, a glyph key and a threshold divider. Feed's 23 ms idle callback is still the route that fails E1/E12/C-tabswap. |
| map | 88 | Real graph, a ramp legend that matches the nodes, Night-consistent. The Agent-orchestration region blob runs under the legend bar, and the floating "Business adoption · leads 4" label has no visible region of its own. |
| search | 88 | Big bar, typed quick chips, grouped useful results, score chips on claims. The sticky Refine panel scrolls up under the top bar (its "All results" row is cut at y≈50), and the Brief row's "6 stories worth your time" contradicts "7 above 55" with no explanation (brief size is 6). |
| studio | 87 | Story-grouped list with aligned status tags, a checklist before approval, a By channel card. The right column ends at about 1,000 px beside a 1,430 px list, leaving a dead column. |
| calendar | 87 | Month grid, no day/date gap, ramp story dots, missed posting days marked honestly, a tray with real drafts, a cadence strip. Calm and complete. |
| campaigns | 86 | Data headline, anchors grouped by topic, one slot line. The right column stops at 858 px against a 1,600 px list (about 740 px of empty column). |
| performance | 86 | Pipeline strip, "Closest to publishing", one slot line, a sentence instead of an empty chart. The two lower cards end 17 px apart (990 vs 1,007). |
| career | 87 | "agentic" folded into Agents, honest duplicate warning, Jobs only tags, neutral bars, trend column withheld with an explanation. |
| employers | 86 | Duplicates collapsed, watchlist column gone, sans titles. The unpinned toggle looks like the pinned glyph (contradicting "4 pinned"), and about 350 px of the stories column is empty between titles and Activity. Titles carry no score and aren't links. |
| people | 87 | Overdue, duplicate and do-not-contact states are clear, with a single red per follow-up row and a neutral pipeline. |
| sources | 88 | Before/after health bar, rich rows, honest paused state. Each failing row uses red twice ("was failing" and the mono "fetch failed"): 24 red marks in one table. |
| runs | 87 | Clear stages, an amber 0-sources state, grouped repeat runs, cost and feedback context. |
| settings | 87 | Source-health summary up top, full priority terms, equal summary cards, amber negative weights. |

## Fixes (ranked by score impact)

1. **[shared · blocker: dossier ≥ 90, motion_smoothness] Rail collapse with the dossier open shows the page under the rail.**
   - In app.js/shell.css, while `html.dossier-open`, do not apply the collapsed `.main` padding at the start of the `--rail-w` transition.
   - Hold `.main`'s padding at its pre-toggle value (e.g. a `--main-rail-w` that only follows `--rail-w` when no dossier is open), and snap it at `transitionend` when the page sits fully under the panel.
   - Alternatively, give the rail an opaque `--rail-fill-solid` for the duration of `html.dossier-open.rail-moving`.
   - Target: on an 8%-speed strip, no page glyph is visible inside the rail or in the rail–panel gap on any frame. E2's "rail collapse frame p95 (dossier open, 4×)" should be ≤ 33, down from 38.9.
2. **[shared · blocker: motion_smoothness] E2 close long frame.**
   - Close has a 66–67 ms longest frame and p95 33.4 at 1×. Remove `dossier-open` from `html` only at the panel's clip `transitionend`, not in the close frame.
   - Fade `#bg` back in one frame after the clip starts, not in the same frame.
   - Don't rebuild the prebuild host during close; defer to `requestIdleCallback` after 400 ms.
   - Target: close longest frame < 50 and close p95 ≤ 20 at 1×.
3. **[career-publish · blocker: employers] Pin toggle state.**
   - In `employers.js` (`.em-pin`, line ~124) and `employers.css`, hide the off-state toggle at rest (`opacity: 0`), showing it at `--text-3` on row `:hover` / `:focus-within`.
   - Render the on state as the filled pin in `--text-1`, the same glyph as the "No stories yet" pinned marker.
   - Target: at rest, only rows with `pinned: 1` show a pin. The number of visible pins equals the caption's "N pinned".
4. **[today] Weather beeswarm separation.**
   - Dots whose x positions fall within one diameter (2r + 2 px) of a neighbour must not overlap. Use lane offsets of ±(r + 1.5) px, about ±8.5 px for r = 7, and a third lane at 0 when three collide.
   - Grow the row height from about 31 to 36 px so the lanes fit.
   - Keep the 1 px surface ring on hollow dots too.
   - Target: every one of the 19 dots is fully separable at 1440 and 390 (no dot area overlapping another by more than 1 px).
5. **[feed-dossier] Feed idle callback.** The 23 ms `requestIdleCallback` in feed.js is the cause of the E1 (52–64 ms), E12 (33–50 ms at 1×) and C-tabswap failures. Chunk the work, yield when `deadline.timeRemaining() < 4`, and continue in the next idle callback. Target: no single feed.js task > 8 ms in a trace, and E1/E12/C-tabswap green on Feed.
6. **[career-publish] Employers stories column.**
   - Prefix each story title with its quality chip (`score-chip` using `qualityColor()`, same as Feed), and make the title a link to `#/story/:id`; `story_ids` is already in the API.
   - On the collapsed "Same 2 stories as …" rows, show the two chips inline.
   - Cap the stories column at 520 px so Activity sits beside the content rather than 350 px away.
   - Target: no empty band > 160 px inside a row at 1440.
7. **[shared] Pointer light edge.**
   - In shell.css `#bg-light`, replace the gradient with an eased falloff: `radial-gradient(closest-side, rgba(hot, g*2.2) 0%, rgba(hot, g*1.3) 30%, rgba(hot, g*.55) 58%, rgba(hot, g*.15) 82%, rgba(hot, 0) 100%)`, so the slope reaches 0 at the edge.
   - Target: no perceptible ring in `field-bare-dark.png` at r ≈ 330–360 px. The luminance second difference across the last 40 px should be ≤ 1 level per 10 px.
8. **[feed-dossier] Breakdown wording.** In `story-dossier.js`, change the "maxed" caption under the Interest bar to "full marks", matching why-ranked and the evidence line.
9. **[career-publish] Campaigns right column.** Make the right column sticky (`position: sticky; top: 72px; align-self: start`) so "Pieces waiting" and "Where the drafts sit" travel with the 1,600 px anchor list. Target: no empty column band > 200 px in the viewport while scrolling at 1440.
10. **[calendar-studio] Studio right column.** Apply the same sticky treatment to the "Above your bar, no draft yet" and "By channel" stack (`top: 72px`), so the column doesn't end 430 px above the list.
11. **[search-system] Sticky Refine panel under the top bar.** In search.css, set the Refine aside's `top` to at least the top bar height + 12 px (about 72 px), so "All results 148" is never under the pill or ⌘K trigger when scrolled.
12. **[search-system] Brief row count.**
    - The brief row reads "6 stories worth your time" while every h1 says 7 above 55.
    - Append the reason from settings: "6 stories (brief size 6) …".
    - Or render the stored brief count as "Brief of 6 · 7 cleared the bar".
13. **[map] Legend over the region.**
    - The Agent-orchestration region blob extends under the legend bar at the canvas bottom.
    - Fit the layout with `paddingBottom = legend.offsetHeight + 16`.
    - Anchor region labels to their own blob: draw "Business adoption · leads 4" only when its region has a visible fill, or give that region its contour.
14. **[search-system] Sources double red.** On failing rows, keep the red dot and "was failing", and set the mono "Last error fetch failed" in `--text-2`, with the error term in `--err-text` only on row expand. Target: one red mark per row.
15. **[career-publish] Performance card bottoms.** Give the lower grid `align-items: stretch` so "Closest to publishing" and "Next open slots" end on the same line (currently 990 vs 1,007).
16. **[shared] Theme ink hold scope.**
    - In tokens.css `html.ink-strong-proof` / `ink-strong-night`, force only `--text-2`/`--text-3` to the strong ink.
    - Keep `--accent-text`, `--warn-text`, `--err-text` and `--ok-text` at the **new** theme's values in `ink-strong-${next}`; they measure ≥ 3:1 on the surface from the step onward.
    - Then links and status colours don't blink back at 660 ms. Verify with C-theme: every contrast frame ≥ 3 and p95 ≤ 33.

## Holding firm (don't change)
- The ruled field at its current strength, with neutral resting dashes, blue only from heat, rail area-mean and the dim on Feed.
- Ramp mechanics: ring gradient from threshold to score, banded chips, hollow below-bar nodes, Night's inverted lightness.
- The blue budget: bar, quality, links and the primary action only. Status hues are never blue.
- The "by—line" mark, lockup and collapsed mark.
- One live backdrop-filter at rest; the top bar is hidden while the dossier is open.
