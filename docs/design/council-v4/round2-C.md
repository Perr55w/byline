# Council C, round 2: motion feel and whole-product verdict (v4 HEAD e010f0f)

Lens: overall lead and motion feel (the heading settle, tab switches, the dossier flight, count-ups, fades versus pops), plus the A-tier verdict for the whole product. I scored from scratch on the live build.

## How I looked

- **Live app on :4451**, Playwright at deviceScaleFactor 1.
  - **Coverage:** all 14 routes plus `#/draft/1`, `#/person/4` and `#/story/16`, in Proof and Night at 1440, and in Proof at 390.
  - **Dossier:** opened from a Feed row and from the Today lead, collapsed and re-expanded the rail with it open, scrolled it, then closed it with Esc.
  - **Interactions:** a hover on the Today lead, a theme switch, and tab switches between Today, Feed, Calendar, Sources and Performance.
- **Motion evidence:**
  - A 25 s session video, cut into contact sheets: the load, Today→Feed, the dossier open from Feed and from Today, the rail collapse with the dossier open, the close, and the theme switch.
  - An in-page rAF sampler with no video overhead, recording per-frame gaps and `rail.right` against `dossier.left`.
- **Gates on :4461:** `--only E1,E2`. E1 FAILS (29/32) and E2 FAILS (7/12); the numbers are below.
- **Console:** no errors on any route.
- **Captures:** `/tmp/claude-0/council-C-r2/`. Contact sheets are in `frames/`, the video is in `video/`, and the full-page shots are `<route>-{d,p}-{light,dark}.png`.

## What changed since round 1 (verified live)

**Fixed:**
- **Today load order.** The headline settles first, blur clearing over about 1 s. Then the one-liner, the "Run today's workflow" button and the banner arrive together. Then the tiles, then the count-ups. The read order is now headline → sentence → tiles. Fixed.
- **Count-up.** The exponential ease-out with the ring on the same progress is still good. The rings now show a real quality gradient: 78 is deep blue, 72 is mid and 64 is light, and the ring stroke carries a light→dark gradient.
- **Dossier flight.** The title, ring and pill now ride inside the panel's clip. I saw no superimposition on the page h1 in either source. The source tile fades instead of vanishing. The scrim reaches its value quickly.
- **Dossier geometry.** The panel no longer fills the screen: about 160 px of Feed stays visible at the right. It aligns with the rail's top and bottom (12/888).
- **Rail with the dossier open.** The rail stays undimmed and clickable over the dossier. Collapsing it reflows the panel exactly: `dossier.left = rail.right + 12` on every sampled frame, 256 → 88 and back. This is the user's must-fix, and it is met.
- **Today row 3.** Restructured. The mini graph is gone, and the News weather and News map are clearly explained.
- **Weakest tabs.** Performance, Studio and the draft view are rebuilt into real working surfaces.

**Still rough:**
1. **Tab switch double exposure.** At about 300–350 ms after the click, the old h1 ("Agent orchestration dominates…") and the new h1 ("7 of 19 stories this week…") are both visible at roughly 0.2–0.3 opacity, superimposed in the same grid cell (`frames/tf-stack.png`, frame 2). `ENTER_BASE = 120` starts the new heading while the old page is still at about 0.3.
2. **Dossier lull and pop.** When the story is not prefetched (a quick click), the panel lands with only the head: title, ring and pill. For about 400–600 ms the rest of the 870 px panel is empty white. Then the whole body appears at once. That reads as a pop, not a settle.
3. **Frame budget (gates).**

   | Measure | Result | Limit |
   |---|---|---|
   | E2 open, longest frame, desktop | 77 ms | 50 |
   | E2 close, frame p95 at 1× | 50 ms | 20 |
   | E2 rail collapse with the dossier open, frame p95 at 4× | 71 ms | 50 |
   | E2 phone close, longest frame | 55 ms | 50 |
   | E1 Today, longest frame at 4× | 76 ms | 50 |
   | E1 Settings, longest frame at 4× | 72 ms | 50 |
   | E1 Feed, longest frame at 4× | 62 ms | 50 |

   The worst script attribution is only 8–15 ms each time, so the cost is rendering: style, layout and paint of large freshly inserted DOM. My sampler also shows 50–83 ms frames at 800–1200 ms after an open, when the below-fold sections render.
