import { api } from '../api.js';
import { html, on, act, toast, modal, confirmBox, strikeOut, status, fmtDate, channelLabel } from '../ui.js';

const rowOf = (b) => b.closest('tr, [data-exp], .source-row, .watch-row, .card, li') || b.parentElement;

const TABS = [['radar', 'Skill radar'], ['collections', 'Collections'], ['projects', 'Projects'], ['weekly', 'Weekly recap'], ['experiences', 'Experiences']];
const GROUPS = ['AI product management', 'Business analysis', 'Data analytics'];
const KINDS = ['experiment', 'teardown', 'case study', 'demo video', 'comparison', 'dashboard'];
const PSTATUS = ['idea', 'active', 'done'];
const state = { tab: 'radar', project: null, interview: {}, skipped: new Set() };
const fresh = (el) => { const root = document.createElement('div'); el.replaceChildren(root); return root; };
const trendChip = (t) => html`<span class="chip ${({ rising: 'green', steady: 'blue', cooling: 'amber' })[t] || ''}">${t}</span>`;
const pchip = (s) => html`<span class="chip ${({ idea: '', active: 'amber', done: 'green' })[s] || ''}">${s}</span>`;

export function labelChip(l = '') {
  const s = l.toLowerCase();
  const [cls, short] = s.startsWith('work you have done') ? ['green', 'Work you have done'] : s.startsWith('example') ? ['blue', 'Example — not your work']
    : s.startsWith('hypothesis') ? ['amber', 'Hypothesis'] : s.startsWith('future') ? ['violet', 'Future experiment — not yet done'] : ['', l];
  return html`<span class="chip ${cls}" title="${l}">${short}</span>`;
}

export async function render(el, ctx = {}) {
  if (ctx.params?.[0] && TABS.some(([k]) => k === ctx.params[0])) state.tab = ctx.params[0];
  const root = fresh(el);
  root.innerHTML = String(html`
    <div class="page-head">
      <div>
        <div class="kicker">Career intelligence</div>
        <h1>Career</h1>
        <p class="lede">Which skills keep showing up, what you can talk about in interviews, and which stories are worth turning into a portfolio project.</p>
      </div>
    </div>
    <div class="tabs">${TABS.map(([k, l]) => html`<button data-tab="${k}" class="${state.tab === k ? 'on' : ''}">${l}</button>`)}</div>
    <div id="pane"><div class="muted"><span class="spinner"></span> Loading…</div></div>`);
  on(root, 'click', '[data-tab]', (e, b) => { state.tab = b.dataset.tab; render(el, { ...ctx, params: [] }); });
  const pane = root.querySelector('#pane');
  const again = () => render(el, { ...ctx, params: [] });
  await ({ radar, collections, projects, weekly, experiences })[state.tab](pane, again);
}

