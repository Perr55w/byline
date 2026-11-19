// Employers (v4). F §2 Employers: "{Employer} appears in {n} stories." / ties "{A} and {B} lead, {n} stories each."
// and "{with} of {total} employers appear in your stories; pinned with none yet: {names}. {contacts} contacts linked."
// story_count is all-time, and labelled that way. One house palette: no brand colours anywhere.
// The list is a coverage table: stories per employer as labelled bars, people linked, team watchlists (pin /
// remove / add), pin and edit. Kept from v3: add / edit / delete employer (parent shown but tracked separately,
// topics, match terms, notes), team watchlists, and the activity page (stories, covered drafts, projects,
// conversations, repeated and unexplored topics, events with the log form).
import { api } from '../api.js';
import { html, on, act, toast, modal, confirmBox, strikeOut, status, channelLabel, scoreChip, icon, useStyle } from '../ui.js';
import { plural, listJoin, dayLabel, stripDemo } from './people.js';

const list = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
const EVENT_KINDS = ['event', 'info session', 'career fair', 'webinar', 'meetup', 'conference', 'application'];

function headline(emps) {
  const withS = emps.filter(e => e.story_count > 0);
  const contacts = emps.reduce((n, e) => n + e.contact_count, 0);
  const pinnedNone = emps.filter(e => e.pinned && !e.story_count).map(e => e.name);
  let h;
  if (!emps.length) h = 'No employers yet.';
  else if (!withS.length) h = 'No employer appears in your stories yet.';
  else {
    const max = Math.max(...withS.map(e => e.story_count));
    const lead = withS.filter(e => e.story_count === max);
    h = lead.length === 1 ? `${lead[0].name} appears in ${plural(max, 'story', 'stories')}.`
      : lead.length <= 4 ? `${listJoin(lead.map(e => e.name))} lead, ${plural(max, 'story', 'stories')} each.`
      : `${lead.length} employers tie for the lead, ${plural(max, 'story', 'stories')} each.`;
  }
  const l = !emps.length ? html`Add the companies you want to work for; Byline matches them in every story it ranks.`
    : html`<b>${withS.length}</b> of <b>${emps.length}</b> employers appear in your stories${pinnedNone.length ? html`; pinned with none yet: <b>${listJoin(pinnedNone)}</b>` : ''}. ${contacts ? html`<b>${contacts}</b> ${contacts === 1 ? 'person is' : 'people are'} linked.` : 'No people are linked to an employer yet.'}`;
  return { h, l };
}

