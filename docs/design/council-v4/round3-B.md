# Council v4 · Round 3 · Critic B (colour, theme cohesion, ruled field, brand mark, quality ramp)

**Build reviewed:** branch `v4` at `0504dc2`, running live on :4450. I checked it in Playwright at 1440×900 and 390×844, in Proof and Night, covering:
- all 14 tabs, plus draft/1 and person/4
- the dossier opened from Feed and from Today, then scrolled
- the rail collapsed with the dossier open (frame strip), then closed with Esc
- tile hover in both themes
- the bare field with content hidden, plus the pointer light
- theme switch colour sampled on every rAF
- the ring on a feed→today revisit (rAF log)
- the cold-load entrance on Feed (10 frames)

**Captures:** `/tmp/claude-0/council-B-r3/`, at deviceScaleFactor 1. The full sweep logged 0 console errors, 0 page errors and no horizontal scroll on any route.

**Gates I ran** (`--port 4460 --only E2,C-theme,E8`):

| Gate | Result | Checks | What failed |
|---|---|---|---|
| E8 | PASS | 19/19 | — |
| E2 | FAIL | 11/13 | desktop open longest frame 52 ms (`onhashchange` app.js 13 ms, forced 1); close p95 at 1× 33.3 ms (limit 20). Collapse p95 at 4× now passes (29.3). |
| C-theme | FAIL | 11/12 | every contrast frame passes (lowest 3.07 on any frame); the Proof-direction frame p95 is 33.4 ms against a limit of 33. |

## Rubric

| | round 2 (mine) | round 3 |
|---|---|---|
| unique_typography | 8 | 8.3 |
| color_cohesion | 8 | 8.4 |
| theme_cohesion | 8 | 8.3 |
| motion_cohesion | 7.5 | 8 |
| motion_smoothness | 7 | 7.5 |
| generic_typography | 2 | 2 |
| background_generic | 2 | 1.8 |
| color_combo_generic | 2.5 | 2 |
| motion_generic | 2 | 2 |
| ai_slop | 2 | 1.8 |
| **overall** | **38** | **40 / 50** |

**Verdict:** my lens now clears the bar. Only motion_smoothness (7.5) misses: E1 and E2 are still marginal, and C-theme misses by 0.4 ms in the Proof direction.

### What landed (verified live)

**Score chips now carry the ramp.** I read the computed values on Feed in Proof:
- In the clears band, L falls .946 → .924 → .910 → .901 → .883 across 56, 59, 61, 62 and 64.
- 72 is `rgb(21,72,210)` and 78 is `rgb(14,53,172)`.
- 44 and 42 are near misses: a filled 10% mix with a 1.5 px outline.
- 38 and below are outline only, with text in `--text-3`.
- Night mirrors this: 56 → 64 runs L .275 → .341, and the top chips are light fills with dark ink.

This was my biggest round-2 complaint, and it is fixed.

**Blue now marks quality, not decoration.**
- Feed has exactly 7 `.chip--main` pills, one per story above the bar, and 11 neutral `.chip--lead`. That matches "7 above 55".
- Search, Studio and Campaigns follow the same rule.
- The Map Hottest-topics bars, the People meter, the Career pips and the Employers bars are all neutral ink now.

**Hover.** The Proof wash is now a faint blue lift with a blue hairline and the background pool. It reads as hover, not as selected. Night has the same character.

**Ring revisit.** On feed→today, the lead ring reads "78" on every frame from 12 ms to 1,208 ms, so there is no 0-then-snap.

**Theme switch.** The ink no longer meets mid-grey on mid-grey. The lowest contrast on any frame is 3.07 going to Night and 4.09 going to Proof.

**Dossier.**
- The topbar is hidden while the dossier is open.
- The close button sits on a solid backing, and a top fade appears on scroll.
- The frost holds through the rail collapse: no page glyphs show inside the panel in any frame.
- The panel keeps a constant width, and only `left` moves.
- All 8 sections render, including from the prebuild.

