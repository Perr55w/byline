import { api } from '../api.js';
import { html, on, act, toast, evChip, demoFlag, status, channelLabel, timeAgo, fmtDate, pct, modal, scoreNum, topicsLine } from '../ui.js';

const COLLECTIONS = ['AI product management', 'Business analysis', 'Data analytics', 'Career watchlist'];

export async function render(view, ctx) {
  const el = document.createElement('div');
  view.replaceChildren(el);
  if (ctx.name === 'story') return renderStory(el, view, Number(ctx.params[0]));
  return renderFeed(el, view);
}

const meter = (b = {}) => html`<div class="meter">${[['interest', 'Interest'], ['novelty', 'Novelty'], ['evidence', 'Evidence'], ['impact', 'Impact']].map(([k, l]) =>
  html`<div>${l} ${pct(b[k])}<i><b style="width:${pct(b[k])}%"></b></i></div>`)}</div>`;

const engagementNote = (e) => {
  const entries = Object.entries(e || {});
  if (!entries.length) return '';
  return html`<span class="chip" title="Engagement is shown separately and does not count as evidence">engagement (not evidence): ${entries.map(([k, v]) => `${v.toLocaleString()} ${k.replace('_count', 's')}`).join(' · ')}</span>`;
};

async function renderFeed(el, view) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const [settings, stories] = await Promise.all([api.get('/settings'), api.get(`/stories?${q.toString()}`)]);
  el.innerHTML = String(html`
  <div class="page-head">
    <div><div class="kicker">Ranked by your priorities</div><h1>Feed</h1>
      <p class="lede">Coverage of the same development is grouped into one story. Scores combine interest, novelty, evidence quality, and practical impact — engagement is never counted as evidence.</p></div>
  </div>
  <div style="margin-bottom:18px">
    <form class="row" id="intake">
      <input name="url" placeholder="Submit a story URL (when no connector covers it)…" style="flex:1;min-width:260px">
      <select name="evidence_kind" style="width:auto">
        <option value="reporting">Independent reporting</option><option value="announcement">Announcement</option>
        <option value="research">Research</option><option value="commentary">Commentary</option>
      </select>
      <button class="primary" type="submit">Add story</button>
    </form>
  </div>
  <div class="row" style="margin-bottom:14px">
    <a class="chip ${!q.get('topic') ? 'blue' : ''}" href="#/feed">All</a>
    ${settings.priorities.map(p => html`${p.weight > 0 ? html`<a class="chip ${q.get('topic') === p.topic ? 'blue' : ''}" href="#/feed?topic=${encodeURIComponent(p.topic)}">${p.topic}</a>` : ''}`)}
    <a class="chip ${q.get('status') === 'archived' ? 'blue' : ''}" href="#/feed?status=archived">Archived</a>
  </div>
  <section class="card">
    ${stories.length ? stories.map((s, idx) => html`
      <div class="story" data-href="#/story/${s.id}">
        <div class="score ${idx === 0 && s.score >= settings.publish_threshold ? 'hot' : ''}">${scoreNum(s.score)}<small>Score</small></div>
        <div>
          <div class="story-title">${s.title} ${demoFlag(s.is_demo)}</div>
          <div class="row" style="margin-top:7px;gap:6px 14px">
            ${topicsLine(s.topics)}
            <span class="when">${s.article_count} article${s.article_count > 1 ? 's' : ''} · ${s.domain_count} source${s.domain_count > 1 ? 's' : ''} · ${timeAgo(s.updated_at)}</span>
            ${s.new_since_view ? html`<span class="new-pill">${s.new_since_view} new since you looked</span>` : ''}
            ${(s.companies || []).length ? html`<span class="chip blue">${s.companies.join(', ')}</span>` : ''}
            ${s.collections ? html`<span class="chip green">Saved: ${s.collections}</span>` : ''}
          </div>
          <div class="story-why">${s.explanation || ''}</div>
          ${meter(s.breakdown)}
          ${engagementNote(s.breakdown?.engagement)}
        </div>
      </div>`) : html`<div class="empty">No stories yet. Add sources, run the daily workflow, or load demo data from Today.</div>`}
  </section>`);

  on(el, 'click', '[data-href]', (e, t) => { location.hash = t.dataset.href; });
  el.querySelector('#intake').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    await act(e.target.querySelector('button'), async () => {
      const r = await api.post('/intake/url', { url: f.get('url'), evidence_kind: f.get('evidence_kind') });
      toast(r.created ? 'Story added' : 'Already collected — opening it', 'ok');
      location.hash = `#/story/${r.story_id}`;
    }, 'Fetching…');
  });
}