export async function render(el, ctx = {}) {
  await useStyle('/css/v4/employers.css');
  if (ctx.params?.[0]) return renderActivity(el, ctx.params[0], ctx);
  const employers = await api.get('/employers');
  const hd = headline(employers);
  const rows = [...employers].sort((a, b) => b.story_count - a.story_count || b.pinned - a.pinned || a.name.localeCompare(b.name));
  const max = Math.max(1, ...employers.map(e => e.story_count));
  const teams = employers.reduce((n, e) => n + e.teams.length, 0);
  const lead = rows[0]?.story_count;

  const root = document.createElement('div');
  root.className = 'em';
  root.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow">Target employers</p>
    <h1>${hd.h}</h1>
    <p class="lede">${hd.l}</p>
    <div class="page-head-actions"><button class="btn btn--primary" data-act="add">${icon('plus')}Add employer</button></div>
  </header>

  <section class="tile tile--static tile--flush" aria-labelledby="em-t-h">
    <div class="section-head em-pad"><h2 class="t-h2" id="em-t-h">Coverage</h2><span class="section-meta">${employers.length} employers · ${employers.filter(e => e.pinned).length} pinned · ${plural(teams, 'team watchlist')} · stories counted all-time</span></div>
    ${employers.length ? html`<table class="table em-table">
      <thead><tr><th>Employer</th><th>Stories mentioning it <span class="em-th-sub">all-time</span></th><th class="num em-hide-sm">People</th><th>Team watchlists</th><th><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows.map(e => html`<tr data-row class="${e.pinned ? 'is-pinned' : ''}">
        <td class="em-emp">
          <a class="em-name" href="#/employers/${e.id}">${e.name}</a>${e.pinned ? html`<span class="tag tag--neutral em-pintag">Pinned</span>` : ''}
          ${e.parent ? html`<span class="em-sub">part of ${e.parent} · tracked separately</span>` : ''}
          <span class="em-topics">${e.topics.join(' · ') || 'No topics set'}</span>
        </td>
        <td class="em-cov"><span class="em-bar ${e.story_count ? '' : 'is-zero'} ${e.story_count === lead && lead ? 'is-lead' : ''}"><span class="meter"><i style="--v:${e.story_count / max}"></i></span><b>${e.story_count}</b></span></td>
        <td class="num em-hide-sm">${e.contact_count}</td>
        <td class="em-teams">${e.teams.length ? e.teams.map(t => html`<span class="em-team" title="${(t.terms || []).length ? `Matches ${(t.terms || []).join(', ')}` : 'No match terms'}">
            <span>${t.name}</span>${t.pinned ? html`<span class="tag tag--neutral">Pinned</span>` : ''}
            <button class="btn btn--ghost btn--sm" data-team-pin="${t.id}" data-on="${t.pinned ? 1 : 0}" aria-label="${t.pinned ? 'Unpin' : 'Pin'} team ${t.name}">${t.pinned ? 'Unpin' : 'Pin'}</button>
            <button class="btn btn--ghost btn--sm btn--icon" data-team-del="${t.id}" aria-label="Remove team ${t.name}">${icon('x')}</button></span>`) : ''}
          <button class="btn btn--ghost btn--sm em-addteam" data-team-add="${e.id}">${icon('plus')}Team</button></td>
        <td class="em-act"><span class="cluster">
          <button class="btn btn--sm ${e.pinned ? '' : 'btn--ghost'}" data-pin="${e.id}" data-on="${e.pinned ? 1 : 0}" aria-pressed="${!!e.pinned}" aria-label="${e.pinned ? 'Unpin' : 'Pin'} ${e.name}">${e.pinned ? 'Unpin' : 'Pin'}</button>
          <button class="btn btn--sm" data-edit="${e.id}" aria-label="Edit ${e.name}">Edit</button>
          <a class="btn btn--sm btn--ghost" href="#/employers/${e.id}" aria-label="${e.name} activity">Activity${icon('arrow-right')}</a></span></td>
      </tr>`)}</tbody></table>`
    : html`<div class="em-pad em-padb"><div class="empty"><h3>No employers yet.</h3><p>Add the companies you want to work for. Stories that mention them are counted here, and their teams can be pinned to your watchlist.</p></div></div>`}
    ${employers.length ? html`<p class="em-foot em-pad">Matches use each employer’s name and capitalised match terms. A parent company is shown for context but its stories are not pooled with its subsidiaries.</p>` : ''}
  </section>`);
  el.replaceChildren(root);

  const again = () => render(el, ctx);
  const byId = (id) => employers.find(e => e.id === Number(id));
  on(root, 'click', '[data-pin]', (e, b) => act(b, async () => { await api.patch(`/employers/${b.dataset.pin}`, { pinned: b.dataset.on !== '1' }); toast(b.dataset.on === '1' ? 'Unpinned' : 'Pinned', 'ok'); again(); }));
  on(root, 'click', '[data-team-pin]', (e, b) => act(b, async () => { await api.patch(`/watchlists/${b.dataset.teamPin}`, { pinned: b.dataset.on !== '1' }); again(); }));
  on(root, 'click', '[data-team-del]', (e, b) => { const id = b.dataset.teamDel; strikeOut(b.closest('.em-team'), { message: 'Team watchlist removed.', commit: () => api.del(`/watchlists/${id}`) }); });
  on(root, 'click', '[data-team-add]', (e, b) => {
    const emp = byId(b.dataset.teamAdd);
    formModal(html`<h2>Add a team at ${emp.name}</h2>
      <label class="field">Team name *<input class="input" name="name" required></label>
      <label class="field">Match terms (comma-separated)<input class="input" name="terms" placeholder="e.g. watsonx.governance, AI governance"></label>
      <label class="em-check"><input type="checkbox" name="pinned"> Pin this team</label>`, 'Add team', async (f) => {
      await api.post('/watchlists', { kind: 'team', employer: emp.name, name: f.get('name'), terms: list(f.get('terms')), pinned: !!f.get('pinned') });
      toast('Team added', 'ok'); again();
    });
  });
  on(root, 'click', '[data-edit]', (e, b) => {
    const emp = byId(b.dataset.edit);
    formModal(html`<h2>Edit ${emp.name}</h2>
      <label class="field">Name<input class="input" name="name" value="${emp.name}"></label>
      <label class="field">Parent organisation (shown, but tracked separately)<input class="input" name="parent" value="${emp.parent || ''}"></label>
      <label class="field">Topics (comma-separated)<input class="input" name="topics" value="${emp.topics.join(', ')}"></label>
      <label class="field">Match terms (comma-separated)<textarea class="textarea" name="terms" rows="3">${emp.terms.join(', ')}</textarea></label>
      <label class="field">Notes<textarea class="textarea" name="notes" rows="2">${emp.notes || ''}</textarea></label>
      <div><button type="button" class="btn btn--danger btn--sm" data-delete-emp>Delete employer</button></div>`, 'Save', async (f) => {
      await api.patch(`/employers/${emp.id}`, { name: f.get('name'), parent: f.get('parent') || null, topics: list(f.get('topics')), terms: list(f.get('terms')), notes: f.get('notes') });
      toast('Saved', 'ok'); again();
    }, (m) => { m.el.querySelector('[data-delete-emp]').onclick = async () => {
      if (!(await confirmBox(`Delete ${emp.name}? Its team watchlists stay but are no longer grouped.`, 'Delete'))) return;
      try { await api.del(`/employers/${emp.id}`); m.close(); toast('Employer deleted', 'ok'); again(); } catch (err) { toast(err.message, 'err'); }
    }; });
  });
  on(root, 'click', '[data-act="add"]', () => formModal(html`<h2>Add employer</h2>
      <label class="field">Name *<input class="input" name="name" required></label>
      <label class="field">Parent organisation (optional)<input class="input" name="parent"></label>
      <label class="field">Topics (comma-separated)<input class="input" name="topics"></label>
      <label class="field">Match terms (comma-separated)<input class="input" name="terms"></label>
      <label class="em-check"><input type="checkbox" name="pinned"> Pin</label>`, 'Add employer', async (f) => {
    await api.post('/employers', { name: f.get('name'), parent: f.get('parent') || null, topics: list(f.get('topics')), terms: list(f.get('terms')), pinned: !!f.get('pinned') });
    toast('Employer added', 'ok'); again();
  }));
}

function formModal(body, okLabel, onSubmit, after) {
  const m = modal(String(html`<form class="stack em-form">${body}<div class="modal-actions"><button type="button" class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" type="submit">${okLabel}</button></div></form>`));
  m.el.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await act(e.submitter, async () => { await onSubmit(new FormData(e.target)); m.close(); });
  });
  after?.(m);
  m.el.querySelector('input')?.focus();
  return m;
}

