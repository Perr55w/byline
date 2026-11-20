# Byline v4 council, round 3: merged implementation plan (chair)

Inputs: round3-B/C/D/E/F critic reports (live v4), SPEC-v4 §0 (the user's critique, highest priority), DECISIONS-v4, then majority.

## Gap to bar

| Item | Now | Target | Who scored it low |
|---|---|---|---|
| motion_smoothness | 7.4 | ≥ 8 | B 7.5, C 7.5, D 7.5, E 7.5, F 7 |
| color_combo_generic | 2.2 | ≤ 2 | C 2.5, E 2.5 |
| tab employers | 84 | ≥ 85 | B 84, C 85, D 84, E 84, F 83 |
| tab dossier | 88.6 | ≥ 90 | B 90, C 88, D 90, E 88, F 87 |
| tab today | 89.4 | ≥ 90 | B 89, C 90, D 90, E 89, F 89 |

### Where the points are

- **motion_smoothness.** All five critics hold it at 7–7.5 for the same reasons:
  - **E2 fails in every run.** Desktop open's longest frame is 52–60 ms, and it is render-bound (only 12–13 ms is script). Close p95 at 1× is 33 ms. Rail collapse with the dossier open has p95 40.9–42.9 ms at 4× in the C and F runs.
  - **There is a post-landing frost stall**, proven by A/B (C and E): 5–13 frames of 50–83 ms between 1.0 and 1.8 s, every open.
  - **The flight draws the title across the dek** (C, E).
  - **The theme switch takes a second ink step**, failing C-theme p95 at 33.4 ms (B).
  - **The tab switch** leaves the click unanswered for 80–135 ms (E) and has a ~200 ms empty heading band (C).
  - **E1 is flaky at phone 4×** (C, D, E, F): the swap frame does a full-document layout.
- **color_combo_generic.** The field's resting dashes and the tile-hover pool tint large areas blue, so it reads as graph paper (C, E). Green "First-party" tags clash with the amber callout (B, C, E). The saturated health bar on Sources and Settings is loud (C). Chips at 59, 61 and 62 can't be told apart (F).
- **Employers.** The three Google rows repeat the same two titles. The root cause is server data: the bare seed term "Google" matches inside "Google Cloud" (F). The watchlist column is empty on 7 of 10 rows, titles wrap mid-phrase, the pinned rule has no label, and five "No stories yet" rows waste space.
- **Dossier.**
  - 'You can try it / You can try it.' (C, D, E, F).
  - Green tags.
  - "No independent" appears four times.
  - Release stories show four "No summary extracted" cards.
  - The flight collision and frost stall above.
- **Today.**
  - Seven empty day columns, 110–140 px tall (all five critics).
  - Smudged weather dots (B, E, F).
  - A floating Run button (B, F).
  - A translucent warn strip (E).
  - Mini-map labels that ellipsise mid-word or sit far from their nodes (C, F).
  - A doubled Source mix line (F).

## Conflict rulings

1. **R1. When the frost goes live** (C and E agree on the cause; A/B proven). E's quiet condition wins because it is the stricter one:
   - No animation is running in the panel subtree for 2 consecutive frames.
   - No deferred placeholders are left.
   - Cap: 2000 ms.

   Later in-panel expansions set `.dossier.is-busy`, which turns the frost off while they animate. C's "afterFlight returns the fill promise" is folded in.
2. **R2. The open click frame.** E's diagnosis is the precise one: render-bound, with the prebuild detached until `open()`. **The attached hidden prebuild host is the primary fix.** C's early return in the router, when the dossier is already open on that id, is a cheap guard and is adopted. B's "call `dossier.open` from the click handler and `replaceState` after" is **not adopted**: the route work before `open()` is a string split, and a second open path risks double opens and history drift.
3. **R3. Flight stagger** (C and E). The head-band units the title crosses (dek, actions, facts/ring column) start at `max(160, 0.7 × DUR.morphOpen)`. The chip→ring cross-fade starts at flight offset 0.75. Acceptance uses the stricter sampler: E's two-opacity rule at 0.15, with C's dek opacity > 0.1. If it still fails, push the delay to 0.85 × morphOpen.
4. **R4. The close chrome beat.** B wants `dossier-open` removed only at transitionend; E wants `dz-back` at close start.
   - **E's timing wins.** The user disliked abrupt second beats (SPEC §0, heading entrance), and E measured the chrome returning ~250 ms after the panel.
   - B's cost concern is met by flipping the class in the **first close frame**, the one that already drops the frost, before `run()` starts on the next rAF. The chrome fade stays opacity-only on named children.
   - B's "scrim starts one frame after the clip" is adopted.
5. **R5. Rail collapse with the dossier open.**
   - **Constant width stays** (round-2 R4). D's width step at transitionend is not adopted: it re-wraps the body at the end of the motion, which is a visible pop.
   - The per-frame `left` relayout is replaced by C's and F's approach: step the panel's `--rail-w` once, animate `transform: translateX(delta → 0)` on the same curve, and add `contain: strict`.
   - D's 328 px ghost strip is handled by D's own fallback, built opacity-only: a scrim layer of `--bg` that fades to an effective scrim of about .86 while `html.rail-collapsed` and the dossier is open.
6. **R6. The theme switch.** B's fix is adopted: one ink step mid-fade, with the 0.78T timeout deleted.
7. **R7. The tab switch.** E's and C's fixes both apply, and they are compatible:
   - E: the leave fade starts on hashchange.
   - C: the new h1 settles when the old head reaches ≤ .05.
8. **R8. Swap-frame containment** (E). `#view > .page { contain: layout style }`, and the leaving page goes out of flow in the insert task. Tab owners also cut swap-frame cost on their routes; see their briefs.
9. **R9. Ring '0' flash** (E, with frames as evidence; B and F did not see it). The fix is cheap and harmless, so it is adopted.
10. **R10. Field colour** (C and E merged):
    - Resting dashes are neutral ink (a `--text-3` mix).
    - Blue comes only from heat (hot topics on Today and Map).
    - The hover pool gain drops 40%, tinted toward `--text-3`, with blue kept only within 40 px of the tile edge.
    - Blue coverage stays ≤ 25%.
11. **R11. Score-chip clears band** (F). `calc(16% + qd × 2.4%)`, capped at 50%, with ΔE ≥ 5 between 59 and 64. This tightens round-2 R1 without changing its bands.
12. **R12. Dossier employer tags.** "First-party" becomes `tag--warn`, matching the amber "First-party only" callout (B, and E's alternative). "Named in a source" becomes neutral (B, C, E). No `--ok` colour inside the dossier. C's neutral-with-glyph option is not adopted: the amber matches the existing callout's meaning.
13. **R13. Finding echoes** (D, F). The server returns `finding: null` when the finding repeats the title (token overlap ≥ 0.8). For release-note clusters it builds the finding from the release titles and version span. **Every view must handle `finding: null` by omitting the dek line.**
14. **R14. Google employers** (F, server). Among siblings sharing a parent, the longest match wins. Where an employer's story set still equals an earlier row's, Employers shows "Same N stories as X" (B). E's Google parent row is not adopted: it is more structure than the data needs.
15. **R15. Employers layout.**
    - Watchlist column: removed and folded into the employer cell (B, D, E, F).
    - Pinned left rule: dropped, keeping the filled pin icon (B).
    - Employers with no stories: collapsed into one row (C).
    - Identical full bars: hidden (D).
    - "Activity →" stays a quiet link. F's hover-only is not adopted: touch has no hover, and round-2 R11 applies.
16. **R16. Today This week, nothing planned.** Day cells are 56 px (B and C; D wanted 64, E 40). No empty band over 32 px (R8 from round 2).
17. **R17. Weather dots.** A 1-D beeswarm: centres < 9 px apart get ±4 px vertical offsets (F's threshold, the superset of B and E), and every dot gets a 1 px surface-colour ring (B). Acceptance: no two centres < 7 px (E).
18. **R18. Today's Run button.** It moves into the Collection-off band beside Sources and Run log (B's second option, and F). When the band is absent, it aligns to the h1's last baseline. **Never click it.**
19. **R19. Studio "Headline hook" label.**
    - Show the draft's next section's first line, clipped to 60 characters (B's better option; the lead already does this).
    - Otherwise show "Opens with the story title · N scenes" in text-3 (B and C).
    - D's "No hook yet" would be false, since the hook exists and restates the title.
20. **R20. Skill casing.** Sentence case with acronyms and proper nouns preserved (F: "Agents", "Evaluation", "MCP", "Bedrock"). B's all-lower-case is not adopted, because sentence case makes every row start the same way next to proper nouns.
21. **R21. Calendar open-slot chips.** Round-2 R15 stands (B rated them positively), so E's dot is not adopted. F's legend entry for the story dots is adopted.
22. **R22. Search score chips.** A plain score chip with the tooltip "Story score N" (B, F). C's positive read of "story 59" is overruled, because the label collides with real story IDs (data honesty).
23. **R23. Sticky side columns** where a column ends far above its list: Studio, Campaigns and Search Refine (C, F). D reports Search Refine is already sticky; verify, and change it only if it isn't.
24. **R24. Settings terms.** An auto-height textarea, at most 2 lines at rest and full on focus (D, E). Acceptance: 0 inputs or textareas in `.main` where scrollWidth > clientWidth.
25. **Deferred or not adopted:**
    - C's card-eyebrow restyle: DECISIONS allows eyebrows, it is not in the gap, and it would churn every tab.
    - D's dossier width step (see R5).
    - E's calendar dot (see R21).
    - F's Activity hover-only (see R15).
    - B's direct-open path (see R2).
    - Anything that clicks run, approve, publish or send.

## Order of work

1. **shared** first:
   - Motion blockers S1–S9, which decide motion_smoothness.
   - Colour S10–S11, which decide color_combo_generic.
   - Data S12–S14, which decide employers and dossier.

   Owners can start their CSS and markup in parallel, because the API contracts are listed in each brief.
2. Then, in parallel:
   - **career-publish**: Employers is the only tab under 85.
   - **feed-dossier**: dossier −1.4 and Feed E1.
   - **today**: −0.6.
   - **calendar-studio**, **search-system** and **map**: polish and E1 on their routes.

---

## Brief: shared

SHARED: round 3 brief. Your work closes motion_smoothness (7.4, needs ≥ 8) and color_combo_generic (2.2, needs ≤ 2). It also unblocks Employers (84) and the dossier (88.6) through server data.

Read first: docs/design/council-v4/round3-plan.md (rulings R1–R14), DECISIONS-v4 (motion whitelist, glass budget, at most 2 live backdrop-filter surfaces), and GATES-v4.

Files you own: public/js/{app,ui,motion,bg,dossier,quality}.js, public/css/v4/{tokens,shell,components}.css, src/**, test/**.

Order: S1–S9 (motion, in order), then S10–S11 (colour), then S12–S14 (data), then S15 (harness). Keep the banned list: no cubic-bezier(.16,1,.3,1), no shimmer, sheen or gradient text, and animate only transform, opacity and clip-path.

## A. Motion blockers

### S1. Frost after quiet. BLOCKER. Raised by C and E; ruling R1.

Problem:
- public/js/dossier.js (~line 294) adds `.frosted` by `setTimeout(frost, 220)` after landing.
- afterFlight then inserts and animates sections, and the bars scaleX, under a live backdrop-filter.
- The blur recomposites every frame: 5–7 frames of 50–83 ms (E) and 12–13 frames of 50–67 ms (C) between 1.0 and 1.8 s at 1×.
- With `.dossier-frost` disabled, that window has 0 frames over 34 ms.

Change:
- Replace the timeout with `whenQuiet(root)`. It resolves when **both** of these hold for 2 consecutive rAFs:
  - (a) `panel.getAnimations({subtree:true})` has no animation whose `playState` is `running`;
  - (b) the body holds no `[data-defer]` or `.dx-cv` placeholder. Re-check on a MutationObserver over the body (childList, subtree, attributes).
- Cap it at 2000 ms after landing.
- Until then the opaque .98 flight fill stays.
- **New API for feed-dossier:** export `dossier.busy(promise)`. It adds `.dossier.is-busy`, which sets `.dossier-frost{display:none}` and `.dossier-fill{opacity:1}`, and removes the class when the promise settles. Use it for in-panel expansions ("Show all 6 in full", "+3 more").
- Also export `dossier.isPhone()` if it isn't already reachable, so views can branch.

Acceptance: a desktop open from Feed and from Today at 1× has 0 frames over 34 ms in the 0–2400 ms window after the click. The frost never visibly drops.

### S2. Attached prebuild host. BLOCKER. Raised by E; R2.

Problem: E2's desktop open longest frame is 52–60 ms at 4×, and only 12–13 ms of it is script (onhashchange → `open()`). `prebuild()` calls `root.remove()` (~line 86), so the click frame pays full style, layout and paint for the panel.

Change:
- Keep the **most recent** prebuilt root attached: `.is-prebuild` with visibility:hidden, contain:strict, pointer-events:none, inert, aria-hidden. It sits at finalRect().
- Strip or prefix its ids (for example `data-pre-id`) until open, so there are no duplicate ids.
- Other LRU entries stay detached.
- `open()` then reveals it by removing `.is-prebuild` and restoring ids. Nothing new should be laid out: only visibility, transform and clip change.
- Invalidate on rail toggle, resize or theme via the existing geomKey().
- Also adopt C's guard in app.js `route()`: when the hash is `#/story/:id` and `dossier.isOpen()` is already on that id (or opening it), return before any other work.
- B's direct-open-from-click path is **not** adopted.

Acceptance:
- E2's desktop open longest LoAF is under 50 ms in 3 consecutive runs.
- The phone open is under 50 ms (D measured 57 ms; see S9).

### S3. Flight stagger, so the title never crosses the dek. BLOCKER. Raised by C and E; R3.

Problem: at 160 ms the dek, action row and facts/ring column start fading while the title is still flying. For about 150 ms the flying title is drawn over the half-faded dek: C saw it at 292–450 ms, E at 530–580 ms (frames/zoom-533.png). The ring also fades in while the clip's top inset cuts it.

Change, in `open()` (~line 271):
- When `fly` is true, the units that share the head band with the title (dek, `.dossier-actions`, the facts/ring column) get `delay = max(160, 0.7 × DUR.morphOpen)`.
- Lower units keep `160 + 40·i`.
- The chip→ring cross-fade starts at flight offset 0.75, with delay 0.75 × morphOpen, once the clip top is above the ring.

Acceptance: in a 60 fps sampler there are 0 frames where the flying title rect intersects the dek or actions rect while the dek's effective opacity is over 0.1, and no clipped ring glyph. If this fails, raise the delay to 0.85 × morphOpen.

### S4. Close: one beat. MAJOR. Raised by E and B; R4.

Problem: `html.dz-back` (the crumb and top-right chrome fade-in, plus the field fade-back) only starts in `teardown()` after the close, about 250 ms after the panel is gone. B measured close p95 at 1× as 33.3 ms (limit 20).

Change in `close()`:
- In the **first close frame** (the same synchronous block that removes `.frosted`), swap `dossier-open` for `dz-back`. Its 240 ms opacity fade and the #bg fade-back then run alongside the scrim fade.
- Start the scrim fade one frame after the clip starts (B).
- `teardown()` must no longer re-add `dz-back`; clear it 300 ms after close start.

Acceptance:
- The crumb and `.topbar-right` reach opacity 1 within 60 ms of the panel reaching opacity 0.
- E2 close p95 at 1× is at most 20 ms.
- Close longest frame at 4× is under 50 ms (F: 50; C: 57).

### S5. Rail collapse with the dossier open: transform, not left. BLOCKER. Raised by C, F and D; R5.

Problem: p95 is 42.9 ms (C) and 40.9 ms (F) at 4×, against a limit of 33. `.dossier-panel` and `.dossier-shadow` animate `left` through --rail-w every frame. `.main` already steps once (shell.css line 20): verify that in a trace.

Change:
- While the dossier is open, give `.dossier-panel` and `.dossier-shadow` `transition: none` on --rail-w, the same as `.main`, so `left` steps to its end value in one layout.
- In `railWillChange()`, animate both with WAAPI `transform: translateX(oldLeft − newLeft px) → none` over DUR.layout and EASE.move, matching the rail's curve.
- Add `contain: strict` to `.dossier-panel` (its size is fully set by top, bottom and width).
- The width stays constant: round-2 R4 stands, and D's width step is rejected.
- D's 328 px ghost strip: add `.dossier-scrim::after` with `background: var(--bg)`, `opacity: 0`, and an opacity transition over --dur-layout. Under `html.rail-collapsed` with an open dossier, its opacity reaches the value that gives an effective scrim of about .86.

Acceptance:
- Rail-collapse p95 is at most 33 ms at 4× in 3 consecutive runs.
- The `dossier.left ≥ rail.right` assertion holds on every sampled frame (bounding rects include the transform).
- No half-cut page text reads in the strip at 1440.

### S6. Theme: one ink step. BLOCKER. Raised by B; R6.

Problem: in app.js `applyTheme()` (line 78), `ink-strong-${next}` is removed at 0.78T while the surfaces are still fading. Links and status colours vanish for about 200 ms and pop back. B measured C-theme on the Proof direction at frame p95 33.4 ms, against 33.

Change:
- Delete the 0.78T timeout (line 78).
- Remove `ink-strong-${next}` in the T+60 timeout that removes `theme-xfade` and `theme-mid`.

Acceptance:
- C-theme passes 12/12.
- Every contrast frame is at least 3:1.
- There is no second ink step while the surface is moving.

### S7. Tab switch timing. MAJOR. Raised by E and C; R7.

Problems:
- After a click the old page holds full opacity for 80–135 ms (E).
- The new h1 is below 0.05 opacity until 380 ms, leaving a ~200 ms empty heading band (C).

Change, in app.js:
- Start the 220 ms leave fade (opacity only) on hashchange. The offscreen render continues.
- Start the new h1 settle when the old page-head reaches ≤ 0.05, at about 230 ms. Keep the rest of the cascade.

Acceptance:
- The first visible #view change comes at most 34 ms after the hash changes.
- Two h1s are never both above 0.08.
- After 300 ms, no frame has both below 0.15.
- No scroll jump (round-2 fix holds).

### S8. Swap-frame containment for E1. MAJOR. Raised by E (C, D and F also saw E1 flake).

Problem: the swap frame still does a FULL layout. E's 3-lap phone 4× run had 6 of 48 transitions over 50 ms (campaigns 73, person/4 72, today 57, map 52, draft/1 51) with no script attribution. C saw feed at 79 ms.

Change:
- Add `#view > .page { contain: layout style; }`.
- In the same task as the insert, take the leaving page out of flow (`position:absolute; inset:0 0 auto 0`).
- Keep the R2 `is-building` frame split.
- Tab owners are separately reducing swap-frame nodes (first-screen render plus `.cv-row` / content-visibility).

Acceptance:
- The swap-frame Layout trace shows partialLayout:true and is under 15 ms at phone 4×.
- `node test/e2e/run.mjs --only E1` with 3 laps has 0 of 48 transitions over 50 ms.

### S9. Rings and phone dossier. MAJOR. Raised by E and D.

Rings:
- Score rings show a literal "0" for 130–250 ms on load (E, sheet-load-today).
- In ui.js `scoreRing()`, a ring whose count is pending renders an empty, fixed-width tabular number box, with the final value in aria-label. countTo writes the first value on its first frame.

Phone dossier:
- On phone, afterFlight runs below-fold sections through `requestIdleCallback` (timeout 300 ms) after the sheet lands, on both the prebuild and the late paths.
- Pass `{phone:true}` to the view's afterFlight so story-dossier.js can skip entrance animations (see the feed-dossier brief).

Acceptance:
- No captured frame shows a ring number off its count path.
- The phone open's longest frame is under 50 ms.

## B. Colour (color_combo_generic 2.2 → ≤ 2)

### S10. Field and hover pool in neutral ink. MAJOR. Raised by C and E; R10.

Problem: the resting dashes and the tile-hover pool turn dash rows clearly blue across about 300 px on Proof (today-hover.png). It reads as graph paper and keeps the blue+white pairing generic.

Change in bg.js (shader uniforms and the 2D fallback):
- Draw the resting dashes in neutral ink, a --text-3 mix.
- Blue comes only from the heat texture (hot topics on Today and Map).
- Cut the hover pool's dash gain by 40% and tint it toward --text-3, keeping accent only within 40 px of the hovered tile's edge.
- `#bg-light` keeps its reaction.

Acceptance:
- Under the pool, the dash colour's ΔE from the resting field is at most half of today's value.
- Blue covers at most 25% of the viewport on Today, Proof and Night.
- The bg idle and ambient gates stay green.

### S11. Chip ramp in the clears band. MINOR. Raised by F; R11.

Problem: chips at 59, 61 and 62 look identical (oklab L .924, .910, .901) on Today "Also in the brief", Feed, Search and Campaigns.

Change: components.css ~line 171, `.score-chip[data-band=clears]` mixes `var(--q)` at `min(50%, calc(16% + var(--qd) * 2.4%))`.

Acceptance:
- ΔE is at least 5 between 59 and 64 in both themes.
- Chip text contrast is at least 4.5:1 across the band.

## C. Data honesty (unblocks Employers and the dossier)

### S12. Google employer matcher. BLOCKER for Employers. Raised by F; R14.

Problem: `Google (other teams)` has the bare term "Google" (src/seed.js:10), which matches inside "Google Cloud". As a result:
- /api/employers gives it the same 2 stories as Google Cloud;
- the Employers h1 claims "4 employers tie for the lead";
- story 16's dossier lists it as "Named in a source" with a quote that names only Google Cloud.

Change: in the employer matcher used by /api/employers and the dossier's employer connections (src/dossier.js and src/store.js), the longest match wins among siblings that share a `parent`. A "Google" hit inside a "Google Cloud" or "Google DeepMind" match span doesn't count for Google (other teams). Recompute story_count. Do not edit data/byline.db rows: fix the matching code only.

Acceptance:
- Google (other teams) has 0 stories unless "Google" appears on its own.
- The Employers h1 is no longer a 4-way tie.
- Story 16's dossier no longer lists Google (other teams).
- Add a unit test.

### S13. Finding echoes and template deks. MAJOR. Raised by D and F; R13.

Problem: release stories use their title as the finding ("anthropic-sdk-python v2.10.0."), and the signals fallback makes template deks ("Mentions an API and cost or pricing."). These reach Feed, Search, Campaigns, Today and the dossier dek.

Change, in src/finding.js (~line 302):
- For release-note clusters, build the finding from the article titles, for example "4 releases, v2.2.0 → v2.7.0, 23 Oct – 9 Nov".
- Use the "signals" fallback only when it contains a number.
- If the normalised token overlap between the finding and the title is at least 0.8, return `finding: null`.
- **Contract for every view owner:** `finding` may be null, and the view then omits the dek line.

Acceptance: unit tests for the release, echo and template cases. No Feed row shows a dek equal to its title.

### S14. "Why it ranked" wording. MAJOR. Raised by F.

Problem: src/facts.js:79 prints "Worth a post: you can test it." on story 13, which scores 17, 38 below the bar.

Change:
- Use "Post-worthy signals: …" whatever the score.
- Change "(interest maxed, 35 of 35)" to "(full marks for interest, 35 of 35)".
- Update the tests.

## D. Harness

### S15. Gates for this round's defects. MINOR. Raised by E.

Add to test/e2e/gates:
1. E2: the desktop open at 1× has 0 frames over 34 ms in 0–2400 ms.
2. E2 open repeated 3 times, keeping the maximum.
3. An E1 `--laps 3` mode.
4. C-flight: the title rect never intersects the dek or actions rect while both opacities are over 0.15.
5. C-rings: no ring text "0" on a non-zero score during load.

## Final checks

- All 25+ gates pass, E1 and E2 3× in a row.
- npm test is green.
- Screenshots of the dossier open at 533 ms, close, rail collapse at 1440, Today hover on Proof, and the Employers h1.
- Kill any server you start, by its port.

## Brief: career-publish

CAREER-PUBLISH: round 3 brief. Employers is the **only tab under 85** (84: B 84, C 85, D 84, E 84, F 83), so it comes first.

Then Performance and Campaigns (85, the slot repetition all critics flagged), Career and People (polish), and E1 on campaigns and person/N.

Files you own: public/js/views/{campaigns,performance,career,employers,people}.js and public/css/v4/{campaigns,performance,career,employers,people}.css.

Read: round3-plan.md rulings R13, R14, R15 and R20, plus DECISIONS (data honesty, blue budget).

Contracts from shared:
- S12: /api/employers story counts are fixed server-side, so "Google (other teams)" no longer inherits Google Cloud's stories.
- S13: `story.finding` may be `null`. When it is, omit the dek line.
- Don't restyle `.score-chip` (shared owns the ramp).

## 1. Employers (target ≥ 87)

### E-1. Repeated story blocks. BLOCKER. Raised by B, E and F.

Problem: the Google (other teams), Google Cloud and Google DeepMind rows repeat the same two titles. The titles are set in small Newsreader and wrap mid-phrase ("Introducing / Gemini agent").

Change:
- Once S12 lands, some rows may still share an identical story set (Cloud and DeepMind both match "Gemini"). When a row's story-id set equals an earlier row's, render `Same 2 stories as Google Cloud` in --text-2 instead of the titles.
- Story titles use the UI sans (Geist) 13/18, clamped to one line with an ellipsis, with the full title in `title`.
- Use the short title: the text before ':' or ' — ', cut at a word boundary, at most 48 characters.

### E-2. Remove the Team watchlists column. BLOCKER. Raised by B, D, E and F; R15.

Problem: the column is empty on 7 of 10 rows, a dead lane of about 300 px.

Change:
- Delete the column.
- Render watchlists as a subline in the Employer cell: `Following: Bedrock Agents` in text-2 12px, with the existing Follow toggle in the ··· menu.
- Set column widths to Employer 34%, Stories 52% and Activity 14%, so titles fit on one line at 1440.

### E-3. Pinned rule. MAJOR. Raised by B and E.

Drop the unlabelled 3 px dark left rule on pinned rows. The filled pin icon stays visible as the toggle (round-2 R11). No new legend is needed.

### E-4. No-stories rows. MAJOR. Raised by C.

Problem: five "No stories yet" employers each take a row of about 95 px.

Change: collapse them into one row below the covered employers, for example `No stories yet · Cox Automotive, IBM, Toyota ⟨pin glyph⟩ · Ally, Snowflake`. Each name links to its Activity, and the pin glyph sits inline for pinned ones. Keep full rows for employers with coverage.

### E-5. Bars. MINOR. Raised by D.

When every visible bar equals the column max, hide the bars and keep the count. Bars stay neutral, never blue.

### E-6. Headline. MINOR.

After S12 the h1 must be recomputed from live counts using F's template. Don't hard-code "4 employers tie".

### Employers acceptance

- At 1440 there are no repeated title blocks, no mid-title wraps and no column empty on more than 30% of rows.
- No band inside the table is over 32 px.
- At 390 the rows stack cleanly.
- Capture a 1440 screenshot and compare it with round 3.

## 2. Performance (85 → 87)

### P-1. Next open slots. MAJOR. Raised by B, C, D, E and F.

Problems:
- The card repeats "Fri 20 Nov" (or "Mon 23 Nov") for LinkedIn, Instagram and Video.
- Every Closest-to-publishing row repeats "Next open LinkedIn slot …" (performance.js:224).

Change:
- When all channels share a date, render one line: `Fri 20 Nov: open on LinkedIn, Instagram and Video`. Studio already does this (studio.js:318).
- Remove the per-row slot text when it is identical across rows. Show it once in the card header meta.
- Always use the real date from data.

### P-2. Dead band. MAJOR.

Problem: an 80 px gap sits above "Import results from a CSV" (`margin-top:auto`), which breaks the "no band over 32 px" rule.

Change: use `align-self:start` on the card and a fixed 24 px gap before the CSV row. The two bottom cards may then differ in height.

### P-3. Published cell. MINOR. Raised by B.

The zero "Published" pipeline cell has a grey fill that nothing explains. Drop the fill so it matches the other zero cells.

### P-4. Draft listed as a story. MAJOR. Raised by F.

Problem: "Weekly roundup · 2026-W47" is listed as a story, but it is draft 13 with story_id 16.

Change: group by `story_id`, and title each group with the story's short title. The draft chip reads `LinkedIn · roundup: Weekly roundup · 2026-W47`. Drafts with no story_id go in an "Unlinked drafts" group.

## 3. Campaigns (85 → 87)

### C-1. Slot line. MAJOR. Raised by B, D, E and F.

"Next open posting slots" (campaigns.js:147) collapses to one line when the dates match: `Mon 23 Nov · LinkedIn, Instagram, Video`.

### C-2. Right column. MAJOR. Raised by C and F; R23.

Problem: the column ends about 540 px above the list, and its "These stories by main topic" card repeats the left list's grouping.

Change:
- Make the column `position: sticky; top: calc(var(--topbar-h) + 16px)`.
- Replace the by-topic card with its one finding, computed from data ("95% of the drafts for these stories sit under Agent orchestration"), plus the slot line.

### C-3. Echo dek. Raised by D and F.

The release story's dek repeats its title. Handle `finding: null` from S13 by omitting the dek.

### C-4. E1 on campaigns. MAJOR. Raised by E.

Problem: 73 ms at phone 4×.

Change:
- Render the first screen (head plus the first 6 anchor rows) in the swap frame, and the rest in one idle chunk (`requestIdleCallback`, timeout 300 ms).
- Add `content-visibility:auto` with a `contain-intrinsic-size` that matches the row height, measured at both 1440 and 390.

## 4. Career (85–86 → 87)

### K-1. Skill merging and casing. MINOR. Raised by B, C, E and F; R20.

- Fold "agentic" into "agents" with an "also agentic" note, the same way "evals" shows its alias.
- Merge case-only variants silently: drop "also Evals".
- Display skills in sentence case with acronyms and proper nouns preserved: Agents, Evaluation, MCP, SQL, PRD, Bedrock.

### K-2. "Jobs only" chip. MINOR. Raised by C, D and F.

Remove the "Jobs only" chip from the "Story topics this week" card. Where needed, use the muted text `also a job-post skill` in text-3. Keep the chip on the radar row.

### K-3. Headline and one-liner. MINOR. Raised by F.

The one-liner must not repeat the h1's clause. Use F's example as the pattern, filled with live numbers: h1 "Agents tops your skill radar: N mentions this week." and a one-liner about the saved job posts and AI governance.

### K-4. Title placeholder. MINOR. Raised by E.

In "Add a job description", the Title input's placeholder reads "Job title" in --text-3, so it doesn't look pre-filled.

## 5. People (86–87)

### PE-1. One red per row. MINOR. Raised by B.

Keep the red `Overdue · 18 Nov` pill. Set the next-step date in --text-2.

### PE-2. Duplicate tag. MINOR. Raised by D.

The "Duplicate contact" tag gets margin-left 0, aligned with the name's left edge.

### PE-3. Date style. MINOR. Raised by F.

Every date on People and person/N uses Geist sans tabular, not mono. The Next date control shows a formatted value ("Wed 25 Nov") on a button that opens the native picker. Keep the native input for editing.

### PE-4. E1 on person/N. MAJOR. Raised by E.

Problem: 72 ms at phone 4×.

Change: render the head and the first card in the swap frame and the rest in an idle chunk. Add content-visibility on the outreach and history lists.

## Final checks

- `node test/e2e/run.mjs --route employers`, then `--route campaigns`, `--route performance` and `--route person/4`, and `--only E1`.
- E1 at phone 4× is under 50 ms on campaigns and person/4 across 3 laps.
- npm test is green.
- Screenshots at 1440 and 390 for Employers, Performance and Campaigns.
- Never click run, approve, publish or send.
- Kill any server you start.

## Brief: feed-dossier

FEED-DOSSIER: round 3 brief. Bring the dossier from 88.6 to ≥ 90 (C 88, E 88 and F 87 are below). Make Feed's E1 at phone 4× stable (79 ms in C's run). Remove the dossier's green tags, which feed color_combo_generic.

Files you own: public/js/views/feed.js, public/js/views/story-dossier.js, public/css/v4/feed.css, public/css/v4/dossier.css.

Read: round3-plan.md rulings R1, R3, R12 and R13, plus DECISIONS (F §3 dossier IA, motion whitelist).

Contracts from shared:
- S1: `dossier.busy(promise)` keeps the frost off while an in-panel expansion animates.
- S9: afterFlight receives `{phone:true}` on phone and runs in requestIdleCallback.
- S13: `finding` may be null; omit the dek.
- S14: why_ranked text now reads "Post-worthy signals: …".

## 1. Dossier

### D-1. Duplicate post-worthy copy. BLOCKER. Raised by C, D, E and F.

Problem: "Why it's post-worthy" prints "You can try it" as the label and "You can try it." as the body. The row has `quote: null`, and its text equals the label.

Change: in `pwRows` (story-dossier.js ~line 458), when `r.quote` is null, render `<b>label</b>` followed by ` · matched ` and the matched terms as `.dx-term` tokens, for example "You can try it · matched available". When there are no terms either, render the label alone with a check glyph. Never render `r.text` when it normalises (case and punctuation ignored) to the label.

Acceptance: no evidence group repeats its label as its body, on story 16 or story 13.

### D-2. Employer tag colours. MAJOR. Raised by B, C and E; R12.

Problem: story-dossier.js:554 renders both "First-party" and "Named in a source" as `tag tag--ok` (green). The same panel shows an amber "First-party only" callout, and green elsewhere means healthy or sent.

Change: "First-party" becomes `tag tag--warn`, and "Named in a source" becomes the neutral `tag`.

Acceptance: no --ok colour anywhere inside the dossier.

### D-3. Employer wording. MAJOR. Raised by C and D.

- Drop "Works publicly on X." when X matches the employer's own name or parent (ignore case). Today it prints "Works publicly on Google." under Google (other teams).
- Drop the "Same passage as … above" line (~line 575) for employers in the "Topical overlap only, not named" group. It contradicts "not named".

### D-4. "No independent" four times. MAJOR. Raised by F.

Drop the header subline "with no independent report yet" whenever the first-party / no-independent callout renders. The fact then appears twice: the "0 independent" count and the callout.

### D-5. Release-note source cards. MAJOR. Raised by F.

Problem: story 13 shows 4 cards each saying "No summary extracted for this post."

Change: collapse consecutive no-summary posts from one outlet into one row, for example `4 release notes from github.com (23 Oct – 9 Nov): v2.2.0, v2.5.0, v2.6.0, v2.7.0 · no summaries extracted`. Each version links to its post. Dates and versions come from the article data.

### D-6. Progressive sections: no off-screen entrance. BLOCKER for motion. Raised by C.

Problem: Lens, Employer connections, Make and Tune are inserted after the flight and run opacity and translate entrances even below the visible scroller. That adds layers and repaint during the stall window.

Change, in `fillProgressive` (~line 653):
- Use an IntersectionObserver rooted on `.dossier-scroll`, with no layout reads.
- A section whose entry is not intersecting gets no entrance animation.
- An on-screen section gets opacity only, 240 ms, --ease-fade, with no translate.
- On phone (`{phone:true}`), skip entrance animations entirely.
- Wrap in-panel expansion animations ("Show all 6 in full", "+3 more") in `dossier.busy(anim.finished)`.

Acceptance: together with shared S1, a desktop open from Feed or Today at 1× has 0 frames over 34 ms in 0–2400 ms, and the phone open is under 50 ms.

### D-7. "Why it ranked" markers. MINOR. Raised by B.

Problem: the dossier's `.dx-why-list` uses numbered circles, while Today uses dashes.

Change: use Today's dash markers in dossier.css, so the list reads as one component. The user named Today's "why it ranked" bullets as the reference (SPEC §0).

### D-8. Phone eyebrow and jargon. MINOR. Raised by D and F.

- Below 600 px, render the eyebrow on two lines: the topic, then `18 Nov · updated 2d ago`.
- Put separators in `::before` on items after the first, inside a flex-wrap with column-gap, so no line starts with a "·".
- Change "track length = weight" (and the aria-label "track length proportional to weight", ~line 508) to "bar width = share of 100".

## 2. Feed (89 → 90)

### F-1. E1 at phone 4×. MAJOR. Raised by C.

Problem: the longest frame is 79 ms with only 15 ms blocking, so the cost is style, layout and paint of the full row list in the swap frame.

Change:
- Make sure `.cv-row` (content-visibility:auto) applies at ≤ 480 px.
- Give it a `contain-intrinsic-size` measured at 390 (about 180 px, not the desktop 78).
- On phone, render only the first 6 rows in the swap frame and the rest in one idle chunk.

Acceptance: `--route feed --only E1` at phone 4× is under 50 ms across 3 laps.

### F-2. Hover forced layouts. MINOR. Raised by E.

Problem: 17 layouts and 152 recalcs per 120 pointer moves on #/feed, against 0 on Today. The likely cause is the row-actions reveal tripping the clamp ResizeObserver, or a measuring prefetch path.

Change: find the read. Hover may only toggle classes, and the action reveal must affect opacity only and not change row size.

Acceptance: at most 2 layouts per 120 moves, with frame p95 at 16.8 ms.

### F-3. Filter change. MINOR. Raised by E.

Problem: every filter chip click re-runs the full h1 entrance, so the h1 is blank for about 100 ms.

Change: on a filter change, keep the h1 and swap only the changed figures, with an opacity dip to no lower than 0.5 over 160 ms. Use `enterHeading` only on route entry.

### F-4. Phone overflow. MAJOR. Raised by D.

- Add `overflow-wrap:anywhere` to `.fd-title`. "modelcontextprotocol/modelcontextprotocol" currently overflows its 356 px tile.
- At ≤ 760 px, give `.fd-topicbar` `mask-image: linear-gradient(90deg,#000 calc(100% − 24px),transparent)` and `scroll-snap-type:x proximity`, matching Search's chip rows.

### F-5. Topic chip wrap. MINOR. Raised by D.

Fold catch-all and single-story topics (weight ≤ 1, or count 1) into a trailing `+N` chip, so the topic row stays on one line at 1440.

### F-6. Echo deks. Raised by D and F.

Handle `finding: null` by omitting the dek. Release rows then no longer repeat their title.

## Final checks

- `node test/e2e/run.mjs --route feed` and `--only E2` (3 runs).
- Screenshots of the dossier for story 16 and story 13 at 1440 and 390, including the Employer connections and post-worthy sections.
- No green tag in the dossier.
- npm test is green.
- Kill any server you start.

## Brief: today

TODAY: round 3 brief. Bring Today from 89.4 to ≥ 90 (B, E and F scored 89; C and D gave 90 but called it fragile).

Files you own: public/js/views/today.js and public/css/v4/today.css.

Read: round3-plan.md rulings R16, R17 and R18, and round-2 R8 (no empty band over 32 px inside a tile; fixed 24 px gaps; use real content or align-self:start, never spread gaps).

Contracts from shared:
- S9: score rings no longer flash "0".
- S10: the field and hover pool are now neutral ink.
- S13: `finding` may be null; omit the dek.

## T-1. This week: empty day columns. BLOCKER. Raised by B, C, D and E (all five noted it).

Problem: with 0 posts planned, `.td-week` shows seven empty day columns 110–140 px tall, each with a lone ring.

Change:
- When nothing is planned, day cells are 56 px tall: weekday, date and the posting-day marker. The line "Nothing planned yet. N drafts are in the tray." (from data) sits directly under the strip.
- "Suggested next post" sets the tile height.
- When drafts are planned, cells grow to fit them.
- Row 3 still ends on one line with "Waiting on you" (D's round-3 praise). Use real content for any difference, or align-self:start.

Acceptance: at 1440 there is no empty band over 32 px inside the This week tile, and the row-3 tile bottoms align.

## T-2. News weather dots. MAJOR. Raised by B, E and F.

Problem: overlapping dots merge into smudges. Two hollow dots near 51 on Agent orchestration read as one crossed circle; there are also clusters at 57–62 and on Machine learning at 47–49.

Change:
- Apply a 1-D beeswarm per row. Walk the dots sorted by x; when a dot's centre is under 9 px from the previous kept centre, alternate a +4 or −4 px vertical offset. x stays exact.
- Every dot, hollow ones included, gets a 1 px ring in the surface colour.

Acceptance: no two dot centres closer than 7 px, and all 19 dots individually visible at 1440 and 390.

## T-3. Run button placement. MINOR. Raised by B and F; R18.

Problem: "Run today's workflow" and ··· float about 120 px below the h1 top, with about 300 px of blank space beside them.

Change: move the action group into the "Collection is off" band, next to its Sources and Run log links. When that band isn't shown, align the group to the h1's last baseline (align-self:end, bottom margin equal to the lede gap). Don't change what the button does, and never click it.

Acceptance: no free-floating control in the head band.

## T-4. Opaque warn strip. MAJOR. Raised by E.

Problem: `.td-strip[data-tone=warn]` (today.css:29) mixes --warn-soft (alpha .13) at 55%, giving an effective alpha of about .5. The field's dash rows run through its text.

Change:
- Set `background: color-mix(in oklab, var(--warn) 8%, var(--surface-solid))`.
- Do the same for `[data-tone=err]` with --err.
- Confirm --surface-solid is opaque in Proof and Night.

Acceptance: dash contrast under the strip text is below 1.05:1 in both themes.

## T-5. Mini news map labels. MAJOR. Raised by C and F.

Problems:
- Labels ellipsise mid-word ("Gemini at Work 2026: Introduci…").
- One label sits about 150 px from its node.
- The wording "leads 6, in 10" differs from the Map tab's "6 of 19 stories · tagged on 10".

Change:
- Labels use the short title: the text before ':' or ' — ', cut at a word boundary, at most 28 characters ("Gemini at Work 2026", "Digital Standards Office").
- Anchor every top-3 label within 24 px of its node, flipping sides rather than moving away.
- Region rows read "main topic of 6 · tagged on 10", and the legend matches.

## T-6. Source mix line. MAJOR. Raised by F.

Problem: the lead tile's Source mix says the same thing twice in two styles ("6 posts · 1 outlet · 0 independent  6 first-party · 0 primary research · 0 commentary").

Change: one Geist 13 px tabular line that omits zero categories: "6 posts · 1 outlet · all first-party". The "Named" company chips use Geist 12 px, not mono.

## T-7. Echo deks.

Handle `finding: null` (shared S13) in the lead and "Also in the brief" tiles by omitting the dek.

## T-8. E1 on today. MAJOR. Raised by E (57 ms) and F (51 ms).

Change: render the head band and row 1 in the swap frame. Render the News weather plot, mini map and row 3 in one idle chunk (requestIdleCallback, timeout 300 ms), with reserved heights so nothing shifts. Keep C §2's choreography order.

Acceptance: `--route today --only E1` at phone 4× is under 50 ms across 3 laps.

## Final checks

- Screenshots of Today at 1440 and 390 in Proof and Night: This week, the weather plot zoomed, the head band and the warn strip.
- The Today gates pass.
- npm test is green.
- Kill any server you start.

## Brief: calendar-studio

CALENDAR-STUDIO: round 3 brief. Studio sits at 86 and Calendar at 86–88. Both are above target. This round is about alignment, wording and E1 on draft/N.

Files you own: public/js/views/{calendar,studio}.js and public/css/v4/{calendar,studio}.css.

Read: round3-plan.md rulings R19, R21 and R23.

## Studio

### ST-1. Row grid. MAJOR. Raised by B, C, D, E and F.

Problem: on rows with no edit time (the "Hot take · LinkedIn · short" group), the Draft status tag sits 77–80 px right of the others (x=835 against 758).

Change: `.st-row` / `.st-list` rows use one fixed grid: `20px 180px 1fr 88px 64px 16px` (icon / format / hook / status / date / arrow). Always render the date cell, using an em dash in text-3 when there is no time.

Acceptance: status tags share one x down the whole list at 1440.

### ST-2. "Headline hook" label. MINOR. Raised by B, C, D and F; R19.

Problem: studio.js:198 and calendar.js:62 print "Headline hook · 5 scenes" when the hook restates the story title.

Change:
- Show the draft's next section's first line (`hi.next`), clipped at a word to 60 characters.
- If there is none, show "Opens with the story title · 5 scenes" in text-3.

### ST-3. Repeated timestamps and chips. MINOR. Raised by E and F.

- Show "edited 1d ago" once in each group head, Hot take included, and remove it from the rows. This replaces ST-1's per-row date only where every row in the group has the same value; otherwise keep the per-row cell.
- The hero chip reads "Story score 72", not "72 Story".
- Label the lead dek "Hook · …" when it shows the raw hook field.

### ST-4. Sticky side column. MAJOR. Raised by C; R23.

The right column (above-bar stories, By channel) gets `position: sticky; top: 84px` (or `calc(var(--topbar-h) + 16px)`), so it doesn't end about 450 px above the list.

### ST-5. The draft view's date control. MINOR. Raised by F.

Show a formatted value ("No date" or "Mon 23 Nov") on a button that opens the native picker, never "mm/dd/yyyy". This only formats the display: never call approve, schedule or publish.

### ST-6. E1 on draft/1. MAJOR. Raised by E (51 ms at phone 4×).

Render the editor head and first section in the swap frame and the rest in an idle chunk. Add content-visibility on long section lists.

## Calendar

### CA-1. Phone tray icons. MINOR. Raised by B and C.

At 390 the ↗ and calendar icons stack under the status tag. Put both on one right-aligned line after the tag (`display:flex; gap:8px`) with 32 px targets.

### CA-2. Story dots legend. MAJOR. Raised by F.

Problem: month cells show "N stories" with filled and hollow dots that the legend doesn't explain.

Change:
- Add a legend entry `● story above 55 · ○ below`. Take the threshold from settings and never hard-code it.
- Give each cell a title built from data, for example "5 stories first seen, 3 above your bar".
- Past posting days with no post already get "missed" (calendar.js:257). Make sure it also shows in the cell, as a muted label.
- The open-slot chips stay as they are (R21).

### CA-3. Tray hook line. MINOR. Raised by F.

Render the hook line on every tray row ("LinkedIn · article ×5" lacks it), using ST-2's rule.

### CA-4. Outreach chip wrap. MINOR. Raised by D.

Calendar outreach chips get `white-space:nowrap; overflow:hidden; text-overflow:ellipsis`, so "Test Alumna ×2" doesn't wrap its "×2".

## Final checks

- Screenshots of Studio at 1440 (the full list, showing aligned tags), Calendar at 390 (tray) and Calendar at 1440 (legend).
- `--route studio`, `--route calendar` and `--route draft/1 --only E1` pass.
- Never click approve, schedule or publish.
- Kill any server you start.

## Brief: search-system

SEARCH-SYSTEM: round 3 brief. Settings (84 from D, 86 from the others) must not dip below 85. Search and Sources carry a colour fix that helps color_combo_generic (2.2, needs ≤ 2).

Files you own: public/js/views/{search,sources,settings,runs}.js and public/css/v4/{search,sources,settings,runs}.css.

Read: round3-plan.md rulings R22, R23 and R24.

## Settings

### SE-1. Terms inputs truncate. BLOCKER. Raised by B, C, D, E and F (all five).

Problem: all 11 priority Terms inputs truncate mid-word ("multi-agen…", "risk, s").

Change:
- Replace each Terms input with an auto-height textarea, at most 2 lines at rest and the full value on focus. Size it by rows and line-height, without measuring in a loop.
- Shrink the topic input to 200 px and the weight column to 150 px.
- Saving behaviour is unchanged: the same field name and comma-separated value.

Acceptance: 0 inputs or textareas in `.main` where scrollWidth > clientWidth, and 0 truncated terms at 1440.

### SE-2. Ragged fold cards. MAJOR. Raised by B, C, D, E and F.

Problem: the Writing, Publishing and System summary cards end at different heights (2222, 2186 and 2290).

Change: make the row a grid with `align-items: stretch`, with each card's summary list at the top and the card filling the height.

Acceptance: all three bottoms are within 1 px of each other.

### SE-3. Health bar saturation. MINOR. Raised by C.

Problem: the saturated green, amber and red "Before the pause" bar is the loudest colour in the app.

Change: mix the bar segments with --surface-2: healthy about 60%, failing about 55%, stale about 60%. Keep the legend dots at full strength so the meaning survives. Apply this in both settings.css and sources.css (same bar on Sources).

## Search

### SR-1. Score chips read as story IDs. MAJOR. Raised by B and F; R22.

Problem: search.js:187 (`storyScore`) renders "story 16". In this app that reads as a story ID, and #/story/16 is a different story.

Change: render the plain `scoreChip` with the tooltip `Story score 16`, followed by the story title link. Don't restyle `.score-chip`.

Acceptance: no "story N" text where N is a score.

### SR-2. Note badge. MINOR. Raised by F.

"x17" becomes "17 copies".

### SR-3. Duplicate contacts. MINOR. Raised by D.

Group contacts with the same name into one row, `Test Alumna ×2 · possible duplicate`, linking to the People duplicate strip.

### SR-4. Refine column. MINOR. Raised by C; R23.

C sees the Refine column ending about 1300 px early, while D reports it is already sticky. Verify at 1440. If it isn't sticky, add `position: sticky; top: 84px`.

### SR-5. Echo deks.

Handle `finding: null` (shared S13) by omitting the dek.

## Runs (87, polish only)

### RU-1. Wording. MINOR. Raised by F.

- "11 failed" becomes "11 sources failed".
- "Thu, 2 Jan 2020" becomes "Thu 2 Jan 2020", matching the app's date style.
- The date control shows "Fri 20 Nov" on a button that opens the native picker.

Never click run.

## Final checks

- Screenshots of Settings at 1440 (Priorities and the bottom cards), Sources at 1440 (health bar), and Search with a claim result.
- `--route settings`, `--route search` and `--route sources` pass E1.
- npm test is green.
- Kill any server you start.

## Brief: map

MAP: round 3 brief. Map is at 85–87, above target, so this is polish plus one honesty fix in the lede, and E1 on map (52 ms in E's run).

Files you own: public/js/views/map.js, public/js/map-engine.js and public/css/v4/map.css.

## M-1. Side panel clipped. MAJOR. Raised by B, C, D, E and F (all five).

Problem: at 1440×900 the side panel's last line ("Select a story to light up its links and list its…") is cut off at the card bottom. `.map-side` scrolls 569 px of content inside 524 px.

Change:
- Remove the bridge sentence from the Biggest bridge card, because it repeats the lede word for word (F). Keep the score chip, the short title, "links 10 stories" and the Select button.
- Tighten the card to 16 px padding.
- If it still overflows, let `.map-side` scroll with `overflow:auto`, `overscroll-behavior:contain` and a 24 px bottom fade.

Acceptance: no clipped text in the side panel at 1440×900.

## M-2. "Hottest topics" header. MINOR. Raised by B, C and D.

Problem: the title and its caption wrap into a cramped 2×2.

Change: keep the title on one line, with "ranked by this week's scores" on its own line underneath in text-3 12 px.

## M-3. Page height. MAJOR. Raised by D.

Problem: the page is 966 px tall at a 900 px viewport.

Change: size the stage at `calc(100dvh − <top offset> − 24px)`, using the token for the top offset rather than a magic number.

Acceptance: the document height is at most the viewport height at 1440×900.

## M-4. Lede honesty. MAJOR. Raised by F.

Problem: "19 stories from Nov 2024 to Nov 2026" uses first_seen from old MCP spec releases, which contradicts Feed's "19 updated in the last 7 days".

Change: use the update window from the same data Feed uses, and write it as a sentence, not "X connects 10 stories". Example: "19 stories updated this week, 36 connections. The biggest bridge, Northwind AI releases Relay, links 10 stories through shared topics (9), watchlist hits (9) and sources (3)." Every number must be computed from /api/map. If the update field isn't on the nodes, drop the date span rather than invent one, and ask shared for the field.

## M-5. Labels. MINOR. Raised by C and F.

- Node labels use the short-title rule: the text before ':' or ' — ', cut at a word boundary, at most 28 characters. No mid-word ellipsis.
- A topic with no hull (fewer than 3 nodes, for example "Business adoption · leads 4") gets a plain text-3 label at its centroid instead of a pill region label.

## M-6. E1 on map. MINOR. Raised by E.

Problem: 52 ms at phone 4×.

Change: draw the canvas and the hidden DOM list after the swap frame (one idle chunk), with the stage size reserved by CSS so nothing shifts.

## Final checks

- Screenshots of Map at 1440×900 in Proof and Night, and at 390.
- `--route map` passes.
- Kill any server you start.