4. **Theme switch.** The rail and segmented toggles flip almost immediately, while the content surfaces are still cross-fading. In one mid frame the lede is grey on grey. C-theme still passes, but it reads as two speeds.
5. **Hover pooling.** The light pooling under a hovered tile turns the surrounding dash rows blue, which reads a little like graph paper. It is acceptable, and the hue is now clearly stronger than Edition's, as asked.

## Rubric (0–10; overall /50)

| | Score | Why |
|---|---|---|
| unique_typography | 8.5 | The Newsreader display cut with the opsz settle, Geist UI and Geist Mono data are disciplined across all 17 surfaces. The title/meta step is strong everywhere. |
| color_cohesion | 8 | The quality ramp now reads as a gradient: rings, and filled versus tinted chips. The blue budget is respected. Amber is used only for honest state banners. The Sources health bar's saturated green/red is the one loud spot. |
| theme_cohesion | 8.5 | Proof and Night are clearly one product. Every tab shares the head, tiles, tables and empty-state voice. |
| motion_cohesion | 8 | The settle, count-up, hover, rail coupling and dossier flight now speak one language. Two things break it: the tab-switch double exposure and the dossier body pop-in. |
| motion_smoothness | 7 | Headings and the flight are smooth to the eye, but E1 and E2 fail. Close p95 is 50 ms at 1×, rail collapse p95 is 71 ms at 4× with the dossier open, and post-flight renders cause 50–83 ms frames. |
| generic_typography | 2 | Not generic. The one slip is mono-caps card eyebrows ("ABOVE YOUR BAR, NO DRAFT YET", "BIGGEST BRIDGE", "CADENCE", "LATEST RUN"). |
| background_generic | 2 | The ruled field is quiet on reading views and softened under heads. It is distinctive enough, and the right-edge seam is gone. |
| color_combo_generic | 2.5 | White with electric blue is still the stock pro-tool pairing. The ramp and the warm amber state colour add some identity, but not much else does. |
| motion_generic | 2 | No banned curves, shimmer, sheen, tilt or per-character effects. |
| ai_slop | 2 | Headlines are findings and every number is real. Residual: identical repeated rows (Video · explainer ×2, the same title ×3 in "Closest to publishing", 10 identical run rows) and the card eyebrows. |
| **overall** | **40** | The strongest Byline yet, and it clears 38. It is not A-tier (45+) until the dossier and tab-switch moments are frame-clean and the remaining white-space and repetition issues on the Career and Publish tabs are fixed. |

Against the bar, motion_smoothness (7) and color_combo_generic (2.5) still fail.

## Tab scores (out of 100)

