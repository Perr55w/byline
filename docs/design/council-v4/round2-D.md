# Critic D (Surfaces): round 2 scoring

**Lens:** surfaces, layout, spacing rhythm, rail, tiles, dossier panel geometry, white-space balance, radii, glass budget, phone layout.

**What I looked at:** the live app on v4 HEAD `e010f0f`, served on :4452.
- Every route plus `draft/1` and `person/4`, in Proof and Night, at 1440×900 and 390×844. That is 64 captures, with full-page captures of the Proof desktop routes.
- The dossier, opened from a Feed row, from the Today lead tile and from a phone deep link. I scrolled it through four screens and collapsed the rail with it open, sampling every 35 ms.
- Tile hover in both themes, rail hover and the collapsed tooltip.
- The load entrance (12 frames at 110 ms) and the Today→Feed switch (10 frames, plus a per-rAF log of scrollY and h1).
- Sticky right columns after scrolling, and the phone bottom bar's current state.
- I ran gates E2, E11 and E12 on harness port 4462.

Captures are in `/tmp/claude-0/council-D-r2/`. I clicked nothing on run, approve, publish or send paths.

## Measured

| Check | Result |
|---|---|
| Collapsed rail rhythm | Pitch is 36,36,36,44,36,36,36,44,36,36,44,36,36. Every icon centre x is 44, the rail centre. E11 passes 14/14. |
| Rail collapse pacing | E12 passes 6/6: p95 is 16.8 ms at 1× and 33.3 ms at 4×. |
| Dossier geometry | The panel spans 256–1280 × 12–888, with the rail at 12–244 × 12–888. Top and bottom match the rail exactly. |
| Rail collapse with the dossier open | `[rail.right, panel.left]` samples: [244,256] → [214,226] → [157,169] → [82,94] → [76,88]. The 12 px gap holds on every sample, so nothing slides under. |
| Dossier columns | Left column ends at 2118 and right at 2089, a 29 px difference. Round 1 had about 700. Employer connections are deduped into one chip group with a single quote. |
| Glass budget | 1 live backdrop-filter on every route; 2 with the dossier open. Passes. |
| Horizontal overflow | 0 on all 64 captures. No console errors. |
| Sticky right columns | Studio, Campaigns and Career right columns are now sticky. Round 1's 300–700 px dead bands are gone. |
| **Tab switch scroll jump** | **Fails.** With Today scrolled to 900, `location.hash='#/feed'` sets scrollY to 0 on the very next frame (31 ms). The old Today view then stays at full opacity for about 230 ms, scrolled to its top, before Feed's h1 appears. The user sees the page jump to the top, then change. |
| **E2** | **Fails, 10/12.** The longest frame on desktop dossier open is 63 ms (limit 50). Desktop close p95 is 33.3 ms (limit 20), so the close runs at about 30 fps. |
| Today row 3 | `td-week` is 277 px tall and `td-desk` 330 px. That leaves a 69 px hole under This week, against 16 px gutters everywhere else. |
| Today lead tile | The tile is stretched to 597 px to match the right stack. The slack is spread as 43, 39 and 45 px gaps between sections. |
| `draft/1` review tabs | The `.st-tabs` strip has scrollWidth 416 and clientWidth 336, so "History 10" is still clipped. This was round 1 fix 7. |
| Phone dossier action bar | `.dx-actions` has scrollWidth 514 and clientWidth 345. "Dismiss" is cut at the edge and "Open primary" is off-screen, with no fade or affordance. |
| Phone bottom bar | On Search, Calendar, Sources and the other More-sheet routes, no tab is current, so More is not highlighted. |

## Rubric

| | Score |
|---|---|
| unique_typography | 8.5 |
| color_cohesion | 8 |
| theme_cohesion | 8.5 |
| motion_cohesion | 7.5 |
| motion_smoothness | 7 |
| generic_typography | 2 |
| background_generic | 2 |
| color_combo_generic | 2.5 |
| motion_generic | 2 |
| ai_slop | 2 |
| **overall** | **39 / 50** |

**Why:**
- **Surfaces and white space:** the round 1 white-space failures are fixed. The empty Career card, the stranded right columns, Map overrunning the viewport, the dossier padding and the ragged Sources rows are all resolved. The system now reads as one consistent family of surfaces in both themes.
- **Motion:** the remaining weakness is motion continuity.
  - The router resets scroll before the exit fade, so every switch from a scrolled page starts with a jump.
  - Dossier open and close miss E2, and E1 still fails on phone.
