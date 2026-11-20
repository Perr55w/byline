# Council F, round 1: type, information and data honesty (v4 HEAD 8eb8113)

Lens: the type scale and hierarchy; whether each headline and one-liner states a finding with numbers; data honesty (posts, outlets, first-party and independent counts, ranked not scanned, the threshold read from settings); wording; accessibility (contrast and focus).

## How I looked

- I ran the app live on :4454 in Playwright at deviceScaleFactor 1. I covered all 14 routes plus `#/story/16` (opened from a Feed row and from the Today lead), `#/draft/1` and `#/person/4`, in Proof and Night, at 1440 and 390 wide.
- I collapsed the rail with the dossier open, both with the mouse and with `[`. I also checked the Map selection, a Search query ("agent"), the Calendar week view, scrolling Settings, and hovering and focusing a Feed row.
- On the Today load I sampled per-element opacity every 60 ms and saved a frame sheet.
- I measured every visible text node's computed font and contrast against its composited background, in both themes, on 14 routes.
- Captures are in `/tmp/claude-0/council-F-r1/`. The key files are `today_light_1440_full.png`, `dossier-scroll{1,2}_1440.png`, `map-clicked.png`, `search-agent_1440_full.png`, `calendar-week_1440.png`, `career_light_1440_full.png`, `phone-sheet.png`, `today-load-sheet.png`, `a11y-light.json` and `a11y-dark.json`.

## What is right (and it is a lot)

- **Every tab's headline and one-liner is now a finding with numbers.** They follow my round-0 templates closely and are true against the DB:
  - Today: "Agent orchestration dominates the brief." / "7 of 19 ranked stories cleared your threshold of 55. Agent orchestration is in 6 of them; AI governance in 4. Top: Gemini at Work 2026 at 78, with no independent report yet. No run yet today."
  - Feed, Map, Search, Studio, Calendar, Campaigns, Performance, People, Sources, Runs and Settings all match the templates.
  - The threshold is read from settings (55) everywhere, "ranked" has replaced "scanned", and times are shown in ET.
- **The source vocabulary is honest everywhere I looked.**
  - Story 16 reads "6 posts · 1 outlet · 0 independent".
  - "credible independent source" appears nowhere.
  - The status pill reads "No. 1 · Wed 18 Nov · ● Ran 6:28 PM · 0 new · 19 ranked · 7 above 55", with an amber dot because the run read 0 sources.
- **Data problems are surfaced honestly:**
  - all sources paused and the schedule off, on Today, Sources, Runs and Settings
  - the brief being from yesterday
  - Demo tags
  - duplicate job posts and a duplicate contact
- **The dossier's information architecture is to spec.**
  - The dek is the finding line, not the summary.
  - It has a "What the sources say" summary sentence, the first-party-only callout and "6 posts from cloud.google.com (first-party)" collapsing.
  - The evidence is grouped into the four plain-language groups, with matched terms shown.
  - The score breakdown has track length = weight (35/25/20/20), shows the multipliers and ends "= 77.8, matches the stored score".
- **Type system.**
  - h1: Newsreader 48/50, opsz 72, wght 400, −0.02em. The Today display is 67/67 at wght 380.
  - Ledes: Geist 18/27.
  - The Feed title (Newsreader 20) against the meta (Geist Mono 12) is a 1.67 step.
  - Numbers are tnum.
- **Accessibility.**
  - With an approximate composited-background check, 0 text nodes fail AA, in both themes, on all 14 routes.
  - There is a skip link, `nav[aria-label=Primary]` with `aria-current`, and one h1 per view (with an sr-only "Today:").
  - Focus is visible as a 3 px ring, and after Esc it returns to the Feed title that opened the dossier.

## What holds it back (my lens)

1. **The same number means different things on different tiles, without labels.**
   - Today's "Waiting on you" says **"22 drafts awaiting review"**, but Studio's h1 says **"1 draft is waiting on your review"** (21 are plain drafts).
   - The Today map tile and the Map tab list "AI governance · 3 stories", which counts stories whose *main* topic it is. The Today headline says "AI governance in 4" (cleared stories), and the Feed and Map chips say "AI governance 8" (all stories).
   - "6 stories · 6 updated this week" repeats one number twice.
2. **Truncation cuts findings mid-number.**
   - Feed finding lines clamp to 1 line: "more than one…", "on 60 workflow…".
   - The Map one-liner reads "Northwind AI releases Relay, an open-source agent… connects 10".
   - Studio, the Calendar tray and the Search refine panel ellipsise titles. The rule is that titles wrap to 2 lines and are never ellipsised.
