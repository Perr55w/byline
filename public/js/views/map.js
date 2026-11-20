// Map (SPEC §5 Map, DECISIONS "Map engine", F §2 Map template, F §5 Map accessibility, B amendment 6).
// Every story as a node on the server's seeded layout (GET /api/map), connected by shared companies,
// watchlist hits, sources and topics; topic regions drawn as soft isobars. Real data only: every figure
// on this page is read from the payload (threshold included).
//
// Layout: page head (F template) · toolbar (topic chips, 7d/30d/all radiogroup) · stage (canvas + DOM
// labels + hover card + keyboard twin listbox, or the List view) | side panel (top-3 hot topics, the
// selected story, its related stories oldest → newest with reason chips; the biggest bridge by default).
// Keyboard (focus the map): arrows nearest node · Alt+arrows pan · Enter select · O / Shift+Enter open the
// dossier · + / − zoom · 0 reset · Esc clear.

import { api } from '../api.js';
import { html, raw, esc, icon, scoreChip, demoFlag, useStyle, toast } from '../ui.js';
import { enterItems, reduced } from '../motion.js';
import { qualityColor, qualityTier } from '../quality.js';
import bg from '../bg.js';
import { loadMap, mountMap, shortTitle } from '../map-engine.js';

// ---------------------------------------------------------------- formatting (times in settings.timezone)
const tz = () => window.__byline?.timezone || undefined;
// one Intl.DateTimeFormat per (options, zone): toLocaleDateString builds a new formatter per call, which cost
// ~14 ms of the Map's first render at phone 4× (19 nodes × twin, list, counts)
const FMTS = new Map();
const fmt = (iso, o) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return '';
  const key = JSON.stringify(o) + (tz() || '');
  let f = FMTS.get(key);
  if (!f) { try { f = new Intl.DateTimeFormat('en-GB', { ...o, timeZone: tz() }); } catch (e) { f = new Intl.DateTimeFormat('en-GB', o); } FMTS.set(key, f); }
  return f.format(d);
};
const day = (iso) => fmt(iso, { day: 'numeric', month: 'short', year: 'numeric' });
const dayShort = (iso) => fmt(iso, { day: 'numeric', month: 'short' });
const month = (iso) => fmt(iso, { month: 'short', year: 'numeric' });
const yearOf = (iso) => fmt(iso, { year: 'numeric' });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ts = (iso) => Date.parse(iso || '') || 0;
const TYPE = { topics: 'topics', watchlist: 'watchlist hits', sources: 'sources', companies: 'companies' };
const joinList = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
/** The edge types a story bridges: [[type, links]] by how many of its links carry each (round-1 M6). */
function bridgeTypes(d, id) {
  const c = { topics: 0, watchlist: 0, sources: 0, companies: 0 };
  for (const e of d.edges || []) {
    if (String(e.a) !== String(id) && String(e.b) !== String(id)) continue;
    for (const k of Object.keys(c)) if (e.reasons?.[k]?.length) c[k]++;
  }
  return Object.entries(c).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
}
const typesPhrase = (types) => joinList(types.slice(0, 3).map(([k, n]) => `${TYPE[k]} (${n})`));
const RANGES = [['7d', '7 days', 7], ['30d', '30 days', 30], ['all', 'All', null]];

// Start loading the stylesheet as soon as the module is imported (the shell idle-imports every view), so
// arriving on the Map never restyles the whole document mid-transition. All rules are .map-* scoped.
useStyle('/css/v4/map.css');
// document scroll offset, kept from scroll events (window.scrollY forces a layout when read inside a render task;
// the shell imports this module while idle, so the first read here is free)
let SY = 0;
try { SY = window.scrollY; addEventListener('scroll', () => { SY = window.scrollY; }, { passive: true }); } catch (e) { /* no window */ }

/** Text with number highlights ([start, end) UTF-16 pairs from the server), escaped slice by slice. */
function marked(text, marks) {
  const t = String(text || '');
  if (!Array.isArray(marks) || !marks.length) return esc(t);
  let out = '', at = 0;
  for (const [a, b] of marks) { if (a < at || b > t.length) continue; out += esc(t.slice(at, a)) + `<mark class="num-hl">${esc(t.slice(a, b))}</mark>`; at = b; }
  return out + esc(t.slice(at));
}

// ---------------------------------------------------------------- F §2 Map headline + one-liner
function headline(d) {
  const nodes = d.nodes || [], N = nodes.length, E = (d.edges || []).length;
  if (N < 5) return { h: html`Too few stories to map yet (${N}).`, l: html`The map fills in as runs collect more.` };
  const tc = (d.topic_counts || []).filter(t => t && t.topic);
  const elig = tc.filter(t => (t.weight ?? 1) > 1);
  const top = (elig.length ? elig : tc).slice().sort((a, b) => b.count * (b.weight ?? 1) - a.count * (a.weight ?? 1))[0];
  const h = top ? html`${top.topic} links ${top.count} of ${N} stories.` : html`${N} stories, ${plural(E, 'connection')}.`;
  const lo = d.range?.first_seen_min, hi = d.range?.first_seen_max;
  const span = lo && hi ? html` from ${month(lo)} to ${month(hi)}` : '';
  const br = d.bridge;
  const bn = br ? nodes.find(n => String(n.id) === String(br.id)) : null;
  const types = br ? bridgeTypes(d, br.id) : [];
  // the bridge's short title (before its first ':', ' — ' or ','), and the link types it carries, by count
  const bt = shortTitle(bn?.title || br?.short_title || '', { max: 60, always: true });
  const bridge = br && E && br.degree && bt
    ? html` Biggest bridge: <b>${bt}</b> connects <b>${br.degree}</b> stories through shared ${types.length ? typesPhrase(types) : (TYPE[br.via] || 'features')}.`
    : '';
  const l = E ? html`<b>${N}</b> stories${span}, <b>${E}</b> connections.${bridge}` : html`<b>${N}</b> stories${span}, no connections yet.`;
  return { h, l };
}

