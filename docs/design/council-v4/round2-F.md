# Council F, round 2: type, information and data honesty (v4 at e010f0f)

Lens: the type scale and hierarchy; whether each headline and one-liner states a finding with numbers; data honesty (posts, outlets, first-party and independent counts, ranked not scanned, the threshold read from settings); wording; accessibility (contrast and focus).

## How I looked

I ran the app live on :4454 in Playwright at deviceScaleFactor 1 and covered:
- all 14 routes, plus `#/story/16`, `#/draft/1` and `#/person/4`, in Proof and Night, at 1440 and 390 wide
- the dossier opened from the Today lead and from a Feed row (story 13), scrolled through
- clicking `#rail-collapse` with the dossier open
- hovering a Today tile and a Feed row
- a Today load captured as 14 frames about 170 ms apart
- a Feed→Today tab switch captured as 10 frames
- clicking a Map node, the Search query "agent", the Calendar week view, and a 40-step keyboard Tab walk on Feed
- on phone: Today, the dossier sheet and the More sheet

I measured every visible text node per route: font, uppercase mono, ellipsis and an approximate AA check against its composited background. I scrolled each long page before taking its full-page capture, because `content-visibility:auto` leaves unscrolled sections blank in un-scrolled full-page shots.

Captures are in `/tmp/claude-0/council-F-r2/`. The key files are:
- `today_light_1440.png`, `load_sheet.png`, `tab_sheet.png`, `tab_ring.png`
- `dos_today_final.png`, `dos_scroll_{1,2}.png`, `dos_collapsed_final.png`, `dos_feed_final.png`, `dos_feed_scroll_1.png`
- `crop_feed_chips.png`, `crop_today_rings.png`, `i_map_click.png`, `i_search_agent.png`, `search_bottom.png`, `i_calendar_week.png`
- `full_<route>.png`, `ph_sheet.png`
- `sweep.json`, `inspect.json`

## What round 1 fixed (verified live)

- **Mono caps are now only where DECISIONS allows them.**
  - The count of visible uppercase-mono nodes fell from 27 to 5 on Today, 34 to 5 on Search, 37 to 9 on Career and 40 to 15 on People.
  - The remaining nodes are eyebrows, column heads, rail group names and a few side-panel heads (`st-side-h`, `cal-tray-h`).
  - Tags are sentence case: "In review", "Demo", "Do not contact", "Possible duplicate".
- **Load order matches the hierarchy:** eyebrow → h1 settles out of blur → lede → banner → tiles → ring count-up. The one-liner is fully readable before any tile (see `load_sheet.png`).
- **"Waiting on you" is honest:** it reads "1 in review of 22 open drafts", which matches Studio, Performance and Calendar.
- **The ring gradient reads.** The 78, 72 and 64 rings are three distinct colours, each with an arc gradient, and there is no tick (`crop_today_rings.png`).
- **Map counts are labelled:** "Agent orchestration · leads 6" on the canvas, "leads 6, in 10" in lists, with a legend line explaining "leads" and "in".
- **The dossier geometry meets the user's rule.**
  - The panel is 1024 px wide at 1440, leaving 160 px of page visible on the right.
  - Its top and bottom align with the rail.
  - A real mouse click on `#rail-collapse` works with the dossier open. The panel's left edge goes 256 → 88 while the rail's right edge goes 244 → 76, so nothing slides under anything.
- **The dossier's employer block** collapses into one "Topical overlap only, not named" chip row plus a single caveat.
- **Feed:**
  - findings clamp at 2 lines
  - the glyph legend is in the list header
  - "610 replies" is spelled correctly
  - below-bar chips are outlined
- **Search:**
  - drafts are grouped by story ("18 drafts · 1 in review · 17 in draft")
  - zero-match chips are muted under "No matches yet"
  - the Refine bars are gone
- **Sources:**
  - one stat cell reads "All 26 paused · 0 collecting"
  - a before/after health bar
  - "was failing" is shown in the error tone
  - Demo tags appear on name rows
- **Career:**
  - one subject from headline through one-liner ("Agents leads your skill radar: 10 mentions this week.")
  - "Jobs only" tags
  - the saved post is listed with "×7 copies"
