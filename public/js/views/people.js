// People (v4; was "Contacts"). F §2 People headline: follow-ups first ("2 follow-ups are overdue."), then a
// one-liner with contacts, do-not-contact and this week's outreach against the goal. Every figure comes from
// /api/contacts, /api/followups, /api/outreach, /api/connections/suggestions and /api/status (its `today`, in
// settings.timezone, decides what is overdue).
// Data hygiene is shown, not hidden (F amendment 6): duplicate contacts are flagged with links to each record,
// demo rows carry a Demo tag, and sent messages that went to a duplicate are called out.
// Every v3 feature is kept: contact CRUD with sourced public details, stage / next step / next date,
// do-not-contact (blocks drafting and approval, cancels open drafts), interaction log, permissioned outreach
// drafts with the exact-text approval gate, Gmail send / queue, "I sent it", follow-ups, awaiting reply,
// meeting prep, thank-you drafts, content → connection suggestions and the private note.
// openOutreach / PURPOSES / CHANNELS / STAGES are exported for Campaigns, plus a few text helpers.
import { api } from '../api.js';
import { html, raw, esc, on, act, toast, modal, confirmBox, status, copy, icon, useStyle } from '../ui.js';
import { enterItems, reduced } from '../motion.js';

export const STAGES = ['researching', 'drafting', 'contacted', 'replied', 'met', 'nurturing', 'paused'];
export const PURPOSES = { mentorship: 'Mentorship question', informational: 'Informational interview', peer: 'Peer connection', event_followup: 'Event follow-up', project_feedback: 'Project feedback', thank_you: 'Thank-you' };
export const CHANNELS = { email: 'Cold email', linkedin_note: 'LinkedIn note (300)', instagram_dm: 'Instagram DM', short: 'Short (200 chars)' };
const KINDS = ['introduction', 'message_sent', 'reply', 'coffee_chat', 'call', 'meeting', 'thank_you', 'follow_up', 'event', 'note'];
const LIMITS = { short: 200, linkedin_note: 300 };
const SEGMENTS = { target_team: 'Target team', ksu_alumni: 'KSU alumni in tech', founder: 'Founder / operator', peer: 'Peer', other: 'Other' };
const CSS = '/css/v4/people.css';