// sprite glyphs (index.html)
const G = { minus: icon('minus'), fit: icon('fit'), list: icon('list') };

// ---------------------------------------------------------------- reason chips (why two stories are linked)
function reasonChips(reasons, max = 2) {
  if (!reasons) return '';
  const all = [
    ...(reasons.companies || []).map(v => ['company', v]),
    ...(reasons.watchlist || []).map(v => ['watchlist', v]),
    ...(reasons.sources || []).map(v => ['source', v]),
    ...(reasons.topics || []).map(v => ['topic', v])
  ];
  if (!all.length) return '';
  const shown = all.slice(0, max);
  return html`<span class="map-why-list">${shown.map(([k, v]) => html`<span class="map-why" title="${`Shared ${k}: ${v}`}"><i>${k}</i><span>${v}</span></span>`)}${all.length > max ? html`<span class="map-why map-why--more">+${all.length - max}</span>` : ''}</span>`;
}

// ---------------------------------------------------------------- render
export async function render(page) {
  await useStyle('/css/v4/map.css');
  let { data, fresh } = loadMap();
  if (!data) {
    try { data = await fresh; fresh = Promise.resolve(null); } catch (e) {
      page.innerHTML = String(html`<div class="page-head"><p class="eyebrow">Story map</p><h1>The map didn’t load.</h1><p class="lede">${e.message}</p></div>
        <div class="empty"><h3>Nothing to draw yet</h3><p>The map is built from every story the pipeline has ranked. Try again, or browse the same stories in the Feed.</p><div class="cluster"><a class="btn btn--secondary" href="#/map" data-retry>Try again</a><a class="btn btn--ghost" href="#/feed">Open the Feed</a></div></div>`);
      page.querySelector('[data-retry]')?.addEventListener('click', (ev) => { ev.preventDefault(); location.reload(); });
      return;
    }
  }
  const view = new MapView(page, data);
  view.mount();
  // round-1 M7: the page lays out in its own frame before the engine and side panel are built, so neither the shell's
  // layout nor the engine's setup has to share one frame with the other (E1 at phone 4×)
  await new Promise((r) => { if (document.hidden) setTimeout(r, 0); else requestAnimationFrame(() => setTimeout(r, 0)); });
  if (!view.alive || !page.isConnected) return;
  view.mountRest();
  fresh.then((d) => { if (d && view.alive) view.update(d); }).catch(() => {});
}

class MapView {
  constructor(page, data) {
    this.page = page;
    this.data = data;
    this.alive = true;
    this.topics = new Set();
    this.range = 'all';
    this.sel = null;
    this.cursor = null;
    this.list = false;
    try { this.list = localStorage.getItem('byline-map-list') === '1'; } catch (e) { /* storage unavailable */ }
  }

  get th() { return this.data.threshold ?? window.__byline?.threshold ?? 55; }
  get nodes() { return this.data.nodes || []; }

