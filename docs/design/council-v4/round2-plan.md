# Byline v4 council, round 2: merged implementation plan (chair)

Inputs: round2-B/C/D/E/F critic reports (live v4), SPEC-v4 §0 (the user's critique, highest priority), DECISIONS-v4, then majority.

Gap to bar:
- Rubric: color_cohesion 7.9, motion_cohesion 7.7 and motion_smoothness 7.0 (target ≥8); background_generic 2.1 and color_combo_generic 2.4 (target ≤2).
- Tabs below target: today 88.4 and dossier 87.6 (target 90); performance 81.8, employers 82.6, career 82.8, campaigns 83.2, studio 83.4 and settings 84.8 (target 85).

Where the points are:
- **motion_smoothness / motion_cohesion.** E1 fails on today, feed and settings. E2 fails on open, close and rail-collapse. Tab switches show a scroll jump and a double-exposed heading. The theme switch has an unreadable mid frame. Rings pop on revisit.
- **color_combo_generic / color_cohesion.** Blue topic pills sit on below-bar rows. Score chips are flat within each tier. The tile hover wash is too blue. Some meters and bars spend blue on counts.
- **background_generic.** The field's dash rows read through hovered tile text. Page text ghosts through the dossier flight fill.
- **Tabs at 82–84.** Lists repeat identical rows, side columns go dead, a chart carries one fact, and rows carry too much button chrome.

## Conflict rulings

1. **R1. Score-chip ramp.** B (ΔE ≥4) and F (ΔE ≥6) agree on the mechanism, and one formula serves both. `scoreChip()` sets an inline integer `--qd = round(score) − threshold`. The bands:

   | Band | Range of `--qd` | Fill | Outline / text |
   |---|---|---|---|
   | top | ≥ 15 | the computed `var(--q)` (not `--q-5`) | — |
   | clears | 0 to 14 | `color-mix(var(--q) calc(14% + qd×1.4%))` | — |
   | near miss | −15 to −1 | 10% mix | 1.5 px outline |
   | below | < −15 | none | outline only |

   Acceptance takes the stricter number from each critic.
2. **R2. Blue topic pill only above the bar** (B; DECISIONS blue budget). Shared adds a neutral `.chip--lead` and a `topicPills()` helper. Every view uses them.
3. **R3. Theme switch.** B's midpoint colour step for text wins over C's text cross-fade. When text and surface both interpolate linearly, they meet at mid-grey on mid-grey, which cannot reach 3:1. C's other point is adopted: the rail fill, the active item and the segmented toggle move onto the same 600 ms surface transition.
4. **R4. Rail collapse with the dossier open.** E's constant panel width comes first: it uses `--rail-expanded`, so only `left` moves. C's transform fallback is used only if p95 is still over 33 ms. B's ruling applies throughout: the fill stays opaque during the reflow and the frost never drops visibly. This keeps the round-1 "≥160 px of page" rule, and more page shows when the rail is collapsed, which honours the user's "doesn't fill the screen".
5. **R5. Flight fill .94 → .98** (E, backed by B's capture). This overrides DECISIONS, because SPEC §0 ("nothing slides under") outranks it, and captures show page text ghosting through at .94.
6. **R6. Dossier close.** D and E's approach comes first: frost off instantly, the body hidden after its fade, and no large shadow during the clip. C's opacity/transform close is used when the source row is off-screen or small.
7. **R7. Topbar while the dossier is open.** It fades to opacity 0 over 240 ms, then `visibility: hidden` (B, C, D and F all raised it; duration from C and D). This also drops live glass to 1. The scrim goes to .72 (D), and the bottom band (B) is added to `.dossier-scrim`, which lives in components.css, so it belongs to shared and not feed-dossier.
8. **R8. Today's lead tile and row 3.** B and C want no stretch; D wants a stretch with `margin-top: auto`. Both sides agree that no band inside a tile may exceed 32 px. Ruling:
   - Use fixed 24 px gaps.
   - Make up the height difference with real content: the source mix and top claim in the lead tile; F's "Suggested next post" and day cells that grow in This week.
   - If no honest content is left, use `align-self: start`. Never spread empty gaps.
9. **R9. Studio side column.** It becomes sticky, with a "By channel" card (B and E). F's notes card is not adopted, because of the private-notes rule.
10. **R10. Campaigns row action.** A permanent small secondary "Start campaign" button (D and F) wins over hover-only (C). It only opens the existing form, pre-filled; nothing is created without the user submitting it.
11. **R11. Employers chrome.**
    - Pin stays visible as an icon toggle (D, E and F).
    - Edit and the watchlist actions move into a ··· menu (C, E and F).
    - Activity becomes a quiet link.
    - The watchlist "pin" is renamed **Follow** (C), so "pinned" means one thing.
12. **R12. Map Hottest-topics bars.** They stay, with a neutral fill and a visible value with its unit (B, C and D). SPEC §0 bans unlabelled mini graphs.
13. **R13. Performance chart.** All five critics agree. The chart is replaced by a sentence until edits span at least 3 distinct days.
14. **R14. Phone dossier actions.** D's two-row grid, with every action visible, wins over F's icon-only button and E's "hide it in a menu".
15. **R15. Calendar open slots.** E's dot is not adopted. B rated the neutral open slots positively, and Calendar is already at target.
16. **Not adopted:**
    - C's ring stroke-width tiers (the round-1 ruling stands).
    - Any change that clicks run, approve, publish or send.

## Order of work

1. **shared** first. Every other owner depends on its APIs: `hasCounted`, `topicPills` / `.chip--lead`, the `--qd` chip, the `afterFlight` contract, and the router timing.
2. Then, in parallel:
   - **feed-dossier**: dossier −2.4, plus the colour blockers.
   - **career-publish**: performance −3.2, employers −2.4, career −2.2, campaigns −1.8.
   - **today**: −1.6.
   - **calendar-studio**: studio −1.6.
   - **search-system**: settings −0.2, plus E1.
   - **map**: colour and labels only.

---

## Brief: shared

Files you own: `public/index.html`, `public/js/{app,ui,motion,bg,bg2d,bg2d-worker,dossier,quality,index-menu,api}.js`, `public/sw.js`, `public/css/v4/{tokens,shell,components}.css`, icons, `server.js`, `src/**`, `test/**`. Read SPEC §0, DECISIONS, GATES, and `docs/design/council-v4/round2-{B,C,D,E,F}.md`.

You hold the biggest point gap: motion_smoothness is 7.0 against a target of 8, because E1 and E2 fail. Do P0 first, in order. Other owners depend on S7, S8, S9 and the S2 `afterFlight` contract, so land those early and keep the names exactly as written.

### P0: motion blockers

**S1. Router tab switch** (C, D, E and F; blocker). One transition has three defects:
- (a) **Scroll jump (D).** With Today scrolled to 900 px, `scrollY` becomes 0 on the first frame after the hash change. The old view then stays visible at its top for about 230 ms.
- (b) **Double exposure (C; F saw the eyebrow doubled).** At about 300–350 ms, the old h1 and the new h1 are both at roughly 0.2–0.3 opacity in the same grid cell.
- (c) **Full-document layout (E).** The swap frame does a non-partial layout. At phone 4×, adding `.in` (app.js:348) costs 70 ms of Layout plus 54 ms of Paint, and the append frame (app.js:271) adds another 60 ms.

Fix, in app.js:
- **Scroll.** Call `scrollTo(0,0)` in the same task that removes the old page and inserts the new one, after the old page has reached opacity 0. Do not call it at hashchange. The alternative is to pin the old view with `translateY(-oldScrollY)` and reset scroll immediately.
- **Headings.** `.leaving .page-head` gets its own 140 ms opacity fade on `--ease-exit`, so the old h1 is below .05 by 150 ms. The new h1 starts at ENTER_BASE+50 (170 ms). The rest of the cascade stays at 120 ms.
- **Enter animations.** Drop the page-level `.entering` / `.in` class toggles and the inherited `--enter-base`, `--enter-head` and `--i` on `.page`. Create one WAAPI animation per enter item in the swap task: opacity 0→1, `translateY(10px)`→0, delay base + i×stagger, `fill: 'backwards'`, `EASE.settle`.
- **Partial layout.** Trace the swap again and fix whatever keeps the layout non-partial. Suspects: `scrollTo`, and removing the old page resizing `#view`'s shared grid cell (keep the leaving page out of flow, e.g. absolutely positioned, during the leave).
- **Phone More item (D).** For any route that isn't one of the four primary tabs, the bottom bar's More item gets `aria-current="page"` and the active style.

Accept:
- In a per-frame log, `scrollY` keeps its old value until the old h1's opacity is below .05.
- No sampled frame has both the old h1 and line 1 of the new h1 above .08 opacity.
- In a phone 4× trace, the swap-frame Layout is partial and under 15 ms.
- E1 passes on today, feed and settings, together with those owners' work: longest LoAF < 50 ms and Σ blocking < 100 ms.

**S2. Dossier open** (C, D and E; blocker). Measured:
- The longest frame is 63–77 ms.
- Desktop open p95 at 1× is 50 ms. Viz DrawAndSwap reaches 65 ms because a rounded clip-path animates on a 1024×876 panel that also carries `--shadow-shell`.
- When the story isn't prefetched, the body is blank for 400–600 ms and then pops in (C). When it is prefetched, the body is empty for about 250 ms after landing (E).

Fix, in dossier.js and components.css:
- **Shadow.** During the flight, `.dossier-panel` has only `box-shadow: inset 0 0 0 1px var(--glass-border)`. The soft shadow moves to `.dossier-panel::after`, and its opacity fades in over 200 ms after landing.
- **Clip.** Animate the clip-path with `round 0px` until offset .75, then `round 16px`. Alternatively, drop `round` and rely on `border-radius` plus `overflow: hidden`.
- **will-change.** JS sets `will-change: transform, opacity, clip-path` only for the duration of the animation.
- **Stagger.** Base 160 ms when flying (was 300). The `[data-col]` divider fades in with its column, never at full opacity first. Section 1 is fully visible by 480 ms after the click.
- **afterFlight contract.** Call the renderer's `afterFlight()` in its own task (`setTimeout(0)` after the frame that adds `.frosted`), never in the same task. feed-dossier will chunk its own deferred sections with `scheduler.yield()`. Keep the contract otherwise unchanged.
- **Skeleton (C, within the DECISIONS limits).** `placeholderHtml()` becomes section-shaped:
  - a lede of 2 bars, an actions row of 3 pills, and two columns of 4 bars each (`--surface-2`, radius 5);
  - breathing on an 1800 ms sine, opacity .55↔.8, with no shimmer;
  - shown only if data takes longer than 120 ms, held at least 320 ms, then the 240 ms crossfade.
- **Prefetch.** Also prefetch on `pointerdown` and `focusin` of story links / `[data-dossier-src]`, not only on hover.
- **Title clip (E).** In `rTo()`, pad the source rect's top inset by max(8px, title line-height − row padding-top), so no title glyph is cut mid-flight.

Accept:
- E2 open: longest LoAF < 50 ms on desktop and on phone at 4×.
- New check: desktop open frame p95 ≤ 20 ms at 1×.
- No capture frame between 400 and 700 ms shows an empty panel body.
- A 60 fps capture shows no clipped title glyph.

**S3. Dossier close** (C, D and E; blocker). Close p95 is 33–50 ms at 1×, and the longest frame is 65 ms at 4×.

Fix:
- On the first close frame, set `.dossier-frost` to opacity 0 with no transition, and switch the panel to the opaque flight fill. There is no large shadow (S2).
- After the 140 ms body fade, set `.dossier-scroll` to `display: none`, so the clip animates over an empty fill.
- Animate only transform, opacity and clip-path.
- If the source row is off-screen, or its rect is under 30% of the panel height, close with opacity 1→0 plus a translate/scale toward the source over 360 ms (C).

Accept: E2 close p95 ≤ 20 ms at 1×, and close longest LoAF < 50 ms at 4×.

**S4. Rail collapse with the dossier open** (B, C and E; blocker; ruling R4). Measured:
- p95 is 64–71 ms at 4×. Each frame costs 52 ms of style and 49 ms of layout, because the panel width changes every frame.
- The frost drops for about 270 ms (`is-reflowing`), and Feed's h1 shows through the panel.

Fix:
- **Width.** `.dossier-panel { width: min(1040px, calc(100vw - var(--rail-expanded) - 2*var(--shell-inset) - 160px)) }`. The width is now constant, so only `left` moves with `--rail-w`, and `contain: layout paint` keeps the children from re-laying out. Remove `railWillChange`'s body width lock if it is no longer needed.
- **Fill.** During `.is-reflowing`, the panel fill is ≥ .98 (the flight fill). Never fade the frost out visibly. Restore it at `transitionend`.
- **Fallback (C), only if p95 is still over 33 ms.** Set the final `left` once at the start, then animate `transform: translateX(delta→0)` over 420 ms `--ease-move`. Keep the `dossier.left ≥ rail.right` assertion, measured on the visual rect.

Accept:
- E2 collapse p95 ≤ 33 ms at 4×, drift ≤ 1 px, minimum gap ≥ 0.
- A 30 fps capture of the collapse shows no page glyphs inside the panel rect.

**S5. Flight fill** (E and B; ruling R5). In tokens.css, raise `--surface-flight` from .94 to .98 in Proof and Night.

Accept: page-text contrast inside the panel during the flight is below 1.1:1.

**S6. Theme switch** (B and C; ruling R3). At about 150 ms, regular lede text and button labels are mid-grey on mid-grey (< 1.5:1). The rail fill, active item and toggle flip in 1–2 frames while the content cross-fades over 600 ms.

Fix, in shell.css `html.theme-xfade`:
- Surfaces and `--bg` stay on `--dur-theme` (600 ms).
- Text-bearing elements switch colour in one step at the midpoint: `:is(h1,h2,h3,h4,p,li,a,td,th,label,small,strong,b,span,button,.btn,.chip,.tag,.lede,.t-2) { transition: color 1ms linear calc(var(--dur-theme)/2) }`.
- The rail fill, the active item and the segmented toggle move onto the same 600 ms surface transition.
- Add a 150 ms sample to the C-theme gate.

Accept: text/surface contrast ≥ 3:1 at 60, 150, 300, 450 and 600 ms, in both directions, and frame p95 ≤ 33 ms at 1×.

**S7. Rings pop on revisit** (B blocker, F). On Feed→Today, the lead ring shows '0' from 73 to 660 ms and snaps to 78 at 712 ms.

Fix:
- motion.js exports `hasCounted(key, final)`, which returns `counted().has(`${key}:${final}`)`.
- In ui.js `scoreRing()`: when `count && key && hasCounted(key, shown)`, render the final number, the final dashoffset, the final `--q` and `data-q`, and the full gradient stop, with no `is-counting`. This is the same markup as `count: false`.
- The today owner will skip its stagger for counted keys.

Accept: an rAF log of Feed→Today shows no frame with a ring value other than its final value.

### P1: colour (color_combo_generic 2.4, color_cohesion 7.9, background_generic 2.1)

**S8. Score chips carry the gradient** (B blocker, F; ruling R1). Today:
- Clears chips at 56–62 are invisible tints (L .937–.925).
- `[data-q=top]` uses a flat `var(--q-5)`, so 72 and 78 look identical.
- Below-bar chips at 44 and 7 share their text and border colour.

Fix, in ui.js `scoreChip()`: set inline `--qd` to the integer round(score) − threshold, clamped to −30…30, and keep `data-q` from `qualityTier`. In components.css:163-168, style each band:

| Band | `--qd` | Background | Outline / ring | Text | Extra |
|---|---|---|---|---|---|
| top | ≥ 15 | `var(--q)` | — | `--q-on5`, AA-checked | keep the glow |
| clears | 0–14 | `color-mix(in oklab, var(--q) calc(14% + var(--qd)*1.4%), var(--surface-solid))` | inset 1px ring of `--q` at 40% | — | — |
| near miss | −15 to −1 | `color-mix(in oklab, var(--q) 10%, var(--surface-solid))` | inset 1.5px `var(--q)` outline | `--text-1` | — |
| below | < −15 | transparent | 1.5px outline | `--text-3` | — |

Add an AA check for every chip score from 0 to 100 at T=55, in both themes, to the contrast test.

Accept: in both themes, ΔE (OKLab × 100) is ≥ 4 between 56 and 62, ≥ 6 between 56 and 64, and ≥ 4 between 72 and 78, and 44 visibly differs from 7. Every tab that uses `scoreChip` inherits this, so tab owners must not restyle `.score-chip`.

**S9. Neutral lead pill** (B, color_combo). Add `.chip--lead` to components.css: the neutral inset fill (`--tint-2` or an `--inset` token), `--text-1`, weight 600. Export from ui.js `topicPills(topics, score, th = threshold(), { max = 2 } = {})`:
- The first topic gets `.chip--main` (blue) only if round(score) ≥ th, and `.chip--lead` otherwise.
- The rest get `.chip--topic`.

Tab owners call it (feed-dossier, search-system, today, calendar-studio and career-publish are told).

Accept: Feed shows at most 7 blue pills, matching "7 above 55".

**S10. Tile hover** (B and E). The tile centre goes from #FFFFFF to rgb(231,239,255), ΔE about 9, which reads as selected. Separately, the field's dash rows show through hovered body text like lined paper.

Fix:
- In Proof, `--hover-spot` goes from .10 to .07, with the radial sized to 70% of the tile width so the tile edges stay ≈ #FDFEFF. In Night, it goes from .14 to .11.
- Keep `--hover-line` at .34 and keep the `#bg-light` pool.
- Raise the `.tile:hover` surface opacity to ≥ .94.

The user asked for a hover hue slightly stronger than Edition (SPEC §0), so don't go below Edition.

Accept: in Proof, hovered vs rest at the tile centre is ΔE 3–5, and dash contrast under hovered body text is below 1.08:1.

**S11. Topbar and scrim with the dossier open** (B, C, D and F; ruling R7). The panel edge cuts the Ctrl K trigger and the status pill, and the 160 px strip shows half-cut page text.

Fix:
- While `html.dossier-open`, fade the `.topbar` children to opacity 0 over 240 ms on `--ease-exit`, then set `visibility: hidden`. Restore them with a 240 ms fade on close.
- Set `--scrim` to rgba(245,246,248,.72) in Proof and rgba(18,19,22,.72) in Night.
- Layer a bottom band on `.dossier-scrim` (components.css:334), over the existing scrim, in both themes: `linear-gradient(to top, var(--bg) 0, var(--bg) 24px, transparent 64px)`.

Accept:
- A 1440 screenshot with the dossier open shows no half-cut topbar text and no legible page text in the bottom gap.
- E8 glass is ≤ 2 (1 is expected with the dossier open).

**S12. Close button backing** (D). `.dossier-bar` floats over scrolled content and overlaps the '/ 20' figures.

Fix:
- Give it a solid pill: background `var(--surface-strong)`, 1px `var(--line)`, `var(--shadow-1)`, radius 999.
- Add a sticky 56 px top fade inside `.dossier-scroll`: `linear-gradient(var(--dossier-fill) 55%, transparent)`. Show it only when `scrollTop > 8`, toggled by a class from a passive scroll listener with no layout reads.

Accept: a scrolled dossier shows no text under the close button.

### P1: data honesty (F)

**S13. Employer connections** (F blocker). Story 16 is Google Cloud's own post, yet the dossier lists Google Cloud under "Topical overlap only, not named". src/ai/local.js:171 tests only the best passage.

Fix:
- Compute `nameHit` over every article title, summary and claim of the story, plus `story.companies` and the origin domain.
- When the employer is the origin, the row reads "First-party: this is Google Cloud's own post".
- Add a unit test where the employer is named only in a title.

**S14. Boilerplate in findings and claims** (F). Fix, in src/finding.js:
- Add `/we(?:'|’)ve heard (?:helpful )?feedback/i`, `/^now,? everybody/i`, `/finally gets what they want/i` and `/^since announcing/i`.
- First-person-plural sentences with no number are not eligible as the Key claim or the post-worthy quote.
- Use 'Mentions X, Y and Z.' only when no claim exists. Otherwise fall back to the short title.
- De-duplicate signal hits that are substrings of another hit ('availability' inside 'general availability').
- Add a unit test for each.

Accept: `npm test` is green, and story 16 no longer shows those lines.

### P2

**S15. Focus** (F).
- Add `:is(.chip--filter,.seg-opt,.fd-seg-btn)[aria-pressed=true]:focus-visible { box-shadow: var(--focus) }`.
- `--ctl-ring` becomes `0 0 0 2px var(--accent)`.
- Re-run F-focus with a pressed chip focused.

**S16. Rail mark** (B). The glyph spans only 38 of 64 units, so in the 26 px box the drawn mark is about 15 px.

Fix:
- Crop the rail and phone `.brand-mark` viewBox to the glyph bounds, about `9 6 48 50` (verify), so the drawn mark is about 24–26 px with an effective stroke of about 2.2 px.
- The underline stays `--accent`, and the draw-in stays.
- The favicon and app icons are unchanged.

Accept: the mark's cap height is at least the wordmark's x-height in both themes, and E11 still passes.

**S17. Harness** (E). Add the following to test/e2e:
- an E2 check for desktop open frame p95 at 1× ≤ 20 ms;
- Feed filter persistence: persisting rows keep opacity ≥ .9 through a filter change;
- an E1 trace check that the swap-frame Layout is partial and under 15 ms at 4×;
- a per-route E4 check that `#/search` idle task time is under 6 ms per 3 s, with 0 layouts;
- a 150 ms sample in C-theme;
- a ring-revisit check: no ring value other than the final one;
- a tab-switch double-exposure check.

Finally: run `node test/e2e/run.mjs` (all gates) and `npm test`, and report the per-gate deltas.

---

## Brief: feed-dossier

Files you own: `public/js/views/feed.js`, `public/js/views/story-dossier.js`, `public/css/v4/feed.css`, `public/css/v4/dossier.css`.

Targets:
- Dossier from 87.6 to ≥ 90.
- Feed stays ≥ 88.
- Remove the biggest color_combo_generic source.
- E1 (feed) and E2 must pass.

What shared provides (do not re-implement it, and do not edit shared files):
- `topicPills(topics, score, th)` and `.chip--lead` in ui.js and components.css.
- Score chips that carry the gradient through `--qd`. Do not restyle `.score-chip` in feed.css.
- The dossier flight, shadow, skeleton, close, topbar fade, scrim bottom band and close-button backing.
- dossier.js now calls your `afterFlight()` in its own task.
- Server-side fixes to boilerplate findings and claims, and to the Google Cloud "not named" connection.

Blockers first:

**FD1. Dossier below-fold render** (C, D and E). `afterFlight` → `fillProgressive` renders Evidence, Lens, Employer connections, Drafts and Tune, causing 50–83 ms frames 800–1200 ms after open.

Fix:
- Render each section in its own task, at ≤ 6 ms per chunk, with `scheduler.yield()` (fallback `setTimeout(0)`) or `requestIdleCallback({ timeout: 200 })`.
- Insert each section wrapper with `content-visibility: auto; contain-intrinsic-size: auto 320px` (measure the real heights).
- Do no layout reads during these renders. `layoutObserver` starts after the last chunk and uses only ResizeObserver.

Accept: E2 longest LoAF < 50 ms in the 0–1500 ms window, on desktop and on phone at 4×.

**FD2. Blue main-topic pill on below-bar rows** (B; the main color_combo_generic source). Today, all 19 Feed rows have a blue pill, including the 12 below the bar.

Fix: render topic pills with `topicPills()` in Feed rows and in the dossier head, so blue appears only when round(score) ≥ threshold.

Accept: Feed shows at most 7 blue pills, equal to the "7 above 55" count, and a below-bar story's dossier head shows the neutral lead pill.

**FD3. Feed E1** (C and E). The phone 4× tab-in takes 62–94 ms, and the append frame lays out 648 dirty objects.

Fix:
- Render the first 8 rows synchronously and the rest in one idle chunk.
- Every row after the 8th gets `cv-row`, including the 7-day list (lower `CV_FROM`).
- Set `contain-intrinsic-size` to the measured row height (feed.css:48 says 106 px; C measured about 78; measure it yourself).

Accept: E1 `--route feed` longest LoAF < 50 ms and Σ blocking < 100 ms, and E3 CLS < 0.01.

**FD4. A filter click blanks the list** (E). The whole list blanks for about 150 ms and the same rows fade back at 380–530 ms. The h1 shows a half state ("stories; above .").

Fix:
- Key rows by story id. Persisting rows stay at opacity 1 and FLIP to their new position (transform, 240 ms, `--ease-move`, using motion.js `flip`).
- New rows fade in over 240 ms with a 30 ms stagger, at most 6. Leaving rows fade out over 140 ms.
- The h1 cross-fades as a whole: the old one out over 120 ms, then `enterHeading`'s tab variant. Figures are never blanked in place.

Accept: shared's new harness check passes (persisting rows stay ≥ .9 opacity), and no frame shows an h1 with missing figures.

Dossier content (the user asked for "more summary of what each source actually said", SPEC §0):

**FD5. Source summaries** (B, C and F). Every source card in "What the sources say" shows its summary or key claim:
- 1–2 sentences, with number highlights.
- Card summaries use `-webkit-line-clamp: 2` (it is 1 today).
- When both are missing, show "No summary extracted for this post." in `--text-3`.
- When a source title equals the story title, show its key claim instead of repeating the title.

**FD6. Claims cut before their object** (F). For example: "…already using…" and "multi-…". In Checkable numbers and Why it's post-worthy, show claims in full up to 240 characters. Beyond that, clamp at 3 lines, never mid-word and never right after a hyphen.

**FD7. Primary tag** (C). Only the earliest first-party post gets "Primary". Other posts from the same outlet get "Same outlet".

**FD8. Independent callout repeats the dek** (F, story 13). When the callout text equals the dek, render an attribution line instead: "Independent check · The Ledger (ledger-news.example) · its 21% is below Northwind's own 38%".
- Compare only numbers that both appear in the story's marked claims. Never invent a comparison.
- Otherwise, show just the outlet and a link.

The independent card also shows its own claim or summary.

**FD9. Long-title header** (F). Story 13's title runs 4 lines, and the right header column is empty from y≈190 to 490.
- Titles over 70 characters step the h1 down one size (about 36/40).
- When the right column is shorter than the left, move the topic pills under the Sources/Companies block.

Accept: the header columns end within 24 px of each other.

**FD10. Precision and the Demo tag** (F).
- The breakdown head reads "78 of 100 · 23 over your bar of 55": the integer round(score) − threshold. The decimal appears only in the "= 77.8 → 78" reconciliation row.
- Strip the "DEMO · " prefix whenever the Demo tag shows, and keep the tag inline on the meta line (`white-space: nowrap`).

**FD11. Phone action bar** (D, E and F; ruling R14). `.dx-actions` holds 514 px of content in 345 px, so "Open primary" is clipped.

Fix, at `max-width: 480px`, two rows:
- "Draft a post" (split button) at full width;
- then Save, Dismiss and "Source ↗" in a 3-column 1fr grid.

No horizontal scroll.

Accept: every action is fully visible at 390.

Feed minor:

**FD12** (D). Move "Archived" (a state filter) into the time/sort control row. The date gets a fixed 56 px column right after the meta block.

**FD13** (F). Order the topic filter chips by count × priority weight, with weight ≤ 1 topics after all others. Keep the counts visible.

Acceptance overall:
- Screenshots of Feed at 1440 in Proof and Night.
- Story 13 and story 16 dossiers at 1440 and at 390.
- Gates: `node test/e2e/run.mjs --only E1,E2,E3 --route feed`, plus F-contrast and F-focus.

---

## Brief: career-publish

Files you own: `public/js/views/{campaigns,performance,career,employers,people}.js` and `public/css/v4/{campaigns,performance,career,employers,people}.css`.

Targets: performance 81.8, employers 82.6, career 82.8 and campaigns 83.2 all need to reach ≥ 85. People should stay ≥ 85.

What shared provides:
- `topicPills(topics, score, th)` with `.chip--lead`. The blue pill appears only above the bar; use it wherever you render topic pills.
- `scoreChip()` now carries the gradient. Don't restyle it.

Use `top: calc(var(--topbar-h) + 16px)` for sticky columns.

Never create, approve, publish or send anything on click.

**CP1. Performance** (all five critics; blocker; ruling R13). Two problems:
- "Last edit per open draft · 14 days" is 13 empty bars and one bar.
- "Closest to publishing" lists the same Northwind title three times.

Fix:
- Show the chart only when the last edits span ≥ 3 distinct days. Otherwise show one computed sentence, e.g. "All 22 open drafts were last edited Wed 18 Nov.", plus at most one labelled stat.
- Group "Closest to publishing" by story: one title, then channel chips with their status (LinkedIn · roundup In review, Video · explainer Draft, Instagram · carousel Draft), then the next open slot.

Accept: no story title appears twice, and no chart has fewer than 3 non-zero columns.

**CP2. Employers** (all five; ruling R11). About 30–40 Pin/Edit/Activity/+Team controls fill the right third of the page. "Pinned" means two things. No row says which stories mention the employer.

Fix:
- Pin becomes a 24 px icon toggle beside the employer name: outline or filled, with `aria-pressed` and a tooltip. Keep the Pinned state visible.
- Edit and the team-watchlist actions move into a "···" row menu that is keyboard-accessible and closes on Esc.
- "Activity →" becomes a quiet text link.
- Rename the watchlist pin action to "Follow".
- Show "+ Team" only on row `:hover` or `:focus-within` when the employer has no watchlists. Reserve its space so nothing shifts.
- Under each coverage bar, list up to 2 titles of stories that mention the employer (Newsreader 13, `--text-2`), each opening the dossier (`#/story/:id`).
  - Derive them from `/api/stories` `employers` / `employer_hits` if the employers payload lacks them.
  - If neither source has them, omit the list. Never guess.
- Hide the bar track when the count is 0.

Accept: at 1440, each row shows at rest only the pin icon, the bar, the story titles and the Activity link.

**CP3. Career** (B, C, D, E and F).
- **h1 (B).** "Agents leads your skill radar" is ungrammatical. Use '"agents" leads your skill radar: 10 mentions this week.', with the fallback "Your top skill this week is agents (10 mentions)." Keep the casing from the data (acronyms such as AI and SEC stay upper case). Otherwise use sentence case (F).
- **One-liner (C, E and F).** Computed template: "<Skill>: N source mentions this week and named in your J saved job post(s) (K copies counted once). <Topic> was a story topic on D days, but only the job post names it as a skill." Drop any clause whose data is missing.
- **Trend column (C, D and E).** It is empty on 20–23 of 23 rows. Hide it until there are ≥ 2 weeks of history, or while fewer than 25% of rows have a value. Keep the note in the table caption, and show "Jobs only" inline after the skill name.
- **Sort (C and F).** Add a visible "Weight" column (mentions + 2 × job posts) and sort by it.
- **Job posts column (D).** "JOB POSTS 1/1" becomes "In job post", shown as a check mark or the words "1 of 1".
- **KPI tiles (D and E).** Keep at most 3, each with context, or fold them into one sentence strip. Captions use `nowrap` ("skills · 30 days").
- **Long tail (B).** Rows with 1 mention and 0 job posts fold into a "N more skills with 1 mention" disclosure.
- **Side column.** Make the right column sticky.

**CP4. Campaigns** (B, C, D and F; ruling R10). The list reads as a copy of Feed: no per-row action, no number highlights, and the right column stops at 815 px.

Fix:
- Make the right column sticky.
- Add a permanent small secondary "Start campaign" button, right-aligned at the top of each row. It opens the existing new-campaign form pre-filled with that story; nothing is created until the user submits.
- Render findings with the same number highlights as Feed (`finding_marks`), and let the finding text run to 64ch.
- Optional (C): group the rows by main topic, matching the summary on the right.

**CP5. People** (B, C, D and F).
- Give the last column (LAST CONTACT) `padding-right: 24px` and `min-width: 112px`, so its header no longer touches the card edge.
- Widen the Person column to 34% so cells wrap to at most 2 lines.
- The outreach meter (2 of 3) fills with neutral ink, matching the pipeline bars, not blue.

Long tables (Career, Employers): put `cv-row` with a measured `contain-intrinsic-size` on the rows when there are more than 30.

Acceptance:
- Screenshots at 1440 of performance, employers, career, campaigns and people in Proof, plus one in Night.
- While scrolling, no blank side column is taller than one row.
- E3 CLS < 0.01 on these routes, and F-contrast passes.

---

## Brief: today

Files you own: `public/js/views/today.js`, `public/css/v4/today.css`.

Target: 88.4 → ≥ 90. E1 on today must pass; it is the worst route at 76–95 ms on phone 4×.

What shared provides:
- `hasCounted(key, final)` from motion.js. `scoreRing({ count: true, key })` now renders the final state when the key was already counted.
- `topicPills()` / `.chip--lead`.
- Score chips that carry the gradient (don't restyle them).
- A router that fires `byline:routed` with `detail.page`, as it does today; settings.js:401 shows the pattern.
- A weaker tile hover wash.

Never click "Run today's workflow".

**T1. E1 on today** (C and E; blocker). The pending page lays out about 2,000 nodes at once, and the count-up and weather render run in the fetch-resolve task.

Fix:
- Render only the head and the three story tiles in the swap frame.
- After `byline:routed` (page match, then rAF, then `setTimeout`), build News weather (the SVG dot rows), the mini map, This week, Waiting on you and Also in the brief in idle chunks of ≤ 6 ms each.
- Add the shared `.cv` class to those tiles with `contain-intrinsic-size: auto` set to their measured heights (about 430/430/280/280/340 px).
- Start the weather render and the ring count-up on `byline:routed`.

Accept: E1 `--route today` longest LoAF < 50 ms and Σ blocking < 100 ms, and E3 CLS < 0.01.

**T2. Rings on revisit** (B blocker, F). Skip the `setTimeout` stagger and the `countTo` for any ring where `hasCounted(key, score)` is true.

Accept: no frame of Feed→Today shows a ring value other than its final one.

**T3. Lead tile dead bands** (B, C, D and E; ruling R8). There is about 60 px under the finding and 40–70 px above the footer, because the spare height is spread into gaps.

Fix:
- Use fixed 24 px gaps between dek, Why it ranked, Named and the footer. Remove the `margin-top: auto` / `min-height` spreading.
- If the tile is still more than 32 px shorter than the right column, fill it with real data from `/api/today`: the source mix line ("6 posts · 1 outlet · 0 independent") and, if present, the top claim with its number highlights.
- If no honest content is left, use `align-self: start`. Never spread the gaps.

Accept: at 1440, with the rail expanded and collapsed, no vertical gap inside the lead tile is larger than 32 px.

**T4. Row-3 hole** (C and D). This week is 277 px tall and Waiting on you is 330 px.

Fix:
- Move "Nothing planned yet. N drafts are in the tray." directly under the 7-day legend.
- T5 adds a real row.
- If the tile is still short, stretch the row and let the 7-day strip's day cells grow (`flex: 1`), so content absorbs the height rather than a blank band.

Accept: both tiles end within 8 px of each other, no band inside either is larger than 32 px, and the gap above Also in the brief is the 16 px gutter.

**T5. Suggested next post duplicates Waiting on you** (F).
- "Suggested next post" becomes the highest-scoring above-bar story that has no draft, e.g. "<short title> · 64 · no draft yet → Draft a post", which only opens the draft flow.
- Fall back to the in-review draft only when every above-bar story already has a draft.

**T6. Eyebrow repeats the pill** (F). State the brief's age instead: "Brief No. 1 · from yesterday's run", or "from today's run" on the same day, computed in `settings.timezone`.

**T7. Mini map** (C and D). Clusters use about 55% of the canvas, nodes are tiny, and labels sit on top of nodes.
- Fit the node bounds to the canvas with 12% padding.
- Scale node radius from 6 to 9 px by score.
- Label the top 3 nodes with their `short_title`, placed outside the cluster discs toward the nearest edge. At most 3 labels, and none overlapping a node.

**T8. News weather catch-all** (F). For priority-weight ≤ 1 rows (Machine learning), set the row label in `--text-3` and replace the heat word with "catch-all". Keep the dots. This brings the chart in line with the sentence above it.

**T9. Head actions** (D). Align "Run today's workflow" and the more button to the H1's last baseline (D §3), not to line 2 of the lede.

**T10.** Render topic pills with `topicPills()`. Do not restyle the "Also in the brief" chips; the shared ramp fixes 62/61/59.

Acceptance:
- Screenshots of Today at 1440, rail expanded and collapsed, in Proof and Night, and at 390.
- Gates: `node test/e2e/run.mjs --only E1,E3 --route today` and the C motion group.

---

## Brief: calendar-studio

Files you own: `public/js/views/{calendar,studio}.js`, any draft sub-view module that only they import, and `public/css/v4/{calendar,studio}.css`.

Target: studio 83.4 → ≥ 85. Calendar is at target; do its items after Studio. E1 covers both routes and must keep passing.

What shared provides: `topicPills()` / `.chip--lead` and the gradient `scoreChip()`. Use them; don't restyle them.

Never trigger approve, schedule or publish.

**CS1. Identical draft rows** (all five critics; F calls it a blocker). Rows read "Video · explainer", "Instagram · carousel", "Video · explainer", "Instagram · carousel", all "Draft · 1d ago", in both the Studio groups and the Calendar tray.

Fix:
- After the format label, add the first 60–70 characters of each draft's hook, cut at a word boundary (`--text-2`, 13 px, one line, ellipsis).
- Collapse true duplicates (same format and same hook) into one expandable row, e.g. "Video · explainer ×2".
- When every row in a group shares the same edited time, show it once in the group head.

Accept: no two visible sibling rows have identical text in Studio or in the tray.

**CS2. Dead right column** (B, C, D, E and F; ruling R9). The right column ends at about 740 px beside a list about 1,550 px long.

Fix:
- Make `.st-aside` sticky with `top: calc(var(--topbar-h) + 16px)`.
- Add a "By channel" card built from existing counts: e.g. 12 LinkedIn · 5 Instagram · 5 Video, each split into in review and draft, set against the posting days from settings. Everything is computed.
- Do not add a notes card (private-notes rule).

Accept: at 1440, no blank column is taller than one row while scrolling.

**CS3. Hero excerpt** (D and F). It currently reads like "My own locked hook. 1. Northwind…" and "harness....".
- Show only the hook, with any leading list marker ("1.") stripped, clamped to 2 lines.
- Strip trailing `[.,;:]` before appending "…".

**CS4. Draft view tabs clip** (B, C, D and F). The `.st-tabs` scrollWidth is 416 px in a 336 px clientWidth, so "History 10" is cut off.

Fix:
- Set tab padding to 0 8px, gap to 2px and labels to 13 px, and show Notes as an icon plus count.
- If the tabs still overflow, move Sources and History into a trailing "More" menu below 1520 px.

Accept: scrollWidth ≤ clientWidth at 1280 and at 1440 with the rail expanded.

Calendar (minor):
- **CS5** (B). Past-day cells lighten to `--tint-1` (about .02), so today is the only emphasis.
- **CS6** (C). Legend swatches match the cells: draft dashed, approved solid outline, scheduled blue tint.
- **CS7** (C and F). "This wk" becomes "This week".
- **CS8** (C). Identical same-day outreach collapses to "Test Alumna ×2".
- **CS9** (D). The tray channel/format label stays on one line. The tray story title uses the short-title rule and clamps at 2 lines.
- **CS10** (F). Week-view titles use the short-title rule (the text before ':' or ' — ') with a 3-line clamp.

Open slots stay as neutral dashed chips; E's dot was not adopted.

Acceptance:
- Screenshots of studio, draft/1 and the calendar month and week views at 1440 and 1280.
- Gates: `node test/e2e/run.mjs --only E1,E3 --route studio,calendar`.

---

## Brief: search-system

Files you own: `public/js/views/{search,sources,settings,runs}.js` and `public/css/v4/{search,sources,settings,runs}.css`.

Targets:
- Settings from 84.8 to ≥ 85.
- E1 on settings must pass (71–72 ms today).
- Search, sources and runs should stay ≥ 85.

What shared provides: `topicPills()` / `.chip--lead` (blue only above the bar), the gradient `scoreChip()`, and `byline:routed`.

**SS1. Settings E1** (C and E; blocker). A single `setTimeout` renders every section at once.

Fix:
- Render each section in its own task, with `scheduler.yield()` between Priorities, Threshold, Schedule, AI provider and Budget.
- Add the shared `.cv` class to every `.sg-fold` after the first two, with `contain-intrinsic-size: auto 480px` (measure the real heights).

Accept: E1 `--route settings` longest LoAF < 50 ms and Σ blocking < 100 ms, and CLS < 0.01.

**SS2. Budget reads as an error** (C and D). It shows "$0.0000 · limit reached".
- When the monthly limit is 0, show a neutral tag "Paid AI off · local engine only" and the spend as "$0.00".
- Show "limit reached" only when the limit is above 0 and spend has reached it.
- Use 2 decimals everywhere.

**SS3. Settings length and alignment** (B and E). The page is about 3,450 px long, and section labels sit at x 518 while the cards start at x 541.
- Align the section labels to the card edge.
- Collapse Calendar feed & access, Media and Budget into closed-by-default disclosures, each with a one-line summary in its header (Budget: "Paid AI off").

Target: ≤ 2,400 px at 1440.

**SS4. Truncated topic inputs** (D). Priority topic inputs are at least 240 px wide, or wrap to 2 lines. No truncated names ("model horse-ra").

**SS5. Search colour and labels** (B and C).
- Render topic pills with `topicPills()`, so below-bar story results get the neutral lead pill.
- A claim row's story score becomes `scoreChip` with the visible text "story 59" and the title "Story score 59".
- `.sr-group.cv` uses `contain-intrinsic-size: auto 440px` (measure it).

**SS6. Search idle work** (E). Search does 63 ms of task time and 1 layout per 3 s.
- The `setTimeout(run, 2500)` at search.js:83 becomes a no-op once the idle run has happened.
- Put `contain: layout paint` on the search bar wrapper.

Accept: `#/search` idle is under 6 ms of task time and 0 layouts per 3 s (shared adds this check).

**SS7. Phone chip rows** (D). At ≤ 480px, each chip row and the Refine segment row get `mask-image: linear-gradient(90deg, #000 calc(100% - 24px), transparent)` and `scroll-snap-type: x proximity`.

**SS8. Refine aside** (F). Its sticky top becomes `calc(var(--topbar-h) + 16px)`, so the "All results" row stays visible while scrolling.

**SS9. Sources health** (B, C and F). All 26 rows read "Paused" with the same hollow grey dot.
- When a source is paused, show its `health_unpaused` (already in `/api/sources`) as the primary state, with "paused" as a muted sub-label:
  - "was failing" with a hollow `--err` ring dot;
  - "was healthy" with a hollow `--ok` ring dot;
  - "stale" with a hollow `--warn` ring dot.
- Failing rows show `last_error` inline (60 characters, with the full text in `title`).
- Format all times as h:mm AM/PM ("11:52 AM").

**SS10. Runs** (C). Collapse consecutive runs with the same outcome into one expandable row, e.g. "#7–#16 · 10 runs · Done · 0 sources read · 18 Nov 6:25–6:28 PM".

Never click run or sync.

Acceptance:
- Screenshots of settings, search (1440 and 390), sources and runs.
- Gates: `node test/e2e/run.mjs --only E1,E3,E4 --route settings,search,sources`.

---

## Brief: map

Files you own: `public/js/views/map.js`, `public/js/map-engine.js`, `public/css/v4/map.css`.

Map is at about 86, which is at target. Your items lift color_combo_generic and fix SPEC §0's ban on unlabelled mini graphs. E1 covers map and must keep passing.

**M1. Hottest-topics bars** (B, C and D; ruling R12). They are solid accent blue and carry no labels.
- Use a neutral fill (`--text-3` at 60%) on `--track`.
- Give each bar a visible value with its unit, matching what the bar measures (e.g. "6 of 19 stories"), plus a `title` tooltip.

Blue stays only on the ramp-coloured nodes.

**M2. Halos** (C). Draw a topic region or contour only for topics with ≥ 3 nodes, and drop the per-node grey halos.

**M3. Labels** (C, E and F).
- Apply the short-title rule:
  - use the text before the first ':' / ' — ' / ', ' when it is at least 20 characters;
  - otherwise cut at a word boundary, at most 32 characters;
  - never end on a preposition or article.
- Draw node labels with a 3 px `--bg` halo (`strokeText` before `fillText`).
- Add collision avoidance:
  - fix the "Analytics" / "Business adoption" overlap at about 560,510 at 1440;
  - anchor story labels at a 6 px offset;
  - hide any label more than 24 px from its node.
- Show full titles only on hover or selection.

**M4. Side panel hint** (D). Pin the "Select a story to light up…" hint to the bottom of the panel (`margin-top: auto`), so there is no empty band of about 60 px.

**M5. First draw** (E). Defer the first canvas draw to `byline:routed` + 1 frame (the desktop 4× tab-in is 55 ms).

Acceptance:
- Screenshots of `#/map` at 1440 in Proof and Night: no overlapping labels, no single-node halos, and labelled neutral bars.
- Gates: `node test/e2e/run.mjs --only E1,E10 --route map`.
