// Employers (v4). F §2 Employers: "{Employer} appears in {n} stories." / ties "{A} and {B} lead, {n} stories each."
// and "{with} of {total} employers appear in your stories; pinned with none yet: {names}. {contacts} contacts linked."
// story_count is all-time, and labelled that way. One house palette: no brand colours anywhere.
// The list is a coverage table: stories per employer as labelled bars, people linked, team watchlists (pin /
// remove / add), pin and edit. Kept from v3: add / edit / delete employer (parent shown but tracked separately,
// topics, match terms, notes), team watchlists, and the activity page (stories, covered drafts, projects,
// conversations, repeated and unexplored topics, events with the log form).
import { api } from '../api.js';
import { html, raw, on, act, toast, modal, confirmBox, strikeOut, status, channelLabel, scoreChip, icon, useStyle } from '../ui.js';
import { plural, listJoin, dayLabel, stripDemo } from './people.js';

const list = (s) => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
// Pin glyph (hand-drawn, 1.5 px stroke like the rail icons); filled when pressed via CSS.
const PIN = raw('<svg class="em-pin-i" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M6 2.5h4l-.6 4 2.1 2v1.2H4.5V8.5l2.1-2z"/><path class="em-pin-stem" d="M8 9.7v3.8"/></svg>');
const EVENT_KINDS = ['event', 'info session', 'career fair', 'webinar', 'meetup', 'conference', 'application'];

function headline(emps) {
  const withS = emps.filter(e => e.story_count > 0);
  const contacts = emps.reduce((n, e) => n + e.contact_count, 0);
  const pinnedNone = emps.filter(e => e.pinned && !e.story_count).map(e => e.name);
  let h, tie = null;
  if (!emps.length) h = 'No employers yet.';
  else if (!withS.length) h = 'No employer appears in your stories yet.';
  else {
    const max = Math.max(...withS.map(e => e.story_count));
    const lead = withS.filter(e => e.story_count === max);
    // Three or more ties: count in the headline, names in the one-liner (keeps the h1 to two lines).
    if (lead.length >= 3) { h = `${lead.length} employers tie for the lead with ${plural(max, 'story', 'stories')} each.`; tie = { names: lead.map(e => e.name), n: max }; }
    else h = lead.length === 1 ? `${lead[0].name} appears in ${plural(max, 'story', 'stories')}.` : `${listJoin(lead.map(e => e.name))} lead, ${plural(max, 'story', 'stories')} each.`;
  }
  const l = !emps.length ? html`Add the companies you want to work for; Byline matches them in every story it ranks.`
    : html`${tie ? html`<b>${listJoin(tie.names)}</b> each appear in ${tie.n}. ` : ''}<b>${withS.length}</b> of <b>${emps.length}</b> employers appear in your stories${pinnedNone.length ? html`; pinned with none yet: <b>${listJoin(pinnedNone)}</b>` : ''}. ${contacts ? html`<b>${contacts}</b> ${contacts === 1 ? 'person is' : 'people are'} linked.` : 'No people are linked to an employer yet.'}`;
  return { h, l };
}

// Short story title for the coverage table (E-1), 48 characters at most so it fits one line: a title that already
// fits is kept whole; a longer one keeps the text before ':' or ' — ' (when that part is a real phrase, not
// "Study"), then is cut at a word boundary. The full title stays in `title`.
export function shortTitle(st) {
  const base = String(st.short_title && !/…$/.test(st.short_title) ? st.short_title : st.title || '').trim();
  let t = base;
  const m = base.length > 48 && base.match(/^(.+?)(?::\s| — )/);
  if (m && m[1].length >= 12 && m[1].split(/\s+/).length >= 2) t = m[1];
  if (t.length > 48) { const cut = t.slice(0, 48); const sp = cut.lastIndexOf(' '); t = `${(sp > 24 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–—-]+$/, '')}…`; }
  return t;
}