3. **Uppercase mono is everywhere.** I counted visible uppercase-mono nodes: 27 on Today, 34 on Search, 37 on Career and 40 on People. Every status tag (IN REVIEW, DRAFT, DEMO, PINNED, DO NOT CONTACT, OVERDUE, NEW THIS WEEK, SENT, PRIMARY, TOPICAL ONLY) and in-tile sublabel is mono caps. DECISIONS limits mono caps to eyebrows, column heads and rail group names. This is the remaining "template" tell.
4. **Boilerplate and broken wording still leak into the product:**
   - "Independent check: Independent testers at…"
   - "Mentions standard."
   - "610 replys"
   - dossier article summaries that are press-release openers ("Today, we are announcing…")
   - the employer-connection block repeating one quote and one caveat five times ("works publicly on AI adoption, AI adoption")
   - draft #1's "My perspective" printing one sentence three times
5. **The quality ramp is flat where the user looks.** It saturates at T+15 = 70, so the 72 and 78 rings are both `rgb(10 63 214)`. The user asked for a quality *gradient*, and Today's three rings show only two colours.
6. **The load order inverts the hierarchy.** Tiles reach 90% opacity at 770 ms while the one-liner, the numeric finding, is still at 0. It starts at 836 ms and settles at 1.3 s. The eyebrow, "Run today's workflow" and the amber banner are at full opacity while the h1 is still blurred, so the eye reads banner → tiles → sentence.
7. **Bare numbers with no work to do:**
   - Sources shows four big zeros (0 collecting, 0 healthy, 0 stale, 0 failing), and its 7D column equals TOTAL on every row.
   - Career's "source mentions" equals "this week" on every row, and "0/0 experiences public OK" is cryptic.
   - Employers' People column is all 0.
8. **Phone:** the status pill truncates after "0 new", so the two figures that matter (19 ranked · 7 above 55) are cut.

## Rubric

| | Score |
|---|---|
| unique_typography | 8 |
| color_cohesion | 7 |
| theme_cohesion | 8 |
| motion_cohesion | 7 |
| motion_smoothness | 7 |
| generic_typography | 2 |
| background_generic | 3 |
| color_combo_generic | 3 |
| motion_generic | 2 |
| ai_slop | 3 |
| **overall** | **38 / 50** |

**Verdict: not at the bar.** The overall meets 38, but color_cohesion, motion_cohesion and motion_smoothness are at 7 (below 8), and background_generic, color_combo_generic and ai_slop are at 3 (above 2).

From my lens, ai_slop is 3 because of the mono-caps tag system and the boilerplate leaks. Fixes 6, 9, 13 and 14 bring it to 2. Fixes 3 and 5 move the colour and motion numbers.

## Tab scores (out of 100)

