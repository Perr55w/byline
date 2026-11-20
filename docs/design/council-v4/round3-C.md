# Council C, round 3: motion feel and whole-product verdict (v4 HEAD 0504dc2)

Lens: overall lead and motion feel (heading settle, tab switches, dossier flight, count-ups, fades versus pops), plus the A-tier verdict. Scored from scratch on the live build.

## How I looked

- **Live app on :4451**, Playwright, deviceScaleFactor 1. All 14 routes plus `#/draft/1`, `#/person/4`, `#/story/16`, in Proof and Night at 1440 and Proof at 390 (no console errors, no page errors, no horizontal scroll on any route).
- **Dossier** opened from a Feed row and from the Today lead, rail collapsed and re-expanded with it open, scrolled to the bottom, closed with Esc.
- **Motion evidence**
  - A 46 s session video cut into contact sheets (`frames/load.png`, `tabfeed.png`, `openfeed.png`, `collapse.png`, `close.png`, `opentoday.png`, `theme.png`) and a full-size crop strip of the flight (`frames/openfeed-zoom.png`).
  - An in-page rAF sampler without video (`flight.cjs`): per-frame gaps, opacity of every h1, scrollY, title/dek/ring rects during the flight, `rail.right` vs `dossier.left`.
  - A hypothesis test (`hyp.cjs`): the same open with the dossier frost layer disabled.
- **Gates on :4461**: `--only E2` FAIL 10/13 (open longest 58 ms, close longest 57 ms, collapse p95 at 4× 42.9 ms); `--only E1 --route calendar,studio,today,feed` FAIL 17/18 (this time feed 79 ms with 15 ms blocking, so render cost; calendar and studio passed).
- Captures: `/tmp/claude-0/council-C-r3/` (`<route>-{d,p}-{light,dark}.png`, `frames/`, `video/`, logs).

## What changed since round 2 (verified live)

Fixed, and it shows:
- **Tab switch double exposure: gone.** Today→Feed sampler: old h1 1 → .43 (180 ms) → .01 (247 ms); new h1 starts at 380 ms. No frame has both h1s above .08.
- **Scroll jump: gone.** With Today scrolled 700 px, scrollY stays 700 until the old view is at 0 opacity, then resets to 0 at 314 ms, unseen.
- **Dossier sections all render** (Why it ranked, Score breakdown, Evidence, Lens, Employer connections, Drafts & projects, Tune), both from Feed and from the prebuilt Today path.
- **Rail ↔ dossier coupling** still exact: `dossier.left = rail.right + 12` on every sampled frame, 256 → 88 and back, 0 violations. The panel keeps its width, so more Feed shows when the rail is collapsed; it never slides under.
- **Theme switch** is one speed now: rail, toggle and content cross-fade together, text steps at mid-point, no grey-on-grey frame.
- **Close** is clean to the eye and frame-clean at 1× (p95 16.8 ms).
- **Count-ups / rings**: still the best moment in the product. 78 decelerates visibly; ring colour and fill on one progress; no re-count on revisit.
- **Weak tabs** (Studio, Campaigns, Performance, Career, Employers) all lost their repeated rows and button noise: grouped ×N draft rows, one "Start campaign" per story grouped by topic, the one-fact chart replaced by a sentence, Trend column gone, Pin/Edit/Activity triplets reduced to a quiet "Activity →", story titles under every employer bar.