**Rail mark.** The by—line mark now matches the wordmark's weight and size at 1440 in both themes. The collapsed rail pitch is even.

**Field.** Rows of typeset dashes drift as satin, with a blue heat tint where topics run hot. The band behind the page head is softened, and the rail area is area-mean frosted. The pointer light is a soft pool, not a trail. It reads as Byline's own background, not a generic dot grid or gradient blob.

### What still holds scores down (my lens)

1. **Tag colour contradicts itself in the dossier.**
   - Under Employer connections, "First-party" and "Named in a source" use the green `tag--ok`.
   - In the same panel, "First-party only" is an amber caution callout.
   - Green should mean healthy or sent, not "this is the company talking about itself".
2. **Theme switch pacing.** The hold step maps every ink, including links, red, amber and `--text-2/3`, to one strong ink. The hierarchy then snaps back at about 470 ms, while the surface is still moving.
   - It is legible, but blue links and status colours vanish for about 200 ms and then pop back.
   - The extra document restyle mid-fade is also the most likely cause of the 33.4 ms p95 in the Proof direction.
3. **Overlapping dots in the News weather chart** render as smudges. In Agent orchestration, two hollow dots at about 51 look like "⊘", and filled pairs at 57–58 merge. This is the one chart on Today; it should read crisply.
4. **Motion smoothness.** E2 desktop open has a 52 ms long frame (a forced layout in `onhashchange`), and close p95 at 1× is 33 ms. E1 misses by 2–17 ms, and which routes miss changes from run to run.

## Per-tab scores (user-style, /100)

| tab | score | why |
|---|---|---|
| rail | 90 | Even collapsed rhythm, groups that explain themselves, sliding highlight, clean footer. The mark now holds its own next to the wordmark. |
| today | 89 | Informative headline and numeric one-liner, ramp rings with no tick, why-ranked bullets, labelled weather and map, honest collection-off band, calm hover. Below 90: "This week" shows seven 140 px empty day tubes when nothing is planned, overlapping weather dots smudge, and the head row has a lone button floating in empty space to the right of the h1. |
| dossier | 90 | Aligned to the rail, constant width, adapts on collapse with the frost intact. Per-source summaries and key claims, unequal-weight breakdown, a lens with testable steps. Loses a little: the green First-party tag contradicts the amber first-party callout, and why-ranked uses numbered circles here but dashes on Today. |
| feed | 89 | The chip ramp is finally visible inside each tier, blue pills only above the bar, a strong headline-to-meta step, a source glyph key and a threshold divider. Below-bar rows all share the same grey outline from 38 down to 7, which is acceptable and honest. |
| map | 87 | Real graph, ramp nodes with hollow below-bar nodes, labelled regions, neutral topic bars with units. The side panel's last line is clipped mid-sentence at 1440×900, and "Hottest topics" wraps to two lines beside its caption. |
| search | 87 | Big bar, typed quick chips, grouped useful results, the pill rule applied. The claim rows' score chip reads "story 16", which looks like a story ID rather than a score of 16. |
| studio | 86 | Grouped by story, a By channel card, the hook as the second voice, a checklist before approval. The status column jumps right on rows with no "1d ago" (Hot take), and "Headline hook" is jargon. |
| calendar | 86 | Month grid, no day/date gap, ramp story dots, a quiet past wash, tray and cadence. On phone the tray's calendar and ↗ icons stack under the status tag. |
| campaigns | 85 | Data headline, anchors grouped by topic, a permanent Start campaign, neutral channel bars. "Next open posting slots" repeats "Fri 20 Nov" three times, and the anchor list is still essentially Feed's top 7. |
| performance | 85 | Pipeline strip, grouped Closest to publishing, a sentence instead of the empty chart. Next open slots repeats "Fri 20 Nov" three times above an 80 px dead gap, and the zero "Published" cell carries an unexplained grey fill. |
| career | 86 | Grammatical h1, honest duplicate warning, neutral bars and pips, collapsed long tail, the trend column honestly withheld. "agents" and "agentic" are listed separately, and the casing is mixed (Bedrock / evals). |
| employers | 84 | Chrome is much quieter. But the three Google rows show the same two story titles, set in small Newsreader that wraps mid-title. The pinned rows' dark left rule is unlabelled, and the watchlist column is mostly empty white. |
| people | 86 | Overdue, duplicate and do-not-contact states are clear, with a neutral pipeline. Red appears twice per overdue row (pill plus mono date). |
| sources | 87 | Before/after health bar, hollow dots that now carry ok/err colour, "was failing" in the error tone, rich expandable rows. |
| runs | 87 | Clear stages, Collect amber when 0 sources were read, grouped repeat runs, cost and feedback context. |
| settings | 86 | About 2,390 px now, with a source-health summary, neutral sliders and amber negative thumbs, collapsible tail cards. Terms inputs truncate mid-word, and the three summary cards at the bottom end at different heights. |

