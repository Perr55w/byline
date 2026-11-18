import { api } from '../api.js';
import { html, on, act, toast, channelLabel, fmtDate } from '../ui.js';

const EDITABLE = ['impressions', 'reach', 'reactions', 'comments', 'reposts', 'saves', 'clicks', 'profile_visits', 'meaningful_conversations'];
const GOALS = [['reach', 'Reach'], ['saves', 'Saves'], ['meaningful_conversations', 'Meaningful conversations']];
const GROUPS = [['by_topic', 'Topic'], ['by_format', 'Format'], ['by_angle', 'Angle'], ['by_channel', 'Channel']];
const label = (m) => m.replace(/_/g, ' ');
const fmt = (v) => typeof v === 'number' ? v.toLocaleString() : null;
const ui = { goal: 'reach', group: 'by_topic', importResult: null };

export async function render(view) {
  const p = await api.get('/performance');
  const el = document.createElement('div');
  view.replaceChildren(el);
  const metrics = p.metrics || EDITABLE;
  const groups = p[ui.group] || [];
  const max = Math.max(0, ...groups.map(g => g[ui.goal] ?? 0));
  const goalLabel = GOALS.find(g => g[0] === ui.goal)?.[1] || label(ui.goal);
  const best = groups.filter(g => g[ui.goal] != null).sort((a, b) => b[ui.goal] - a[ui.goal])[0];
  const cell = (v) => v == null ? html`<td class="na">unavailable</td>` : html`<td class="mono">${fmt(v)}</td>`;

  el.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker">Post performance</div>
      <h1>Performance</h1>
      <p class="lede">Enter or import results for published posts and compare what works by topic, format, angle and channel. Missing metrics are shown as unavailable — never counted as zero.</p>
    </div>
    <label class="field" style="min-width:240px">Goal metric
      <select data-goal>${GOALS.map(([k, l]) => html`<option value="${k}" ${k === ui.goal ? 'selected' : ''}>${l}</option>`)}</select>
    </label>
  </div>

  <div class="stack reveal">
    <section class="card accent">
      <div class="row between"><h3>Compare averages per post</h3>
        <div class="tabs" style="margin:0;border:0">${GROUPS.map(([k, l]) => html`<button data-group="${k}" class="${k === ui.group ? 'on' : ''}">${l}</button>`)}</div>
      </div>
      ${groups.length ? html`
        ${best ? html`<p class="muted small" style="margin-top:0">Best average ${goalLabel.toLowerCase()} by ${GROUPS.find(g => g[0] === ui.group)[1].toLowerCase()}: <strong style="color:var(--text)">${best.key}</strong> (${fmt(best[ui.goal])}). Small samples — treat as a hint, not a verdict.</p>`
          : html`<p class="muted small" style="margin-top:0">No ${goalLabel.toLowerCase()} recorded yet for any post.</p>`}
        <div class="ctl-scroll"><table>
          <thead><tr><th>${GROUPS.find(g => g[0] === ui.group)[1]}</th><th>Posts</th><th>${goalLabel} (avg)</th>${metrics.filter(m => m !== ui.goal).map(m => html`<th>${label(m)}</th>`)}</tr></thead>
          <tbody>${groups.map(g => html`<tr>
            <td>${ui.group === 'by_channel' ? channelLabel(g.key) : g.key}</td><td class="mono">${g.posts}</td>
            <td>${g[ui.goal] == null ? html`<span class="faint" style="font-style:italic">unavailable</span>`
              : html`<div class="ctl-bar"><i><b style="width:${max ? Math.max(2, Math.round(g[ui.goal] / max * 100)) : 0}%"></b></i><span>${fmt(g[ui.goal])}</span></div>`}</td>
            ${metrics.filter(m => m !== ui.goal).map(m => cell(g[m]))}
          </tr>`)}</tbody>
        </table></div>` : html`<div class="empty">No published posts yet. Publish a draft (or use “Mark as published” in the Studio after posting manually), then record its results here.</div>`}
    </section>

    <section class="card">
      <h3>Published posts · metrics</h3>
      ${p.posts.length ? html`
        <p class="muted small" style="margin-top:0">Leave a field blank if the platform doesn’t report it (e.g. Instagram has no reposts). Blank means unavailable.</p>
        <div class="ctl-scroll"><table>
          <thead><tr><th>Post</th>${EDITABLE.map(m => html`<th>${label(m)}</th>`)}<th></th></tr></thead>
          <tbody>${p.posts.map(r => html`<tr data-row="${r.id}">
            <td style="min-width:220px"><a href="#/draft/${r.id}" style="color:var(--text)">${r.title}</a>
              <div class="row small" style="margin-top:4px"><span class="chip">${channelLabel(r.channel, r.format)}</span>${r.angle ? html`<span class="chip violet">${r.angle}</span>` : ''}<span class="faint mono">#${r.id} · ${fmtDate(r.published_at)}</span></div>
              ${r.metrics?.updated_at ? html`<div class="faint small">updated ${fmtDate(r.metrics.updated_at)}</div>` : ''}</td>
            ${EDITABLE.map(m => html`<td><input class="metric" type="number" min="0" step="1" data-m="${m}" value="${typeof r.metrics?.[m] === 'number' ? r.metrics[m] : ''}" placeholder="—" aria-label="${label(m)}"></td>`)}
            <td><button class="sm primary" data-act="save" data-id="${r.id}">Save</button></td>
          </tr>`)}</tbody>
        </table></div>` : html`<p class="muted small">Nothing to enter yet.</p>`}
    </section>

    <section class="card flat">
      <h3>Import CSV</h3>
      <p class="muted small" style="margin-top:0">First line is the header: <span class="mono">draft_id</span> or <span class="mono">title</span>, then any metric columns (${metrics.join(', ')}). Empty cells are skipped.</p>
      <textarea data-csv rows="5" placeholder="draft_id,impressions,reach,reactions,comments,saves&#10;12,1840,1320,46,9,14"></textarea>
      <div class="row" style="margin-top:10px"><button class="primary" data-act="import">Import</button>
        ${ui.importResult ? html`<span class="ctl-ok">${ui.importResult.matched} row${ui.importResult.matched === 1 ? '' : 's'} matched</span>
          ${ui.importResult.unmatched.length ? html`<span class="ctl-err">Unmatched: ${ui.importResult.unmatched.map(u => u || '(blank)').join(', ')}</span>` : ''}` : ''}
      </div>
    </section>
  </div>`);

  on(el, 'change', '[data-goal]', (e, s) => { ui.goal = s.value; render(view); });
  on(el, 'click', '[data-group]', (e, b) => { ui.group = b.dataset.group; render(view); });
  on(el, 'click', '[data-act]', async (e, btn) => {
    if (btn.dataset.act === 'save') await act(btn, async () => {
      const row = el.querySelector(`[data-row="${btn.dataset.id}"]`);
      const body = {};
      for (const inp of row.querySelectorAll('[data-m]')) {
        if (inp.value !== '' && (isNaN(Number(inp.value)) || Number(inp.value) < 0)) throw new Error(`${label(inp.dataset.m)} must be a non-negative number`);
        body[inp.dataset.m] = inp.value === '' ? null : Number(inp.value);
      }
      await api.patch(`/drafts/${btn.dataset.id}/metrics`, body);
      toast('Metrics saved', 'ok');
      render(view);
    }, 'Saving…');
    if (btn.dataset.act === 'import') await act(btn, async () => {
      const csv = el.querySelector('[data-csv]').value.trim();
      if (!csv.includes('\n')) throw new Error('Paste a header line and at least one data row.');
      ui.importResult = await api.post('/performance/import', { csv });
      toast(`Imported ${ui.importResult.matched} row(s)`, ui.importResult.unmatched.length ? '' : 'ok');
      render(view);
    }, 'Importing…');
  });
}