// ------------------------------------------------------------------ activity
async function renderActivity(el, id, ctx) {
  const [a, today] = await Promise.all([api.get(`/employers/${id}/activity`), api.get('/today').catch(() => null)]);
  const T = today?.threshold ?? window.__byline?.threshold ?? 55;
  const e = a.employer;
  const todayYmd = today?.today || new Date().toISOString().slice(0, 10);
  const section = (title, items, row, empty, cls = '') => html`<section class="tile tile--static em-card ${cls}" aria-label="${title}">
    <div class="section-head"><h2 class="t-h2">${title}</h2><span class="section-meta">${items.length}</span></div>
    ${items.length ? html`<ul class="em-list">${items.map(row)}</ul>` : html`<p class="em-note">${empty}</p>`}</section>`;
  const lede = html`${e.parent ? html`Part of ${e.parent}, tracked separately. ` : ''}<b>${a.stories.length}</b> ${a.stories.length === 1 ? 'story mentions' : 'stories mention'} ${e.name} (all-time); <b>${a.covered.length}</b> approved or published ${a.covered.length === 1 ? 'draft covers' : 'drafts cover'} it; <b>${a.projects.length}</b> ${a.projects.length === 1 ? 'project' : 'projects'}, <b>${a.conversations.length}</b> ${a.conversations.length === 1 ? 'conversation' : 'conversations'} and <b>${a.events.length}</b> ${a.events.length === 1 ? 'event' : 'events'} logged.`;

  const root = document.createElement('div');
  root.className = 'em em-activity';
  root.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow"><a class="em-back" href="#/employers">${icon('chevron-left')}Employers</a></p>
    <h1>${e.name}</h1>
    <p class="lede">${lede}</p>
  </header>
  <div class="em-tagrow cluster">${e.pinned ? html`<span class="tag tag--neutral">Pinned</span>` : ''}${e.topics.map(t => html`<span class="chip">${t}</span>`)}</div>
  <div class="em-cols">
    <div class="stack">
      ${(() => {
        const secs = [
          [`Stories mentioning ${e.name}`, a.stories, s => html`<li class="em-story" data-dossier-src>${typeof s.score === 'number' ? scoreChip(s.score, T) : ''}<div><a class="em-story-t" href="#/story/${s.id}">${s.title}</a>
            <span class="em-sub">${s.topics.slice(0, 2).join(' · ')}${s.topics.length ? ' · ' : ''}updated ${dayLabel((s.updated_at || '').slice(0, 10), { weekday: false })}</span></div></li>`, 'No stories mention this employer yet.'],
          ['Covered in your drafts', a.covered, d => html`<li class="em-row"><a href="#/draft/${d.id}">${d.title}</a><span class="cluster">${status(d.status)}<span class="chip">${channelLabel(d.channel)}</span></span></li>`, 'No approved or published draft covers it yet.'],
          ['Projects', a.projects, p => html`<li class="em-row"><a href="#/career/projects">${p.title}</a><span class="tag tag--neutral">${p.status}</span></li>`, 'No project is connected to this employer.'],
          ['Conversations', a.conversations, c => html`<li><div class="em-row"><a href="#/person/${c.contact_id}">${stripDemo(c.name)}</a><span class="cluster"><span class="tag tag--neutral">${(c.kind || '').replace(/_/g, ' ')}</span><span class="em-mono">${dayLabel(c.date, { weekday: false })}</span></span></div>${c.notes ? html`<p class="em-note">${c.notes}</p>` : ''}</li>`, 'No logged conversations with people here.']
        ];
        const full = secs.filter(x => x[1].length), empty = secs.filter(x => !x[1].length);
        return html`${full.map(x => section(...x))}${empty.length ? html`<section class="tile tile--static em-card" aria-labelledby="em-none-h">
          <h2 class="section-label" id="em-none-h">Nothing here yet</h2>
          <dl class="em-none">${empty.map(([t, , , msg]) => html`<div><dt>${t} <span class="em-mono">0</span></dt><dd>${msg}</dd></div>`)}</dl></section>` : ''}`;
      })()}
    </div>
    <aside class="stack">
      <section class="tile tile--static em-card" aria-labelledby="em-tp-h">
        <h2 class="section-label" id="em-tp-h">Topics in its stories</h2>
        ${a.repeated_topics.length ? html`<ul class="em-tcounts">${a.repeated_topics.map(([t, n]) => html`<li><span>${t}</span><span class="meter"><i style="--v:${n / a.repeated_topics[0][1]}"></i></span><b>${n}</b>${a.covered_topics.includes(t) ? html`<span class="tag tag--ok">covered</span>` : ''}</li>`)}</ul>` : html`<p class="em-note">No stories yet, so no topics.</p>`}
        <h3 class="em-h3">Unexplored focus topics</h3>
        ${a.unexplored.length ? html`<div class="cluster">${a.unexplored.map(t => html`<span class="chip">${t}</span>`)}</div>` : html`<p class="em-note">All focus topics have coverage.</p>`}
      </section>
      <section class="tile tile--static em-card" aria-labelledby="em-ev-h">
        <h2 class="section-label" id="em-ev-h">Events · ${a.events.length}</h2>
        <form id="ev" class="em-evform">
          <label class="field em-full">Title *<input class="input" name="title" required placeholder="e.g. KSU career fair booth"></label>
          <label class="field">Date<input class="input" type="date" name="date" value="${todayYmd}"></label>
          <label class="field">Kind<select class="select" name="kind">${EVENT_KINDS.map(k => html`<option>${k}</option>`)}</select></label>
          <label class="field em-full">Notes<textarea class="textarea" name="notes" rows="2"></textarea></label>
          <div class="em-full em-end"><button class="btn" type="submit">Log event</button></div>
        </form>
        ${a.events.length ? html`<ul class="em-list em-events">${a.events.map(v => html`<li><div class="em-row"><b>${v.title}</b><span class="cluster"><span class="tag tag--neutral">${v.kind}</span><span class="em-mono">${dayLabel(v.date, { weekday: false })}</span></span></div>${v.notes ? html`<p class="em-note">${v.notes}</p>` : ''}</li>`)}</ul>` : html`<p class="em-note">No events logged.</p>`}
      </section>
    </aside>
  </div>`);
  el.replaceChildren(root);
  root.querySelector('#ev').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await act(ev.submitter, async () => { await api.post('/events', { ...Object.fromEntries(new FormData(ev.target)), employer: e.name }); toast('Event logged', 'ok'); renderActivity(el, id, ctx); });
  });
}
