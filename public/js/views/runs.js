// Runs (restyled to v4). F §2 Runs headline, honest about failures and "found nothing new". The run
// history is a table with per-stage status marks (ui.statusMark); the selected run (#/runs/:id, default
// the latest) shows its stage timeline, failures, retry / rerun and AI usage. Run now goes through the
// existing POST /api/runs with app.stagedRun for progress in the status pill. Cost controls and the
// feedback effect (with reset) are kept from v3.
import { api } from '../api.js';
import { html, raw, on, act, toast, confirmBox, timeAgo, useStyle, statusMark, icon } from '../ui.js';
import { stagedRun } from '../app.js';
// (history rows land below the fold after the swap, so they are appended without entrance motion)

const STAGES = ['collect', 'cluster', 'rank', 'brief', 'draft'];
const STAGE_LABEL = { collect: 'Collect', cluster: 'Cluster', rank: 'Rank', brief: 'Brief', draft: 'Draft' };
const FB_LABEL = { useful: 'Useful', repetitive: 'Repetitive', low_quality: 'Low quality', off_topic: 'Off-topic' };
// 2 decimals everywhere (SS2); a real but sub-cent cost reads "<$0.01" instead of a misleading $0.00
const usd = (v) => { const n = Number(v) || 0; return n > 0 && n < 0.005 ? '<$0.01' : '$' + n.toFixed(2); };
const signed = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dur = (a, b) => {
  if (!a || !b) return '—';
  const ms = Date.parse(b) - Date.parse(a);
  return ms < 1000 ? `${ms} ms` : ms < 60e3 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60e3)}m ${Math.round((ms % 60e3) / 1000)}s`;
};
const tfmt = (iso, tz) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }) : '';
const dfmt = (iso, tz) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(tz ? { timeZone: tz } : {}) }) : '';
// RU-1: the app's date style is "Thu 2 Jan 2020" (en-GB adds a comma after the weekday when a year is shown)
const dayLabel = (d) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(d.slice(0, 4) !== String(new Date().getFullYear()) ? { year: 'numeric' } : {}) }).replace(',', '') : '';

/**
 * Run `fn` once the page holding `el` has been swapped in (byline:routed) and the main thread is idle, so
 * below-the-fold markup stays out of the tab-change frames (E1). Re-renders of a page already on screen
 * run it on the next idle period.
 */
function afterEnter(view, el, fn) {
  let done = false;
  const run = () => { if (done) return; done = true; document.removeEventListener('byline:routed', onRouted); if (el.isConnected) fn(); };
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(run, { timeout: 500 }) : setTimeout(run, 60));
  const onRouted = (e) => { if (e.detail?.page?.contains(el)) { document.removeEventListener('byline:routed', onRouted); requestAnimationFrame(() => setTimeout(idle, 0)); } };
  if (view.closest?.('.page.current') || view.classList?.contains('current')) { idle(); return; }
  document.addEventListener('byline:routed', onRouted);
  setTimeout(run, 2500);
}

const idleSlice = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 300 }) : setTimeout(fn, 16));

/** What a run did, from its stored stats (the list endpoint has no stage rows). */
function facts(r) {
  const st = r.stats || {};
  const c = st.collect;
  const failedStage = r.status === 'failed' ? (/^(\w+):/.exec(r.error || '')?.[1] || null) : null;
  const stages = STAGES.map((k) => {
    if (failedStage === k) return 'error';
    if (st[k]) return 'done';
    if (r.status === 'running') return 'running';
    return 'pending';
  });
  if (r.status === 'running') { const i = stages.indexOf('running'); stages.forEach((s, j) => { if (s === 'running' && j !== i) stages[j] = 'pending'; }); }
  // U1: a finished run whose collect stage read 0 sources did nothing new; it must not look like a full success
  const empty = r.status === 'done' && c != null && !c.sources;
  // a run whose every polled source failed collected nothing either: same amber, its own words
  const allFailed = !empty && r.status === 'done' && c != null && c.sources > 0 && (c.failed?.length || 0) >= c.sources;
  return { empty, allFailed, sources: c?.sources ?? null, collected: c?.collected ?? null, fresh: c?.new ?? null, failed: c?.failed?.length ?? null, skipped: c?.skipped?.length ?? null, ranked: st.rank?.ranked ?? null, items: st.brief?.items ?? null, failedStage, stages };
}

/** F §2 Runs headline + one-liner. */
function headline(runs, S) {
  if (!runs.length) return { h: 'No runs yet.', l: html`Use Run now, or turn on the daily schedule in <a href="#/settings">Settings</a>.${S.allPaused ? html` All <b>${S.sourceCount}</b> sources are paused.` : ''}` };
  const tz = S.tz, last = runs[0], f = facts(last);
  const week = runs.filter(r => Date.now() - Date.parse(r.started_at) < 7 * 864e5);
  const failed = week.filter(r => r.status === 'failed').length;
  const h = last.status === 'failed' ? `The last run failed at ${f.failedStage || 'a stage'}.`
    : last.status === 'running' ? 'A run is in progress.'
    : !f.fresh ? 'The last run found nothing new.'
    : `The last run added ${plural(f.fresh, 'article')}.`;
  const withRes = runs.find(r => (facts(r).fresh || 0) > 0);
  const wf = withRes ? facts(withRes) : null;
  const l = html`<b>${week.length}</b> ${week.length === 1 ? 'run' : 'runs'} this week, <b>${failed}</b> failed. Last (${tfmt(last.started_at, tz)}, ${dfmt(last.started_at, tz)}): ${f.sources != null ? html`<b>${f.sources}</b> sources, <b>${f.fresh}</b> new, ` : 'no collect stage, '}${f.ranked != null ? html`<b>${f.ranked}</b> ranked, ` : ''}${usd(last.cost_usd)}.${withRes && withRes !== last ? html` Last with results: ${tfmt(withRes.started_at, tz)}${dfmt(withRes.started_at, tz) !== dfmt(last.started_at, tz) ? `, ${dfmt(withRes.started_at, tz)}` : ''}, <b>${wf.fresh}</b> articles from ${wf.sources} sources${wf.failed ? html`, <b>${wf.failed}</b> ${wf.failed === 1 ? 'source' : 'sources'} failed` : ''}.` : ''}${!withRes ? ' No run has collected new articles yet.' : ''}`;
  return { h, l };
}

function stageSummary(stage, d) {
  if (!d) return '';
  if (stage === 'collect') return html`
    <p class="rn-sum">${plural(d.sources, 'source')} polled · ${d.collected} items collected · <b>${d.new}</b> new · ${d.duplicates} duplicates · ${d.cached} served from cache</p>
    ${d.failed?.length ? html`<details class="rn-fails" ${d.failed.length <= 4 ? raw('open') : ''}><summary><span class="rn-err-t">${plural(d.failed.length, 'source')} failed</span></summary>
      <ul>${d.failed.map(f => html`<li><b>${f.source}</b><span class="rn-err-t">${f.error}</span></li>`)}</ul></details>` : ''}
    ${d.skipped?.length ? html`<details class="rn-fails"><summary>${d.skipped.length} skipped</summary>
      <ul>${d.skipped.map(f => html`<li><b>${f.source}</b><span>${f.reason}</span></li>`)}</ul></details>` : ''}`;
  if (stage === 'cluster') return html`<p class="rn-sum">${plural(d.articles, 'unclustered article')} · <b>${d.new_stories}</b> new ${d.new_stories === 1 ? 'story' : 'stories'} · ${d.merged} merged into existing stories</p>`;
  if (stage === 'rank') return html`<p class="rn-sum"><b>${d.ranked}</b> stories re-ranked</p>`;
  if (stage === 'brief') return html`<p class="rn-sum"><b>${d.items}</b> brief ${d.items === 1 ? 'item' : 'items'}${d.quiet ? ' · quiet day (nothing met the publishing threshold)' : ''}</p>`;
  if (stage === 'draft') return html`<p class="rn-sum">${d.created ? 'Draft created' : d.draft_id ? 'Existing draft reused' : 'No draft'}${d.format ? ` (${d.format})` : ''}${d.reason ? ` · ${d.reason}` : ''}${d.draft_id ? html` · <a href="#/draft/${d.draft_id}">open draft #${d.draft_id}</a>` : ''}</p>`;
  return html`<pre class="rn-code">${JSON.stringify(d, null, 2)}</pre>`;
}

const STATUS_WORD = { done: 'Done', failed: 'Failed', running: 'Running' };
/** Run status tag: a run that read 0 sources says so ("Done · 0 sources read", amber), never a plain green "Done". */
function statusTag(run) {
  const collect = run.stats?.collect ?? run.stages?.find(x => x.stage === 'collect' && x.status === 'done')?.detail;
  if (run.status === 'done' && collect && !collect.sources) return html`<span class="tag tag--warn">Done · 0 sources read</span>`;
  if (run.status === 'done' && collect && collect.sources > 0 && (collect.failed?.length || 0) >= collect.sources) return html`<span class="tag tag--warn">Done · ${collect.sources === 1 ? 'its 1 source' : `all ${collect.sources} sources`} failed</span>`;
  return html`<span class="tag ${run.status === 'done' ? 'tag--ok' : run.status === 'failed' ? 'tag--err' : 'tag--warn'}">${STATUS_WORD[run.status] || run.status}</span>`;
}

function detailHtml(run, S) {
  if (!run) return html`<div class="empty"><h3>No run selected.</h3><p>Pick a run from the history below.</p></div>`;
  const tz = S.tz;
  const failedStage = run.stages?.find(s => s.status === 'failed')?.stage;
  return html`<section class="tile tile--static rn-detail" aria-labelledby="rn-detail-h">
    <header class="rn-dhead">
      <div>
        <p class="eyebrow">${run.id === S.runs[0]?.id ? 'Latest run' : 'Selected run'}</p>
        <h2 class="t-h2" id="rn-detail-h">Run #${run.id} · ${dayLabel(run.run_date)}</h2>
        <p class="rn-dmeta">${statusTag(run)}<span>${run.trigger}</span><span>started ${tfmt(run.started_at, tz)}, ${dfmt(run.started_at, tz)}</span><span>${dur(run.started_at, run.finished_at)}</span><span>${usd(run.cost_usd)}</span></p>
      </div>
    </header>
    ${run.error ? html`<div class="rn-flag" role="note"><b>Failed:</b> ${run.error}</div>` : ''}
    <ol class="rn-timeline">${(run.stages || []).map((s, i, arr) => {
      const attempt = arr.slice(0, i + 1).filter(x => x.stage === s.stage).length;
      const empty = s.stage === 'collect' && s.status === 'done' && s.detail && (!s.detail.sources || (s.detail.failed?.length || 0) >= s.detail.sources);
      return html`<li class="rn-stage" data-status="${s.status}">
        <span class="rn-mark${empty ? ' rn-mark--empty' : ''}" data-mark="${s.status}" ${empty ? raw(`data-empty title="${s.detail.sources ? 'Done, but every source failed' : 'Done, but read 0 sources'}"`) : ''}></span>
        <div class="rn-stage-b">
          <div class="rn-stage-h"><span class="rn-stage-n">${STAGE_LABEL[s.stage] || s.stage}</span>${attempt > 1 ? html`<span class="tag tag--neutral">attempt ${attempt}</span>` : ''}<span class="rn-stage-t">${dur(s.started_at, s.finished_at)}</span></div>
          ${s.error ? html`<p class="rn-err-t">${s.error}</p>` : ''}
          ${stageSummary(s.stage, s.detail)}
        </div>
      </li>`;
    })}</ol>
    ${!run.stages?.length ? html`<p class="rn-sum">No stage records.</p>` : ''}
    <div class="rn-retry">
      ${run.status === 'failed' ? html`<button type="button" class="btn btn--primary btn--sm" data-act="retry" data-id="${run.id}">Retry from failed stage${failedStage ? ` (${failedStage})` : ''}</button>` : ''}
      <label class="rn-inline"><span>Rerun from</span><select class="select" data-from aria-label="Stage to rerun from">${STAGES.map(s => html`<option value="${s}"${s === failedStage ? raw(' selected') : ''}>${STAGE_LABEL[s]}</option>`)}</select></label>
      <button type="button" class="btn btn--secondary btn--sm" data-act="rerun" data-id="${run.id}">Rerun</button>
    </div>
    <p class="rn-note">Retrying resumes this run (same date) from the chosen stage and reruns everything after it. Articles, the brief and the date’s draft are updated in place, never duplicated.</p>
    <div class="rn-usage">
      <h3 class="section-label">AI usage in this run</h3>
      ${run.usage?.length ? html`<table class="table compact rn-utable"><thead><tr><th>Operation</th><th>Provider</th><th class="num">Input</th><th class="num">Output</th><th class="num">Cost</th></tr></thead>
        <tbody>${run.usage.map(u => html`<tr><td>${u.operation}</td><td>${u.provider}</td><td class="num">${u.input_tokens ?? '—'}</td><td class="num">${u.output_tokens ?? '—'}</td><td class="num">${usd(u.cost_usd)}</td></tr>`)}</tbody></table>`
        : html`<p class="rn-sum">No paid AI calls${S.provider.active === 'local' ? ' (the local drafting engine is free)' : ''}.</p>`}
    </div>
  </section>`;
}

const FIRST_RUNS = 0; // the history sits below the fold on every viewport: its rows (and their status marks) are built after the swap (E1)
function runRow(r, S) {
  const tz = S.tz, f0 = facts(r), f = { ...f0, empty: f0.empty || f0.allFailed };
  const emptyWord = f0.allFailed ? `Done · ${f0.sources === 1 ? 'its 1 source' : `all ${f0.sources} sources`} failed` : 'Done · 0 sources read';
  return html`<tr class="rn-row${r.id === S.selId ? ' is-selected' : ''}" data-run="${r.id}" data-row>
          <td class="rn-c-st"><span class="rn-mark${f.empty ? ' rn-mark--empty' : ''}" data-mark="${r.status}" ${f.empty ? raw(`data-empty title="${emptyWord}"`) : ''}></span></td>
          <td><a class="rn-link" href="#/runs/${r.id}" aria-current="${r.id === S.selId ? 'true' : 'false'}">#${r.id}<span>${dayLabel(r.run_date)}</span></a>${r.error ? html`<span class="rn-row-err">${r.error}</span>` : f.empty ? html`<span class="rn-row-empty">${emptyWord}</span>` : ''}</td>
          <td class="rn-c-tr">${r.trigger}</td>
          <td><span class="rn-strip" role="img" aria-label="${STAGES.map((s, i) => `${STAGE_LABEL[s]} ${i === 0 && f.empty ? (f0.allFailed ? 'done, every source failed' : 'done, 0 sources read') : f.stages[i] === 'done' ? 'done' : f.stages[i] === 'error' ? 'failed' : f.stages[i] === 'running' ? 'running' : 'not run'}`).join(', ')}">${STAGES.map((s, i) => html`<span class="rn-mark rn-mark--sm${i === 0 && f.empty ? ' rn-mark--empty' : ''}" data-mark="${f.stages[i]}" ${i === 0 && f.empty ? raw('data-empty') : ''} title="${STAGE_LABEL[s]}${i === 0 && f.empty ? (f0.allFailed ? ': every source failed' : ': read 0 sources') : ''}"></span>`)}</span></td>
          <td class="num">${f.sources ?? '—'}</td>
          <td class="num${f.fresh ? ' rn-pos' : ''}">${f.fresh ?? '—'}</td>
          <td class="num${f.failed ? ' rn-neg' : ''}">${f.failed ?? '—'}</td>
          <td class="num">${f.ranked ?? '—'}</td>
          <td class="rn-c-time"><time datetime="${r.started_at}">${tfmt(r.started_at, tz)}</time><span>${timeAgo(r.started_at)}</span></td>
          <td class="num">${dur(r.started_at, r.finished_at)}</td>
          <td class="num">${usd(r.cost_usd)}</td>
        </tr>`;
}
/**
 * SS10: consecutive runs with the same outcome (status, sources read, new, failed, error) collapse into one
 * expandable row: "#11–#16 · 6 runs". Ranked counts may differ inside a group; the member rows keep them.
 */
const outcomeKey = (r) => { const f = facts(r); return [r.status, f.empty, f.allFailed, f.sources, f.fresh, f.failed, f.failedStage, r.error || ''].join('|'); };
function groupRuns(runs) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1], k = outcomeKey(r);
    if (last && last.key === k) last.runs.push(r); else out.push({ key: k, runs: [r] });
  }
  return out;
}
/** "18 Nov 6:25–6:28 PM" (one day), or "17 Nov 6:25 PM – 18 Nov 9:02 AM" across days; newest-first list in. */
function spanLabel(rs, tz) {
  const a = rs[rs.length - 1].started_at, b = rs[0].started_at;
  const da = dfmt(a, tz), db = dfmt(b, tz), ta = tfmt(a, tz), tb = tfmt(b, tz);
  if (da !== db) return `${da} ${ta} – ${db} ${tb}`;
  if (ta === tb) return `${da} ${ta}`;
  const sa = ta.slice(-2), sb = tb.slice(-2);
  return `${da} ${sa === sb ? ta.slice(0, -3) : ta}–${tb}`;
}
function groupRow(g, gi, S) {
  const rs = g.runs, top = rs[0], old = rs[rs.length - 1], tz = S.tz, f0 = facts(top), f = { ...f0, empty: f0.empty || f0.allFailed };
  const open = S.openGroups.has(gi);
  const word = f0.allFailed ? `Done · ${f0.sources === 1 ? 'its 1 source' : `all ${f0.sources} sources`} failed` : f0.empty ? 'Done · 0 sources read' : top.status === 'failed' ? `Failed${f0.failedStage ? ` at ${f0.failedStage}` : ''}` : STATUS_WORD[top.status] || top.status;
  const ranked = rs.map(r => facts(r).ranked).filter(v => v != null);
  const rLo = Math.min(...ranked), rHi = Math.max(...ranked);
  const trig = [...new Set(rs.map(r => r.trigger))].join(', ');
  const cost = rs.reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);
  return html`<tr class="rn-row rn-grow${open ? ' is-open' : ''}" data-rn-g="${gi}">
    <td class="rn-c-st"><span class="rn-mark${f.empty ? ' rn-mark--empty' : ''}" data-mark="${top.status}" ${f.empty ? raw(`data-empty title="${word}"`) : ''}></span></td>
    <td><button type="button" class="rn-gbtn" data-rn-group="${gi}" aria-expanded="${open}">${icon('chevron-right')}<span class="rn-gid">#${old.id}–#${top.id}</span><span class="rn-gn">${rs.length} runs</span></button><span class="${top.error ? 'rn-row-err' : f.empty ? 'rn-row-empty' : 'rn-row-sub'}">${top.error || word}</span></td>
    <td class="rn-c-tr">${trig}</td>
    <td><span class="rn-strip" role="img" aria-label="Same stage outcome in all ${rs.length} runs">${STAGES.map((st, i) => html`<span class="rn-mark rn-mark--sm${i === 0 && f.empty ? ' rn-mark--empty' : ''}" data-mark="${f.stages[i]}" ${i === 0 && f.empty ? raw('data-empty') : ''} title="${STAGE_LABEL[st]}"></span>`)}</span></td>
    <td class="num">${f.sources ?? '—'}</td>
    <td class="num${f.fresh ? ' rn-pos' : ''}">${f.fresh ?? '—'}</td>
    <td class="num${f.failed ? ' rn-neg' : ''}">${f.failed ?? '—'}</td>
    <td class="num">${ranked.length ? (rLo === rHi ? rLo : `${rLo}–${rHi}`) : '—'}</td>
    <td class="rn-c-time rn-c-span"><span class="rn-span">${spanLabel(rs, tz)}</span><span>${timeAgo(top.started_at)}</span></td>
    <td class="num">—</td>
    <td class="num">${usd(cost)}</td>
  </tr>`;
}
/** History rows for one item: a single run, or a group row followed by its (hidden unless open) member rows. */
function itemRows(g, gi, S) {
  if (g.runs.length < 2) return String(runRow(g.runs[0], S));
  const open = S.openGroups.has(gi);
  return String(groupRow(g, gi, S)) + g.runs.map(r => String(runRow(r, S)).replace('<tr class="rn-row', `<tr${open ? '' : ' hidden'} data-in-g="${gi}" class="rn-row rn-member`)).join('');
}
const markAll = (root) => root.querySelectorAll('.rn-mark[data-mark]').forEach(m => { const sm = statusMark(m, m.dataset.mark); if (m.hasAttribute('data-empty')) sm?.setAttribute('aria-label', m.title?.includes('failed') ? 'Done, every source failed' : 'Done, 0 sources read'); });

