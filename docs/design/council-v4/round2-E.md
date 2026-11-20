# Council E, round 2: motion engineering and performance (v4 HEAD e010f0f)

Lens: jank is a defect. I re-measured the live build with Playwright and CDP and then looked at every tab as the user would. I scored from scratch; round 1 numbers appear only for comparison.

## How I looked

- **Gates.** Full harness run alone on the machine: `node test/e2e/run.mjs --port 4463 --no-shots`. Output is in `/tmp/claude-0/council-E-r2/gates.txt`.
- **Live app on :4453.** Covered:
  - all 14 routes plus `#/draft/1` and `#/person/4`
  - Proof and Night at 1440, Proof at 390
  - the dossier opened from Feed and from Today, `#/story/16` deep-linked on desktop and phone
  - rail collapsed, including collapsing with the dossier open
  - hover, tab switches, the load entrance, the theme switch and a Feed filter click
- **Captures** are in `/tmp/claude-0/council-E-r2/` at deviceScaleFactor 1:
  - `{proof,night}-{d,m}-<route>.png` and `proof-d-<route>-full.png`
  - `frames/<scenario>/` holds CDP screencast frame sequences with timestamps; `sheet-*.jpg` are contact sheets of them
  - `probe-*.json` has idle, phone 4× tab-ins, rail, dossier, theme, hover and desktop tab measurements
  - `trace-*.json` are traces of the long frames
- **`npm test`:** 66/66 pass.

## Gates: 20 of 22 pass (E1 and E2 fail)

| Gate | Result | Notes |
|---|---|---|
| **E1** tab change, phone 4× | **FAIL** | Longest LoAF: feed 68 ms, settings 71 ms, today 81 ms. Map, search, calendar, studio and sources are at 0. Forced layouts per transition are all 1 (pass). Round 1 failed all 8 routes at 62–97 ms. |
| **E2** dossier | **FAIL** | Desktop open 76 ms and close 65 ms at 4×. Phone open 72 ms (`onhashchange`, 2 ms forced). Rail collapse with the dossier open: p95 64 ms at 4× (limit 50). Desktop close p95 33 ms at 1× (limit 20). Drift is 0 px and the minimum gap is 12 px. Forced layouts per open: 1 on desktop, 0 on phone. |
| E3–E13, C-*, F-* | pass | CLS < 0.01 on every route. Idle 0.37 ms. Ambient, glass, canvas backing, Map 500-node, rail rhythm and rail pacing all pass. The theme-switch contrast frames and the flight-compositing gate both pass. |

## My own measurements

**Idle (desktop, `?bgidle=1500`, 3 s window).** Every route has 0 rAF calls, 0 running animations, 1 permanent `will-change` (`#bg-light`) and 1 `backdrop-filter`. The exceptions:
- **Search** still costs **63 ms of task time, 1 layout and 2 style recalcs** per 3 s. That is unchanged since round 1; every other route is 1.5–5.5 ms.
- Performance shows 1 layout in the window.
- Map's second `backdrop-filter` is the 0×0 hover card, so it costs nothing.

**Rail collapse (the round 1 blocker): fixed.**

| | 1× p95 | 1× max | 4× p95 | 4× max | Recalc during collapse |
|---|---|---|---|---|---|
| Today | 16.8 | 33 | 33 | 50 | 19 ms (round 1: 250 ms) |
| Feed | 16.8 | 33 | 33 | 50 | 17 ms |
| Dossier open | 16.8 | 50 | 33 | 67 | 25 ms at 1×, 52 ms at 4× plus 49 ms layout |

The remaining cost with the dossier open is layout, not style. The panel width is `min(1040px, 100vw − rail − …)`, and at 1440 that is below the cap, so the width changes on every frame and the whole dossier body re-wraps each frame.

**Phone 4× tab-ins (two passes, my sequence).** Most routes are now 0 ms. The rest:

| Route | Longest LoAF | Trace |
|---|---|---|
| Today | 83–95 ms | Two full layouts. The pending-page append frame (`app.js:271`): Layout 60 ms. The `.in` class frame (`app.js:348`): **Layout 70 ms with `partialLayout:false` (41 of 2,177 objects dirty) plus Paint 54 ms**. Animations peak at 36. |
| Feed | 67–94 ms | Layout of 648 dirty objects in the append frame. |
| Others | draft/1 53–75 ms, person/4 52–53 ms, career 0–63 ms, sources 0–51 ms | Mostly `Response.json.then` render tasks. |

**Dossier.**
- **Desktop open at 1×:** frame p50 16.7, p95 **50**, max 83 ms; 8–9 of 40 frames are over 33 ms.
- The main thread is idle during the flight; no task exceeds 9 ms. The trace puts the cost in Viz `SoftwareRenderer::DrawAndSwap`: up to 65 ms per frame and 4,304 quads.
- The cause is an animated rounded `clip-path` on a 1024×876 panel that also carries the large `--shadow-shell` box-shadow, over a full-viewport scrim, so every frame is a new masked render pass.
- This container has no GPU, so absolute numbers are pessimistic. The rail and tab switch hit 60 fps on the same compositor, though, so the dossier is the heavy outlier.
- **Close at 1×:** p95 33 ms. **Phone:** open and close are smooth (p95 16.7 ms).

**Flight frames** (`sheet-dossier-open-feed.jpg`, `frames/dossier-open-feed/`). Round 1's compositing bugs are fixed: the title rides inside the clip, the fill is opaque from frame 1, and there are no empty outlined cards. What remains:
- **259 ms:** the flying title's first line ("Gemini at Work 2026:") is cut off by the top edge of the clip.
- **425–700 ms:** the panel has landed but the body is an empty white sheet with a bare column rule, about 250 ms of nothing. Content arrives at 700–1000 ms.
- **525–709 ms:** Feed row text and "Add story URL" read faintly through the 0.94 fill (`024_609ms.jpg`).

**Tab switch (desktop 1×).** p95 16.8 ms on all six routes I sampled. The h1 overlap at about 310 ms is now low-opacity ghosting, not a collision. At 4× the frame max is 133 ms on Today.

**Theme switch.** p95 16.7 ms both ways on Today and Feed, at 50–72 ms of recalc per switch. Fixed.

**Hover.** Feed rows cost 0 recalcs per move. The Today tile costs 49 recalcs per 120 moves and 0 layouts, so it is no longer cursor tracing. The hovered tile does let the field's dashes read through its body text, though (`today-hover.png`).

**Feed filter click** (`sheet-feed-filter.jpg`):
- At 163 ms the h1 reads "stories; above ." because the figures have blanked in place while the new first line settles in.
- At 296 ms **the whole list is blank**, and the same rows (78, 72, 64, …) fade back in at 380–530 ms.
- Rows that persist through the filter still fade out and back in. That is the user's "pop", stretched out.

**Load entrance** (`sheet-load-today.jpg`). The order is now correct: the headline at 540 ms, the lede and actions at 840–990, tiles at 990–1140, then the ring count-up. The count-up decelerates visibly into 78 by about 2.2 s. Clean.

## Rubric (0–10; overall /50)

