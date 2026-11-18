import { api } from '../api.js';
import { html, on, act, toast, modal, confirmBox, status, channelLabel, fmtDateTime, evChip } from '../ui.js';
import { openOutreach, PURPOSES, CHANNELS } from './people.js';

const fresh = (el) => { const root = document.createElement('div'); el.replaceChildren(root); return root; };

export async function render(el, ctx = {}) {
  if (ctx.params?.[0]) return renderDetail(el, ctx.params[0], ctx);
  const campaigns = await api.get('/campaigns');
  const root = fresh(el);
  const counts = (items) => Object.entries(items.reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {}));
  root.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker">Campaign workspace</div>
      <h1>Campaigns</h1>
      <p class="lede">Group a story or project's LinkedIn post, Instagram carousel, video, and outreach. Each piece keeps its own approval — approving one never approves the others.</p>
    </div>
    <div class="row"><button class="primary" data-act="new">New campaign</button></div>
  </div>
  ${campaigns.length ? html`<div class="grid g3 reveal">${campaigns.map(c => html`<a class="card camp-card" href="#/campaigns/${c.id}">
    <div class="story-title" style="color:var(--text)">${c.name}</div>
    ${c.goal ? html`<p class="small muted" style="margin:6px 0 0">${c.goal}</p>` : ''}
    <div class="row mono faint" style="margin-top:12px">${c.drafts.length} draft${c.drafts.length === 1 ? '' : 's'} · ${c.outreach.length} outreach</div>
    <div class="row" style="margin-top:8px">${counts([...c.drafts, ...c.outreach]).map(([s, n]) => html`<span class="row" style="gap:4px">${status(s)}<span class="mono faint">×${n}</span></span>`)}</div>
  </a>`)}</div>` : html`<div class="empty">No campaigns yet. Create one to group the pieces around a story or project.</div>`}`);
  on(root, 'click', '[data-act="new"]', () => openCreate());
}

async function openCreate() {
  const [drafts, projects] = await Promise.all([api.get('/drafts'), api.get('/projects')]);
  const free = drafts.filter(d => !d.campaign_id);
  const m = modal(String(html`<h2>New campaign</h2>
    <form class="stack" id="cf">
      <label class="field">Name *<input name="name" required placeholder="e.g. Agent eval teardown launch"></label>
      <label class="field">Goal<textarea name="goal" rows="2" placeholder="What should this campaign achieve? e.g. 2 informational interviews with eval PMs"></textarea></label>
      <div class="form-grid">
        <label class="field">Story id (optional)<input name="story_id" type="number" min="1"></label>
        <label class="field">Project (optional)<select name="project_id"><option value="">— none —</option>${projects.map(p => html`<option value="${p.id}">${p.title}</option>`)}</select></label>
      </div>
      <div><span class="field-label">Include existing drafts</span>
        <div class="stack pick-list">${free.length ? free.map(d => html`<label class="check"><input type="checkbox" value="${d.id}" data-draft> ${d.title} <span class="chip">${channelLabel(d.channel, d.format)}</span> ${status(d.status)}</label>`) : html`<span class="muted small">No unassigned drafts.</span>`}</div>
      </div>
      <div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Create</button></div>
    </form>`), { wide: true });
  m.el.querySelector('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const draft_ids = [...m.el.querySelectorAll('[data-draft]:checked')].map(x => Number(x.value));
    await act(e.submitter, async () => {
      const c = await api.post('/campaigns', { name: f.name, goal: f.goal, story_id: f.story_id ? Number(f.story_id) : null, project_id: f.project_id ? Number(f.project_id) : null, draft_ids });
      m.close(); toast('Campaign created', 'ok'); location.hash = `#/campaigns/${c.id}`;
    });
  });
}

