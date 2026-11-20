# v4 acceptance gates: perf, motion and accessibility harness

The DECISIONS file makes council E's perf gates (E §5, gates 1–11) the acceptance tests for every builder, and adds C's motion harness (C amendment 6), D's rail rhythm assertion, F's accessibility checklist (F §5) and B's contrast test (B amendment 1). This file explains how to run them, what each one measures and what passes.

There are two parts:

| Part | Command | Runs in `npm test`? |
|---|---|---|
| Playwright harness, `test/e2e/` | `node test/e2e/run.mjs` | No. It starts a browser and its own server, and takes about 6 minutes. |
| Token contrast test, `test/contrast.test.js` | `npm test`, or `node --test test/contrast.test.js` | Yes. It runs in milliseconds with no browser. |

## Running the harness

```sh
node test/e2e/run.mjs                        # every gate
node test/e2e/run.mjs --only E1,E11          # chosen gates; ids are listed with --list
node test/e2e/run.mjs --only perf            # one group: perf | motion | a11y | shots (or e | c | f)
node test/e2e/run.mjs --only E3 --route feed,today   # gates that loop over routes check only these
node test/e2e/run.mjs --gl                   # force the WebGL2 background (?bg=gl), see "Renderer" below
node test/e2e/run.mjs --verbose              # print the detail line for every check, not just failures
```

Other options:
- `--port 4413` (the default).
- `--reuse` tests a server that is already listening on the port. Without it, a busy port is an error.
- `--timeout 240` sets the limit per gate, in seconds.
- `--no-shots` skips the screenshots.

**What it does.** It spawns `server.js` with `PORT=4413 NODE_USE_ENV_PROXY=1` and waits for `/api/status`. Then it runs each gate in its own fresh browser context and prints a table. Each row shows the scope, the check, the measured value, the limit and pass/FAIL. A failing row is followed by a `↳` line that names the cause: the worst script, the offending element, or the property.

**What it writes:**
- `test/e2e/results/latest.json`: every gate, check, value, limit, detail and note.
- `test/e2e/results/shots/*`: screenshots.
- `test/e2e/results/server.log`: the server's output.

The results folder is git-ignored.