Still rough:
1. **Post-flight frost stall (biggest motion defect left).** After every open, 12–13 consecutive frames of 50–67 ms between 1.0 s and 1.8 s (Feed and Today, 1×, no long tasks). With `.dossier-frost` disabled the same window has **zero** frames over 34 ms. Cause: `.frosted` is added 220 ms after landing (dossier.js ~294), then `afterFlight` inserts Lens/Connections/Make/Tune with entrance animations under a live backdrop-filter, so the blur is recomposited every frame. It reads as the panel going "sticky" for most of a second right after it lands.
2. **Flight collision.** The head units (dek, action row, facts column) start fading at 160 ms while the title is still flying (title at y 295–358 at 292 ms, home at 72 by 650 ms). For about 150 ms the flying title is drawn across the half-faded dek: "Gemini at Work 2026" over "Google Cloud says nearly 500…" (`frames/openfeed-zoom.png`). That's a double exposure in the product's signature moment.
3. **Heading gap on tab switch.** The old h1 is gone at ~250 ms and the new one is still under .05 at 380 ms and only .32 at 447 ms: about 200 ms with an empty heading band. Calm, but it reads as a small blink rather than a hand-off.
4. **Gates.** E2: open longest 58 ms (`onhashchange` app.js 12 ms on the open path), close longest 57 ms, rail-collapse p95 at 4× 42.9 ms (limit 33). E1 flips between routes run to run (feed 79 ms this time, blocking only 15 ms).

## Rubric (0–10; overall /50)

| | Score | Why |
|---|---|---|
| unique_typography | 8.5 | Newsreader display with the opsz settle, Geist UI, Geist Mono data; strong title/meta step on every tab and in the dossier. |
| color_cohesion | 8 | Quality ramp reads everywhere (rings, chips by band, map nodes, calendar dots); blue only above the bar. Loud spots: the saturated green/red health bars on Sources and Settings, and green "First-party"/"Named in a source" tags in the dossier where green elsewhere means healthy/sent. |
| theme_cohesion | 8.5 | Proof and Night are one product; head, tiles, tables and empty-state voice are shared on all 17 surfaces; the theme switch is now one speed. |
| motion_cohesion | 8 | Settle, tab hand-off, count-up, hover, rail coupling and close speak one language. Breaks: the title/dek collision in flight and the post-landing stall. |
| motion_smoothness | 7.5 | Smooth to the eye at 1× except the 0.8 s post-flight stall; E1 and E2 still fail (58/57 ms open/close, 42.9 ms collapse p95 at 4×). |
| generic_typography | 2 | Not generic. Residual mono-caps card eyebrows: "ABOVE YOUR BAR, NO DRAFT YET", "BY CHANNEL", "BIGGEST BRIDGE", "LATEST RUN", "UNSCHEDULED DRAFTS", "CADENCE". |
| background_generic | 2 | Ruled field is quiet on reading views; the pooled-hover blue dash rows around Today tiles still read a little like graph paper. |
| color_combo_generic | 2.5 | Cool white plus electric blue is still the stock pro-tool pairing; the ramp and the ochre state colour are the only identity beyond it. Most of this is the decided palette; the field at rest being blue is the one lever left. |
| motion_generic | 2 | No banned curves, shimmer, sheen, tilt, per-character or pulsing effects. |
| ai_slop | 2 | Headlines are findings, numbers are real. Residual: "You can try it" / "You can try it." in the dossier evidence, "Works publicly on Google." under Google (other teams), jargon "Headline hook" on draft rows. |
| **overall** | **41** | The best Byline yet, clear of 38. Not A-tier (45+) while the signature moment (opening a story) has a collision and a post-landing stall, and while E1/E2 fail. |

Against the bar: motion_smoothness (7.5) and color_combo_generic (2.5) still miss.

## Tab scores (out of 100)

