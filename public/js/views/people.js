import { api } from '../api.js';
import { html, raw, esc, on, act, toast, modal, confirmBox, status, fmtDate, fmtDateTime, copy } from '../ui.js';

export const STAGES = ['researching', 'drafting', 'contacted', 'replied', 'met', 'nurturing', 'paused'];
export const PURPOSES = { mentorship: 'Mentorship question', informational: 'Informational interview', peer: 'Peer connection', event_followup: 'Event follow-up', project_feedback: 'Project feedback', thank_you: 'Thank-you' };
export const CHANNELS = { email: 'Cold email', linkedin_note: 'LinkedIn note (300)', instagram_dm: 'Instagram DM', short: 'Short (200 chars)' };
const KINDS = ['introduction', 'message_sent', 'reply', 'coffee_chat', 'call', 'meeting', 'thank_you', 'follow_up', 'event', 'note'];
const LIMITS = { short: 200, linkedin_note: 300 };
const today = () => new Date().toISOString().slice(0, 10);
const label = (s) => (s || '').replace(/_/g, ' ');
const opts = (list, sel) => list.map(([v, l]) => html`<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`);
const fresh = (el) => { const root = document.createElement('div'); el.replaceChildren(root); return root; };
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); if (isNaN(d)) return ''; return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };

let SMTP_READY = false;
api.get('/status').then(st => { SMTP_READY = st.delivery?.email?.via === 'gmail'; }).catch(() => {});

const SEGMENTS = { target_team: 'Target team', ksu_alumni: 'KSU alumni in tech', founder: 'Founder / operator', peer: 'Peer', other: 'Other' };

export async function render(el, ctx = {}) {
  if (ctx.name === 'person' && ctx.params?.[0]) return renderPerson(el, ctx.params[0], ctx);
  return renderList(el, ctx);
}

