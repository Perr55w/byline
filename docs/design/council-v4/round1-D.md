# Critic D (Surfaces): round 1, first look at the built v4

**Lens:** surfaces, layout, spacing rhythm, rail, tiles, dossier panel geometry, white-space balance, radii, glass budget, phone layout.

**What I checked (live, branch v4 HEAD `8eb8113`, server on :4452):**
- Every route in Proof and Night at 1440×900 and 390×844 (DPR 1), including full-page captures of each route in Proof.
- The dossier opened three ways: from a fresh deep link (`#/story/16`), from the Today lead tile and from a Feed row. I scrolled it end to end (2600 px of content).
- Rail collapse with the dossier open, sampling geometry every few ms.
- Collapsed-rail rhythm, tooltips, tile and row hover, the load entrance (16 frames), the Today→Feed tab switch (12 frames) and the Map node selection.
- A count of live `backdrop-filter` surfaces.

Captures are in `/tmp/claude-0/council-D-r1/`. Nothing was clicked on run, approve, publish or send paths.

**Note:** `round0-D-surfaces.md` is 0 bytes in the working tree. Commit `1a216e0` stored it as a JSON blob. I re-read it from there. Someone should restore the markdown (owner: shared).

---

## Measured: what passes

| Check | Result |
|---|---|
| Collapsed rail rhythm | Icon pitch is exactly {36, 44}: 36,36,36,44,36,36,36,44,36,36,44,36,36. Dividers are 4 px. Every icon centre x = rail centre x = 44. **Pass.** The user's main rail complaint is fixed. |
| Dossier geometry | Panel top 12, bottom 888 (= rail), left = rail.right + 12 at 1440. **Pass.** |
| Dossier during rail collapse | `[ms, rail.right, panel.left]` samples: [12,244,256] → [202,140,152] → [390,79,91] → [611,76,88]. The panel tracks the rail on every sample, with nothing sliding under. **Pass.** |
| Deep link | `#/story/16` from cold renders Feed underneath, and the rail shows Feed. **Pass.** |
| Glass budget | Feed has 1 live surface (status pill). With the dossier open there are 2 (pill + `dossier-frost`). The rail is not backdrop-filtered. **Pass.** |
| Banned motion | No `cubic-bezier(.16,1,.3,1)`, shimmer, gradient text or tilt in `public/`. |
| Radii | Mostly on scale (`--r-ctl`, `--r-tile`, `--r-chip`, `--r-tag`). Off-scale values are a few literal 6/10 px values in calendar, studio, feed and shell. These are nits. |

## Rubric

| | Score |
|---|---|
| unique_typography | 8 |
| color_cohesion | 8 |
| theme_cohesion | 8 |
| motion_cohesion | 7.5 |
| motion_smoothness | 8 |
| generic_typography | 2 |
| background_generic | 2.5 |
| color_combo_generic | 2.5 |
| motion_generic | 2 |
| ai_slop | 2.5 |
| **overall** | **37 / 50** |

**Verdict: close, but not yet past the bar.**
- The shell itself is A-tier: the rail, the dossier coupling, Proof and the glass budget.
- What holds it back is white space and surface consistency at the page level:
  - right columns end 300–700 px before the main column;
  - one empty card and two clipping panels;
  - tables with mismatched header sizes;
  - the ruled field running straight through page-head text;
  - a few unexplained marks (the ■◆○ glyph rows and the Search refine bars).
- The user is harsh on exactly these things.

## Tab scores (out of 100)

