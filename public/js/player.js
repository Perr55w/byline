// Wire player: the spoken brief (Kokoro "Heart" voice, browser voice as fallback) with an on-air transcript.
// mountPlayer(el, { date, stories }) -> { destroy }
//   date    'YYYY-MM-DD' of the brief (GET /api/briefs/:date/script)
//   stories brief items in order ([{ story_id, title }]) — used to title the per-story ticks and transcript groups.
// States on .wp[data-state]: idle | loading | fetching-voice | playing | paused | ended | fallback
import { api } from './api.js';
import { html, esc, toast, isSheet, reducedMotion } from './ui.js';

const RATES = [1, 1.25, 1.5];
const LOOKAHEAD = 2;           // chunks synthesized ahead of the playhead
const CPS = 14.5;              // first guess at spoken characters per second (calibrated from real clips)
const SCROLL_QUIET = 3000;     // ms since the reader last scrolled before the transcript may follow along
const GLYPH = {
  play:  ['M7 5 L12.5 8.5 L12.5 15.5 L7 19 Z', 'M12.5 8.5 L18 12 L18 12 L12.5 15.5 Z'],
  pause: ['M7 5 L10.5 5 L10.5 19 L7 19 Z', 'M13.5 5 L17 5 L17 19 L13.5 19 Z']
};
const glyphSvg = (cls) => `<svg class="wp-glyph ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${GLYPH.play[0]}"/><path d="${GLYPH.play[1]}"/></svg>`;
const LABEL = {
  idle: 'Ready', loading: 'Loading the script', 'fetching-voice': 'Setting the voice', playing: 'On air',
  paused: 'Paused', ended: 'Finished', fallback: 'On air · browser voice'
};
const fmt = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const mobile = () => isSheet() || matchMedia('(max-width: 760px)').matches;

/** Split server chunks into transcript parts at "Story N." markers so ticks and groups land mid-chunk when needed. */
function buildParts(chunks) {
  const parts = []; let group = 0;
  chunks.forEach((c, i) => {
    const text = c.text; const cuts = [];
    for (const m of text.matchAll(/(^|\s)Story (\d+)\./g)) cuts.push({ at: m.index + m[1].length, g: Number(m[2]) });
    let from = 0;
    for (const cut of cuts) {
      if (cut.at > from) parts.push({ i, g: group, text: text.slice(from, cut.at), f0: from / text.length, f1: cut.at / text.length });
      from = cut.at; group = cut.g;
    }
    parts.push({ i, g: group, text: text.slice(from), f0: from / text.length, f1: 1 });
  });
  return parts.filter(p => p.text.trim());
}