- **Employers:** the h1 for a 4-way tie now reads "4 employers tie for the lead with 2 stories each."
- **Phone pill:** "6:28 PM · 19 ranked · 7 above 55". The figures that matter survive.
- **Health checks in both themes and at both widths:**
  - No console or page errors.
  - No horizontal overflow.
  - One h1 per view.
  - Night shows 0 AA failures on all 14 routes, apart from the decorative breadcrumb "/". The Proof failures my approximate checker flags are all compositing artefacts (score-chip tints, map labels on canvas); the F-contrast gate passes 28/28.

## What still holds it back

1. **The quality ramp stops at the chips.**
   - Feed, Search, Campaigns, Studio and "Also in the brief" all use `.score-chip`.
   - `[data-q=top]` paints a flat `var(--q-5)`, so 72 and 78 are the identical navy.
   - The clears tier is an 18% tint of `--q`, so 56, 59, 61, 62 and 64 are indistinguishable pale blue (`crop_feed_chips.png`).
   - The user asked for a quality gradient, and the rings now show one; the chips, which carry most of the scores, do not.
2. **Today's secondary rings flash "0" on a revisit.** After Feed→Today, the 72 ring shows "0" with an empty arc for about 200–300 ms, then jumps to 72 (`tab_ring.png`).
   - Cause: `countTo` paints the final value only when it is called, and Today calls it after its `setTimeout(at[i])` stagger even when the key was already counted this session.
   - The result is a story that briefly reads as scoring 0.
3. **The dossier contradicts itself on Google Cloud.**
   - On story 16 (cloud.google.com, "Companies: Google Cloud +3"), Employer connections lists Google Cloud under "Topical overlap only, **not named**".
   - Cause: `src/ai/local.js` computes `nameHit` on the single best-matching passage only.
4. **Boilerplate still reaches the reader as evidence:**
   - Key claim: "Since announcing Google Antigravity… we've heard helpful feedback from our customers."
   - Bullet: "Now, everybody finally gets what they want: …"
   - Feed and Campaigns finding: "Mentions general availability, an API and enterprise."
   - Practical signals: "availability, general availability".
5. **Truncation still cuts claims before their object:**
   - "Nearly 90% of the Fortune 100 are already using…"
   - "…bring complex, multi-…"
   - The dossier's article cards 03–06 clamp the summary to 1 line, against the user's ask for "a short summary of what each source actually said".
6. **Redundancy in the dossier:**
   - On story 13 the "Independent check" callout repeats the dek word for word.
   - The long 4-line title leaves the header's right column empty for about 300 px.
   - "77.8 of 100 · 23 over your bar" mixes two precisions in one line.
7. **Lists of identical rows give the reader nothing to tell them apart:**
   - Studio's story groups list "Video · explainer / Instagram · carousel / Video · explainer / Instagram · carousel", each with "Draft · 1d ago".
   - Performance's "Closest to publishing" shows the same Northwind title 3 times.
8. **Thin or placeholder content on the Publish pages:**
   - Campaigns is a Feed re-skin: 7 story rows with no per-row action, findings without number highlights, and about 700 px of empty right column.
   - Performance's "Last edit per open draft" chart has 1 non-zero bar out of 14. It is labelled, but it says nothing a sentence couldn't.
9. **Accessibility details:**
   - The selected filter chip ("All", `aria-pressed=true`) loses its focus ring. Its inset 1 px box-shadow wins over `:focus-visible`.
   - The focus ring on inputs and selects is a 16%-alpha halo.
   - On phone, the dossier's sticky action bar clips "Open primary" to "Op".

## Rubric

| | Score |
|---|---|
| unique_typography | 8 |
| color_cohesion | 8 |
| theme_cohesion | 8 |
| motion_cohesion | 8 |
| motion_smoothness | 7 |
| generic_typography | 2 |
| background_generic | 2 |
| color_combo_generic | 2 |
| motion_generic | 2 |
| ai_slop | 2 |
| **overall** | **39 / 50** |

**Verdict: one point short of the bar.** motion_smoothness is still 7 for three reasons: E1 and E2 still fail at phone 4× per the integrator's gate run, the ring "0" flash, and the doubled eyebrow during the tab cross-fade.

