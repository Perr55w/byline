# Council C, round 1: motion feel and whole-product verdict (v4 HEAD 8eb8113)

Lens: overall lead and motion feel (the heading settle, tab switches, the dossier flight, count-ups, fades versus pops), plus the A-tier verdict for the whole product.

## How I looked

- I ran the app live on :4451 in Playwright at deviceScaleFactor 1. I covered all 14 routes plus `#/story/16` (opened as a deep link, from a Feed row and from the Today lead), `#/draft/1` and `#/person/4`, in Proof and Night, at 1440 and 390 wide, with the rail expanded and collapsed, including collapsing it while the dossier was open. I also captured a hover on the Today lead, a theme switch, a Map selection, a Search query and the Calendar week view.
- Motion evidence:
  - A 25 s session video, cut into frame contact sheets: the Today load, Today→Feed, the dossier opening from Feed and from Today, and the dossier closing.
  - An in-page per-frame sampler on the h1 lines, recording opacity, blur, translate and opsz/wght.
  - Per-frame `rail.right` and `dossier.left` while the rail collapsed with the dossier open.
- Gates on :4461 (`--only motion,E11,E2,E8`): C-entrance, C-pacing, C-rules, E8 and E11 PASS. **E2 FAILS**: the dossier's longest open frame is 123 ms on desktop and 94 ms on phone at 4×, and phone shows 2 forced layouts per open.
- Captures are in `/tmp/claude-0/council-C-r1/`. The contact sheets are in `frames/`; the video is in `video/`.

## What the measurements say

- **Heading settle (first load, Today): good, and to spec.**
  - Line 1 starts 371 ms after navigation.
  - Opacity reaches 0.5 at about 320 ms into the animation and 0.9 at about 550 ms. It is fully at rest at 1075 ms.
  - Blur goes 6 → 0, opsz 24 → 72 and wght 280 → 380, all on long-tail curves.
  - The h1 height never changes and the line count stays at 2 throughout. Nothing hard-cuts.
  - This fixes the user's "rushed / abrupt" complaint.