async function renderStory(el, view, id) {
  const d = await api.get(`/stories/${id}`);
  const s = d.story;
  const lens = d.lens || {};
  const kinds = ['announcement', 'research', 'reporting', 'commentary', 'community', 'application'];
  const byKind = kinds.map(k => [k, d.claims.filter(c => c.evidence_kind === k)]).filter(([, c]) => c.length);
  const followUps = d.articles.filter(a => a.id !== d.origin?.id);

  el.innerHTML = String(html`
  <div class="page-head">
    <div style="max-width:880px">
      <div class="kicker"><a href="#/feed">← Feed</a> · Story #${s.id} ${demoFlag(s.is_demo)}</div>
      <h1>${s.title}</h1>
      <p class="lede">${s.summary || ''}</p>
      <div class="row" style="margin-top:10px">
        <span class="chip amber">score ${s.score}</span>
        ${topicsLine(s.topics, 6)}
        ${(s.companies || []).map(c => html`<span class="chip blue">${c}</span>`)}
        ${s.status === 'archived' ? html`<span class="chip">archived</span>` : ''}
      </div>
      <p class="story-why" style="margin-top:10px"><strong>Why it ranked:</strong> ${s.explanation}</p>
      ${meter(s.breakdown)}
      <div style="margin-top:8px">${engagementNote(s.breakdown?.engagement)}</div>
    </div>
  </div>

  <div class="split">
    <div class="stack reveal">
      <section class="card">
        <h3>Evidence cards</h3>
        <p class="muted small" style="margin-top:-4px">Each claim is attached to the source it came from, labeled by the kind of evidence it rests on.</p>
        ${byKind.length ? byKind.map(([k, claims]) => html`
          <div style="margin-top:12px">${evChip(k)}
            ${claims.map(c => { const a = d.articles.find(x => x.id === c.article_id); return html`
              <div class="evidence ${k}"><div class="claim">“${c.text}”</div>
                ${a ? html`<div class="mono faint" style="margin-top:4px"><a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.domain}</a> · ${fmtDate(a.published_at || a.fetched_at)}</div>` : ''}</div>`; })}
          </div>`) : html`<p class="muted small">No extractable claims — read the sources directly.</p>`}
      </section>

      <section class="card">
        <h3>Coverage</h3>
        ${d.origin ? html`<div class="label" style="margin-bottom:6px">ORIGINATING SOURCE</div>
          <div class="source-row">${evChip(d.origin.evidence_kind)}<a href="${d.origin.url}" target="_blank" rel="noopener noreferrer">${d.origin.title}</a><span class="mono faint">${d.origin.domain}</span></div>` : ''}
        ${followUps.length ? html`<div class="label" style="margin:14px 0 6px">FOLLOW-UP COVERAGE</div>
          ${followUps.map(a => html`<div class="source-row">${evChip(a.evidence_kind)}<span><a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a> ${a.is_new ? html`<span class="new-pill">NEW</span>` : ''}
            <div class="small muted">${a.summary}</div></span><span class="mono faint">${a.domain}<br>${timeAgo(a.published_at || a.fetched_at)}</span></div>`)}` : html`<p class="muted small" style="margin-top:12px">No independent follow-up coverage yet.</p>`}
      </section>

      <section class="card">
        <div class="row between"><h3>Angles</h3><button class="sm" data-act="angles">Suggest angles</button></div>
        <div id="angles" class="muted small">Get two or three distinct ways to cover this story.</div>
      </section>
    </div>

    <div class="stack reveal">
      <section class="card accent">
        <h3>Make something from it</h3>
        <div class="grid g2" style="gap:8px">
          <button class="primary" data-act="draft" data-channel="linkedin" data-format="long">LinkedIn · analysis</button>
          <button data-act="draft" data-channel="linkedin" data-format="article">LinkedIn · article</button>
          <button data-act="draft" data-channel="instagram" data-format="carousel">IG carousel</button>
          <button data-act="draft" data-channel="instagram" data-format="reel">IG Reel</button>
          <button data-act="draft" data-channel="linkedin" data-format="short">LinkedIn · short</button>
          <button data-act="draft" data-channel="video" data-format="explainer">Video explainer</button>
          <button data-act="project">Portfolio project</button>
        </div>
        ${d.drafts.length ? html`<div class="hr"></div><div class="label">EXISTING PIECES</div>${d.drafts.map(x => html`<div class="row between small" style="padding:4px 0"><a href="#/draft/${x.id}">${channelLabel(x.channel, x.format)}</a>${status(x.status)}</div>`)}` : ''}
        ${d.projects.length ? d.projects.map(p => html`<div class="row between small" style="padding:4px 0"><a href="#/career">Project: ${p.title}</a><span class="chip">${p.status}</span></div>`) : ''}
      </section>

      <section class="card">
        <div class="row between"><h3>Career lens</h3><button class="sm ghost" data-act="lens">Refresh</button></div>
        <dl class="small" style="margin:0">
          <dt class="label">WHO COULD USE IT</dt><dd style="margin:2px 0 10px">${lens.who}</dd>
          <dt class="label">DECISION IT MIGHT CHANGE</dt><dd style="margin:2px 0 10px">${lens.decision}</dd>
          <dt class="label">WHAT TO LEARN</dt><dd style="margin:2px 0 10px">${lens.learn}</dd>
          <dt class="label">WHAT YOU COULD TEST</dt><dd style="margin:2px 0 0"><ul style="margin:4px 0;padding-left:18px">${(Array.isArray(lens.test) ? lens.test : [lens.test]).filter(Boolean).map(t => html`<li>${t}</li>`)}</ul></dd>
        </dl>
        <div class="faint mono" style="margin-top:8px">via ${lens.provider || 'provider'}</div>
      </section>

      <section class="card">
        <h3>Employer connections</h3>
        ${d.employer_connections.length ? d.employer_connections.slice(0, 5).map(c => html`
          <div style="padding:8px 0;border-top:1px solid var(--line)">
            <div class="row between"><strong>${c.employer}</strong><span class="chip ${c.mention_ok ? 'green' : ''}">${c.mention_ok ? 'mention supported' : 'topical only'}</span></div>
            <div class="small" style="margin-top:4px">${c.why}</div>
            <div class="small faint" style="margin-top:3px">${c.mention_note} ${c.source ? html`<a href="${c.source.url}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</div>
          </div>`) : html`<p class="muted small">No grounded connection to your target employers.</p>`}
      </section>

      <section class="card">
        <h3>Save & signal</h3>
        <div class="row">${COLLECTIONS.map(c => html`<button class="sm ${d.saved.some(x => x.collection === c) ? 'primary' : ''}" data-act="save" data-c="${c}">${d.saved.some(x => x.collection === c) ? '✓ ' : ''}${c}</button>`)}</div>
        <div class="hr"></div>
        <div class="row">
          <button class="sm" data-act="fb" data-k="useful">Useful</button>
          <button class="sm" data-act="fb" data-k="repetitive">Repetitive</button>
          <button class="sm" data-act="fb" data-k="low_quality">Low quality</button>
          <button class="sm" data-act="fb" data-k="off_topic">Off-topic</button>
        </div>
        <div id="fb-result" class="small muted" style="margin-top:8px">${d.feedback.length ? `Your feedback: ${d.feedback.map(f => f.kind.replace('_', ' ')).join(', ')}` : 'Feedback adjusts how similar stories rank. See Runs → Feedback to review or reset.'}</div>
        <div class="hr"></div>
        <button class="sm ghost" data-act="archive">${s.status === 'archived' ? 'Unarchive' : 'Archive story'}</button>
      </section>
    </div>
  </div>`);

  on(el, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'draft') await act(btn, async () => {
      const r = await api.post(`/stories/${id}/drafts`, { channel: btn.dataset.channel, format: btn.dataset.format, angle: btn.dataset.angle });
      location.hash = `#/draft/${r.draft_id}`;
    }, 'Drafting…');
    if (a === 'project') await act(btn, async () => { await api.post(`/stories/${id}/project`); toast('Project scoped — edit it in Career → Projects', 'ok'); renderStory(fresh(view), view, id); });
    if (a === 'lens') await act(btn, async () => { await api.post(`/stories/${id}/lens`); renderStory(fresh(view), view, id); });
    if (a === 'save') await act(btn, async () => {
      const existing = d.saved.find(x => x.collection === btn.dataset.c);
      if (existing) await api.del(`/saved/${existing.id}`); else await api.post(`/stories/${id}/save`, { collection: btn.dataset.c });
      renderStory(fresh(view), view, id);
    });
    if (a === 'fb') await act(btn, async () => {
      const r = await api.post(`/stories/${id}/feedback`, { kind: btn.dataset.k });
      const adj = Object.entries(r.preferences.topic).map(([t, v]) => `${t} ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`).join(' · ');
      el.querySelector('#fb-result').textContent = `Recorded. Topic adjustments now: ${adj || 'none'}.`;
      toast('Feedback recorded', 'ok');
    });
    if (a === 'archive') await act(btn, async () => { await api.patch(`/stories/${id}`, { status: s.status === 'archived' ? 'seen' : 'archived' }); renderStory(fresh(view), view, id); });
    if (a === 'angles') await act(btn, async () => {
      const angles = await api.get(`/stories/${id}/angles`);
      el.querySelector('#angles').innerHTML = String(html`${angles.map(g => html`
        <div style="padding:10px 0;border-top:1px solid var(--line)">
          <div class="row between"><strong style="color:var(--text)">${g.title}</strong>
            <button class="sm" data-act="draft" data-channel="linkedin" data-format="long" data-angle="${g.key}">Draft with this angle</button></div>
          <div style="margin-top:4px">${g.covers}</div></div>`)}`);
    });
  });
}

function fresh(view) { const el = document.createElement('div'); view.replaceChildren(el); return el; }