// ------------------------------------------------------------------ shared text helpers (also used by Campaigns, Employers, Career, Performance)
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const listJoin = (a) => a.length <= 1 ? (a[0] ?? '') : a.length === 2 ? `${a[0]} and ${a[1]}` : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
/** Demo rows are marked in their own text ("(demo)", "(fictional)", "DEMO · "); show a Demo tag instead. */
export const isDemoText = (s) => /\((demo|fictional)\)|^\s*DEMO\s*[·:-]/i.test(String(s || ''));
export const stripDemo = (s) => String(s || '').replace(/^\s*DEMO\s*[·:-]\s*/i, '').replace(/\s*\((demo|fictional)\)/ig, '').trim();
export const demoTag = (on) => on ? html`<span class="tag tag--demo" title="Fictional sample data">Demo</span>` : '';
/** "Wed 18 Nov" for a YYYY-MM-DD (dates are already local to settings.timezone). */
export const dayLabel = (ymd, { weekday = true, year = false } = {}) => ymd ? new Date(`${String(ymd).slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { ...(weekday ? { weekday: 'short' } : {}), day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }).replace(',', '') : '';
/** ISO timestamp → "18 Nov, 6:28 PM" in the settings timezone. */
export const whenLabel = (iso, tz) => iso ? `${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(tz ? { timeZone: tz } : {}) })}, ${new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) })}` : '';
const addDays = (ymd, n) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const label = (s) => (s || '').replace(/_/g, ' ');
const opts = (list, sel) => list.map(([v, l]) => html`<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`);
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const nameKey = (n) => stripDemo(n).toLowerCase().replace(/\s+/g, ' ').trim();
/** Groups of contacts that share a name (likely duplicates). */
export function duplicateGroups(contacts) {
  const g = new Map();
  for (const c of contacts) { const k = nameKey(c.name); if (!k) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(c); }
  return [...g.values()].filter(x => x.length > 1);
}

let SMTP_READY = false;
api.get('/status').then(st => { SMTP_READY = st.delivery?.email?.via === 'gmail'; }).catch(() => {});

export async function render(el, ctx = {}) {
  await useStyle(CSS);
  if (ctx.name === 'person' && ctx.params?.[0]) return renderPerson(el, ctx.params[0], ctx);
  return renderList(el, ctx);
}

// ------------------------------------------------------------------ list: headline (F §2 People)
function headline({ contacts, fu, today }) {
  const overdue = fu.due.filter(f => f.next_date < today);
  const week = fu.due.filter(f => f.next_date >= today && f.next_date <= addDays(today, 6));
  const dnc = contacts.filter(c => c.dnc).length;
  const h = !contacts.length ? 'No people yet.'
    : overdue.length ? `${plural(overdue.length, 'follow-up')} ${overdue.length === 1 ? 'is' : 'are'} overdue.`
    : week.length ? `${plural(week.length, 'follow-up')} due this week.`
    : 'No follow-ups due.';
  const w = fu.week;
  const l = !contacts.length
    ? html`Add someone whose public work you’ve actually read, with a source for every detail.${w ? html` Weekly outreach goal: <b>${w.goal}</b> messages.` : ''}`
    : html`<b>${contacts.length}</b> ${contacts.length === 1 ? 'contact' : 'contacts'} (<b>${dnc}</b> do-not-contact).${w ? html` Outreach this week: <b>${w.sent}</b> of <b>${w.goal}</b> sent; <b>${fu.awaiting_reply.length}</b> awaiting a reply.` : ''}`;
  return { h, l, overdue, week };
}

const dueTag = (d, today) => d < today ? html`<span class="tag tag--err">Overdue · ${dayLabel(d, { weekday: false })}</span>`
  : d === today ? html`<span class="tag tag--warn">Today</span>`
  : html`<span class="tag tag--neutral">${dayLabel(d)}</span>`;

function personCell(c, { link = true } = {}) {
  const demo = isDemoText(c.name) || isDemoText(c.org);
  const sub = [c.role, stripDemo(c.org)].filter(Boolean).join(' · ');
  return html`<div class="pp-who">
    <span class="pp-namerow">${link ? html`<a class="pp-name" href="#/person/${c.id}">${stripDemo(c.name)}</a>` : html`<span class="pp-name">${stripDemo(c.name)}</span>`}
    <span class="pp-tags">${demoTag(demo)}${c.dnc ? html`<span class="tag tag--err">Do not contact</span>` : ''}${c.ksu_alumni ? html`<span class="tag tag--neutral">KSU</span>` : ''}</span></span>
    <span class="pp-sub">${sub || html`<span class="ink-3">No public role recorded</span>`}${c.segment ? html`<span class="pp-dotsep" aria-hidden="true">·</span>${SEGMENTS[c.segment] || c.segment}` : ''}</span>
  </div>`;
}

async function renderList(el, ctx) {
  const [contacts, fu, suggestions, queue, st] = await Promise.all([
    api.get('/contacts'), api.get('/followups'), api.get('/connections/suggestions').catch(() => []), api.get('/outreach'), api.get('/status')
  ]);
  const today = st.today || new Date().toISOString().slice(0, 10);
  const tz = st.timezone;
  const hidden = (renderList.hidden ||= new Set());
  const sugg = suggestions.filter(s => !hidden.has(`${s.contact.id}-${s.story.id}`));
  const hd = headline({ contacts, fu, today });
  const dups = duplicateGroups(contacts);
  const dupIds = new Set(dups.flat().map(c => c.id));
  const weekStart = (() => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();
  const sentWeek = queue.filter(o => o.status === 'sent' && (o.sent_at || '').slice(0, 10) >= weekStart);
  const sentToDup = sentWeek.filter(o => dupIds.has(o.contact_id));
  const open = queue.filter(o => !['sent', 'cancelled'].includes(o.status));
  const stageCounts = STAGES.map(s => [s, contacts.filter(c => c.stage === s).length]);
  const otherStages = [...new Set(contacts.map(c => c.stage).filter(s => s && !STAGES.includes(s)))].map(s => [s, contacts.filter(c => c.stage === s).length]);
  const stageMax = Math.max(1, ...stageCounts.map(x => x[1]), ...otherStages.map(x => x[1]));
  const later = fu.due.filter(f => f.next_date > addDays(today, 6));
  const w = fu.week;

  const fuRow = (f) => html`<li class="pp-fu" data-row>
    <div class="pp-fu-main"><a class="pp-name" href="#/person/${f.id}">${stripDemo(f.name)}</a>${demoTag(isDemoText(f.name))}
      <span class="pp-sub">${f.next_step || 'No next step written'}${f.employer ? html`<span class="pp-dotsep" aria-hidden="true">·</span>${f.employer}` : ''}<span class="pp-dotsep" aria-hidden="true">·</span>${label(f.stage)}</span></div>
    ${dueTag(f.next_date, today)}
  </li>`;
  const fuGroup = (title, items) => items.length ? html`<li class="pp-fu-group" aria-hidden="true">${title} · ${items.length}</li>${items.map(fuRow)}` : '';

  const root = document.createElement('div');
  root.className = 'pp';
  root.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow">Relationships</p>
    <h1>${hd.h}</h1>
    <p class="lede">${hd.l}</p>
    <div class="page-head-actions"><button class="btn btn--primary" data-act="add">${icon('plus')}Add person</button></div>
  </header>

  ${dups.length ? html`<div class="pp-callout" role="note">
    ${icon('people')}
    <p>${dups.map(g => html`<b>Possible duplicate:</b> “${stripDemo(g[0].name)}” appears ${g.length} times${g.every(c => c.dnc) ? ' (all do-not-contact)' : ''}. `)}${sentToDup.length ? html`${plural(sentToDup.length, 'of this week’s sent messages', 'of this week’s sent messages')} went to these copies, so the weekly count includes them.` : ''}</p>
    <span class="cluster">${dups.flat().map((c, i) => html`<a class="btn btn--sm" href="#/person/${c.id}">Record ${i + 1} · added ${whenLabel(c.created_at, tz)}</a>`)}</span>
  </div>` : ''}

  <div class="pp-cols">
    <div class="pp-main stack">
      <section class="tile tile--static pp-card" aria-labelledby="pp-fu-h">
        <div class="section-head"><h2 class="t-h2" id="pp-fu-h">Follow-ups</h2><span class="section-meta">${hd.overdue.length} overdue · ${hd.week.length} this week · ${later.length} later</span></div>
        ${fu.due.length ? html`<ul class="pp-fu-list">${fuGroup('Overdue', hd.overdue)}${fuGroup('This week', hd.week)}${fuGroup('Later', later)}</ul>`
          : html`<p class="pp-empty-line">Nothing scheduled. Set a next date on a person to get a reminder here; do-not-contact people never appear.</p>`}
      </section>

      <section class="tile tile--static tile--flush pp-card" aria-labelledby="pp-c-h">
        <div class="section-head pp-pad"><h2 class="t-h2" id="pp-c-h">People</h2><span class="section-meta">${contacts.length} total · ${contacts.filter(c => (c.details || []).length).length} with sourced details</span></div>
        ${contacts.length ? html`<table class="table pp-table pp-table--people">
          <thead><tr><th>Person</th><th>Stage</th><th class="pp-hide-sm pp-hide-md">Employer</th><th>Next step</th><th class="pp-hide-sm">Last contact</th></tr></thead>
          <tbody>${contacts.map(c => html`<tr data-href="#/person/${c.id}" class="${dupIds.has(c.id) ? 'pp-dup' : ''}">
            <td>${personCell(c)}${dupIds.has(c.id) ? html`<span class="pp-dupnote">Possible duplicate</span>` : ''}</td>
            <td>${status(c.stage)}</td>
            <td class="pp-hide-sm pp-hide-md">${c.employer || html`<span class="ink-3">—</span>`}</td>
            <td class="pp-next">${c.next_step || html`<span class="ink-3">—</span>`}${c.next_date ? html`<span class="pp-date ${c.dnc ? '' : c.next_date < today ? 'is-late' : c.next_date === today ? 'is-today' : ''}"><time datetime="${c.next_date}">${dayLabel(c.next_date)}</time>${c.dnc ? ' · paused (do not contact)' : ''}</span>` : ''}</td>
            <td class="pp-hide-sm pp-mono">${c.last_interaction ? html`<time datetime="${c.last_interaction}">${dayLabel(c.last_interaction, { weekday: false })}</time>` : '—'}</td>
          </tr>`)}</tbody></table>`
        : html`<div class="pp-pad"><div class="empty"><h3>No people yet.</h3><p>Add someone whose public work you’ve actually read, with a source for every detail.</p></div></div>`}
      </section>

      <section class="tile tile--static tile--flush pp-card" aria-labelledby="pp-q-h">
        <div class="section-head pp-pad"><h2 class="t-h2" id="pp-q-h">Outreach queue</h2><span class="section-meta">${open.length} open · ${queue.filter(o => o.status === 'sent').length} sent · ${queue.filter(o => o.status === 'cancelled').length} cancelled</span></div>
        ${queue.length ? html`<table class="table pp-table">
          <thead><tr><th>To</th><th>Purpose</th><th class="pp-hide-sm">Channel</th><th class="pp-hide-sm">When</th><th>Status</th></tr></thead>
          <tbody>${queue.map(o => html`<tr data-outreach="${o.id}">
            <td><button class="pp-linkbtn" data-outreach-open="${o.id}">${stripDemo(o.name)}</button>${dupIds.has(o.contact_id) ? html`<span class="pp-dupnote">duplicate contact</span>` : ''}${o.subject ? html`<span class="pp-sub">${o.subject}</span>` : ''}</td>
            <td>${PURPOSES[o.purpose] || label(o.purpose)}</td>
            <td class="pp-hide-sm">${CHANNELS[o.channel] || o.channel}</td>
            <td class="pp-hide-sm pp-mono">${o.sent_at ? `sent ${whenLabel(o.sent_at, tz)}` : o.send_at ? `send ${whenLabel(o.send_at, tz)}` : '—'}</td>
            <td>${status(o.status)}</td></tr>`)}</tbody></table>`
        : html`<p class="pp-empty-line pp-pad">No outreach drafts. Open a person to draft one; every message waits for your approval of the exact text, recipient and send time.</p>`}
      </section>
    </div>

    <aside class="pp-aside stack">
      ${w ? html`<section class="tile tile--static pp-card" aria-labelledby="pp-w-h">
        <h2 class="section-label" id="pp-w-h">This week’s outreach</h2>
        <p class="pp-big"><span class="pp-big-n">${w.sent}</span><span class="pp-big-of">of ${w.goal} sent</span></p>
        <div class="meter pp-meter" role="img" aria-label="${w.sent} of ${w.goal} messages sent this week"><i style="--v:${Math.min(1, w.goal ? w.sent / w.goal : 0)}"></i></div>
        <p class="pp-note">${w.sent >= w.goal ? 'Goal met. Quality over volume from here.' : `${plural(w.goal - w.sent, 'more approved message')} to reach the weekly goal.`} ${fu.awaiting_reply.length ? `${fu.awaiting_reply.length} awaiting a reply.` : 'None awaiting a reply.'}</p>
        ${sentToDup.length ? html`<p class="pp-note pp-note--warn">${plural(sentToDup.length, 'sent message')} went to duplicate “${stripDemo(dups[0][0].name)}” records.</p>` : ''}
      </section>` : ''}

      <section class="tile tile--static pp-card" aria-labelledby="pp-s-h">
        <h2 class="section-label" id="pp-s-h">Pipeline by stage</h2>
        <ul class="pp-stages">${[...stageCounts, ...otherStages].map(([s, n]) => html`<li class="${n ? '' : 'is-zero'}"><span class="pp-stage-l">${label(s)}</span><span class="meter"><i style="--v:${n / stageMax}"></i></span><span class="pp-stage-n">${n}</span></li>`)}</ul>
      </section>

      <section class="tile tile--static pp-card" aria-labelledby="pp-a-h">
        <h2 class="section-label" id="pp-a-h">Awaiting reply</h2>
        ${fu.awaiting_reply.length ? html`<ul class="pp-mini">${fu.awaiting_reply.map(a => html`<li><a href="#/person/${a.id}">${stripDemo(a.name)}</a><span class="pp-sub">sent ${dayLabel((a.sent_at || '').slice(0, 10), { weekday: false })} · follow up ${dayLabel(a.suggested_follow_up)}</span></li>`)}</ul>`
          : html`<p class="pp-note">No sent message is waiting on a reply.${queue.some(o => o.status === 'sent' && contacts.find(c => c.id === o.contact_id)?.dnc) ? ' Messages sent to people later marked do-not-contact are not tracked.' : ''} Logging a reply pauses reminders automatically.</p>`}
      </section>

      <section class="tile tile--static pp-card" aria-labelledby="pp-x-h">
        <h2 class="section-label" id="pp-x-h">Content → connection</h2>
        ${sugg.length ? html`<ul class="pp-sugg">${sugg.map(s => html`<li>
          <div class="pp-sugg-h"><a class="pp-name" href="#/person/${s.contact.id}">${stripDemo(s.contact.name)}</a><button class="btn btn--ghost btn--sm" data-act="dismiss" data-key="${s.contact.id}-${s.story.id}">Dismiss</button></div>
          <p class="pp-note">${s.reason} From <a href="#/story/${s.story.id}" data-dossier-src>${s.story.title}</a>${s.source?.url ? html` · <a href="${s.source.url}" target="_blank" rel="noopener">source${icon('arrow-up-right')}</a>` : ''}</p>
          ${s.options.map(o => html`<div class="pp-sugg-opt"><span>${o.text}</span>${o.kind === 'private_question'
            ? html`<button class="btn btn--sm" data-act="sugg-private" data-contact="${s.contact.id}" data-story="${s.story.id}">Start draft</button>`
            : s.source?.url ? html`<a class="btn btn--sm" href="${s.source.url}" target="_blank" rel="noopener">Open post${icon('arrow-up-right')}</a>` : ''}</div>`)}
        </li>`)}</ul>`
          : html`<p class="pp-note">No suggestions. They appear when a person authored, or their team appears in, a story you opened and marked useful, saved or tested. Nothing is ever sent for you.</p>`}
      </section>
    </aside>
  </div>`);
  el.replaceChildren(root);

  const again = async () => { await renderList(el, ctx); };
  on(root, 'click', 'tr[data-href]', (e, tr) => { if (!e.target.closest('a, button')) location.hash = tr.dataset.href; });
  on(root, 'click', 'tr[data-outreach]', (e, tr) => { e.preventDefault(); openOutreach(tr.dataset.outreach, again); });
  on(root, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'add') openAddContact();
    if (a === 'dismiss') {
      hidden.add(btn.dataset.key);
      const li = btn.closest('li');
      if (li) li.remove();
    }
    if (a === 'sugg-private') await act(btn, async () => {
      const o = await api.post(`/contacts/${btn.dataset.contact}/outreach`, { purpose: 'mentorship', channel: 'linkedin_note', story_id: Number(btn.dataset.story) });
      toast('Draft created. Review it before approving.', 'ok');
      await again(); openOutreach(o.id, again);
    }, 'Drafting…');
  });
}

