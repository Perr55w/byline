import { api } from '../api.js';
import { html, on, act, toast, confirmBox, fmtDateTime, timeAgo } from '../ui.js';

const STAGES = ['collect', 'cluster', 'rank', 'brief', 'draft'];
const usd = (v) => `$${(v || 0).toFixed((v || 0) < 1 ? 4 : 2)}`;
const dur = (a, b) => {
  if (!a || !b) return '—';
  const ms = Date.parse(b) - Date.parse(a);
  return ms < 1000 ? `${ms} ms` : ms < 60e3 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60e3)}m ${Math.round((ms % 60e3) / 1000)}s`;
};
const runChip = (s) => html`<span class="chip ${({ done: 'green', failed: 'red', running: 'amber' })[s] || ''}">${s || '—'}</span>`;
const signed = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
const FB_LABEL = { useful: 'Useful', repetitive: 'Repetitive', low_quality: 'Low quality', off_topic: 'Off-topic' };

function stageSummary(stage, d) {
  if (!d) return '';
  const line = (s) => html`<div class="small muted">${s}</div>`;
  if (stage === 'collect') return html`
    ${line(`${d.sources} source${d.sources === 1 ? '' : 's'} polled · ${d.collected} items collected · ${d.new} new · ${d.duplicates} duplicates · ${d.cached} served from cache`)}
    ${d.failed?.length ? html`<div class="small" style="margin-top:6px"><span class="ctl-err">${d.failed.length} source${d.failed.length === 1 ? '' : 's'} failed</span>
      <ul class="ctl-list">${d.failed.map(f => html`<li><strong>${f.source}</strong>: <span class="ctl-err">${f.error}</span></li>`)}</ul></div>` : ''}
    ${d.skipped?.length ? html`<details class="small" style="margin-top:6px"><summary class="muted" style="cursor:pointer">${d.skipped.length} skipped</summary>
      <ul class="ctl-list">${d.skipped.map(f => html`<li><strong>${f.source}</strong> — ${f.reason}</li>`)}</ul></details>` : ''}`;
  if (stage === 'cluster') return line(`${d.articles} unclustered article${d.articles === 1 ? '' : 's'} · ${d.new_stories} new stor${d.new_stories === 1 ? 'y' : 'ies'} · ${d.merged} merged into existing stories`);
  if (stage === 'rank') return line(`${d.ranked} stories re-ranked`);
  if (stage === 'brief') return line(`${d.items} brief item${d.items === 1 ? '' : 's'}${d.quiet ? ' · quiet day (nothing met the publishing threshold)' : ''}`);
  if (stage === 'draft') return html`<div class="small muted">${d.created ? 'Draft created' : d.draft_id ? 'Existing draft reused' : 'No draft'}${d.format ? ` (${d.format})` : ''}${d.reason ? ` — ${d.reason}` : ''}
    ${d.draft_id ? html` · <a href="#/draft/${d.draft_id}">open draft #${d.draft_id} →</a>` : ''}</div>`;
  return html`<pre class="code">${JSON.stringify(d, null, 2)}</pre>`;
}

export async function render(view, { params = [] } = {}) {
  const [runs, st, fb, sources] = await Promise.all([api.get('/runs'), api.get('/status'), api.get('/feedback'), api.get('/sources').catch(() => [])]);
  const selId = Number(params[0]) || runs[0]?.id;
  const run = selId ? await api.get(`/runs/${selId}`).catch(() => null) : null;
  const el = document.createElement('div');
  view.replaceChildren(el);
  const p = st.provider;
  const spendPct = p.budget_usd ? Math.min(100, Math.round(p.month_spend_usd / p.budget_usd * 100)) : 100;
  const srcName = Object.fromEntries(sources.map(s => [s.id, s.name]));
  const prefs = fb.preferences;
  const failedStage = run?.stages?.find(s => s.status === 'failed')?.stage;
  const go = (id) => { const h = `#/runs/${id}`; if (location.hash === h) render(view, { params: [String(id)] }); else location.hash = h; };

  el.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker">Daily workflow</div>
      <h1>Runs & costs</h1>
      <p class="lede">Each run moves through collect → cluster → rank → brief → draft. Runs are idempotent per date: articles are unique by URL, the brief is replaced for its date, and the date’s automatic draft is reused — so retrying or rerunning never creates duplicate drafts.</p>
    </div>
    <form class="row" data-form="run">
      <label class="field">Date<input type="date" name="date" value="${st.today}"></label>
      <label class="field">Start at<select name="from_stage">${STAGES.map(s => html`<option value="${s}">${s}</option>`)}</select></label>
      <button class="primary" type="submit" style="align-self:flex-end">Run now</button>
    </form>
  </div>

  <div class="split">
    <div class="stack reveal">
      <section class="card ledger">
        <h3>Run history</h3>
        ${runs.length ? html`<div class="ctl-scroll"><table style="min-width:560px">
          <thead><tr><th>#</th><th>Date</th><th>Trigger</th><th>Status</th><th>Started</th><th>Duration</th><th>Cost</th></tr></thead>
          <tbody>${runs.map(r => html`<tr class="click" data-run="${r.id}" style="${r.id === selId ? 'background:var(--panel-2)' : ''}">
            <td class="mono">${r.id}</td><td class="mono">${r.run_date}</td><td>${r.trigger}</td>
            <td>${runChip(r.status)}${r.error ? html`<div class="ctl-err" style="max-width:260px">${r.error}</div>` : ''}</td>
            <td class="small" title="${fmtDateTime(r.started_at)}">${timeAgo(r.started_at)}</td>
            <td class="mono">${dur(r.started_at, r.finished_at)}</td><td class="mono">${usd(r.cost_usd)}</td></tr>`)}</tbody>
        </table></div>` : html`<div class="empty">No runs yet. Use “Run now”, or enable the daily schedule in Settings.</div>`}
      </section>

      ${run ? html`<section class="card">
        <div class="row between">
          <h3>Run #${run.id} · ${run.run_date}</h3>
          <span class="row">${runChip(run.status)}<span class="mono faint">${run.trigger} · ${fmtDateTime(run.started_at)} · ${dur(run.started_at, run.finished_at)}</span></span>
        </div>
        ${run.error ? html`<div class="flag blocking" style="margin-bottom:12px"><strong>Failed:</strong> ${run.error}</div>` : ''}
        <div>${(run.stages || []).map((s, i, arr) => {
          const attempt = arr.slice(0, i + 1).filter(x => x.stage === s.stage).length;
          return html`<div class="stage ${s.status}">
            <div class="row between"><span class="row"><span class="stage-name">${s.stage}</span>${attempt > 1 ? html`<span class="chip">attempt ${attempt}</span>` : ''}${runChip(s.status)}</span>
              <span class="mono faint">${fmtDateTime(s.started_at)} · ${dur(s.started_at, s.finished_at)}</span></div>
            ${s.error ? html`<div class="ctl-err" style="margin-top:6px">${s.error}</div>` : ''}
            <div style="margin-top:6px">${stageSummary(s.stage, s.detail)}</div>
          </div>`;
        })}${!run.stages?.length ? html`<p class="muted small">No stage records.</p>` : ''}</div>
        <div class="hr"></div>
        <div class="row">
          ${run.status === 'failed' ? html`<button class="amber" data-act="retry" data-id="${run.id}">Retry from failed stage${failedStage ? ` (${failedStage})` : ''}</button>` : ''}
          <select data-from style="width:auto">${STAGES.map(s => html`<option value="${s}" ${s === failedStage ? 'selected' : ''}>${s}</option>`)}</select>
          <button data-act="rerun" data-id="${run.id}">Rerun from stage</button>
        </div>
        <p class="set-note">Retrying resumes this run (same date) from the chosen stage and reruns everything after it. Collected articles, the brief and the date’s draft are updated in place, never duplicated.</p>
        ${run.usage?.length ? html`<div class="hr"></div><h3>AI usage in this run</h3><div class="ctl-scroll"><table>
          <thead><tr><th>Operation</th><th>Provider</th><th>Input tokens</th><th>Output tokens</th><th>Cost</th></tr></thead>
          <tbody>${run.usage.map(u => html`<tr><td>${u.operation}</td><td>${u.provider}</td><td class="mono">${u.input_tokens ?? '—'}</td><td class="mono">${u.output_tokens ?? '—'}</td><td class="mono">${usd(u.cost_usd)}</td></tr>`)}</tbody>
        </table></div>` : html`<p class="muted small" style="margin-top:12px">No paid AI calls in this run${p.active === 'local' ? ' (the local drafting engine is free)' : ''}.</p>`}
      </section>` : ''}
    </div>

    <div class="stack reveal">
      <section class="card">
        <h3>Cost controls</h3>
        <div class="row" style="margin-bottom:10px"><span class="dot ${p.active === 'claude' ? 'ok' : 'warn'}"></span>
          <span>${p.active === 'claude' ? `Claude · ${p.model}` : 'Local drafting engine (no API cost)'}</span></div>
        <dl class="ctl-kv">
          <dt>API key</dt><dd>${p.has_key ? 'ANTHROPIC_API_KEY detected' : 'not set (server environment variable)'}</dd>
          <dt>This month</dt><dd>${usd(p.month_spend_usd)} of ${usd(p.budget_usd)} limit</dd>
        </dl>
        <div class="ctl-bar ${p.over_budget ? 'red' : spendPct > 75 ? 'amber' : ''}" style="margin-top:10px"><i><b style="width:${spendPct}%"></b></i><span>${spendPct}%</span></div>
        ${p.over_budget ? html`<p class="ctl-err" style="margin:8px 0 0">Monthly limit reached — Byline has switched to the local engine until next month or until you raise the limit.</p>` : ''}
        <p class="set-note">Repeated fetches within 6 hours reuse cached results; story summaries and career lenses are cached per story. <a href="#/settings">Change the spending limit →</a></p>
      </section>

      <section class="card">
        <div class="row between"><h3>Feedback effect</h3>${prefs.count ? html`<button class="sm danger" data-act="reset-fb">Reset feedback</button>` : ''}</div>
        <p class="muted small" style="margin-top:0">Your “useful / repetitive / low-quality / off-topic” marks adjust ranking: useful +12%, repetitive −8%, low-quality −12% (also lowers the source), off-topic −15% per mark, capped at ±60%.</p>
        ${Object.keys(prefs.topic).length ? html`<div class="small mono faint" style="margin:8px 0 4px">TOPICS</div>${Object.entries(prefs.topic).sort((a, b) => b[1] - a[1]).map(([t, v]) => html`<div class="row between small" style="padding:3px 0"><span>${t}</span><span class="mono ${v >= 0 ? 'ctl-ok' : 'ctl-err'}">${signed(v)}</span></div>`)}` : ''}
        ${Object.keys(prefs.source).length ? html`<div class="small mono faint" style="margin:10px 0 4px">SOURCES</div>${Object.entries(prefs.source).map(([s, v]) => html`<div class="row between small" style="padding:3px 0"><span>${srcName[s] || `Source #${s}`}</span><span class="mono ctl-err">${signed(v)}</span></div>`)}` : ''}
        ${!prefs.count ? html`<p class="muted small">No feedback yet. Mark stories in the Feed to tune ranking.</p>` : ''}
        ${fb.items.length ? html`<div class="hr"></div><div class="small mono faint" style="margin-bottom:4px">RECENT (${prefs.count})</div>
          ${fb.items.slice(0, 12).map(f => html`<div class="row between small" style="padding:4px 0;border-top:1px solid var(--line)">
            <a href="#/story/${f.story_id}" style="color:var(--text);max-width:65%">${f.title || `Story #${f.story_id}`}</a>
            <span class="row"><span class="chip ${f.kind === 'useful' ? 'green' : 'red'}">${FB_LABEL[f.kind] || f.kind}</span><span class="faint mono">${timeAgo(f.created_at)}</span></span></div>`)}` : ''}
      </section>
    </div>
  </div>`);

  on(el, 'click', '[data-run]', (e, tr) => go(tr.dataset.run));
  on(el, 'submit', '[data-form="run"]', async (e, f) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    await act(f.querySelector('button'), async () => {
      const r = await api.post('/runs', { date: d.date || undefined, from_stage: d.from_stage === 'collect' ? undefined : d.from_stage });
      toast(r.status === 'done' ? `Run #${r.run_id} finished` : `Run #${r.run_id} failed at ${r.failed_stage}: ${r.error}`, r.status === 'done' ? 'ok' : 'err');
      go(r.run_id);
    }, 'Running…');
  });
  on(el, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'retry' || a === 'rerun') await act(btn, async () => {
      const body = a === 'rerun' ? { from_stage: el.querySelector('[data-from]').value } : {};
      const r = await api.post(`/runs/${btn.dataset.id}/retry`, body);
      toast(r.status === 'done' ? 'Run completed' : `Still failing at ${r.failed_stage}: ${r.error}`, r.status === 'done' ? 'ok' : 'err');
      go(r.run_id);
    }, 'Running…');
    if (a === 'reset-fb' && await confirmBox('Reset all feedback? Ranking returns to your priorities and watchlists only.', 'Reset feedback')) await act(btn, async () => {
      await api.del('/feedback'); toast('Feedback reset', 'ok'); render(view, { params });
    });
  });
}