| Tab | Score | Why |
|---|---|---|
| rail | 89 | Groups, a sliding highlight, an even collapsed rhythm and the by—line mark with a blue underline that reads at 26 px. It stays live over the dossier, and collapsing reflows the dossier exactly. |
| today | 89 | Every user ask is met: issue number and date, a finding headline, a numeric one-liner, the ring gradient with no tick, why-ranked bullets, News weather, a map plus top 3, and the load choreography. Short of 90: This week has about 70 px of dead interior under "Nothing planned yet", the lead tile has about 40 px of air above "Why it ranked", the mini map's nodes are tiny, and E1 has a 76 ms frame. |
| dossier | 88 | The content is excellent: per-source key claims, a first-party warning, track length = weight, and it adapts to the rail without filling the screen. Short of 90: a body lull then pop when not prefetched, open 77 ms / close p95 50 ms, and a "Primary" tag on both posts, with the first source row repeating the story title. |
| feed | 89 | A big headline/meta step, ramp chips, top-two topics, glyph legend, threshold divider and a quiet background. No empty tail. |
| map | 86 | A real, clickable, labelled map with a bridge card and legend. Clutter: every single-node topic draws its own grey halo, the "Analytics" and "Business adoption" labels collide, a truncated label floats away from its node, and the Hottest-topics bars are unlabelled mini graphs. |
| search | 88 | Big bar, keyboard hints, entity chips, grouped results, and drafts and notes deduplicated (×17). Story score chips next to claims (16, 59) are bare numbers. The `contain-intrinsic-size` (560) doesn't match the real section heights. |
| studio | 85 | Now a workshop: a review card with an approval checklist, and the "above your bar, no draft yet" rail. Draft rows are indistinguishable (Video · explainer ×2, Instagram · carousel ×2, all "1d ago"). The right column ends about 800 px early. |
| calendar | 86 | Month grid, readable "N stories" plus quality dots, open slots, a tray and cadence. The tray repeats identical format rows, legend swatches look alike, "This wk" is cramped, and "Test Alumna" is shown twice on 2 Dec. |
| campaigns | 83 | An honest, useful empty state. But the story list mostly duplicates Feed, there is no visible per-row action, and the right column ends at about 815 px, leaving a large blank. |
| performance | 83 | A big improvement: the funnel, closest-to-publishing, open slots and CSV import fill the page. The edit-date chart is 13 empty bars and 1 full one, and "Closest to publishing" shows the same title three times. |
| career | 82 | The duplicate-job honesty is great. The one-liner is hard to parse ("In 1 of 1 saved job post…"), the Trend column is empty on 23 rows, the sort order is inconsistent (2 after a run of 1s, jobs-only rows mid-table), and the right column ends about 550 px early. |
| employers | 82 | Clear coverage with a parent-company note. Ten rows of Pin/Edit/Activity button triplets, two different "pin" concepts (employer and watchlist), and no story titles behind the counts. |
| people | 86 | Overdue follow-ups, a duplicate warning, a pipeline by stage and a do-not-contact flag, all honest. "Short (200 chars)" wraps, and the duplicate contact appears twice in the queue. |
| sources | 87 | Exactly the information the user asked for: before/after-pause health, per-source 7-day, stories, last sync, demo tags and an evidence type. The Health column says "Paused" ×26 and hides the more useful prior state. |
| runs | 87 | A clear stage timeline, honest cost and explained failures. Ten identical "Done · 0 sources read" history rows could collapse into one. |
| settings | 85 | Strong structure: health summary, priorities with weights, collapsed long sections. Budget shows an amber "limit reached" on a deliberate $0 limit, which reads as an error, and term inputs truncate. |

## Fixes (priority order; one owner each)

1. **[blocker] shared: dossier close and rail-collapse frame cost (E2).**
   - **Close.** Close p95 is 50 ms at 1×. When the source rect is less than 30% of the panel height, close with opacity 1→0 plus `transform: translate()/scale()` toward the source over 360 ms. Animate `clip-path` only on the head band. Set `will-change: transform, opacity` on `.dossier-panel` for the duration only.
   - **Rail collapse with the dossier open.** p95 is 71 ms at 4×. Set the panel's final `left`/`width` once at the start (one layout), then animate `transform: translateX(delta→0)` on `.dossier` on `--ease-move` over 420 ms. Never relayout the panel per frame.
   - Keep the `dossier.left ≥ rail.right` assertion; the transformed rect still satisfies it.
   - **Target:** E2 close p95 ≤ 20 ms at 1×, collapse p95 ≤ 50 ms at 4×.
2. **[blocker] feed-dossier: post-flight render chunks (E2 open 77 ms).**
   - `afterFlight` produces 50–83 ms frames 800–1200 ms after open.
   - In `story-dossier.js`, render each below-fold section (Evidence, Lens, Employer connections, Drafts, Tune) in its own task, at ≤ 6 ms per chunk, using `scheduler.yield()` or `requestIdleCallback({timeout: 200})`.
   - Insert each section with `content-visibility: auto; contain-intrinsic-size: auto 320px`.
   - Read no layout during these renders.
   - **Target:** longest frame < 50 ms in the 0–1500 ms window, desktop and phone at 4×.
3. **[blocker] shared: tab-switch double exposure.**
   - In `app.js` `leave()`, give `.leaving .page-head` its own 140 ms opacity fade (`--ease-exit`) so the old h1 is below 0.05 by 150 ms.
   - Start the new h1 at `ENTER_BASE + 50` (170 ms). Leave the rest of the cascade at 120 ms.
   - **Accept** when no sampled frame has both the old h1 and the new h1's line 1 above 0.08 opacity.
