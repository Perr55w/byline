# Critic D (Surfaces): round 4 scoring

**Lens:** surfaces, layout, spacing rhythm, rail, tiles, dossier panel geometry, white-space balance, radii, glass budget, phone layout.

**Build:** v4 HEAD (`ad8490c` integrated, plus the round 4 B and C review commit), served on :4452.

**What I looked at**
- **Every route:** today, feed, map, search, studio, draft/1, calendar, campaigns, performance, career, employers, people, person/4, sources, runs and settings.
  - Proof and Night, at 1440×900 and 390×844: 64 captures, full-page for desktop Proof.
  - Lazy groups were checked by scrolling. Search's Contacts and Briefs groups use `content-visibility`, so a plain full-page capture leaves them blank.
- **Dossier**
  - Opened from a Feed row (both themes) and from the Today lead (both themes), plus a phone open.
  - Scrolled to the end of both columns.
  - Collapsed the rail with the dossier open, sampling `rail.right`, `panel.left` and `panel.right` every rAF.
- **Rail:** the collapsed rail with its icon centres measured, and a tile hover on Today.
- **Collapse motion:** a per-rAF log of h1 x and tile width/height during a rail collapse on Today.
- **Gates on :4462:** E2, E3, E8, E11, E12 and E13.

Captures are in `/tmp/claude-0/council-D-r4/` (`*-d|p-light|dark.png`, `dos-*.png`, `hover-today-*.png`, `rail-collapsed-feed-*.png`, `search-bottom.png`, `draft1-view.png`, `person4-view.png`). I clicked nothing on a run, approve, publish or send path. Both servers I started are stopped.

## Measured

| Check | Result |
|---|---|
| Horizontal overflow | 0 on all 64 captures. No console errors or page errors. |
| Glass | Desktop: 1 live `backdrop-filter` (the pill), or `dossier-frost` alone when the dossier is open. Phone: `phone-bar`, plus `dossier-frost` when the sheet is open, which is 2. Within budget. E8 19/19. |
| Collapsed rail rhythm | Icon centre x = 44 for all 15. Pitch is 52 (brand), then 36 within a group and 44 across groups. E11 14/14. |
| Dossier geometry | Panel 256–1280 × 12–888, rail 12–244 × 12–888, so top and bottom match the rail. The 160 px right margin shows the page behind, so the panel does not fill the screen. |
| Collapse with dossier open | `[rail.right, panel.left]` goes 244/256 → 234/246 → 140/152 → 82/94 → 76/88. The 12 px gap holds on every sample, and nothing slides under. The panel keeps its 1024 width, so a 328 px strip of Feed (1112–1440) shows, with readable fragments ("Evaluation", "Add story URL", "…ets · 1 independent"). |
| Dossier columns | Left and right both end within about 10 px of each other at the bottom (~840 / ~830). No dead lane. |
| Phone dossier | Two-line eyebrow (fixed). The action bar has full-width "Draft a post", then Save / Dismiss / Source. scrollWidth 390 = clientWidth. |
| E13 dead interior | 0 tiles with > 32 px dead interior on 8 routes at both sizes. |
| Settings | 0 of 19 inputs truncated. The three fold cards end on one line (2091–2496 each). Fixed. |
| Phone Feed | `.fd-topicbar` now has the 24 px fade mask. No title overflow. Fixed. |
| Search contacts | "Test Alumna ×2 · possible duplicate" on one row. Fixed. |
| Map | Canvas 345–875; the legend bar overlays 835–863. The bottom node (Gemini Omni, y ≈ 792) and its hull run to ~835, under the legend. The top band 345–410 is empty. Page = 900. |
| Calendar | scrollHeight 982 at a 900 viewport, an 82 px overrun. |
| Employers | Columns 285–659 / 659–1230 / 1230–1384. Story text ends around x 1000 on most rows, leaving ~230–300 px of dead band before "Activity →". Meanwhile the Employer cell ellipsises "Operating co…". |
| Rail collapse, no dossier (Today) | Tile width relayouts every frame: 636 → 639 → 663 → 704 → 717 over 260 ms. Height stays 597. |
| **E2** | **FAIL 10/17.** |
| **E12** | **FAIL 1/6.** Today 1×: p95 33.3 ms, style recalc 30.2 ms per collapse. Feed 1×: p95 33.4 ms. Today 4×: p95 83.3 ms. Feed 4×: p95 66.6 ms. This is worse than the integrator's run, where only Feed failed. |
| E3, E8, E11, E13 | PASS. |
| Next open posting day | Today, Studio, Campaigns and Performance say "Mon 23 Nov". The Calendar paints Fri 20 (today, a posting day with nothing planned) as "open slot", and its side panel says "Nothing planned on this posting day". The cause is `/api/slots/next`, whose loop starts at `i = 1`, so today can never be the next open day. |
| Hover pool | Hovering a Today tile lays blue dashes in a ~50–60 px band around it, in both themes. R10 caps this at 40 px. |