// ---------------------------------------------------------------- skill radar
async function radar(pane, again) {
  const [skills, jobs] = await Promise.all([api.get('/career/radar'), api.get('/jobposts')]);
  pane.innerHTML = String(html`
  <div class="split reveal">
    <section class="card">
      <div class="row between"><h3>Skill radar · last 30 days</h3><span class="mono faint">${skills.length} skills with evidence</span></div>
      ${skills.length ? html`<table>
        <thead><tr><th>Skill</th><th>Source mentions</th><th>Job mentions</th><th>Trend</th><th></th></tr></thead>
        <tbody>${skills.map((s, i) => html`<tr class="click" data-skill="${i}"><td><strong>${s.skill}</strong></td>
          <td>${s.source_mentions} <span class="faint small">(${s.recent} this week)</span></td><td>${s.job_mentions}</td><td>${trendChip(s.trend)}</td><td class="faint small">evidence →</td></tr>`)}</tbody></table>`
      : html`<div class="empty">No skill evidence yet. Run the daily workflow or paste a job description.</div>`}
    </section>
    <div class="stack">
      <section class="card accent">
        <h3>Add a job description</h3>
        <form class="stack" id="jp">
          <div class="form-grid"><label class="field">Title<input name="title" placeholder="Associate Product Manager, AI"></label><label class="field">Employer<input name="employer"></label></div>
          <label class="field">Posting URL<input name="url" placeholder="https://…"></label>
          <label class="field">Description *<textarea name="text" rows="6" required placeholder="Paste the full job description"></textarea></label>
          <div class="row" style="justify-content:flex-end"><button class="primary" type="submit">Add to radar</button></div>
        </form>
      </section>
      <section class="card">
        <h3>Job posts</h3>
        ${jobs.length ? jobs.map(j => html`<div class="list-row"><div class="row between"><span><strong>${j.title}</strong> <span class="faint small">${j.employer}</span></span>
          <span class="row">${j.url ? html`<a class="small" href="${j.url}" target="_blank" rel="noopener">posting ↗</a>` : ''}<button class="sm ghost" data-del-job="${j.id}">Delete</button></span></div>
          <div class="faint small">${j.excerpt}…</div></div>`) : html`<p class="muted small">None yet. Job mentions count double in the ranking.</p>`}
      </section>
    </div>
  </div>`);
  pane.querySelector('#jp').addEventListener('submit', async (e) => {
    e.preventDefault();
    await act(e.submitter, async () => { await api.post('/jobposts', Object.fromEntries(new FormData(e.target))); toast('Job post added', 'ok'); again(); });
  });
  on(pane, 'click', '[data-del-job]', (e, b) => { const id = b.dataset.delJob; strikeOut(rowOf(b), { message: 'Job post deleted.', commit: () => api.del(`/jobposts/${id}`) }); });
  on(pane, 'click', '[data-skill]', (e, tr) => {
    const s = skills[tr.dataset.skill];
    modal(String(html`<div class="row between"><h2 style="margin:0">${s.skill}</h2>${trendChip(s.trend)}</div>
      <p class="muted small">${s.source_mentions} source mention(s) in 30 days (${s.recent} this week, baseline ${s.older_rate}/week) · ${s.job_mentions} job description(s)</p>
      ${s.evidence.map(ev => html`<div class="evidence ${ev.kind === 'job' ? 'commentary' : 'reporting'}">
        <div class="row"><span class="chip ${ev.kind === 'job' ? 'amber' : 'blue'}">${ev.kind === 'job' ? 'job description' : 'source'}</span>
          ${ev.kind === 'job' ? html`<span class="small">${ev.title}</span>` : html`<span class="mono faint">${ev.domain}</span>`}</div>
        <div class="small" style="margin-top:4px">“${ev.snippet}”</div>
        <div class="row small" style="margin-top:4px">${ev.story_id ? html`<a href="#/story/${ev.story_id}" data-close>open story →</a>` : ''}${ev.url ? html`<a href="${ev.url}" target="_blank" rel="noopener">original ↗</a>` : ''}</div>
      </div>`)}
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button data-close>Close</button></div>`));
  });
}

// ---------------------------------------------------------------- collections + interview points
async function collections(pane, again) {
  const g = await api.get('/collections');
  const names = [...new Set([...GROUPS, ...Object.keys(g)])];
  pane.innerHTML = String(html`
  <p class="muted small">Saved stories grouped by target role. Talking points are labelled so you never present someone else's work — or an idea you haven't tried — as your own.</p>
  <div class="row" style="margin:6px 0 16px">${labelChip('work you have done')}${labelChip('example')}${labelChip('hypothesis')}${labelChip('future experiment')}</div>
  <div class="grid g3 reveal">${names.map(n => html`<section class="card">
    <div class="row between"><h3 style="margin:0">${n}</h3><span class="mono faint">${(g[n] || []).length}</span></div>
    ${(g[n] || []).length ? html`<div class="stack" style="margin-top:10px">${g[n].map(s => html`<div><a href="#/story/${s.story_id}" style="color:var(--text)">${s.title}</a>
      ${s.note ? html`<div class="faint small">${s.note}</div>` : ''}<div class="row" style="margin-top:4px">${(s.topics || []).slice(0, 3).map(t => html`<span class="chip violet">${t}</span>`)}</div></div>`)}</div>
      <div class="row" style="margin-top:14px"><button class="sm" data-iv="${n}">Interview talking points</button></div>`
    : html`<p class="muted small" style="margin-top:10px">Nothing saved yet. Save stories to “${n}” from the feed.</p>`}
  </section>`)}</div>
  ${Object.entries(state.interview).map(([n, res]) => html`<section class="card accent" style="margin-top:18px">
    <div class="row between"><h3 style="margin:0">Talking points · ${n}</h3><button class="sm ghost" data-iv-close="${n}">Hide</button></div>
    ${res.length ? res.map(r => html`<div style="margin-top:14px"><a href="#/story/${r.story_id}" class="story-title" style="color:var(--text)">${r.title}</a>
      ${r.items.map(it => html`<div class="evidence"><div class="row">${labelChip(it.label)}</div><div class="claim" style="margin-top:6px">${it.question}</div><div class="small muted">${it.notes}</div></div>`)}</div>`)
    : html`<p class="muted small">No stories to build points from.</p>`}
  </section>`)}`);
  on(pane, 'click', '[data-iv]', async (e, b) => act(b, async () => { state.interview = { [b.dataset.iv]: await api.post('/career/interview', { collection: b.dataset.iv }) }; again(); }, 'Preparing…'));
  on(pane, 'click', '[data-iv-close]', (e, b) => { delete state.interview[b.dataset.ivClose]; again(); });
}