- **color_cohesion** reaches 8 on the rings, the new ramp and the amber/red state tones. The flat chips (fix 1) are what stop it going higher.
- **ai_slop** is 2: the template tells are gone. What remains is data-level boilerplate, which fix 4 addresses.

## Tab scores (out of 100)

| Tab | Score | Why |
|---|---|---|
| rail | 89 | Groups, sliding highlight and the even collapsed rhythm all hold. The rail sits above the dossier and collapses with one click while it's open. The by-line mark reads at 26 px. Focus rings are clear on every item. |
| today | 89 | The best headline/one-liner pair in the app, the right load order, honest "1 in review of 22", gradient rings, labelled map counts, and a weather chart with a key. It loses points for: the secondary rings flashing "0" on revisit; flat chips in "Also in the brief" (62/61/59 identical); "Suggested next post" duplicating the adjacent "Waiting on you" item; and the eyebrow repeating the pill. |
| dossier | 87 | Width, rail coupling, the sources summary, the first-party callout, plain evidence groups and a reconciling breakdown are all right. It loses points for: "Google Cloud … not named" on Google Cloud's own post; marketing-copy key claims; claims truncated before their object; 1-line source summaries; the independent callout repeating the dek; and an empty header column on long titles. |
| feed | 88 | A clear title-to-meta step, two topics, a glyph legend, honest counts and a threshold divider. The score chips don't show the gradient (72 = 78; 56–64 identical). Template findings still appear ("Mentions general availability…"). The weight-1 "Machine learning" chip sits second. |
| map | 86 | A real map with labelled region counts, a threshold-driven legend, side panel and related timeline, and a one-liner that names the bridge. Node labels ellipsise mid-phrase ("Anthropic files S-1 with the SEC…"). |
| search | 88 | Big bar, chips with counts, muted zero chips, grouped results with highlights, drafts grouped by story, contacts and briefs. The sticky Refine aside slides under the topbar when scrolled. |
| studio | 83 | The data headline and the "Before it can be approved" checklist are good. Rows inside a story are indistinguishable. The right column ends at about 740 px beside a 1,500 px list. The excerpt ends "harness....". In the draft view the History tab is clipped. |
| calendar | 86 | Month grid with no day/date gap, honest open slots and "missed", tray and cadence. In the week view, titles ellipsise to 2 lines in 80 px columns, and the cadence label "This wk" is abbreviated. |
| campaigns | 82 | An honest empty state with a good one-liner, but the body is a copy of Feed with no "start a campaign from this" action, unhighlighted numbers and an empty right half below 815 px. |
| performance | 82 | An honest pipeline and next slots, but a 14-bar chart with one value, and three identical titles in "Closest to publishing". |
| career | 84 | One subject, the duplicate warning and "Jobs only" are honest. The sort key (mentions + 2× job posts) is invisible, so the table looks unsorted (2 after a run of 1s, 0s mid-table). Casing is mixed ("agents" vs "Bedrock"). The one-liner's second sentence is awkward. |
| employers | 82 | The tie headline is good. Each row repeats Pin/Edit/Activity/+Team (about 40 controls). Bars duplicate the number. It never says *which* stories mention each employer. |
| people | 86 | Overdue, duplicate and do-not-contact are dense and honest. The "LAST CONTACT" head clips the card edge. |
| sources | 87 | Rich and honest, from the stat cell and before/after bar to evidence kind and articles/stories. Health reads "Paused" on 26 of 26 rows. The failing rows hide their error until you expand them. "11:52 am" breaks the app's "6:28 PM" style. |
| runs | 87 | Stage timeline, honest amber "Done · 0 sources read", clean history table. The native date input shows "11/19/2026" next to "Wed 18 Nov" elsewhere. |
| settings | 86 | Data headline, a source-health card that links to Sources, collapsed Writing/Publishing/System sections, and neutral sliders. Sentence-case group labels between cards don't match the mono-caps TOC. |

## Fixes (owner · severity)

