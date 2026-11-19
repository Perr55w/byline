// Multi-step interactions shared by gates: opening/closing the dossier, toggling the rail, sampling
// running animations per frame.
import { SEL } from './selectors.mjs';
import { sleep, pageNow, setHash, waitRouted } from './browser.mjs';

/** Open the dossier from the current page (click a story link; falls back to the deep-link hash). */
export async function openDossier(page, storyId, { settle = 900 } = {}) {
  const link = page.locator(SEL.storyLink).first();
  let via = 'hash', t0;
  if (await link.count().catch(() => 0)) {
    try {
      await link.scrollIntoViewIfNeeded({ timeout: 2000 });
      await sleep(150);
      t0 = await pageNow(page);
      await link.click({ timeout: 3000, noWaitAfter: true });
      via = 'click';
    } catch { t0 = undefined; }
  }
  if (t0 === undefined) {
    if (!storyId) return { ok: false, via: 'none', t0: 0, reason: 'no story link on the page and no story id' };
    t0 = await setHash(page, `#/story/${storyId}`);
  }
  let ok = true;
  try { await page.waitForSelector(SEL.dossierPanel, { state: 'visible', timeout: 6000 }); } catch { ok = false; }
  if (settle) await sleep(settle);
  return { ok, via, t0, reason: ok ? '' : 'dossier panel never became visible' };
}

export async function closeDossier(page, { settle = 700 } = {}) {
  const t0 = await pageNow(page);
  await page.keyboard.press('Escape');
  let ok = true;
  try { await page.waitForSelector(SEL.dossierPanel, { state: 'hidden', timeout: 4000 }); } catch { ok = false; }
  if (settle) await sleep(settle);
  return { ok, t0 };
}

/** Toggle the rail programmatically (a click event on the collapse button; works under a scrim too). */
export async function toggleRail(page) {
  return page.evaluate((sel) => { const b = document.querySelector(sel); if (!b) return false; b.click(); return true; }, SEL.railCollapseBtn);
}
export async function isCollapsed(page) {
  return page.evaluate((c) => document.documentElement.classList.contains(c), SEL.railCollapsedClass);
}
/** Wait until the rail width transition has finished (byline:rail event or width stable). */
export async function waitRailSettled(page, timeout = 2500) {
  await page.waitForFunction((sel) => {
    const r = document.querySelector(sel); if (!r) return true;
    const w = r.getBoundingClientRect().width; const E = window.__e2e;
    if (E.__lastW === w) { E.__stable = (E.__stable || 0) + 1; } else { E.__stable = 0; E.__lastW = w; }
    return E.__stable >= 3 && (w === 64 || w === 232 || w === 0);
  }, SEL.rail, { timeout, polling: 100 }).catch(() => {});
}

/** Navigate by hash and wait for the routed event (if the app emits it), then settle. */
export async function switchTo(page, key, settle = 1500) {
  const t0 = await setHash(page, `#/${key}`);
  const routed = await waitRouted(page, key, t0, Math.max(settle, 3000));
  return { t0, routed };
}

/**
 * While `action` runs, sample document.getAnimations() on every frame for ms. Returns a de-duplicated list of
 * { kind, props[], target, easing, backdrop } for every animation seen.
 */
export async function sampleAnimations(page, ms, action) {
  const p = page.evaluate((ms) => {
    const seen = new Map();
    return window.__e2e.everyFrame(() => {
      for (const a of document.getAnimations()) {
        if (seen.has(a)) continue;
        const eff = a.effect; const target = eff && eff.target;
        let props = [];
        if (a.transitionProperty) props = [a.transitionProperty];
        else if (eff && eff.getKeyframes) { try { const ks = eff.getKeyframes(); props = [...new Set(ks.flatMap(k => Object.keys(k).filter(x => !['offset', 'computedOffset', 'easing', 'composite'].includes(x))))]; } catch {} }
        const timing = eff && eff.getTiming ? eff.getTiming() : {};
        let kfEasing = [];
        try { kfEasing = (eff.getKeyframes ? eff.getKeyframes() : []).map(k => k.easing).filter(e => e && e !== 'linear'); } catch {}
        seen.set(a, {
          kind: a.constructor.name, name: a.animationName || a.transitionProperty || a.id || '',
          props, target: window.__e2e.desc(target), inH1: !!(target && target.closest && target.closest('h1')),
          isH1: !!(target && target.tagName === 'H1'), easing: [timing.easing, ...kfEasing].filter(Boolean)
        });
      }
    }, ms).then(() => [...seen.values()]);
  }, ms);
  if (action) await action();
  return p;
}

/** Round 1 S18: per visible .tile on the current page, unused height under its last child (sorted, worst first). */
export async function deadInterior(page) {
  const { DEAD_INTERIOR } = await import('../gates/perf.mjs');
  return page.evaluate(DEAD_INTERIOR);
}