// ---------------------------------------------------------------- projects
async function projects(pane, again) {
  const [list, employers] = await Promise.all([api.get('/projects'), api.get('/employers').catch(() => [])]);
  if (state.project && !list.some(p => p.id === state.project)) state.project = null;
  if (!state.project && list.length) state.project = list[0].id;
  const p = state.project ? await api.get(`/projects/${state.project}`) : null;
  const field = (k, l, rows = 2) => html`<label class="field full">${l}<textarea name="${k}" rows="${rows}">${p[k] || ''}</textarea></label>`;
  pane.innerHTML = String(html`
  <div class="split reveal" style="grid-template-columns:minmax(260px,.8fr) minmax(0,1.6fr)">
    <section class="card">
      <div class="row between"><h3 style="margin:0">Projects</h3><button class="sm primary" data-act="new">New project</button></div>
      <div class="stack" style="margin-top:12px">${list.length ? list.map(x => html`<div class="proj-item ${x.id === state.project ? 'on' : ''}" data-pick="${x.id}">
        <div>${x.title}</div><div class="row" style="margin-top:4px">${pchip(x.status)}<span class="chip">${x.kind}</span>${x.employer ? html`<span class="chip violet">${x.employer}</span>` : ''}</div></div>`)
      : html`<div class="empty">No projects yet. Generate one from a story, or start blank.</div>`}</div>
    </section>
    ${p ? html`<section class="card accent">
      <form id="pf" class="form-grid">
        <label class="field full">Title<input name="title" value="${p.title || ''}"></label>
        <label class="field">Kind<select name="kind">${KINDS.map(k => html`<option ${k === p.kind ? 'selected' : ''}>${k}</option>`)}</select></label>
        <label class="field">Status<select name="status">${PSTATUS.map(k => html`<option ${k === p.status ? 'selected' : ''}>${k}</option>`)}</select></label>
        <label class="field full">Employer connection<select name="employer"><option value="">— none —</option>${employers.map(e => html`<option ${e.name === p.employer ? 'selected' : ''}>${e.name}</option>`)}</select></label>
        ${field('question', 'Question')}${field('inputs', 'Inputs / data')}${field('deliverable', 'Deliverable')}${field('success', 'Success measure')}${field('extension', 'Extension (Lot Intelligence / Research Bench)')}
        <div class="full hr" style="margin:4px 0"></div>
        ${field('tested', 'What I tested', 3)}${field('findings', 'What I found', 3)}${field('next_steps', 'Next', 2)}
        <div class="full row between">
          <span class="faint small">${p.story_id ? html`From <a href="#/story/${p.story_id}">story #${p.story_id}</a> · ` : ''}updated ${fmtDate(p.updated_at)}</span>
          <span class="row"><button type="button" class="danger sm" data-act="delete">Delete</button><button class="primary" type="submit">Save project</button></span>
        </div>
      </form>
      <div class="hr"></div>
      <h3>Create drafts from this project</h3>
      <p class="faint small" style="margin-top:-4px">Drafts use only what you wrote above as first-person content. Fill in “What I tested / found” before claiming results.</p>
      <div class="row">${['linkedin', 'instagram', 'video'].map(ch => html`<button data-draft="${ch}">${channelLabel(ch)} draft</button>`)}</div>
      ${p.drafts?.length ? html`<div class="stack" style="margin-top:12px">${p.drafts.map(d => html`<div class="row between"><a href="#/draft/${d.id}">${d.title}</a><span class="row">${status(d.status)}<span class="chip">${channelLabel(d.channel, d.format)}</span></span></div>`)}</div>` : ''}
    </section>` : html`<section class="card"><div class="empty">Select or create a project.</div></section>`}
  </div>`);
  on(pane, 'click', '[data-pick]', (e, d) => { state.project = Number(d.dataset.pick); again(); });
  on(pane, 'click', '[data-act="new"]', (e, b) => act(b, async () => { state.project = (await api.post('/projects', { title: 'Untitled project' })).id; again(); }));
  if (!p) return;
  const form = pane.querySelector('#pf');
  const saveP = () => api.patch(`/projects/${p.id}`, { ...Object.fromEntries(new FormData(form)), employer: form.employer.value || null });
  form.addEventListener('submit', async (e) => { e.preventDefault(); await act(e.submitter, async () => { await saveP(); toast('Project saved', 'ok'); again(); }); });
  on(pane, 'click', '[data-act="delete"]', async (e, b) => { if (await confirmBox(`Delete “${p.title}”?`, 'Delete')) await act(b, async () => { await api.del(`/projects/${p.id}`); state.project = null; again(); }); });
  on(pane, 'click', '[data-draft]', (e, b) => act(b, async () => {
    await saveP();
    const r = await api.post(`/projects/${p.id}/drafts`, { channel: b.dataset.draft });
    location.hash = `#/draft/${r.draft_id}`;
  }, 'Drafting…'));
}