// ------------------------------------------------------------------ add contact
const field = (lbl, control, cls = '') => html`<label class="field ${cls}">${lbl}${control}</label>`;
async function openAddContact() {
  const employers = await api.get('/employers').catch(() => []);
  const m = modal(String(html`
    <h2>Add a person</h2>
    <p class="pp-modal-dek">Record only public, professional details, each with the source where it was published. An email address must come from the person’s or organisation’s own publication, or from the person directly.</p>
    <form class="pp-form" id="cf">
      ${field('Name *', raw('<input class="input" name="name" required autocomplete="off">'))}
      ${field('Public role', raw('<input class="input" name="role">'))}
      ${field('Organisation', raw('<input class="input" name="org">'))}
      ${field('Target employer', html`<select class="select" name="employer"><option value="">None</option>${employers.map(e => html`<option>${e.name}</option>`)}</select>`)}
      ${field('Team', raw('<input class="input" name="team">'))}
      ${field('LinkedIn URL', raw('<input class="input" name="linkedin" inputmode="url">'))}
      ${field('Email', raw('<input class="input" name="email" type="email">'))}
      ${field('Where the email was published', raw('<input class="input" name="email_source" placeholder="URL, or “given to me at …”">'))}
      ${field('Instagram handle', raw('<input class="input" name="instagram">'))}
      ${field('Next date', raw('<input class="input" name="next_date" type="date">'))}
      ${field('Segment', html`<select class="select" name="segment">${Object.entries(SEGMENTS).map(([k, l]) => html`<option value="${k}" ${k === 'target_team' ? 'selected' : ''}>${l}</option>`)}</select>`)}
      <label class="pp-check pp-check--end"><input type="checkbox" name="ksu_alumni" value="1"> KSU alumni</label>
      ${field('Why connect', raw('<textarea class="textarea" name="why" rows="2"></textarea>'), 'pp-full')}
      <div class="pp-full">
        <div class="pp-form-sub"><span>Public details (each needs a source URL)</span><button type="button" class="btn btn--sm" data-add-detail>${icon('plus')}Detail</button></div>
        <div id="details" class="pp-details"></div>
      </div>
      ${field(html`<span class="pp-lbl-row">Private note <span class="tag tag--neutral">Private</span></span>`, raw('<textarea class="textarea" name="private_note" rows="2" placeholder="Never exported, never used in drafts"></textarea>'), 'pp-full')}
      <div class="modal-actions pp-full"><button type="button" class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" type="submit">Save person</button></div>
    </form>`), { wide: true });
  const box = m.el.querySelector('#details');
  const addRow = () => box.insertAdjacentHTML('beforeend', `<div class="pp-detail-row"><input class="input" placeholder="Detail, e.g. wrote about eval harnesses for agents" aria-label="Public detail" data-d><input class="input" placeholder="https://source…" aria-label="Source URL" data-s><button type="button" class="btn btn--ghost btn--sm btn--icon" data-rm aria-label="Remove detail"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button></div>`);
  addRow();
  m.el.addEventListener('click', (e) => { if (e.target.closest('[data-add-detail]')) addRow(); if (e.target.closest('[data-rm]')) e.target.closest('.pp-detail-row').remove(); });
  m.el.querySelector('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const details = [...box.querySelectorAll('.pp-detail-row')].map(r => ({ detail: r.querySelector('[data-d]').value.trim(), source: r.querySelector('[data-s]').value.trim() })).filter(d => d.detail || d.source);
    if (details.some(d => !d.detail || !d.source)) return toast('Every public detail needs both the detail and its source URL.', 'err');
    if (f.email && !f.email_source.trim()) return toast('Say where the email address was published (or that they gave it to you).', 'err');
    await act(e.submitter, async () => {
      const c = await api.post('/contacts', { ...f, ksu_alumni: !!f.ksu_alumni, next_date: f.next_date || null, details });
      m.close(); toast('Person added', 'ok'); location.hash = `#/person/${c.id}`;
    }, 'Saving…');
  });
}

