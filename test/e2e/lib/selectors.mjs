// Every DOM contract the harness depends on, in one place. The app is being rebuilt in parallel, so when a
// selector drifts, fix it HERE (and note it in docs/design/GATES-v4.md), not in the gates.
// Sources: public/index.html, public/js/app.js, public/js/dossier.js, public/js/bg.js, DECISIONS-v4.md.
export const SEL = {
  // shell
  rail: '#rail, nav.rail',
  railNav: '#rail-nav, .rail-nav',
  railSlot: '.rail-nav > .rail-item',            // D §1 icon slots (32px)
  railDivider: '.rail-nav > .rail-group',         // D §1 group label rows → 4px dividers when collapsed
  railIcon: '.icon',                              // inside a slot
  railCollapseBtn: '#rail-collapse',
  railCollapsedClass: 'rail-collapsed',           // on <html>
  main: '#main',
  view: '#view',
  page: '#view .page.current',
  pageH1: '#view .page.current .page-head h1, #view .page.current h1',
  pageHeadItems: '.page-head > *, .page-head h1 .ln',
  skeleton: '.skeleton-page, .sk',
  statusPill: '#status-pill, .status-pill',
  cmdk: 'button.cmdk, [data-open-index]',
  bgCanvas: '#bg',
  bgLight: '#bg-light',
  skipLink: 'a.skip-link, a[href="#main"]',
  primaryNav: 'nav[aria-label]',
  // dossier (overlay, DECISIONS "Router")
  storyLink: '#view .page.current a[href^="#/story/"], #view .page.current [data-href^="#/story/"], #view .page.current [data-story-id]',
  dossierRoot: '.dossier',
  dossierPanel: '.dossier-panel, .dossier [role="dialog"]',
  dossierH1: '.dossier-panel h1, .dossier [role="dialog"] h1',
  // index (⌘K) — a modal that may stack over the dossier (glass budget 3)
  indexDialog: '.index, .index-menu, [role="dialog"][aria-label*="Index" i], .cmdk-dialog',
  // map
  mapCanvas: '#view .page.current canvas:not(#bg)',
  // elements sampled for opacity jumps (C amendment 6)
  opacitySample: 'h1, h1 .ln, h2, h3, p, li, tr, .tile, .row, .chip, .pill, .glass-pill, .score-ring, .page-head > *, [data-dossier-section], .dossier-panel, .page',
};

// Routes (hash keys) — E §5 gate 1 list, and the full rail for CLS / a11y.
export const GATE1_ROUTES = ['today', 'feed', 'map', 'search', 'calendar', 'studio', 'sources', 'settings'];
export const ALL_ROUTES = ['today', 'feed', 'map', 'search', 'studio', 'calendar', 'campaigns', 'performance', 'career', 'employers', 'people', 'sources', 'runs', 'settings'];

// Viewports (E §5 shared setup)
export const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false };
export const DESKTOP_1280 = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false };
export const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