## Rubric

| | Score |
|---|---|
| unique_typography | 8.5 |
| color_cohesion | 8.2 |
| theme_cohesion | 8.5 |
| motion_cohesion | 8.2 |
| motion_smoothness | 7.6 |
| generic_typography | 2 |
| background_generic | 2 |
| color_combo_generic | 2 |
| motion_generic | 2 |
| ai_slop | 2 |
| **overall** | **41 / 50** |

**Why:**
- **Surfaces.** They are now one disciplined family in both themes: 16/12/8/5/999 radii, near-solid tiles, a single glass surface, and tiles that end together (E13 is clean).
- **Colour.** Blue is held to scores, the main topic and accents; amber is for state; green and red for health. The field at rest is neutral, which is why color_combo_generic reaches 2. The hover pool band is the one place blue still spreads past its rule.
- **Smoothness** stays under 8 for my lens because the rail collapse, the user's favourite interaction, is the one that fails:
  - E12 is 1/6, with 83 ms p95 on Today at 4×.
  - E2 still fails 10/17.
  - To the eye at 1× the collapse looks smooth and coupled, but it relayouts every tile on every frame.

## Tab scores

| Tab | Score | Why |
|---|---|---|
| rail | 91 | The rhythm is exact (E11), the groups explain themselves, the highlight slides, and the by—line mark reads at 26 px in both themes. It holds the 12 px gap to the dossier on every frame. The collapse itself still misses its frame budget (E12). |
| today | 91 | Issue line, a finding headline, a numeric one-liner, ring without tick, why-ranked bullets, weather, a clickable mini-map with top 3, and tiles that end on shared lines. Held at 91 by the lead tile saying "6 posts from 1 outlet" twice, the hover pool band, and "Next open posting day Mon 23 Nov" contradicting the Calendar's open Fri 20. |
| dossier | 90 | Geometry is right: rail height, it doesn't fill the screen, it adapts on collapse without sliding under, and the columns end together. The sources section summarises what each post said. Not higher: the 328 px half-readable ghost strip after a collapse, "You can try it · matched available" reading as a template, and E2 failing. |
| feed | 90 | A strong headline/meta step, banded score chips, top-two topics, glyph legend, threshold divider and a quiet field. Phone overflow fixed. The right-hand date lane repeats "18 Nov" on 16 of 19 rows. |
| map | 87 | A real, clickable, legible map with a non-scrolling side panel. The graph sits low: 65 px empty on top while the bottom node and its hull run under the legend. On phone the bottom region label is cut. |
| search | 89 | Big bar, keyboard hints, labelled chip rows with fades, grouped useful results, sticky Refine, grouped duplicate contact. |
| studio | 87 | Review lead with checklist, grouped ×N rows in locked columns, sticky side column. The date column appears on only 2 of 9 rows, so the right edge looks broken. |
| calendar | 88 | A real month with no day/date gap, honest "missed", open slots, tray and cadence. It overruns a 900 px viewport by 82 px, and its "open slot" on Fri 20 disagrees with every other tab. |
| campaigns | 87 | Grouped by topic, one action per story, a non-redundant sticky side column. Rows are a little tall (meta on 2–3 lines). |
| performance | 87 | Compact funnel, honest edit-date sentence, the "18 of 22 for one story" finding, slot lines said once, and bottoms aligned within 17 px. |
| career | 86 | Duplicate-job honesty, KPIs that don't wrap, a non-contradictory topic tag. The skill radar is long: 15 rows plus a fold, with several "Jobs only" rows carrying empty bar lanes. "Evaluation" and "Evals" are still separate rows. |
| employers | 86 | Now over the line: watchlists folded into the cell, one "No stories yet" row, "Same 2 stories as…" instead of repeats. Still a 230–300 px dead band in the Stories column while the Employer cell ellipsises its topics. The headline "4 employers tie" counts the same two Google stories three times. |
| people | 88 | Overdue follow-ups, a duplicate warning with both records, a pipeline, and an outreach table with an aligned duplicate tag. |
| sources | 88 | Rich health strip with a before-the-pause bar, demo tags, and evidence and sync columns. 17 identical "Sync" buttons on rows that are all paused add noise. |
| runs | 88 | Clear stage timeline, honest $0.00, grouped repeats, latest-run tile and side cards in balance. |
| settings | 88 | Terms wrap in full, fold cards align, sticky sub-nav, source-health card. The floating "Ranking" and "Automation" labels between cards look orphaned. |

