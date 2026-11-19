/*
 * Effects adapted from React Bits (MIT + Commons Clause), David Haz
 * https://reactbits.dev: ClickSpark, HoldButton, SquishSwitch, LatticeLoader, StatusMark.
 *
 * Byline micro-interactions, rebuilt for the Proof Desk with no React and no motion library:
 *   spatter(el)            Stamp spatter: a few red-pencil droplets fly off a stamp as it lands
 *   holdToPress(button)    Hold to print: a red ink roller fills the button while it is held
 *   squish(switchEl)       Desk-switch knob squashes and stretches with its speed; drag it on touch
 *   lattice(container)     Type case: 3x3 sorts with a snake of lit cells; settles into a check or a cross
 *   statusMark(el, state)  Proof marks: dashed ring, red-pencil check + "stet", struck cross
 *
 * Gates: transform/opacity (canvas for spatter), nothing loops while the tab is hidden or the
 * element is offscreen, and reduced motion gets the final static state.
 */

// ------------------------------------------------------------------ shared
const root = document.documentElement;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const hidden = () => document.hidden || root.classList.contains('doc-hidden');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
let uid = 0;

// The stylesheet ships with this module so callers only import it.
if (!document.querySelector('link[data-fx-micro]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../css/fx-micro.css', import.meta.url).href;
  link.dataset.fxMicro = '';
  document.head.append(link);
}

/** A damped spring (semi-implicit Euler, fixed 1/120 s substeps). Stands in for motion's useSpring. */
function spring({ stiffness = 520, damping = 34, mass = 0.6, from = 0 } = {}) {
  let x = from, v = 0;
  return {
    target: from,
    get value() { return x; },
    step(dt) {
      for (let left = Math.min(dt, 0.064); left > 0; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120);
        v += ((-stiffness * (x - this.target) - damping * v) / mass) * h;
        x += v * h;
      }
      return x;
    },
    settled() { return Math.abs(v) < 0.02 && Math.abs(x - this.target) < 0.002; },
    jump(to) { x = this.target = to; v = 0; }
  };
}

/** Pause CSS loops while an element is offscreen (sets data-off). Returns a disconnect function. */
function watchOffscreen(el) {
  if (!('IntersectionObserver' in window)) return () => {};
  const io = new IntersectionObserver(([e]) => { if (e) el.toggleAttribute('data-off', !e.isIntersecting); });
  io.observe(el);
  return () => io.disconnect();
}

const inkOf = (el, name, fallback) => getComputedStyle(el).getPropertyValue(name).trim() || fallback;

// ------------------------------------------------------------------ 10 · Stamp spatter (ClickSpark)
const lastSpatter = new WeakMap();
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/**
 * A few red-pencil droplets and pencil ticks thrown off `el` as a stamp lands on it.
 * The canvas exists only for the ~400 ms the ink is in the air.
 */
