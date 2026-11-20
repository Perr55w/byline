# Critic D (Surfaces): round 3 scoring

**Lens:** surfaces, layout, spacing rhythm, rail, tiles, dossier panel geometry, white-space balance, radii, glass budget, phone layout.

**What I looked at:** the live app on v4 HEAD `0504dc2`, served on :4452.
- Every route plus `draft/1` and `person/4`, in Proof and Night, at 1440×900 and 390×844 (64 captures, full-page for desktop Proof). Lazy sections were checked by scrolling, because full-page captures miss `content-visibility` rows.
- The dossier, opened from a Feed row and from the Today lead tile in both themes, plus a phone open. I scrolled it four screens and collapsed the rail with it open, sampling every 30 ms.
- Today→Feed with Today scrolled to 900, logged per rAF; Feed→Calendar in 8 frames; the load entrance in 8 frames at 110 ms; tile hover; the collapsed rail.
- Gates E2 and E11 on harness port 4462.

Captures are in `/tmp/claude-0/council-D-r3/`. I clicked nothing on run, approve, publish or send paths.

## Measured

| Check | Result |
|---|---|
| Tab-switch scroll jump (my round 2 blocker) | **Fixed.** Per-rAF log: scrollY holds at 900 while Today fades 1 → 0.07 over about 210 ms, then Feed lands at 0 in the same frame. |
| Collapsed rail rhythm | E11 passes 14/14. Pitch is 36 in a group and 44 across; every icon centre x is 44. |
| Dossier geometry | Panel 256–1280 × 12–888, rail 12–244 × 12–888. Top and bottom match. |
| Collapse with dossier open | `[rail.right, panel.left]` goes 244/256 → 197/209 → 108/120 → 76/88. The 12 px gap holds on every sample. **But** the panel keeps its 1024 width, so a 328 px strip of half-cut page ("…nt orchestration", "…ets · 1 independent") opens on the right. |
| Dossier sections | All 14 `data-dossier-section` blocks render, from Feed and from Today. The columns end within about 30 px of each other. |
| Dossier close button | It now has a solid pill with a border, and a top fade hides text that scrolls under it. Fixed. |
| Phone dossier actions | Two rows: full-width "Draft a post", then Save / Dismiss / Source in thirds. scrollWidth 390 = clientWidth. Fixed. |
| Glass | 1 live backdrop-filter on every route (the pill, or the phone bar on phone). With the dossier open, the pill hides, so the count stays at 1 (`dossier-frost`). Passes. |
| E2 (my run) | 12/13. Every desktop check passes (open p95 16.8, close p95 16.8, collapse p95 26.7 at 4×). The one failure is the phone open's longest frame, 57 ms against < 50. The integrator's run failed desktop instead, so this gate is still flaky. |
| `draft/1` tab strip | scrollWidth 266 = clientWidth 266, with a "More ▾" menu. Fixed. |
| Phone bottom bar | More shows `aria-current` on More-sheet routes. Fixed. |
| Phone Feed | A long `modelcontextprotocol/modelcontextprotocol` title runs to x = 438 inside a 356 px tile and is clipped. `.fd-topicbar` is 1288/390 with no fade mask (Search's chip rows have one). |
| Map side panel | `.map-side` scrolls internally (569/524). The hint "Select a story to light up its links and list its…" is cut at the tile's bottom edge. The page is 966 px tall at a 900 px viewport. |
| Settings | 11 of 41 inputs truncate: every priority's Terms field ("agent, agents, agentic, orchestration, multi-agen…"). The three fold cards end at 2222, 2186 and 2290, a ragged bottom row. |
| Horizontal page overflow | 0 on every capture. No console or page errors. |

## Rubric

| | Score |
|---|---|
| unique_typography | 8.5 |
| color_cohesion | 8 |
| theme_cohesion | 8.5 |
| motion_cohesion | 8 |
| motion_smoothness | 7.5 |
| generic_typography | 2 |
| background_generic | 2 |
| color_combo_generic | 2 |
| motion_generic | 2 |
| ai_slop | 2 |
| **overall** | **40 / 50** |

**Why:**
- **Motion.** The scroll jump is gone, and switches now read as one continuous fade then settle. motion_cohesion reaches 8.
- **Smoothness.** It stays at 7.5 because E1 (phone 4×) and E2 still swap which route or scope misses by 2–17 ms from run to run.
- **Surfaces.** They form one consistent family in both themes, and Night's graphite and tinted glass match Proof's structure.
- **Colour pairing.** Blue on near-white is held in check by the quality ramp, amber state strips and the ruled field. It no longer reads as stock SaaS, so it scores 2.

## Tab scores

| Tab | Score | Why |
|---|---|---|
| rail | 91 | The rhythm is exact (E11), the groups explain themselves, the highlight slides, and the "by" mark holds at 26 px in both themes. Nothing in my lens is left to fix. |
| today | 90 | The round 2 holes are closed: row 3 tiles end on one line, and the lead tile's gaps are a fixed 24 px with the footer pinned. It reaches the target. The This week strip still spends about 110 px on seven empty day columns, so it sits at the line rather than above it. |
| dossier | 90 | All sections are present, the geometry matches the rail, collapse never slides under, the close pill is backed, and the phone action bar fits. Still left: the 328 px ghost strip after a rail collapse, "You can try it" printed as both heading and body, and a topical-overlap employer labelled "Same passage as Google Cloud above". |
| feed | 89 | The headline and meta step is strong, Archived has moved into the sort row, and the list ends at its last row. On phone, a long release title is clipped and the topic bar has no fade. Release rows still repeat the title as the dek. |
| map | 87 | The real map fits the stage, and its region labels and legend are clear. The side panel scrolls internally and cuts its own hint. "Hottest topics" and its meta both wrap to two lines, and the page overruns the viewport by 66 px. |
| search | 88 | Big bar, quick chips with phone fades, useful grouped results and a sticky Refine panel. "Test Alumna" appears twice in Contacts with no duplicate mark. |
| studio | 86 | Duplicates collapse to ×5, so the list finally scans. In the Hot take group, the status chip sits at x = 835 instead of 758 and the date is missing, so the columns break. Rows read "Headline hook · 5 scenes", which looks like template text. |
| calendar | 88 | A full month on one screen, no day/date gap, equal-height grid and side panel, open slots only on future posting days. Minor: the "Test Alumna ×2" chip wraps. |
| campaigns | 86 | The permanent "Start campaign" fills the empty right lane, and the topic grouping is useful. "Next open posting slots" shows three identical "Fri 20 Nov" rows. The release story's dek repeats its title. |
| performance | 85 | Story-grouped "Closest to publishing" and the stat that replaced the chart fix round 2's problems. "Next open LinkedIn slot Fri 20 Nov" repeats on every row and again in the side tile, and that tile has an 80 px empty band above the CSV row. |
| career | 86 | The TREND lane is gone, "In job post" uses checks, and the KPIs don't wrap. "Jobs only" on a story topic (AI governance) contradicts its own row. |
| employers | 84 | **Below target.** The Team watchlists column is empty in 7 of 10 rows, a dead lane of about 300 px. Story titles wrap in a too-narrow middle column, and the four full-length bars carry no contrast. |
| people | 87 | Dense and honest: a duplicate strip, the pipeline and an outreach table. The "Duplicate contact" tag sits 8 px right of the name it belongs to. |
| sources | 88 | A rich health strip with a before-the-pause bar, demo tags, and evidence and sync columns. Failing rows grow to three lines, so row height varies (56 vs 68 px), but the information justifies it. |
| runs | 87 | Clear stage timeline, cost controls and a grouped history. The right column ends about 210 px above the latest-run tile; acceptable. |
| settings | 84 | **Below target.** Every Terms input is truncated mid-word, and the three fold cards end on different lines. The sticky sub-nav and source-health card are good. |

## Fixes, most score-moving first

1. **[blocker · career-publish · employers]** Remove the dead watchlist lane.
   - Delete the TEAM WATCHLISTS column. Render each employer's watchlists as chips on a third line inside the Employer cell ("Bedrock Agents · Following").
   - New widths: Employer 34%, Stories 52%, Activity 14%. Story titles must fit on one line at 1440.
   - When every bar equals the column max, drop the bars and keep the count.
2. **[blocker · search-system · settings]** Show the Terms in full.
   - Replace each Terms `<input>` with an auto-height textarea (max 2 lines) or a wrapping chip list.
   - Shrink the topic input to 200 px and the weight slider column to 150 px so Terms gets the space.
   - Target: 0 truncated inputs in `.main`.
3. **[major · search-system · settings]** Make the Writing / Publishing / System fold cards a stretch grid, so all three end on one line (today 2222 / 2186 / 2290).
4. **[major · shared · dossier]** Close the ghost strip after a rail collapse.
   - **Problem:** the panel's constant width leaves 328 px of half-cut page on the right.
   - **Fix:** on `transitionend` of `--rail-w` (components.css `.dossier-panel`, dossier.js), step the width once to `min(1200px, 100vw − rail-w − 3·inset − 160px)`. The right margin stays 160 px in both states. This is one layout after the motion, not per frame, so E2 is unaffected.
   - **Fallback:** raise `--scrim` to .86 while `html.rail-collapsed`.
5. **[major · feed-dossier · dossier]** Make "Why it's post-worthy" non-redundant.
   - When a criterion's body equals its heading ("You can try it" / "You can try it."), render the supporting evidence (the quote or link) instead, or show only the heading with a check.
   - Under "Topical overlap only, not named", drop the "Same passage as Google Cloud above" line. It contradicts "not named".
6. **[major · shared · feed/search/campaigns/today]** Stop release rows repeating the title as the dek.
   - **Where:** `findingLine()` in src.
   - **Fix:** when the normalized finding is contained in the title (for example "anthropic-sdk-python v2.10.0."), use the first release-note bullet, or return null so the views omit the dek.
   - Add a unit test.
7. **[major · map · map]** Fit the side panel and the page to the viewport.
   - `.map-side` must not scroll (569/524 today). Tighten the bridge card padding to 16, or move the hint into the stage legend row.
   - Put the "Hottest topics" meta on its own line under a one-line title.
   - Size the stage `calc(100dvh − top − 24px)` so the page height is ≤ the viewport at 1440×900.
8. **[major · calendar-studio · studio]** Lock the draft-row columns.
   - `.st-list` rows become a grid: icon 20 / format 180 / hook 1fr / status 88 / date 64 / arrow 16. The Hot take group's status chip currently sits at 835 vs 758 and has no date.
   - When a draft has no real hook, show "No hook yet" in muted text rather than "Headline hook".
9. **[major · career-publish · performance]** Remove the repeated slot lines.
   - Drop the per-row "Next open LinkedIn slot Fri 20 Nov" when every row shows the same date; show it once in the card header ("next slot Fri 20 Nov").
   - In "Next open slots", collapse identical rows into "Fri 20 Nov · all channels", and remove the `margin-top: auto` gap above "Import results from a CSV".
10. **[major · feed-dossier · feed, phone]** Fix the phone overflow.
    - Add `overflow-wrap: anywhere` to `.fd-title`.
    - Give `.fd-topicbar` the same 24 px right fade mask and `scroll-snap-type: x proximity` that Search's chip rows use.
11. **[major · shared · phone]** Make E2 phone open and E1 phone pass consistently.
    - On phone, render the below-fold dossier sections in idle time after the sheet lands. The prebuild path currently fills them inside the open, which gives a 57 ms longest frame.
    - Re-run E1 and E2 three times; each should pass every time.
12. **[minor · career-publish · campaigns]** Collapse "Next open posting slots" to one line ("Fri 20 Nov for LinkedIn, Instagram and Video") when all dates match.
13. **[minor · today · today]** Shorten the This week day columns.
    - Cut them from about 110 px to 64 px, with the planned/posting-day dot inside the column.
    - Let "Suggested next post" set the tile height, so row 3 has no tall empty pills.
14. **[minor · feed-dossier · feed]** Keep the topic chips on one line at 1440. Fold weight-≤1 or single-story topics ("Business analysis 1", "Machine learning 9" catch-all) into a trailing "+2" chip, so two chips aren't stranded on a second line.
15. **[minor · feed-dossier · dossier, phone]** Fix the eyebrow wrap. At ≤ 480 px, split the eyebrow into two lines (the topic, then "First seen 18 Nov, 11:52 AM · updated 2d ago"), so no line starts with a middot.
16. **[minor · search-system · search]** Group duplicate contacts in Search ("Test Alumna ×2 · possible duplicate", one row), matching the People strip.
17. **[minor · career-publish · people]** Left-align the Outreach queue's "Duplicate contact" tag with the name (it is 8 px right today).
18. **[minor · career-publish · career]** In "Story topics this week", replace the "Jobs only" tag on AI governance with "also a job-post skill". "Jobs only" contradicts a row that is itself a story topic.
19. **[minor · calendar-studio · calendar]** Set outreach chips to `white-space: nowrap; text-overflow: ellipsis`, so "Test Alumna ×2" stays on one line.

## What would clear the bar

- **Employers and Settings:** fixes 1–3 lift both to about 87.
- **Dossier:** fixes 4–6 put it at about 92.
- **Map, Studio and Performance:** fixes 7–9 move each up 2–3 points.
- **motion_smoothness:** fix 11 is the only thing still holding it under 8.