async function renderDetail(el, id, ctx) {
  const c = await api.get(`/campaigns/${id}`);
  const root = fresh(el);
  const o = c.outcomes;
  const stat = (v, l) => html`<div><div class="stat">${v ?? html`<span class="faint" style="font-size:18px">unavailable</span>`}</div><div class="stat-label">${l}</div></div>`;
  root.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker"><a href="#/campaigns">← Campaigns</a></div>
      <h1>${c.name}</h1>
      <p class="lede">${c.goal || 'No goal set.'}</p>
      <div class="row" style="margin-top:10px">${c.story_id ? html`<a class="chip blue" href="#/story/${c.story_id}">story #${c.story_id}</a>` : ''}${c.project ? html`<a class="chip amber" href="#/career/projects">project: ${c.project.title}</a>` : ''}</div>
    </div>
    <div class="row"><button data-act="edit">Edit</button><button class="danger sm" data-act="delete">Delete</button></div>
  </div>
  <div class="split">
    <div class="stack reveal">
      <section class="card">
        <div class="row between"><h3 style="margin:0">Content pieces</h3><span class="row"><button class="sm" data-act="add-drafts">Add existing drafts</button>
          ${c.project ? ['linkedin', 'instagram', 'video'].map(ch => html`<button class="sm ghost" data-new-draft="${ch}">+ ${channelLabel(ch)}</button>`) : ''}</span></div>
        ${c.drafts.length ? html`<table style="margin-top:10px"><thead><tr><th>Draft</th><th>Channel</th><th>Status</th><th>Approval</th><th></th></tr></thead>
          <tbody>${c.drafts.map(d => html`<tr><td><a href="#/draft/${d.id}">${d.title}</a></td><td class="small">${channelLabel(d.channel, d.format)}</td><td>${status(d.status)}</td>
            <td class="small">${d.published_at ? 'published' : d.approved_hash ? html`<span style="color:var(--green)">approved (this piece)</span>` : html`<span class="faint">needs approval</span>`}</td>
            <td><button class="sm ghost" data-remove-draft="${d.id}" title="Remove from campaign">✕</button></td></tr>`)}</tbody></table>`
        : html`<p class="muted small" style="margin-top:10px">No drafts in this campaign yet.</p>`}
      </section>
      <section class="card">
        <div class="row between"><h3 style="margin:0">Outreach</h3><button class="sm" data-act="add-outreach">Add outreach drafts</button></div>
        ${c.outreach.length ? html`<table style="margin-top:10px"><thead><tr><th>To</th><th>Purpose</th><th>Channel</th><th>Status</th><th>Outcomes</th></tr></thead>
          <tbody>${c.outreach.map(x => html`<tr class="click" data-outreach="${x.id}"><td><a href="#/person/${x.contact_id}">${x.name}</a></td><td class="small">${PURPOSES[x.purpose] || x.purpose}</td>
            <td class="small">${CHANNELS[x.channel] || x.channel}</td><td>${status(x.status)}${x.sent_at ? html`<div class="faint small">${fmtDateTime(x.sent_at)}</div>` : ''}</td>
            <td>${x.outcomes.length ? x.outcomes.map(k => html`<span class="chip green">${k.replace(/_/g, ' ')}</span>`) : html`<span class="faint small">${x.sent_at ? 'none yet' : '—'}</span>`}</td></tr>`)}</tbody></table>`
        : html`<p class="muted small" style="margin-top:10px">No outreach linked. Draft messages from a contact's page, then add them here.</p>`}
      </section>
    </div>
    <div class="stack reveal">
      <section class="card accent">
        <h3>Outcomes</h3>
        <div class="grid g3">${stat(o.replies, 'Replies')}${stat(o.meetings, 'Meetings')}${stat(o.portfolio_visits, 'Portfolio visits')}</div>
        <p class="faint small" style="margin-bottom:0">Replies and meetings come from your interaction log after a message was sent. Portfolio visits come from metrics you enter on drafts — shown as unavailable when none were recorded.</p>
      </section>
      <section class="card">
        <h3>Sources attached</h3>
        ${c.sources.length ? c.sources.map(s => html`<div class="row list-row">${evChip(s.kind)}<a href="${s.url}" target="_blank" rel="noopener" class="small">${s.title}</a></div>`)
        : html`<p class="muted small">${c.story_id ? 'The linked story has no sources.' : 'Link a story to attach its sources.'}</p>`}
      </section>
    </div>
  </div>`);

  const again = () => renderDetail(el, id, ctx);
  on(root, 'click', 'tr[data-outreach]', (e, tr) => { if (!e.target.closest('a')) openOutreach(tr.dataset.outreach, again); });
  on(root, 'click', '[data-remove-draft]', (e, b) => act(b, async () => { await api.patch(`/drafts/${b.dataset.removeDraft}`, { campaign_id: null }); again(); }));
  on(root, 'click', '[data-new-draft]', (e, b) => act(b, async () => {
    const r = await api.post(`/projects/${c.project_id}/drafts`, { channel: b.dataset.newDraft, campaign_id: c.id });
    location.hash = `#/draft/${r.draft_id}`;
  }, 'Drafting…'));
  on(root, 'click', '[data-act]', async (e, b) => {
    const a = b.dataset.act;
    if (a === 'delete') {
      if (!(await confirmBox(`Delete “${c.name}”? Its drafts and outreach are kept, just ungrouped.`, 'Delete'))) return;
      await act(b, async () => { await api.del(`/campaigns/${id}`); location.hash = '#/campaigns'; });
    }
    if (a === 'edit') pickModal(html`<h2>Edit campaign</h2>
      <label class="field">Name<input name="name" value="${c.name}"></label>
      <label class="field">Goal<textarea name="goal" rows="3">${c.goal || ''}</textarea></label>
      <label class="field">Story id<input name="story_id" type="number" value="${c.story_id || ''}"></label>`, 'Save', async (m) => {
      const f = Object.fromEntries(new FormData(m.el.querySelector('form')));
      await api.patch(`/campaigns/${id}`, { name: f.name, goal: f.goal, story_id: f.story_id ? Number(f.story_id) : null });
    });
    if (a === 'add-drafts') {
      const free = (await api.get('/drafts')).filter(d => !d.campaign_id);
      pickModal(html`<h2>Add drafts</h2><div class="stack pick-list">${free.length ? free.map(d => html`<label class="check"><input type="checkbox" value="${d.id}" data-pick> ${d.title} <span class="chip">${channelLabel(d.channel, d.format)}</span> ${status(d.status)}</label>`) : html`<p class="muted small">No unassigned drafts. Create one in the <a href="#/studio" data-close>studio</a>.</p>`}</div>`,
        'Add selected', async (m) => { for (const x of m.el.querySelectorAll('[data-pick]:checked')) await api.patch(`/drafts/${x.value}`, { campaign_id: c.id }); });
    }
    if (a === 'add-outreach') {
      const free = (await api.get('/outreach')).filter(x => !x.campaign_id && !['cancelled', 'sent'].includes(x.status));
      pickModal(html`<h2>Add outreach</h2><div class="stack pick-list">${free.length ? free.map(x => html`<label class="check"><input type="checkbox" value="${x.id}" data-pick> ${x.name} · ${PURPOSES[x.purpose] || x.purpose} <span class="chip">${CHANNELS[x.channel] || x.channel}</span> ${status(x.status)}</label>`) : html`<p class="muted small">No unassigned outreach. Draft one from a <a href="#/people" data-close>contact</a>.</p>`}</div>`,
        'Add selected', async (m) => { for (const x of m.el.querySelectorAll('[data-pick]:checked')) await api.patch(`/outreach/${x.value}`, { campaign_id: c.id }); });
    }
  });

  function pickModal(body, okLabel, fn) {
    const m = modal(String(html`<form class="stack">${body}<div class="row" style="justify-content:flex-end"><button type="button" data-close>Cancel</button><button class="primary" type="submit">${okLabel}</button></div></form>`), { wide: true });
    m.el.querySelector('form').addEventListener('submit', async (e) => { e.preventDefault(); await act(e.submitter, async () => { await fn(m); m.close(); toast('Saved', 'ok'); again(); }); });
  }
}