export function spatter(el, { count = 6 } = {}) {
  if (!el?.isConnected || reduced() || hidden()) return;
  const now = performance.now();
  if (now - (lastSpatter.get(el) ?? -1e9) < 480) return; // ignore rapid repeats
  const r = el.getBoundingClientRect();
  if (!r.width || r.bottom < 0 || r.top > innerHeight) return;
  lastSpatter.set(el, now);

  const PAD = 40, w = r.width + PAD * 2, h = r.height + PAD * 2;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.className = 'fx-spatter';
  cv.setAttribute('aria-hidden', 'true');
  cv.width = Math.ceil(w * dpr); cv.height = Math.ceil(h * dpr);
  cv.style.cssText = `left:${r.left - PAD}px;top:${r.top - PAD}px;width:${w}px;height:${h}px`;
  document.body.append(cv);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = ctx.strokeStyle = inkOf(el, '--pencil-red', '#B3301A');
  ctx.lineCap = 'round';

  const n = clamp(Math.round(count), 1, 6);
  const cx = PAD + r.width / 2, cy = PAD + r.height / 2;
  const drops = Array.from({ length: n }, (_, i) => {
    // fan out over the top and the shoulders of the stamp, a little uneven like real ink
    const a = -Math.PI / 2 + ((n === 1 ? 0.5 : i / (n - 1)) - 0.5) * Math.PI * 1.35 + (Math.random() - 0.5) * 0.35;
    const speed = 85 + Math.random() * 70; // stays inside the 40px margin
    return {
      x: cx + Math.cos(a) * r.width * 0.46, y: cy + Math.sin(a) * r.height * 0.55,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      life: 260 + Math.random() * 160,
      size: 1.8 + Math.random() * 1.4,
      tick: i % 3 === 1 // every third mark is a short pencil stroke, the rest are round drops
    };
  });
  const longest = Math.max(...drops.map(d => d.life));
  const t0 = performance.now();
  let last = t0;
  const frame = (t) => {
    const dt = Math.min(0.04, (t - last) / 1000); last = t;
    ctx.clearRect(0, 0, w, h);
    for (const d of drops) {
      const p = (t - t0) / d.life;
      if (p >= 1) continue;
      d.vy += 700 * dt; d.x += d.vx * dt; d.y += d.vy * dt;
      ctx.globalAlpha = 1 - smooth(0.55, 1, p);
      if (d.tick) {
        const sp = Math.hypot(d.vx, d.vy) || 1, len = 7 * (1 - p * 0.4);
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - (d.vx / sp) * len, d.y - (d.vy / sp) * len); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(d.x, d.y, d.size * (1 - p * 0.35), 0, Math.PI * 2); ctx.fill();
      }
    }
    if (t - t0 < longest && cv.isConnected) requestAnimationFrame(frame);
    else cv.remove();
  };
  requestAnimationFrame(frame);
  setTimeout(() => cv.remove(), longest + 300); // a hidden tab stops rAF; never leave the canvas behind
}

// ------------------------------------------------------------------ 11 · Hold to print (HoldButton)
const HIT_PAD = 10;
const easeOut = t => 1 - Math.pow(1 - t, 3);

/**
 * Turn `button` into a hold-to-confirm press. A red ink roller crosses the button while a pointer,
 * Space or Enter is held; letting go early rolls it back. On completion `onComplete()` runs: return
 * (or resolve) `false` to roll back (e.g. the request failed), anything else lands the done stamp.
 * Plain clicks never fire the action. Returns { reset, destroy }.
 */