// ---------------------------------------------------------------- list view
async function renderList(el, ctx) {
  const [contacts, fu, suggestions, queue] = await Promise.all([api.get('/contacts'), api.get('/followups'), api.get('/connections/suggestions'), api.get('/outreach')]);
  const root = fresh(el);
  const t = today();
  const hidden = (renderList.hidden ||= new Set());
  const sugg = suggestions.filter((s, i) => !hidden.has(`${s.contact.id}-${s.story.id}`));

  root.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker">Relationships</div>
      <h1>People</h1>
      <p class="lede">Research cards, follow-ups, and permissioned outreach. Every message is a draft until you approve the exact recipient, text, and send time — and you send it yourself.</p>
    </div>
    <div class="row"><button class="primary" data-act="add">Add contact</button></div>
  </div>

  <div class="split">
    <div class="stack reveal">
      <section class="card">
        <div class="row between"><h3>Contacts</h3><span class="mono faint">${contacts.length} total</span></div>
        ${contacts.length ? html`<table>
          <thead><tr><th>Name</th><th>Stage</th><th>Employer / org</th><th>Next step</th><th>Last contact</th></tr></thead>
          <tbody>${contacts.map(c => html`<tr class="click" data-href="#/person/${c.id}">
            <td><strong>${c.name}</strong>${c.dnc ? html` <span class="chip red">do not contact</span>` : ''}${c.ksu_alumni ? html` <span class="chip amber">KSU</span>` : ''}<div class="faint small">${c.role || ''}${c.segment ? ` · ${SEGMENTS[c.segment] || c.segment}` : ''}</div></td>
            <td>${status(c.stage)}</td>
            <td>${c.employer || ''}${c.employer && c.org ? html`<div class="faint small">${c.org}</div>` : c.org}</td>
            <td>${c.next_step || '—'}${c.next_date ? html`<div class="small ${c.next_date < t ? 'due-late' : c.next_date === t ? 'due-today' : 'faint'}">${fmtDate(c.next_date + 'T12:00:00')}</div>` : ''}</td>
            <td class="small muted">${c.last_interaction ? fmtDate(c.last_interaction + 'T12:00:00') : '—'}</td>
          </tr>`)}</tbody></table>` : html`<div class="empty">No contacts yet. Add someone whose public work you've actually read — with a source for every detail.</div>`}
      </section>

      <section class="card">
        <div class="row between"><h3>Outreach queue</h3><span class="mono faint">${queue.filter(o => !['sent', 'cancelled'].includes(o.status)).length} open</span></div>
        ${queue.length ? html`<table>
          <thead><tr><th>To</th><th>Purpose</th><th>Channel</th><th>Send at</th><th>Status</th></tr></thead>
          <tbody>${queue.map(o => html`<tr class="click" data-outreach="${o.id}">
            <td>${o.name}<div class="faint small">${o.subject || ''}</div></td><td class="small">${PURPOSES[o.purpose] || label(o.purpose)}</td>
            <td class="small">${CHANNELS[o.channel] || o.channel}</td><td class="small muted">${o.sent_at ? 'sent ' + fmtDateTime(o.sent_at) : fmtDateTime(o.send_at)}</td><td>${status(o.status)}</td></tr>`)}</tbody></table>`
        : html`<p class="muted small">No outreach drafts. Open a contact to draft one.</p>`}
      </section>
    </div>

    <div class="stack reveal">
      ${fu.week ? html`<section class="card flat">
        <div class="row between"><h3>This week’s outreach</h3><span class="mono">${fu.week.sent} / ${fu.week.goal}</span></div>
        <div class="track-bar"><b style="width:${Math.min(100, fu.week.goal ? fu.week.sent / fu.week.goal * 100 : 0)}%"></b></div>
        <p class="small muted" style="margin:8px 0 0">${fu.week.sent >= fu.week.goal ? 'Goal met — quality over volume from here.' : `${fu.week.goal - fu.week.sent} more approved message${fu.week.goal - fu.week.sent === 1 ? '' : 's'} to hit your weekly goal.`}</p>
      </section>` : ''}
      <section class="card ledger">
        <h3>Follow-ups</h3>
        ${fu.due.length ? fu.due.map(f => html`<div class="row between list-row">
          <span><a href="#/person/${f.id}">${f.name}</a> <span class="faint small">${f.employer || ''}</span><div class="small muted">${f.next_step || ''}</div></span>
          <span class="chip ${f.next_date < t ? 'red' : f.next_date === t ? 'amber' : ''}">${f.next_date < t ? 'overdue · ' : f.next_date === t ? 'today · ' : ''}${fmtDate(f.next_date + 'T12:00:00', { month: 'short', day: 'numeric' })}</span></div>`)
        : html`<p class="muted small">Nothing scheduled.</p>`}
        <div class="hr"></div>
        <h3>Awaiting reply</h3>
        ${fu.awaiting_reply.length ? fu.awaiting_reply.map(a => html`<div class="row between list-row">
          <span><a href="#/person/${a.id}">${a.name}</a><div class="small muted">sent ${fmtDate(a.sent_at)}</div></span>
          <span class="chip blue" title="Suggested follow-up date">follow up ${fmtDate(a.suggested_follow_up + 'T12:00:00', { month: 'short', day: 'numeric' })}</span></div>`)
        : html`<p class="muted small">No sent messages waiting on a reply. Logging a reply pauses reminders automatically.</p>`}
      </section>

      <section class="card">
        <h3>Content → connection</h3>
        <p class="faint small" style="margin-top:-4px">Only from stories you actually read and marked useful, saved, or tested. You choose — nothing is sent.</p>
        ${sugg.length ? sugg.map(s => html`<div class="sugg">
          <div class="row between"><a href="#/person/${s.contact.id}"><strong>${s.contact.name}</strong></a><button class="sm ghost" data-act="dismiss" data-key="${s.contact.id}-${s.story.id}">Dismiss</button></div>
          <div class="small">${s.reason}</div>
          <div class="small faint">From <a href="#/story/${s.story.id}">${s.story.title}</a>${s.source?.url ? html` · <a href="${s.source.url}" target="_blank" rel="noopener">source ↗</a>` : ''}</div>
          ${s.options.map(o => html`<div class="row between sugg-opt"><span class="small">${o.text}</span>
            ${o.kind === 'private_question' ? html`<button class="sm" data-act="sugg-private" data-contact="${s.contact.id}" data-story="${s.story.id}">Start draft</button>`
              : s.source?.url ? html`<a class="btn sm-link small" href="${s.source.url}" target="_blank" rel="noopener">Open post ↗</a>` : ''}</div>`)}
        </div>`) : html`<p class="muted small">No suggestions right now. They appear when a contact authored, or their team appears in, a story you engaged with.</p>`}
      </section>
    </div>
  </div>`);

  const again = () => renderList(el, ctx);
  on(root, 'click', 'tr[data-href]', (e, tr) => { location.hash = tr.dataset.href; });
  on(root, 'click', 'tr[data-outreach]', (e, tr) => openOutreach(tr.dataset.outreach, again));
  on(root, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'add') openAddContact();
    if (a === 'dismiss') { hidden.add(btn.dataset.key); again(); }
    if (a === 'sugg-private') await act(btn, async () => {
      const o = await api.post(`/contacts/${btn.dataset.contact}/outreach`, { purpose: 'mentorship', channel: 'linkedin_note', story_id: Number(btn.dataset.story) });
      toast('Draft created — review before approving', 'ok');
      again(); openOutreach(o.id, again);
    }, 'Drafting…');
  });
}

async function openAddContact() {
  const employers = await api.get('/employers').catch(() => []);
  const m = modal(String(html`
    <h2>Add contact</h2>
    <p class="muted small">Record only public, professional details — each with the source where it was published. An email address must come from the person's or organization's own publication, or from the person directly.</p>
    <form class="form-grid" id="cf">
      <label class="field">Name *<input name="name" required></label>
      <label class="field">Public role<input name="role"></label>
      <label class="field">Organization<input name="org"></label>
      <label class="field">Target employer<select name="employer"><option value="">— none —</option>${employers.map(e => html`<option>${e.name}</option>`)}</select></label>
      <label class="field">Team<input name="team"></label>
      <label class="field">LinkedIn URL<input name="linkedin"></label>
      <label class="field">Email<input name="email" type="email"></label>
      <label class="field">Where the email was published<input name="email_source" placeholder="URL or “given to me at …”"></label>
      <label class="field">Instagram handle<input name="instagram"></label>
      <label class="field">Next date<input name="next_date" type="date"></label>
<label class="field">Segment<select name="segment">${Object.entries(SEGMENTS).map(([k, l]) => html`<option value="${k}" ${('target_team') === k ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label class="check" style="align-self:end"><input type="checkbox" name="ksu_alumni" value="1" > KSU alumni</label>
      <label class="field full">Why connect<textarea name="why" rows="2"></textarea></label>
      <div class="full">
        <div class="row between"><span class="field-label">Public details (each needs a source URL)</span><button type="button" class="sm" data-add-detail>+ Detail</button></div>
        <div id="details" class="stack" style="margin-top:8px"></div>
      </div>
      <label class="field full">Private note <span class="chip amber">private</span><textarea name="private_note" rows="2" placeholder="Never exported, never used in drafts"></textarea></label>
      <div class="full row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Save contact</button></div>
    </form>`), { wide: true });
  const box = m.el.querySelector('#details');
  const addRow = () => box.insertAdjacentHTML('beforeend', `<div class="detail-row"><input placeholder="Detail, e.g. wrote about eval harnesses for agents" data-d><input placeholder="https://source…" data-s><button type="button" class="sm ghost" data-rm>✕</button></div>`);
  addRow();
  m.el.addEventListener('click', (e) => { if (e.target.closest('[data-add-detail]')) addRow(); if (e.target.closest('[data-rm]')) e.target.closest('.detail-row').remove(); });
  m.el.querySelector('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const details = [...box.querySelectorAll('.detail-row')].map(r => ({ detail: r.querySelector('[data-d]').value.trim(), source: r.querySelector('[data-s]').value.trim() })).filter(d => d.detail || d.source);
    if (details.some(d => !d.detail || !d.source)) return toast('Every public detail needs both the detail and its source URL.', 'err');
    if (f.email && !f.email_source.trim()) return toast('Say where the email address was published (or that they gave it to you).', 'err');
    await act(e.submitter, async () => {
      const c = await api.post('/contacts', { ...f, ksu_alumni: !!f.ksu_alumni, next_date: f.next_date || null, details });
      m.close(); toast('Contact added', 'ok'); location.hash = `#/person/${c.id}`;
    }, 'Saving…');
  });
}