4. **[major] shared: dossier placeholder lull.**
   - When the data isn't ready, `placeholderHtml()` currently shows only the title. Render a section-shaped skeleton instead:
     - a lede of 2 bars;
     - an actions row of 3 pills;
     - two columns of 4 bars each, `--surface-2`, radius 5.
   - Breathe it on an 1800 ms sine (opacity .55↔.8), with no shimmer, so the 870 px panel never sits blank.
   - Also call `dossier.prefetch(id)` on `pointerdown` and `focusin` of any `[data-dossier-src]`, not only on hover.
   - Keep the 240 ms body crossfade on arrival.
5. **[blocker] today: remove the remaining dead interior (Today < 90).**
   - **This week:** move "Nothing planned yet. 22 drafts are in the tray." directly under the 7-day legend, and drop the tile's min-height or stretch. The target is ≤ 32 px of unused interior at the bottom of This week, with Waiting on you aligned.
   - **Lead tile:** cut the space between the finding and the Why-it-ranked divider from about 40 px to 20 px.
   - **Mini News map:** scale node radius 4→6–9 px by score, and label the top 3 nodes with `short_title` so the tile reads at a glance.
6. **[major] today: E1 Today long frame (76 ms at 4×, import.then).**
   - Render the head and the three story tiles in the swap frame.
   - Build News weather (the SVG dot rows), the mini map, This week, Waiting on you and Also in the brief in idle chunks after the heading's first frame, at ≤ 6 ms each.
   - Use `content-visibility: auto` on the bottom two rows.
7. **[major] feed-dossier: E1 Feed long frame (62 ms at 4×).** Render the first 10 rows synchronously and the rest in one idle chunk. Rows below the fold already have `cv-row`; make sure `contain-intrinsic-size` matches the real row height (about 78 px) so the scrollbar doesn't jump.
8. **[major] search-system: E1 Settings long frame (72 ms at 4×, setTimeout in settings.js).** Split the deferred section render into per-section tasks (`scheduler.yield()` between Priorities, Threshold, Schedule, AI provider and Budget). Keep `content-visibility: auto` on the collapsed Writing, Publishing and System groups.
9. **[major] calendar-studio: make draft rows distinguishable.**
   - In Studio's story groups and the Calendar tray, each draft row shows the format plus the first 60 characters of its hook (text-2, one line, ellipsis) and its created time.
   - Collapse drafts that share format and hook into one row, e.g. "Video · explainer ×5", which expands.
   - Make Studio's right column `position: sticky; top: 84px` so it doesn't end 800 px early.
10. **[major] calendar-studio: draft view tab strip.** "History" is still clipped at the panel's right edge on `#/draft/1`. Fit all six tabs (Review, Preview, Notes, Visual, Sources, History) at 1440 with the rail expanded: gap 14 px and 13 px labels, or put the last two in a "More" menu. Nothing may clip.
11. **[major] career-publish: rewrite the Career one-liner and fix the table.**
    - The one-liner reads: "Agents: 10 source mentions this week and named in your 1 saved job post (7 copies counted once). AI governance was a story topic on 3 days but appears as a skill only in job posts."
    - Drop the Trend column while there is less than 2 weeks of history, and keep the note in the table foot.
    - Sort by one visible rank (mentions + 2 × job hits) with no exceptions.
    - Make the right column sticky to remove the 550 px blank.
12. **[major] career-publish: Employers row actions.**
    - Replace the Pin / Edit / Activity triplet (×10) with a single ghost "Activity →" plus a ··· menu (Pin/Unpin, Edit).
    - Under each bar, list up to 2 story titles behind the count (Newsreader 13, text-2, links that open the dossier).
    - Rename the watchlist chip's pin action to "Follow", so "Pinned" means one thing.
13. **[major] career-publish: Performance repetition and empty chart.**
    - Replace "Last edit per open draft · 14 days" (13 empty bars) with a single labelled stat: "All 22 open drafts last edited Wed 18 Nov". Bring the chart back once edits span ≥ 3 distinct days.
    - In "Closest to publishing", group by story: one title with format chips (LinkedIn · roundup, In review; Video · explainer; Instagram · carousel) instead of the same title three times.