// ------------------------------------------------------------------ person detail
function personLede(c, tz, today) {
  const role = [c.role, stripDemo(c.org) || c.employer].filter(Boolean);
  const last = c.interactions?.[0];
  const parts = [];
  parts.push(html`${role.length ? html`<b>${role[0]}</b>${role[1] ? html` at <b>${role[1]}</b>` : ''}.` : 'No public role recorded yet.'}`);
  parts.push(html` Stage: <b>${label(c.stage) || 'none'}</b>`);
  parts.push(last ? html`; last contact <b>${dayLabel(last.date, { weekday: false })}</b> (${label(last.kind)})` : html`; no interactions logged`);
  if (c.dnc) parts.push(html`. Do-not-contact is on, so drafting and approval are blocked.`);
  else if (c.next_step || c.next_date) parts.push(html`. Next: ${c.next_step || 'follow up'}${c.next_date ? html` by <b>${dayLabel(c.next_date)}</b>${c.next_date < today ? ' (overdue)' : ''}` : ''}.`);
  else parts.push(html`.`);
  void tz;
  return parts;
}

async function renderPerson(el, id, ctx) {
  const [c, all, st] = await Promise.all([api.get(`/contacts/${id}`, { fresh: true }), api.get('/contacts').catch(() => []), api.get('/status')]);
  const tz = st.timezone;
  const today = st.today || new Date().toISOString().slice(0, 10);
  const details = c.details || [];
  const prep = (renderPerson.prep ||= {})[id];
  const twins = all.filter(x => x.id !== c.id && nameKey(x.name) === nameKey(c.name));
  const demo = isDemoText(c.name) || isDemoText(c.org);
  const sentN = c.outreach.filter(o => o.status === 'sent').length;

  const root = document.createElement('div');
  root.className = 'pp pp-person';
  root.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow"><a class="pp-back" href="#/people">${icon('chevron-left')}People</a></p>
    <h1>${stripDemo(c.name)}</h1>
    <p class="lede">${personLede(c, tz, today)}</p>
    <div class="page-head-actions"><button class="btn btn--danger btn--sm" data-act="delete">Delete person</button></div>
  </header>
  <div class="pp-tagrow cluster">${status(c.stage)}${demoTag(demo)}${c.employer ? html`<span class="chip">${c.employer}</span>` : ''}${c.team ? html`<span class="chip">${c.team}</span>` : ''}${c.ksu_alumni ? html`<span class="chip">KSU alumni</span>` : ''}${c.dnc ? html`<span class="tag tag--err">Do not contact</span>` : ''}
    <span class="pp-facts">${plural(details.length, 'sourced detail')} · ${plural(c.interactions.length, 'interaction')} · ${plural(c.outreach.length, 'message')} (${sentN} sent)</span></div>

  ${c.dnc ? html`<div class="pp-callout pp-callout--err" role="note">${icon('x')}<p>Marked <b>do not contact</b>. Drafting, approving and sending are blocked, and open drafts were cancelled.</p></div>` : ''}
  ${twins.length ? html`<div class="pp-callout" role="note">${icon('alert')}<p><b>Possible duplicate.</b> ${twins.length === 1 ? 'Another record has' : `${twins.length} other records have`} the same name (added ${twins.map(t => whenLabel(t.created_at, tz)).join(', ')}). Keep one and delete the other so counts stay honest.</p><span class="cluster">${twins.map(t => html`<a class="btn btn--sm" href="#/person/${t.id}">Open the other record</a>`)}</span></div>` : ''}

  <div class="pp-cols">
    <div class="pp-main stack">
      <section class="tile tile--static pp-card" aria-labelledby="pp-r-h">
        <div class="section-head"><h2 class="t-h2" id="pp-r-h">Research card</h2><span class="section-meta">updated ${whenLabel(c.updated_at, tz)}</span></div>
        <form class="pp-form" id="research">
          ${field('Name', html`<input class="input" name="name" value="${c.name}">`)}
          ${field('Public role', html`<input class="input" name="role" value="${c.role || ''}">`)}
          ${field('Organisation', html`<input class="input" name="org" value="${c.org || ''}">`)}
          ${field('Target employer', html`<input class="input" name="employer" value="${c.employer || ''}">`)}
          ${field('Team', html`<input class="input" name="team" value="${c.team || ''}">`)}
          ${field('LinkedIn', html`<input class="input" name="linkedin" value="${c.linkedin || ''}">`)}
          ${field('Email', html`<input class="input" name="email" type="email" value="${c.email || ''}">`)}
          ${field('Email published at', html`<input class="input" name="email_source" value="${c.email_source || ''}">`)}
          ${field('Instagram', html`<input class="input" name="instagram" value="${c.instagram || ''}">`)}
          ${field('Segment', html`<select class="select" name="segment">${Object.entries(SEGMENTS).map(([k, l]) => html`<option value="${k}" ${(c.segment || 'target_team') === k ? 'selected' : ''}>${l}</option>`)}</select>`)}
          <label class="pp-check pp-check--end"><input type="checkbox" name="ksu_alumni" value="1" ${c.ksu_alumni ? 'checked' : ''}> KSU alumni</label>
          ${field('Why connect', html`<textarea class="textarea" name="why" rows="2">${c.why || ''}</textarea>`, 'pp-full')}
          <div class="pp-full pp-form-end"><button class="btn btn--sm" type="submit">Save research</button></div>
        </form>
        <div class="pp-rule"></div>
        <div class="section-head"><h3 class="pp-h3">Sourced public details</h3><button class="btn btn--sm" data-act="add-detail">${icon('plus')}Detail</button></div>
        <div id="details" class="pp-details">
          ${details.length ? details.map((d, i) => html`<div class="pp-detail-row" data-i="${i}">
            <input class="input" data-d value="${d.detail || ''}" aria-label="Public detail"><input class="input" data-s value="${d.source || ''}" placeholder="https://source…" aria-label="Source URL">
            <button class="btn btn--ghost btn--sm btn--icon" data-act="rm-detail" aria-label="Remove detail">${icon('x')}</button></div>`)
          : html`<p class="pp-note" data-none>No details yet. Personalisation needs at least one sourced detail.</p>`}
        </div>
        <div class="pp-form-end"><button class="btn btn--sm" data-act="save-details">Save details</button></div>
      </section>

      <section class="tile tile--static pp-card" aria-labelledby="pp-o-h">
        <div class="section-head"><h2 class="t-h2" id="pp-o-h">Draft outreach</h2><span class="section-meta">${plural(c.outreach.length, 'message')}</span></div>
        <p class="pp-note">A mentorship question is not a referral request; the two are kept separate. First-person claims come only from your public-OK experiences.</p>
        <div class="pp-form">
          ${field('Purpose', html`<select class="select" id="o-purpose">${opts(Object.entries(PURPOSES).filter(([k]) => k !== 'thank_you'), 'mentorship')}</select>`)}
          ${field('Channel', html`<select class="select" id="o-channel">${opts(Object.entries(CHANNELS), 'email')}</select>`)}
          <fieldset class="pp-full pp-fieldset"><legend>Use these sourced details</legend>
            ${details.length ? details.map((d, i) => html`<label class="pp-check"><input type="checkbox" data-detail-idx="${i}" ${i === 0 ? 'checked' : ''}> <span>${d.detail} ${d.source ? html`<a href="${d.source}" target="_blank" rel="noopener">source${icon('arrow-up-right')}</a>` : html`<span class="tag tag--err">No source</span>`}</span></label>`)
            : html`<span class="pp-note">None recorded, so the draft will be flagged as unsourced.</span>`}
          </fieldset>
          <div class="pp-full pp-form-end"><button class="btn btn--primary" data-act="draft" ${c.dnc ? 'disabled' : ''}>Draft message</button></div>
        </div>
        ${c.outreach.length ? html`<div class="pp-rule"></div><h3 class="pp-h3">Messages</h3>
          <table class="table pp-table pp-table--inset"><tbody>${c.outreach.map(o => html`<tr data-outreach="${o.id}">
            <td><button class="pp-linkbtn" data-outreach-open="${o.id}">${PURPOSES[o.purpose] || label(o.purpose)}</button>${o.subject ? html`<span class="pp-sub">${o.subject}</span>` : ''}</td>
            <td class="pp-hide-sm">${CHANNELS[o.channel] || o.channel}</td>
            <td class="pp-mono pp-hide-sm">${o.sent_at ? `sent ${whenLabel(o.sent_at, tz)}` : o.send_at ? `send ${whenLabel(o.send_at, tz)}` : ''}</td>
            <td>${status(o.status)}</td></tr>`)}</tbody></table>` : ''}
      </section>

      <section class="tile tile--static pp-card" aria-labelledby="pp-i-h">
        <div class="section-head"><h2 class="t-h2" id="pp-i-h">Interaction log</h2><span class="section-meta">${plural(c.interactions.length, 'entry', 'entries')}</span></div>
        <form class="pp-ixform" id="ix">
          ${field('Kind', html`<select class="select" name="kind">${opts(KINDS.map(k => [k, label(k)]), 'note')}</select>`)}
          ${field('Date', html`<input class="input" type="date" name="date" value="${today}">`)}
          ${field('Notes', raw('<input class="input" name="notes">'), 'pp-grow')}
          <button class="btn" type="submit">Log</button>
        </form>
        <p class="pp-note">Logging a <b>reply</b> pauses follow-up reminders and moves the stage to “replied”. A coffee chat, call or meeting sets the next step to a thank-you.</p>
        ${c.interactions.length ? html`<ol class="pp-timeline">${c.interactions.map(i => html`<li class="${i.kind === 'reply' ? 'is-reply' : ''}">
          <span class="pp-tl-dot" aria-hidden="true"></span>
          <div class="pp-tl-b"><span class="pp-tl-h"><span class="tag ${i.kind === 'reply' ? 'tag--ok' : 'tag--neutral'}">${label(i.kind)}</span><time class="pp-mono" datetime="${i.date}">${dayLabel(i.date)}</time></span>${i.notes ? html`<p>${i.notes}</p>` : ''}</div>
          <button class="btn btn--ghost btn--sm btn--icon" data-act="rm-ix" data-id="${i.id}" aria-label="Delete this ${label(i.kind)} entry">${icon('x')}</button></li>`)}</ol>`
          : html`<p class="pp-empty-line">No interactions yet.</p>`}
      </section>
    </div>

    <aside class="pp-aside stack">
      <section class="tile tile--static pp-card" aria-labelledby="pp-rel-h">
        <h2 class="section-label" id="pp-rel-h">Relationship</h2>
        <form class="stack-sm" id="rel">
          ${field('Stage', html`<select class="select" name="stage">${opts([...new Set([...STAGES, c.stage].filter(Boolean))].map(s => [s, label(s)]), c.stage)}</select>`)}
          ${field('Next step', html`<input class="input" name="next_step" value="${c.next_step || ''}">`)}
          ${field('Next date', html`<input class="input" name="next_date" type="date" value="${c.next_date || ''}">`)}
          <div class="pp-form-end"><button class="btn btn--sm" type="submit">Save</button></div>
        </form>
        <div class="pp-rule"></div>
        <div class="pp-dnc"><span>${c.dnc ? 'Do-not-contact is on' : 'Do not contact'}</span><button class="btn btn--sm ${c.dnc ? '' : 'btn--danger'}" data-act="dnc">${c.dnc ? 'Clear do-not-contact' : 'Mark do not contact'}</button></div>
      </section>

      <section class="tile tile--static pp-card pp-private" aria-labelledby="pp-n-h">
        <div class="pp-card-h"><h2 class="section-label" id="pp-n-h">Private note</h2><span class="tag tag--neutral">Private</span></div>
        <p class="pp-note">Only you see this. It is never exported and never used to write drafts.</p>
        <textarea class="textarea" id="pnote" rows="4" aria-labelledby="pp-n-h">${c.private_note || ''}</textarea>
        <div class="pp-form-end"><button class="btn btn--sm" data-act="save-note">Save note</button></div>
      </section>

      <section class="tile tile--static pp-card" aria-labelledby="pp-p-h">
        <div class="pp-card-h"><h2 class="section-label" id="pp-p-h">Meeting prep</h2><button class="btn btn--sm" data-act="prep">${prep ? 'Regenerate' : 'Prepare questions'}</button></div>
        ${prep ? html`<ol class="pp-prep">${prep.map(q => html`<li>${q}</li>`)}</ol>` : html`<p class="pp-note">Two or three questions grounded in their sourced public work${details.length ? '' : ' (none recorded yet, so questions will be generic)'}.</p>`}
      </section>

      <section class="tile tile--static pp-card" aria-labelledby="pp-t-h">
        <h2 class="section-label" id="pp-t-h">After the call</h2>
        <textarea class="textarea" id="ty-notes" rows="3" aria-labelledby="pp-t-h" placeholder="What did you talk about? What advice will you act on?"></textarea>
        <div class="pp-form-end"><button class="btn btn--sm" data-act="thankyou" ${c.dnc ? 'disabled' : ''}>Draft thank-you</button></div>
      </section>
    </aside>
  </div>`);
  el.replaceChildren(root);

  const again = () => renderPerson(el, id, ctx);
  const readDetails = () => [...root.querySelectorAll('#details .pp-detail-row')].map(r => ({ detail: r.querySelector('[data-d]').value.trim(), source: r.querySelector('[data-s]').value.trim() })).filter(d => d.detail || d.source);

  root.querySelector('#research').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.email && !f.email_source.trim()) return toast('Say where the email address was published (or that they gave it to you).', 'err');
    await act(e.submitter, async () => { await api.patch(`/contacts/${id}`, { ...f, ksu_alumni: !!f.ksu_alumni }); toast('Saved', 'ok'); again(); });
  });
  root.querySelector('#rel').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await act(e.submitter, async () => { await api.patch(`/contacts/${id}`, { ...f, next_date: f.next_date || null }); toast('Saved', 'ok'); again(); });
  });
  root.querySelector('#ix').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    await act(e.submitter, async () => { await api.post(`/contacts/${id}/interactions`, f); toast(f.kind === 'reply' ? 'Reply logged; follow-ups paused' : 'Logged', 'ok'); again(); });
  });
  on(root, 'click', 'tr[data-outreach]', (e, tr) => { e.preventDefault(); openOutreach(tr.dataset.outreach, again); });
  on(root, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'add-detail') {
      root.querySelector('#details [data-none]')?.remove();
      root.querySelector('#details').insertAdjacentHTML('beforeend', `<div class="pp-detail-row"><input class="input" data-d placeholder="Public detail" aria-label="Public detail"><input class="input" data-s placeholder="https://source…" aria-label="Source URL"><button class="btn btn--ghost btn--sm btn--icon" data-act="rm-detail" aria-label="Remove detail"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button></div>`);
      root.querySelector('#details .pp-detail-row:last-child [data-d]')?.focus();
    }
    if (a === 'rm-detail') btn.closest('.pp-detail-row').remove();
    if (a === 'save-details') {
      const d = readDetails();
      if (d.some(x => !x.detail || !x.source)) return toast('Every public detail needs both the detail and its source URL.', 'err');
      await act(btn, async () => { await api.patch(`/contacts/${id}`, { details: d }); toast('Details saved', 'ok'); again(); });
    }
    if (a === 'save-note') await act(btn, async () => { await api.patch(`/contacts/${id}`, { private_note: root.querySelector('#pnote').value }); toast('Private note saved', 'ok'); }, 'Saving…', { done: 'Saved' });
    if (a === 'rm-ix') await act(btn, async () => { await api.del(`/interactions/${btn.dataset.id}`); again(); });
    if (a === 'dnc') {
      const turnOn = !c.dnc;
      if (!(await confirmBox(turnOn ? `Mark ${stripDemo(c.name)} as do-not-contact? Open outreach drafts will be cancelled and new drafts blocked.` : `Clear do-not-contact for ${stripDemo(c.name)}?`, turnOn ? 'Mark do not contact' : 'Clear'))) return;
      await act(btn, async () => { await api.patch(`/contacts/${id}`, { dnc: turnOn }); toast(turnOn ? 'Marked do not contact' : 'Cleared', 'ok'); again(); });
    }
    if (a === 'delete') {
      if (!(await confirmBox(`Delete ${stripDemo(c.name)}, their interaction history and all outreach drafts?`, 'Delete'))) return;
      await act(btn, async () => { await api.del(`/contacts/${id}`); toast('Person deleted', 'ok'); location.hash = '#/people'; });
    }
    if (a === 'prep') await act(btn, async () => { renderPerson.prep[id] = (await api.post(`/contacts/${id}/prep`)).questions; again(); }, 'Thinking…');
    if (a === 'draft') await act(btn, async () => {
      const detail_indexes = [...root.querySelectorAll('[data-detail-idx]:checked')].map(x => Number(x.dataset.detailIdx));
      const o = await api.post(`/contacts/${id}/outreach`, { purpose: root.querySelector('#o-purpose').value, channel: root.querySelector('#o-channel').value, detail_indexes });
      await again(); openOutreach(o.id, again);
    }, 'Drafting…');
    if (a === 'thankyou') await act(btn, async () => {
      const r = await api.post(`/contacts/${id}/thankyou`, { notes: root.querySelector('#ty-notes').value });
      toast(`Next step set: ${r.next_action}`, 'ok');
      await again(); openOutreach(r.outreach_id, again);
    }, 'Drafting…');
  });
  if (!reduced() && renderPerson.lastId === id) enterItems([root.querySelector('.pp-cols')], { y: 4, duration: 320, fadeDuration: 240 });
  renderPerson.lastId = id;
}

// ------------------------------------------------------------------ outreach editor (exported for Campaigns)
function highlight(body, detail) {
  if (!detail) return esc(body);
  const i = body.toLowerCase().indexOf(detail.toLowerCase());
  if (i < 0) return esc(body);
  return esc(body.slice(0, i)) + '<mark class="pp-pd">' + esc(body.slice(i, i + detail.length)) + '</mark>' + esc(body.slice(i + detail.length));
}
const FLAG_HARD = ['referral', 'shared_connection', 'work_claim'];

export async function openOutreach(id, onChange = () => {}) {
  await useStyle(CSS);
  const m = modal('<h2 class="sr-only">Outreach draft</h2><div class="spinner" data-status="working"><i aria-hidden="true"></i>Loading the draft…</div>', { wide: true });
  m.el.classList.add('pp-omodal');
  const tz = window.__byline?.timezone;
  const draw = async () => {
    let o;
    try { o = await api.get(`/outreach/${id}`, { fresh: true }); } catch (e) { toast(e.message, 'err'); return m.close(); }
    const sent = o.status === 'sent', locked = sent || o.status === 'cancelled';
    const limit = LIMITS[o.channel];
    m.el.innerHTML = String(html`
      <header class="pp-o-head">
        <div>
          <p class="eyebrow">Outreach · ${PURPOSES[o.purpose] || label(o.purpose)}</p>
          <h2>To <a href="#/person/${o.contact_id}" data-close>${stripDemo(o.contact.name)}</a></h2>
        </div>
        <div class="cluster">${status(o.status)}<span class="chip">${CHANNELS[o.channel] || o.channel}</span>${o.approval_valid ? html`<span class="tag tag--ok">${icon('check')}Approval valid</span>` : ''}</div>
      </header>
      ${o.last_error ? html`<p class="pp-note pp-note--err">Last send failed: ${o.last_error}</p>` : ''}
      ${o.contact.dnc ? html`<div class="pp-callout pp-callout--err" role="note">${icon('x')}<p>${stripDemo(o.contact.name)} is marked do-not-contact. This message cannot be approved or sent.</p></div>` : ''}
      <div class="pp-o-grid">
        <div class="stack">
          ${field(o.channel === 'email' ? 'Recipient (published professional email)' : 'Recipient (profile or handle)', html`<input class="input" id="f-recipient" value="${o.recipient || ''}" ${locked ? 'disabled' : ''}>`)}
          ${o.channel === 'email' || o.subject ? field('Subject', html`<input class="input" id="f-subject" value="${o.subject || ''}" ${locked ? 'disabled' : ''}>`) : ''}
          <label class="field"><span class="pp-lbl-row"><span>Message</span><span class="pp-count" id="count" aria-live="polite"></span></span><textarea class="textarea" id="f-body" rows="9" ${locked ? 'disabled' : ''}>${o.body || ''}</textarea></label>
          ${field('Send at', html`<input class="input" id="f-send" type="datetime-local" value="${toLocalInput(o.send_at)}" ${locked ? 'disabled' : ''}>`)}
          <div class="nested pp-preview-box"><p class="section-label">Preview · personal detail highlighted</p><div id="preview" class="pp-preview"></div></div>
        </div>
        <div class="pp-o-side stack">
          <div><h3 class="pp-h3">Personal detail</h3>${o.personal_detail ? html`<mark class="pp-pd">${o.personal_detail}</mark>` : html`<p class="pp-note">None</p>`}</div>
          <div><h3 class="pp-h3">What informed this</h3>${(o.basis || []).length ? html`<ul class="pp-basis">${(o.basis || []).map(b => html`<li>${b.detail}${b.source ? html` <a href="${b.source}" target="_blank" rel="noopener">source${icon('arrow-up-right')}</a>` : html` <span class="tag tag--err">Unsourced</span>`}</li>`)}</ul>` : html`<p class="pp-note">No sourced details were used.</p>`}</div>
          <div><h3 class="pp-h3">Review flags</h3>${o.flags.length ? html`<ul class="pp-flags">${o.flags.map(f => html`<li><span class="tag ${FLAG_HARD.includes(f.type) ? 'tag--err' : 'tag--warn'}">${label(f.type)}</span><span>${f.message}</span></li>`)}</ul>` : html`<p class="pp-note pp-note--ok">${icon('check')}No flags.</p>`}</div>
          <p class="pp-note">Approving covers this exact <b>recipient, message and send time</b>. Any edit to them returns it to review. Byline never sends for you on its own: send it yourself, then mark it sent (safe to click twice; it only logs once).</p>
          ${sent ? html`<p class="pp-note">Sent ${whenLabel(o.sent_at, tz)}.</p>` : ''}
        </div>
      </div>
      <footer class="pp-o-foot">
        <div class="cluster">${!sent ? html`<button class="btn btn--danger btn--sm" data-o="delete">Delete draft</button>` : ''}</div>
        <div class="cluster">
          <button class="btn" data-o="copy">Copy text</button>
          ${!locked ? html`<button class="btn" data-o="save" id="b-save">Save changes</button>
            <button class="btn btn--primary" data-o="approve" ${o.contact.dnc ? 'disabled' : ''}>${o.approval_valid ? html`${icon('check')}Approved` : 'Approve'}</button>` : ''}
          ${o.channel === 'email' && !locked && SMTP_READY ? html`<button class="btn btn--primary" data-o="send" id="b-send" ${o.approval_valid ? '' : 'disabled'} title="Sends through your Gmail at the approved time">${o.status === 'queued' ? 'Queued' : (o.send_at && Date.parse(o.send_at) > Date.now() + 60e3) ? 'Queue for send time' : 'Send via Gmail'}</button>` : ''}
          ${o.status !== 'cancelled' ? html`<button class="btn" data-o="sent" id="b-sent" ${o.approval_valid || sent ? '' : 'disabled'} title="Enabled once the exact message is approved">${sent ? html`${icon('check')}Marked as sent` : 'I sent it: mark as sent'}</button>` : ''}
          <button class="btn btn--ghost" data-close>Close</button>
        </div>
      </footer>`);
    const label0 = m.el.querySelector('h2');
    if (label0) { label0.id = label0.id || `o-dlg-${id}`; m.el.setAttribute('aria-labelledby', label0.id); }

    const $ = (s) => m.el.querySelector(s);
    const orig = { recipient: o.recipient || '', subject: o.subject || '', body: o.body || '', send_at: toLocalInput(o.send_at) };
    const current = () => ({ recipient: $('#f-recipient').value, subject: $('#f-subject')?.value ?? orig.subject, body: $('#f-body').value, send_at: $('#f-send').value });
    const changes = () => { const cur = current(), out = {}; for (const k in cur) if (cur[k] !== orig[k]) out[k] = k === 'send_at' ? (cur[k] ? new Date(cur[k]).toISOString() : null) : cur[k]; return out; };
    const refresh = () => {
      const body = $('#f-body').value, n = body.length;
      $('#count').textContent = limit ? `${n} / ${limit}` : `${n} characters`;
      $('#count').classList.toggle('is-over', !!(limit && n > limit));
      $('#preview').innerHTML = highlight(body, o.personal_detail);
      const dirty = Object.keys(changes()).length > 0;
      if ($('#b-sent') && !sent) $('#b-sent').disabled = dirty || !o.approval_valid;
      if ($('#b-send')) $('#b-send').disabled = dirty || !o.approval_valid;
      if ($('#b-save')) $('#b-save').textContent = dirty ? 'Save changes •' : 'Save changes';
    };
    m.el.oninput = refresh;
    refresh();
    const save = async () => {
      const ch = changes();
      if (!Object.keys(ch).length) return o;
      const r = await api.patch(`/outreach/${id}`, ch);
      if (o.status === 'approved' && r.status !== 'approved') toast('Edited after approval, so it went back to review', 'ok');
      onChange();
      return r;
    };
    m.el.querySelectorAll('[data-o]').forEach(b => b.onclick = async () => {
      const a = b.dataset.o;
      if (a === 'copy') { await copy([current().subject && o.channel === 'email' ? `Subject: ${current().subject}\n\n` : '', current().body].join('')); return; }
      if (a === 'save') await act(b, async () => { await save(); toast('Saved', 'ok'); await draw(); });
      if (a === 'approve') await act(b, async () => {
        const r = await save();
        await api.post(`/outreach/${id}/approve`, { hash: r.current_hash });
        toast('Approved. Send it yourself, then mark it sent.', 'ok'); onChange(); await draw();
      });
      if (a === 'send') await act(b, async () => { const r = await api.post(`/outreach/${id}/send`); toast(r.status === 'queued' ? `Queued; sends ${whenLabel(r.send_at, tz)}` : 'Sent and logged', 'ok'); onChange(); await draw(); }, 'Sending…');
      if (a === 'sent') await act(b, async () => { await api.post(`/outreach/${id}/sent`); toast('Marked as sent and logged', 'ok'); onChange(); await draw(); });
      if (a === 'delete') {
        if (!(await confirmBox('Delete this outreach draft?', 'Delete'))) return;
        await act(b, async () => { await api.del(`/outreach/${id}`); toast('Draft deleted', 'ok'); m.close(); onChange(); });
      }
    });
  };
  await draw();
}
