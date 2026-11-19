# Byline v4: build spec

Source of truth for every builder and critic. Inputs:
- `docs/design/BRIEF-v4.md`: questionnaire answers.
- `docs/mockups-v4/{instrument,glass-atlas,edition}.html`: three mockups the user graded tab by tab. The grades are below.
- This file. Where it conflicts with the brief or the mockups, this file wins.

Branch `v4`. Vanilla ES modules, no build step, zero runtime deps, Node 22 server, $0. Real data only, from the existing API. Never invent numbers; if a figure isn't in the data, don't show it.

---

## 0. The user's grades of the mockups (what to keep, what to fix)

| Area | Instrument (A) | Glass Atlas (B) | Edition (C) |
|---|---|---|---|
| Left rail | **76**: group names, sliding highlight and click animation all liked. **Collapsed: icon spacing uneven, with big gaps every 2–3 groups.** | 68: poor logo; dividers don't explain the grouping | 67: same as B, plus "Next edition" footer is unnecessary |
| Today | **78–80**: liked issue number, date, informative headline and one-liner, reactive background, section/background contrast, hover hue. **Unclear mini bar graph next to the run light.** | 76–77: liked the glass "bubble" status pill, topic pills with main topic in blue, score ring concept (**remove threshold tick; use a colour gradient for quality**), top-3 list on the news map. Headline and one-liner too vague. Background choppy. News map needs to become a real map. | 75: did little differently. Liked the one-liner, the "why it ranked" bullets, the hover hue (could be slightly stronger) and the **News weather** chart. The bar under the score is unnecessary. |
| Dossier | 75: **big empty space right of the sources list** | **80**: liked that it doesn't fill the screen and aligns with the rail's height, the scoring view, the spacing, and the evidence sections with highlighted topics. **Rail collapse slid under the dossier instead of the dossier adapting.** Not every component should be weighted equally. | 72: evidence poorly worded and organised |
| Feed | 75: background too visible and distracting | **85**: liked the source list with independent / not, the plain score, top two topics, and a background that doesn't interfere. Headline and one-liner add nothing. Open to experiments with the score area. | 70: bare numbers next to items are useless; topics hard to see; weak size difference between headline and meta |
| Search | **80**: big search bar, quick-search chips | fail: no search | 50: content useless |
| Calendar | **35**: only one week, odd cards, gap between day and date, lots of unused space | – | – |
| Settings / Sources | 70: works; wants more information on sources | – | Sources **25** |
| Heading entrance | **Disliked**: feels rushed; the scan line appears and disappears abruptly instead of fading | – | – |

Across all three:
- Left rail with icons and group names.
- Light themes preferred, in the order Edition, then Glass, then Instrument.
- The dossier concept works, but it needs more summary of what each source actually said.
- The logo/favicon must be far less generic, and one must exist.

---

## 1. Identity

- **Default theme: Proof (light).** Night is the alternative. Switch in the rail footer and in the ⌘K Index. Persist in `localStorage['byline-theme']`. A pre-paint script sets `data-theme` before first paint.
- **Proof (light)** is Edition's calm, clean white and big Newsreader, with Glass's frosted surfaces used with restraint:
  - The status pill, the rail, the dossier panel and hover states are glass.
  - Story tiles are near-solid white with a slight translucency so the background shows faintly. Legibility first.
- **Night** is Instrument's true neutral graphite (no brown, no pure black), with tinted-glass versions of the same surfaces.
- **Accent: electric blue.** One house palette; no employer brand colours.
- **Quality scale** (replaces threshold ticks and bars). One continuous colour ramp from score to colour, defined once as CSS custom properties and a JS helper `qualityColor(score, threshold)`:
  - Below threshold: neutral greys warming toward a muted slate.
  - At and above threshold: ramps into electric blue.
  - Top scores (threshold + 15 and up): a deeper, more saturated blue with a subtle glow.
  - Use it for score rings, Feed score chips, map nodes and calendar post chips.
  - It must be distinguishable without colour alone: ring fill fraction or a text label also changes.
