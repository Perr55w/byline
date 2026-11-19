// Campaigns (v4). F §2 Campaigns: "{n} campaigns, {replies} replies so far." with the per-campaign line
// "{d} drafts ({p} published), {o} messages, {r} replies, {m} meetings."; with none, "No campaigns yet." and
// the useful one-liner naming how many stories above the bar could anchor one (from /api/today).
// The list is never a placeholder: with zero campaigns it shows the real candidates (stories above the bar,
// with their finding line, sources and the drafts already written for them) and the pieces waiting for a
// campaign. Story references are dossier flight sources ([data-dossier-src] rows).
// Kept from v3: create (name, goal, story, project, include drafts), edit, delete (pieces are kept, just
// ungrouped), add / remove drafts, add outreach, new project drafts per channel, the outreach editor, the
// outcomes panel (replies, meetings, portfolio visits; "unavailable" when nothing was recorded) and sources.
import { api } from '../api.js';
import { html, on, act, toast, modal, confirmBox, status, channelLabel, scoreChip, icon, useStyle, evLabel } from '../ui.js';
import { openOutreach, PURPOSES, CHANNELS, plural, demoTag, stripDemo, whenLabel, listJoin } from './people.js';

const CH = { linkedin: 'LinkedIn', instagram: 'Instagram', video: 'Video' };
const CHANNEL_ORDER = ['linkedin', 'instagram', 'video'];
const fmtScore = (s) => Math.round(Number(s) || 0);

function campaignFacts(c, d) {
  const drafts = d?.drafts || c.drafts || [];
  const outreach = d?.outreach || c.outreach || [];
  return {
    d: drafts.length, p: drafts.filter(x => x.status === 'published' || x.published_at).length,
    o: outreach.length, r: d ? d.outcomes.replies : null, m: d ? d.outcomes.meetings : null
  };
}
const factLine = (f) => `${plural(f.d, 'draft')} (${f.p} published), ${plural(f.o, 'message')}, ${f.r == null ? '?' : plural(f.r, 'reply', 'replies')}, ${f.m == null ? '?' : plural(f.m, 'meeting')}.`;

export async function render(el, ctx = {}) {
  await Promise.all([useStyle('/css/v4/campaigns.css'), useStyle('/css/v4/people.css')]);
  if (ctx.params?.[0]) return renderDetail(el, ctx.params[0], ctx);
  return renderList(el, ctx);
}