function historyHtml(S) {
  const tz = S.tz;
  return html`<section class="rn-history" aria-labelledby="rn-hist-h">
    <div class="section-head"><h2 class="t-h2" id="rn-hist-h">Run history</h2><span class="section-meta">${plural(S.runs.length, 'run')} · newest first${S.groups.length < S.runs.length ? ' · repeats grouped' : ''}</span></div>
    ${S.runs.length ? html`<div class="tile tile--flush tile--static rn-table-tile"><table class="table rn-table">
      <caption class="sr-only">Runs, newest first. Select a row to see its stages.</caption>
      <thead><tr><th class="rn-c-st"><span class="sr-only">Status</span></th><th>Run</th><th>Trigger</th><th>Stages</th><th class="num">Read</th><th class="num">New</th><th class="num">Failed</th><th class="num">Ranked</th><th>Started</th><th class="num">Time</th><th class="num">Cost</th></tr></thead>
      <tbody data-rn-rows>${raw(S.groups.slice(0, S.rows ?? FIRST_RUNS).map((g, gi) => itemRows(g, gi, S)).join(''))}</tbody></table></div>` : html`<div class="empty"><h3>No runs yet.</h3><p>Use Run now, or enable the daily schedule in Settings.</p></div>`}
  </section>`;
}