| | Score | Why |
|---|---|---|
| unique_typography | 8 | Newsreader display with the opsz settle, Geist UI, Geist Mono data. Disciplined. |
| color_cohesion | 7.5 | The quality ramp now reads as real steps (78 deep, 72 blue, 64 pale, 62 paler) and the rings have the gradient. The amber "collection off" band repeats on Today, Sources, Settings, Runs and Career, and the amber Demo tags add more amber, so warm alarm is the second colour everywhere. |
| theme_cohesion | 8 | Proof and Night are one product. Night's field is calmer than in round 1. |
| motion_cohesion | 7.5 | The settle, stagger, count-up, rail and theme now speak one language, and the flight stays inside its clip. The Feed filter (blank list, half-written h1) and the empty-panel beat after the dossier lands don't belong. |
| motion_smoothness | 7 | Big gains: the rail collapse is 60 fps at 1×, the theme switch and tab switch are smooth at 1×, idle is silent, and 5 of 8 E1 routes are at 0. Still failing: E1 on Today, Feed and Settings (68–95 ms); the desktop dossier open at p95 50 ms on 1×; E2 open and close at 4×; rail collapse with the dossier open at 64 ms p95 on 4×. |
| generic_typography | 2 | Not generic. Mono caps are mostly limited to eyebrows and column heads now. |
| background_generic | 2.5 | The ruled field is ours and correctly paced. Under the hover pool its dashes run through body text, which reads as lined paper. |
| color_combo_generic | 2.5 | White with electric blue is still the stock pro-tool pair. The ramp adds depth, but the only other note is amber. |
| motion_generic | 2 | No expo curve, shimmer, sheen, tilt or per-character effects. |
| ai_slop | 2 | Honest data and empty states everywhere. Career's KPI number tiles and Performance's 13-empty-bar chart are the only template-y parts. |
| **overall** | **38** | A real step from 36. Every interaction the user touches most is smoother, and the content is honest and dense. **Not at the bar:** color_cohesion, motion_cohesion and motion_smoothness are below 8, two negatives sit at 2.5, and E1 and E2 still fail. |

## Tab scores (/100, the user's way)

| Tab | Score | Why |
|---|---|---|
| rail | 89 | Groups, sliding highlight, an even collapsed rhythm (36/44 measured), a real by—line mark, and the collapse is now 60 fps with or without the dossier at 1×. |
| today | 88 | Issue number, date, informative headline and numeric one-liner, weather, real mini-map with top 3, why-ranked bullets, gradient rings, correct load order. Capped by the 83–95 ms phone tab-in (two full layouts) and about 60–70 px dead bands inside the lead tile. |
| dossier | 87 | Best content in the app: what each source said, unequal weights visible, and it adapts to the rail with 160 px of page left showing. The flight is no longer broken, but it still drops frames on desktop. Also: the body sits empty for about 250 ms after landing, the title clips at the top mid-flight, and page text ghosts through the fill. |
| feed | 87 | Clear title/meta step, independent markers, top two topics, a quiet field. Every filter click blanks the whole list and half-writes the h1. The phone tab-in is 67–94 ms. |
| map | 86 | A real clickable graph with regions, top 3 and a bridge card. Truncated node labels collide with edges in the dense centre. |
| search | 86 | Big bar, typed quick chips, grouped results, claims with numbers. Still does idle work (63 ms per 3 s) that no other tab does. |
| studio | 82 | Clear review lead and grouped drafts. Below the first fold the right column ends, leaving about 800 px of empty right half beside a long list. It is still a list page more than a workshop. |
| calendar | 83 | Month grid with no day/date gap, tray and cadence. Dashed "open slot" chips in an empty month read as fake content; two empty weeks dominate. |
| campaigns | 83 | Useful candidate list and honest counts; the right column has substance now. |
| performance | 79 | Honest empty state. The "Last edit per open draft · 14 days" chart is 13 empty bars and one full bar, an unexplained mini graph conveying one fact. "Closest to publishing" lists the same title three times. |
| career | 81 | Strong headline and the duplicate warning. Five generic KPI number tiles, a Trend column that is empty on all 23 rows, and an awkward one-liner ("In 1 of 1 saved job post…"). |
| employers | 81 | The coverage table works. Pin/Edit/Activity buttons fill the right third of every row. |
| people | 85 | Overdue items, do-not-contact, duplicate warning, pipeline. Dense and honest. |
| sources | 85 | Rich summary with a now-versus-before-the-pause health bar and expandable rows. |
| runs | 86 | Stages, costs and history; plain about the 0-source runs. |
| settings | 83 | Well sectioned with source health. About 3,450 px long, the floating "Ranking" label is misaligned with the cards, and the phone tab-in is 71 ms. |