## Fixes (ranked by score impact)

1. **[shared · blocker: motion_smoothness] E2 open long frame and close pacing.**
   - The desktop open has a 52 ms frame, with `onhashchange` in app.js taking 13 ms and 1 forced layout. Move the dossier open off `hashchange`: call `dossier.open(id, srcEl)` directly from the click handler, and update the hash with `history.replaceState` afterwards so no route work runs in the flight frame.
   - Close p95 at 1× is 33 ms. Drop the scrim opacity transition from the close frame (fade it in the frame after the clip starts), and don't remove `dossier-open` from `html` until `transitionend`, because that removal restyles the topbar mid-clip.
   - Target: E2 13/13, with open longest frame < 50 and close p95 ≤ 20.
2. **[shared · blocker: motion_smoothness/theme_cohesion] Theme ink return.**
   - In `app.js applyTheme`, delete the `T*.78` step that removes `ink-strong-${next}`. Remove that class in the same timeout as `theme-xfade` (T + 60), so only one document restyle lands mid-fade.
   - Optionally, keep `--accent-text` held at the strong ink, but restore `--warn-text`/`--err-text` at the mid step; they measure ≥ 3:1 on the new theme's surfaces from 50% onward. Verify with C-theme.
   - Target: C-theme 12/12 (Proof p95 ≤ 33 ms), with no visible second ink step while the surface is moving.
3. **[feed-dossier] First-party tag colour.**
   - In `story-dossier.js:554`, render `First-party` as `tag--warn`, which matches the amber "First-party only" callout, and `Named in a source` as the neutral `tag`. `tag--ok` stays reserved for health and sent states.
   - Target: no green tag in the dossier for a story with 0 independent posts.
4. **[today · blocker: today ≥ 90] Empty day tubes.**
   - In "This week", when 0 posts are planned, give `.td-week` day cells `min-height: 56px` (date, weekday, posting-day ring) instead of about 140 px. The "Suggested next post" column then sets the card height.
   - When drafts are planned, let cells grow to their content.
   - Target: no empty vertical band over 32 px inside the card at 1440.
5. **[today] Weather dot overlap.**
   - In the News weather dot plot, offset dots whose x positions fall within 6 px of each other: alternate ±4 px vertically (a beeswarm with 2 lanes), keeping the 1 px surface ring around each dot.
   - Hollow dots get the ring too, so two hollow dots never read as "⊘".
   - Target: every dot in the 19 is individually visible at 1440 and 390.
6. **[today] Head row balance.**
   - "Run today's workflow" and the ··· button float about 120 px below the top of the h1, with about 300 px of blank space to their right.
   - Align the action group to the h1's last baseline (`align-self: end`, margin-bottom equal to the lede gap), or move it into the status row beside the collection-off band's links.
   - Target: no free-floating control in the head band.