// ---------------------------------------------------------------- detail view
async function renderPerson(el, id, ctx) {
  const c = await api.get(`/contacts/${id}`);
  const root = fresh(el);
  const details = c.details || [];
  const prep = (renderPerson.prep ||= {})[id];

  root.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker"><a href="#/people">← People</a></div>
      <h1>${c.name}</h1>
      <p class="lede">${[c.role, c.org || c.employer].filter(Boolean).join(' · ') || 'No public role recorded yet'}</p>
      <div class="row" style="margin-top:10px">${status(c.stage)}${c.employer ? html`<span class="chip violet">${c.employer}</span>` : ''}${c.team ? html`<span class="chip">${c.team}</span>` : ''}${c.dnc ? html`<span class="chip red">DO NOT CONTACT</span>` : ''}</div>
    </div>
    <div class="row"><button class="danger sm" data-act="delete">Delete contact</button></div>
  </div>
  ${c.dnc ? html`<div class="card flat dnc-banner">Marked <strong>do not contact</strong>. Drafting, approving, and sending are blocked, and open drafts were cancelled.</div>` : ''}

  <div class="split">
    <div class="stack reveal">
      <section class="card">
        <h3>Research card</h3>
        <form class="form-grid" id="research">
          <label class="field">Name<input name="name" value="${c.name}"></label>
          <label class="field">Public role<input name="role" value="${c.role || ''}"></label>
          <label class="field">Organization<input name="org" value="${c.org || ''}"></label>
          <label class="field">Target employer<input name="employer" value="${c.employer || ''}"></label>
          <label class="field">Team<input name="team" value="${c.team || ''}"></label>
          <label class="field">LinkedIn<input name="linkedin" value="${c.linkedin || ''}"></label>
          <label class="field">Email<input name="email" type="email" value="${c.email || ''}"></label>
          <label class="field">Email published at<input name="email_source" value="${c.email_source || ''}"></label>
          <label class="field">Instagram<input name="instagram" value="${c.instagram || ''}"></label>
          <label class="field">Segment<select name="segment">${Object.entries(SEGMENTS).map(([k, l]) => html`<option value="${k}" ${(c.segment || 'target_team') === k ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label class="check" style="align-self:end"><input type="checkbox" name="ksu_alumni" value="1" ${c.ksu_alumni ? 'checked' : ''}> KSU alumni</label>
          <label class="field full">Why connect<textarea name="why" rows="2">${c.why || ''}</textarea></label>
          <div class="full row" style="justify-content:flex-end"><button class="sm" type="submit">Save research</button></div>
        </form>
        <div class="hr"></div>
        <div class="row between"><h3 style="margin:0">Sourced public details</h3><button class="sm" data-act="add-detail">+ Detail</button></div>
        <div id="details" class="stack" style="margin-top:10px">
          ${details.length ? details.map((d, i) => html`<div class="detail-row" data-i="${i}">
            <input data-d value="${d.detail || ''}"><input data-s value="${d.source || ''}" placeholder="https://source…">
            <button class="sm ghost" data-act="rm-detail" title="Remove">✕</button></div>`) : html`<p class="muted small" data-none>No details yet. Personalization needs at least one sourced detail.</p>`}
        </div>
        <div class="row" style="justify-content:flex-end;margin-top:10px"><button class="sm" data-act="save-details">Save details</button></div>
      </section>

      <section class="card">
        <h3>Draft outreach</h3>
        <p class="faint small" style="margin-top:-4px">A mentorship question is not a referral request — the two are kept separate. First-person claims come only from your public-OK experiences.</p>
        <div class="form-grid">
          <label class="field">Purpose<select id="o-purpose">${opts(Object.entries(PURPOSES).filter(([k]) => k !== 'thank_you'), 'mentorship')}</select></label>
          <label class="field">Channel<select id="o-channel">${opts(Object.entries(CHANNELS), 'email')}</select></label>
          <div class="full">
            <span class="field-label">Use these sourced details</span>
            <div class="stack" style="margin-top:6px">${details.length ? details.map((d, i) => html`<label class="check"><input type="checkbox" data-detail-idx="${i}" ${i === 0 ? 'checked' : ''}> ${d.detail} ${d.source ? html`<a href="${d.source}" target="_blank" rel="noopener" class="small">source ↗</a>` : html`<span class="chip red">no source</span>`}</label>`) : html`<span class="muted small">None recorded — the draft will be flagged as unsourced.</span>`}</div>
          </div>
          <div class="full row" style="justify-content:flex-end"><button class="primary" data-act="draft" ${c.dnc ? 'disabled' : ''}>Draft message</button></div>
        </div>
        ${c.outreach.length ? html`<div class="hr"></div><h3>Messages</h3>
          <table><tbody>${c.outreach.map(o => html`<tr class="click" data-outreach="${o.id}"><td>${PURPOSES[o.purpose] || label(o.purpose)}<div class="faint small">${o.subject || ''}</div></td><td class="small">${CHANNELS[o.channel] || o.channel}</td>
            <td class="small muted">${o.sent_at ? 'sent ' + fmtDateTime(o.sent_at) : o.send_at ? 'send ' + fmtDateTime(o.send_at) : ''}</td><td>${status(o.status)}</td></tr>`)}</tbody></table>` : ''}
      </section>

      <section class="card">
        <h3>Interaction log</h3>
        <form class="row" id="ix" style="align-items:flex-end">
          <label class="field" style="flex:1 1 140px">Kind<select name="kind">${opts(KINDS.map(k => [k, label(k)]), 'note')}</select></label>
          <label class="field" style="flex:0 1 160px">Date<input type="date" name="date" value="${today()}"></label>
          <label class="field" style="flex:2 1 240px">Notes<input name="notes"></label>
          <button type="submit">Log</button>
        </form>
        <p class="faint small">Logging a <strong>reply</strong> pauses follow-up reminders and moves the stage to “replied”. A coffee chat, call, or meeting sets the next step to a thank-you.</p>
        ${c.interactions.length ? c.interactions.map(i => html`<div class="row between list-row"><span><span class="chip ${i.kind === 'reply' ? 'green' : ''}">${label(i.kind)}</span> <span class="mono faint">${i.date}</span><div class="small">${i.notes || ''}</div></span>
          <button class="sm ghost" data-act="rm-ix" data-id="${i.id}">✕</button></div>`) : html`<p class="muted small">No interactions yet.</p>`}
      </section>
    </div>

    <div class="stack reveal">
      <section class="card">
        <h3>Relationship</h3>
        <form class="stack" id="rel">
          <label class="field">Stage<select name="stage">${opts([...new Set([...STAGES, c.stage].filter(Boolean))].map(s => [s, s]), c.stage)}</select></label>
          <label class="field">Next step<input name="next_step" value="${c.next_step || ''}"></label>
          <label class="field">Next date<input name="next_date" type="date" value="${c.next_date || ''}"></label>
          <div class="row" style="justify-content:flex-end"><button class="sm" type="submit">Save</button></div>
        </form>
        <div class="hr"></div>
        <div class="row between"><span class="small">${c.dnc ? 'Do-not-contact is ON' : 'Do not contact'}</span><button class="sm ${c.dnc ? '' : 'danger'}" data-act="dnc">${c.dnc ? 'Clear do-not-contact' : 'Mark do not contact'}</button></div>
      </section>

      <section class="card private-card">
        <div class="row between"><h3 style="margin:0">Private note</h3><span class="chip amber">private</span></div>
        <p class="faint small">Only you see this. It is never exported and never used to write drafts.</p>
        <textarea id="pnote" rows="4">${c.private_note || ''}</textarea>
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="sm" data-act="save-note">Save note</button></div>
      </section>

      <section class="card">
        <div class="row between"><h3 style="margin:0">Meeting prep</h3><button class="sm" data-act="prep">${prep ? 'Regenerate' : 'Prepare questions'}</button></div>
        ${prep ? html`<ol class="prep">${prep.map(q => html`<li>${q}</li>`)}</ol>` : html`<p class="muted small">2–3 questions grounded in their sourced public work.</p>`}
      </section>

      <section class="card">
        <h3>After the call</h3>
        <textarea id="ty-notes" rows="3" placeholder="What did you talk about? What advice will you act on?"></textarea>
        <div class="row" style="justify-content:flex-end;margin-top:8px"><button class="sm" data-act="thankyou" ${c.dnc ? 'disabled' : ''}>Draft thank-you</button></div>
      </section>
    </div>
  </div>`);

  const again = () => renderPerson(el, id, ctx);
  const readDetails = () => [...root.querySelectorAll('#details .detail-row')].map(r => ({ detail: r.querySelector('[data-d]').value.trim(), source: r.querySelector('[data-s]').value.trim() })).filter(d => d.detail || d.source);

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
    await act(e.submitter, async () => { await api.post(`/contacts/${id}/interactions`, f); toast(f.kind === 'reply' ? 'Reply logged — follow-ups paused' : 'Logged', 'ok'); again(); });
  });
  on(root, 'click', 'tr[data-outreach]', (e, tr) => openOutreach(tr.dataset.outreach, again));
  on(root, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'add-detail') {
      root.querySelector('#details [data-none]')?.remove();
      root.querySelector('#details').insertAdjacentHTML('beforeend', `<div class="detail-row"><input data-d placeholder="Public detail"><input data-s placeholder="https://source…"><button class="sm ghost" data-act="rm-detail">✕</button></div>`);
    }
    if (a === 'rm-detail') btn.closest('.detail-row').remove();
    if (a === 'save-details') {
      const d = readDetails();
      if (d.some(x => !x.detail || !x.source)) return toast('Every public detail needs both the detail and its source URL.', 'err');
      await act(btn, async () => { await api.patch(`/contacts/${id}`, { details: d }); toast('Details saved', 'ok'); again(); });
    }
    if (a === 'save-note') await act(btn, async () => { await api.patch(`/contacts/${id}`, { private_note: root.querySelector('#pnote').value }); toast('Private note saved', 'ok'); });
    if (a === 'rm-ix') await act(btn, async () => { await api.del(`/interactions/${btn.dataset.id}`); again(); });
    if (a === 'dnc') {
      const turnOn = !c.dnc;
      if (!(await confirmBox(turnOn ? `Mark ${c.name} as do-not-contact? Open outreach drafts will be cancelled and new drafts blocked.` : `Clear do-not-contact for ${c.name}?`, turnOn ? 'Mark do not contact' : 'Clear'))) return;
      await act(btn, async () => { await api.patch(`/contacts/${id}`, { dnc: turnOn }); toast(turnOn ? 'Marked do not contact' : 'Cleared', 'ok'); again(); });
    }
    if (a === 'delete') {
      if (!(await confirmBox(`Delete ${c.name}, their interaction history, and all outreach drafts?`, 'Delete'))) return;
      await act(btn, async () => { await api.del(`/contacts/${id}`); toast('Contact deleted', 'ok'); location.hash = '#/people'; });
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
}