## Fixes (ranked by score movement)

1. **[shared · blocker] The router's `.in` frame does a full-document layout.**
   - **Problem:** at phone 4×, Today's swap pays Layout 70 ms with `partialLayout:false` (41 of 2,177 objects dirty) plus Paint 54 ms in the frame where `app.js:348` adds `.in`. The append frame (`app.js:271`) adds another 60 ms layout.
   - **Fix, part 1:** stop driving the stagger with a page-level class plus inherited custom properties (`--enter-base`, `--enter-head`, `--i` on `.page`). Create one WAAPI animation per enter item in the swap task instead (`el.animate([{opacity:0, transform:'translateY(10px)'},{opacity:1, transform:'none'}], {delay: base + i*stagger, fill:'backwards', easing: EASE.settle})`). Then no class or custom property changes on an ancestor of about 2,000 nodes.
   - **Fix, part 2:** trace again and find what makes the layout non-partial. Check `window.scrollTo`, and check the old page's removal resizing `#view`'s shared grid cell. Fix whatever it is.
   - **Targets:** in a phone 4× trace, the swap-frame Layout is under 15 ms and partial. E1 passes on today, feed and settings (longest LoAF under 50 ms).
2. **[today · blocker] Render Today's below-fold rows lazily.**
   - Add the shared `.cv` class to the News weather, News map, This week, Waiting on you and Also in the brief tiles. Set `contain-intrinsic-size: auto` to their measured heights: about 430, 430, 280, 280 and 340 px.
   - Start the weather dot render and the ring count-up on `byline:routed`, not in the fetch-resolve task.
   - Target: Today E1 under 50 ms at phone 4×, with the append-frame layout under 20 ms.
3. **[shared · blocker] Dossier flight frame drops on desktop.**
   - **Problem:** at 1×, 8–9 of 40 frames are over 33 ms and p95 is 50 ms. The compositor is the bottleneck: an animated rounded `clip-path` on a 1024×876 panel that also carries the large `--shadow-shell` shadow, so every frame is a new masked render pass.
   - **Fix:**
     - During the flight, set `box-shadow: inset 0 0 0 1px var(--glass-border)` only.
     - Move the soft shadow to a `.dossier-panel::after` that fades its opacity in over 200 ms after `landed`. This is the same pre-rendered-shadow pattern as tiles.
     - Animate the clip's corner radius only over the last 25% (`round 0px` until offset .75, then `round 16px`), or drop `round` from the keyframes and rely on the panel's own `border-radius` with `overflow: hidden`.
   - **Targets:** add a desktop open frame p95 check at 1× to E2, at ≤20 ms. E2 desktop open stays under 50 ms at 4×.
4. **[shared · blocker] Rail collapse with the dossier open re-wraps the dossier on every frame.**
   - **Problem:** 52 ms of style and 49 ms of layout per collapse at 4×, p95 64 ms in E2.
   - **Fix:** make the panel width independent of the animated `--rail-w`, so the collapse only moves the panel. In `components.css`, use `width: min(1040px, calc(100vw - var(--rail-expanded) - 2 * var(--shell-inset) - 160px))`. With `contain: layout paint` already on the panel, moving it does not relay out its children. When the rail is collapsed, more page shows on the right, which honours "doesn't fill the screen".
   - **Targets:** E2 rail-collapse p95 ≤33 ms at 4×. Drift stays 0 and the minimum gap stays ≥0.
5. **[shared] The dossier lands as an empty white sheet.**
   - **Problem:** sections start at `base = 300 ms`, with 360–500 ms fades. The `[data-col]` divider paints before any content, so from 425 to 700 ms the user sees a blank panel with a vertical rule.
   - **Fix:**
     - In `dossier.js` `open()`, use `base = 160` when flying.
     - Animate the column divider with the column (it must not paint at full opacity first).
     - Cap the section stagger so section 1 is fully visible by 480 ms after the click.
   - Target: no capture frame between 400 and 700 ms shows an empty panel body.