export function mountPlayer(el, { date, stories = [] } = {}) {
  let chunks = [], parts = [], groups = [], voice = 'af_heart';
  let mode = 'heart';                      // 'heart' | 'browser'
  let state = 'loading', cur = 0, rate = 1, seq = 0, destroyed = false, started = false;
  const dur = [];                          // real clip durations (seconds, at 1×)
  const urls = new Map();                  // chunk index -> Promise<url>
  let cps = CPS;
  try { const saved = Number(localStorage.getItem('byline-tts-cps')); if (saved > 5 && saved < 40) cps = saved; } catch (e) { /* storage unavailable */ }
  // two audio elements, ping-ponged: one plays, the other preloads the next chunk (also unlockable on iOS)
  const els = [new Audio(), new Audio()];
  const holds = [null, null];              // chunk index loaded in each element
  let active = 0;
  // browser-voice bookkeeping
  let fbStart = 0, fbOffset = 0;
  let raf = 0, lastUserScroll = 0, transcriptVisible = false, playerVisible = true;

  el.innerHTML = `
  <div class="wp" data-state="loading" data-voice="heart" tabindex="0" role="region" aria-label="Audio brief for ${esc(date)}">
    <div class="wp-bar">
      <button type="button" class="wp-play" aria-label="Play the brief">${glyphSvg('')}</button>
      <div class="wp-mid">
        <div class="wp-top">
          <span class="wp-stamp">VOICE · HEART</span>
          <span class="wp-now" aria-hidden="true">The brief</span>
          <span class="wp-time"><span class="wp-el">0:00</span><span class="wp-sep">/</span><span class="wp-tot">–:––</span></span>
        </div>
        <div class="wp-track" role="slider" tabindex="0" aria-label="Position in the brief" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-valuetext="0:00">
          <i class="wp-rule"></i><i class="wp-fill"></i><span class="wp-ticks"></span><i class="wp-head"></i><i class="wp-wait"></i>
        </div>
      </div>
      <button type="button" class="wp-rate" aria-label="Playback speed 1×, change">1×</button>
    </div>
    <div class="wp-live" aria-live="polite" role="status"></div>
    <div class="wp-transcript" aria-label="Transcript"><p class="wp-note">Loading the script…</p></div>
  </div>`;
  const root = el.querySelector('.wp');
  const $ = (s) => root.querySelector(s);
  const playBtn = $('.wp-play'), rateBtn = $('.wp-rate'), track = $('.wp-track'), transcript = $('.wp-transcript');
  const elT = $('.wp-el'), totT = $('.wp-tot'), nowT = $('.wp-now'), stamp = $('.wp-stamp'), live = $('.wp-live');
  const fill = $('.wp-fill'), head = $('.wp-head'), ticksEl = $('.wp-ticks');

  // mini-player dock (mobile, while the main player is scrolled away)
  const dock = document.createElement('div');
  dock.className = 'wp-dock'; dock.setAttribute('role', 'region'); dock.setAttribute('aria-label', 'Now playing');
  dock.setAttribute('aria-hidden', 'true'); dock.inert = true;
  dock.innerHTML = `<i class="wp-dock-fill"></i><button type="button" class="wp-play wp-dock-play" aria-label="Play the brief">${glyphSvg('sm')}</button>
    <button type="button" class="wp-dock-now"><span class="wp-dock-kicker">VOICE · HEART</span><span class="wp-dock-title">The brief</span></button>
    <span class="wp-dock-time">0:00</span>`;
  document.body.append(dock);
  const dockPlay = dock.querySelector('.wp-dock-play'), dockFill = dock.querySelector('.wp-dock-fill');

  // ---------- timing model ----------
  const len = (i) => chunks[i]?.text.length || 0;
  const d = (i) => dur[i] ?? len(i) / cps;
  const startOf = (i) => { let s = 0; for (let k = 0; k < i; k++) s += d(k); return s; };
  const total = () => startOf(chunks.length);
  const allKnown = () => chunks.every((_, i) => dur[i] != null);
  function offsetNow() {
    if (mode === 'heart') { const a = els[active]; return holds[active] === cur ? (a.currentTime || 0) : 0; }
    if (state === 'fallback') return Math.min(d(cur) * 0.98, fbOffset + (performance.now() - fbStart) / 1000 * rate);
    return fbOffset;
  }
  const elapsed = () => (state === 'ended' ? total() : startOf(cur) + Math.min(offsetNow(), d(cur)));
  function locate(t) { // seconds -> { i, off }
    let s = 0;
    for (let i = 0; i < chunks.length; i++) { if (t < s + d(i) || i === chunks.length - 1) return { i, off: Math.max(0, t - s) }; s += d(i); }
    return { i: 0, off: 0 };
  }
  const groupStart = (g) => { const p = parts.find(x => x.g === g); return p ? startOf(p.i) + p.f0 * d(p.i) : 0; };
  function currentPart() {
    const f = d(cur) ? offsetNow() / d(cur) : 0;
    const ps = parts.filter(p => p.i === cur);
    return ps.find(p => f < p.f1) || ps[ps.length - 1];
  }
  const groupTitle = (g) => (g === 0 ? 'The brief' : stories[g - 1]?.title || `Story ${g}`);

  // ---------- rendering ----------
  function renderTranscript() {
    if (!chunks.length) return;
    const byG = new Map();
    parts.forEach((p, k) => { if (!byG.has(p.g)) byG.set(p.g, []); byG.get(p.g).push({ ...p, k }); });
    groups = [...byG.keys()];
    transcript.innerHTML = String(html`${groups.map(g => html`
      <section class="wp-group" data-g="${g}">
        <span class="wp-onair" aria-hidden="true">ON AIR</span>
        <div class="wp-gkick">${g === 0 ? 'Opening' : `Story ${String(g).padStart(2, '0')}`}${g ? html` · <span>${groupTitle(g)}</span>` : ''}</div>
        <p>${byG.get(g).map((p, n) => html`<span class="wp-seg" data-i="${p.i}" data-g="${p.g}" data-k="${p.k}" role="button" tabindex="${n === 0 ? 0 : -1}">${p.text}</span> `)}</p>
      </section>`)}`);
  }
  function renderTicks() {
    const T = total() || 1;
    ticksEl.innerHTML = groups.filter(g => g > 0).map(g =>
      `<i class="wp-tick" style="left:${(groupStart(g) / T * 100).toFixed(3)}%" title="${esc(groupTitle(g))}"></i>`).join('');
    totT.textContent = (allKnown() ? '' : '~') + fmt(T);
    track.setAttribute('aria-valuemax', String(Math.round(T)));
  }
  let lastSeg = -1, lastGroup = -1;
  function paint() {
    const T = total() || 1, e = Math.min(elapsed(), T), p = e / T;
    fill.style.transform = `scaleX(${p})`;
    head.style.transform = `translateX(${(p * track.clientWidth).toFixed(1)}px)`;
    dockFill.style.transform = `scaleX(${p})`;
    elT.textContent = fmt(e);
    dock.querySelector('.wp-dock-time').textContent = `${fmt(e)} / ${fmt(T)}`;
    track.setAttribute('aria-valuenow', String(Math.round(e)));
    track.setAttribute('aria-valuetext', `${fmt(e)} of ${fmt(T)}`);
    const showMarks = started && state !== 'ended';
    const part = showMarks ? currentPart() : null;
    const g = part ? part.g : -1, segKey = part ? `${cur}:${g}` : -1;
    if (segKey !== lastSeg) {
      transcript.querySelectorAll('.wp-seg.on').forEach(s => s.classList.remove('on'));
      if (part) transcript.querySelectorAll(`.wp-seg[data-i="${cur}"][data-g="${g}"]`).forEach(s => s.classList.add('on'));
      lastSeg = segKey;
      follow();
    }
    if (g !== lastGroup) {
      transcript.querySelectorAll('.wp-group.on').forEach(s => s.classList.remove('on'));
      if (g >= 0) transcript.querySelector(`.wp-group[data-g="${g}"]`)?.classList.add('on');
      lastGroup = g;
      const t = g >= 0 ? groupTitle(g) : 'The brief';
      nowT.textContent = t; dock.querySelector('.wp-dock-title').textContent = t;
      setPosition();
    }
  }
  function loop() { if (started && !root.isConnected) { api_.destroy(); return; } paint(); raf = (state === 'playing' || state === 'fallback') ? requestAnimationFrame(loop) : 0; }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };

  function setState(s, announce = true) {
    if (destroyed) return;
    const was = state; state = s;
    root.dataset.state = s; dock.dataset.state = s;
    const on = s === 'playing' || s === 'fallback' || s === 'fetching-voice';
    const which = on ? 'pause' : 'play';
    for (const svg of [playBtn, dockPlay].map(b => b.querySelector('svg'))) svg.querySelectorAll('path').forEach((p, k) => p.setAttribute('d', GLYPH[which][k]));
    const label = on ? 'Pause the brief' : s === 'ended' ? 'Play the brief again' : started ? 'Resume the brief' : 'Play the brief';
    playBtn.setAttribute('aria-label', label); dockPlay.setAttribute('aria-label', label);
    playBtn.setAttribute('aria-busy', String(s === 'fetching-voice' || s === 'loading'));
    if (announce && was !== s) live.textContent = LABEL[s] + (s === 'fallback' && was !== 'paused' ? ' — the Heart voice is unavailable' : '');
    if ('mediaSession' in navigator && started) navigator.mediaSession.playbackState = on ? 'playing' : s === 'paused' ? 'paused' : 'none';
    updateDock(); kick(); if (!raf) paint();
  }
  function setMode(m) {
    mode = m; root.dataset.voice = m; dock.dataset.voice = m;
    const label = m === 'heart' ? 'VOICE · HEART' : 'VOICE · BROWSER';
    stamp.textContent = label; dock.querySelector('.wp-dock-kicker').textContent = label;
    stamp.title = m === 'heart' ? `Kokoro ${voice}` : 'Your browser’s built-in voice (the Heart voice is unavailable)';
  }

  // ---------- Heart voice (server TTS) ----------
  function urlFor(i) {
    if (i < 0 || i >= chunks.length) return null;
    if (!urls.has(i)) {
      const p = fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: chunks[i].text, voice }) })
        .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok || !j.url) throw Object.assign(new Error(j.error || `TTS ${r.status}`), { status: r.status }); return j.url; });
      p.catch(() => urls.delete(i));
      urls.set(i, p);
    }
    return urls.get(i);
  }
  function prefetch(from) {
    for (let k = 1; k <= LOOKAHEAD; k++) urlFor(from + k)?.catch(() => {});
    const next = from + 1, my = seq;
    urlFor(next)?.then((u) => { if (my === seq && destroyed === false) load(1 - active, next, u); }).catch(() => {});
  }
  function load(slot, i, url) {
    if (holds[slot] === i) return;
    holds[slot] = i; els[slot].preload = 'auto'; els[slot].src = url;
  }
  for (const [slot, a] of els.entries()) {
    a.addEventListener('loadedmetadata', () => {
      const i = holds[slot];
      if (i == null || !isFinite(a.duration)) return;
      dur[i] = a.duration;
      const known = chunks.map((c, k) => (dur[k] != null ? [c.text.length, dur[k]] : null)).filter(Boolean);
      cps = known.reduce((s, [l]) => s + l, 0) / known.reduce((s, [, t]) => s + t, 0) || CPS;
      try { localStorage.setItem('byline-tts-cps', String(cps)); } catch (e) { /* storage unavailable */ }
      renderTicks();
    });
    a.addEventListener('ended', () => { if (slot === active && holds[slot] === cur && state === 'playing') go(cur + 1, 0); });
  }
  async function playHeart(i, off) {
    const my = ++seq;
    cur = i;
    let slot = holds[0] === i ? 0 : holds[1] === i ? 1 : -1;
    if (slot < 0) {
      setState('fetching-voice');
      let url;
      try { url = await urlFor(i); } catch (e) { if (my === seq) toBrowser(i, e); return; }
      if (my !== seq || destroyed) return;
      slot = holds[active] === i ? active : 1 - active;
      load(slot, i, url);
    }
    els[1 - slot].pause();
    active = slot;
    const a = els[slot];
    a.playbackRate = rate; a.defaultPlaybackRate = rate;
    try {
      if (a.readyState < 1) await new Promise((res, rej) => { a.addEventListener('loadedmetadata', res, { once: true }); a.addEventListener('error', rej, { once: true }); });
      if (my !== seq) return;
      a.currentTime = Math.min(off, Math.max(0, (a.duration || off) - 0.05));
      await a.play();
    } catch (e) {
      if (my !== seq) return;
      if (e?.name === 'NotAllowedError') { setState('paused'); return; }
      return toBrowser(i, e);
    }
    if (my !== seq) { a.pause(); return; }
    setState('playing');
    prefetch(i);
  }

  // ---------- browser voice (fallback) ----------
  let fbVoice = null;
  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    fbVoice = vs.find(v => /en[-_]US/i.test(v.lang) && /natural|samantha|aria|jenny|google us/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang)) || null;
  }
  function toBrowser(i, err) {
    if (!('speechSynthesis' in window)) {
      setState(started ? 'paused' : 'idle');
      toast(`The Heart voice is unavailable${err ? ` (${err.message})` : ''} and this browser has no built-in voice.`, 'err');
      return;
    }
    if (mode !== 'browser') { setMode('browser'); toast('Heart voice unavailable — reading with your browser’s voice.'); }
    els.forEach(a => a.pause());
    playBrowser(i);
  }
  function playBrowser(i) {
    const my = ++seq;
    cur = i; fbOffset = 0;
    speechSynthesis.cancel();
    if (!fbVoice) pickVoice();
    const u = new SpeechSynthesisUtterance(chunks[i].text);
    if (fbVoice) u.voice = fbVoice;
    u.rate = rate * 1.02;
    u.onstart = () => { if (my === seq) { fbStart = performance.now(); kick(); } };
    u.onend = () => { if (my === seq && state === 'fallback') { dur[i] ??= Math.max(0.5, (performance.now() - fbStart) / 1000 * rate); go(i + 1, 0); } };
    u.onerror = (e) => { if (my === seq && e.error !== 'interrupted' && e.error !== 'canceled') { setState('paused'); toast(`Browser voice error: ${e.error}`, 'err'); } };
    fbStart = performance.now();
    setState('fallback');
    speechSynthesis.speak(u);
  }

  // ---------- transport ----------
  function go(i, off = 0) {
    if (i >= chunks.length) { seq++; cur = chunks.length - 1; setState('ended'); return; }
    started = true; setMediaSession();
    lastSeg = -1;
    if (mode === 'heart') playHeart(i, off); else playBrowser(i);
  }
  function pause() {
    if (state === 'fallback') { fbOffset = offsetNow(); seq++; speechSynthesis.cancel(); setState('paused'); return; }
    if (state === 'playing' || state === 'fetching-voice') { seq++; els[active].pause(); setState('paused'); }
  }
  function play() {
    if (!chunks.length || state === 'loading') return;
    unlock();
    if (state === 'ended' || !started) return go(0, 0);
    if (state === 'paused') return mode === 'heart' ? playHeart(cur, offsetNow()) : playBrowser(cur);
  }
  const toggle = () => ((state === 'playing' || state === 'fallback' || state === 'fetching-voice') ? pause() : play());
  function seekTo(t) {
    const { i, off } = locate(Math.max(0, Math.min(t, total() - 0.01)));
    const wasOn = state === 'playing' || state === 'fallback' || state === 'fetching-voice' || !started || state === 'ended';
    if (wasOn) { unlock(); go(i, off); return; }
    // paused: move the playhead without playing
    seq++; cur = i; started = true;
    if (mode === 'heart') {
      const slot = holds[0] === i ? 0 : holds[1] === i ? 1 : -1;
      if (slot >= 0) { active = slot; els[slot].currentTime = off; els[1 - slot].pause(); }
      else { holds[active] = null; els[active].removeAttribute('src'); urlFor(i)?.then(u => { if (cur === i) { load(active, i, u); els[active].addEventListener('loadedmetadata', () => { els[active].currentTime = off; }, { once: true }); } }).catch(() => {}); }
    } else fbOffset = 0;
    lastSeg = -1; paint();
  }
  const seekGroup = (dir) => {
    const e = elapsed(), starts = groups.map(groupStart);
    if (dir > 0) { const n = starts.find(s => s > e + 0.25); if (n != null) seekTo(n); }
    else { const back = starts.filter(s => s < e - 3); seekTo(back.length ? back[back.length - 1] : 0); }
  };
  // iOS unlocks an <audio> element only inside a user gesture: prime the idle one.
  let unlocked = false;
  function unlock() {
    if (unlocked) return; unlocked = true;
    const b = els[1 - active];
    if (!b.src) { b.muted = true; b.play().then(() => { b.pause(); b.muted = false; }).catch(() => { b.muted = false; }); }
  }

  // ---------- Media Session ----------
  function setMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
      ms.metadata = new MediaMetadata({ title: `Byline briefing · ${new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`, artist: mode === 'heart' ? 'Heart · Kokoro' : 'Byline', album: mode === 'heart' ? 'Voice · Heart' : 'Voice · Browser',
        artwork: [{ src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }] });
      ms.setActionHandler('play', play);
      ms.setActionHandler('pause', pause);
      ms.setActionHandler('nexttrack', () => seekGroup(1));
      ms.setActionHandler('previoustrack', () => seekGroup(-1));
      ms.setActionHandler('seekto', (e) => e.seekTime != null && seekTo(e.seekTime));
    } catch { /* older browsers lack some actions */ }
  }
  function setPosition() {
    if (!('mediaSession' in navigator) || !started || !navigator.mediaSession.setPositionState) return;
    try { navigator.mediaSession.setPositionState({ duration: total(), playbackRate: rate, position: Math.min(elapsed(), total()) }); } catch { /* ignore */ }
  }
  function clearMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    for (const a of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto']) try { ms.setActionHandler(a, null); } catch { /* ignore */ }
    ms.metadata = null; ms.playbackState = 'none';
  }

  // ---------- auto-follow transcript ----------
  function follow() {
    if (!transcriptVisible || Date.now() - lastUserScroll < SCROLL_QUIET) return;
    const seg = transcript.querySelector('.wp-seg.on'); if (!seg) return;
    const r = seg.getBoundingClientRect(), vh = innerHeight;
    if (r.top > vh * 0.2 && r.bottom < vh * 0.8) return;
    seg.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }
  const userScrolled = () => { lastUserScroll = Date.now(); };
  const scrollKeys = (e) => { if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' '].includes(e.key) && !root.contains(e.target)) userScrolled(); };
  addEventListener('wheel', userScrolled, { passive: true });
  addEventListener('touchmove', userScrolled, { passive: true });
  addEventListener('keydown', scrollKeys);

  // ---------- mini-player dock ----------
  function updateDock() {
    const show = mobile() && !playerVisible && started && state !== 'ended' && state !== 'idle';
    dock.classList.toggle('show', show);
    dock.setAttribute('aria-hidden', String(!show)); dock.inert = !show;
    document.documentElement.classList.toggle('wp-docked', show);
  }
  const io = new IntersectionObserver((entries) => {
    if (started && !root.isConnected) { api_.destroy(); return; } // the view was swapped out: stop audio and drop the dock
    for (const en of entries) {
      if (en.target === root.querySelector('.wp-bar')) { playerVisible = en.isIntersecting; updateDock(); }
      if (en.target === transcript) transcriptVisible = en.isIntersecting;
    }
  });
  io.observe(root.querySelector('.wp-bar')); io.observe(transcript);
  const onResize = () => { updateDock(); paint(); };
  addEventListener('resize', onResize);
  const onRoute = () => setTimeout(() => { if (!root.isConnected) api_.destroy(); }, 1200);
  addEventListener('hashchange', onRoute);

  // ---------- events ----------
  playBtn.addEventListener('click', toggle);
  dockPlay.addEventListener('click', toggle);
  dock.querySelector('.wp-dock-now').addEventListener('click', () => root.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' }));
  rateBtn.addEventListener('click', () => {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    rateBtn.textContent = `${rate}×`; rateBtn.setAttribute('aria-label', `Playback speed ${rate}×, change`);
    els.forEach(a => { a.playbackRate = rate; a.defaultPlaybackRate = rate; });
    if (state === 'fallback') playBrowser(cur); // speech rate only applies to a new utterance
    live.textContent = `Speed ${rate}×`; setPosition();
  });
  track.addEventListener('click', (e) => {
    if (!chunks.length) return;
    const r = track.getBoundingClientRect();
    seekTo((e.clientX - r.left) / r.width * total());
  });
  track.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 10, ArrowLeft: -10, PageDown: 30, PageUp: -30 }[e.key];
    if (step) { e.preventDefault(); seekTo(elapsed() + step); }
    if (e.key === 'Home') { e.preventDefault(); seekTo(0); }
    if (e.key === 'End') { e.preventDefault(); seekGroup(1); }
  });
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('button, a, input, textarea, select')) return;
    if (e.key === ' ' || e.key === 'Spacebar') {
      const seg = e.target.closest('.wp-seg');
      e.preventDefault();
      if (seg) seekTo(startOf(+seg.dataset.i) + parts[+seg.dataset.k].f0 * d(+seg.dataset.i)); else toggle();
    }
    if (e.key === 'Enter' && e.target.closest('.wp-seg')) { const seg = e.target.closest('.wp-seg'); e.preventDefault(); seekTo(startOf(+seg.dataset.i) + parts[+seg.dataset.k].f0 * d(+seg.dataset.i)); }
    if (e.target === root && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); seekGroup(e.key === 'ArrowRight' ? 1 : -1); }
  });
  transcript.addEventListener('click', (e) => {
    const seg = e.target.closest('.wp-seg'); if (!seg || getSelection()?.toString()) return;
    const i = +seg.dataset.i, p = parts[+seg.dataset.k];
    seekTo(startOf(i) + p.f0 * d(i) + 0.001);
  });
  const onVis = () => { if (!document.hidden) paint(); };
  document.addEventListener('visibilitychange', onVis);
  if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', pickVoice);

  // ---------- load ----------
  (async () => {
    const [script, status] = await Promise.all([
      api.get(`/briefs/${date}/script`).catch((e) => ({ error: e.message })),
      api.get('/tts/status').catch(() => null)
    ]);
    if (destroyed) return;
    if (script.error || !script.chunks?.length) {
      transcript.innerHTML = `<p class="wp-note">${esc(script.error || 'This brief has no script yet.')}</p>`;
      playBtn.disabled = true; setState('idle', false); return;
    }
    voice = script.voice || voice;
    chunks = script.chunks.map(c => (typeof c === 'string' ? { text: c } : c)).filter(c => c.text);
    parts = buildParts(chunks);
    if (status && !status.installed) setMode('browser'); else setMode('heart');
    renderTranscript(); renderTicks();
    setState('idle', false);
    if (mode === 'heart') urlFor(0)?.catch(() => {}); // warm the first clip so Play starts quickly
  })();

  const api_ = {
    destroy() {
      if (destroyed) return;
      destroyed = true; seq++;
      cancelAnimationFrame(raf);
      els.forEach(a => { a.pause(); a.removeAttribute('src'); a.load(); });
      if ('speechSynthesis' in window && mode === 'browser') speechSynthesis.cancel();
      io.disconnect();
      removeEventListener('wheel', userScrolled); removeEventListener('touchmove', userScrolled);
      removeEventListener('keydown', scrollKeys); removeEventListener('resize', onResize); removeEventListener('hashchange', onRoute);
      document.removeEventListener('visibilitychange', onVis);
      if ('speechSynthesis' in window) speechSynthesis.removeEventListener?.('voiceschanged', pickVoice);
      if (started) clearMediaSession();
      document.documentElement.classList.remove('wp-docked');
      dock.remove();
      if (root.isConnected) el.replaceChildren();
    },
    toggle, play, pause
  };
  return api_;
}
