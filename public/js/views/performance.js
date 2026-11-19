// Performance (v4). F §2 Performance: with 0 published posts, "No published posts to measure yet." and the
// drafts count, with no placeholder charts; with 1–2 posts, the totals and "Comparisons start at 3 posts per
// format."; with ≥3 posts in two formats, "{Format} posts earn {x}× the {metric} of {format2}." All figures come
// from /api/performance (averages per post, null = not recorded) and /api/drafts.
// Kept from v3: goal metric (reach / saves / meaningful conversations), compare by topic / format / angle /
// channel, per-post metric entry (blank = unavailable, never zero), CSV import with matched / unmatched report.
import { api } from '../api.js';
import { html, on, act, toast, channelLabel, icon, useStyle, status } from '../ui.js';
import { enterItems, reduced } from '../motion.js';
import { plural, dayLabel } from './people.js';

const EDITABLE = ['impressions', 'reach', 'reactions', 'comments', 'reposts', 'saves', 'clicks', 'profile_visits', 'meaningful_conversations'];
const GOALS = [['reach', 'Reach'], ['saves', 'Saves'], ['meaningful_conversations', 'Meaningful conversations']];
const GROUPS = [['by_topic', 'Topic'], ['by_format', 'Format'], ['by_angle', 'Angle'], ['by_channel', 'Channel']];
const STATUS_ORDER = ['draft', 'in_review', 'approved', 'scheduled'];
const label = (m) => m.replace(/_/g, ' ');
const fmt = (v) => typeof v === 'number' ? v.toLocaleString('en-US') : null;
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const ui = { goal: 'reach', group: 'by_topic', importResult: null };