6. **[shared] The flying title clips at the top of the panel.** At 259 ms, the title's first line sits above the clip's top edge. In `rTo()`, pad the source rect by `max(8px, titleLineHeight − rowPaddingTop)` at the top, or translate-from the clone so its top never sits above the current clip inset. Target: in a 60 fps capture, no title glyph is cut by the clip in any frame.
7. **[shared] Page text ghosts through the flight fill.**
   - Raise `--surface-flight` from .94 to .98 in both themes (`tokens.css`). This overrides DECISIONS' 0.94: the captures show Feed rows readable through the panel at 525–709 ms, which breaks the user's "never slides under" and legibility asks. The cost is nil, because the frost replaces the fill after landing.
   - Target: page-text contrast inside the panel during the flight is below 1.1:1.
8. **[feed-dossier] A filter click blanks the whole list and half-writes the h1.**
   - Key the rows by story id:
     - Rows present before and after the click stay at opacity 1 and FLIP to their new position (transform, 240 ms `--ease-move`).
     - Only new rows fade in (opacity 0→1, 240 ms, 30 ms stagger, maximum 6).
     - Leaving rows fade out over 140 ms.
   - For the h1, either cross-fade the whole heading (old out 120 ms, then the `enterHeading` tab variant), or swap the changed figures with an opacity dip to no less than 0.5. Never leave blank gaps in place.
   - Target: in a capture, persisting rows never go below 0.9 opacity, and no frame shows an h1 with missing figures.
9. **[feed-dossier] Feed phone tab-in is 67–94 ms.** In `feed.js`, set `CV_FROM` so rows after the 8th always get `cv-row`, even on the 7-day list, and render rows past the first viewport in the idle pump. Target: Feed E1 under 50 ms at phone 4×.
10. **[search-system] Settings phone tab-in is 71 ms.** Add `.cv` to every `.sg-fold` section after the first two (`contain-intrinsic-size: auto 480px`). Target: Settings E1 under 50 ms.
11. **[search-system] Search does idle work.**
    - **Problem:** 63 ms of task time, 1 layout and 2 recalcs per 3 s at rest; every other route is under 6 ms.
    - **Fix:**
      - Make the `setTimeout(run, 2500)` fallback at `search.js:83` a no-op when the idle run already happened.
      - Put `contain: layout paint` on the search bar wrapper so the autofocused caret repaints only the bar.
    - Target: under 6 ms of task time and 0 layouts per 3 s idle on `#/search`.
12. **[shared] Dossier close is p95 33 ms at 1× (E2 limit 20).** In `close()`, once the 140 ms body fade finishes, set `.dossier-scroll{display:none}` so the clip animates over an empty fill only. Apply the same shadow handling as fix 3 for the rest of the close. Target: E2 close frame p95 ≤20 ms at 1× and E2 close under 50 ms at 4×.
13. **[shared] The hovered tile shows the field's dashes through its body text.** Under `#bg-light`'s pool, the tile's translucency lets the dash rows read through "Why it ranked". Keep the pool (the user asked for light reaction), but raise the hovered tile's surface to ≥0.94 opacity in `components.css` (`.tile:hover` background). Alternatively, pass the hovered tile's rect to the shader as a softened region, as the rail does. Target: dash contrast under hovered body text below 1.08:1.
14. **[today] Dead bands in the lead tile.** There is about 60 px of empty space between the finding and the "Why it ranked" rule, and about 70 px between the "Named" chips and the footer. Tighten both to 24 px, or put "Named" on the footer row next to the source counts. Target: no vertical gap over 32 px inside the lead tile at 1440.
15. **[career-publish] Performance's mini chart says one fact.** "Last edit per open draft · 14 days" draws 13 empty bars and one bar. Show the chart only when edits span 3 or more distinct days; otherwise state the sentence that is already there ("All 22 open drafts were last edited Wed 18 Nov"). In "Closest to publishing", group drafts by story: one title, with channel chips (LinkedIn · In review, Video, Instagram) instead of the same title three times.
16. **[career-publish] Career's template parts.**
    - Remove the Trend column while every row reads "needs 2+ weeks of history", and keep that note in the table caption.
    - Fold the five KPI number tiles into one sentence strip under the one-liner, or keep at most 3 tiles with a delta or context each.
    - Rewrite the one-liner without "In 1 of 1": "Your 1 saved job post (7 copies, counted once) names 9 radar skills; AI governance shows up only there."
