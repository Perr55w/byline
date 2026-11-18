import { api } from '../api.js';
import { html, on, act, toast, modal, confirmBox, strikeOut, status, fmtDate, channelLabel } from '../ui.js';

const rowOf = (b) => b.closest('tr, [data-exp], .source-row, .watch-row, .card, li') || b.parentElement;

const fresh = (el) => { const root = document.createElement('div'); el.replaceChildren(root); return root; };
const list = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const EVENT_KINDS = ['event', 'info session', 'career fair', 'webinar', 'meetup', 'conference', 'application'];

export async function render(el, ctx = {}) {
  if (ctx.params?.[0]) return renderActivity(el, ctx.params[0], ctx);
  const employers = await api.get('/employers');
  const root = fresh(el);
  root.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker">Target employers</div>
      <h1>Employers</h1>
      <p class="lede">Companies and the specific teams you follow. Related organizations stay separate — Cox Enterprises and Cox Automotive, or Google Cloud, DeepMind, and other Google teams — so evidence is never pooled across them.</p>
    </div>
    <div class="row"><button class="primary" data-act="add">Add employer</button></div>
  </div>
  ${employers.length ? html`<div class="grid g3 reveal">${employers.map(e => html`<section class="card ${e.pinned ? 'pinned' : ''}">
    <div class="row between">
      <div><a href="#/employers/${e.id}" class="emp-name">${e.name}</a>${e.parent ? html`<div class="faint small">part of ${e.parent} · tracked separately</div>` : ''}</div>
      <button class="sm ${e.pinned ? 'amber' : 'ghost'}" data-pin="${e.id}" data-on="${e.pinned ? 1 : 0}" title="${e.pinned ? 'Unpin' : 'Pin to top'}">${e.pinned ? 'Pinned' : 'Pin'}</button>
    </div>
    <div class="row" style="margin-top:10px">${e.topics.map(t => html`<span class="chip violet">${t}</span>`)}</div>
    <div class="row mono faint" style="margin-top:10px">${e.story_count} stories · ${e.contact_count} contacts · ${e.teams.length} teams</div>
    <div class="hr" style="margin:12px 0"></div>
    <div class="row between"><h3 style="margin:0">Teams</h3><button class="sm ghost" data-team-add="${e.id}">+ Team</button></div>
    ${e.teams.length ? e.teams.map(t => html`<div class="row between list-row">
      <span><span class="small">${t.name}</span> ${t.pinned ? html`<span class="chip amber">pinned</span>` : ''}<div class="faint small">${(t.terms || []).join(', ')}</div></span>
      <span class="row"><button class="sm ghost" data-team-pin="${t.id}" data-on="${t.pinned ? 1 : 0}">${t.pinned ? 'Unpin' : 'Pin'}</button><button class="sm ghost" data-team-del="${t.id}">✕</button></span></div>`)
    : html`<p class="faint small">No teams yet.</p>`}
    <div class="row" style="margin-top:12px"><a class="btn" href="#/employers/${e.id}">Activity →</a><button data-edit="${e.id}">Edit</button></div>
  </section>`)}</div>` : html`<div class="empty">No employers yet.</div>`}`);

  const again = () => render(el, ctx);
  const byId = (id) => employers.find(e => e.id === Number(id));
  on(root, 'click', '[data-pin]', (e, b) => act(b, async () => { await api.patch(`/employers/${b.dataset.pin}`, { pinned: b.dataset.on !== '1' }); again(); }));
  on(root, 'click', '[data-team-pin]', (e, b) => act(b, async () => { await api.patch(`/watchlists/${b.dataset.teamPin}`, { pinned: b.dataset.on !== '1' }); again(); }));
  on(root, 'click', '[data-team-del]', (e, b) => { const id = b.dataset.teamDel; strikeOut(rowOf(b), { message: 'Team watchlist removed.', commit: () => api.del(`/watchlists/${id}`) }); });
  on(root, 'click', '[data-team-add]', (e, b) => {
    const emp = byId(b.dataset.teamAdd);
    formModal(html`<h2>Add a team at ${emp.name}</h2>
      <label class="field">Team name *<input name="name" required></label>
      <label class="field">Match terms (comma-separated)<input name="terms" placeholder="e.g. watsonx.governance, AI governance"></label>
      <label class="check"><input type="checkbox" name="pinned"> Pin this team</label>`, 'Add team', async (f) => {
      await api.post('/watchlists', { kind: 'team', employer: emp.name, name: f.get('name'), terms: list(f.get('terms')), pinned: !!f.get('pinned') });
      toast('Team added', 'ok'); again();
    });
  });
  on(root, 'click', '[data-edit]', (e, b) => {
    const emp = byId(b.dataset.edit);
    formModal(html`<h2>Edit ${emp.name}</h2>
      <label class="field">Name<input name="name" value="${emp.name}"></label>
      <label class="field">Parent organization (shown, but tracked separately)<input name="parent" value="${emp.parent || ''}"></label>
      <label class="field">Topics (comma-separated)<input name="topics" value="${emp.topics.join(', ')}"></label>
      <label class="field">Match terms (comma-separated)<textarea name="terms" rows="3">${emp.terms.join(', ')}</textarea></label>
      <label class="field">Notes<textarea name="notes" rows="2">${emp.notes || ''}</textarea></label>
      <div><button type="button" class="danger sm" data-delete-emp>Delete employer</button></div>`, 'Save', async (f) => {
      await api.patch(`/employers/${emp.id}`, { name: f.get('name'), parent: f.get('parent') || null, topics: list(f.get('topics')), terms: list(f.get('terms')), notes: f.get('notes') });
      toast('Saved', 'ok'); again();
    }, (m) => m.el.querySelector('[data-delete-emp]').onclick = async () => {
      if (!(await confirmBox(`Delete ${emp.name}? Its team watchlists stay but are no longer grouped.`, 'Delete'))) return;
      try { await api.del(`/employers/${emp.id}`); m.close(); again(); } catch (err) { toast(err.message, 'err'); }
    });
  });
  on(root, 'click', '[data-act="add"]', () => formModal(html`<h2>Add employer</h2>
      <label class="field">Name *<input name="name" required></label>
      <label class="field">Parent organization (optional)<input name="parent"></label>
      <label class="field">Topics (comma-separated)<input name="topics"></label>
      <label class="field">Match terms (comma-separated)<input name="terms"></label>
      <label class="check"><input type="checkbox" name="pinned"> Pin</label>`, 'Add employer', async (f) => {
    await api.post('/employers', { name: f.get('name'), parent: f.get('parent') || null, topics: list(f.get('topics')), terms: list(f.get('terms')), pinned: !!f.get('pinned') });
    toast('Employer added', 'ok'); again();
  }));
}

function formModal(body, okLabel, onSubmit, after) {
  const m = modal(String(html`<form class="stack">${body}<div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">${okLabel}</button></div></form>`));
  m.el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await act(e.submitter, async () => { await onSubmit(new FormData(e.target)); m.close(); });
  });
  after?.(m);
  m.el.querySelector('input')?.focus();
  return m;
}