export async function render(el, ctx = {}) {
  await useStyle('/css/v4/employers.css');
  if (ctx.params?.[0]) return renderActivity(el, ctx.params[0], ctx);
  const [employers, storiesRaw] = await Promise.all([api.get('/employers'), api.get('/stories?limit=200').catch(() => [])]);
  const hd = headline(employers);
  const rows = [...employers].sort((a, b) => b.story_count - a.story_count || b.pinned - a.pinned || a.name.localeCompare(b.name));
  const covered = rows.filter(e => e.story_count > 0);
  // No-stories employers collapse into one line (E-4): pinned first (with the pin glyph), then the rest.
  const none = rows.filter(e => !e.story_count);
  const nonePinned = none.filter(e => e.pinned), noneOther = none.filter(e => !e.pinned);
  const max = Math.max(1, ...covered.map(e => e.story_count));
  // Bars only say something when counts differ (E-5): identical full bars are hidden, the count stays.
  const showBars = covered.some(e => e.story_count !== max);
  const teams = employers.reduce((n, e) => n + e.teams.length, 0);
  const anyPeople = employers.some(e => e.contact_count > 0);
  // Story titles behind each count. Prefer the server's own story ids (S12); otherwise the same match the server
  // counts with (stories.companies holds the exact employer name), highest score first. If the server count is
  // lower than the client match (a sibling such as "Google Cloud" took the hit), stories shared with a sibling
  // under the same parent are dropped first, and the list never exceeds the count. Archived stories are not
  // listed by /api/stories, so a count can exceed the titles shown; the remainder is stated, never guessed.
  const stories = Array.isArray(storiesRaw) ? storiesRaw : (storiesRaw?.stories || []);
  const byStory = new Map(stories.map(s => [s.id, s]));
  const mentions = (e) => {
    if (Array.isArray(e.story_ids)) return e.story_ids.map(id => byStory.get(id)).filter(Boolean);
    let ms = stories.filter(s => (s.companies || []).includes(e.name));
    if (ms.length > e.story_count) {
      const sibs = employers.filter(o => o !== e && e.parent && o.parent === e.parent).map(o => o.name);
      ms = [...ms.filter(s => !(s.companies || []).some(c => sibs.includes(c))), ...ms.filter(s => (s.companies || []).some(c => sibs.includes(c)))].slice(0, e.story_count);
    }
    return ms;
  };
  // Identical story sets (R14): a row whose story ids equal an earlier row's says so instead of repeating titles.
  const seen = [];
  const cov = covered.map(e => {
    const ms = mentions(e);
    const key = ms.map(s => s.id).sort((a, b) => a - b).join(',');
    const same = ms.length && ms.length === e.story_count ? seen.find(x => x.key === key) : null;
    if (!same && ms.length) seen.push({ key, name: e.name });
    return { e, ms, same };
  });
  const long = rows.length > 30;
  const pinTitle = (e) => e.pinned ? 'Pinned: stories that mention it get the larger ranking boost. Click to unpin.' : 'Pin: stories that mention it get a larger ranking boost';
  const watchLine = (e) => {
    const fol = e.teams.filter(t => t.pinned), oth = e.teams.filter(t => !t.pinned);
    const tip = (t) => (t.terms || []).length ? `Matches ${(t.terms || []).join(', ')}` : 'No match terms';
    const part = (label, ts) => ts.length ? html`<span class="em-wl-part">${label}: ${ts.map((t, i) => html`${i ? ', ' : ''}<span class="em-team" data-team="${t.id}" title="${tip(t)}">${t.name}</span>`)}</span>` : '';
    return e.teams.length ? html`<span class="em-wl">${part('Following', fol)}${fol.length && oth.length ? ' · ' : ''}${part(oth.length === 1 ? 'Team watchlist' : 'Team watchlists', oth)}</span>` : '';
  };
  const menu = (e) => html`<span class="em-menu"><button type="button" class="btn btn--ghost btn--sm btn--icon em-more-btn" data-menu="${e.id}" aria-haspopup="menu" aria-expanded="false" aria-controls="em-menu-${e.id}" aria-label="More actions for ${e.name}">${icon('more')}</button>
    <div class="em-menu-pop" id="em-menu-${e.id}" role="menu" aria-label="${e.name} actions" hidden>
      <button type="button" role="menuitem" tabindex="-1" data-edit="${e.id}">Edit ${e.name}…</button>
      <button type="button" role="menuitem" tabindex="-1" data-team-add="${e.id}">Add a team watchlist…</button>
      ${e.teams.map(t => html`<div class="em-menu-sep" role="separator"></div>
      <button type="button" role="menuitem" tabindex="-1" data-team-pin="${t.id}" data-on="${t.pinned ? 1 : 0}">${t.pinned ? 'Unfollow' : 'Follow'} ${t.name}</button>
      <button type="button" role="menuitem" tabindex="-1" data-team-del="${t.id}">Remove ${t.name}</button>`)}
    </div></span>`;
  const noneLink = (e) => html`<a class="em-none-l" href="#/employers/${e.id}" title="${e.name} activity">${e.name}</a>`;

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
    <div class="section-head em-pad"><h2 class="t-h2" id="em-t-h">Coverage</h2><span class="section-meta">${employers.length} employers · ${employers.filter(e => e.pinned).length} pinned · ${plural(teams, 'team watchlist')} · stories counted all-time${anyPeople ? '' : ' · no people linked yet'}</span></div>
    ${employers.length ? html`<table class="table em-table${showBars ? '' : ' em-nobars'}">
      <colgroup><col class="em-c-emp"><col class="em-c-cov"><col class="em-c-act"></colgroup>
      <thead><tr><th class="em-emp">Employer</th><th class="em-cov">Stories mentioning it <span class="em-th-sub">all-time</span></th><th class="em-act"><span class="sr-only">Activity and actions</span></th></tr></thead>
      <tbody>${cov.map(({ e, ms, same }) => { const shown = same ? [] : ms.slice(0, 2); const rest = e.story_count - (same ? e.story_count : shown.length); return html`<tr data-row data-emp="${e.id}"${long ? raw(' class="cv-row"') : ''}>
        <td class="em-emp">
          <div class="em-namerow"><a class="em-name" href="#/employers/${e.id}">${e.name}</a>
            <button type="button" class="em-pin" data-pin="${e.id}" data-on="${e.pinned ? 1 : 0}" aria-pressed="${String(!!e.pinned)}" aria-label="Pin ${e.name}" title="${pinTitle(e)}">${PIN}</button></div>
          ${e.parent ? html`<span class="em-sub">Part of ${e.parent} · tracked separately</span>` : ''}
          <span class="em-topics" title="${e.topics.join(' · ')}">${e.topics.join(' · ') || 'No topics set'}</span>
          ${watchLine(e)}
          ${e.contact_count ? html`<span class="em-wl">${plural(e.contact_count, 'person', 'people')} linked</span>` : ''}
        </td>
        <td class="em-cov"><div class="em-covrow">
          ${showBars ? html`<span class="meter em-meter" aria-hidden="true"><i style="--v:${e.story_count / max}"></i></span>` : ''}<b class="em-count">${e.story_count}</b>
          <div class="em-covlist">
          ${same ? html`<p class="em-same">Same ${plural(e.story_count, 'story', 'stories')} as ${same.name}</p>`
            : shown.length ? html`<ul class="em-stories">${shown.map(st => html`<li data-dossier-src><a class="em-story-l" href="#/story/${st.id}" title="${st.title}">${shortTitle(st)}</a></li>`)}</ul>` : ''}
          ${!same && shown.length && rest > 0 ? html`<a class="em-more" href="#/employers/${e.id}">${rest} more</a>` : ''}
          </div></div></td>
        <td class="em-act"><span class="em-actrow">${menu(e)}<a class="em-activity" href="#/employers/${e.id}" aria-label="${e.name} activity">Activity${icon('arrow-right')}</a></span></td>
      </tr>`; })}
      ${none.length ? html`<tr class="em-nonerow"><td colspan="3"><p class="em-none-line"><span class="em-none-k">No stories yet</span>
        ${nonePinned.length ? html`<span class="em-none-g">${nonePinned.map((e, i) => html`${i ? ', ' : ''}${noneLink(e)}`)}<span class="em-none-pin" role="img" aria-label="pinned" title="Pinned">${PIN}</span></span>` : ''}
        ${noneOther.length ? html`<span class="em-none-g">${noneOther.map((e, i) => html`${i ? ', ' : ''}${noneLink(e)}`)}</span>` : ''}</p></td></tr>` : ''}
      </tbody></table>`
    : html`<div class="em-pad em-padb"><div class="empty"><h3>No employers yet.</h3><p>Add the companies you want to work for. Stories that mention them are counted here, and their teams can be followed on your watchlist.</p></div></div>`}
    ${employers.length ? html`<p class="em-foot em-pad">Matches use each employer’s name and capitalised match terms. A parent company is shown for context but its stories are not pooled with its subsidiaries. A pinned employer gives stories that mention it a larger ranking boost; a followed team’s matches weigh 1.5×. Pin, edit or log events for an employer with no stories from its Activity page.</p>` : ''}
  </section>`);
  el.replaceChildren(root);

  const again = () => render(el, ctx);
  const byId = (id) => employers.find(e => e.id === Number(id));
  // Row "···" menu: opens on click / Enter / Space / ArrowDown, arrows move between items, Esc or Tab out closes
  // and Esc returns focus to the trigger.
  let openMenu = null;
  const setMenu = (btn, open, focus = true) => {
    if (openMenu && openMenu !== btn) setMenu(openMenu, false, false);
    const pop = root.querySelector(`#${btn.getAttribute('aria-controls')}`);
    btn.setAttribute('aria-expanded', String(open));
    pop.hidden = !open;
    btn.closest('tr')?.classList.toggle('is-menu', open);
    openMenu = open ? btn : null;
    if (open && focus) pop.querySelector('[role=menuitem]')?.focus();
    if (!open && focus) btn.focus();
  };
  on(root, 'click', '[data-menu]', (e, b) => { e.stopPropagation(); setMenu(b, b.getAttribute('aria-expanded') !== 'true', e.detail === 0); });
  root.addEventListener('keydown', (e) => {
    const trig = e.target.closest?.('[data-menu]');
    if (trig && e.key === 'ArrowDown') { e.preventDefault(); setMenu(trig, true); return; }
    const pop = e.target.closest?.('.em-menu-pop');
    if (!pop) return;
    const btn = root.querySelector(`[aria-controls="${pop.id}"]`);
    const items = [...pop.querySelectorAll('[role=menuitem]')];
    const i = items.indexOf(e.target);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(btn, false); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); items[e.key === 'Home' ? 0 : items.length - 1].focus(); }
    else if (e.key === 'Tab') setMenu(btn, false, false);
  });
  const outside = (e) => { if (openMenu && !e.target.closest('.em-menu')) setMenu(openMenu, false, false); };
  document.addEventListener('pointerdown', outside, true);
  const onEsc = (e) => { if (e.key === 'Escape' && openMenu) { e.preventDefault(); setMenu(openMenu, false); } };
  document.addEventListener('keydown', onEsc);
  const cleanup = () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', onEsc); window.removeEventListener('hashchange', cleanup); };
  window.addEventListener('hashchange', cleanup);
  const closeMenus = () => { if (openMenu) setMenu(openMenu, false, false); };

  on(root, 'click', '[data-pin]', (e, b) => act(b, async () => { await api.patch(`/employers/${b.dataset.pin}`, { pinned: b.dataset.on !== '1' }); toast(b.dataset.on === '1' ? 'Unpinned' : 'Pinned', 'ok'); again(); }));
  on(root, 'click', '[data-team-pin]', (e, b) => { closeMenus(); act(b, async () => { await api.patch(`/watchlists/${b.dataset.teamPin}`, { pinned: b.dataset.on !== '1' }); toast(b.dataset.on === '1' ? 'Unfollowed' : 'Following', 'ok'); again(); }); });
  on(root, 'click', '[data-team-del]', (e, b) => { closeMenus(); const id = b.dataset.teamDel; const row = root.querySelector(`.em-team[data-team="${id}"]`); if (row) strikeOut(row, { message: 'Team watchlist removed.', commit: () => api.del(`/watchlists/${id}`) }); });
  on(root, 'click', '[data-team-add]', (e, b) => {
    closeMenus();
    const emp = byId(b.dataset.teamAdd);
    formModal(html`<h2>Add a team at ${emp.name}</h2>
      <label class="field">Team name *<input class="input" name="name" required></label>
      <label class="field">Match terms (comma-separated)<input class="input" name="terms" placeholder="e.g. watsonx.governance, AI governance"></label>
      <label class="em-check"><input type="checkbox" name="pinned"> Follow this team (its matches weigh 1.5× in ranking)</label>`, 'Add team', async (f) => {
      await api.post('/watchlists', { kind: 'team', employer: emp.name, name: f.get('name'), terms: list(f.get('terms')), pinned: !!f.get('pinned') });
      toast('Team added', 'ok'); again();
    });
  });
  on(root, 'click', '[data-edit]', (e, b) => { closeMenus(); editModal(byId(b.dataset.edit), again, again); });
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