17. **[calendar-studio] Calendar's "open slot" chips.** Dashed "open slot" chips on Fri 20, 23, 25, 27 and 30 read as fake entries in an empty month. Replace them with a 4 px accent-line dot under the day number for posting days, with the legend "● posting day, nothing planned". Target: an empty month shows no chip-shaped elements.
18. **[calendar-studio] Studio's empty right half.** At 1440, the right column (Above your bar, Next open posting day) ends at about 740 px while the draft list runs to 1,540. Make `.st-aside` `position: sticky; top: 76px`, and add a "By channel this week" card (12 LinkedIn, 5 Instagram, 5 video against the posting days) so the workshop keeps context while you scroll. Target: no empty column longer than one tile height at 1440.
19. **[map] Labels collide with edges.** Labels such as "Digital Standards Office publishes…" and "Study: 62% of enterprise AI pilots…" cross edges in the dense centre. Draw node labels with a 3 px `--bg` halo (strokeText before fillText) and show the full title only on hover or selection. Defer the first canvas draw to `byline:routed` + 1 frame (the desktop 4× Map tab-in is 55 ms).
20. **[career-publish] Employers row actions.** Pin, Edit and Activity buttons take the right third of each row. Make Pin an icon toggle next to the name, put Edit in the row's overflow menu, and turn Activity into a row link. Give the freed width to the team watchlists column.
21. **[search-system] Settings length and alignment.** The section label ("Ranking") sits at x 518 while cards start at 541. Align the labels with the card edge. Collapse Calendar feed & access, Media and Budget into closed-by-default disclosures. Target: page height ≤2,400 px at 1440.
22. **[shared] Phone dossier action row clips.** At 390 px "Open primary" is cut to "Op…" at the right edge of the sticky action bar. Move Open primary into the Draft split-button menu on phone, or let the row wrap.
23. **[test] Add the round-2 measurements to the harness** (`test/e2e/gates/perf.mjs` / `motion.mjs`):
    - E2: desktop dossier open frame p95 at 1× ≤20 ms.
    - A Feed filter-change check: persisting rows' minimum opacity ≥0.9.
    - E1: a trace check that the swap frame's Layout is partial and under 15 ms at 4×.
    - E4 per route: Search idle task time under 6 ms per 3 s.

## Verdict

Round 1's blockers are mostly gone:
- The rail collapse no longer restyles the document (250 ms → 19 ms of recalc, 60 fps).
- The theme switch is smooth.
- The dossier flight composites correctly.
- Five of eight E1 routes cost nothing.
- Idle is silent everywhere but Search.

What still drops frames is concentrated in three places:
1. The router's swap frame does a full-document layout on heavy pages (Today, Feed, Settings).
2. The dossier's rounded-clip flight is expensive on the compositor, and so is collapsing the rail with the dossier open, because the panel re-wraps every frame.
3. The Feed filter blanks and refills rows that never changed.

Fixes 1–5 and 8 are mostly order-of-work and CSS-scope changes. With them, plus 13–16, I expect motion_smoothness and motion_cohesion at 8, Today and the dossier at 90 or above, and overall at about 40.