- **Tab-variant settle (Feed): good.** The new h1 starts 133 ms after the click and is at rest about 620 ms later, with blur 3 → 0 and opsz 48 → 72.
- **Count-up: good.** 0 → 78 runs on the exponential curve and visibly slows near the end. The ring fill shares the same progress.
- **Rail collapse with the dossier open adapts (the user's must-fix).** `dossier.left` tracks `rail.right + 12` on every frame (256 → 88), and E2's drift check passes. **However**, the dossier scrim covers the rail. The rail dims and `#rail-collapse` cannot be clicked while the dossier is open; only the `[` key works. The user's scenario ("collapse the rail while the dossier is open") therefore fails with a mouse.
- **The dossier flight is the weakest moment in the product.** I saw the same problems opening from a Feed row and from the Today lead:
  1. The flying title and ring leave the panel's clip. Mid-flight, the title sits on top of the underlying page h1 ("7 of 19 stories this" / "Agent orchestration…" superimposed on "Gemini at Work 2026") and on top of the Feed one-liner.
  2. In the first 2 to 3 frames, the top of the title's first line is clipped by the row's clip.
  3. The main topic pill drifts on its own path and lands late.
  4. The Today lead tile's body (why-ranked bullets, finding, Named) vanishes in one frame while the title stays.
  5. The 123 ms long frame lands in the middle of the flight, so the flight hitches.
- **The dossier close pops the list.** After the dossier has been scrolled and is then closed, the Feed source row is out of flow during the fade. The list shifts up about 36 px, and then the row reappears and pushes everything back down.
- **Tab switch exit.** The old view drops about 9 px **down** as it leaves the flow. The spec is to drift −6 px up. The new view's head action ("Add story URL") and its chips appear at full opacity while the old view is still fading. For 1 to 2 frames the two headings cross-fade on top of each other.
- **Today load order.** "Run today's workflow", the "···" button and the amber collection banner are visible before the h1 starts. The one-liner arrives at about 1000 ms, after the tiles and count-ups have already begun. So the hierarchy reads tiles → sentence rather than headline → sentence → tiles.
- **Background.** The ruled field is calm, paced correctly (C-pacing pass) and dimmed on reading views. Problems:
  - The canvas is 1425 px wide on a 1440 viewport, which leaves a **15 px seam at the right edge on every route**.
  - At full intensity the dash rows read as dashed form underlines running behind body text.
  - The pointer light shows through the dossier glass as a blue blob.

## Rubric (0–10; overall /50)

| | Score | Why |
|---|---|---|
| unique_typography | 8 | The Newsreader display cut with the opsz settle, Geist for UI and Geist Mono for data is deliberate and consistent. Big airy h1s. |
| color_cohesion | 7.5 | The restrained white, electric-blue and amber palette is AA-clean. The quality ramp barely reads as a gradient: rings at 64, 72 and 78 are the same blue. Amber banners appear on 5 tabs. |
| theme_cohesion | 8 | Proof and Night are the same product, and every tab shares the shell, tiles and head. |
| motion_cohesion | 7 | The settle, count-up, hover and rail coupling all speak one language. The dossier flight and the tab exit break it. |
| motion_smoothness | 6 | The headings are silky. The dossier flight has clip escapes, overlap, a lagging pill, a one-frame body vanish and a 123 ms long frame. The close pops the list. |
| generic_typography | 2 | Not generic. The one slip is the overuse of uppercase mono labels inside tiles. |
| background_generic | 3 | The ruled dash rows behind body text read like dashed underlines. There is a 15 px right-edge seam. |
| color_combo_generic | 3 | White with electric blue is the stock pro-SaaS pairing. Little else carries the identity (the ramp is flat and nothing besides amber is used). |
| motion_generic | 2 | No expo curve, no shimmer or sheen, no per-character effects. |
| ai_slop | 3 | Mono-caps eyebrows on most blocks (C slop #9). The dossier's employer-connection boilerplate is repeated five times, and there is a bare-numbers row. |
| **overall** | **38** | The product is honest, information-dense and calm, and the strongest version yet. It is not A-tier until the dossier moment is clean. It meets the 38 overall line, but the bar fails on motion_smoothness, motion_cohesion and color_cohesion being below 8, and on three negatives at 3. |

## Tab scores (out of 100, the user's way)

| Tab | Score | Why |
|---|---|---|
| rail | 87 | Groups, sliding highlight, even collapsed rhythm (E11 passes) and a real by-line mark. At 26 px the underline of the "by" tile is lost. While the dossier is open the rail sits behind the scrim and can't be clicked. |
| today | 86 | Issue number, date, an informative headline and a numeric one-liner, the weather tile, the mini map with top 3, and why-ranked bullets: all of the user's asks are met. Limits: the bottom row has about 110 to 150 px of dead tile area; ring colours don't show a gradient; the actions and banner pop in before the headline. |
| dossier | 84 | The content is excellent: per-source summaries and claims, a first-party warning, unequal weights visible in the breakdown, and it adapts to the rail. Limits: the open flight is messy, with a long frame; the panel spans the whole content width; employer-connection boilerplate is repeated; "Checkable numbers" is a bare number row. |
| feed | 86 | Clear title/meta size step, quality-ramp chips, top two topics, a threshold divider, numeric heads, and a background that stays out of the way. Limits: the ■◆○ source glyph strips are unexplained on this page; there is about 100 px of empty card at the end of the list. |
| map | 82 | A real, clickable map with a related-in-time list and an Open dossier action. Limits: region labels float away from their nodes; repo-name labels are truncated; hulls are drawn only around the centre; it feels sparse at 19 nodes. |
| search | 86 | Big autofocused bar, chips by type, grouped results with highlights, refine counts and a useful query state. Limits: in the browse state, drafts with identical titles and duplicate notes are not grouped. |
| studio | 80 | Honest counts, grouped by story, with the "above your bar, no draft yet" rail. Limits: every row repeats "Product tradeoff · no date"; it reads as a list rather than a workshop; the draft view keeps full chrome and its tab strip clips "History". |
| calendar | 84 | Month grid with no gap between day name and date, open slots, a tray and a cadence meter. Limits: the "⋮ 1 story" and "\| 2 stories" markers are cryptic; the week view has an empty 210 px Posts lane while story titles are crushed into narrow columns. |
| campaigns | 82 | A useful empty state: the stories that could anchor a campaign, with real counts. Limits: a repetitive "Start campaign" button column; the right column ends early, leaving white space. |
| performance | 72 | An honest empty state, but most of the page is a CSV box. The right column stops at about 470 px and leaves a large blank area. |
| career | 78 | The duplicate-job warning is good data honesty. Limits: the headline (AI governance) and the one-liner (Agents) disagree; 23 identical "NEW THIS WEEK" badges; numeric column heads are 13 px while the rest are 10.5 px. |
| employers | 80 | A solid coverage table. Limits: a 3-line headline listing four names; Pin and Unpin use inconsistent button styles; the same mismatched column-head sizes. |
| people | 84 | Follow-ups, pipeline and do-not-contact handling are honest and clear. Duplicates are surfaced. Somewhat form-heavy on `person/4`. |
| sources | 87 | Exactly what the user asked for: a health strip before and after the pause, per-source 7-day, total, stories and last sync, and expandable rows. Demo rows carry both a "DEMO ·" prefix and a tag, and the tag wraps. |
| runs | 86 | Clear stage timeline, honest cost, and history with failures explained. |
| settings | 82 | Thorough, with a source-health summary at the top. Limits: content scrolls under the floating pill; the section nav highlight lags; it is long. |

## Fixes (priority order, one owner each)

1. **[blocker] shared, dossier: clean up the flight.**
   - In `dossier.js`, keep the shared-element clones (title, ring, main pill) inside the panel's clipped layer, or apply the panel's current inset clip-path to them, so they never paint over the page beneath.
   - Fade the scrim to at least 0.6 within the first 120 ms (`--ease-fade`), then to its final value. The page h1 recedes before the title crosses it.
   - Hide only the shared elements on frame 1. Fade the rest of the source tile's body out over 120 ms (`--ease-exit`).
   - Fly the pill on the title's start time and curve (600 ms, `--ease-move`).
   - Accept when a 30 fps contact sheet shows no text from the page overlapping panel text on any frame.
2. **[blocker] shared, dossier: let the rail work while the dossier is open.** The scrim currently covers the rail. Set `.dossier-scrim { left: calc(var(--rail-w) + var(--gutter)) }`, or raise `#rail` above `.dossier` (z-index 51) without a scrim over it. Keep the rail fully interactive and undimmed. `#rail-collapse` must work with one click while the dossier is open.
3. **[blocker] feed-dossier, dossier: bring the open long frame under 50 ms (E2 FAIL).** It is 123 ms on desktop and 94 ms on phone at 4×, mostly `Response.json.then`, including 39 ms of forced layout.
   - In `story-dossier.js`, render only the head (eyebrow, title, finding, ring, pills, actions, sources line) in the flight frame.
   - Render Why it ranked, Score breakdown, What the sources say, Evidence, Lens, Employer connections, Drafts and Tune in idle chunks of about 8 ms each, starting after the 600 ms flight.
   - Don't read layout during render.
   - Prefetch `/api/stories/:id` on row and tile hover.
4. **[blocker] today, Today: remove the dead tile space in the bottom row.** The Gemini Omni tile is stretched to match "Waiting on you" (about 110 px empty), and This week has about 150 px empty.
   - Make it a 2-column row: This week, wider, with the 7-day strip and Suggested side by side; and Waiting on you.
   - Move the third secondary story into the right-hand stack under the other two, sized by importance.
   - Target: no tile with more than 48 px of unused interior.
5. **[major] shared, tokens/quality: make quality a visible gradient.** This is the user's explicit ask, and it overrides B §2's values.
   - Proof: `--q-3 #5B8CFA` (about 3.2:1 on white), keep `--q-4 #1F5EFF`, `--q-5 #0B2E9E`.
   - Night: `--q-3 #3E6FD8`, `--q-4 #5A93FF`, `--q-5 #A9C6FF`.
   - Add a non-colour cue in the ring: stroke 3, 4, 5 px for clears, strong and top, plus a 1 px inner ring on top.
   - Re-run `test/contrast.test.js`.
   - Accept when the 64, 72 and 78 rings on Today read as three distinct steps.
6. **[major] shared, tab switch: pin the exiting view and hold the new head items.**
   - In `app.js`/`motion.exitView`, pin the old view at its measured on-screen rect (`top = rect.top − containerRect.top`) before it becomes absolute, then animate translateY 0 → −6 px over 200 ms. Today, the old view drops +9 px.
   - The new view's head actions and filter chips must start at opacity 0 and join `enterItems` with the one-liner, not paint at full opacity during the old view's fade.
7. **[major] today, load: re-order the entrance.** Put "Run today's workflow", "···" and the collection banner on the one-liner's timeline: one-liner at 420 ms + 120 ms × (lines − 1), actions with it, banner 90 ms later. Each gets a 600 ms fade and a 6 px rise. Start the tile cascade no earlier than the one-liner start + 80 ms, so the read order is headline → sentence → tiles. Today, the button is fully visible before the h1 starts and the one-liner arrives after the count-ups.
8. **[major] shared, background: fix the right-edge seam.** `#bg` is 1425 px on a 1440 viewport, leaving a 15 px band with no field on every route. Size the canvas to `innerWidth` (CSS `inset:0; width:100vw`) and size the backing store from `innerWidth`, not `clientWidth` minus the gutter.
9. **[major] shared, shell: give scrolled content a backing under the topbar.** Content currently scrolls under the floating status pill and the Search button (Settings, Career, every table), and the text collides with the pill's edges. Add `.topbar::before`: fixed, 72 px tall, `linear-gradient(var(--bg) 55%, transparent)`, `pointer-events:none`, under the pill. Use no backdrop-filter, so the glass budget is unchanged.
10. **[major] feed-dossier, dossier: drop the repeated boilerplate in Employer connections.** Five entries each repeat "X works publicly on…; cloud.google.com says: 'New survey…'" and "Topical overlap only — mention only if…". Show one row per employer (name, TOPICAL ONLY tag, a one-line reason), put the shared caveat once at the section foot, and quote only when the quote differs per employer.
11. **[major] feed-dossier, dossier: replace the bare "Checkable numbers" row.** It currently reads "28 500 one trillion tokens 90% 49% 1,250". Show at most 4 numbers, each highlighted inside its claim fragment (about ±8 words) with the source domain. Drop the row if there is no fragment.
12. **[major] feed-dossier, dossier close: stop the list jump.** The source Feed row leaves the flow during close, so the list shifts about 36 px and back. Keep the source with `visibility:hidden` (never `display:none` or removal) until the last frame. If the source is on-screen at close, FLIP back to its rect, as C §3 specifies.
13. **[major] feed-dossier, dossier: stop the panel filling the screen.** The user praised Glass for this, and it also cuts the flight distance.
    - Cap the panel width at `min(1120px, 100vw − var(--rail-w) − 2·gutter − 96px)`, with the left edge still at `--rail-w + gutter`. The Feed stays visible behind the scrim on the right.
    - Keep the two balanced columns inside the panel.
    - Also stop the pointer light showing through the frost: hide `#bg-light` while the dossier is open.
14. **[major] career-publish, Career: make the headline and one-liner agree, and cut badge noise.** Right now the headline is about AI governance and the one-liner about Agents.
    - Use the same top skill (agents, by mentions) in both, per F's template.
    - With no articles older than a week, drop the per-row "NEW THIS WEEK" badges (23 identical) and say it once in the Trend column head ("needs 2+ weeks of history").
15. **[blocker] career-publish, Performance: remove the blank half-page.**
    - Make the funnel full width.
    - Move "What will be tracked" into the Import CSV card's right column.
    - Add the honest draft pipeline by day (drafts created and reviewed, from real draft timestamps) beside the funnel.
    - Target: no column gap taller than one tile.
16. **[blocker] calendar-studio, Studio: make it feel like a workshop.**
    - Show the angle only when it differs from the story default. Show "no date" as a hover-revealed "Plan" ghost action.
    - In `#/draft/:id`, set `data-bg="still"`, widen the editor to a 680–720 px measure at Newsreader 18/1.65, and move Format/Angle/Regenerate into one compact toolbar.
    - Fix the clipped right-hand tab strip ("History |").
17. **[major] map, Map: tie labels to nodes and fill the regions.**
    - Anchor each region label to the top-centre of its hull.
    - Draw every topic's hull, or an isobar contour, at 0.06–0.10 fill. Only the centre cluster has one now.
    - Use `short_title` and strip org prefixes from repo names ("anthropic-sdk-python v2.10.0").
    - Label only nodes at or above the threshold, plus hovered and selected nodes.
    - Widen the node radius range to 8–22 px by score so 19 nodes don't look sparse.
18. **[minor] feed-dossier, Feed: explain the glyph strips and trim the list.** Add a one-line legend in the list header ("■ first-party ◆ independent ○ commentary") and per-glyph `title`/aria text, so the source strips stop being unexplained mini graphs. Remove the roughly 100 px of empty space after the last row.
19. **[minor] today, tile labels: replace mono caps with sentence case.** Change WHY IT RANKED, NAMED, HOTTEST REGIONS, SUGGESTED, "22 DRAFTS AWAITING REVIEW" and "2 FOLLOW-UPS DUE" from uppercase mono to Geist 12.5/560, sentence case, `--text-2` (C slop #9). Keep mono caps for the page eyebrow and column heads only. Replace the thick underline on the lead title's hover with the hue change alone.
20. **[minor] shared, tables: equalise the column heads.** `components.css:138` gives `.table th.num` 13 px while other heads get 10.5 px (visible on Career and Employers). Set `.table th.num { font-size: var(--fs-label); letter-spacing: var(--tr-label) }`.
21. **[minor] calendar-studio, Calendar: clarify the markers and rebalance the week view.**
    - Replace "⋮ 1 story" and "\| 2 stories" with "2 stories" in text-3 plus up to 5 quality-coloured dots and a tooltip.
    - Week view: give empty lanes a min-height of 64 px, not 210 px, and give the space to the Stories lane, so titles aren't cut to 3 lines in 90 px columns.
22. **[minor] search-system, Search browse state: group duplicates.** Group recently edited drafts by story (title once, plus "LinkedIn · Video · Instagram" chips). Collapse identical notes into one with a "×2" badge.
23. **[minor] search-system, Sources: tidy demo rows.** When `is_demo`, drop the "DEMO · " name prefix and keep the DEMO tag inline (`nowrap`), so rows keep an even height.
24. **[minor] career-publish, Employers: shorten the headline and unify buttons.** Use the tie fallback, "4 employers tie for most coverage, 2 stories each.", with the names in the one-liner. Give Pin and Unpin the same button style.
25. **[minor] search-system, Settings: fix the scrollspy.** Drive the section-nav highlight with an IntersectionObserver (`rootMargin: "-80px 0px -60% 0px"`). Today it highlights "Intro format" while Posting rhythm is at the top.

## Verdict

v4 is the first Byline that reads as a product rather than a template:
- every headline is a finding with numbers;
- the data honesty is exemplary (paused sources, demo tags, duplicate warnings);
- the heading settle is exactly the calm, unrushed entrance the user asked for.

It is not A-tier yet. The signature moment, opening a story, is the roughest thing in the app: the title flies across the page heading, the body vanishes, a 123 ms frame hitches mid-flight, and the rail can't be clicked behind it. Fix 1–3 and that moment becomes the product's best. Fixes 4–9 raise Today and the shell to 90. Fixes 14–16 lift the three weakest tabs (Performance, Career, Studio) past 85.