function asideHtml(S) {
  const p = S.provider, prefs = S.fb.preferences;
  const spendPct = p.budget_usd ? Math.min(100, Math.round(p.month_spend_usd / p.budget_usd * 100)) : 0;
  return html`
  <section class="tile tile--static rn-card" aria-labelledby="rn-cost-h">
    <h2 class="section-label" id="rn-cost-h">Cost controls</h2>
    <p class="rn-engine"><span class="dot ${p.active === 'claude' ? 'ok' : 'warn'}"></span>${p.active === 'claude' ? `Claude · ${p.model}` : p.active === 'ollama' ? 'Ollama (local, free)' : 'Local drafting engine (no API cost)'}</p>
    <div class="rn-spend"><span class="rn-spend-v">${usd(p.month_spend_usd)}</span><span class="rn-spend-l">${p.budget_usd ? `this month of a ${usd(p.budget_usd)} limit` : 'this month · $0 limit (paid AI off)'}</span></div>
    <div class="meter" role="img" aria-label="${p.budget_usd ? `${spendPct}% of the monthly limit` : 'No spending limit set'}"><i style="--v:${(spendPct / 100).toFixed(3)}"></i></div>
    <dl class="kv rn-kv"><dt>API key</dt><dd>${p.has_key ? 'ANTHROPIC_API_KEY detected' : 'not set (server environment variable)'}</dd></dl>
    ${p.over_budget && p.budget_usd ? html`<p class="rn-err-t">Monthly limit reached: Byline uses the local engine until next month or until you raise the limit.</p>` : ''}
    <p class="rn-note">Repeated fetches within 6 hours reuse cached results; story summaries and career lenses are cached per story. <a href="#/settings">Change the spending limit</a></p>
  </section>
  <section class="tile tile--static rn-card" aria-labelledby="rn-fb-h">
    <div class="rn-card-head"><h2 class="section-label" id="rn-fb-h">Feedback effect</h2>${prefs.count ? html`<button type="button" class="btn btn--ghost btn--sm btn--danger" data-act="reset-fb">Reset</button>` : ''}</div>
    <p class="rn-note">Your marks adjust ranking: useful +12%, repetitive −8%, low quality −12% (also lowers the source), off-topic −15% per mark, capped at ±60%.</p>
    ${Object.keys(prefs.topic).length ? html`<p class="rn-fb-g">Topics</p>${Object.entries(prefs.topic).sort((a, b) => b[1] - a[1]).map(([t, v]) => html`<div class="rn-fb-row"><span>${t}</span><span class="${v >= 0 ? 'rn-pos' : 'rn-neg'}">${signed(v)}</span></div>`)}` : ''}
    ${Object.keys(prefs.source).length ? html`<p class="rn-fb-g">Sources</p>${Object.entries(prefs.source).map(([s, v]) => html`<div class="rn-fb-row"><span>${S.srcName[s] || `Source #${s}`}</span><span class="rn-neg">${signed(v)}</span></div>`)}` : ''}
    ${!prefs.count ? html`<p class="rn-sum">No feedback yet. Mark stories in the Feed to tune ranking.</p>` : ''}
    ${S.fb.items.length ? html`<p class="rn-fb-g">Recent · ${prefs.count}</p>${S.fb.items.slice(0, 12).map(f => html`<div class="rn-fb-row"><a href="#/story/${f.story_id}">${f.title || 'Untitled story'}</a><span class="rn-fb-k"><span class="tag ${f.kind === 'useful' ? 'tag--ok' : 'tag--err'}">${FB_LABEL[f.kind] || f.kind}</span>${timeAgo(f.created_at)}</span></div>`)}` : ''}
  </section>`;
}

export async function render(view, { params = [] } = {}) {
  await useStyle('/css/v4/runs.css');
  const [runs, st, fb, sources] = await Promise.all([api.get('/runs'), api.get('/status'), api.get('/feedback'), api.get('/sources').catch(() => [])]);
  const selId = Number(params[0]) || runs[0]?.id;
  const run = selId ? await api.get(`/runs/${selId}`).catch(() => null) : null;
  const S = {
    runs, run, selId, fb, provider: st.provider, tz: st.timezone,
    srcName: Object.fromEntries(sources.map(s => [s.id, s.name])),
    sourceCount: st.counts?.sources ?? sources.length,
    allPaused: !!(st.counts?.sources && st.counts.sources_paused >= st.counts.sources),
    scheduleOff: st.schedule?.enabled === false,
    groups: groupRuns(runs), openGroups: new Set()
  };
  // the selected run's group starts open, so its highlighted row is visible
  S.groups.forEach((g, gi) => { if (g.runs.length > 1 && g.runs.some(r => r.id === selId)) S.openGroups.add(gi); });
  const hd = headline(runs, S);
  const el = document.createElement('div');
  el.className = 'rn';
  view.replaceChildren(el);
  el.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow">Daily workflow · 5 stages</p>
    <h1>${hd.h}</h1>
    <p class="lede">${hd.l}</p>
    <form class="page-head-actions rn-runform" data-form="run" aria-label="Run the workflow">
      <div class="rn-inline rn-date"><span id="rn-date-l">Date</span><span class="rn-date-box"><button type="button" class="btn btn--secondary rn-date-btn" data-rn-date aria-describedby="rn-date-l" aria-label="Run date: ${dayLabel(st.today)}. Change the date">${icon('calendar')}<span data-rn-date-v>${dayLabel(st.today)}</span></button><input class="rn-date-in" type="date" name="date" value="${st.today}" tabindex="-1" aria-hidden="true"></span></div>
      <label class="rn-inline"><span>Start at</span><select class="select" name="from_stage">${STAGES.map(s => html`<option value="${s}">${STAGE_LABEL[s]}</option>`)}</select></label>
      <button class="btn btn--primary" type="submit">Run now</button>
    </form>
  </header>
  ${S.allPaused || S.scheduleOff ? html`<div class="rn-callout" role="note">${icon('alert')}<p>${S.allPaused ? html`<b>Runs read 0 sources: all ${S.sourceCount} are paused.</b> ` : ''}${S.scheduleOff ? html`The daily schedule is off, so runs happen only when you start one. ` : ''}</p><div class="cluster">${S.allPaused ? html`<a class="btn btn--secondary btn--sm" href="#/sources">Open Sources</a>` : ''}${S.scheduleOff ? html`<a class="btn btn--ghost btn--sm" href="#/settings">Schedule settings</a>` : ''}</div></div>` : ''}
  <div class="rn-top">
    <div class="rn-main">${detailHtml(run, S)}</div>
    <aside class="rn-aside cv" aria-label="Costs and feedback">${asideHtml(S)}</aside>
  </div>
  ${historyHtml(S)}`);

  markAll(el);
  afterEnter(view, el, () => {
    const body = el.querySelector('[data-rn-rows]');
    if (!body) return;
    let at = S.rows ?? FIRST_RUNS;
    const rest = S.groups.slice(at);
    // a few history items per idle slice, so no single task builds the whole history (E1 at 4×)
    const pump = (dl) => {
      if (!body.isConnected) return;
      do {
        const chunk = rest.splice(0, 3);
        if (!chunk.length) break;
        const tmp = document.createElement('tbody');
        tmp.innerHTML = chunk.map((g) => itemRows(g, at++, S)).join('');
        markAll(tmp);
        const rows = [...tmp.children];
        body.append(...rows);
      } while (rest.length && dl && dl.timeRemaining() > 8);
      if (rest.length) idleSlice(pump);
    };
    pump(null);
  });

  const go = (id) => { const h = `#/runs/${id}`; if (location.hash === h) render(view, { params: [String(id)] }); else location.hash = h; };
  on(el, 'click', 'tr[data-run]', (e, tr) => { if (e.target.closest('a')) return; go(tr.dataset.run); });
  // SS10: expand / collapse a group of repeated runs
  on(el, 'click', 'tr[data-rn-g]', (e, tr) => {
    const gi = Number(tr.dataset.rnG), open = !S.openGroups.has(gi);
    if (open) S.openGroups.add(gi); else S.openGroups.delete(gi);
    tr.classList.toggle('is-open', open);
    tr.querySelector('[data-rn-group]').setAttribute('aria-expanded', String(open));
    el.querySelectorAll(`tr[data-in-g="${gi}"]`).forEach(m => { m.hidden = !open; });
  });
  // RU-1: the run date shows "Fri 20 Nov" on a button; the native picker behind it holds the value the form sends
  on(el, 'click', '[data-rn-date]', (e, b) => {
    const i = b.parentElement.querySelector('.rn-date-in');
    try { i.showPicker(); } catch { i.focus(); i.click(); }
  });
  on(el, 'change', '.rn-date-in', (e, i) => {
    const b = i.parentElement.querySelector('[data-rn-date]'), v = i.value || st.today;
    if (!i.value) i.value = st.today;
    b.querySelector('[data-rn-date-v]').textContent = dayLabel(v);
    b.setAttribute('aria-label', `Run date: ${dayLabel(v)}. Change the date`);
  });
  on(el, 'submit', '[data-form="run"]', async (e, f) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    await act(f.querySelector('button[type=submit]'), async () => {
      const r = await stagedRun(api.post('/runs', { date: d.date || undefined, from_stage: d.from_stage === 'collect' ? undefined : d.from_stage }));
      toast(r.status === 'done' ? `Run #${r.run_id} finished` : `Run #${r.run_id} failed at ${r.failed_stage}: ${r.error}`, r.status === 'done' ? 'ok' : 'err');
      go(r.run_id);
    }, 'Running…');
  });
  on(el, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'retry' || a === 'rerun') await act(btn, async () => {
      const body = a === 'rerun' ? { from_stage: el.querySelector('[data-from]').value } : {};
      const r = await stagedRun(api.post(`/runs/${btn.dataset.id}/retry`, body));
      toast(r.status === 'done' ? 'Run completed' : `Still failing at ${r.failed_stage}: ${r.error}`, r.status === 'done' ? 'ok' : 'err');
      go(r.run_id);
    }, 'Running…');
    if (a === 'reset-fb' && await confirmBox('Reset all feedback? Ranking returns to your priorities and watchlists only.', 'Reset feedback')) await act(btn, async () => {
      await api.del('/feedback'); toast('Feedback reset', 'ok'); render(view, { params });
    });
  });
}