  // -------------------------------------------------------------- markup
  shell() {
    const d = this.data, N = this.nodes.length;
    const { h, l } = headline(d);
    const tc = (d.topic_counts || []).filter(t => t.topic).slice().sort((a, b) => b.count * (b.weight ?? 1) - a.count * (a.weight ?? 1)).filter((t, i) => i < 3 || t.count >= 2).slice(0, 7);
    const counts = Object.fromEntries(RANGES.map(([k, , days]) => [k, days ? this.nodes.filter(n => Date.now() - ts(n.first_seen) <= days * 864e5).length : N]));
    const th = this.th;
    return html`
      <div class="page-head map-head">
        <p class="eyebrow">Story map</p>
        <h1>${h}</h1>
        <p class="lede">${l}</p>
        <div class="page-head-actions">
          <div class="seg map-range" role="radiogroup" aria-label="Time range">
          ${RANGES.map(([k, label], i) => html`<button type="button" class="seg-opt" role="radio" data-range="${k}" aria-checked="${k === this.range ? 'true' : 'false'}" tabindex="${k === this.range ? '0' : '-1'}" title="${`${counts[k]} of ${N} stories first seen ${k === 'all' ? 'at any time' : `in the last ${label}`}`}">${label}<span class="map-range-n" aria-hidden="true">${counts[k]}</span></button>`)}
          <span class="seg-thumb" aria-hidden="true" style="${`--i:${RANGES.findIndex(r => r[0] === this.range)}`}"></span>
          </div>
          <button type="button" class="btn btn--secondary map-listbtn" data-act="list" aria-pressed="${this.list ? 'true' : 'false'}" aria-controls="map-stage">${G.list}<span>List view</span></button>
        </div>
      </div>
      <div class="map-bar">
        <div class="map-topics" role="group" aria-label="Filter by topic">
          ${tc.map(t => html`<button type="button" class="chip chip--filter" data-topic="${t.topic}" aria-pressed="false">${t.topic}<span class="map-chip-n" aria-hidden="true">${t.count}</span><span class="sr-only">, ${t.count} stories</span></button>`)}
          <button type="button" class="btn btn--ghost btn--sm map-clear" data-act="clear-topics" hidden>Clear</button>
        </div>
      </div>
      <div class="map-layout" data-stagger>
        <section class="tile tile--static tile--flush map-stage${this.list ? ' is-list' : ''}" id="map-stage" aria-label="Story map">
          <div class="map-canvas-host" data-host></div>
          <ul class="sr-only map-twin" role="listbox" tabindex="0" aria-label="${`Stories on the map, oldest to newest. ${N} stories. Arrows move to the nearest story, Enter selects, O opens the dossier, plus and minus zoom, 0 resets, Escape clears.`}" data-twin></ul>
          <p class="map-status" data-status hidden></p>
          <p class="map-keys" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd> move · <kbd>↵</kbd> select · <kbd>O</kbd> open · <kbd>+</kbd><kbd>−</kbd> zoom · <kbd>0</kbd> reset · <kbd>esc</kbd> clear</p>
          <div class="map-legend" aria-label="Legend" role="note">
            <span><i class="lg-node lg-below" aria-hidden="true"></i>Below ${th}</span>
            <span><i class="lg-node lg-clears" aria-hidden="true"></i>${th}+</span>
            <span><i class="lg-node lg-top" aria-hidden="true"></i>${th + 15}+</span>
            <span class="lg-sep"><i class="lg-edge" aria-hidden="true"></i>Shared company, watchlist, source or topic</span>
            <span><i class="lg-iso" aria-hidden="true"></i>Topic region</span>
          </div>
          <div class="map-zoom" role="group" aria-label="Zoom">
            <button type="button" class="btn btn--icon btn--sm map-zbtn" data-act="zoom-in" aria-label="Zoom in" title="Zoom in (+)">${icon('plus')}</button>
            <button type="button" class="btn btn--icon btn--sm map-zbtn" data-act="zoom-out" aria-label="Zoom out" title="Zoom out (−)">${G.minus}</button>
            <button type="button" class="btn btn--icon btn--sm map-zbtn" data-act="fit" aria-label="Fit the whole map" title="Fit (0)">${G.fit}</button>
          </div>
          <div class="map-peek" data-peek hidden></div>
          <div class="map-list" data-list ${this.list ? '' : raw('hidden')}></div>
        </section>
        <aside class="tile tile--static map-side" aria-label="Map details" data-side></aside>
      </div>
      <p class="sr-only" aria-live="polite" data-live></p>`;
  }

  mount() {
    const p = this.page;
    p.classList.add('map-page');
    p.innerHTML = String(this.shell());
    this.$ = (s) => p.querySelector(s);
    this.stage = this.$('#map-stage');
    this.twin = this.$('[data-twin]');
    this.live = this.$('[data-live]');
    this.side = this.$('[data-side]');
  }

  mountRest() {
    const p = this.page;
    this.eng = mountMap(this.$('[data-host]'), {
      data: this.data,
      onPick: (n) => this.select(n ? n.id : null, { from: 'pointer' }),
      onCamera: () => this.heatStale(),
      onMotion: () => bg.hold(240), // the field rests while the camera moves (GPU headroom for the map)
      cardHTML: (n) => this.cardHTML(n),
      defer: true // full draw waits for an idle callback after byline:routed (round-1 M7); a cached frame shows first
    });
    this.eng.topicFade = (c) => this.topics.size > 0 && !this.topics.has(c.topic);
    if (window.__byline) window.__byline.map = this.eng; // test/debug hook (stats, camera)
    this.paintSide();
    this.measureTop();
    this.watchSideEnd();
    if (this.list) this.paintList();
    this.wire();
    this.applyFilter(true);
    // background: full field, ripples anchored at the cluster centres (B §3: Map 0.8)
    bg.setMode('full');
    this.onRouted = (e) => {
      if (e.detail?.page === p) { this.entered(); return; }
      this.destroy();
    };
    document.addEventListener('byline:routed', this.onRouted);
  }

  entered() {
    if (this.didEnter) return;
    this.didEnter = true;
    // round-2 M5: the first canvas draw (the cached frame, if any) waits for byline:routed + 1 frame, so the tab-in
    // (55 ms at desktop 4×) carries no canvas work; the full draw (regions, isobars, labels) and the screen-reader
    // twin then wait for idle time
    const ric = window.requestIdleCallback || ((f) => setTimeout(f, 60));
    requestAnimationFrame(() => setTimeout(() => {
      if (!this.alive) return;
      this.eng.arm();
      ric(() => {
        if (!this.alive) return;
        const seen = this.eng.fromSnap;
        this.eng.release();
        if (!this.list && !seen) this.eng.introduce(); // the intro plays once; a cached frame means the map was seen
        ric(() => { if (this.alive) this.paintTwin(); }, { timeout: 600 });
      }, { timeout: 300 });
    }, 0));
    this.onResizeTop = () => { clearTimeout(this.topT); this.topT = setTimeout(() => this.measureTop(), 200); };
    addEventListener('resize', this.onResizeTop, { passive: true });
    const items = this.side.querySelectorAll('.map-hot-list > li, .map-detail > *');
    enterItems(items, { delay: 260, stagger: 60, y: 6, duration: 520 });
    setTimeout(() => this.syncHeat(), reduced() ? 0 : 900);
    this.onScroll = () => this.heatStale();
    addEventListener('scroll', this.onScroll, { passive: true });
  }