1. **shared · major: chips don't carry the quality gradient** (`components.css:163-168`).
   - `[data-q=top]` uses a flat `var(--q-5)`, so 72 and 78 are identical. The clears tier's 18% mix makes 56 through 64 identical.
   - Fixes:
     - Top tier: `background: var(--q)`.
     - Clears tier: mix `var(--q)` at `calc(14% + var(--qd,0) * 1.4%)`, where `paintQuality` sets `--qd = clamp(0, score − T, 14)`. Also add a 1.5 px inset ring in `var(--q)`.
   - Acceptance: ΔE ≥ 6 between the chips at 56 and 64, and between 72 and 78, in both themes.
2. **shared · major: the score ring shows "0" on a revisit.**
   - `ui.js scoreRing({count:true,key})` always renders 0. If `motion.js`' counted set already has `${key}:${final}`, render the final number, dashoffset and gradient at build time, and make Today's `countTo` call a no-op.
   - Acceptance: in a Feed→Today 70 ms frame capture, no ring shows a number other than its score.
3. **shared · blocker (dossier): Google Cloud is listed as "not named" on its own post** (`src/ai/local.js` ~171).
   - `nameHit` checks only the best passage. Compute it over all article titles, summaries and claims for the story, plus `story.companies` and the origin domain.
   - When the employer is the origin, render "First-party: this is Google Cloud's own post" instead of the overlap row.
4. **shared · major: boilerplate passes as evidence** (`src/finding.js` claim/finding selection).
   - Add these patterns to the boilerplate filter:
     - `/we(?:'|’)ve heard (?:helpful )?feedback/i`
     - `/^now,? everybody/i`
     - `/finally gets what they want/i`
     - `/^since announcing/i`
   - Bar first-person-plural sentences with no number from being used as "Key claim" or as post-worthy quotes.
   - The template finding "Mentions X, Y and Z." should only be used when no claim exists. Otherwise fall back to the title.
   - De-duplicate signal hits that are substrings of another hit ("availability" ⊂ "general availability").
5. **shared · minor: focus rings.**
   - `.chip--filter[aria-pressed=true]` overrides `:focus-visible` (an inset 1 px ring at 40%). Add `:is(.chip--filter,.seg-opt,.fd-seg-btn)[aria-pressed=true]:focus-visible { box-shadow: var(--focus) }`.
   - `--ctl-ring` (16% alpha) becomes a 2 px `var(--accent)` ring, which is ≥ 3:1 against the surface.
6. **feed-dossier · major: claims are cut before their object.** In the dossier's "Checkable numbers" and "Why it's post-worthy":
   - Show the full claim up to 240 chars.
   - Otherwise clamp at 3 lines, never mid-word or right after a hyphen ("multi-…").
   - The article cards 03–06 summary becomes a 2-line clamp, replacing the 1-line clamp.
7. **feed-dossier · major: the "Independent check" callout duplicates the dek** (story 13).
   - When the callout text equals the dek, replace it with a source-attribution line: "Independent check · The Ledger (ledger-news.example) · its 21% is below Northwind's own 38%". Use the story's numbers or just the outlet and link.
   - Show the independent article card's own claims, rather than its title only.
8. **feed-dossier · major: the dossier header leaves dead space on long titles.**
   - Story 13's title takes 4 lines at display size, leaving the right header column empty for about 300 px.
   - When the title is over 70 characters, set the h1 one step down (about 36/40).
   - When the right column is shorter than the left, move the topic pills under the Sources/Companies block.
9. **feed-dossier · minor: two precisions in one line, and a doubled demo label.**
   - "77.8 of 100 · 23 over your bar" becomes "78 of 100 · 23 over your bar of 55". The decimal stays only in the reconciliation row.
   - Strip the "DEMO · " prefix from source names when the Demo tag is shown, and keep the tag on the meta line instead of wrapping it.
10. **feed-dossier · minor: the phone dossier's sticky action bar clips "Open primary" to "Op".** Make it an icon button with `aria-label="Open primary source"`, or let the bar scroll with a fade edge. Every action must be fully visible at 390.
11. **feed-dossier · minor: Feed topic chip order.** Order the chips by count × priority weight, the same rule as the headline topic. Weight-≤1 topics go after the others, so "Machine learning 9" no longer sits second.
12. **today · minor: "This week" duplicates "Waiting on you"** (both show the same Northwind in-review draft side by side).
    - Change "Suggested next post" to the highest-scoring above-bar story with no draft: "Digital Standards Office… · 64 · no draft yet → Draft a post".
    - Change the eyebrow from repeating the pill to stating age: "Brief No. 1 · from yesterday's run".