// ---------------------------------------------------------------- weekly recap
async function weekly(pane, again) {
  const w = await api.get('/career/weekly');
  const key = (s) => `${s.kind}:${s.ref}`;
  const short = w.shortlist.filter(s => !state.skipped.has(key(s)));
  pane.innerHTML = String(html`
  <div class="split reveal">
    <div class="stack">
      <section class="card">
        <h3>Trends that persisted <span class="faint">· ${w.story_count} stories this week</span></h3>
        ${w.persisted.length ? html`<table><thead><tr><th>Topic</th><th>Days seen</th><th>Stories</th></tr></thead>
          <tbody>${w.persisted.map(p => html`<tr><td><span class="chip violet">${p.topic}</span></td><td>${p.days}</td><td>${p.stories}</td></tr>`)}</tbody></table>`
        : html`<p class="muted small">No topic appeared on two or more days this week.</p>`}
      </section>
      <section class="card">
        <h3>Claims that changed</h3>
        ${w.changed.length ? w.changed.map(c => html`<div class="list-row">
          <a href="#/story/${c.story_id}" class="story-title" style="color:var(--text)">${c.title}</a>
          <div class="small faint">First: <a href="${c.original.url}" target="_blank" rel="noopener">${c.original.domain}</a> · ${fmtDate(c.original.fetched_at)}</div>
          ${c.follow_ups.map(f => html`<div class="evidence ${f.evidence_kind || ''} small"><a href="${f.url}" target="_blank" rel="noopener">${f.title}</a> <span class="faint">${f.domain} · ${fmtDate(f.fetched_at)}</span></div>`)}
          ${c.new_claims.length ? html`<ul class="small muted">${c.new_claims.map(t => html`<li>${t}</li>`)}</ul>` : ''}
        </div>`) : html`<p class="muted small">No follow-up reporting changed a story this week.</p>`}
      </section>
      <section class="card">
        <h3>Project ideas</h3>
        ${w.ideas.length ? w.ideas.map(i => html`<div class="list-row"><a href="#" data-open-project="${i.id}">${i.title}</a><div class="small muted">${i.question}</div></div>`) : html`<p class="muted small">No ideas waiting. Generate one from a story.</p>`}
      </section>
    </div>
    <section class="card accent">
      <h3>This week's shortlist</h3>
      ${short.length ? short.map(s => html`<div class="list-row"><div class="row" style="margin-bottom:6px"><span class="chip ${({ trend: 'violet', update: 'blue', project: 'amber' })[s.kind]}">${s.kind}</span></div>
        <div>${s.label}</div>
        <div class="row" style="margin-top:8px"><button class="sm primary" data-pursue="${short.indexOf(s)}">Pursue</button><button class="sm ghost" data-skip="${key(s)}">Skip</button></div></div>`)
      : html`<p class="muted small">${w.shortlist.length ? 'All skipped for now.' : 'Nothing shortlisted this week.'}</p>`}
      ${state.skipped.size ? html`<button class="sm ghost" data-act="unskip" style="margin-top:10px">Show ${state.skipped.size} skipped</button>` : ''}
    </section>
  </div>`);
  on(pane, 'click', '[data-skip]', (e, b) => { state.skipped.add(b.dataset.skip); again(); });
  on(pane, 'click', '[data-act="unskip"]', () => { state.skipped.clear(); again(); });
  on(pane, 'click', '[data-open-project]', (e, a) => { e.preventDefault(); state.project = Number(a.dataset.openProject); state.tab = 'projects'; again(); });
  on(pane, 'click', '[data-pursue]', async (e, b) => {
    const s = short[b.dataset.pursue];
    if (s.kind === 'trend') location.hash = '#/feed';
    if (s.kind === 'update') location.hash = `#/story/${s.ref}`;
    if (s.kind === 'project') await act(b, async () => { await api.patch(`/projects/${s.ref}`, { status: 'active' }); toast('Project marked active', 'ok'); state.project = s.ref; state.tab = 'projects'; again(); });
  });
}