// ---------------------------------------------------------------- outreach editor (exported for campaigns)
function highlight(body, detail) {
  if (!detail) return esc(body);
  const i = body.toLowerCase().indexOf(detail.toLowerCase());
  if (i < 0) return esc(body);
  return esc(body.slice(0, i)) + '<mark class="pd">' + esc(body.slice(i, i + detail.length)) + '</mark>' + esc(body.slice(i + detail.length));
}

export async function openOutreach(id, onChange = () => {}) {
  const m = modal('<div class="muted"><span class="spinner"></span> Loading…</div>', { wide: true });
  const draw = async () => {
    let o;
    try { o = await api.get(`/outreach/${id}`); } catch (e) { toast(e.message, 'err'); return m.close(); }
    const sent = o.status === 'sent', locked = sent || o.status === 'cancelled';
    const limit = LIMITS[o.channel];
    m.el.innerHTML = String(html`
      <div class="row between">
        <div><div class="kicker">Outreach · ${PURPOSES[o.purpose] || label(o.purpose)}</div><h2 style="margin:4px 0 0">To <a href="#/person/${o.contact_id}" data-close>${o.contact.name}</a></h2></div>
        <div class="row">${status(o.status)}<span class="chip">${CHANNELS[o.channel] || o.channel}</span>${o.approval_valid ? html`<span class="chip green">approval valid</span>` : ''}</div>
        ${o.last_error ? html`<div class="small" style="color:var(--red);margin-top:6px">Last send failed: ${o.last_error}</div>` : ''}
      </div>
      ${o.contact.dnc ? html`<div class="card flat dnc-banner" style="margin-top:12px">${o.contact.name} is marked do-not-contact. This message cannot be approved or sent.</div>` : ''}
      <div class="split" style="margin-top:16px">
        <div class="stack">
          <label class="field">Recipient ${o.channel === 'email' ? '(published professional email)' : '(profile / handle)'}<input id="f-recipient" value="${o.recipient || ''}" ${locked ? 'disabled' : ''}></label>
          ${o.channel === 'email' || o.subject ? html`<label class="field">Subject<input id="f-subject" value="${o.subject || ''}" ${locked ? 'disabled' : ''}></label>` : ''}
          <label class="field"><span class="row between"><span>Message</span><span class="mono" id="count"></span></span><textarea id="f-body" rows="9" ${locked ? 'disabled' : ''}>${o.body || ''}</textarea></label>
          <label class="field">Send at<input id="f-send" type="datetime-local" value="${toLocalInput(o.send_at)}" ${locked ? 'disabled' : ''}></label>
          <div class="card flat small"><div class="faint mono" style="margin-bottom:6px">PREVIEW · personal detail highlighted</div><div id="preview" class="preview"></div></div>
        </div>
        <div class="stack">
          <div><h3>Personal detail</h3>${o.personal_detail ? html`<mark class="pd">${o.personal_detail}</mark>` : html`<span class="muted small">None</span>`}</div>
          <div><h3>What informed this</h3>${(o.basis || []).length ? (o.basis || []).map(b => html`<div class="evidence small">${b.detail}${b.source ? html` <a href="${b.source}" target="_blank" rel="noopener">source ↗</a>` : html` <span class="chip red">unsourced</span>`}</div>`) : html`<p class="muted small">No sourced details were used.</p>`}</div>
          <div><h3>Review flags</h3>${o.flags.length ? o.flags.map(f => html`<div class="flag-row"><span class="chip ${['referral', 'shared_connection', 'work_claim'].includes(f.type) ? 'red' : 'amber'}">${label(f.type)}</span> <span class="small">${f.message}</span></div>`) : html`<p class="small" style="color:var(--green)">No flags.</p>`}</div>
          <p class="faint small">Approving covers this exact <strong>recipient, message, and send time</strong>. Any edit to them returns it to review. Byline never sends for you: send it yourself, then mark it sent (safe to click twice — it only logs once).</p>
          ${sent ? html`<p class="small">Sent ${fmtDateTime(o.sent_at)}.</p>` : ''}
        </div>
      </div>
      <div class="row between" style="margin-top:18px">
        <div class="row">${!sent ? html`<button class="danger sm" data-o="delete">Delete draft</button>` : ''}</div>
        <div class="row">
          <button data-o="copy">Copy text</button>
          ${!locked ? html`<button data-o="save" id="b-save">Save changes</button>
            <button class="primary" data-o="approve" ${o.contact.dnc ? 'disabled' : ''}>${o.approval_valid ? 'Approved ✓' : 'Approve'}</button>` : ''}
          ${o.channel === 'email' && !locked && SMTP_READY ? html`<button class="primary" data-o="send" id="b-send" ${o.approval_valid ? '' : 'disabled'} title="Sends through your Gmail at the approved time">${o.status === 'queued' ? 'Queued ✓' : (o.send_at && Date.parse(o.send_at) > Date.now() + 60e3) ? 'Queue for send time' : 'Send via Gmail'}</button>` : ''}
          ${o.status !== 'cancelled' ? html`<button class="amber" data-o="sent" id="b-sent" ${o.approval_valid || sent ? '' : 'disabled'} title="Enabled once the exact message is approved">${sent ? 'Marked as sent' : 'I sent it — mark as sent'}</button>` : ''}
          <button class="ghost" data-close>Close</button>
        </div>
      </div>`);

    const $ = (s) => m.el.querySelector(s);
    const orig = { recipient: o.recipient || '', subject: o.subject || '', body: o.body || '', send_at: toLocalInput(o.send_at) };
    const current = () => ({ recipient: $('#f-recipient').value, subject: $('#f-subject')?.value ?? orig.subject, body: $('#f-body').value, send_at: $('#f-send').value });
    const changes = () => { const c = current(), out = {}; for (const k in c) if (c[k] !== orig[k]) out[k] = k === 'send_at' ? (c[k] ? new Date(c[k]).toISOString() : null) : c[k]; return out; };
    const refresh = () => {
      const body = $('#f-body').value, n = body.length;
      $('#count').textContent = limit ? `${n} / ${limit}` : `${n} chars`;
      $('#count').className = 'mono ' + (limit && n > limit ? 'over' : 'faint');
      $('#preview').innerHTML = highlight(body, o.personal_detail);
      const dirty = Object.keys(changes()).length > 0;
      if ($('#b-sent') && !sent) $('#b-sent').disabled = dirty || !o.approval_valid;
      if ($('#b-send')) $('#b-send').disabled = dirty || !o.approval_valid;
      if ($('#b-save')) $('#b-save').textContent = dirty ? 'Save changes •' : 'Save changes';
    };
    m.el.addEventListener('input', refresh);
    refresh();
    const save = async () => {
      const ch = changes();
      if (!Object.keys(ch).length) return o;
      const r = await api.patch(`/outreach/${id}`, ch);
      if (o.status === 'approved' && r.status !== 'approved') toast('Edited after approval — returned to review', 'ok');
      onChange();
      return r;
    };
    m.el.querySelectorAll('[data-o]').forEach(b => b.onclick = async () => {
      const a = b.dataset.o;
      if (a === 'copy') return copy([current().subject && o.channel === 'email' ? `Subject: ${current().subject}\n\n` : '', current().body].join(''));
      if (a === 'save') await act(b, async () => { await save(); toast('Saved', 'ok'); await draw(); });
      if (a === 'approve') await act(b, async () => {
        const r = await save();
        await api.post(`/outreach/${id}/approve`, { hash: r.current_hash });
        toast('Approved — send it yourself, then mark as sent', 'ok'); onChange(); await draw();
      });
      if (a === 'send') await act(b, async () => { const r = await api.post(`/outreach/${id}/send`); toast(r.status === 'queued' ? `Queued — sends at ${fmtDateTime(r.send_at)}` : 'Sent and logged', 'ok'); onChange(); await draw(); }, 'Sending…');
      if (a === 'sent') await act(b, async () => { await api.post(`/outreach/${id}/sent`); toast('Marked as sent and logged', 'ok'); onChange(); await draw(); });
      if (a === 'delete') {
        if (!(await confirmBox('Delete this outreach draft?', 'Delete'))) return;
        await act(b, async () => { await api.del(`/outreach/${id}`); toast('Draft deleted', 'ok'); m.close(); onChange(); });
      }
    });
  };
  await draw();
}