  /** round-1 M4: the stage and side panel run to 12 px above the viewport's bottom. The tile's top is read from an
   *  IntersectionObserver entry (no forced layout); at mount the page is still pending, untransformed. */
  measureTop() {
    if (typeof IntersectionObserver !== 'function') return;
    this.topIO?.disconnect();
    const io = this.topIO = new IntersectionObserver((entries) => {
      io.disconnect();
      if (!this.alive) return;
      const e = entries[entries.length - 1];
      const top = Math.round(e.boundingClientRect.top + SY);
      if (top > 0 && top !== this.tileTop) { this.tileTop = top; this.page.style.setProperty('--map-top', `${top}px`); }
    });
    io.observe(this.stage);
  }
  /** A bottom fade on the side panel while more of it is below the fold (a sentinel, observed in the panel). */
  watchSideEnd() {
    if (typeof IntersectionObserver !== 'function') return;
    this.sideIO?.disconnect();
    const end = document.createElement('div'), fade = document.createElement('div');
    end.className = 'map-side-end'; fade.className = 'map-side-fade';
    end.setAttribute('aria-hidden', 'true'); fade.setAttribute('aria-hidden', 'true');
    this.side.append(end, fade);
    this.sideIO = new IntersectionObserver((entries) => {
      const e = entries[entries.length - 1];
      this.side.classList.toggle('has-more', !e.isIntersecting);
    }, { root: this.side, threshold: 0 });
    this.sideIO.observe(end);
  }

  update(d) {
    this.data = d;
    const { h, l } = headline(d);
    const h1 = this.$('.page-head h1'), lede = this.$('.page-head .lede');
    if (h1 && h1.textContent !== String(h).replace(/<[^>]+>/g, '')) h1.innerHTML = String(h);
    if (lede) lede.innerHTML = String(l);
    this.eng.setData(d);
    if (this.sel != null && !this.eng.node(this.sel)) this.sel = null;
    this.eng.select(this.sel, { reveal: false });
    this.paintTwin();
    this.paintSide();
    if (this.list) this.paintList();
    this.applyFilter(true);
  }

  // -------------------------------------------------------------- filters
  match() {
    const days = RANGES.find(r => r[0] === this.range)?.[2];
    const now = Date.now(), T = this.topics;
    return (n) => (!days || now - ts(n.first_seen) <= days * 864e5) && (!T.size || (n.topics || []).some(t => T.has(t)));
  }
  applyFilter(silent = false) {
    const m = this.match();
    this.eng.setFilter(m);
    const shown = this.nodes.filter(m).length, N = this.nodes.length;
    const st = this.$('[data-status]');
    const filtered = shown !== N;
    st.hidden = !filtered;
    if (filtered) {
      const parts = [];
      if (this.topics.size) parts.push([...this.topics].join(' or '));
      if (this.range !== 'all') parts.push(`first seen in the last ${RANGES.find(r => r[0] === this.range)[1]}`);
      st.textContent = `Showing ${shown} of ${N} stories · ${parts.join(', ')}`;
    }
    this.$('.map-clear').hidden = !this.topics.size;
    if (this.list) this.paintList();
    if (!silent) this.say(filtered ? `Showing ${shown} of ${N} stories.` : `Showing all ${N} stories.`);
  }

  // -------------------------------------------------------------- selection
  select(id, { from = 'api', reveal = true } = {}) {
    this.sel = id == null ? null : id;
    const n = this.eng.select(this.sel, { reveal: reveal && from !== 'pointer' });
    if (n) this.cursor = n.id;
    this.paintSide({ animate: true });
    this.paintPeek();
    this.markTwin();
    if (this.list) this.markList();
    if (n) {
      const k = this.eng.related(n.id).length;
      this.say(`Selected: ${n.title}, ${Math.round(n.score)}, ${plural(k, 'connection')}.`);
      this.pulseAt(n.id);
    } else if (from !== 'silent') this.say('Selection cleared.');
  }
  pulseAt(id) {
    const i = this.eng.idx.get(String(id));
    if (i == null || this.list) return;
    const r = this.stage.getBoundingClientRect(); // interaction-time read, never inside a transition
    const s = this.eng.screenOf(i);
    bg.pulse(r.left + s.x, r.top + s.y);
  }

  // -------------------------------------------------------------- hover card
  cardHTML(n) {
    const deg = this.eng.related(n.id).length;
    return String(html`
      <div class="map-card-top">${scoreChip(n.score, this.th)}<span class="map-card-meta"><time datetime="${n.first_seen}">${day(n.first_seen)}</time> · ${plural(deg, 'link')}</span>${demoFlag(n.is_demo)}</div>
      <p class="map-card-title">${n.title}</p>
      ${n.finding ? html`<p class="map-card-finding">${raw(marked(n.finding, n.finding_marks))}</p>` : ''}
      <p class="map-card-src">${n.source_line || ''}</p>`);
  }