- **Colour pairing:** blue on near-white is still a familiar SaaS pairing. The quality ramp, the amber warnings and the ruled field keep it from being generic.

## Tab scores

| Tab | Score | Why |
|---|---|---|
| rail | 91 | The rhythm is exact (E11), the groups explain themselves, the highlight slides, and tooltips carry shortcuts ("Calendar G C"). The ink "by" with a blue underline no longer reads as a stock app tile. |
| today | 88 | Informative headline, numeric one-liner, issue number, why-ranked bullets, News weather and a real map tile, all good. It misses 90 on three things: a 69 px hole under This week; the lead tile's slack spread into ~40 px gaps; and "Run today's workflow ⋯" floating beside line 2 of the lede rather than on the h1 baseline. |
| dossier | 88 | The geometry and collapse tracking are exact, and "What the sources say" now gives a per-post summary and key claims. The columns balance within 29 px. Four things hold it back: the close button floats over scrolled content (it overlaps "/ 20" in the score breakdown); the 160 px strip on the right shows half-cut page chrome ("…or jump", "Add story URL") through a thin scrim; open and close miss E2; and the phone action bar clips its buttons. |
| feed | 88 | The headline and meta step is strong, the source-type legend is in the header, and the list tile ends at its last row. Minor: "Archived" wraps alone onto a second chip line, and the date column still floats about 60 px past the meta. |
| map | 87 | The stage now fits the viewport, the camera fits the nodes, and labels are mostly clear. Minor: the Hottest topics bars carry no scale, there's a ~60 px empty band at the foot of the side panel, and one long story label crosses a topic region edge. |
| search | 87 | Big bar, grouped quick chips (with a dimmed "No matches yet" row), and the Refine panel now aligned with the results. On phone, the chip rows are hard-clipped mid-word ("Busin", "eval harn") with no fade. |
| studio | 84 | The sticky right column fixes the dead band. But a story's draft rows repeat identically ("Video · explainer", "Instagram · carousel", ×5, all "1d ago"). The hero excerpt shows raw "My own locked hook. 1. Northwind…". On `draft/1` the review tab strip still clips "History". |
| calendar | 87 | A full month that fits one screen, with no day/date gap, grid and side panel of equal height, a legend, cadence and a tray. Minor: tray rows wrap "LinkedIn · roundup" onto two lines, and the tray story title runs four lines. |
| campaigns | 85 | An honest empty state with a sticky summary. Every story row's text stops at about 480 px of a 740 px tile, leaving a 170 px empty right lane. The "Start campaign" action that would fill it appears only on hover. |
| performance | 82 | Honest, and the tiles are now balanced. But the "Last edit per open draft · 14 days" chart is 13 empty bars and one full one, a chart that carries a single fact. "Closest to publishing" lists the same title three times. |
| career | 84 | The empty card is fixed, the headline and one-liner agree, and the right column is sticky. The TREND column is empty in 20 of 23 rows, a 160 px dead lane. JOB POSTS shows bare "1/1" and "0/1" fractions. The first KPI caption wraps. |
| employers | 84 | A rich coverage table, and employer Pin/Unpin now share one style. But team watchlists in the same row use ghost-text "Pin" and "Unpin", so there are two pin styles in one row. The watchlist column is mostly "+ Team", and the lede runs three lines. |
| people | 86 | Dense and honest: duplicate warning, pipeline and outreach. The LAST CONTACT header sits flush against the tile edge (no right padding), and Person cells wrap to 2–3 lines. |
| sources | 88 | Even 56 px rows, a Demo tag under the name, the Sync column filled on demo rows, a before-the-pause bar and three tabs. It answers the 25. Minor: the evidence cells are two-line ("First-party / blog"), which makes the table read tall. |
| runs | 87 | Clear stage timeline, cost controls and a full history table with consistent headers. The right column ends about 200 px above the latest-run tile. Acceptable. |
| settings | 85 | Shorter, with a sticky sub-nav and a real source-health card. Priority topic inputs truncate ("De-emphasize: model horse-ra"). Budget shows "$0.0000 · limit reached" when the limit is simply 0 (paid AI off). |