| Tab | Score | Why |
|---|---|---|
| rail | 87 | Groups explain themselves, the sliding highlight works and the collapsed rhythm is even. While the dossier is open the collapse button can't be clicked (the scrim covers it). At 26 px the by-line mark's underline is lost. |
| today | 87 | Best headline and one-liner in any version, with an issue line, why-ranked bullets, the weather chart and the map top 3. It loses points because "22 drafts awaiting review" contradicts Studio, map-tile counts are unlabelled, the ring colours are identical at 72 and 78, the one-liner lands after the tiles, and one secondary tile has about 90 px of dead space. |
| dossier | 86 | The information architecture is right: the sources summary, the first-party callout, plain-language evidence and a breakdown that reconciles. Losses: the employer-connection boilerplate repeats 5× (about 520 px), "6 posts · 1 outlet · 0 independent" appears 3 times, boilerplate article summaries, a "Key claim" that repeats the dek, ring "+23" next to breakdown "22.8", and the panel spans the full content width. |
| feed | 86 | Clear title-to-meta step, the top two topics, a threshold divider and honest source counts. Finding lines truncate mid-number. The ■◆○ glyph runs repeat the post count with no legend. "replys" typo. "Mentions standard." |
| map | 81 | A real clickable graph with a related-stories timeline and the top 3. Region labels count main-topic stories ("AI governance 3") next to chips counting all stories ("8"). The two largest regions are unlabelled. The one-liner truncates the bridge title mid-phrase. The side panel clips at 900 px. |
| search | 84 | Big bar, quick chips, grouped results with number highlights and keyboard hints. The Drafts group shows the same title 5 times. Three watchlist chips lead to 0 results. The refine panel's mini bars are unlabelled. |
| studio | 78 | Data headline and story grouping are good, but it is a list, not a workshop. Titles are ellipsised. "#24", "no date" and "Product tradeoff" repeat on every row. The draft editor prints one perspective sentence three times. |
| calendar | 82 | Month grid with no day/date gap, the tray and cadence, an honest "Nothing is scheduled". In the week view, story titles break into 3-line fragments that collide with their scores, and the empty POSTS row wastes about 210 px. |
| campaigns | 84 | An honest empty state that points to 7 anchor stories, each with a real finding and draft counts. The right column is thin, and "How approvals work" is static copy. |
| performance | 78 | Honest, but mostly empty: a pipeline of mostly zeros, a list of metric names and a CSV box. The CSV placeholder's example numbers read like data. |
| career | 74 | Good duplicate-job warning. The headline (AI governance on 3 days) and the one-liner (Agents: 10 mentions) are about different subjects, and the radar shows AI governance with 0 source mentions. Two identical numeric columns, 20 identical "NEW THIS WEEK" tags and an empty Saved job posts box. |
| employers | 79 | Coverage works and is labelled all-time. The h1 runs to 3 lines with four tied names. The People column is all zeros. The team-watchlist cell is cramped (PINNED / Unpin / × on two lines). |
| people | 85 | Overdue, duplicate and do-not-contact states are honest and dense. Every state is a mono-caps tag, so the rows read as tag soup. |
| sources | 82 | Huge improvement on v3 (25): a before/after health bar, evidence kind, 7d/total/stories and expandable rows. Four big zeros in the stat row. The 7D column equals TOTAL. "DEMO · X [DEMO]" is doubled. "was failing" is grey, not error-toned. |
| runs | 85 | Stage timeline, cost controls and an honest history. Columns mix mono-caps and Geist caps heads. Runs that read 0 sources show the same green check as real runs. |
| settings | 81 | Data headline and a source-health summary that links to Sources. The page is 7,232 px long, with a primary blue Save in every section and 11 solid-blue sliders. |

## Fixes (owner · severity)

1. **today · blocker:** "Waiting on you" reports `counts.awaiting` (22 open drafts) as "22 drafts awaiting review". Studio says 1 is in review.
   - Change the label to "1 in review · 21 open drafts", counting in_review drafts separately.
   - List in_review drafts first.
   - Keep "All drafts →".
2. **today · major:** The Map tile's "Hottest regions" shows "6 stories · 6 this week". These are main-topic cluster counts, and they contradict the headline (AI governance in 4) and the chips (8).
   - Render "{topic} — leads {cluster.count}, in {all-topic count}", e.g. "AI governance — leads 3, in 8".
   - Drop "· N this week" when it equals the count.
   - Either label the blue meter "heat" with a visible legend, or remove it: no unexplained mini graphs.
3. **today · major:** Load choreography inverts the hierarchy. The lede has opacity 0 until about 836 ms, while tiles are at 0.9 by 770 ms. The eyebrow, the head actions and the collection banner start at full opacity.
   - Start the lede at h1 line-2 start + 120 ms (about 450 ms after navigation).
   - Start the tile stagger only once the lede reaches 0.5 (about 650 ms).
   - Fade the banner and the head buttons in together with the lede (240 ms opacity).
   - While the ring counts up, keep its "+23 over bar" caption at opacity 0 until the count ends.
4. **today · minor:** The bottom-left secondary tile (Gemini Omni, 62) has about 90 px of dead space under the bullets, and "+7 over bar" wraps onto its own line.
   - Give the tile's footer `margin-top:auto` on a flex column, so the footer pins to the bottom.
   - Put "1 post · 1 outlet · 0 independent" and "+7 over bar" on one baseline row with `justify-content: space-between`.
   - Or let that grid row size to content (`align-items:start`).
5. **today · minor:** The News weather sentence "Agent orchestration, AI governance and Machine learning run hot" uses "run hot", which DECISIONS reserves for when history supports it, and it names the weight-1 catch-all.
   - Rewrite it as: "Agent orchestration and AI governance are in half or more of the 7 stories above your bar; Analytics is in none."
   - Exclude weight ≤ 1 topics from the sentence but keep their rows.