  // -------------------------------------------------------------- side panel
  /** The top-3 hot topics (Glass's list, kept). Round-2 M1 (ruling R12): each bar is neutral and labelled with what
   *  it measures, the stories whose main topic it is out of every story on the map ("6 of 19 stories"); the ranking
   *  itself is the server's heat (scores of stories updated in the last 7 days), named in the tooltip. */
  hotHTML() {
    const N = this.nodes.length;
    const hot = (this.data.hot_topics || []).slice(0, 3);
    if (!hot.length) return html`<p class="map-muted">No topic has a recent story yet.</p>`;
    const meta = (h) => `Main topic${h.in_count != null && h.in_count > h.count ? ` · tagged on ${h.in_count}` : ''}${h.recent != null && h.recent !== h.count ? ` · ${h.recent} this week` : ''}`;
    const tip = (h) => `${h.topic}: main topic of ${h.count} of ${plural(N, 'story', 'stories')} on the map${h.in_count != null ? `; tagged on ${h.in_count}` : ''}${h.recent != null ? `; ${h.recent} updated in the last 7 days` : ''}. Ranked by heat ${Number(h.heat || 0).toFixed(2)} (scores of stories updated in the last 7 days; hottest topic = 1).`;
    return html`<ol class="map-hot-list">${hot.map((h, i) => html`
      <li><button type="button" class="map-hot-btn" data-hot="${h.topic}" aria-pressed="${this.topics.size === 1 && this.topics.has(h.topic) ? 'true' : 'false'}" title="${tip(h)}">
        <span class="map-hot-rank" aria-hidden="true">${i + 1}</span>
        <span class="map-hot-name">${h.topic}</span>
        <span class="map-hot-meta">${meta(h)}</span>
        <span class="map-hot-val"><b>${h.count}</b> of ${plural(N, 'story', 'stories')}</span>
        <span class="meter map-hot-meter" aria-hidden="true"><i style="${`--v:${N ? Math.max(0.02, Math.min(1, h.count / N)) : 0}`}"></i></span>
      </button></li>`)}</ol>`;
  }
  paintSide({ animate = false } = {}) {
    const d = this.data;
    const n = this.sel != null ? this.eng.node(this.sel) : null;
    const detail = n ? this.storyHTML(n) : this.bridgeHTML();
    const hot = html`
      <section class="map-sec map-hot${n ? ' map-hot--after' : ''}" aria-labelledby="map-hot-h">
        <div class="map-sec-head"><h2 class="map-h2" id="map-hot-h">Hottest topics</h2><span class="section-meta" title="Ranked by heat: the scores of each topic's stories updated in the last 7 days">ranked by this week’s scores</span></div>
        ${this.hotHTML()}
      </section>`;
    // the selection leads when there is one; the top-3 hot topics lead otherwise
    this.side.innerHTML = String(n ? html`<div class="map-detail" data-detail>${detail}</div>${hot}` : html`${hot}<div class="map-detail" data-detail>${detail}</div>`);
    if (this.sideIO) this.watchSideEnd();
    if (animate) this.side.scrollTop = 0; // never on first paint: it would force layout inside the render task (E1)
    void d;
    if (animate && !reduced()) enterItems(this.side.querySelectorAll('.map-detail > *'), { stagger: 50, y: 6, duration: 440, fadeDuration: 320 });
  }
  bridgeHTML() {
    const d = this.data, br = d.bridge, N = this.nodes.length;
    const bn = br ? this.eng.node(br.id) : null;
    const hint = html`<p class="map-hint">Select a story to light up its links and list its related stories, oldest first.</p>`;
    if (!N) return html`<div class="empty"><h3>No stories yet</h3><p>Run a collection or add a story URL in the Feed; each story becomes a point on this map.</p></div>`;
    if (!bn || !br.degree) return hint;
    const types = bridgeTypes(d, br.id);
    return html`
      <section class="map-sec map-bridge" aria-labelledby="map-bridge-h">
        <p class="eyebrow" id="map-bridge-h">Biggest bridge</p>
        <div class="map-bridge-row">${scoreChip(bn.score, this.th)}<h3 class="map-story-title" title="${bn.title}">${shortTitle(bn.title, { max: 60, always: true })}${demoFlag(bn.is_demo)}</h3></div>
        <p class="map-bridge-why">Connects <b>${br.degree}</b> stories through shared ${types.length ? typesPhrase(types) : (TYPE[br.via] || 'features')}.</p>
        <button type="button" class="btn btn--secondary btn--sm" data-select="${bn.id}">Select on map ${icon('arrow-right')}</button>
      </section>
      ${hint}`;
  }
  storyHTML(n) {
    const th = this.th;
    const rel = this.eng.related(n.id).sort((a, b) => ts(a.node.first_seen) - ts(b.node.first_seen));
    const topics = n.topics || [];
    const mainT = n.topic && topics.includes(n.topic) ? n.topic : topics[0];
    const ordered = mainT ? [mainT, ...topics.filter(t => t !== mainT)] : topics;
    const k = rel.length;
    let relHead = '';
    if (k) {
      const lo = rel[0].node.first_seen, hi = rel[k - 1].node.first_seen;
      const sameYear = yearOf(lo) === yearOf(hi) && yearOf(hi) === yearOf(new Date().toISOString());
      const f = sameYear ? dayShort : day;
      relHead = k === 1 ? `1 related story, ${f(lo)}` : `${k} related stories, ${f(lo)} → ${f(hi)}`;
    }
    // timeline: related stories plus this one, in time order
    const line = [...rel.map(r => ({ node: r.node, edge: r.edge })), { node: n, self: true }].sort((a, b) => ts(a.node.first_seen) - ts(b.node.first_seen));
    return html`
      <article class="map-story" data-dossier-src data-story-card="${n.id}" aria-labelledby="map-story-h">
        <div class="map-story-top">
          <span data-shared="ring">${scoreChip(n.score, th)}</span>
          <span class="map-story-date"><time datetime="${n.first_seen}">First seen ${day(n.first_seen)}</time></span>
          ${demoFlag(n.is_demo)}
          <button type="button" class="btn btn--ghost btn--icon btn--sm map-x" data-act="clear" aria-label="Clear selection" title="Clear (Esc)">${icon('x')}</button>
        </div>
        <h3 class="map-story-title map-story-title--lg" id="map-story-h" data-shared="title">${n.title}</h3>
        ${n.finding ? html`<p class="map-story-finding">${raw(marked(n.finding, n.finding_marks))}</p>` : ''}
        <p class="map-story-src">${n.source_line || ''}</p>
        ${ordered.length ? html`<div class="cluster map-story-topics">${ordered.slice(0, 4).map((t, i) => html`<span class="chip ${i === 0 ? 'chip--main' : 'chip--topic'}"${i === 0 ? raw(' data-shared="topic"') : ''}>${t}</span>`)}</div>` : ''}
        <div class="map-story-actions"><a class="btn btn--primary btn--sm" href="#/story/${n.id}" data-open="${n.id}">Open dossier ${icon('arrow-right')}</a></div>
      </article>
      <section class="map-sec map-rel" aria-labelledby="map-rel-h">
        <h3 class="map-h3" id="map-rel-h">${k ? relHead : 'No connected stories'}</h3>
        ${k ? html`<ol class="map-tl">${line.map(({ node: m, edge, self }) => html`
          <li class="map-tl-item${self ? ' is-self' : ''}">
            <span class="map-tl-dot" data-q="${qualityTier(m.score, th)}" data-q-score="${m.score}" data-q-threshold="${th}" style="${`--q:${qualityColor(m.score, th)}`}" aria-hidden="true"></span>
            <div class="map-tl-body">
              <p class="map-tl-meta"><time datetime="${m.first_seen}">${day(m.first_seen)}</time>${self ? html`<span class="map-tl-self">This story</span>` : ''}</p>
              ${self ? html`<p class="map-tl-title">${m.short_title || m.title}</p>`
                : html`<button type="button" class="map-tl-title map-tl-btn" data-select="${m.id}"><span>${m.title}</span></button>`}
              ${self ? '' : reasonChips(edge?.reasons)}
            </div>
            <span class="map-tl-score">${scoreChip(m.score, th)}</span>
          </li>`)}</ol>`
          : html`<p class="map-muted">No story shares a company, watchlist item, source or main topic strongly enough to link here yet.</p>`}
      </section>`;
  }