- **Type:**
  - Newsreader (variable, opsz) for headlines and story titles.
  - A precise UI sans and a mono, self-hosted as woff2 in `public/fonts/`, with no CDN at runtime. Use Geist and Geist Mono (OFL), or the council's pick. Update `public/fonts/LICENSE.md`.
  - Drop Schibsted and Martian.
- **Logo:** a new, distinctive Byline mark that is not a generic monogram, dot grid or concentric circle. It must:
  - work at 16px (favicon) and 512px (PWA icon);
  - exist as SVG plus the regenerated PNGs in `public/icons/`, with the manifest and apple-touch-icon updated;
  - have a lockup with the "Byline" wordmark in Newsreader in the rail, and a mark-only version when the rail is collapsed.

  The council proposes concepts. Direction: something only Byline would have, e.g. the byline itself (a writer's attribution line), a nib, a score arc, a signal passing a threshold.

## 2. Shell

- **Left rail** (Instrument's base, fixed):
  - Icons plus labels, grouped under small uppercase group names.
  - Sliding active highlight; press animation on click.
  - Collapse with the `[` key or the button; state persisted.
- **Collapsed rail: one constant vertical rhythm.** Every icon slot is the same height with the same gap. Groups are separated by identical short hairline dividers of fixed height, each taking exactly one standard gap. No variable gaps anywhere. Write a test or a Playwright assertion that measures it.
- **Groups.** Each group name must explain itself:
  - **Briefing:** Today, Feed, Map (new), Search
  - **Publish:** Studio, Calendar, Campaigns, Performance
  - **Career:** Career, Employers, People
  - **System:** Sources, Runs, Settings

  There is no "next edition" footer. The footer holds only the theme switch, the collapse button and a tiny engine/LinkedIn status line.
- **Content area:** collapsing the rail must reflow the content area and any open dossier panel. Animate the width; nothing may slide under anything.
- **Top of every page:**
  - A glass status pill reading "No. 323 · Wed 18 Nov · ● Ran 7:02 AM · 19 scanned · 5 post-worthy". Every figure comes from `/api/status` and `/api/today`.
  - No unlabelled graphs. If a sparkline is kept, it carries a visible label and a tooltip ("Scores of today's 19 stories").
  - The ⌘K Index trigger sits top right.
- **Every tab's headline and one-liner are data, not mood.** The headline is a finding ("Agent orchestration is running hot."). The one-liner gives numbers ("5 of 19 scanned stories cleared your threshold of 60. Agent orchestration is in 4 of them; Business adoption in 2."). Vague lines such as "Five stories cleared the bar. One leads." fail review.
- **Phone:**
  - Bottom bar with Today, Feed, Map, Studio and More (a sheet holding the rest).
  - Tiles stack.
  - The dossier becomes a full-height sheet.

## 3. Background

- **One fixed canvas behind everything.**
  - An ambient, mouse-independent motion: slow light ripples or waves across a fine dot or line field. It must be smooth; Glass was choppy, so this is a must-fix.
  - A soft light that follows the pointer: Glass's light reaction, not a cursor trail.
  - Where topics are hot, the field is slightly denser or brighter, so it doubles as a faint news weather layer on Today.
- **Intensity per view.** Full on Today and Map. Dimmed to about 35% on reading views (Feed, Search, the dossier, Studio, Settings, tables) so it never competes with text. Feed in Instrument failed on this.
- **Budget:**
  - 60fps, with DPR capped at 1.5.
  - About 30fps while only drifting.
  - Paused when the document is hidden.
  - Frozen after 20s idle; resumes on input.
  - A static frame under reduced motion.
  - Phone runs lighter and at lower resolution.
  - Canvas2D, or WebGL2 with a Canvas2D fallback.
- **Sections sit clearly above the background:**
  - A slight fill difference plus a hairline border.
  - On hover, a blue-tinted hue that is slightly stronger than Edition's, emphasised by the background light pooling under the hovered tile.

## 4. Motion

Fluid first, cinematic second. Calm at rest.

- **Heading entrance (new):**
  - Must not feel rushed or abrupt. Every element fades in; nothing hard-cuts.
  - Recommended starting point: Edition's "optical settle" (opsz, weight and tracking easing into the display cut while blur clears), stretched to about 900–1100ms with long-tail easing.
  - Any light sweep fades in and out with soft edges.
  - On tab switches it may be shorter (about 600ms) but never abrupt.
  - The C and E critics approve the final version.
- **Load:** skeleton shaped exactly like the page (about 300–400ms), then tiles resolve in a choreographed sequence, then stillness. On Today, Instrument's "tiles resolve out of the map" is allowed if smooth.
- **Tab switch:** the old view fades and drifts out (about 220ms), the new view settles in (about 450ms) with a short stagger. Use DOM classes with transform and opacity; no full-page view transition (the old freeze lesson).
- **Dossier:** a shared-element expansion from the tile or Feed row into a floating panel. The panel is inset to match the rail's top and bottom, and does not fill the screen. Esc reverses it.
- **Scores:** count up with an exponential ease-out that visibly slows near the final value. The score ring fill uses the same curve. Colour comes from the quality ramp.
- **Hover:** subtle lift and hue change; precise, not bouncy.
- **Reduced motion:** final states immediately, everywhere.

## 5. Tabs

Each tab is graded on its own. "Low-designed" placeholder tabs are what sank Glass and Edition, so every tab must have meaningful content from the API.

### Today (`today.js`)
Base on Instrument's Today (the user's top-rated), adding:
- **Lead tile:**
  - Topic pills, main topic in blue (from Glass).
  - Newsreader title.
  - "Why it ranked" as three plain-language bullets (from Edition), built from `explanation` and `breakdown_json`.
  - Score ring with quality-ramp colour and no threshold tick.
  - Source count: "6 sources · 1 independent". Open dossier.
- **Two or three secondary story tiles,** sized by importance.
- **News weather tile:** Edition's chart, one dot per story on a score axis per topic, with HOT, WARM and CALM labels.
- **Map tile:** a live mini version of the Map tab with the top-3 topics list (from Glass). Clicking it opens Map.
- **This week:** scheduled posts and the posting cadence against the goal (3 a week). No ellipsis truncation of important titles; wrap to two lines.
- **Removed:** the voice briefing (the `player.js` UI, its CSS and its Today slot).

### Story dossier (`#/story/:id`, `feed.js` or a new `dossier.js`)
Base on Glass's dossier (80):
- A floating panel aligned to the rail's top and bottom. It adapts when the rail collapses.
- **What the sources say (new, required):** for each article, domain, kind (primary, independent, commentary), date, a 1–2 sentence summary (`articles.summary`) and its extracted claims (`claims.text`). Numbers in claims are highlighted.
- **Evidence:** organised and plainly worded, grouped into "Matches your priorities", "On your watchlist", "Practical signals" and "Why it's post-worthy". Important topics are highlighted.
- **Who it matters to / What it could change / What to test:** from `lens_json`.
- **Score breakdown:** the real components and weights from `src/pipeline.js`: interest 35%, evidence 25%, novelty 20%, impact 20%, then the recency multiplier and preference multipliers. Show each component's contribution and maximum, so unequal weights are visible. Colour comes from the quality ramp.
- **No dead whitespace.** The layout fills its width with balanced columns, e.g. a two-column body of sources plus claims on the left and score plus lens plus actions on the right.
- **Actions:** Draft a post (Studio), Save, Dismiss.

### Feed (`feed.js`)
Base on Glass's Feed (85):
- Rows show title (clear size step above the meta), sources with an independent / commentary marker, the score (try a quality-ramp chip or a soft score-coloured backing), and the top two topics clearly legible.
- A threshold divider.
- No bare numeric IDs.
- Filters: topic, min score, date range. Sort: score or newest. "Add story URL" stays.
- Headline and one-liner give numbers, e.g. "12 stories this week. 5 above 60; 3 new since yesterday."

### Map (new tab, `map.js`, plus a server endpoint if needed)
The user's explicit direction: a clickable map that connects older stories and related information and groups them visually.
- A graph of stories from `/api/stories` across all dates (older ones included). Nodes are stories, sized by score and coloured by the quality ramp. Clusters are topics, as soft labelled regions. Edges connect shared companies, shared watchlist hits and shared sources, with similarity weight.
- A force layout with a deterministic seed, computed once and cached, with smooth zoom and pan.
- **Interactions:**
  - Hover shows a node card.
  - Click selects and lights the node's connections, with a side panel listing related stories in time order.
  - "Open dossier".
  - Topic filter chips and a time slider (7d, 30d, all).
- The top-3 hot topics list (from Glass) sits in the side panel.
- Performance: Canvas2D for the graph, DOM for labels and cards. Smooth at 200+ nodes.
- If the server needs it, add `GET /api/map` in a new `src/routes/map.js`, registered in `server.js`. It returns nodes and edges with precomputed similarity. Add a test.

### Search (`search.js`, the "Archive")
Base on Instrument's Search (80):
- A large search bar, autofocused.
- Quick-search chips (top topics, watchlist questions, employers).
- Real results from `/api/search` (stories, drafts, notes, contacts), grouped by type, with highlighted matches, filters and keyboard navigation.
- Recent searches, persisted locally.
- No filler analytics.

### Calendar (`calendar.js`)
Rebuilt; it scored 35.
- Month grid as the default: compact day cells with day number and post chips (channel icon, title, status, quality colour), with no gap between day name and date.
- Toggle to a week view with time rows.
- A side panel shows the selected day's details plus an **Unscheduled drafts** tray. Drag a draft onto a day to schedule it, with an optimistic update and undo (existing API: `POST /api/drafts/:id/schedule`).
- A cadence meter: posts per week against the goal of 3.
- No empty space larger than one day cell. Use the existing `/api/calendar`.

### Sources (`sources.js`)
Rebuilt; it scored 25. A rich table or cards:
- Name, group, kind or credibility, enabled toggle, last sync, articles fetched, stories contributed, and a health dot (ok, stale, error).
- Sync now.
- Expand a row to see recent articles.
- Add source.
- A summary header with numbers ("16 sources · 14 healthy · 2 stale · 41 articles this week").

### Settings (`settings.js`)
Functional (70). Restyle to v4 with clear sections and keep all existing features. Add a source-health summary that links to Sources. Remove the TTS/voice settings section.

### Studio, Campaigns, Performance, Career, Employers, People, Runs
Restyle fully to v4 with no placeholder feel:
- Each needs a data headline and one-liner, and real content density appropriate to the tab.
- Studio is a distinct workshop space: same palette, but a focused writing surface with fewer chrome elements and the background dimmed.
- Keep all existing functions (hold-to-publish, approvals, versions, notes, outreach and so on). Restyle them, don't drop them.

## 6. Engineering rules

- Keep `public/js/api.js` and the `ui.js` helpers (`toast`, `modal`, `optimistic`, `act`, `strikeOut`, `countUp` and the others) working, restyled to v4. Builders may add helpers to `ui.js` only through the foundation owner (the coordinator).
- **Remove:**
  - All newspaper-era fx: ink, flap, halftone plates, newsprint grain, press band, stamps and spatter, the live dot screen, the theme dither wipe.
  - `player.js` and its CSS.
  - Old CSS files that are no longer referenced.

  Keep `holdToPress` (restyled) and `lattice` only if they fit.
- **CSS:**
  - `public/css/v4/tokens.css`, `shell.css`, `components.css`, plus one file per tab (`today.css`, `feed.css`, `map.css` and so on).
  - Tokens are defined once.
  - No literal colours outside `tokens.css`.
- **Service worker:** update the `SHELL` list, bump to `byline-shell-v6`.
- **Tests:** `npm test` must stay green. Add tests for any new endpoint.
- **Accessibility:**
  - Visible focus.
  - AA contrast in both themes.
  - Every interactive element reachable by keyboard.
  - Meaningful headings.
- **Performance:**
  - Long frames under 50ms on tab change at 4× CPU throttle on phone.
  - No forced layout in render loops.
- **Real data:** no invented metrics. If a field is missing, design an honest empty state.

## 7. Bar

The council grades as before. Positives: unique_typography, color_cohesion, theme_cohesion, motion_cohesion, motion_smoothness. Negatives: generic_typography, background_generic, color_combo_generic, motion_generic, ai_slop. To pass:
- overall ≥ 38
- every positive ≥ 8
- every negative ≤ 2

Critics also score each tab out of 100 the way the user does. **Target: every tab ≥ 85, Today and the dossier ≥ 90.**