7. **[feed-dossier] Why-ranked marker parity.** The dossier uses numbered circles while Today uses blue dashes for the same three bullets. Use the same marker in both (the dashes, since Today is the user-approved reference), so the shared content reads as one element.
8. **[career-publish · blocker: employers ≥ 85] Collapse duplicate story lists.**
   - When several employers share an identical story set (the three Google rows), show the titles once on the first row. On the others, show "Same 2 stories as Google (other teams)" in `--text-2`.
   - Set story titles in the UI sans at 13/18, not Newsreader at 13, and clamp each to one line with an ellipsis and a full-title tooltip.
   - Target: no title wraps mid-phrase, and no repeated block of the same titles.
9. **[career-publish] Label the pinned rule.** The dark 3 px left rule on pinned rows has no legend. Add "Pinned" to the Coverage caption legend (a small rule swatch plus the word), or replace the rule with the existing filled-pin icon only.
10. **[career-publish] Watchlist column dead space.** Most rows leave the Team watchlists column empty. Merge it into the employer cell as a second line ("Following: Bedrock Agents"), and drop the column so the stories column gains about 230 px.
11. **[career-publish] Repeated slot dates.**
    - In Campaigns' "Next open posting slots" and Performance's "Next open slots", when every channel shares one date, render one line: "Fri 20 Nov: open on LinkedIn, Instagram and Video". Studio already does this.
    - In Performance, remove the about 80 px gap above "Import results from a CSV": no `margin-top: auto` on a fixed-height card.
12. **[career-publish] Performance "Published" cell fill.** The zero Published cell has a grey fill that no other stage has, and nothing explains it. Either drop the fill, or label it ("Metrics start here").
13. **[career-publish] Career skill merges.** Show "agentic" folded into "agents" (as "evals" already shows "also Evals"), so the radar isn't split across inflections. Display skills in their source casing consistently: lower-case common nouns, and acronyms and proper nouns as written.
14. **[search-system] Claim score label.**
    - In `search.js:187`, the claim row chip reads "story 16", which collides with story IDs (the dossier for story 16 is a different story).
    - Render it as "scored 16" (or the plain chip with the tooltip "Story score 16"), followed by the story title link.
    - Target: no "story N" text where N is a score.
15. **[map] Side-panel clip.**
    - At 1440×900, the side panel's last line "Select a story to light up its links and list its…" is cut by the card bottom.
    - Let the panel scroll (`overflow:auto` with a 24 px bottom fade), or move that hint above "Biggest bridge".
    - Keep "Hottest topics" on one line: put the caption under the heading, not beside it.
16. **[calendar-studio] Studio status column.** Rows without a time (Hot take · LinkedIn · short) push the Draft tag about 80 px right. Give `.st-row` a fixed grid (`… 96px status 64px time 16px arrow`) and render an empty time cell, so tags align down the list.
17. **[calendar-studio] "Headline hook" jargon.** Replace it with "Opens with the story headline · 5 scenes" (or, better, the second section's first 60 characters), so rows say what is different.
18. **[calendar-studio] Phone tray icons.** At 390, each tray row stacks the ↗ and calendar icons under the status tag. Put them inline in one row aligned right (`display:flex; gap:8px`), or move them into the row's tap target.
19. **[search-system] Settings summary cards.**
    - The three cards at the bottom (Writing, Publishing, System) end at different heights. Use `align-items: stretch` with the content at the top.
    - For Priority terms, show the first terms with "+N more" instead of a mid-word truncation, keeping the full value in the input on focus.
20. **[career-publish] People double red.** On overdue rows, keep the red "Overdue · 18 Nov" pill and set the next-step mono date in `--text-2`, so red appears once per row.

## Holding firm (don't change)

- **Ramp.** The ring gradient runs from the threshold colour to the score colour, with no tick and no bar. Chips use banded `--qd` mixing, and map nodes are hollow below the bar.
- **Blue budget.** Blue marks the bar, quality, links and the primary action only.
- **Tokens and AA in both themes.** Status hues are never blue and are always labelled.
- **Field.** Keep the current strength: heat tint, page-head softening, rail area-mean, pointer pool. Don't strengthen it further.
- **Glass.** One live backdrop-filter at rest; the topbar is hidden while the dossier is open.