  // phone: the selected story as a peek bar inside the stage, so a tap shows something where the finger is
  paintPeek() {
    const peek = this.$('[data-peek]');
    const n = this.sel != null ? this.eng.node(this.sel) : null;
    if (!n || !matchMedia('(max-width: 760px)').matches) { peek.hidden = true; return; }
    peek.innerHTML = String(html`${scoreChip(n.score, this.th)}<span class="map-peek-title">${n.short_title || n.title}</span><button type="button" class="btn btn--secondary btn--sm" data-act="details">Details</button>`);
    peek.hidden = false;
  }

  // -------------------------------------------------------------- keyboard twin (sr listbox, time order)
  timeOrder() { return this.nodes.slice().sort((a, b) => ts(a.first_seen) - ts(b.first_seen)); }
  paintTwin() {
    const m = this.match();
    this.twin.innerHTML = this.timeOrder().filter(m).map(n => {
      const k = this.eng.related(n.id).length;
      return `<li role="option" id="map-opt-${esc(n.id)}" aria-selected="${String(n.id) === String(this.sel)}">${esc(n.title)}, score ${Math.round(n.score)}, ${esc(plural(k, 'connection'))}, first seen ${esc(day(n.first_seen))}</li>`;
    }).join('');
    this.markTwin();
  }
  markTwin() {
    this.twin.querySelectorAll('[aria-selected=true]').forEach(o => o.setAttribute('aria-selected', 'false'));
    if (this.sel != null) this.twin.querySelector(`#map-opt-${CSS.escape(String(this.sel))}`)?.setAttribute('aria-selected', 'true');
    if (this.cursor != null && this.twin.querySelector(`#map-opt-${CSS.escape(String(this.cursor))}`)) this.twin.setAttribute('aria-activedescendant', `map-opt-${this.cursor}`);
    else this.twin.removeAttribute('aria-activedescendant');
  }
  moveCursor(id) {
    if (id == null) return;
    this.cursor = id;
    this.eng.setCursor(id);
    this.markTwin();
  }