**Exit codes:**
- `0`: every gate passed.
- `1`: at least one gate failed.
- `2`: the harness itself broke (server didn't start, browser crashed).

**Cleanup.** The server is always stopped with SIGTERM, then SIGKILL. That includes Ctrl-C, a gate timeout and an uncaught error. A pid file (`results/server.pid`) lets the next run reap a server that a crashed run left behind, but only if its command line is `server.js` and its `PORT` matches. The harness never touches anyone else's server. Each browser context closes when its gate ends, even when the gate times out.

**Instrumentation.** `lib/probe.js` is injected before any app script runs. It installs:
- a `long-animation-frame` observer (duration, `blockingDuration`, per-script `forcedStyleAndLayoutDuration`);
- a `layout-shift` observer;
- a wrapped `requestAnimationFrame` that counts the app's callbacks. The harness's own samplers use the raw rAF, so they never count as app frames.

CDP supplies CPU throttling (`Emulation.setCPUThrottlingRate`) and `Performance.getMetrics` deltas (`TaskDuration`, `LayoutCount`, `RecalcStyleCount`).

**Forced layouts** are counted from a Chrome trace. They are `Layout` events that carry a JavaScript stack (`devtools.timeline.stack`), which is the signal DevTools uses for "Forced reflow". The detail line names the file:line that forced each one.

**Devices:**
- Desktop: 1440×900 at DPR 2.
- Phone: 390×844 at DPR 3, `isMobile`, touch.
- The 4× CPU throttle applies where the council says so.

**Renderer.** Headless Chromium here has only a software GPU. The Canvas2D fallback draws on an OffscreenCanvas in a worker when the browser allows it, so E5's `TaskDuration` (main thread) measures the app, not the field's raster; `?bg2d=main` measures the main-thread fallback. With `failIfMajorPerformanceCaveat` the field correctly falls back to Canvas2D, which DECISIONS caps at 20 fps (static on phone). Gate 5's draw-rate window therefore depends on the renderer that ran:
- WebGL2: 27–32 draws/s (E's number).
- Canvas2D desktop: 15–21.
- Canvas2D phone: at most about 1 (static).

The renderer is printed with the result. `--gl` forces WebGL2 on SwiftShader to exercise the shader path.

## Contracts the harness relies on

All selectors live in `test/e2e/lib/selectors.mjs`. If the DOM changes, fix that map, not the gates.

| Contract | Used by |
|---|---|
| `window.__byline.bg.stats()` → `{ renderer, draws, hz, N, mode, frozen, running, backing }` | E4, E5, E7, E9, C-pacing |
| `?bgidle=<ms>` (idle-freeze timeout) and `?bg=gl\|2d\|off` | E4, E10, `--gl` |
| `?bg2d=main` keeps the Canvas2D field on the main thread (default: an OffscreenCanvas in `bg2d-worker.js`); `stats().offscreen` says which ran | E5 |
| `html[data-bg="full\|dim\|still"]`; `#bg` opacity .35 when dim | E5 |
| `document` event `byline:routed` `{detail:{key,page}}` after each route swap | every navigation wait (falls back to a timeout) |
| `html.rail-collapsed`, `#rail-collapse`, `.rail-nav > .rail-item` (slots), `.rail-nav > .rail-group` (dividers), `.icon` | E2, E11, C-rules |
| `#view .page.current .page-head h1` (page h1), `.ln` line spans from `enterHeading` | C-entrance, F-reduced |
| Story links `a[href^="#/story/"]` (or `[data-story-id]`) on Feed; `.dossier-panel[role=dialog][aria-modal=true]` containing one h1 | E2, E8, C-*, F-focus |
| `[data-shared]` on FLIP shared elements (exempt from appear/vanish detection) | C-entrance |
| `/api/map` payload `{ nodes[{id,x,y,…}], edges[{a,b,weight}] }`; a canvas inside `#view .page.current` on `#/map` | E10 |

## The gates

Thresholds are the council's, verbatim, unless a note says otherwise.

### Perf: council E §5 (`gates/perf.mjs`)

| Gate | Setup | Checks |
|---|---|---|
| **E1** Tab change | Phone, 4× CPU. For today, feed, map, search, calendar, studio, sources and settings: set the hash, wait 1.5 s. | Per route: longest LoAF **< 50 ms**; Σ `blockingDuration` **< 100 ms**; forced style+layout per LoAF **< 4 ms**. Plus a traced pass: forced layouts per transition **≤ 1** (DECISIONS "Router"). |
| **E2** Dossier | Desktop and phone, 4×. Open from a Feed story link (falls back to the `#/story/:id` deep link); close with Esc. On desktop, collapse and expand the rail with the dossier open, sampling every frame. | Open and close: longest LoAF **< 50 ms**. Traced: forced layouts per open **≤ 1**. During the collapse: `dossier.left − rail.right` drift **≤ 1 px**, and the minimum gap is **≥ 0** (C §6.6). Also checks that the rail really moved (≥ 100 px). Round 1 adds: rail-collapse frame p95 at 4× with the dossier open, and close frame p95 at 1×. Layouts forced by Playwright's own visibility check (`computeElementStyleVisibilityVisible`) are filtered out of the forced-layout count. |
| **E3** CLS | Desktop. Each of the 14 routes loaded fresh, 4 s each. | CLS (no recent input) **< 0.01** per route (tightened from 0.02 in council round 1, S16). |
| **E4** Idle CPU | Today `?bgidle=2000`, wait 3 s, measure 5 s, no input. | App rAF callbacks **= 0**; `TaskDuration` Δ **< 50 ms**; `LayoutCount` Δ **= 0**. |
| **E5** Ambient | Today, 5 s, no input, on desktop and on phone at 4×. Then Feed. | Draws/s in the renderer window (above); `TaskDuration` **< 250 ms** desktop / **< 500 ms** phone; `LayoutCount` Δ **= 0**; `RecalcStyleCount` Δ **≤ 2**. Feed: `#bg` opacity **.35 ± .02**, draws/s **≤ 21**. |
| **E6** Pointer | Desktop Today, 180 mouse moves zig-zagging across the tiles. | `LayoutCount` Δ **≤ 12**; long frames **= 0**. |
| **E7** Hidden + reduced | `document.hidden` overridden and `visibilitychange` dispatched; a separate context with `reducedMotion: 'reduce'`. | Hidden: draws over 2 s **= 0**. Reduced: `getAnimations().length` **= 0** 50 ms after load (C §6.6); draws over 3 s **≤ 1**; running animations **= 0** 100 ms after a route change. |
| **E8** Glass and layers | Desktop: Today, Feed, dossier open, dossier plus ⌘K (Ctrl+K). | Visible elements with a computed `backdrop-filter`: **≤ 2**, or **≤ 3** with ⌘K over the dossier. Animations whose keyframes or transition include `backdrop-filter` or `--frost`: **0**. Permanent `will-change` at rest: **≤ 4** elements (listed); round 1 checks this on every route. |
| **E9** Canvas backing | Desktop and phone. | `#bg` w×h **≤ 2.4e6** desktop, **≤ 0.6e6** phone; `width / innerWidth` **≤ 1.5** at DPR 3. Round 1 (S13a) also checks, on all 14 routes in both themes, that the canvas CSS width equals the viewport and the backing store is `round(W × scale)` within the pixel cap. |
| **E10** Map | `/api/map` intercepted with a 500-node fixture: the real nodes cloned with jittered positions and remapped edges. It is test-only and never shown as data. `?bgidle=1000`. Desktop 1×: 60 wheel events, then a 1 s drag. Phone 4×: wheels plus a touch drag. | Desktop frame interval p95 **≤ 20 ms**. Phone longest LoAF **< 50 ms**. App rAF callbacks in a 1 s window starting 3 s after release **= 0**. |
| **E11** Rail rhythm, with D §1's assertion | 1440×900 and 1280×800. Collapse the rail and wait until its width is stable. | Rail 64 px. Every slot 32 ± .5 and every divider 4 ± .5. Pitch 36 within a group and 44 across a divider. Divider gaps 4 / 4. Distinct pitch set **= {36, 44}**. Every icon centre x = rail centre x ± .5. |
| **E12** Rail collapse pacing (round 1, S1) | Today and Feed, desktop. Collapse and expand the rail, sampling every frame, at 1× and 4×. | Frame p95 **≤ 33 ms** at 1× and **≤ 50 ms** at 4×; style recalc per collapse **≤ 30 ms** at 1×. |
| **E13** Dead interior (round 1, S18) | 1440×900 and 1280×800 on today, performance, career, employers, people, campaigns, calendar and studio (`deadInterior()` in `lib/flows.mjs`). | Per `.tile`: unused height under the last in-flow child **≤ 32 px**. Absolutely positioned children are ignored, and the Map stage (`#map-stage`, a stack of positioned layers) is skipped. |

### Motion: council C §6.6 plus the DECISIONS bans (`gates/motion.mjs`)

| Gate | Checks |
|---|---|
| **C-entrance** | An in-page sampler runs on every frame during four scenarios: Today first load (from `DOMContentLoaded`, 3.2 s), Today→Feed, dossier open and dossier close. **The h1 layout height never changes (≤ 1 px) and only one line count is seen** (this catches Edition's re-wrap). **No element's effective opacity changes by > 0.35 per frame.** That covers elements inside `#view` and `.topbar`, plus `.dossier` in the dossier scenarios, including ones that appear at full opacity or disappear while visible. In-place changes are normalised to one 60 Hz vsync (raw change ÷ (frame time / 16.7 ms)), so a dropped frame is not mistaken for a snap; C measured the Instrument snap on a 50 ms grid. The largest raw change and its frame time are printed. Appear and vanish at full opacity always count. Only elements that paint something themselves count for appear/vanish (own text, media, fill, border, shadow), so a bare container whose children carry the fade doesn't. `visibility:hidden` elements are skipped, because hiding the FLIP source is intended. `[data-shared]` and the dossier frame layers are exempt only from appear/vanish detection. A self-check confirmed it catches a 0→1 snap, an element appearing or vanishing at full opacity, and an h1 re-wrap, while a 400 ms fade passes. |
| **C-pacing** | Over 3 s of drift, the gap in vsyncs between background draws. The share of gaps **> N** must be **< 5%**, and there must be **no gaps < N**. N is `bg.stats().N` for WebGL2 (2 at 60 Hz). For Canvas2D it is max(N, hz/20) = 3, because bg.js's loop caps Canvas2D at 20 fps (its `N2`) while `stats().N` doesn't report that cap. A timestamp gate (`now − last ≥ 33`) fails this. |
| **C-rules** | `cubic-bezier(.16,1,.3,1)` must appear in **no loaded CSS/JS file or inline style** and in **no live animation**. Animations sampled during a tab switch, the dossier opening, the rail collapsing with the dossier open, and a theme switch must not animate layout properties: `left/top/right/bottom/width/height`, margins, padding, font-size, `gap`, `backdrop-filter`, `--frost`, or `transition: all`. `filter`, `letter-spacing`, `font-variation-settings` and `font-weight` may animate only on an h1. `--rail-w`, `--grp-h`, `--hl-i`, `--hl-g` and `--ring-p` are allowed. Any other animated custom property is listed for review. |
| **C-theme** (round 1, S7) | Theme switch in both directions: text/surface contrast **≥ 3:1** sampled at 100, 300 and 500 ms after the switch; frame p95 **≤ 33 ms** at 1×. The lowest single frame (at the ink swap) is printed for information. |
| **C-flight** (round 1, S2–S4) | Route swap: the two page h1s never sum above **1.2** opacity. Dossier flight: inside the panel clip the fill is **≥ .94** opaque on every frame, the scrim reaches **≥ .6** within 120 ms, and the first motion lands ≤ 1 frame after the click. |

C's remaining assertions run inside the perf gates: tab-switch long tasks at 4× in E1, `dossier.left ≥ rail.right` in E2, and `getAnimations()` under reduced motion in E7.

### Accessibility: council F §5, the automatable part (`gates/a11y.mjs`)

| Gate | Checks |
|---|---|
| **F-contrast** | Every visible element with its own text, on all 14 routes, in Proof and Night. Text colour × effective opacity is composited over the stacked ancestor backgrounds down to `--bg`. It must reach **≥ 4.5:1**, or **≥ 3:1** for large text (≥ 24 px, or ≥ 18.66 px bold). Disabled controls and invisible (opacity < .1) text are skipped. Text runs with no letter or digit (lone `·`, `/`, `—` separators) are reported in a note rather than failed. The canvas field is ignored; F's "worst case over the brightest ripple" is not modelled. It takes one screenshot per route and theme. |
| **F-structure** | On every route: exactly **one h1** outside modal dialogs, and it has text. Every focusable control has an **accessible name**: aria-labelledby, aria-label, `<label>`, text, `alt` or SVG `<title>`. The active nav item has `aria-current="page"`. Shell: `html[lang]`, one `<main id="main">`, the **first tab stop is the skip link to `#main`**, and every visible nav has a label. Notes list placeholder-only names and focusable controls at opacity 0. |
| **F-focus** | The first 24 tab stops on Feed each show a visible focus change: an outline, or a box-shadow, background, border or position (the skip link slides in) that differs from rest. At least one story row/link on Feed must be keyboard-focusable. The dossier opened with the keyboard (focus a story link, Enter) must be `role="dialog"` with `aria-modal="true"` and an accessible name, contain one h1 and receive focus. 30 Tab presses must not leave it. Esc closes it and focus returns to the opener. |
| **F-reduced** | Under `prefers-reduced-motion`, 60 ms after the route swap on Today and Feed, the h1 has effective opacity 1, no `filter`, and no `.ln` line spans. |

### Contrast unit test: council B amendment 1 (`test/contrast.test.js`)

The test parses the top-level rules of `public/css/v4/tokens.css`: `:root, [data-theme=proof]` for Proof, and `[data-theme=night]` layered over Proof for Night. It resolves `var()` and composites translucent tokens over `--bg`. In both themes it asserts:
- `--text-1/2/3` and `--accent-text` reach **≥ 4.5:1** on `--bg`, `--surface-solid`, `--raised`, `--inset`, `--surface` and `--surface-glass-strong`.
- `--accent`, the focus ring (`--focus-c`), `--line-ctl` and `--q-0…5` reach **≥ 3:1** on `--surface-solid`.
- `--on-accent` reaches **≥ 4.5:1** on `--accent` (Proof) and `--accent-fill` (both themes), and `--q-on5` does too on `--q-5`.

If `tokens.css` is missing, the theme tests are skipped with a message.

### Screenshots (`shots`, informational)

`today-proof.png`, `today-night.png`, `feed-proof.png`, `dossier-proof.png`, `dossier-rail-collapsed-proof.png` and `today-phone.png`, plus the per-route JPEGs from F-contrast. All are in `test/e2e/results/shots/`.

## Reading a failure

- **rAF rows** (E4, E10) name the call site that requested each frame while the page should be idle, for example `12× loop (/js/bg.js:384)`.
- **LoAF rows** name the longest script in the worst frame and the forced layout inside it, for example `Response.json.then /js/api.js 89ms (forced 65)`. That one means a view's render forces layout inside the fetch continuation.
- **Forced-layout rows** name `file:line function` for each forced reflow.
- **Opacity rows** name the element, the from→to values and whether it changed in place, appeared or vanished.
- **CLS rows** name the shifted nodes.
- **Whitelist rows** name the property, the element and the interaction.

## Known limits

- The numbers come from headless Chromium on a software GPU. Main-thread and layout numbers carry over; absolute frame rates are pessimistic. E said the same about its own measurements.
- **E8's ⌘K case** counts only if Ctrl+K opens something over the dossier. Otherwise it is noted as not measured.
- **C-entrance** samples about 400 elements per frame with `getComputedStyle`. That costs time, so it runs on its own (no throttle) and never alongside the perf measurements.
- **Contrast** ignores background images and gradients behind text (the detail flags them) and the canvas field.

## Integration notes (v4 integrator)

- **E4 timing.** bg.js now finishes its 1200 ms freeze ease *inside* the idle window (fully at rest `bgidle` ms after the last input), and programmatic changes (`setHeat`, `pulse`, `setRail`) no longer restart the idle clock; they run the loop only until their tween settles. Chrome's zero-movement synthetic `pointermove` (sent when layout changes under a resting cursor) is not treated as input.
- **F-structure `aria-current`.** Sub-routes map to their tab: `draft/:id` → Studio, `person/:id` → People, `employers/:id` → Employers.
- **Stylesheets.** Every tab stylesheet is linked in `index.html`; `useStyle()` resolves at once. Inserting a stylesheet at route time restyled the whole document inside the tab switch (E1).