// ---------------------------------------------------------------- experiences
async function experiences(pane, again) {
  const list = await api.get('/experiences');
  pane.innerHTML = String(html`
  <div class="split reveal">
    <section class="card">
      <h3>Your experiences</h3>
      ${list.length ? list.map(x => html`<div class="list-row" data-exp="${x.id}">
        <textarea rows="2" data-text>${x.text}</textarea>
        <div class="row between" style="margin-top:6px">
          <label class="check"><input type="checkbox" data-public ${x.public_ok ? 'checked' : ''}> Public OK — may appear as a first-person claim</label>
          <span class="row"><button class="sm" data-save>Save</button><button class="sm ghost" data-del>Delete</button></span>
        </div></div>`) : html`<div class="empty">No experiences yet. Without them, drafts stay in observer voice.</div>`}
    </section>
    <section class="card accent">
      <h3>Add an experience</h3>
      <p class="muted small">Byline never invents experiences. Only entries marked <strong>public OK</strong> may appear as first-person claims (“I built…”, “I led…”) in drafts and outreach. Everything else is used privately for context, or not at all.</p>
      <form id="xf" class="stack">
        <textarea name="text" rows="4" required placeholder="e.g. Built a Tableau dashboard tracking dealership lead response times for a class project (Fall 2026)."></textarea>
        <label class="check"><input type="checkbox" name="public_ok"> Public OK</label>
        <div class="row" style="justify-content:flex-end"><button class="primary" type="submit">Add</button></div>
      </form>
    </section>
  </div>`);
  pane.querySelector('#xf').addEventListener('submit', async (e) => {
    e.preventDefault();
    await act(e.submitter, async () => { await api.post('/experiences', { text: e.target.text.value, public_ok: e.target.public_ok.checked }); toast('Experience added', 'ok'); again(); });
  });
  on(pane, 'change', '[data-public]', async (e, cb) => {
    try { await api.patch(`/experiences/${cb.closest('[data-exp]').dataset.exp}`, { public_ok: cb.checked }); toast(cb.checked ? 'Marked public OK' : 'Now private', 'ok'); }
    catch (err) { cb.checked = !cb.checked; toast(err.message, 'err'); }
  });
  on(pane, 'click', '[data-save]', (e, b) => act(b, async () => { const row = b.closest('[data-exp]'); await api.patch(`/experiences/${row.dataset.exp}`, { text: row.querySelector('[data-text]').value }); toast('Saved', 'ok'); }));
  on(pane, 'click', '[data-del]', (e, b) => { const row = b.closest('[data-exp]'); const id = row.dataset.exp; strikeOut(row, { message: 'Experience deleted.', commit: () => api.del(`/experiences/${id}`) }); });
}