  // -------------------------------------------------------------- List view (DOM twin, visible)
  paintList() {
    const box = this.$('[data-list]');
    const m = this.match();
    const rows = this.nodes.filter(m).sort((a, b) => ts(b.first_seen) - ts(a.first_seen));
    const th = this.th;
    box.innerHTML = String(rows.length ? html`
      <table class="table map-table">
        <caption class="sr-only">${`${rows.length} stories on the map, newest first`}</caption>
        <thead><tr><th scope="col">First seen</th><th scope="col" class="num">Score</th><th scope="col">Story</th><th scope="col">Main topic</th><th scope="col" class="num">Links</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
        <tbody>${rows.map(n => html`<tr data-row data-id="${n.id}" class="${String(n.id) === String(this.sel) ? 'is-selected' : ''}">
          <td class="map-td-date"><time datetime="${n.first_seen}">${day(n.first_seen)}</time></td>
          <td class="num map-td-score">${scoreChip(n.score, th)}</td>
          <td class="map-td-story" data-dossier-src><a class="map-td-title" href="#/story/${n.id}" data-shared="title">${n.title}</a>${demoFlag(n.is_demo)}<span class="map-td-src">${n.source_line || ''}</span></td>
          <td class="map-td-topic">${n.topic ? html`<span class="chip chip--topic">${n.topic}</span>` : html`<span class="map-muted">Unsorted</span>`}</td>
          <td class="num map-td-links">${this.eng.related(n.id).length}</td>
          <td class="map-td-act"><button type="button" class="btn btn--ghost btn--sm" data-show="${n.id}">Show on map</button></td>
        </tr>`)}</tbody>
      </table>` : html`<div class="empty"><h3>No stories match</h3><p>Nothing first seen in this range carries the chosen topics. Widen the time range or clear the topic filter.</p></div>`);
  }
  markList() {
    this.$('[data-list]')?.querySelectorAll('tr[data-id]').forEach(tr => tr.classList.toggle('is-selected', tr.dataset.id === String(this.sel)));
  }
  setList(on) {
    this.list = on;
    try { localStorage.setItem('byline-map-list', on ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    this.$('[data-act=list]').setAttribute('aria-pressed', String(on));
    this.stage.classList.toggle('is-list', on);
    const box = this.$('[data-list]');
    box.hidden = !on;
    // will-change only for the 240 ms swap (round-1 M7)
    const fade = (el) => {
      if (reduced()) return;
      el.style.willChange = 'opacity';
      const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
      const done = () => { el.style.willChange = ''; };
      a.finished.then(done, done);
    };
    if (on) { this.paintList(); fade(box); }
    else { this.eng.release(); this.eng.requestDraw(); fade(this.$('[data-host]')); }
    this.say(on ? 'List view. Stories newest first.' : 'Map view.');
  }

  // -------------------------------------------------------------- events
  wire() {
    const p = this.page;
    p.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act], [data-topic], [data-range], [data-hot], [data-select], [data-show]');
      if (!t || !p.contains(t)) return;
      if (t.dataset.topic != null) { this.toggleTopic(t.dataset.topic); return; }
      if (t.dataset.range) { this.setRange(t.dataset.range); return; }
      if (t.dataset.hot != null) { this.hotTopic(t.dataset.hot); return; }
      if (t.dataset.select != null) { this.select(t.dataset.select); return; }
      if (t.dataset.show != null) { if (this.list) this.setList(false); this.select(t.dataset.show); this.eng.reveal(this.eng.idx.get(String(t.dataset.show)), { zoom: true }); return; }
      switch (t.dataset.act) {
        case 'list': this.setList(!this.list); break;
        case 'clear-topics': this.topics.clear(); this.paintChips(); this.applyFilter(); break;
        case 'zoom-in': this.eng.zoomBy(1.5); break;
        case 'zoom-out': this.eng.zoomBy(1 / 1.5); break;
        case 'fit': this.eng.reset(); break;
        case 'clear': this.select(null); this.twin.focus({ preventScroll: true }); break;
        case 'details': this.side.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' }); break;
        default: break;
      }
    });
    // list rows: click anywhere but a control selects
    p.addEventListener('click', (e) => {
      const tr = e.target.closest('.map-table tr[data-id]');
      if (!tr || e.target.closest('a, button')) return;
      this.select(tr.dataset.id, { reveal: false });
    });
    // radiogroup arrows (roving tabindex)
    this.$('.map-range').addEventListener('keydown', (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const i = RANGES.findIndex(r => r[0] === this.range);
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? RANGES.length - 1 : (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + RANGES.length) % RANGES.length;
      this.setRange(RANGES[j][0]);
      this.$(`[data-range="${RANGES[j][0]}"]`).focus();
    });
    // the keyboard twin
    this.twin.addEventListener('focus', () => {
      this.eng.setShowCursor(true);
      if (this.cursor == null || !this.eng.visible(this.eng.idx.get(String(this.cursor)) ?? -1)) this.cursor = (this.sel != null ? this.eng.node(this.sel) : this.eng.nearest(null))?.id ?? null;
      this.moveCursor(this.cursor);
      this.stage.classList.add('is-kbd');
    });
    this.twin.addEventListener('blur', () => { this.eng.setShowCursor(false); this.eng.setHover(-1); this.stage.classList.remove('is-kbd'); });
    this.twin.addEventListener('keydown', (e) => this.key(e));
    // prefetch the dossier when the open button is hovered (shell does it for story links)
  }
  key(e) {
    if (e.metaKey || e.ctrlKey) return;
    const k = e.key;
    const dirs = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    let handled = true;
    if (dirs[k] && e.altKey) { const s = 90; const [dx, dy] = { left: [s, 0], right: [-s, 0], up: [0, s], down: [0, -s] }[dirs[k]]; this.eng.panAnimated(dx, dy); }
    else if (dirs[k]) {
      const n = this.eng.nearest(this.cursor, dirs[k]);
      if (n) { this.moveCursor(n.id); this.eng.setHover(this.eng.idx.get(String(n.id))); }
    } else if (k === 'Enter' && e.shiftKey) this.open(this.cursor ?? this.sel);
    else if (k === 'Enter' || k === ' ') { if (this.cursor != null) this.select(this.cursor); }
    else if (k === 'o' || k === 'O') this.open(this.cursor ?? this.sel);
    else if (k === '+' || k === '=') this.eng.zoomBy(1.4);
    else if (k === '-' || k === '_' || k === '−') this.eng.zoomBy(1 / 1.4);
    else if (k === '0') { this.eng.reset(); this.say('View reset to the whole map.'); }
    else if (k === 'Escape') { if (this.sel != null) this.select(null); else if (this.topics.size) { this.topics.clear(); this.paintChips(); this.applyFilter(); } else handled = false; }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }
  open(id) {
    if (id == null) return;
    if (String(id) !== String(this.sel)) this.select(id);
    const a = this.side.querySelector(`[data-open="${CSS.escape(String(id))}"]`);
    if (a) a.click(); else location.hash = `#/story/${id}`;
  }
  toggleTopic(t) {
    if (this.topics.has(t)) this.topics.delete(t); else this.topics.add(t);
    this.paintChips();
    this.applyFilter();
    this.paintTwin();
  }
  hotTopic(t) {
    const only = this.topics.size === 1 && this.topics.has(t);
    this.topics.clear();
    if (!only) this.topics.add(t);
    this.paintChips();
    this.applyFilter();
    this.paintTwin();
    if (!only) {
      if (this.list) this.setList(false);
      this.eng.focusCluster(t);
    } else this.eng.reset();
  }
  paintChips() {
    this.page.querySelectorAll('[data-topic]').forEach(b => b.setAttribute('aria-pressed', String(this.topics.has(b.dataset.topic))));
    this.side.querySelectorAll('[data-hot]').forEach(b => b.setAttribute('aria-pressed', String(this.topics.size === 1 && this.topics.has(b.dataset.hot))));
  }
  setRange(r) {
    if (r === this.range) return;
    this.range = r;
    const i = RANGES.findIndex(x => x[0] === r);
    this.page.querySelectorAll('[data-range]').forEach(b => { const on = b.dataset.range === r; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    this.$('.map-range .seg-thumb').style.setProperty('--i', String(i));
    this.applyFilter();
    this.paintTwin();
  }
  say(msg) { this.live.textContent = ''; requestAnimationFrame(() => { if (this.alive) this.live.textContent = msg; }); }

  // -------------------------------------------------------------- background heat from clusters
  syncHeatSoon() { clearTimeout(this.heatT); this.heatT = setTimeout(() => this.syncHeat(), 260); }
  /** The camera moved: re-anchor the ripples on the next pointer input (which wakes the field anyway),
   *  so a settled map never restarts the background on its own. */
  heatStale() {
    if (this.staleBound || !this.alive) return;
    this.staleBound = true;
    const go = () => { this.staleBound = false; document.removeEventListener('pointermove', go); this.syncHeatSoon(); };
    this.staleGo = go;
    document.addEventListener('pointermove', go, { passive: true });
  }
  syncHeat() {
    if (!this.alive || this.list || document.hidden) return;
    const r = this.stage.getBoundingClientRect();
    const phone = matchMedia('(max-width: 760px)').matches;
    const rail = phone ? null : document.querySelector('.rail')?.getBoundingClientRect();
    const left = rail ? rail.right : 0, top = phone ? 120 : 140;
    const W = Math.max(1, innerWidth - left), H = Math.max(1, innerHeight - top);
    const pts = this.eng.clusterPoints()
      .filter(c => c.heat > 0.05 && c.x > 0 && c.y > 0 && c.x < r.width && c.y < r.height)
      .map(c => ({ topic: c.topic, heat: Math.min(1, c.heat * 0.8), x: Math.max(0, Math.min(1, (r.left + c.x - left) / W)), y: Math.max(0, Math.min(1, (r.top + c.y - top) / H)) }));
    const key = pts.map(p => `${p.topic}:${p.x.toFixed(2)},${p.y.toFixed(2)}`).join('|');
    if (key === this.heatKey) return;
    this.heatKey = key;
    bg.setHeat(pts);
  }
  async restoreHeat() {
    // the shell only re-sends Today's heat when it changes, so put it back ourselves (same rule as app.js)
    try {
      const t = await api.get('/today');
      const pairs = (Array.isArray(t?.topic_counts) ? t.topic_counts.map(x => [x.topic, Number(x.weighted ?? x.count) || 0]) : [])
        .filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const max = pairs[0]?.[1] || 1;
      bg.setHeat(pairs.map(([topic, v]) => ({ topic, heat: v / max })));
    } catch (e) { bg.setHeat([]); }
  }

  destroy() {
    if (!this.alive) return;
    this.alive = false;
    document.removeEventListener('byline:routed', this.onRouted);
    if (this.onScroll) removeEventListener('scroll', this.onScroll);
    if (this.onResizeTop) removeEventListener('resize', this.onResizeTop);
    clearTimeout(this.topT);
    this.topIO?.disconnect(); this.sideIO?.disconnect();
    if (this.staleGo) document.removeEventListener('pointermove', this.staleGo);
    clearTimeout(this.heatT);
    this.eng.destroy();
    this.restoreHeat();
  }
}

export { headline };
void toast;