## Fixes, most score-moving first

1. **[blocker · shared · all tabs]** Stop the scroll jump on tab change.
   - **Where:** `public/js/app.js` `route()`.
   - **Problem:** `scrollTo(0,0)` runs in the first frame, while the old view is still visible.
   - **Fix:** keep scrollY unchanged while the old view's opacity is above 0. Two ways to do it:
     - Defer the reset until the exit has finished and run it in the same frame as the view swap, under the new view's opacity 0.
     - Or pin the old view with `transform: translateY(-oldScrollY px)` on a fixed-position wrapper, and reset scroll immediately.
   - **Target:** in a per-rAF log, scrollY stays at the old value until the old view's h1 is gone.
2. **[blocker · shared · dossier]** Bring dossier open and close inside E2.
   - **Open:** the longest frame is 63 ms. Render below-fold `[data-dossier-section]` blocks after the flight with `requestIdleCallback` (timeout 300 ms), not in the open task. Target < 50 ms at 4×.
   - **Close:** p95 is 33 ms. On the first close frame, set `.dossier-frost` to `opacity: 0` with no transition, so the blur layer isn't composited during the flight. Animate only transform and opacity on `.dossier-panel`. Target p95 ≤ 20 ms at 1×.
3. **[major · shared · dossier]** Give the close button a backing.
   - **Problem:** `.dossier-bar` floats over scrolled content in `components.css`.
   - **Button:** give it a solid pill: `background: var(--surface-strong)`, 1 px `--line`, `box-shadow: var(--shadow-1)`, radius 999.
   - **Scroll fade:** inside `.dossier-scroll`, add a sticky 56 px top fade, `linear-gradient(var(--dossier-fill) 55%, transparent)`, shown when scrollTop > 8, so text never passes under the × at full contrast.
4. **[major · shared · dossier]** Clean up the 160 px page strip right of the dossier.
   - **Problem:** half-cut chrome ("…or jump", "Add story URL") shows through a thin scrim.
   - **Fix:**
     - While the dossier is open, fade the top bar (status pill and ⌘K) to opacity 0 over 240 ms. This also drops the glass count to 1.
     - Raise `--scrim` to `rgba(245,246,248,.72)` in Proof and `rgba(18,19,22,.72)` in Night, so the strip reads as a margin, not a cropped page.
5. **[major · today · today]** Close the row 3 hole.
   - **Problem:** `td-week` is 277 px and `td-desk` 330 px.
   - **Fix:** make the row stretch (`align-items: stretch`). Make `.td-week` a flex column with its "Nothing planned yet…" footer at `margin-top: auto`, so both tiles end on the same line and the gap above "Also in the brief" is 16 px everywhere.
6. **[major · today · today]** Tighten the lead tile's rhythm.
   - **Problem:** the slack is spread into 43, 39 and 45 px gaps.
   - **Fix:** set fixed 24 px gaps between dek, Why it ranked and Named, and give the footer `margin-top: auto`, so any slack collects in one place above the footer.
   - **Head actions:** align "Run today's workflow" and `⋯` to the h1's last baseline (D §3), not to line 2 of the lede.
7. **[major · feed-dossier · dossier, phone]** Make the phone action bar fit.
   - **Problem:** `.dx-actions` is 514 px of content in 345 px.
   - **Fix:** at ≤ 480 px use two rows. "Draft a post" (the split button) goes full width; Save, Dismiss and "Source ↗" go in a 3-column `1fr` grid below it. No horizontal scroll.
8. **[major · calendar-studio · draft/1]** Fit the review tab strip.
   - **Problem:** `.st-tabs` has scrollWidth 416 in a clientWidth of 336, so "History 10" is clipped. This carries over from round 1.
   - **Fix:** use tab padding of 0 8 px and gap 2 px, and move Sources and History into a trailing "More ▾" menu below 1520 px. Or widen the review column to 380 px at ≥ 1360.
   - **Target:** scrollWidth ≤ clientWidth at 1280 and 1440.
