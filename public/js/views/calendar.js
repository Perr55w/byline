import { api } from '../api.js';
import { html, on, toast, status, channelLabel, fmtDate, modal, optimistic, stampChanged, reducedMotion } from '../ui.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDay = (iso) => iso ? (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : ymd(new Date(iso))) : null;
const shift = (month, n) => { const [y, m] = month.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const MAX_PER_DAY = 4;

export async function render(view, { params = [] } = {}) {
  const st = await api.get('/status').catch(() => ({ today: ymd(new Date()) }));
  const today = st.today || ymd(new Date());
  const month = /^\d{4}-\d{2}$/.test(params[0] || '') ? params[0] : today.slice(0, 7);
  const cal = await api.get(`/calendar?month=${month}`);

  const el = document.createElement('div');
  view.replaceChildren(el);

  // Bucket items by local day.
  const byDay = {};
  const add = (day, item) => { if (day && day.startsWith(month)) (byDay[day] ||= []).push(item); };
  for (const d of cal.drafts) {
    const published = d.status === 'published' && d.published_at;
    add(published ? localDay(d.published_at) : (d.planned_date || '').slice(0, 10), { type: 'draft', ...d, published });
  }
  for (const o of cal.outreach) add(localDay(o.send_at), { type: 'outreach', ...o });

  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7));
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = Math.ceil((((first.getDay() + 6) % 7) + daysInMonth) / 7) * 7;
  const days = Array.from({ length: cells }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));

  const item = (it) => it.type === 'outreach'
    ? html`<div class="cal-item outreach" title="Outreach to ${it.name} (${it.status}) — edit the send time from People" data-href="#/people">✉ ${it.name}</div>`
    : html`<div class="cal-item ${it.channel} ${it.published ? 'published' : ''}" ${it.published ? '' : html`draggable="true"`} data-id="${it.id}" data-href="#/draft/${it.id}"
        title="${channelLabel(it.channel, it.format)} · ${it.status}${it.published ? ' (published)' : ' — drag to move'}: ${it.title}">${it.title}</div>`;

  el.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker">Editorial calendar</div>
      <h1>Calendar</h1>
      <p class="lede">LinkedIn, Instagram and video drafts plus planned outreach, in one shared plan. Drag a draft to change its planned date.</p>
    </div>
    <div class="cal-nav">
      <button data-act="nav" data-month="${shift(month, -1)}" aria-label="Previous month">←</button>
      <div class="month">${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
      <button data-act="nav" data-month="${shift(month, 1)}" aria-label="Next month">→</button>
      ${month !== today.slice(0, 7) ? html`<button class="ghost sm" data-act="nav" data-month="${today.slice(0, 7)}">Today</button>` : ''}
    </div>
  </div>

  <div class="split">
    <section class="card reveal">
      <div class="row between" style="margin-bottom:10px">
        <div class="legend"><span class="lg-linkedin">LinkedIn</span><span class="lg-instagram">Instagram</span><span class="lg-video">Video</span><span class="lg-outreach">Outreach</span><span class="lg-published">Published</span></div>
      </div>
      <div class="cal">
        ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => html`<div class="cal-head">${d}</div>`)}
        ${days.map(d => {
          const key = ymd(d); const list = byDay[key] || [];
          const inMonth = d.getMonth() === m - 1;
          return html`<div class="cal-day ${key === today ? 'today' : ''} ${inMonth ? '' : 'out'}" ${inMonth ? html`data-drop="${key}"` : ''}>
            <div class="cal-date">${d.getDate()}</div>
            ${list.slice(0, MAX_PER_DAY).map(item)}
            ${list.length > MAX_PER_DAY ? html`<div class="more" title="${list.slice(MAX_PER_DAY).map(x => x.title || x.name).join('\n')}">+${list.length - MAX_PER_DAY} more</div>` : ''}
          </div>`;
        })}
      </div>
      <p class="set-note">Moving a date only changes the plan — it doesn’t change a draft’s approval. Scheduling a post for publishing requires approval of the exact text and media, which happens in the Studio.</p>
    </section>

    <div class="stack reveal">
      <section class="card">
        <h3>Unplanned drafts</h3>
        <p class="muted small" style="margin-top:0">Drag onto a day to plan it. Drop a planned draft here to clear its date.</p>
        <div class="cal-tray" data-drop="">
          ${cal.unplanned.length ? cal.unplanned.map(d => html`<div class="cal-item ${d.channel}" draggable="true" data-id="${d.id}" data-href="#/draft/${d.id}" title="${d.title}">
            <div>${d.title}</div><div class="row" style="margin-top:3px">${status(d.status)}<span class="chip">${channelLabel(d.channel, d.format)}</span></div></div>`)
          : html`<div class="muted small" style="padding:10px">Every open draft has a date.</div>`}
        </div>
      </section>

      <section class="card flat">
        <h3>Publication history</h3>
        ${cal.history.length ? cal.history.map(h => html`<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)">
          <a href="#/draft/${h.id}" style="color:var(--text);max-width:68%">${h.title}</a>
          <span class="row"><span class="chip">${channelLabel(h.channel, h.format)}</span><span class="mono faint">${fmtDate(h.published_at)}</span></span></div>`)
        : html`<p class="muted small">Nothing published yet. When you publish (or mark a post as published) it shows up here and in Performance.</p>`}
      </section>
    </div>
  </div>`);

  // ---- events ----
  on(el, 'click', '[data-act="nav"]', (e, b) => { location.hash = `#/calendar/${b.dataset.month}`; });
  on(el, 'click', '[data-href]', (e, t) => { location.hash = t.dataset.href; });

  // ---- moving items: drag (desktop), tap → "Move to…" sheet (phone), Alt+arrows (keyboard) ----
  const fine = matchMedia('(pointer: fine)').matches;
  el.querySelectorAll('.cal-item[draggable="true"]').forEach(i => { i.tabIndex = 0; i.setAttribute('aria-roledescription', 'movable item'); });
  const cellFor = (date) => el.querySelector(`[data-drop="${date || ''}"]`);
  /** Move an item optimistically with a FLIP glide, a stamp, and an undo toast. */
  function move(itemEl, date) {
    const id = itemEl.dataset.id, from = itemEl.closest('[data-drop]'), to = cellFor(date);
    if (!to || to === from) return;
    const fromDate = from?.dataset.drop || null;
    const place = (target) => {
      const r0 = itemEl.getBoundingClientRect();
      const anchor = target.querySelector('.more') || null;
      target.insertBefore(itemEl, anchor);
      if (reducedMotion()) return;
      const r1 = itemEl.getBoundingClientRect();
      itemEl.animate([{ transform: `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px) rotate(-2deg)` }, { transform: 'none' }], { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' });
      setTimeout(() => stampChanged(itemEl), 240);
    };
    optimistic({
      apply: () => place(to), item: itemEl,
      commit: () => api.post(`/drafts/${id}/plan`, { date }),
      revert: () => from && place(from)
    }).then(() => toast(date ? `Planned for ${fmtDate(date + 'T12:00:00')}` : 'Date cleared', 'ok', {
      undo: { revert: () => optimistic({ apply: () => from && place(from), item: itemEl, commit: () => api.post(`/drafts/${id}/plan`, { date: fromDate }), revert: () => place(to) }).catch(() => {}) }
    })).catch(() => {});
  }

  let dragId = null;
  on(el, 'dragstart', '.cal-item[draggable="true"]', (e, t) => {
    dragId = t.dataset.id;
    e.dataTransfer.setData('text/plain', t.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => t.classList.add('lifted'));
  });
  on(el, 'dragend', '.cal-item', (e, t) => { t.classList.remove('lifted'); el.querySelectorAll('.drop').forEach(d => d.classList.remove('drop')); });
  on(el, 'dragover', '[data-drop]', (e, t) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; t.classList.add('drop'); });
  on(el, 'dragleave', '[data-drop]', (e, t) => { if (!t.contains(e.relatedTarget)) t.classList.remove('drop'); });
  on(el, 'drop', '[data-drop]', (e, t) => {
    e.preventDefault();
    t.classList.remove('drop');
    const id = e.dataTransfer.getData('text/plain') || dragId;
    const itemEl = id && el.querySelector(`.cal-item[data-id="${id}"]`);
    if (itemEl) { itemEl.classList.remove('lifted'); move(itemEl, t.dataset.drop || null); }
  });
  // phone: tapping a movable item opens a "Move to…" sheet instead of navigating
  el.addEventListener('click', (e) => {
    const t = e.target.closest('.cal-item[draggable="true"]');
    if (!t || fine) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const days = [...el.querySelectorAll('.cal-day[data-drop]')].map(d => d.dataset.drop);
    const m = modal(String(html`<h2 style="margin-bottom:6px">Move to…</h2><p class="muted small" style="margin-top:0">${t.textContent.trim()}</p>
      <div class="move-days">${days.map(d => html`<button class="sm ghost" data-to="${d}">${fmtDate(d + 'T12:00:00', { weekday: 'short', day: 'numeric' })}</button>`)}</div>
      <div class="row" style="margin-top:14px;justify-content:space-between"><button class="ghost" data-to="">Clear date</button><a class="btn" href="${t.dataset.href}" data-close>Open draft →</a></div>`));
    m.el.addEventListener('click', (ev) => { const b = ev.target.closest('[data-to]'); if (!b) return; m.close(); move(t, b.dataset.to || null); });
  }, true);
  // keyboard: Alt+←/→ moves a day, Alt+↑/↓ a week
  on(el, 'keydown', '.cal-item[draggable="true"]', (e, t) => {
    if (e.key === 'Enter') { location.hash = t.dataset.href; return; }
    if (!e.altKey || !/^Arrow/.test(e.key)) return;
    e.preventDefault();
    const cur = t.closest('[data-drop]')?.dataset.drop || today;
    const d = new Date(cur + 'T12:00:00'); d.setDate(d.getDate() + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 })[e.key]);
    move(t, ymd(d)); requestAnimationFrame(() => t.focus());
  });
}