function headline(p, drafts) {
  const n = p.posts.length;
  const open = drafts.filter(d => !['published', 'archived'].includes(d.status)).length;
  if (!n) return { h: 'No published posts to measure yet.', l: html`<b>${open}</b> ${open === 1 ? 'draft exists' : 'drafts exist'}; mark one published or import a CSV to track impressions, reactions and replies.` };
  const sum = (m) => { const v = p.posts.map(r => r.metrics?.[m]).filter(x => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const goalLabel = GOALS.find(g => g[0] === ui.goal)?.[1].toLowerCase() || label(ui.goal);
  const eligible = (p.by_format || []).filter(g => g.posts >= 3 && typeof g[ui.goal] === 'number' && g[ui.goal] > 0).sort((a, b) => b[ui.goal] - a[ui.goal]);
  const totals = html`<b>${fmt(sum('impressions')) ?? 'no'}</b> impressions, <b>${fmt(sum('reactions')) ?? 'no'}</b> reactions recorded`;
  if (eligible.length >= 2) {
    const a = eligible[0], b = eligible[eligible.length - 1];
    const x = Math.round(a[ui.goal] / b[ui.goal] * 10) / 10;
    if (x < 1.2) return { h: `${cap(a.key)} and ${b.key} posts earn about the same ${goalLabel}.`, l: html`<b>${n}</b> published posts; ${totals}. Averages per post: ${a.key} ${fmt(a[ui.goal])} vs ${b.key} ${fmt(b[ui.goal])} (${a.posts} and ${b.posts} posts).` };
    return { h: html`${cap(a.key)} posts earn <span class="pf-x">${x}×</span> the ${goalLabel} of ${b.key}.`, l: html`<b>${n}</b> published posts; ${totals}. Averages per post: ${a.key} ${fmt(a[ui.goal])} vs ${b.key} ${fmt(b[ui.goal])} (${a.posts} and ${b.posts} posts).` };
  }
  return { h: `${plural(n, 'published post')} so far.`, l: html`${totals}. Comparisons start at 3 posts per format.` };
}

export async function render(view) {
  await useStyle('/css/v4/performance.css');
  const [p, drafts] = await Promise.all([api.get('/performance', { fresh: true }), api.get('/drafts').catch(() => [])]);
  const metrics = p.metrics || EDITABLE;
  const groups = p[ui.group] || [];
  const max = Math.max(0, ...groups.map(g => g[ui.goal] ?? 0));
  const goalLabel = GOALS.find(g => g[0] === ui.goal)?.[1] || label(ui.goal);
  const groupLabel = GROUPS.find(g => g[0] === ui.group)[1];
  const best = groups.filter(g => g[ui.goal] != null).sort((a, b) => b[ui.goal] - a[ui.goal])[0];
  const hd = headline(p, drafts);
  const open = drafts.filter(d => !['published', 'archived'].includes(d.status));
  const byStatus = STATUS_ORDER.map(s => [s, open.filter(d => d.status === s)]);
  const near = open.filter(d => ['approved', 'scheduled', 'in_review'].includes(d.status));
  const byChannel = ['linkedin', 'instagram', 'video'].map(c => [c, open.filter(d => d.channel === c).length]).filter(x => x[1]);
  const recorded = (r) => EDITABLE.filter(m => typeof r.metrics?.[m] === 'number').length;
  const cell = (v) => v == null ? html`<td class="num pf-na">—</td>` : html`<td class="num">${fmt(v)}</td>`;

  const el = document.createElement('div');
  el.className = 'pf';
  el.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow">Publish · post results</p>
    <h1>${hd.h}</h1>
    <p class="lede">${hd.l}</p>
    ${p.posts.length ? html`<div class="page-head-actions">
      <label class="pf-goal"><span>Goal metric</span><select class="select" data-goal>${GOALS.map(([k, l]) => html`<option value="${k}" ${k === ui.goal ? 'selected' : ''}>${l}</option>`)}</select></label>
    </div>` : ''}
  </header>

  ${p.posts.length ? html`
  <section class="tile tile--static tile--flush pf-compare" aria-labelledby="pf-c-h">
    <div class="section-head pf-pad"><h2 class="t-h2" id="pf-c-h">${goalLabel} per post, by ${groupLabel.toLowerCase()}</h2>
      <div class="cluster" role="group" aria-label="Compare by">${GROUPS.map(([k, l]) => html`<button class="chip chip--filter" data-group="${k}" aria-pressed="${k === ui.group}">${l}</button>`)}</div></div>
    <p class="pf-sub pf-pad">${best ? html`Best average ${goalLabel.toLowerCase()}: <b>${ui.group === 'by_channel' ? channelLabel(best.key) : best.key}</b> (${fmt(best[ui.goal])} across ${plural(best.posts, 'post')}).${groups.some(g => g.posts < 3) ? ' Groups under 3 posts are a hint, not a verdict.' : ''}` : `No ${goalLabel.toLowerCase()} recorded yet for any published post.`}</p>
    <div class="pf-scroll"><table class="table pf-table">
      <thead><tr><th>${groupLabel}</th><th class="num">Posts</th><th class="pf-goalcol">${goalLabel} (avg)</th>${metrics.filter(m => m !== ui.goal).map(m => html`<th class="num">${label(m)}</th>`)}</tr></thead>
      <tbody>${groups.map(g => html`<tr>
        <td class="pf-key">${ui.group === 'by_channel' ? channelLabel(g.key) : g.key}${g.posts < 3 ? html`<span class="pf-small">small sample</span>` : ''}</td><td class="num">${g.posts}</td>
        <td class="pf-goalcol">${g[ui.goal] == null ? html`<span class="pf-na">not recorded</span>`
          : html`<span class="pf-bar"><span class="meter"><i style="--v:${max ? Math.max(.02, g[ui.goal] / max) : 0}"></i></span><b>${fmt(g[ui.goal])}</b></span>`}</td>
        ${metrics.filter(m => m !== ui.goal).map(m => cell(g[m]))}
      </tr>`)}</tbody>
    </table></div>
  </section>

  <section class="tile tile--static tile--flush" aria-labelledby="pf-m-h">
    <div class="section-head pf-pad"><h2 class="t-h2" id="pf-m-h">Published posts · metrics</h2><span class="section-meta">${p.posts.filter(r => recorded(r)).length} of ${p.posts.length} with results</span></div>
    <p class="pf-sub pf-pad">Leave a field blank if the platform doesn’t report it (Instagram has no reposts). Blank means unavailable, never zero.</p>
    <div class="pf-scroll"><table class="table pf-table pf-entry">
      <thead><tr><th>Post</th>${EDITABLE.map(m => html`<th class="num">${label(m)}</th>`)}<th><span class="sr-only">Save</span></th></tr></thead>
      <tbody>${p.posts.map(r => html`<tr data-prow="${r.id}">
        <td class="pf-post"><a class="pf-title" href="#/draft/${r.id}">${r.title}</a>
          <span class="pf-meta"><span class="chip">${channelLabel(r.channel, r.format)}</span>${r.angle ? html`<span class="chip">${r.angle}</span>` : ''}<span>published ${dayLabel((r.published_at || '').slice(0, 10), { weekday: false })}</span>${r.metrics?.updated_at ? html`<span>updated ${dayLabel(r.metrics.updated_at.slice(0, 10), { weekday: false })}</span>` : ''}</span></td>
        ${EDITABLE.map(m => html`<td><input class="input pf-metric" type="number" min="0" step="1" inputmode="numeric" data-m="${m}" value="${typeof r.metrics?.[m] === 'number' ? r.metrics[m] : ''}" placeholder="—" aria-label="${label(m)} for ${r.title}"></td>`)}
        <td><button class="btn btn--primary btn--sm" data-act="save" data-id="${r.id}">Save</button></td>
      </tr>`)}</tbody>
    </table></div>
  </section>` : html`
  <div class="pf-cols">
    <section class="tile tile--static pf-card" aria-labelledby="pf-pipe-h">
      <div class="section-head"><h2 class="t-h2" id="pf-pipe-h">On the way to publishing</h2><span class="section-meta">${plural(open.length, 'open draft')}</span></div>
      <ol class="pf-pipe" aria-label="Open drafts by status">${byStatus.map(([s, a]) => html`<li class="${a.length ? '' : 'is-zero'}"><span class="pf-pipe-n">${a.length}</span><span class="pf-pipe-l">${label(s)}</span></li>`)}<li class="is-zero pf-pipe-end"><span class="pf-pipe-n">0</span><span class="pf-pipe-l">published</span></li></ol>
      <p class="pf-sub">${byChannel.map(([c, n]) => `${n} ${channelLabel(c)}`).join(' · ')}. Metrics are measured only once a draft is published: publish from Studio, or use “Mark as published” there after posting by hand.</p>
      ${near.length ? html`<h3 class="pf-h3">Closest to publishing</h3><ul class="pf-near">${near.slice(0, 6).map(d => html`<li><a class="pf-title" href="#/draft/${d.id}">${d.title}</a><span class="pf-meta">${status(d.status)}<span class="chip">${channelLabel(d.channel, d.format)}</span></span></li>`)}</ul>`
        : html`<p class="pf-sub">No draft is in review, approved or scheduled yet.</p>`}
    </section>
    <aside class="stack">
      <section class="tile tile--static pf-card" aria-labelledby="pf-what-h">
        <h2 class="section-label" id="pf-what-h">What will be tracked</h2>
        <p class="pf-sub">Per published post, as the platform reports it. Missing values stay blank, never zero.</p>
        <ul class="pf-metric-list">${metrics.map(m => html`<li>${label(m)}</li>`)}</ul>
      </section>
    </aside>
  </div>`}

  <section class="tile tile--static pf-card pf-import" aria-labelledby="pf-i-h">
    <div class="section-head"><h2 class="t-h2" id="pf-i-h">Import CSV</h2><span class="section-meta">matches by draft_id or exact title</span></div>
    <p class="pf-sub">First line is the header: <code>draft_id</code> or <code>title</code>, then any metric columns (${metrics.join(', ')}). Empty cells are skipped. Results show here once the matched draft is published.</p>
    <textarea class="textarea pf-csv" data-csv rows="5" aria-label="CSV to import" placeholder="draft_id,impressions,reach,reactions,comments,saves&#10;12,1840,1320,46,9,14"></textarea>
    <div class="pf-import-row"><button class="btn btn--primary" data-act="import">Import</button>
      ${ui.importResult ? html`<span class="tag tag--ok">${plural(ui.importResult.matched, 'row')} matched</span>
        ${ui.importResult.unmatched.length ? html`<span class="pf-err">Unmatched: ${ui.importResult.unmatched.map(u => u || '(blank)').join(', ')}</span>` : ''}` : ''}
    </div>
  </section>`);
  view.replaceChildren(el);

  const again = async (animate) => { await render(view); if (animate && !reduced()) enterItems([...view.querySelectorAll('.pf > .tile, .pf-cols')].slice(0, 3), { y: 4, duration: 360, fadeDuration: 260 }); };
  on(el, 'change', '[data-goal]', (e, s) => { ui.goal = s.value; again(true); });
  on(el, 'click', '[data-group]', (e, b) => { ui.group = b.dataset.group; again(); });
  on(el, 'click', '[data-act]', async (e, btn) => {
    if (btn.dataset.act === 'save') await act(btn, async () => {
      const row = el.querySelector(`[data-prow="${btn.dataset.id}"]`);
      const body = {};
      for (const inp of row.querySelectorAll('[data-m]')) {
        if (inp.value !== '' && (isNaN(Number(inp.value)) || Number(inp.value) < 0)) throw new Error(`${label(inp.dataset.m)} must be a non-negative number`);
        body[inp.dataset.m] = inp.value === '' ? null : Number(inp.value);
      }
      await api.patch(`/drafts/${btn.dataset.id}/metrics`, body);
      toast('Metrics saved', 'ok');
      again();
    }, 'Saving…');
    if (btn.dataset.act === 'import') await act(btn, async () => {
      const csv = el.querySelector('[data-csv]').value.trim();
      if (!csv.includes('\n')) throw new Error('Paste a header line and at least one data row.');
      ui.importResult = await api.post('/performance/import', { csv });
      toast(`Imported ${plural(ui.importResult.matched, 'row')}`, ui.importResult.unmatched.length ? '' : 'ok');
      again();
    }, 'Importing…');
  });
  void icon;
}
