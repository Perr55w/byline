// Shared UI helpers. Views build HTML with the `html` tag (auto-escaped) and wire events with `on`.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

/** Tagged template: interpolations are escaped unless raw() or arrays of html results. */
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v instanceof Raw) out += v.s;
      else if (Array.isArray(v)) out += v.map(x => (x instanceof Raw ? x.s : esc(x))).join('');
      else if (v === false || v === null || v === undefined) out += '';
      else out += esc(v);
    }
  });
  return new Raw(out);
}

export function on(root, event, selector, fn) {
  root.addEventListener(event, (e) => {
    const t = e.target.closest(selector);
    if (t && root.contains(t)) fn(e, t);
  });
}

export function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3800);
}

export function modal(content, { wide = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${content}</div>`;
  const close = () => wrap.remove();
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  document.body.append(wrap);
  return { el: wrap.querySelector('.modal'), close };
}

export function confirmBox(message, okLabel = 'Confirm') {
  return new Promise((resolve) => {
    const m = modal(String(html`<h2>Please confirm</h2><p class="muted">${message}</p><div class="row" style="justify-content:flex-end;margin-top:18px"><button data-close>Cancel</button><button class="primary" id="ok">${okLabel}</button></div>`));
    m.el.querySelector('#ok').onclick = () => { m.close(); resolve(true); };
    m.el.parentElement.addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target === m.el.parentElement) resolve(false); });
  });
}

export const fmtDate = (d, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => d ? new Date(d).toLocaleDateString(undefined, opts) : '—';
export const fmtDateTime = (d) => d ? new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
export function timeAgo(d) {
  if (!d) return '—';
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const status = (s) => html`<span class="status ${s}">${(s || '').replace('_', ' ')}</span>`;
export const evChip = (k) => html`<span class="chip ev-${k}">${({ announcement: 'Announcement', reporting: 'Independent reporting', research: 'Research', commentary: 'Commentary', community: 'Community / industry climate', application: 'Applied practice', own_work: 'My project' })[k] || k}</span>`;
export const demoFlag = (on) => on ? html`<span class="demo-flag" title="Fictional sample data">DEMO</span>` : '';
export const channelLabel = (c, f) => `${({ linkedin: 'LinkedIn', instagram: 'Instagram', video: 'Video', email: 'Email', note: 'Note' })[c] || c}${f ? ' · ' + f : ''}`;

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'ok'); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); toast('Copied', 'ok'); }
}

export function download(filename, data, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Rasterize an SVG (markup or URL) to a PNG blob in the browser. */
export async function svgToPng(svgOrUrl, w = 1200, h = 1200) {
  const svgText = svgOrUrl.trim().startsWith('<') ? svgOrUrl : await (await fetch(svgOrUrl)).text();
  await document.fonts.ready;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return new Promise(r => c.toBlob(r, 'image/png'));
}

export const fileToBase64 = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = rej;
  r.readAsDataURL(file);
});

export function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> ${label || 'Working…'}`; }
  else { btn.disabled = false; btn.innerHTML = btn.dataset.label || btn.innerHTML; }
}

/** Run an async action bound to a button with spinner + error toast. */
export async function act(btn, fn, label) {
  setBusy(btn, true, label);
  try { return await fn(); }
  catch (e) { toast(e.message, 'err'); }
  finally { setBusy(btn, false); }
}

export const pct = (v) => Math.round((v || 0) * 100);
