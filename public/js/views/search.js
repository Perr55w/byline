import { api } from '../api.js';
import { html, on, act, status, evChip, channelLabel, fmtDate } from '../ui.js';

const TYPES = [['stories', 'Stories'], ['claims', 'Claims'], ['briefs', 'Briefs'], ['drafts', 'Drafts'], ['notes', 'Notes']];
const STATUSES = [['', 'Any status'], ['new', 'Story · new'], ['seen', 'Story · seen'], ['archived', 'Story · archived'],
  ['draft', 'Draft · draft'], ['in_review', 'Draft · in review'], ['approved', 'Draft · approved'], ['scheduled', 'Draft · scheduled'], ['published', 'Draft · published']];
const ui = { q: { q: '', type: TYPES.map(t => t[0]), topic: '', company: '', source: '', from: '', to: '', status: '' } };
const snippet = (t, n = 220) => !t ? '' : t.length > n ? t.slice(0, n) + '…' : t;

function results(r) {
  const groups = [
    ['stories', 'Stories', (s) => html`<div class="hit"><a class="hit-title" href="#/story/${s.id}">${s.title}</a>
      <div class="small muted">${snippet(s.summary)}</div>
      <div class="row small" style="margin-top:5px">${status(s.status)}${(s.topics || []).map(t => html`<span class="chip violet">${t}</span>`)}${(s.companies || []).map(c => html`<span class="chip amber">${c}</span>`)}<span class="faint mono">${fmtDate(s.updated_at)}</span></div></div>`],
    ['claims', 'Claims', (c) => html`<div class="hit"><a href="#/story/${c.story_id}" class="claim" style="color:var(--text)">“${c.text}”</a>
      <div class="row small" style="margin-top:5px">${evChip(c.evidence_kind)}<span class="faint mono">${c.domain}</span></div></div>`],
    ['briefs', 'Briefs', (b) => html`<div class="hit"><div class="row"><span class="mono">${b.run_date}</span>${b.quiet ? html`<span class="chip amber">quiet day</span>` : ''}</div>
      <div class="small muted">${b.summary}</div></div>`],
    ['drafts', 'Drafts', (d) => html`<div class="hit"><a class="hit-title" href="#/draft/${d.id}">${d.title}</a>
      <div class="row small" style="margin-top:5px">${status(d.status)}<span class="chip">${channelLabel(d.channel, d.format)}</span><span class="faint mono">${fmtDate(d.updated_at)}</span></div></div>`],
    ['notes', 'Notes', (n) => html`<div class="hit"><div class="row small"><span class="chip red">private note</span><span class="chip">${n.kind || 'note'}</span>
      ${n.draft_id ? html`<a href="#/draft/${n.draft_id}" class="mono">draft #${n.draft_id} →</a>` : ''}</div>
      <div style="margin-top:5px">${snippet(n.text, 300)}</div></div>`]
  ].filter(([k]) => r[k]);
  const total = groups.reduce((n, [k]) => n + r[k].length, 0);
  if (!total) return html`<div class="empty">No matches. Try fewer filters or a shorter phrase.</div>`;
  return html`<p class="mono faint" style="margin:0 0 10px">${total} result${total === 1 ? '' : 's'}</p>
    <div class="stack">${groups.filter(([k]) => r[k].length).map(([k, title, row]) => html`<section class="card">
      <div class="row between"><h3>${title}</h3><span class="mono faint">${r[k].length}${r[k].length >= 50 ? '+' : ''}</span></div>
      ${r[k].map(row)}</section>`)}</div>`;
}

export async function render(view) {
  const [settings, sources, employers] = await Promise.all([api.get('/settings'), api.get('/sources'), api.get('/employers').catch(() => [])]);
  const el = document.createElement('div');
  view.replaceChildren(el);
  const q = ui.q;
  const sel = (name, list, cur) => html`<select name="${name}">${list.map(([v, l]) => html`<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${l}</option>`)}</select>`;

  el.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker">Archive</div>
      <h1>Search everything</h1>
      <p class="lede">Stories, extracted claims, past briefs, drafts and your notes. Notes are private and never appear in exports.</p>
    </div>
  </div>
  <div class="split">
    <div data-results class="reveal"><div class="muted"><span class="spinner"></span> Searching…</div></div>
    <form class="card stack" data-form="search">
      <label class="field">Text<input name="q" value="${q.q}" placeholder="e.g. evaluation harness" autofocus></label>
      <div><div class="mono faint small" style="margin-bottom:6px">INCLUDE</div>
        <div class="row">${TYPES.map(([k, l]) => html`<label class="check"><input type="checkbox" name="type" value="${k}" ${q.type.includes(k) ? 'checked' : ''}> ${l}</label>`)}</div></div>
      <label class="field">Topic${sel('topic', [['', 'Any topic'], ...settings.priorities.map(p => [p.topic, p.topic])], q.topic)}</label>
      <label class="field">Company${sel('company', [['', 'Any company'], ...employers.map(e => [e.name, e.name])], q.company)}</label>
      <label class="field">Source${sel('source', [['', 'Any source'], ...sources.map(s => [s.id, s.is_demo ? `${s.name} (demo)` : s.name])], q.source)}</label>
      <div class="form-grid"><label class="field">From<input type="date" name="from" value="${q.from}"></label><label class="field">To<input type="date" name="to" value="${q.to}"></label></div>
      <label class="field">Status${sel('status', STATUSES, q.status)}</label>
      <p class="set-note" style="margin:0">Topic, company and source filters apply to stories (source also to claims); status applies to stories and drafts; dates apply to stories, briefs and drafts.</p>
      <div class="row"><button class="primary" type="submit">Search</button><button type="button" class="ghost" data-act="clear">Clear filters</button></div>
    </form>
  </div>`);

  const out = el.querySelector('[data-results]');
  const search = async () => {
    const p = new URLSearchParams();
    if (!q.type.length) { out.innerHTML = String(html`<div class="empty">Choose at least one type to search.</div>`); return; }
    p.set('type', q.type.join(','));
    for (const k of ['q', 'topic', 'company', 'source', 'from', 'to', 'status']) if (q[k]) p.set(k, q[k]);
    try { out.innerHTML = String(results(await api.get(`/search?${p}`))); }
    catch (e) { out.innerHTML = String(html`<div class="empty ctl-err">${e.message}</div>`); }
  };

  on(el, 'submit', '[data-form="search"]', async (e, f) => {
    e.preventDefault();
    const fd = new FormData(f);
    ui.q = Object.assign(q, Object.fromEntries([...fd].filter(([k]) => k !== 'type')), { type: fd.getAll('type') });
    await act(f.querySelector('button[type=submit]'), search, 'Searching…');
  });
  on(el, 'click', '[data-act="clear"]', () => { ui.q = { q: '', type: TYPES.map(t => t[0]), topic: '', company: '', source: '', from: '', to: '', status: '' }; render(view); });
  await search();
}