6. **shared · major:** The quality ramp tops out at T+15, so the 72 and 78 rings are identical `rgb(10 63 214)` and the user's "colour gradient for quality" doesn't read.
   - In `quality.js` and the `tokens.css` stops, move `--q-4` to T+12 and `--q-5` to T+25.
   - Draw `.ring` arcs with an SVG `linearGradient` (or a conic mask) running from `--q-3` at the arc start to the score's `qualityColor` at the arc end.
   - Keep the fill fraction as the non-colour cue.
   - This overrides the B §2 stop positions because the user's critique asks for a visible gradient.
7. **shared · major:** `.tag` in `components.css` is Geist Mono uppercase, so every status reads as mono caps: 27 on Today, 34 on Search, 37 on Career, 40 on People.
   - Make `.tag` Geist 12/16, wght 500, sentence case, letter-spacing 0. Keep the border and tone colours.
   - Text changes: IN REVIEW → In review, DEMO → Demo, DO NOT CONTACT → Do not contact, NEW THIS WEEK → New this week.
   - Mono caps stay for eyebrows, table column heads and rail groups only (DECISIONS: Type).
8. **shared · blocker:** `.dossier-scrim` covers the rail, so `#rail-collapse` can't be clicked while the dossier is open (Playwright click times out; only `[` works). This is the user's explicit scenario.
   - Start the scrim at `left: calc(var(--rail-w) + 24px)`, or give `.rail` a z-index above the scrim.
   - Then a rail click collapses it and the panel adapts. That part already works: the panel's left edge tracks 256 → 88.
9. **shared · major (src/finding.js):** Finding and wording leaks.
   - `SIGNAL_MAP` lacks `standard` → "a standard" and `cost` → "cost or pricing", so we get "Mentions standard."
   - Extend the boilerplate regex with `/^(today,? we(?:'|’)?re|today,? we are) (announcing|introducing|launching|excited)/i` and `/^we are expanding our partnership/i`.
   - The disagreement finding prefixes "Independent check: " to claims that already start with "Independent testers…". When the claim starts with "Independent", drop the prefix and keep it only as the label `kind`.
10. **shared · minor:** On phone (≤ 480 px) the status pill truncates after "0 new". Render a phone variant: "Wed 18 Nov · ● 6:28 PM · 7 of 19 above 55" (drop "No." and "0 new" first).
11. **feed-dossier · major:** Feed finding lines clamp to 1 line and cut highlighted numbers ("more than one…", "on 60 workflow…").
    - Use `-webkit-line-clamp: 2` at rest. Rows grow about 20 px.
    - Never clamp inside a `<mark>`: if the clamp would cut a mark, show 3 lines.
12. **feed-dossier · minor:** Feed row source glyphs repeat the post count ("■■■■■■ 6 posts", "○○○○○○○○ 8 posts") and have no legend on the page. The dossier header repeats them ("SOURCES ■■■■■■").
    - Render one glyph per kind present, each followed by its count: "■ 6 · ◆ 0 · ○ 0". Or drop the glyphs.
    - Add a one-line legend to the list header: "■ first-party ◆ independent ○ commentary/community".
13. **feed-dossier · minor:** Engagement reads "610 replys" because `k.replace('_count','s')` builds the word. Map the keys explicitly: `{reply_count:'replies', like_count:'likes', retweet_count:'reposts', quote_count:'quotes'}`.
14. **feed-dossier · major:** The dossier's Employer connections block repeats the same quote and the same "Topical overlap only — mention only if…" caveat five times (about 520 px), and shows "works publicly on AI adoption, AI adoption".
    - Show a full card only for employers the source names directly (`mention_note` "names this company directly").
    - Collapse the rest into one row: "Topical overlap only, not named: Cox Enterprises, Google (other teams), Cox Automotive, IBM, Toyota", with the caveat stated once.
    - De-duplicate the hit list case-insensitively before joining.
15. **feed-dossier · major:** Dossier redundancy and precision.
    - "6 posts · 1 outlet · 0 independent" appears in the fact strip, the section head and the summary sentence. Remove the section-head copy.
    - The first article card's "Key claim" repeats the dek verbatim. Skip any claim already used as the dek (F §3).
    - Cards 03–06 show press-release openers ("Today, we are announcing…"). Apply the boilerplate filter and fall back to the article's best claim, or to the title only.
    - The ring caption "+23 over bar" sits beside the breakdown's "22.8 over your bar". Use one precision: caption "+22.8 over bar", or round both.