13. **today · minor: the weather chart's catch-all row.** Give the weight-≤1 rows (Machine learning) `--text-3` and a "catch-all" note in place of the "Hot" label. Their dots stay, so the chart agrees with the sentence that excludes them.
14. **calendar-studio · blocker (studio): draft rows inside a story are indistinguishable.**
    - Add a second line per row: the draft's hook or first sentence, 70 characters with a word-boundary ellipsis, in `--text-2` 13 px, e.g. "Video · explainer — Testers found 21%, not 38%…".
    - Drop the repeated "1d ago" when every row shares it, and show it once in the group head.
15. **calendar-studio · major: Studio's right column ends at about 740 px** beside a 1,500 px list. Make the aside `position: sticky; top: calc(var(--topbar-h) + 16px)`, or add a "Notes on these stories (6)" card under "Next open posting day".
16. **calendar-studio · minor: ellipsis and tab clipping.**
    - The Studio excerpt ends in "harness....". Strip trailing punctuation before appending "…".
    - The draft view's right tab strip clips "History" at 1440. Let the tabs scroll with a fade edge, or shorten the labels.
    - In the Calendar week view, apply the short-title rule (text before ":" or " — ") and use a 3-line clamp. "This wk" becomes "This week".
17. **career-publish · blocker (campaigns): the page reads as a Feed copy.**
    - Add a per-row secondary "Start campaign" button.
    - Highlight numbers in findings with the same `marked()` treatment as Feed.
    - Make the right column sticky, or add the anchor story's draft list under it.
    - The "These stories by main topic" mini bars must carry their counts, as they already do, or go.
18. **career-publish · blocker (performance): a chart with one value.**
    - Replace "Last edit per open draft · 14 days" with the sentence "All 22 open drafts were last edited Wed 18 Nov" until edits span at least 3 distinct days.
    - Group "Closest to publishing" by story: one row, "Northwind… — LinkedIn roundup (in review), Video explainer, Instagram carousel · next slot Fri 20 Nov".
19. **career-publish · major: the Career radar's sort key is invisible.**
    - Either add a "Weight" column (mentions + 2 × job posts), or sort by the visible Source mentions with job posts as the tiebreak.
    - Put skill names in sentence case ("Agents", "Evaluation").
    - New one-liner: "It appears in 1 of 1 saved job post (7 copies counted once). AI governance was a story topic on 3 days, but only the job post names it as a skill."
20. **career-publish · major: Employers rows have controls but no content.**
    - Under each bar, list the 1–2 story titles that mention the employer, linked to the dossier.
    - Move Edit, Activity and +Team into a row menu revealed on hover or focus, keeping Pin/Unpin.
    - Hide the bar track when the count is 0.
    - On People, the "LAST CONTACT" column head clips the card edge. Give the column `min-width: 112px` and padding-right 24 px.
21. **search-system · minor: Sources says "Paused" on every row.**
    - Show the pre-pause health (Healthy / Stale / Failing) as the primary state, with "paused" as a sub-label.
    - On failing rows, show `last_error` inline (60 characters, with the full text in a tooltip).
    - "11:52 am" becomes "11:52 AM", matching the pill.
22. **search-system · minor: Search's sticky Refine aside slides under the topbar** (the "All results" row is hidden while scrolled). Set `top: calc(var(--topbar-h) + 16px)`.
23. **map · minor: node labels ellipsise mid-phrase.** Apply the short-title rule (text before ":", " — " or ", " if at least 20 characters). Example: "Anthropic files S-1 with the SEC".

## Owner summary

- shared: 1, 2, 3 (blocker), 4, 5
- feed-dossier: 6, 7, 8, 9, 10, 11
- today: 12, 13
- calendar-studio: 14 (blocker), 15, 16
- career-publish: 17 (blocker), 18 (blocker), 19, 20
- search-system: 21, 22
- map: 23