| Tab | Score | Why |
|---|---|---|
| rail | 90 | The rhythm is mathematically even, groups explain themselves, the highlight slides, and the collapse reflows everything. The logo is the drag: a white "by" on a blue rounded tile reads as a generic SaaS app tile at 26 px. |
| today | 85 | Strong head: informative headline, numeric one-liner, issue number, and pills with the main topic in blue. Why-ranked bullets, News weather and a real map tile are all there. Below target for three reasons: row 3 has uneven heights (This week has ~160 px of dead space and the 62 tile has ~80 px); the mini map uses ~40% of its canvas, with labels overlapping; and the ruled field runs through the h1 and one-liner text. |
| dossier | 86 | The geometry is exactly right, and "What the sources say" now gives per-post summaries and key claims. It loses points on four things: asymmetric gutters (36 px left, 51 px right, and the header meta doesn't align to the grid); a bordered right column against a flat left column; a 3-screen length padded by three identical boilerplate "Employer connections" quotes ("AI adoption, AI adoption"); and an unexplained ■■■■■■ glyph row in the header. |
| feed | 87 | Clear title/meta size step, quality-ramp chips, top two topics and a threshold divider. Close to Glass's 85. Minus: ~125 px of empty band at the bottom of the list tile, the ■◆○ source glyphs have no legend in the list, and the date column floats far right of its content. |
| map | 84 | A real clickable force map with a top-3 list, bridge card and selection panel. The map tile and side panel overrun the 900 px viewport (the panel's last line is clipped), the top-left third of the canvas is empty, and node labels collide with edges. |
| search | 85 | Big bar, keyboard hints and grouped quick chips, as the user asked. Minus: zero-result chips ("Bedrock Agents 0", "Vertex AI 0") invite dead clicks, the Refine panel's proportional underline bars are unexplained mini graphs, and the Refine tile's top doesn't align with the results header. |
| studio | 80 | A clean list plus a strong draft editor. Minus: "no date" repeats on every row; the right column ends ~320 px before the list; on `draft/1` the review panel clips its last line ("Both need an approved current version.") and the tab strip clips "History". |
| calendar | 85 | Month grid with no day/date gap, the grid and side panel the same height, a legend, a cadence meter and a tray. It answers the 35. Minus: chips truncate to "Test A.", the day panel's hint sentence is ellipsised mid-sentence, and four cell radii are literal 6 px. |
| campaigns | 78 | An honest empty state with useful anchors. But the right column ends at y≈760 while the list runs to y≈1450, leaving ~690 px of dead white. |
| performance | 76 | An honest empty state, but thin. Three of the five stat cells read 0, the right card is ~140 px shorter than its neighbour, and the CSV placeholder shows sample numbers that look like data. |
| career | 75 | The "Saved job posts · 1 unique" card renders **empty** (~180 px blank). The headline (AI governance) and one-liner (Agents) talk about different skills. There's a bare "0/0" KPI. Skill names wrap ("risk / management") because the skill column is too narrow. Table header sizes are inconsistent. |
| employers | 79 | Rich coverage table. But the H1 runs three lines (four employer names), the PEOPLE column is all zeros, Pin (ghost text) and Unpin (bordered button) look different, and the numeric header renders larger than the others. |
| people | 84 | Dense and honest (duplicate warning, pipeline, follow-ups). The right column ends ~250 px early, and the Person/Stage columns wrap to four lines. |
| sources | 86 | Big improvement on the 25: health summary, a before-the-pause bar, a rich table and tabs. Row heights are ragged (the DEMO tag wraps under the name, and the name already says "DEMO ·"), and demo rows leave the Sync column empty. |
| runs | 86 | A clear stage timeline, cost controls and a full history table. Numeric column headers (READ…COST) render at 13 px against 10.5 px for the rest. |
| settings | 84 | Sectioned, a sticky sub-nav, and a real source-health card. When scrolled, body text runs right up beside the floating status pill and ⌘K, because there's no top backing, so the top edge looks cluttered. Long page (7200 px). |

## Fixes (most score-moving first)

Each fix names one owner.

1. **[blocker · career-publish · career]** Fix the empty card.
   - **Problem:** the "Saved job posts · 1 unique" tile renders an empty body.
   - **Fix:** render the unique saved post (title, employer, saved date, "×7 demo copies" tag, link). Or, if the list is empty, don't render the tile and let the form tile be the only right-column item.
   - **Also:** make the headline and one-liner name the same skill. Either "Agents led the radar: 10 mentions this week" or keep AI governance in both.
2. **[blocker · today · today]** Remove the dead space in Today row 3.
   - **Problem:** the 62 story tile, This week and Waiting on you have different content heights. This week has ~160 px empty and the 62 tile ~80 px.
   - **Fix:**
     - Make row 3 `align-items:start`, and let This week and Waiting share one column stack.
     - Or move the 62 story into the "Also in the brief" list and widen This week and Waiting to 6 + 6 columns.
   - **Rule:** no tile may have more than 24 px of unused height under its last element.
   - **Also:** in the lead tile, put the dek directly under the title block (span under the ring). Today there's an ~80 px gap because the ring (96 px plus label) sets the row height.
3. **[blocker · feed-dossier · dossier]** Fix the dossier gutters and column surfaces.
   - **Gutters:** move the close button to `position:absolute; top:16px; right:16px` inside the panel, and make content padding symmetric: 36 px on both sides (today it's 36 left, 51 right).
   - **Header alignment:** right-align the header's Sources/Companies block to the same right edge as the body grid.
   - **Surfaces:** make the two body columns the same surface. Either both flat, with the right column getting a 1 px `--line` left border and 32 px padding, or both tiles. Today the left is flat and the right is a bordered tile.
4. **[blocker · feed-dossier · dossier]** Cut the dossier from about 3 screens to 2.
   - **Employer connections:** collapse to one row per employer: name, TOPICAL ONLY tag and the shared topic, deduped (no "AI adoption, AI adoption"). Show the shared quote once under the group, not three times.
   - **Evidence › Matches your priorities:** show the top 3 priorities and put the rest behind "+N more".
   - **Header:** drop the unlabeled ■■■■■■ glyph row next to "SOURCES". The text "6 posts · 1 outlet · 0 independent" already says it.
5. **[major · shared · today/all reading views]** Give the ruled field a quiet zone behind page-head text.
   - **Problem:** dashes currently cross the h1 and one-liner.
   - **Fix:** pass the `.page-head` rect as a uniform, the same way the rail rect is passed. Fade dash alpha to ≤ 25% inside it, with a 48 px feathered edge. Under Canvas2D, skip dash rows inside that rect.
6. **[major · career-publish · campaigns, people, performance]** Make right columns sticky so they don't strand white space.
   - `position:sticky; top:72px; align-self:start` on the right-column wrapper.
   - On Campaigns, also move "How approvals work" into the list's footer, so the right column holds only the waiting-pieces card.
   - On Performance, make both top tiles the same height by stretching the "What will be tracked" card (`align-self:stretch`).
7. **[major · calendar-studio · studio]** Fix the studio list and the draft panel.
   - **Studio list:** remove the repeated "no date" text from every row (show a date only when one is set), and label the angle ("Angle: Product tradeoff").
   - **Right column:** make it `position:sticky; top:72px`.
   - **`draft/1` review panel:** give the panel body `max-height: calc(100dvh - 96px); overflow:auto`, so "Both need an approved current version." isn't clipped by the tile edge.
   - **Tab strip:** let it fit by reducing tab gaps to 12 px, or allow horizontal scroll with a 16 px fade mask. "History" is cut today.
8. **[major · map · map]** Fit the map to the screen and to its content.
   - **Viewport:** size the map tile and side panel to `height: calc(100dvh - <top of tile> - 12px)` with a 520 px minimum, so both end on screen at 900 px tall. The side panel scrolls internally, with a 16 px bottom fade.
   - **Content:** on load, fit the camera to the node bounds with 10% padding. Today the top-left third is empty.
   - **Labels:** run a collision pass that drops any label whose box overlaps another label or a node of r ≥ 6. Hovered and selected nodes always keep their label.
9. **[major · today · today]** Fix the mini News map.
   - Fit the node bounds to the canvas with 12% padding; clusters fill only ~40% of the tile today.
   - Show at most 3 region labels (the top-3 list) and hide the rest.
   - Keep the tile's 10 px inner radius, but cap the canvas height at the tile's content height, so there's no empty band above "HOTTEST REGIONS".
10. **[major · shared · runs, career, employers, all tables]** Fix numeric table headers.
    - **Problem:** `components.css` `.table .num` sets `font-size:13px`, which also hits `th.num`. Numeric column headers (THIS WEEK, JOB POSTS, PEOPLE, READ…COST) render larger than the other headers.
    - **Fix:** add `.table th.num { font-size: inherit; }`, or scope the 13 px rule to `td.num` only.
11. **[major · shared · rail]** Make the logo less generic at rail size.
    - **Problem:** the white "by" on a filled `#1F5EFF` tile reads as a stock app icon.
    - **Fix:** in the rail, use the strokes-only option DECISIONS allows. Draw the b and y in `currentColor` ink at 1.75 px equivalent and the y's underline stroke in `--accent`, at 26 px with no tile. Keep the filled tile for the favicon and PWA icons only.
    - **Why:** this makes "the line in byline" the brand element, which is what makes it ownable.
12. **[major · shared · all tabs on scroll]** Add a top-edge fade so scrolled content doesn't crowd the floating pill.
    - **Problem:** settings text currently runs right up to the pill.
    - **Fix:** add a fixed, non-interactive `::before` strip behind the top row: 72 px tall, `linear-gradient(var(--bg) 55%, transparent)`, shown only when `scrollY > 8`, with an opacity fade over 240 ms.
    - **Budget:** no backdrop-filter, so the glass budget is unchanged.
13. **[major · feed-dossier · feed]** Fix the Feed list surface.
    - Remove the ~125 px empty band at the bottom of the list tile (drop the min-height, so the tile ends 0 px after the last row's border).
    - Add a one-line legend in the list header: "■ first-party ◆ independent ○ commentary", in the same 12 px meta style as "19 stories · last 7 days".
    - Pull the date column in: give the date a fixed 64 px column immediately after meta, not `margin-left:auto` against the tile edge.
14. **[major · search-system · search]** Clean up the Search chips and Refine panel.
    - Hide quick-search chips whose count is 0, or show them dimmed and non-interactive under "No matches yet".
    - Remove the proportional underline bars under the Refine counts (they're unexplained mini graphs). The count alone is enough.
    - Align the Refine tile's top with the results group header (y 499 at 1440): both start on the same row.
15. **[major · search-system · sources]** Make Sources rows even.
    - Stop the DEMO tag from wrapping (`white-space:nowrap`, placed after the URL line).
    - Strip the redundant "DEMO · " prefix from the displayed name when `is_demo` (display only, not data).
    - Fix row height at 56 px.
    - Fill the empty Sync cell on demo rows with a muted "demo" label, so the right column stays aligned.
16. **[major · career-publish · employers]** Fix the Employers headline and table.
    - **H1:** shorten to one finding of at most 2 lines at 1440, e.g. "4 employers lead with 2 stories each." Move the names into the one-liner.
    - **PEOPLE column:** hide it when every value is 0, since the one-liner already says "No people linked yet".
    - **Buttons:** give Pin and Unpin the same button style (both secondary, sm); only the label changes.
17. **[minor · career-publish · career]** Fix Career table widths and KPIs.
    - Set the skill column to at least 200 px with `white-space:nowrap`, so skills don't wrap onto two lines.
    - Replace the "0/0 experiences public OK" KPI with a sentence ("No experiences yet · add one") or drop it.
    - Make the right column sticky (as in fix 6).
18. **[minor · career-publish · people]** Give the People table room. At 1440, widen Person to 34% and drop the "(do not contact)" repetition under Next step, since the DO NOT CONTACT tag already says it. Rows then drop from 4 lines to 2–3.
19. **[minor · shared · phone shell]** Fix the clipped phone status pill.
    - **Problem:** at 390 px the pill is cut off at "0 new · 1".
    - **Fix:** at ≤ 480 px, show the short form "No. 1 · Wed 18 Nov · Ran 6:28 PM · 7 above 55" and drop "0 new" and "19 ranked". Or make it horizontally scrollable with a 16 px end fade mask.
20. **[minor · shared · tab switch]** Bring page-head actions into the stagger.
    - **Problem:** on Today→Feed, frame 0 shows Feed's "Add story URL" button at full opacity over the still-fading Today head.
    - **Fix:** include `.page-head` action buttons in the `enterItems` stagger with the lede, and keep them at opacity 0 until the old view's exit has finished (220 ms).
21. **[minor · today · today, phone]** Put the ring above the title on phone. At ≤ 480 px, place the lead tile's score ring (at 64 px) inline with the topic pills, so the title gets the full 326 px width instead of wrapping to 3 lines in about 190 px.
22. **[minor · calendar-studio · calendar]**
    - Show full outreach names in chips. At least 14 characters before truncating ("Test Alumna", not "Test A."), with the full name in `title`.
    - Don't ellipsise the day-panel hint: let it wrap to 2 lines.
    - Swap the literal `border-radius:6px` on `.cal-open`, `.cal-chip` and `.cal-pick` for `var(--r-tag)` or `var(--r-ctl)`.
23. **[minor · career-publish · performance]** Make the CSV example look like an example. Replace the sample numbers in the textarea placeholder with column names only ("draft_id,impressions,reactions,…"), so example values can't be mistaken for data.
24. **[minor · shared · docs/harness]** Restore `docs/design/council-v4/round0-D-surfaces.md` as markdown. It's 0 bytes in the tree; commit `1a216e0` stored it as a JSON `{"message": …}` blob. DECISIONS cites "D §1–§5" from it.

## Why the scores sit where they do

- **Shell and identity: A-tier.**
  - The rail rhythm, the dossier coupling, the two-surface glass budget and the Proof theme all read as deliberate, Linear-grade work.
  - Night is a true neutral graphite with a well-behaved tinted pill and dossier.
- **Page level: B+.**
  - The dominant failure is unequal column heights that leave dead white. This happens on Today row 3, Campaigns, Studio, Career, People and Performance.
  - The user called this out in every round ("lots of unused space", "big empty space right of the sources list").
  - Second come small inconsistencies that make the system feel less exact: table header sizes, Pin/Unpin styles, a flat-versus-tiled dossier column and ragged Sources rows.
  - Fixes 1–4 plus 6 and 10 would lift Today and the dossier to about 90, and Career, Campaigns and Studio to about 85.