16. **map · major:** Region counts disagree with the chips on the same page: the canvas shows "AI governance 3" (main-topic stories) while the chip shows "AI governance 8".
    - Label canvas regions "{topic} · leads {n}", or drop the number.
    - The side panel's "6 stories · 6 updated this week" becomes "Leads 6 · in 10 · 6 this week", with the last part shown only if it differs.
    - Always draw the top-3 region labels (Agent orchestration and Business adoption are currently not drawn). Resolve collisions by moving or hiding smaller labels.
17. **map · minor:** The one-liner truncates the bridge title mid-phrase ("an open-source agent…").
    - Use the short-title rule: text before the first ":" / " — " / "," if at least 20 characters, so "Northwind AI releases Relay".
    - Name the edge types it bridges, e.g. "through shared topics and your watchlist question".
    - Fit the side panel to 900 px tall, so "Select a story to light up…" isn't clipped.
18. **search-system · major:** Search's Drafts group lists the same title 5 times (Northwind Relay in LinkedIn, Video ×2 and Instagram ×2).
    - Group drafts by story: one row with the title plus "18 drafts: LinkedIn roundup (in review), 5 video, 5 Instagram, …".
    - Hide watchlist and employer quick chips whose count is 0 (Bedrock Agents, Vertex AI, watsonx.governance), or move them last and mute them.
    - Label or remove the refine panel's mini bars.
19. **search-system · major:** Sources' stat row shows four large zeros, and the table's 7D column equals TOTAL on every row.
    - Replace the zeros with one state cell: "All 26 paused · 0 collecting".
    - Keep "48 articles · 7 days" and "9 demo".
    - Drop the 7D column while every article is within 7 days, or show "10 (all this week)".
    - Strip the "DEMO · " name prefix when the Demo tag is shown.
    - Render "was failing" in the error tone with `last_error` in a tooltip.
    - Keep demo rows to one line.
20. **search-system · minor:** Settings is 7,232 px long with a primary blue Save in every section.
    - Make section Save buttons secondary until the section is dirty.
    - Collapse Writing, Publishing and System sections behind their index entries, opening on click or scroll-to.
    - Use neutral ink for priority slider fills, keeping blue only at weight ≥ 2.
21. **calendar-studio · major:** The Calendar week view's STORIES row breaks titles into 3-line fragments that collide with their scores ("Northwir" under "72"). The empty POSTS row is about 210 px of white.
    - Render each story as a 2-line block: a score chip on line 1, then the title clamped to 2 lines at full cell width.
    - Collapse empty POSTS and OUTREACH rows to a single 28 px row reading "No posts planned".
22. **calendar-studio · major:** Studio list problems.
    - Group titles are ellipsised. Wrap them to 2 lines.
    - Every row repeats "#24", "no date" and the angle "Product tradeoff". Drop the numeric draft IDs (keep them in title/aria), show a date only when one is planned, and show the angle in the row only when it differs from the group's most common angle.
    - Draft #1's "My perspective" renders "I would want a baseline before trusting the 38% figure." three times. De-duplicate consecutive identical paragraphs on render, and show a "repeated note" flag.
23. **career-publish · blocker:** Career's headline ("AI governance showed up on 3 days this week.") and one-liner ("Agents: 10 mentions…") are about different subjects, and the radar shows AI governance with 0 source mentions.
    - Use one subject. H: "Agents leads your skill radar: 10 mentions this week." L: "In 1 of 1 saved job post (7 identical copies counted once). AI governance came up on 3 days, only in job posts."
    - Drop the "This week" column while it equals "Source mentions".
    - Replace the 20 "New this week" tags with the footnote alone.
    - Fill or remove the empty "Saved job posts · 1 unique" box: list the one post, its demo tag and its 7 copies.
24. **career-publish · minor:** The Employers h1 wraps to 3 lines ("AWS, Google (other teams), Google Cloud and Google DeepMind lead, 2 stories each.").
    - For more than 2 ties, use "4 employers tie for the lead with 2 stories each." and name them in the one-liner.
    - Hide the People column while every value is 0 (the lede already says no people are linked).
25. **career-publish · minor:** The Performance CSV placeholder shows example numbers (`12,1840,1320,46,9,14`) that read as data. Use `draft_id,impressions,reactions` with `<id>,<number>,<number>`.

## Owner summary

- shared: 6, 7, 8 (blocker), 9, 10
- today: 1 (blocker), 2, 3, 4, 5
- feed-dossier: 11, 12, 13, 14, 15
- map: 16, 17
- search-system: 18, 19, 20
- calendar-studio: 21, 22
- career-publish: 23 (blocker), 24, 25