export function holdToPress(button, { ms = 900, onComplete, hint = 'Hold to publish', doneLabel = 'Published', busyLabel = 'Publishing…', failLabel = 'Not published', releaseMs = 200 } = {}) {
  if (!button) return null;
  if (button._hold) return button._hold;
  const original = button.innerHTML;
  const hintId = `hp-hint-${++uid}`;
  button.dataset.hold = '';
  button.classList.add('hold-press');
  button.innerHTML = `<span class="hp-label">${original}</span><span class="hp-fill" aria-hidden="true" style="position:absolute;inset:0;overflow:hidden"><span class="hp-fill-in"><span class="hp-label">${original}</span></span><i class="hp-roller"></i></span>`;
  const hintEl = document.createElement('span');
  hintEl.className = 'hp-hint';
  hintEl.id = hintId;
  hintEl.textContent = hint;
  button.after(hintEl);
  button.setAttribute('aria-describedby', [button.getAttribute('aria-describedby'), hintId].filter(Boolean).join(' '));

  let phase = 'idle', input = null, pointerId = null, rect = null, started = 0;
  let p = 0, raf = 0, timer = 0, hintTimer = 0;
  const paint = () => button.style.setProperty('--hp-p', p.toFixed(4));
  const say = (text, revertMs) => {
    clearTimeout(hintTimer);
    hintEl.textContent = text;
    if (revertMs) hintTimer = setTimeout(() => { if (phase === 'idle') hintEl.textContent = hint; }, revertMs);
  };
  const drive = (to, duration, ease) => {
    cancelAnimationFrame(raf);
    const from = p, t0 = performance.now();
    const step = (now) => {
      const t = duration > 0 ? Math.min(1, (now - t0) / duration) : 1;
      p = from + (to - from) * ease(t); paint();
      raf = t < 1 ? requestAnimationFrame(step) : 0;
    };
    raf = requestAnimationFrame(step);
  };

  const complete = async () => {
    if (phase !== 'holding' || performance.now() - started < ms - 50) return;
    phase = 'busy';
    cancelAnimationFrame(raf); p = 1; paint();
    if (pointerId != null) { try { button.releasePointerCapture(pointerId); } catch (e) { /* already released */ } pointerId = null; }
    navigator.vibrate?.(10);
    button.classList.remove('holding');
    button.classList.add('inked');
    button.setAttribute('aria-busy', 'true');
    say(busyLabel);
    let ok;
    try { ok = await onComplete?.(); } catch (e) { ok = false; }
    button.removeAttribute('aria-busy');
    if (!button.isConnected) return;
    if (ok === false) {
      phase = 'idle';
      button.classList.remove('inked');
      if (reduced()) { p = 0; paint(); } else drive(0, releaseMs, easeOut);
      say(`${failLabel}. ${hint} to try again.`, 4000);
      return;
    }
    phase = 'done';
    button.classList.add('done');
    button.setAttribute('aria-disabled', 'true');
    button.querySelectorAll('.hp-label').forEach(l => { l.innerHTML = `<span class="hp-stamp"><b>✓</b> ${doneLabel}</span>`; });
    say(doneLabel);
    spatter(button);
  };

  const begin = (kind) => {
    if (phase !== 'idle' || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    phase = 'holding'; input = kind; started = performance.now();
    rect = button.getBoundingClientRect();
    button.classList.add('holding');
    say('Keep holding…');
    if (reduced()) { p = 0; paint(); } // no moving fill, but the hold is still required
    else drive(1, ms * (1 - p), t => t);
    clearTimeout(timer);
    timer = setTimeout(complete, ms + 20);
    return true;
  };
  const release = (early = true) => {
    if (phase !== 'holding') return;
    clearTimeout(timer);
    phase = 'idle'; input = null;
    button.classList.remove('holding');
    if (reduced()) { p = 0; paint(); } else drive(0, releaseMs, easeOut);
    if (early) say(`${hint}: keep holding until the roller reaches the end`, 2600);
  };
  const endPointer = (e) => {
    if (e.pointerId !== pointerId) return;
    try { if (button.hasPointerCapture(e.pointerId)) button.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ }
    pointerId = null;
    release();
  };

  const on = {
    pointerdown: (e) => {
      if (e.button !== 0 || !e.isPrimary || pointerId != null) return;
      if (!begin('pointer')) return;
      pointerId = e.pointerId;
      try { button.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    },
    pointerup: endPointer,
    pointercancel: endPointer,
    lostpointercapture: endPointer,
    pointermove: (e) => {
      if (e.pointerId !== pointerId || !rect) return;
      if (e.clientX < rect.left - HIT_PAD || e.clientX > rect.right + HIT_PAD || e.clientY < rect.top - HIT_PAD || e.clientY > rect.bottom + HIT_PAD) endPointer(e);
    },
    contextmenu: (e) => { if (phase === 'holding') e.preventDefault(); },
    keydown: (e) => {
      if (e.key === 'Escape') { if (input === 'key') release(); return; }
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault(); // no synthetic click: a tap never publishes
      if (!e.repeat) begin('key');
    },
    keyup: (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      if (input === 'key') release();
    },
    blur: () => release(),
    click: (e) => { e.preventDefault(); e.stopImmediatePropagation(); } // the hold is the only way in
  };
  for (const [k, fn] of Object.entries(on)) button.addEventListener(k, fn, k === 'click');
  const cancel = () => release();
  const onVis = () => { if (document.hidden) release(); };
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', onVis);

  const ctl = {
    reset() {
      clearTimeout(timer); cancelAnimationFrame(raf);
      phase = 'idle'; p = 0; paint();
      button.classList.remove('holding', 'inked', 'done');
      button.removeAttribute('aria-disabled');
      button.querySelectorAll('.hp-label').forEach(l => { l.innerHTML = original; });
      say(hint);
    },
    destroy() {
      ctl.reset();
      for (const [k, fn] of Object.entries(on)) button.removeEventListener(k, fn, k === 'click');
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', onVis);
      hintEl.remove();
      button.innerHTML = original;
      button.classList.remove('hold-press');
      delete button.dataset.hold;
      delete button._hold;
    }
  };
  button._hold = ctl;
  return ctl;
}

// ------------------------------------------------------------------ 13 · SquishSwitch
const MAX_STRETCH = 0.45;
const STRETCH_SPEED = 260; // px/s at which the knob reaches full stretch (20px travel)
const TAP_SLOP = 6;

/**
 * Squash-and-stretch for the desk switch knob. `switchEl` is the switch button (or anything inside it)
 * holding `.track > .knob`. The CSS transition keeps moving the knob; this only adds the
 * independent `scale` property, so the click handler and aria-checked are untouched.
 * On touch the knob can be dragged; letting go past halfway clicks the button.
 */
export function squish(switchEl) {
  const btn = switchEl?.closest?.('button, [role="switch"]') || switchEl;
  const knob = btn?.querySelector('.knob');
  const track = btn?.querySelector('.track');
  if (!knob || !track || btn.dataset.squish != null) return null;
  btn.dataset.squish = '';
  btn.classList.add('squishy');

  const s = spring({ stiffness: 1200, damping: 50, mass: 0.5 });
  let raf = 0, lastX = null, lastT = 0, quiet = 0, grip = null, suppress = false, synthetic = false;
  const knobX = () => { const t = getComputedStyle(knob).transform; return t && t !== 'none' ? new DOMMatrixReadOnly(t).m41 : 0; };
  const travel = () => track.clientWidth - knob.offsetWidth - 2 * knob.offsetLeft;

  const tick = (t) => {
    const x = knobX();
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 1 / 60;
    const v = lastX == null ? 0 : (x - lastX) / dt;
    lastX = x; lastT = t;
    s.target = Math.min(MAX_STRETCH, Math.abs(v) / STRETCH_SPEED);
    const k = clamp(s.step(dt), -0.12, MAX_STRETCH); // a little undershoot reads as the rebound squash
    knob.style.scale = `${(1 + k).toFixed(3)} ${(1 / (1 + k)).toFixed(3)}`;
    quiet = Math.abs(v) < 0.5 && s.settled() ? quiet + 1 : 0;
    if ((quiet > 4 && !grip) || hidden()) { raf = 0; knob.style.scale = ''; s.jump(0); return; }
    raf = requestAnimationFrame(tick);
  };
  const kick = () => {
    if (reduced() || hidden() || raf) return;
    lastX = null; lastT = 0; quiet = 0;
    raf = requestAnimationFrame(tick);
  };

  const mo = new MutationObserver(kick);
  mo.observe(btn, { attributes: true, attributeFilter: ['aria-checked'] });

  const on = {
    click: (e) => {
      if (suppress && !synthetic) { e.preventDefault(); e.stopImmediatePropagation(); suppress = false; return; }
      kick();
    },
    pointerdown: (e) => {
      if (e.pointerType === 'mouse' || !e.isPrimary || grip) return;
      grip = { id: e.pointerId, startX: e.clientX, base: knobX(), moved: false, x: knobX() };
    },
    pointermove: (e) => {
      if (!grip || e.pointerId !== grip.id) return;
      const dx = e.clientX - grip.startX;
      if (!grip.moved) {
        if (Math.abs(dx) < TAP_SLOP) return;
        grip.moved = true;
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
        knob.style.transition = 'background-color 240ms linear';
      }
      grip.x = clamp(grip.base + dx, 0, travel());
      knob.style.transform = `translateX(${grip.x}px)`;
      kick();
    },
    pointerup: (e) => end(e, false),
    pointercancel: (e) => end(e, true)
  };
  function end(e, cancelled) {
    if (!grip || e.pointerId !== grip.id) return;
    const g = grip; grip = null;
    if (!g.moved) return; // a tap: the native click toggles
    try { btn.releasePointerCapture(e.pointerId); } catch (err) { /* fine */ }
    knob.style.transition = ''; knob.style.transform = '';
    if (cancelled) return;
    suppress = true; // swallow the native click that follows a drag
    setTimeout(() => { suppress = false; }, 0);
    const isOn = btn.getAttribute('aria-checked') === 'true';
    if ((g.x > travel() / 2) !== isOn) { synthetic = true; btn.click(); synthetic = false; }
    kick();
  }
  for (const [k, fn] of Object.entries(on)) btn.addEventListener(k, fn, k === 'click');

  return {
    destroy() {
      mo.disconnect(); cancelAnimationFrame(raf);
      for (const [k, fn] of Object.entries(on)) btn.removeEventListener(k, fn, k === 'click');
      knob.style.scale = ''; btn.classList.remove('squishy'); delete btn.dataset.squish;
    }
  };
}

// ------------------------------------------------------------------ 14 · Type case (LatticeLoader)
const SNAKE = [0, 1, 2, 5, 4, 3, 6, 7, 8]; // boustrophedon, like setting a line and returning the stick
const MARKS = { done: [3, 7, 5, 2], error: [0, 2, 4, 6, 8] };
const STEP = 90;

/**
 * A 3x3 type case of ink sorts with a red-pencil snake running through it, appended to `container`.
 * Returns { el, done(), error(), stop() }: done/error settle the case into a stamped check or cross.
 */
export function lattice(container, { label = 'Working' } = {}) {
  const el = document.createElement('span');
  el.className = 'type-case';
  el.dataset.status = 'working';
  el.setAttribute('role', 'status');
  const cells = (layer) => SNAKE.map((unit, i) => `<i class="tc-sort" style="--d:${unit * STEP}ms" data-i="${i}"${layer === 'run' && unit < 3 ? ' data-first' : ''}></i>`).join('');
  el.innerHTML = `<span class="tc-grid" aria-hidden="true"><span class="tc-layer tc-run">${cells('run')}</span><span class="tc-layer tc-mark">${cells('mark')}</span></span><span class="tc-sr">${label}, in progress</span>`;
  container.append(el);
  const unwatch = watchOffscreen(el);
  const settle = (state, text) => {
    if (el.dataset.status !== 'working') return ctl;
    el.querySelectorAll('.tc-mark .tc-sort').forEach((c, i) => c.toggleAttribute('data-on', MARKS[state].includes(i)));
    el.dataset.status = state;
    el.querySelector('.tc-sr').textContent = text;
    unwatch();
    if (state === 'done') setTimeout(() => spatter(el.querySelector('.tc-grid'), { count: 4 }), 120);
    return ctl;
  };
  const ctl = {
    el,
    done: (text = 'Done') => settle('done', text),
    error: (text = 'Failed') => settle('error', text),
    stop: () => { unwatch(); el.remove(); }
  };
  return ctl;
}

// ------------------------------------------------------------------ 15 · Proof marks (StatusMark)
const STATES = { pending: 'pending', queued: 'pending', skipped: 'pending', running: 'running', done: 'done', ok: 'done', complete: 'done', failed: 'error', error: 'error', cancelled: 'error' };
const SPOKEN = { pending: 'Pending', running: 'In progress', done: 'Done — stet', error: 'Failed' };

/**
 * Proof mark in `el` for a stage state: pending = dashed ink ring, running = the same ring slowly
 * turning, done = red-pencil check drawn then "stet", error = struck cross. Call again to change state;
 * the mark draws on change. `delay` (ms) staggers the first draw in a list.
 */
export function statusMark(el, state, { delay = 0 } = {}) {
  if (!el) return;
  const s = STATES[state] || 'pending';
  let m = el.querySelector(':scope > .proof-mark');
  if (!m) {
    m = document.createElement('span');
    m.className = 'proof-mark';
    m.setAttribute('role', 'img');
    m.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle class="pm-ring" cx="12" cy="12" r="8.5" fill="none"/><path class="pm-check" fill="none" pathLength="1" d="M6.2 12.8c1.3.9 2.5 2.2 3.6 3.9 2.1-4.3 4.6-7.6 8.4-10.4"/><path class="pm-cross" fill="none" pathLength="1" d="M7.3 7.3 16.7 16.7M16.7 7.3 7.3 16.7"/></svg><span class="pm-stet" aria-hidden="true" hidden>stet</span>';
    el.append(m);
    m._unwatch = watchOffscreen(m);
  }
  if (m.dataset.state === s) return m;
  m.style.setProperty('--pm-delay', `${delay}ms`);
  m.dataset.state = s;
  m.setAttribute('aria-label', SPOKEN[s]);
  return m;
}