14. **[major] career-publish: Campaigns layout.**
    - Make the right column sticky (`top: 84px`).
    - Give each story row a hover/focus ghost action "Start a campaign from this story", so the list isn't just Feed again.
    - Group the 7 rows by main topic (Agent orchestration 3, Business adoption 2, AI governance 1, Evaluation 1), matching the right-hand summary.
15. **[major] map: de-clutter regions and labels.**
    - Draw a hull or contour only for topics with ≥ 3 nodes. Drop the per-node grey halo discs.
    - Run label collision avoidance: today "Analytics" and "Business adoption" overlap at about (560, 510) at 1440.
    - Anchor story labels to their node with a 6 px offset, and hide a label if it would sit more than 24 px from its node.
    - Give the Hottest-topics bars a visible value ("heat 12") and a title tooltip, or remove them. Unlabelled mini bars violate SPEC §0.
16. **[minor] feed-dossier: source list wording.**
    - Only the earliest first-party post gets "Primary". Label the others "Same outlet".
    - When a source post's title equals the story title, show its key claim instead of repeating the title.
17. **[minor] shared: dossier and topbar.** The panel's right edge bisects the topbar's Search button ("or jump Ctrl K" peeks out). While the dossier is open, fade `.topbar` to opacity .25 over 240 ms, or let the scrim cover it.
18. **[minor] shared: theme switch at one speed.** The rail fill, the rail's active item and the segmented toggle flip in 1–2 frames while content cross-fades over 600 ms. Put them on the same `--dur-theme` colour transition. Make sure `.lede` text colour transitions with the surfaces, so no frame shows grey-on-grey lede text (contrast stays ≥ 3:1 throughout).
19. **[minor] search-system: Search score chips and sizing.**
    - Claim rows end in a bare story score (16, 59). Render it as the quality chip with `title="Story score 59"` and the visible text "story 59".
    - Set `.sr-group.cv { contain-intrinsic-size: auto 440px }`. It is 560 now, while the real heights are 146–444.
20. **[minor] search-system: Settings budget state.** With a monthly limit of 0, replace the amber "limit reached" tag with a neutral "Paid AI off · local engine only", and show "$0.00", not "$0.0000".
21. **[minor] search-system: Runs history.** Collapse consecutive runs with an identical outcome into one expandable row: "#7–#16 · 10 runs · Done · 0 sources read · 18 Nov 6:25–6:28 PM".
22. **[minor] search-system: Sources health column.** When every source is paused, lead with the prior state ("was failing · 404", "was healthy", "stale"), shown as the paused icon plus that text, instead of "Paused" ×26. Keep the Paused filter chip.
23. **[minor] calendar-studio: Calendar polish.**
    - Fill the legend swatches (draft = dashed, approved = solid outline, scheduled = blue tint) so they match the cells.
    - Give the cadence cells room for "This week", or use "W47".
    - Collapse identical outreach on one day into "Test Alumna ×2".

## Verdict

Round 1 fixed the things that mattered most to the user:
- The dossier no longer fills the screen and adapts to the rail on every frame.
- The quality gradient is visible.
- The Today entrance reads headline → sentence → tiles.
- The weakest tabs (Performance, Studio, the draft view) are now real working surfaces.

The product is honest, calm and consistently typeset, and it clears the 38 overall line at **40**.

It is not A-tier yet, for three reasons:
- **Motion is clean to the eye but not frame-clean.** E1 and E2 still fail, the tab switch double-exposes the headings for a frame or two, and the dossier body pops in after an empty lull.
- **Today and the dossier sit just under 90**, because of small dead areas and that open/close cost.
- **The Career and Publish tabs (Career, Employers, Campaigns, Performance) still lose points** to repeated rows, button noise and right columns that stop early.

Fixes 1–4 make the signature moment (opening a story) and every tab switch flawless. Fixes 5–6 take Today past 90. Fixes 9–15 lift Studio, Career, Employers, Campaigns, Performance and Map past 85.