9. **[major · calendar-studio · studio]** Make draft rows distinguishable.
   - **Problem:** identical sibling rows ("Video · explainer" ×2, "Instagram · carousel" ×2, all "1d ago").
   - **Fix:** add the hook's first 60 characters in muted 13 px after the format, and collapse true duplicates into "Video · explainer ×2" that expands on click.
   - **Hero:** show only the hook, with any leading "1." stripped and clamped to 2 lines.
   - **Target:** no two visible sibling rows with identical text.
10. **[major · career-publish · performance]** Replace the one-fact chart and dedupe the list.
    - **Chart:** when every open draft falls on one day, replace "Last edit per open draft · 14 days" with the sentence (already present below it) plus a single labelled stat. Otherwise show only the days that have data.
    - **Closest to publishing:** group the rows by story: one row titled "Northwind AI releases Relay…" with three channel chips (LinkedIn · In review / Video · Draft / Instagram · Draft), each with its next slot.
11. **[major · career-publish · career]** Remove the dead TREND lane.
    - Hide the TREND column while fewer than 25% of rows have a value. Render "Jobs only" inline after the skill name.
    - Replace the bare "1/1" and "0/1" JOB POSTS fractions with a check mark under the header "In job post", or with "1 of 1".
    - Stop the first KPI caption wrapping by shortening it to "skills · 30 days".
12. **[minor · career-publish · campaigns]** Fill the empty right lane in each story row.
    - Show the row's "Start campaign" button permanently (secondary sm), right-aligned at the row's top, instead of on hover only.
    - Let the finding text run to 64ch.
13. **[minor · career-publish · employers]** Unify the watchlist controls.
    - Make the team-watchlist pin a 24 px icon toggle (pin outline / filled) with a tooltip. Today it's ghost text "Pin" / "Unpin", which clashes with the employer's bordered Pin button in the same row.
    - Show "+ Team" only on row hover or focus when the employer has no watchlists.
14. **[minor · career-publish · people]** Fix the table's right edge and column widths.
    - Give the last header and cells `padding-right: 24px`. LAST CONTACT currently touches the tile edge.
    - Widen Person to 34% so the role and segment lines wrap to at most 2 lines.
15. **[minor · today · today]** Give the News map tile more of its space.
    - Fit the node bounds to the canvas with 12% padding; clusters use only about 55% of it.
    - Offset region labels outside their cluster discs, so "Business adoption" doesn't sit on nodes.
16. **[minor · search-system · search, phone]** Add an affordance to the clipped phone chip rows.
    - Add `mask-image: linear-gradient(90deg, #000 calc(100% - 24px), transparent)` and `scroll-snap-type: x proximity` to each chip row.
    - Do the same for the Refine segment row ("All results / Stories / Claims / D…").
17. **[minor · search-system · settings]** Fix the truncated inputs and the budget tag.
    - Widen the priority topic input to at least 240 px, or let it wrap to 2 lines, so "De-emphasize: model horse-race" shows in full.
    - When the monthly limit is 0, show the tag "Paid AI off" instead of "limit reached".
18. **[minor · shared · phone shell]** Mark More as current on More-sheet routes.
    - On Search, Calendar, Campaigns, Performance, Career, Employers, People, Sources, Runs and Settings, set `aria-current="page"` and the active style on the bottom bar's More item.
19. **[minor · feed-dossier · feed]** Tidy the filter row and the date column.
    - Move "Archived" out of the topic chips into the time and sort control row (it's a state, not a topic), so the topic chips don't strand an orphan line.
    - Give the date a fixed 56 px column right after the meta block.
20. **[minor · map · map]** Remove the unscaled bars and the empty band.
    - Label the Hottest topics bars ("share of 19 stories") or drop them; the "Leads 6 · in 10" text already carries the data.
    - Anchor the hint ("Select a story to light up…") to the panel bottom, so the ~60 px empty band closes.
21. **[minor · shared · phone]** Get E1 (tab change, phone 4×) to pass. It still fails 29/32 per the integrator. It's outside my lens to diagnose, but it holds motion_smoothness under 8 together with fixes 1 and 2.

## What would clear the bar

- **Overall and motion:** fixes 1 and 2 (plus E1) are the motion blockers. With them, motion_smoothness and motion_cohesion reach 8 and the overall about 40.
- **Today and the dossier:** fixes 3–7 take both to about 91.
- **Studio, Performance and Career:** fixes 8–11 lift all three to about 86–87.
- **The rest:** everything else is polish that moves single tabs 1–2 points.