async function renderActivity(el, id, ctx) {
  const a = await api.get(`/employers/${id}/activity`);
  const e = a.employer;
  const root = fresh(el);
  const section = (title, items, row, empty) => html`<section class="card"><div class="row between"><h3 style="margin:0">${title}</h3><span class="mono faint">${items.length}</span></div>
    <div style="margin-top:10px">${items.length ? items.map(row) : html`<p class="muted small">${empty}</p>`}</div></section>`;
  root.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker"><a href="#/employers">← Employers</a></div>
      <h1>${e.name}</h1>
      <p class="lede">${e.parent ? `Part of ${e.parent}, tracked separately. ` : ''}Everything you've read, written, built, attended, and discussed related to ${e.name}.</p>
      <div class="row" style="margin-top:10px">${e.topics.map(t => html`<span class="chip violet">${t}</span>`)}</div>
    </div>
  </div>
  <div class="split">
    <div class="stack reveal">
      ${section('Stories mentioning ' + e.name, a.stories, s => html`<div class="row between list-row"><a href="#/story/${s.id}" style="color:var(--text);max-width:75%">${s.title}</a><span class="row">${s.topics.slice(0, 2).map(t => html`<span class="chip">${t}</span>`)}<span class="mono faint">${fmtDate(s.updated_at, { month: 'short', day: 'numeric' })}</span></span></div>`, 'No stories mention this employer yet.')}
      ${section('Covered in your drafts', a.covered, d => html`<div class="row between list-row"><a href="#/draft/${d.id}">${d.title}</a><span class="row">${status(d.status)}<span class="chip">${channelLabel(d.channel)}</span></span></div>`, 'No approved or published coverage yet.')}
      ${section('Projects', a.projects, p => html`<div class="row between list-row"><a href="#/career/projects">${p.title}</a><span class="chip">${p.status}</span></div>`, 'No projects connected to this employer.')}
      ${section('Conversations', a.conversations, c => html`<div class="list-row"><div class="row between"><a href="#/person/${c.contact_id}">${c.name}</a><span class="row"><span class="chip">${(c.kind || '').replace(/_/g, ' ')}</span><span class="mono faint">${c.date}</span></span></div>${c.notes ? html`<div class="small muted">${c.notes}</div>` : ''}</div>`, 'No logged conversations with people here.')}
    </div>
    <div class="stack reveal">
      <section class="card ledger">
        <h3>Topics</h3>
        <div class="faint small">Repeated in stories</div>
        <div class="row" style="margin:6px 0 12px">${a.repeated_topics.length ? a.repeated_topics.map(([t, n]) => html`<span class="chip ${a.covered_topics.includes(t) ? 'green' : 'violet'}">${t} · ${n}</span>`) : html`<span class="muted small">—</span>`}</div>
        <div class="faint small">Unexplored (your focus topics without coverage)</div>
        <div class="row" style="margin-top:6px">${a.unexplored.length ? a.unexplored.map(t => html`<span class="chip amber">${t}</span>`) : html`<span class="muted small">All focus topics covered.</span>`}</div>
      </section>
      <section class="card">
        <h3>Events</h3>
        <form id="ev" class="stack">
          <label class="field">Title *<input name="title" required placeholder="e.g. KSU career fair booth"></label>
          <div class="form-grid"><label class="field">Date<input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></label>
            <label class="field">Kind<select name="kind">${EVENT_KINDS.map(k => html`<option>${k}</option>`)}</select></label></div>
          <label class="field">Notes<textarea name="notes" rows="2"></textarea></label>
          <div class="row" style="justify-content:flex-end"><button type="submit">Log event</button></div>
        </form>
        <div style="margin-top:12px">${a.events.length ? a.events.map(v => html`<div class="list-row"><div class="row between"><strong class="small">${v.title}</strong><span class="row"><span class="chip">${v.kind}</span><span class="mono faint">${v.date}</span></span></div>${v.notes ? html`<div class="small muted">${v.notes}</div>` : ''}</div>`) : html`<p class="muted small">No events logged.</p>`}</div>
      </section>
    </div>
  </div>`);
  root.querySelector('#ev').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await act(ev.submitter, async () => { await api.post('/events', { ...Object.fromEntries(new FormData(ev.target)), employer: e.name }); toast('Event logged', 'ok'); renderActivity(el, id, ctx); });
  });
}