// ------------------------------------------------------------------ list
async function renderList(el, ctx) {
  const [campaigns, today, stories, drafts, outreach] = await Promise.all([
    api.get('/campaigns'), api.get('/today').catch(() => null), api.get('/stories?days=7').catch(() => []), api.get('/drafts').catch(() => []), api.get('/outreach').catch(() => [])
  ]);
  const details = await Promise.all(campaigns.slice(0, 24).map(c => api.get(`/campaigns/${c.id}`).catch(() => null)));
  const T = today?.threshold ?? window.__byline?.threshold ?? 55;
  const cleared = stories.filter(s => s.score >= T);
  const facts = campaigns.map((c, i) => campaignFacts(c, details[i]));
  const replies = facts.reduce((n, f) => n + (f.r || 0), 0);
  const anchored = new Set(campaigns.map(c => c.story_id).filter(Boolean));
  const candidates = cleared.filter(s => !anchored.has(s.id));
  const free = drafts.filter(d => !d.campaign_id);
  const freeOut = outreach.filter(o => !o.campaign_id && !['cancelled'].includes(o.status));
  const byStory = new Map(); for (const d of drafts) if (d.story_id) byStory.set(d.story_id, [...(byStory.get(d.story_id) || []), d]);
  const nCleared = today?.cleared ?? cleared.length;
  const top = today?.top;

  const h = campaigns.length ? `${plural(campaigns.length, 'campaign')}, ${plural(replies, 'reply', 'replies')} so far.` : 'No campaigns yet.';
  const tot = facts.reduce((a, f) => ({ d: a.d + f.d, p: a.p + f.p, o: a.o + f.o, m: a.m + (f.m || 0) }), { d: 0, p: 0, o: 0, m: 0 });
  const l = campaigns.length
    ? html`Across them: <b>${tot.d}</b> drafts (<b>${tot.p}</b> published), <b>${tot.o}</b> messages, <b>${replies}</b> ${replies === 1 ? 'reply' : 'replies'}, <b>${tot.m}</b> ${tot.m === 1 ? 'meeting' : 'meetings'}. ${candidates.length ? html`${plural(candidates.length, 'more story', 'more stories')} above your bar of <b>${T}</b> could anchor another.` : ''}`
    : nCleared ? html`A campaign ties drafts and outreach to one story. <b>${nCleared}</b> ${nCleared === 1 ? 'story' : 'stories'} above your bar could anchor one; ${top ? html`<b>${top.short_title}</b> scores highest.` : ''}`
      : html`A campaign ties drafts and outreach to one story. No story is above your bar of <b>${T}</b> yet; you can still start one from a project.`;
  const freeBy = CHANNEL_ORDER.map(ch => [ch, free.filter(d => d.channel === ch)]).filter(([, a]) => a.length);
  const statusCounts = (list) => Object.entries(list.reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {}));

  const root = document.createElement('div');
  root.className = 'cp';
  root.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow">Publish · campaigns</p>
    <h1>${h}</h1>
    <p class="lede">${l}</p>
    <div class="page-head-actions"><button class="btn btn--primary" data-act="new">${icon('plus')}New campaign</button></div>
  </header>

  ${campaigns.length ? html`<section class="cp-grid" aria-label="Campaigns">${campaigns.map((c, i) => {
    const d = details[i], f = facts[i];
    const pieces = [...(d?.drafts || c.drafts), ...(d?.outreach || c.outreach)];
    return html`<a class="tile cp-card" href="#/campaigns/${c.id}">
      <span class="cp-card-name t-title">${c.name}</span>
      ${c.goal ? html`<span class="cp-card-goal">${c.goal}</span>` : html`<span class="cp-card-goal ink-3">No goal set.</span>`}
      <span class="cp-card-facts">${factLine(f)}</span>
      <span class="cluster cp-card-tags">${statusCounts(pieces).map(([s, n]) => html`<span class="cp-stat">${status(s)}<span class="cp-x">×${n}</span></span>`)}</span>
      <span class="cp-card-foot">${d?.story_id ? html`<span>Story: ${stories.find(s => s.id === d.story_id)?.short_title || 'linked story'}</span>` : html`<span>No story linked</span>`}${d?.project ? html`<span>Project: ${d.project.title}</span>` : ''}</span>
    </a>`;
  })}</section>` : ''}

  <div class="cp-cols">
    <section class="tile tile--static tile--flush cp-cand" aria-labelledby="cp-cand-h">
      <div class="section-head cp-pad"><h2 class="t-h2" id="cp-cand-h">${campaigns.length ? 'More stories that could anchor one' : 'Stories that could anchor a campaign'}</h2><span class="section-meta">${candidates.length} at or above ${T} · last 7 days</span></div>
      ${candidates.length ? html`<ol class="cp-cand-list">${candidates.slice(0, 8).map(s => {
        const ds = byStory.get(s.id) || [];
        return html`<li class="cp-cand-row" data-row data-dossier-src>
          ${scoreChip(s.score, T)}
          <div class="cp-cand-main">
            <a class="cp-cand-title t-title" href="#/story/${s.id}">${s.title}</a>${demoTag(s.is_demo)}
            <p class="cp-cand-finding">${s.finding}</p>
            <p class="cp-cand-meta"><span class="chip chip--main">${s.main_topic || s.topics?.[0] || 'Unsorted'}</span><span class="cp-mono">${s.source_line}</span><span>${ds.length ? `${plural(ds.length, 'draft')} already written (${listJoin(CHANNEL_ORDER.filter(ch => ds.some(d => d.channel === ch)).map(ch => CH[ch]))})` : 'No drafts yet'}</span></p>
          </div>
          <button class="btn btn--sm" data-act="new" data-story="${s.id}">Start campaign</button>
        </li>`;
      })}</ol>${candidates.length > 8 ? html`<p class="cp-more cp-pad">${candidates.length - 8} more above your bar in the <a href="#/feed">Feed</a>.</p>` : ''}`
      : html`<p class="cp-empty-line cp-pad">${cleared.length ? 'Every story above your bar already anchors a campaign.' : `No story in the last 7 days is at or above your bar of ${T}.`}</p>`}
    </section>

    <aside class="stack cp-aside">
      <section class="tile tile--static cp-card-s" aria-labelledby="cp-free-h">
        <h2 class="section-label" id="cp-free-h">Pieces waiting for a campaign</h2>
        <p class="cp-big"><span class="cp-big-n">${free.length}</span><span class="cp-big-of">${free.length === 1 ? 'draft' : 'drafts'} not in a campaign</span></p>
        ${freeBy.length ? html`<ul class="cp-bars">${freeBy.map(([ch, a]) => html`<li><span>${CH[ch]}</span><span class="meter"><i style="--v:${a.length / Math.max(1, free.length)}"></i></span><b>${a.length}</b></li>`)}</ul>` : ''}
        <p class="cp-note">${statusCounts(free).map(([s, n]) => `${n} ${s.replace(/_/g, ' ')}`).join(' · ') || 'No unassigned drafts.'}</p>
        <div class="cp-rule"></div>
        <p class="cp-note"><b>${freeOut.length}</b> outreach ${freeOut.length === 1 ? 'message' : 'messages'} not linked to a campaign${freeOut.filter(o => o.status === 'sent').length ? ` (${freeOut.filter(o => o.status === 'sent').length} already sent)` : ''}.</p>
      </section>
      <section class="tile tile--static cp-card-s" aria-labelledby="cp-how-h">
        <h2 class="section-label" id="cp-how-h">How approvals work</h2>
        <p class="cp-note">A campaign groups a story’s LinkedIn post, Instagram carousel, video and outreach. Each piece keeps its own approval: approving one never approves the others, and deleting a campaign keeps every piece.</p>
      </section>
    </aside>
  </div>`);
  el.replaceChildren(root);
  on(root, 'click', '[data-act="new"]', (e, b) => openCreate({ storyId: b.dataset.story ? Number(b.dataset.story) : null }));
}

// ------------------------------------------------------------------ create
async function openCreate({ storyId = null } = {}) {
  const [drafts, projects, stories] = await Promise.all([api.get('/drafts'), api.get('/projects'), api.get('/stories?limit=200').catch(() => [])]);
  const T = window.__byline?.threshold ?? 55;
  const free = drafts.filter(d => !d.campaign_id).sort((a, b) => (b.story_id === storyId) - (a.story_id === storyId));
  const story = stories.find(s => s.id === storyId);
  const m = modal(String(html`<h2>New campaign</h2>
    <p class="cp-modal-dek">Group the pieces around one story or project. Each piece keeps its own approval.</p>
    <form class="pp-form" id="cf">
      <label class="field pp-full">Name *<input class="input" name="name" required value="${story ? `${story.short_title} campaign` : ''}" placeholder="e.g. Agent eval teardown launch"></label>
      <label class="field pp-full">Goal<textarea class="textarea" name="goal" rows="2" placeholder="What should this campaign achieve? e.g. 2 informational interviews with eval PMs"></textarea></label>
      <label class="field">Story<select class="select" name="story_id"><option value="">None</option>${stories.map(s => html`<option value="${s.id}" ${s.id === storyId ? 'selected' : ''}>${fmtScore(s.score)}${s.score >= T ? ' ✓' : ''} · ${s.short_title || s.title}</option>`)}</select></label>
      <label class="field">Project<select class="select" name="project_id"><option value="">None</option>${projects.map(p => html`<option value="${p.id}">${p.title}</option>`)}</select></label>
      <fieldset class="pp-fieldset pp-full"><legend>Include existing drafts <span class="ink-3" data-pick-count></span></legend>
        <div class="cp-pick">${free.length ? free.map(d => html`<label class="pp-check cp-pick-row" data-story-of="${d.story_id || ''}"><input type="checkbox" value="${d.id}" data-draft ${storyId && d.story_id === storyId ? 'checked' : ''}><span class="cp-pick-t">${d.title}</span><span class="chip">${channelLabel(d.channel, d.format)}</span>${status(d.status)}</label>`) : html`<span class="pp-note">No unassigned drafts.</span>`}</div>
      </fieldset>
      <div class="modal-actions pp-full"><button type="button" class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" type="submit">Create campaign</button></div>
    </form>`), { wide: true });
  const count = () => { const n = m.el.querySelectorAll('[data-draft]:checked').length; const c = m.el.querySelector('[data-pick-count]'); if (c) c.textContent = n ? `· ${n} selected` : ''; };
  count();
  m.el.addEventListener('change', (e) => {
    if (e.target.name === 'story_id') {
      const sid = e.target.value;
      m.el.querySelectorAll('.cp-pick-row').forEach(r => { const cb = r.querySelector('input'); if (sid && r.dataset.storyOf === sid) cb.checked = true; });
    }
    count();
  });
  m.el.querySelector('#cf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const draft_ids = [...m.el.querySelectorAll('[data-draft]:checked')].map(x => Number(x.value));
    await act(e.submitter, async () => {
      const c = await api.post('/campaigns', { name: f.name, goal: f.goal, story_id: f.story_id ? Number(f.story_id) : null, project_id: f.project_id ? Number(f.project_id) : null, draft_ids });
      m.close(); toast('Campaign created', 'ok'); location.hash = `#/campaigns/${c.id}`;
    }, 'Creating…');
  });
}