| Tab | Score | Why |
|---|---|---|
| rail | 90 | Groups, sliding highlight, by—line mark, even collapsed rhythm (36/44 pitch with hairlines), stays live over the dossier and reflows it exactly. |
| today | 90 | Every SPEC §0 ask is met: issue no. + date, finding headline, numeric one-liner, ring gradient without tick, why-ranked bullets, News weather, labelled mini map + top 3, calm load order. Holding it at 90: This week's seven ~110 px empty day pills and the mini-map's "Gemini at Work…" label sitting ~150 px from its node. |
| dossier | 88 | Content is the product's best: per-source key claims, first-party warning, unequal-weight breakdown, lens, employer connections; adapts to the rail, doesn't fill the screen. Below 90: title flies across the half-faded dek, an 0.8 s stall right after landing, "You can try it / You can try it." and green-on-everything tags. |
| feed | 90 | Big headline/meta step, banded score chips, top-two topics with blue only above the bar, glyph legend, threshold divider, quiet field. E1 at phone 4× still flickers (79 ms this run). |
| map | 87 | Real, clickable, one hull for the big topic, labels anchored, bridge card. Side panel header "Hottest topics / ranked by this week's scores" wraps into a cramped 2×2, and its last line is clipped at the panel bottom; "Business adoption · leads 4" floats with no region drawn. |
| search | 88 | Big bar, keyboard hints, labelled chip rows incl. honest "No matches yet", useful grouped results, "story 59" chips. Right Refine column ends ~1,300 px before the results. |
| studio | 86 | A real workshop: review card with approval checklist, grouped ×N rows, by-channel card. Right column ends ~450 px early; in the Hot-take group the status pill jumps 77 px right because the row has no time; "Headline hook" is jargon. |
| calendar | 87 | Month grid, story counts with quality dots, open slots, tray with ×N, cadence W44–W47, filled legend swatches. Empty rows 1–3 are honest but big; tray row icons stack awkwardly at 390. |
| campaigns | 85 | Grouped by topic, one Start campaign each, a useful "95% of drafts sit under Agent orchestration" finding. The right "by main topic" card repeats the left grouping, and the right column ends ~540 px early. |
| performance | 86 | Compact funnel, honest edit-date sentence, closest-to-publishing grouped by story with format chips. Next open slots card has ~80 px of stretched dead space above the CSV button. |
| career | 85 | Duplicate-job honesty, one visible rank, no empty Trend column. "AI governance · Jobs only" inside "Story topics this week" contradicts itself; "evals / also 'Evals'" is noise. |
| employers | 85 | Story titles behind each count, quiet Activity link, Following tag. Five "No stories yet" rows take ~95 px each of mostly empty columns; two-value bars (2 vs 1) carry little. |
| people | 87 | Overdue follow-ups, duplicate warning with both records, pipeline by stage, do-not-contact flags. The duplicate contact still appears twice in table and queue (honestly labelled). |
| sources | 88 | Exactly the information asked for: was-healthy/was-failing with error, per-source 7-day, stories, last sync, evidence type, "Paused · was failing" filter. Saturated green/red health bar is the loudest colour in the app; 26 identical Sync buttons. |
| runs | 88 | Clear stage timeline, honest $0.00, grouped repeats (#11–#16, 6 runs). Fine. |
| settings | 86 | Health summary, weighted priorities, collapsed long groups, "Paid AI off". Term inputs still truncate mid-word; the three bottom summary cards end at three different heights; same loud health bar as Sources. |

## Fixes (priority order; one owner each)

1. **[blocker] shared — frost after the progressive fill, not 220 ms after landing.** In `public/js/dossier.js` (open, the `landed.then` block ~line 290), add `.frosted` only after `afterFlight()` has resolved *and* every animation under the panel has finished: `Promise.all(panel.getAnimations({subtree:true}).map(a => a.finished.catch(()=>{})))`, with a 1,800 ms cap; `afterFlight` must return the fill promise. Keep the opaque `.98` fill until then (the swap is invisible). Measured: frost disabled → 0 frames > 34 ms in 1.0–1.8 s; frost live → 13 frames of 50–67 ms. Target: no frame > 34 ms in 0–2,000 ms after an open at 1×; E2 desktop open longest < 50 ms.
2. **[blocker] feed-dossier — no entrance animation for sections that land off-screen.** In `story-dossier.js` `fillProgressive`, a section inserted after the flight whose top is below the scroller's visible bottom (`dossier-scroll` clientHeight; use the rect the IntersectionObserver already reports, no layout read) gets no opacity/translate animation. Sections that are on screen get opacity only, 240 ms `--ease-fade`, no translate. Target: as fix 1, and fewer composited layers during the fill.
3. **[blocker] shared — hold the head band until the title is nearly home.** In `dossier.js` open, when `fly` is true, units that share the head band with the flying title (the dek, the action row, the facts/ring column) start at **380 ms** (the title is about 85% of its travel on `--ease-move` 600 ms), not at `base = 160`. Lower sections keep 160 + 40·i. Accept: no sampled frame where the flying title's rect intersects the dek's rect while the dek's opacity is > .1.
4. **[blocker] shared — rail collapse with the dossier open, p95 42.9 ms at 4× (limit 33).** While `.dossier` is open, the page under the scrim still relays out every frame through `.main` `padding-left: var(--rail-w)`. At collapse start set `.main`'s padding to the end value once (one layout), and animate `.page` `transform: translateX(delta → 0)` over `--dur-layout` `--ease-move`; the rail keeps the `--rail-w` width transition and the dossier keeps `left`. The page is under a .72 scrim, so the difference is invisible. Keep the `dossier.left ≥ rail.right` assertion. Target p95 ≤ 33 ms at 4×.
5. **[major] shared — open path does router work.** E2 attributes 12 ms to `DOMWindow.onhashchange` (app.js) in the open's longest frame (58 ms). When the hash moves to `#/story/:id` because `dossier.open()` was already called for that id, the hashchange handler must return immediately (guard on the open id), and must not touch the Feed page underneath. Target: E2 open longest < 50 ms.
6. **[major] shared — close the heading gap on tab switch.** The new h1 is under .05 until 380 ms and .32 at 447 ms, while the old one is gone at ~250 ms. In `app.js`, start the new h1 settle at 230 ms (as the old page-head reaches ≤ .05) and the rest of the cascade at its current time. Accept: in every sampled frame from click to 900 ms, at least one h1 is ≥ .15 opacity after the old one drops below .15, and never two above .08.
7. **[major] feed-dossier — E1 Feed at phone 4× (79 ms, 15 ms blocking = render).** Check that `.cv-row` applies at ≤ 480 px and that its `contain-intrinsic-size` matches the phone row height (rows are ~180 px tall at 390, not the desktop ~78 px), so off-screen rows skip style and layout in the swap frame. Render only the first 6 rows in the swap frame on phone; the rest in one idle chunk.
8. **[major] feed-dossier — dossier wording and tag colour.**
   - "Why it's post-worthy": when a row's text equals its label ("You can try it" / "You can try it."), render the label only.
   - Employer connections: drop "Works publicly on X." when X is the employer's own name ("Google" under Google (other teams)).
   - Tags: "First-party" becomes a neutral tag with the ■ first-party glyph; "Named in a source" becomes a neutral outline tag. Keep green for health and "Sent" only.
9. **[major] today — This week dead interior and mini-map label.** Empty day columns are ~110 px pills with a single ○; when a day has no post, make the column 56 px tall (date + marker only), so the tile's unused band is ≤ 32 px and "Nothing planned yet. 22 drafts are in the tray." sits directly under the strip. In the mini News map, anchor each top-3 label within 24 px of its node (the "Gemini at Work 2026…" label currently sits bottom-left with a ~150 px leader); flip the label side instead of moving it away.
10. **[major] calendar-studio — Studio column and row alignment.**
    - Make Studio's right column `position: sticky; top: 84px` (it ends ~450 px before the list).
    - Every draft row reserves the time column: when there is no edit time, render "—", so the status pill stays in line (Hot-take group: "Draft" sits 77 px right of the others).
    - Replace the "Headline hook" label (studio.js:198, calendar.js:62) with "Opens with the story title", text-3.
11. **[major] career-publish — Campaigns right column.** Make it sticky (`top: 84px`), and replace "These stories by main topic" (it repeats the left grouping) with the single finding it already has ("95% of the drafts for these stories sit under Agent orchestration") plus the per-channel next slot, so the column is shorter and non-redundant.
12. **[major] career-publish — Performance slot card.** "Next open slots" stretches ~80 px of empty space above "Import results from a CSV" (`margin-top:auto`). Use `align-self:start` and a 24 px gap (R8). If the two bottom cards then differ in height, let them; no empty band > 32 px.
13. **[major] career-publish — Employers empty rows.** Collapse the five "No stories yet" employers into one group row below the others: "No stories yet · Cox Automotive, IBM, Toyota (pinned) · Ally, Snowflake", each name a link to its Activity, with the pin glyph inline. Keeps the table to the 5 employers with coverage plus one line.
14. **[minor] career-publish — Career story-topics card.** In "Story topics this week", the "Jobs only" chip next to AI governance contradicts the card title. Move that chip to the skill row in the radar only; in this card show "also a job-post skill" in text-3 if needed. Merge "evals / also 'Evals'" (case-only variants) silently.
15. **[minor] map — side panel header and clip.** Put "Hottest topics" on one line and the meta "this week's scores" under it (text-3, 12 px), not side by side. The last line "Select a story to light up its links and list its…" is clipped at the panel bottom at 1440×900: make the panel scroll or drop that hint once the bridge card is shown. Don't print "Business adoption · leads 4" as a region label when no region is drawn for it (only topics with ≥ 3 nodes get a hull); show it as a plain label at its centroid in text-3.
16. **[minor] search-system — health bar colour.** On Sources ("Before the pause") and Settings ("Source health"), desaturate the stacked bar: healthy `--ok` at 60% mix with `--surface-2`, failing `--danger` at 55%, stale ochre at 60%, so it is no longer the loudest colour in the app; keep the legend dots full strength for meaning.
17. **[minor] search-system — Settings inputs and cards.** Term inputs truncate mid-word ("orchestration, multi-agent" cut): wrap them as a 2-line textarea-like field or show "+N terms" after the first 4. Align the three bottom summary cards (Writing, Publishing, System) to the tallest with `align-items: stretch` and content at top, or put them in one row card with three columns.
18. **[minor] search-system — Search Refine column.** Make Refine + Recent searches sticky (`top: 84px`) so the column doesn't end ~1,300 px before the results.
19. **[minor] shared — field at rest on Proof.** The pooled hover turns the surrounding dash rows clearly blue, which reads as graph paper and keeps blue+white generic. At rest and in the hover pool, draw the dashes in the neutral ink (`--text-3` mix) and let blue appear only where heat is high (top topics on Today/Map). Blue coverage stays ≤ 25%.
20. **[minor] shared — card eyebrows.** Mono uppercase is for rail groups, column heads and the page eyebrow only (DECISIONS). Convert card-level eyebrows to sentence-case Geist 12/500 text-2: "Above your bar, no draft yet" (Studio), "By channel", "Biggest bridge" (Map), "Latest run" (Runs), "Unscheduled drafts", "Cadence" (Calendar). This lives in the shared `.eyebrow`/`.k` component class, so one change covers every view.
21. **[minor] calendar-studio — phone tray rows.** At 390 the tray rows stack the ↗ and calendar icons vertically under the status pill. Put the two icon buttons on one line after the status, 32 px targets, right-aligned.

## Verdict

Round 2 fixed the transitions that were visibly wrong: the tab switch hands off without double exposure or a scroll jump, the theme switch is one speed, the dossier is complete, and the Career and Publish tabs lost their repetition. Every tab is now at or above 85, and the product clears the bar on every positive except motion smoothness.

It is not A-tier yet, for one reason above all: **opening a story**, the signature moment, still has a 150 ms title/dek collision mid-flight and an 0.8 s stall right after landing caused by the frost going live while sections are still animating in. Fixes 1–5 make that moment frame-clean and should turn E2 green; fix 6 smooths the tab hand-off; fixes 8–9 take the dossier and Today past 90.