## Fixes, most score-moving first

1. **[blocker · shared · rail]** E12 rail collapse pacing (Today 4× p95 83 ms, Feed 4× 67 ms, 1× p95 33.3/33.4 ms).
   - **Cause:** every frame relayouts every tile, because `.main` padding interpolates with `--rail-w` (tile width 636 → 717 over 260 ms).
   - **Step 1:** make the relayout cheap.
     - Give `#view > .page > section`, `.tile` and `.grid > *` `contain: layout paint`.
     - Give below-the-fold sections (Today's News weather, This week and Also in the brief; Feed rows after 8) `content-visibility: auto` with `contain-intrinsic-size: auto <measured>px`, so a collapse lays out only the first screen.
   - **Step 2**, if the 4× p95 is still > 50 ms:
     - Keep `--rail-w` on the rail and the dossier.
     - Step `.main` to its final padding at collapse start and animate `#view > .page` with `transform: translateX(±Δ → 0)` on `--dur-layout` / `--ease-move`.
     - **This bends DECISIONS ("`--rail-w` drives the `.main` padding").** The user's ask, that content reflows and nothing slides under, is still met, because the content moves with the rail edge.
   - **Target:** E12 6/6, with 4× p95 ≤ 50 ms and 1× p95 ≤ 33 ms on Today and Feed.
2. **[blocker · shared · dossier]** E2 is 10/17 in my run.
   - Take C's fix: no `getBoundingClientRect()` on the freshly inserted body in the hashchange task. Use the no-fly path when the prebuild isn't ready, and build the attached prebuild on `pointerover`.
   - Re-run E2 three times; it must pass every time.
3. **[major · shared · today/calendar/studio/campaigns/performance]** One "next open posting day".
   - In `src/routes/content.js` `/api/slots/next`, start the loop at `i = 0` when today is a posting day, nothing is planned for that channel, and the local time (in `settings.timezone`) is before the posting time (or the end of day if none is set).
   - Add a unit test: Fri 20 Nov, posting days Mon/Wed/Fri, no drafts → `2026-11-20`.
   - Today, Studio, Campaigns and Performance then agree with the Calendar's "open slot" on Fri 20.
4. **[major · map · map]** Fit the graph to the visible stage.
   - Compute bounds from the nodes, the hull padding (24 px) and the label extents.
   - Fit them into `[canvas.top + 24, legend.top − 16]` × `[canvas.left + 24, canvas.right − 24]`, centred.
   - Today the top 65 px is empty while the Gemini Omni node and its hull run under the legend (835–863).
   - On phone, apply the same fit so the bottom region label isn't cut.
   - Draw a hull for every top-3 topic with ≥ 3 nodes ("Business adoption · leads 4" has none, so its pill floats). Otherwise render that label as plain text-3.
5. **[major · today · today]** The lead tile says the same counts twice: "Evidence is thin: 6 posts from 1 outlet…" and then "Source mix · 6 posts · 1 outlet · all first-party".
   - Replace the Source mix block with one meta row merged with Named: `cloud.google.com · Google Cloud — AI & ML blog · first-party`.
   - The lead will end ~50 px higher. Let the right column's two tiles set the row, and pin the lead's footer link to the bottom, as now. E13 must stay 0.
6. **[major · shared · today]** Hover pool radius (bg.js).
   - The blue dash band around a hovered tile measures ~50–60 px in both themes, against R10's 40 px.
   - Set the falloff to 0 at 32 px from the tile edge, and multiply the pool gain by 0.6.
   - Keep the lift and tint as they are.
7. **[major · career-publish · employers]** Fix the dead band and the misleading headline.
   - **Columns:** grid `minmax(300px, 40%) 1fr 96px`, so the Stories column ends where its text does (~x 1000 today) and Activity sits right after it. Let the employer's topic line wrap to 2 lines instead of ellipsising ("Operating co…").
   - **Headline:** when tied employers share the same story set, count distinct story sets.
     - h1: "Google's two Gemini stories lead: 3 Google units and AWS each appear in 2."
     - Or the neutral fallback: "AWS and Google each appear in 2 stories."
8. **[minor · shared · dossier]** The ghost strip after a collapse.
   - The 328 px strip (1112–1440) is still readable ("Evaluation", "Add story URL").
   - Raise the effective scrim over the area right of the panel to .92 while `html.rail-collapsed` and the dossier is open. It's an opacity-only layer of `--bg` (R5), so there is no blur and the glass count is unchanged.
9. **[minor · feed-dossier · dossier]** "Why it's post-worthy · You can try it · matched available" reads like a template.
   - Render the sentence that contains the match, as "It changes a process" already does: a quote block with the source domain.
   - When no sentence is found, show "You can try it" with a check and no "matched" text.
10. **[minor · calendar-studio · calendar]** Fit 1440×900.
    - Cut month cell min-height from 89 px to 78 px (6 rows → −66 px).
    - Move the legend into the grid card's header row (right of Month/Week), saving another ~40 px.
    - Target: scrollHeight ≤ 900 at 1440×900.
11. **[minor · calendar-studio · studio]** The draft-row date column appears on only 2 of 9 rows ("1d ago").
    - Either show the edit age on every row (the grouped ×N rows use the newest edit), or drop it from rows, since the group header already says "edited 1d ago".
12. **[minor · feed-dossier · feed]** The date lane repeats "18 Nov" on 16 of 19 rows.
    - Show a date only when it differs from the brief day ("17 Nov", "16 Nov"); leave the rest blank, with a column head "first seen" and a tooltip.
    - Or move the date into the meta line and give the 80 px to the title, so fewer titles wrap.
13. **[minor · search-system · sources]** Paused rows show 17 identical Sync buttons.
    - When a source is paused, replace the button with a quiet text-3 "paused" label, or show the button only on hover/focus (keep it focusable).
    - Keep the button visible on enabled rows.
14. **[minor · search-system · settings]** The "Ranking" and "Automation" labels float between cards with no surface.
    - Either style them as the sub-nav group eyebrows (mono 10, uppercase, `--text-3`, 24 px top margin, aligned to the card's left inner edge), or remove them, since the sticky sub-nav already groups the sections.
15. **[minor · career-publish · career]** Fold "Evals" (3) into "Evaluation" (9) with "also evals (3)", as "Agents" already folds in "agentic".
    - Drop the empty bar lane on "Jobs only" rows; show a text-3 "—" in the bar cell instead.

## What would clear the bar

- **motion_smoothness ≥ 8:** fixes 1 and 2 (E12 and E2 passing three times in a row).
- **today and dossier above 90 with margin:** fixes 3, 5, 6, 8 and 9.
- **Map, Calendar and Studio to 88–89:** fixes 4, 10 and 11.
- **Employers to 88:** fix 7.