// ------------------------------------------------------------------ detail
async function renderDetail(el, id, ctx) {
  const c = await api.get(`/campaigns/${id}`);
  const [storyData, today] = await Promise.all([c.story_id ? api.get(`/stories/${c.story_id}?mark_viewed=0`).catch(() => null) : null, api.get('/today').catch(() => null)]);
  const T = today?.threshold ?? window.__byline?.threshold ?? 55;
  const tz = window.__byline?.timezone;
  const st = storyData?.story;
  const o = c.outcomes;
  const f = campaignFacts(c, c);
  const approved = c.drafts.filter(d => d.approved_hash && !d.published_at).length;

  const root = document.createElement('div');
  root.className = 'cp cp-detail';
  root.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow"><a class="pp-back" href="#/campaigns">${icon('chevron-left')}Campaigns</a></p>
    <h1>${c.name}</h1>
    <p class="lede"><b>${f.d}</b> ${f.d === 1 ? 'draft' : 'drafts'} (<b>${f.p}</b> published), <b>${f.o}</b> ${f.o === 1 ? 'message' : 'messages'}, <b>${o.replies}</b> ${o.replies === 1 ? 'reply' : 'replies'}, <b>${o.meetings}</b> ${o.meetings === 1 ? 'meeting' : 'meetings'}.${c.goal ? html` Goal: ${c.goal}` : ' No goal set.'}</p>
    <div class="page-head-actions"><button class="btn" data-act="edit">Edit</button><button class="btn btn--danger" data-act="delete">Delete</button></div>
  </header>

  <div class="cp-cols">
    <div class="stack">
      ${st ? html`<section class="tile cp-anchor" data-dossier-src aria-label="Anchor story">
        <div class="cp-anchor-score">${scoreChip(st.score, T)}</div>
        <div class="cp-anchor-main">
          <p class="section-label">Anchor story</p>
          <a class="t-title cp-anchor-title" href="#/story/${st.id}">${st.title}</a>${demoTag(st.is_demo)}
          <p class="cp-cand-finding">${st.finding}</p>
          <p class="cp-cand-meta"><span class="chip chip--main">${st.main_topic || st.topics?.[0] || 'Unsorted'}</span><span class="cp-mono">${st.source_line}</span></p>
        </div>
      </section>` : ''}

      <section class="tile tile--static tile--flush" aria-labelledby="cp-pieces-h">
        <div class="section-head cp-pad"><h2 class="t-h2" id="cp-pieces-h">Content pieces</h2>
          <span class="cluster"><button class="btn btn--sm" data-act="add-drafts">${icon('plus')}Add existing drafts</button>
          ${c.project ? CHANNEL_ORDER.map(ch => html`<button class="btn btn--sm btn--ghost" data-new-draft="${ch}">${icon('plus')}${channelLabel(ch)}</button>`) : ''}</span></div>
        ${c.drafts.length ? html`<table class="table pp-table">
          <thead><tr><th>Draft</th><th class="pp-hide-sm">Channel</th><th>Status</th><th class="pp-hide-sm">Approval</th><th><span class="sr-only">Remove</span></th></tr></thead>
          <tbody>${c.drafts.map(d => html`<tr><td><a class="pp-name" href="#/draft/${d.id}">${d.title}</a></td><td class="pp-hide-sm">${channelLabel(d.channel, d.format)}</td><td>${status(d.status)}</td>
            <td class="pp-hide-sm">${d.published_at ? html`<span class="cp-ok">published</span>` : d.approved_hash ? html`<span class="cp-ok">${icon('check')}approved (this piece)</span>` : html`<span class="ink-3">needs approval</span>`}</td>
            <td class="cp-td-end"><button class="btn btn--ghost btn--sm btn--icon" data-remove-draft="${d.id}" aria-label="Remove “${d.title}” from this campaign" title="Remove from campaign">${icon('x')}</button></td></tr>`)}</tbody></table>`
        : html`<p class="cp-empty-line cp-pad">No drafts in this campaign yet.${c.project ? ' Use the LinkedIn, Instagram or Video buttons to draft from the linked project, or add existing drafts.' : ' Add existing drafts.'}</p>`}
        <p class="cp-foot-note cp-pad">${approved ? `${plural(approved, 'piece')} approved and not yet published. ` : ''}Approving one piece never approves the others.</p>
      </section>

      <section class="tile tile--static tile--flush" aria-labelledby="cp-out-h">
        <div class="section-head cp-pad"><h2 class="t-h2" id="cp-out-h">Outreach</h2><button class="btn btn--sm" data-act="add-outreach">${icon('plus')}Add outreach drafts</button></div>
        ${c.outreach.length ? html`<table class="table pp-table">
          <thead><tr><th>To</th><th>Purpose</th><th class="pp-hide-sm">Channel</th><th>Status</th><th class="pp-hide-sm">Outcomes</th></tr></thead>
          <tbody>${c.outreach.map(x => html`<tr data-outreach="${x.id}"><td><button class="pp-linkbtn" data-outreach-open="${x.id}">${stripDemo(x.name)}</button></td><td>${PURPOSES[x.purpose] || x.purpose}</td>
            <td class="pp-hide-sm">${CHANNELS[x.channel] || x.channel}</td><td>${status(x.status)}${x.sent_at ? html`<span class="pp-date">${whenLabel(x.sent_at, tz)}</span>` : ''}</td>
            <td class="pp-hide-sm">${x.outcomes.length ? html`<span class="cluster">${x.outcomes.map(k => html`<span class="tag tag--ok">${k.replace(/_/g, ' ')}</span>`)}</span>` : html`<span class="ink-3">${x.sent_at ? 'none yet' : 'not sent'}</span>`}</td></tr>`)}</tbody></table>`
        : html`<p class="cp-empty-line cp-pad">No outreach linked. Draft messages from a person’s page in <a href="#/people">People</a>, then add them here.</p>`}
      </section>
    </div>

    <aside class="stack cp-aside">
      <section class="tile tile--static cp-card-s" aria-labelledby="cp-oc-h">
        <h2 class="section-label" id="cp-oc-h">Outcomes</h2>
        <dl class="cp-outcomes">
          <div><dt>Replies</dt><dd>${o.replies}</dd></div>
          <div><dt>Meetings</dt><dd>${o.meetings}</dd></div>
          <div><dt>Portfolio visits</dt><dd>${o.portfolio_visits ?? html`<span class="cp-na">unavailable</span>`}</dd></div>
        </dl>
        <p class="cp-note">Replies and meetings come from your interaction log after a message was sent. Portfolio visits come from metrics you enter on drafts, shown as unavailable when none were recorded.</p>
      </section>
      ${c.project ? html`<section class="tile tile--static cp-card-s" aria-labelledby="cp-pj-h"><h2 class="section-label" id="cp-pj-h">Project</h2>
        <a class="pp-name" href="#/career/projects">${c.project.title}</a><p class="cp-note">${c.project.kind || ''}${c.project.status ? ` · ${c.project.status}` : ''}</p></section>` : ''}
      <section class="tile tile--static cp-card-s" aria-labelledby="cp-src-h">
        <h2 class="section-label" id="cp-src-h">Sources attached · ${c.sources.length}</h2>
        ${c.sources.length ? html`<ul class="cp-srcs">${c.sources.map(s => html`<li><span class="tag tag--neutral">${evLabel(s.kind)}</span><a href="${s.url}" target="_blank" rel="noopener">${s.title}</a></li>`)}</ul>`
        : html`<p class="cp-note">${c.story_id ? 'The linked story has no sources.' : 'Link a story to attach its sources.'}</p>`}
      </section>
    </aside>
  </div>`);
  el.replaceChildren(root);

  const again = () => renderDetail(el, id, ctx);
  on(root, 'click', 'tr[data-outreach]', (e, tr) => { if (!e.target.closest('a')) openOutreach(tr.dataset.outreach, again); });
  on(root, 'click', '[data-remove-draft]', (e, b) => act(b, async () => { await api.patch(`/drafts/${b.dataset.removeDraft}`, { campaign_id: null }); toast('Removed from the campaign (the draft is kept)', 'ok'); again(); }));
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
    if (a === 'edit') {
      const [stories, projects] = await Promise.all([api.get('/stories?limit=200').catch(() => []), api.get('/projects').catch(() => [])]);
      pickModal(html`<h2>Edit campaign</h2>
        <label class="field">Name<input class="input" name="name" value="${c.name}"></label>
        <label class="field">Goal<textarea class="textarea" name="goal" rows="3">${c.goal || ''}</textarea></label>
        <label class="field">Story<select class="select" name="story_id"><option value="">None</option>${stories.map(s => html`<option value="${s.id}" ${s.id === c.story_id ? 'selected' : ''}>${fmtScore(s.score)} · ${s.short_title || s.title}</option>`)}</select></label>
        <label class="field">Project<select class="select" name="project_id"><option value="">None</option>${projects.map(p => html`<option value="${p.id}" ${p.id === c.project_id ? 'selected' : ''}>${p.title}</option>`)}</select></label>`, 'Save', async (m) => {
        const fd = Object.fromEntries(new FormData(m.el.querySelector('form')));
        await api.patch(`/campaigns/${id}`, { name: fd.name, goal: fd.goal, story_id: fd.story_id ? Number(fd.story_id) : null, project_id: fd.project_id ? Number(fd.project_id) : null });
      });
    }
    if (a === 'add-drafts') {
      const free = (await api.get('/drafts')).filter(d => !d.campaign_id);
      pickModal(html`<h2>Add drafts</h2><div class="cp-pick">${free.length ? free.map(d => html`<label class="pp-check cp-pick-row"><input type="checkbox" value="${d.id}" data-pick ${c.story_id && d.story_id === c.story_id ? 'checked' : ''}><span class="cp-pick-t">${d.title}</span><span class="chip">${channelLabel(d.channel, d.format)}</span>${status(d.status)}</label>`) : html`<p class="pp-note">No unassigned drafts. Create one in <a href="#/studio" data-close>Studio</a>.</p>`}</div>`,
        'Add selected', async (m) => { for (const x of m.el.querySelectorAll('[data-pick]:checked')) await api.patch(`/drafts/${x.value}`, { campaign_id: c.id }); });
    }
    if (a === 'add-outreach') {
      const free = (await api.get('/outreach')).filter(x => !x.campaign_id && !['cancelled', 'sent'].includes(x.status));
      pickModal(html`<h2>Add outreach</h2><div class="cp-pick">${free.length ? free.map(x => html`<label class="pp-check cp-pick-row"><input type="checkbox" value="${x.id}" data-pick><span class="cp-pick-t">${stripDemo(x.name)} · ${PURPOSES[x.purpose] || x.purpose}</span><span class="chip">${CHANNELS[x.channel] || x.channel}</span>${status(x.status)}</label>`) : html`<p class="pp-note">No unassigned open outreach. Draft one from a person in <a href="#/people" data-close>People</a>.</p>`}</div>`,
        'Add selected', async (m) => { for (const x of m.el.querySelectorAll('[data-pick]:checked')) await api.patch(`/outreach/${x.value}`, { campaign_id: c.id }); });
    }
  });

  function pickModal(body, okLabel, fn) {
    const m = modal(String(html`<form class="stack">${body}<div class="modal-actions"><button type="button" class="btn btn--ghost" data-close>Cancel</button><button class="btn btn--primary" type="submit">${okLabel}</button></div></form>`), { wide: true });
    m.el.querySelector('form').addEventListener('submit', async (e) => { e.preventDefault(); await act(e.submitter, async () => { await fn(m); m.close(); toast('Saved', 'ok'); again(); }); });
  }
}