// Edit an employer (name, parent, topics, match terms, notes, delete). Used by the table's ··· menu and by the
// Activity page head, which is the only place an employer with no stories can be edited from (E-4).
function editModal(emp, onSaved, onDeleted) {
  formModal(html`<h2>Edit ${emp.name}</h2>
    <label class="field">Name<input class="input" name="name" value="${emp.name}"></label>
    <label class="field">Parent organisation (shown, but tracked separately)<input class="input" name="parent" value="${emp.parent || ''}"></label>
    <label class="field">Topics (comma-separated)<input class="input" name="topics" value="${emp.topics.join(', ')}"></label>
    <label class="field">Match terms (comma-separated)<textarea class="textarea" name="terms" rows="3">${emp.terms.join(', ')}</textarea></label>
    <label class="field">Notes<textarea class="textarea" name="notes" rows="2">${emp.notes || ''}</textarea></label>
    <div><button type="button" class="btn btn--danger btn--sm" data-delete-emp>Delete employer</button></div>`, 'Save', async (f) => {
    await api.patch(`/employers/${emp.id}`, { name: f.get('name'), parent: f.get('parent') || null, topics: list(f.get('topics')), terms: list(f.get('terms')), notes: f.get('notes') });
    toast('Saved', 'ok'); onSaved();
  }, (m) => { m.el.querySelector('[data-delete-emp]').onclick = async () => {
    if (!(await confirmBox(`Delete ${emp.name}? Its team watchlists stay but are no longer grouped.`, 'Delete'))) return;
    try { await api.del(`/employers/${emp.id}`); m.close(); toast('Employer deleted', 'ok'); onDeleted(); } catch (err) { toast(err.message, 'err'); }
  }; });
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
    <div class="page-head-actions em-headacts">
      <button type="button" class="btn em-pinbtn" data-pin-emp data-on="${e.pinned ? 1 : 0}" aria-pressed="${String(!!e.pinned)}" title="${e.pinned ? 'Stories that mention it get the larger ranking boost' : 'Pin: stories that mention it get a larger ranking boost'}">${PIN}${e.pinned ? 'Pinned' : 'Pin'}</button>
      <button type="button" class="btn btn--ghost" data-edit-emp>Edit</button>
    </div>
  </header>
  ${e.topics.length ? html`<div class="em-tagrow cluster">${e.topics.map(t => html`<span class="chip">${t}</span>`)}</div>` : ''}
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
  const reload = () => renderActivity(el, id, ctx);
  const pinB = root.querySelector('[data-pin-emp]');
  pinB.addEventListener('click', () => act(pinB, async () => { await api.patch(`/employers/${e.id}`, { pinned: pinB.dataset.on !== '1' }); toast(pinB.dataset.on === '1' ? 'Unpinned' : 'Pinned', 'ok'); reload(); }));
  root.querySelector('[data-edit-emp]').addEventListener('click', () => editModal(e, reload, () => { location.hash = '#/employers'; }));
  root.querySelector('#ev').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    await act(ev.submitter, async () => { await api.post('/events', { ...Object.fromEntries(new FormData(ev.target)), employer: e.name }); toast('Event logged', 'ok'); renderActivity(el, id, ctx); });
  });
}
