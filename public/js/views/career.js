// Career (v4). F §2 Career: "{Skill} is rising in your sources." only when the radar has an earlier baseline to
// rise from (with no articles older than a week, "rising" would be trivially true), else "{Topic} showed up on
// {days} days this week." from /api/career/weekly, else "Not enough signal yet." The one-liner gives the top
// skill's mentions vs its weekly baseline and how many saved job posts mention it.
// Data hygiene (F amendment 6): identical job posts are grouped and counted once, demo posts carry a Demo tag,
// and a callout offers to remove the copies; the radar's job counts are divided by the copy factor when every
// post is copied the same number of times (otherwise the raw count is shown with a note). Skills that differ
// only by case ("evals" / "Evals") are merged.
// Kept from v3: skill radar with evidence modal, add / delete job descriptions, collections with interview
// talking points (labelled so nothing is presented as your own work), projects editor with drafts per channel,
// weekly recap (persisted trends, changed claims, ideas, shortlist with pursue / skip), experiences with the
// public-OK gate.
import { api } from '../api.js';
import { html, on, act, toast, modal, confirmBox, strikeOut, status, channelLabel, icon, useStyle, topicPills, threshold } from '../ui.js';
import { enterItems, reduced } from '../motion.js';
import { plural, isDemoText, stripDemo, demoTag, dayLabel } from './people.js';

const TABS = [['radar', 'Skill radar'], ['collections', 'Collections'], ['projects', 'Projects'], ['weekly', 'Weekly recap'], ['experiences', 'Experiences']];
const GROUPS = ['AI product management', 'Business analysis', 'Data analytics'];
const KINDS = ['experiment', 'teardown', 'case study', 'demo video', 'comparison', 'dashboard'];
const PSTATUS = ['idea', 'active', 'done'];
const state = { tab: 'radar', project: null, interview: {}, skipped: new Set() };
const TREND_TAG = { rising: 'tag--ok', steady: 'tag--neutral', cooling: 'tag--warn' };
const trendTag = (t, s) => s && s.source_mentions === 0 ? html`<span class="tag tag--neutral" title="Only job descriptions mention it">jobs only</span>`
  : s && s.recent > 0 && !(s.older_rate > 0) ? html`<span class="tag tag--neutral" title="No mentions in the three weeks before this one">new this week</span>`
  : html`<span class="tag ${TREND_TAG[t] || 'tag--neutral'}">${t}</span>`;
const pTag = (s) => html`<span class="tag ${s === 'active' ? 'tag--warn' : s === 'done' ? 'tag--ok' : 'tag--neutral'}">${s}</span>`;

export function labelChip(l = '') {
  const s = l.toLowerCase();
  const [cls, short] = s.startsWith('work you have done') ? ['tag--ok', 'Work you have done'] : s.startsWith('example') ? ['tag--neutral', 'Example, not your work']
    : s.startsWith('hypothesis') ? ['tag--warn', 'Hypothesis'] : s.startsWith('future') ? ['tag--neutral cr-tag-future', 'Future experiment, not yet done'] : ['tag--neutral', l];
  return html`<span class="tag ${cls}" title="${l}">${short}</span>`;
}

/** Identical job posts (same title, employer and opening text) grouped; `factor` when every group has the same size. */
function jobGroups(jobs) {
  const m = new Map();
  for (const j of jobs) { const k = `${j.title}|${j.employer}|${j.excerpt}`; if (!m.has(k)) m.set(k, []); m.get(k).push(j); }
  const groups = [...m.values()];
  const sizes = new Set(groups.map(g => g.length));
  return { groups, unique: groups.length, factor: sizes.size === 1 ? [...sizes][0] : null, copies: jobs.length - groups.length };
}
/** Merge skills that differ only by case silently (the radar tracks "evals" and a watchlist "Evals"), and fold
 *  word-form variants into their head term with a visible note (R20: "agentic" into "agents"). A folded variant's
 *  counts are not added: one article can use both words, so the note states its own count instead. */
const FOLD = { agentic: 'agents' };
function mergeSkills(skills) {
  const out = [], seen = new Map();
  for (const s of skills) {
    const k = s.skill.toLowerCase();
    if (seen.has(k)) { const c = seen.get(k); c.evidence = [...c.evidence, ...s.evidence.filter(e => !c.evidence.some(x => x.url === e.url && x.snippet === e.snippet))]; continue; }
    const c = { ...s, aliases: [] }; seen.set(k, c); out.push(c);
  }
  for (const [from, to] of Object.entries(FOLD)) {
    const a = seen.get(from), b = seen.get(to);
    if (!a || !b) continue;
    b.aliases.push({ skill: a.skill, n: a.source_mentions + a.job_mentions });
    b.evidence = [...b.evidence, ...a.evidence.filter(e => !b.evidence.some(x => x.url === e.url && x.snippet === e.snippet))];
    out.splice(out.indexOf(a), 1);
  }
  return out;
}
/** Sentence case for display (R20): an all-lower-case term gets a capital first letter; anything already carrying
 *  capitals (MCP, SQL, PRD, Bedrock, AI governance, Vertex AI) keeps its casing from the data. */
export const skillName = (t = '') => /[A-Z]/.test(t) ? t : t.charAt(0).toUpperCase() + t.slice(1);
const jobCount = (s, J) => J.factor && J.factor > 1 ? Math.round(s.job_mentions / J.factor) : s.job_mentions;

const weight = (s, J) => s.source_mentions + 2 * jobCount(s, J);   // job posts count double in the ranking
const noHistory = (skills) => !skills.some(s => s.older_rate > 0);

/** Headline and one-liner share one subject: the rising skill when there is a baseline to rise from, else the top
 *  skill by weighted mentions. Fallbacks: the most persistent weekly topic, then "Not enough signal yet." */
function headline({ skills, weekly, J, articles }) {
  const baseline = !noHistory(skills);
  const rising = baseline ? skills.filter(s => s.trend === 'rising' && s.recent >= 3).sort((a, b) => b.recent - a.recent)[0] : null;
  const top = [...skills].sort((a, b) => weight(b, J) - weight(a, J) || b.recent - a.recent)[0];
  const s = rising || (top && weight(top, J) > 0 ? top : null);
  const persisted = (weekly.persisted || []).filter(p => !/^machine learning$/i.test(p.topic));
  if (!s) {
    const h = persisted[0] ? `${persisted[0].topic} was a story topic on ${persisted[0].days} days this week.` : 'Not enough signal yet.';
    return { h, l: html`The radar uses the last 30 days of articles plus pasted job posts; you have <b>${articles}</b> ${articles === 1 ? 'article' : 'articles'} and <b>${J.unique}</b> ${J.unique === 1 ? 'job post' : 'job posts'}.` };
  }
  // F / R20: the skill in sentence case, keeping the data's casing for acronyms and names (AI, SEC, Bedrock).
  const q = skillName(s.skill);
  const h = rising && s.older_rate > 0 ? `${q} is rising in your sources.`
    : s.recent > 0 && s.skill.length > 26 ? `Your top skill this week is ${s.skill} (${plural(s.recent, 'mention')}).`
    : s.recent > 0 ? `${q} tops your skill radar: ${plural(s.recent, 'mention')} this week.`
    : `${q} tops your skill radar, from job posts alone.`;
  const saidMentions = !(rising && s.older_rate > 0) && s.recent > 0;   // K-3: the h1 already gives this week's count
  // One-liner (computed template; a clause is dropped when its data is missing):
  // "<Skill>: N source mentions this week and named in your J saved job post(s) (K copies counted once).
  //  <Topic> was a story topic on D days, but only the job post names it as a skill."
  const jm = jobCount(s, J);
  const copies = J.copies ? html` (${J.copies + J.unique} copies counted once)` : '';
  const mentions = s.recent > 0 ? html`<b>${s.recent}</b> source ${s.recent === 1 ? 'mention' : 'mentions'} this week${rising ? html` vs <b>${s.older_rate}</b>/week before` : ''}` : null;
  const named = !J.unique ? null
    : jm ? html`named in ${jm === J.unique ? html`your <b>${J.unique}</b>` : html`<b>${jm}</b> of your <b>${J.unique}</b>`} saved job ${J.unique === 1 ? 'post' : 'posts'}${copies}`
    : html`not named in your <b>${J.unique}</b> saved job ${J.unique === 1 ? 'post' : 'posts'}${copies}`;
  // K-3: when the h1 carries the mention count, the one-liner moves on to the job posts instead of repeating it.
  const posts = !J.unique ? null
    : jm === J.unique ? (J.unique === 1 ? html`Your saved job post names it too${copies}.` : html`All <b>${J.unique}</b> of your saved job posts name it${copies}.`)
    : jm ? html`<b>${jm}</b> of your <b>${J.unique}</b> saved job posts name it${copies}.`
    : html`None of your <b>${J.unique}</b> saved job ${J.unique === 1 ? 'post names' : 'posts name'} it${copies}.`;
  const first = saidMentions ? (posts || '') : mentions && named ? html`${q}: ${mentions} and ${named}.` : mentions ? html`${q}: ${mentions}.` : named ? html`${q}: ${named}.` : '';
  const t = persisted.find(p => p.topic.toLowerCase() !== s.skill.toLowerCase());
  const tSkill = t && skills.find(x => x.skill.toLowerCase() === t.topic.toLowerCase());
  const topic = !t ? '' : tSkill && tSkill.source_mentions === 0 && jobCount(tSkill, J) > 0
    ? html` ${t.topic} was a story topic on <b>${t.days}</b> days, but only ${J.unique === 1 ? 'the job post names' : 'job posts name'} it as a skill.`
    : html` ${t.topic} was a story topic on <b>${t.days}</b> days this week.`;
  return { h, l: html`${first}${topic}` };
}

export async function render(el, ctx = {}) {
  await useStyle('/css/v4/career.css');
  if (ctx.params?.[0] && TABS.some(([k]) => k === ctx.params[0])) state.tab = ctx.params[0];
  const [skillsRaw, weekly, jobs, projects, experiences, st] = await Promise.all([
    api.get('/career/radar'), api.get('/career/weekly'), api.get('/jobposts'), api.get('/projects').catch(() => []), api.get('/experiences').catch(() => []), api.get('/status').catch(() => ({}))
  ]);
  const J = jobGroups(jobs);
  // Rank by weighted mentions with identical job posts counted once (the API ranks by raw job matches).
  const skills = mergeSkills(skillsRaw).map((s, i) => ({ s, i })).sort((a, b) => weight(b.s, J) - weight(a.s, J) || b.s.source_mentions - a.s.source_mentions || a.i - b.i).map(x => x.s);
  const hd = headline({ skills, weekly, J, articles: st.counts?.articles ?? 0 });
  const dupGroup = J.groups.find(g => g.length > 1);

  const root = document.createElement('div');
  root.className = 'cr';
  root.innerHTML = String(html`
  <header class="page-head">
    <p class="eyebrow">Career intelligence</p>
    <h1>${hd.h}</h1>
    <p class="lede">${hd.l}</p>
  </header>

  ${dupGroup ? html`<div class="cr-callout" role="note">${icon('alert')}
    <p><b>${plural(jobs.length, 'saved job post')}, ${J.unique} unique.</b> “${stripDemo(dupGroup[0].title)}” is saved ${dupGroup.length} times${isDemoText(dupGroup[0].title) ? ' (demo data)' : ''}, so raw job counts would be inflated ${dupGroup.length}×. The radar below counts it once.</p>
    <button class="btn btn--sm" data-act="dedupe">Remove ${plural(J.copies, 'copy', 'copies')}</button></div>` : ''}

  <section class="cr-kpis" aria-label="Career summary">
    <div class="tile tile--static cr-kpi"><span class="cr-kpi-top"><span class="cr-kpi-n">${skills.length}</span><span class="cr-kpi-l">skills · 30 days</span></span>
      <span class="cr-kpi-c">${skills.filter(s => s.recent > 0).length === skills.length ? 'All mentioned this week' : html`<b>${skills.filter(s => s.recent > 0).length}</b> mentioned this week`}; <b>${skills.filter(s => jobCount(s, J) > 0).length}</b> named in a saved job post.</span></div>
    <div class="tile tile--static cr-kpi"><span class="cr-kpi-top"><span class="cr-kpi-n">${projects.length}</span><span class="cr-kpi-l">${projects.length === 1 ? 'project' : 'projects'}</span></span>
      <span class="cr-kpi-c">${projects.length ? html`${PSTATUS.map(k => [k, projects.filter(p => p.status === k).length]).filter(x => x[1]).map(([k, n], i) => html`${i ? ', ' : ''}<b>${n}</b> ${k === 'idea' && n !== 1 ? 'ideas' : k}`)}. <button class="cr-inline" data-tab="projects">Open projects</button>` : html`None yet. <button class="cr-inline" data-tab="projects">Start one</button>`}</span></div>
    ${experiences.length ? html`<div class="tile tile--static cr-kpi"><span class="cr-kpi-top"><span class="cr-kpi-n">${experiences.filter(x => x.public_ok).length}<span class="cr-kpi-of"> of ${experiences.length}</span></span><span class="cr-kpi-l">experiences public OK</span></span>
      <span class="cr-kpi-c">Only these may appear as first-person claims in drafts.</span></div>`
      : html`<div class="tile tile--static cr-kpi"><span class="cr-kpi-top"><span class="cr-kpi-n">0</span><span class="cr-kpi-l">experiences</span></span><span class="cr-kpi-c">Drafts stay in observer voice until you add one. <button class="cr-inline" data-tab="experiences">Add one</button></span></div>`}
  </section>

  <div class="cr-tabs" role="tablist" aria-label="Career sections">${TABS.map(([k, l]) => html`<button class="cr-tabbtn" role="tab" id="cr-tab-${k}" aria-controls="cr-pane" aria-selected="${String(state.tab === k)}" tabindex="${state.tab === k ? 0 : -1}" data-tab="${k}">${l}</button>`)}</div>
  <div id="cr-pane" class="cr-pane" role="tabpanel" aria-labelledby="cr-tab-${state.tab}"></div>`);
  el.replaceChildren(root);

  const pane = root.querySelector('#cr-pane');
  const data = { skills, weekly, jobs, J, projects, experiences };
  const show = async (animate) => {
    await PANES[state.tab](pane, () => render(el, { ...ctx, params: [] }), data);
    if (animate && !reduced()) enterItems([...pane.children].slice(0, 4), { y: 6, duration: 420, fadeDuration: 300 });
  };
  const select = (k, focus) => {
    state.tab = k;
    root.querySelectorAll('.cr-tabbtn').forEach(b => { const on1 = b.dataset.tab === k; b.setAttribute('aria-selected', String(on1)); b.tabIndex = on1 ? 0 : -1; if (on1 && focus) b.focus(); });
    pane.setAttribute('aria-labelledby', `cr-tab-${k}`);
    try { history.replaceState(history.state, '', `#/career/${k}`); } catch (e) { /* ignore */ }
    show(true);
  };
  on(root, 'click', '[data-tab]', (e, b) => select(b.dataset.tab));
  root.querySelector('.cr-tabs').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = TABS.findIndex(t => t[0] === state.tab);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    select(TABS[n][0], true);
  });
  on(root, 'click', '[data-act="dedupe"]', async (e, b) => {
    const extra = J.groups.flatMap(g => g.slice(1));
    if (!(await confirmBox(`Delete ${plural(extra.length, 'identical copy', 'identical copies')} of saved job posts? One of each is kept.`, 'Remove copies'))) return;
    await act(b, async () => { for (const j of extra) await api.del(`/jobposts/${j.id}`); toast(`Removed ${plural(extra.length, 'copy', 'copies')}`, 'ok'); render(el, { ...ctx, params: [] }); }, 'Removing…');
  });
  await show(false);
}

// ---------------------------------------------------------------- skill radar
async function radar(pane, again, { skills, jobs, J, weekly }) {
  const maxSrc = Math.max(1, ...skills.map(s => s.source_mentions));
  const fresh = noHistory(skills);
  const showWeek = skills.some(s => s.recent !== s.source_mentions);
  // Long tail: 1 source mention and no job post folds into one disclosure row.
  const tail = (s) => s.source_mentions <= 1 && jobCount(s, J) === 0;
  const head = skills.filter(s => !tail(s)), rest = skills.filter(tail);
  const jobsOnly = (s) => s.source_mentions === 0 && jobCount(s, J) > 0;
  // Trend column only once it can say something: ≥2 weeks of history and a value on ≥25% of rows.
  const trendVal = (s) => !fresh && !jobsOnly(s) && s.trend;
  const showTrend = !fresh && skills.filter(trendVal).length >= skills.length * 0.25;
  const long = skills.length > 30;
  const single = J.unique === 1;
  const jobCell = (s) => { const n = jobCount(s, J); if (!J.unique) return html`<span class="cr-raw">—</span>`;
    if (single) return n ? html`<span class="cr-yes" title="${J.factor > 1 ? `${s.job_mentions} raw matches across ${J.factor} identical copies, counted once` : 'Named in your saved job post'}">${icon('check')}<span class="sr-only">Yes</span></span>` : html`<span class="cr-raw" aria-label="No">—</span>`;
    return html`${n}<span class="cr-raw"> of ${J.unique}</span>`; };
  const row = (s) => { const i = skills.indexOf(s); return html`<tr data-skill="${i}" class="${long ? 'cv-row' : ''}">
          <td class="cr-skillcol"><button class="cr-linkbtn" data-skill-open="${i}">${skillName(s.skill)}</button>${jobsOnly(s) ? html`<span class="cr-jobsonly" title="Only job descriptions mention it">Jobs only</span>` : ''}${s.aliases.length ? html`<span class="cr-alias" title="Counted separately: one article can use both words">also ${s.aliases.map(a => `${a.skill} (${a.n})`).join(', ')}</span>` : ''}</td>
          <td class="num cr-wcol"><b>${weight(s, J)}</b></td>
          <td class="cr-barcell"><span class="cr-bar ${s.source_mentions ? '' : 'is-zero'}"><span class="meter"><i style="--v:${s.source_mentions / maxSrc}"></i></span><b>${s.source_mentions}</b></span></td>
          ${showWeek ? html`<td class="num cr-weekcol">${s.recent}</td>` : ''}
          <td class="num cr-jobcol">${jobCell(s)}</td>
          ${showTrend ? html`<td class="cr-trendcol">${trendVal(s) ? trendTag(s.trend, s) : html`<span class="cr-raw">—</span>`}</td>` : ''}</tr>`; };
  const cols = 4 + (showWeek ? 1 : 0) + (showTrend ? 1 : 0);
  pane.innerHTML = String(html`
  <div class="cr-cols">
    <section class="tile tile--static tile--flush" aria-labelledby="cr-r-h">
      <div class="section-head cr-pad"><h2 class="t-h2" id="cr-r-h">Skill radar</h2><span class="section-meta">last 30 days · ${plural(skills.length, 'skill')} with evidence · sorted by weight</span></div>
      ${skills.length ? html`<table class="table cr-table">
        <caption class="cr-cap">Weight is source mentions plus 2 × job posts, so a skill named in a job post ranks above one seen once in the news. ${fresh ? html`Every article in the 30-day window is from this week, so there is no earlier rate to compare against${showWeek ? '' : ' and “this week” equals the 30-day count'}; the trend column appears once there are two weeks of history.` : showTrend ? 'Trend compares this week with the weekly rate over the previous three weeks.' : 'Trends are hidden while fewer than a quarter of skills have one.'}</caption>
        <thead><tr><th class="cr-skillcol">Skill</th><th class="num cr-wcol" title="Source mentions + 2 × job posts">Weight</th><th class="cr-barcell">Source mentions${showWeek ? '' : html`<span class="cr-th-note">all this week</span>`}</th>${showWeek ? html`<th class="num cr-weekcol">This week</th>` : ''}<th class="num cr-jobcol">${single ? 'In job post' : 'Job posts'}</th>${showTrend ? html`<th class="cr-trendcol">Trend</th>` : ''}</tr></thead>
        <tbody>${head.map(row)}</tbody>
        ${rest.length ? html`<tbody class="cr-tailhead"><tr><td colspan="${cols}"><button type="button" class="cr-tailbtn" data-tail aria-expanded="false" aria-controls="cr-tail">${icon('chevron-right', 'cr-tail-chev')}${plural(rest.length, 'more skill')} with 1 mention</button><span class="cr-tail-names">${rest.slice(0, 3).map(s => skillName(s.skill)).join(', ')}${rest.length > 3 ? ', …' : ''}</span></td></tr></tbody>
        <tbody id="cr-tail" class="cr-tail" hidden>${rest.map(row)}</tbody>` : ''}</table>`
      : html`<div class="cr-pad cr-padb"><div class="empty"><h3>No skill evidence yet.</h3><p>Run the daily workflow or paste a job description.</p></div></div>`}
    </section>
    <aside class="stack cr-side">
      <section class="tile tile--static cr-card" aria-labelledby="cr-jl-h">
        <div class="section-head"><h2 class="t-h2" id="cr-jl-h">Saved job posts</h2><span class="section-meta">${J.unique} unique${J.copies ? ` · ${jobs.length} saved` : ''}</span></div>
        ${jobs.length ? html`<ul class="cr-jobs">${J.groups.map(g => { const j = g[0]; return html`<li>
          <div class="cr-job-h"><span class="cr-job-t">${stripDemo(j.title)}</span></div>
          <span class="cr-sub">${j.employer || 'No employer'} · saved ${dayLabel((j.created_at || '').slice(0, 10), { weekday: false })}${j.url ? html` · <a href="${j.url}" target="_blank" rel="noopener">posting${icon('arrow-up-right')}</a>` : ''}</span>
          <div class="cr-job-tags">${demoTag(isDemoText(j.title))}${g.length > 1 ? html`<span class="tag tag--warn" title="${g.length} identical saved copies; counted once">×${g.length} copies</span>` : ''}${J.unique === 1 ? html`<span class="cr-job-n">${plural(skills.filter(s => s.job_mentions > 0).length, 'radar skill')} found in it</span>` : ''}</div>
          <p class="cr-excerpt">${j.excerpt}…</p>
          <div class="cr-end"><button class="btn btn--ghost btn--sm" data-del-job="${j.id}">${g.length > 1 ? 'Delete one copy' : 'Delete'}</button></div>
        </li>`; })}</ul>` : html`<p class="cr-note">None yet. Paste a posting below; job mentions count double in the ranking.</p>`}
      </section>
      ${(weekly?.persisted || []).length ? html`<section class="tile tile--static cr-card" aria-labelledby="cr-tp-h">
        <div class="section-head"><h2 class="section-label" id="cr-tp-h">Story topics this week</h2><span class="section-meta">days seen of 7</span></div>
        <ul class="cr-days cr-days--side">${weekly.persisted.slice(0, 3).map(p => { const sk = skills.find(x => x.skill.toLowerCase() === p.topic.toLowerCase()); return html`<li><span class="cr-days-t">${p.topic}${sk && jobsOnly(sk) ? html`<span class="cr-days-note" title="As a skill, only job posts name it">also a job-post skill</span>` : ''}</span>
          <span class="cr-days-dots" aria-hidden="true">${Array.from({ length: 7 }, (_, i) => html`<i class="${i < p.days ? 'on' : ''}"></i>`)}</span><span class="cr-days-k">${p.days}<span class="sr-only"> of 7 days</span></span></li>`; })}</ul>
      </section>` : ''}
      <section class="tile tile--static cr-card" aria-labelledby="cr-jp-h">
        <h2 class="section-label" id="cr-jp-h">Add a job description</h2>
        <form class="cr-form" id="jp">
          <label class="field">Title<input class="input cr-ph" name="title" placeholder="Job title"></label>
          <label class="field">Employer<input class="input" name="employer"></label>
          <label class="field cr-full">Posting URL<input class="input" name="url" placeholder="https://…" inputmode="url"></label>
          <label class="field cr-full">Description *<textarea class="textarea" name="text" rows="3" required placeholder="Paste the full job description"></textarea></label>
          <div class="cr-full cr-end"><button class="btn btn--primary" type="submit">Add to radar</button></div>
        </form>
      </section>
    </aside>
  </div>`);
  on(pane, 'click', '[data-tail]', (e, b) => { const open = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(open)); pane.querySelector('#cr-tail').hidden = !open; });
  pane.querySelector('#jp').addEventListener('submit', async (e) => {
    e.preventDefault();
    await act(e.submitter, async () => { await api.post('/jobposts', Object.fromEntries(new FormData(e.target))); toast('Job post added', 'ok'); again(); });
  });
  on(pane, 'click', '[data-del-job]', (e, b) => { const id = b.dataset.delJob; strikeOut(b.closest('li'), { message: 'Job post deleted.', commit: () => api.del(`/jobposts/${id}`) }); });
  on(pane, 'click', 'tr[data-skill]', (e, tr) => {
    if (e.target.closest('[data-tail]')) return;
    const s = skills[tr.dataset.skill];
    modal(String(html`<div class="cr-ev-head"><h2>${skillName(s.skill)}</h2>${trendTag(s.trend, s)}</div>
      <p class="cr-note">${plural(s.source_mentions, 'source mention')} in 30 days (${s.recent} this week, baseline ${s.older_rate}/week) · ${plural(jobCount(s, J), 'job post')}${J.factor > 1 && s.job_mentions ? ` (${s.job_mentions} raw matches across copies)` : ''}</p>
      <ul class="cr-ev">${s.evidence.map(ev => html`<li class="${ev.kind === 'job' ? 'is-job' : ''}">
        <div class="cr-ev-meta"><span class="tag tag--neutral">${ev.kind === 'job' ? 'Job description' : 'Source'}</span>${ev.kind === 'job' ? html`<span>${stripDemo(ev.title)}</span>${demoTag(isDemoText(ev.title))}` : html`<span class="cr-mono">${ev.domain}</span>`}</div>
        <p>“${ev.snippet}”</p>
        <div class="cluster">${ev.story_id ? html`<a class="btn btn--sm" href="#/story/${ev.story_id}" data-close>Open story</a>` : ''}${ev.url ? html`<a class="btn btn--sm btn--ghost" href="${ev.url}" target="_blank" rel="noopener">Original${icon('arrow-up-right')}</a>` : ''}</div>
      </li>`)}</ul>
      <div class="modal-actions"><button class="btn" data-close>Close</button></div>`));
  });
}

// ---------------------------------------------------------------- collections + interview points
async function collections(pane, again) {
  const g = await api.get('/collections');
  const names = [...new Set([...GROUPS, ...Object.keys(g)])];
  const total = Object.values(g).reduce((n, a) => n + a.length, 0);
  pane.innerHTML = String(html`
  <div class="cr-legend"><p class="cr-note">Saved stories grouped by target role (${plural(total, 'story', 'stories')} saved). Talking points are labelled so you never present someone else’s work, or an idea you haven’t tried, as your own.</p>
    <div class="cluster">${labelChip('work you have done')}${labelChip('example')}${labelChip('hypothesis')}${labelChip('future experiment')}</div></div>
  <div class="cr-grid3">${names.map(n => html`<section class="tile tile--static cr-card" aria-label="${n}">
    <div class="cr-card-h"><h2 class="t-title">${n}</h2><span class="cr-count">${(g[n] || []).length}</span></div>
    ${(g[n] || []).length ? html`<ul class="cr-saved">${g[n].map(s => html`<li data-dossier-src><a href="#/story/${s.story_id}">${s.title}</a>${s.note ? html`<span class="cr-sub">${s.note}</span>` : ''}<span class="cluster">${topicPills(s.topics || [], s.score, threshold(), { max: 3 })}</span></li>`)}</ul>
      <div class="cr-end"><button class="btn btn--sm" data-iv="${n}">Interview talking points</button></div>`
    : html`<p class="cr-note">Nothing saved yet. Save stories to “${n}” from a story’s dossier.</p>`}
  </section>`)}</div>
  ${Object.entries(state.interview).map(([n, res]) => html`<section class="tile tile--static cr-card cr-iv" aria-labelledby="cr-iv-h">
    <div class="section-head"><h2 class="t-h2" id="cr-iv-h">Talking points · ${n}</h2><button class="btn btn--ghost btn--sm" data-iv-close="${n}">Hide</button></div>
    ${res.length ? res.map(r => html`<div class="cr-iv-story"><a class="t-title" href="#/story/${r.story_id}">${r.title}</a>
      ${r.items.map(it => html`<div class="nested cr-iv-item"><div>${labelChip(it.label)}</div><p class="cr-iv-q">${it.question}</p><p class="cr-note">${it.notes}</p></div>`)}</div>`)
    : html`<p class="cr-note">No stories to build points from.</p>`}
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
  const fld = (k, l, rows = 2, half = false) => html`<label class="field ${half ? '' : 'cr-full'}">${l}<textarea class="textarea" name="${k}" rows="${rows}">${p[k] || ''}</textarea></label>`;
  const filled = (x) => ['question', 'inputs', 'deliverable', 'success', 'tested', 'findings'].filter(k => (x[k] || '').trim()).length;
  pane.innerHTML = String(html`
  <div class="cr-proj">
    <section class="tile tile--static tile--flush" aria-labelledby="cr-pl-h">
      <div class="section-head cr-pad"><h2 class="t-h2" id="cr-pl-h">Projects</h2><button class="btn btn--primary btn--sm" data-act="new">${icon('plus')}New</button></div>
      ${list.length ? html`<ul class="cr-plist" role="listbox" aria-label="Projects">${list.map(x => html`<li role="option" aria-selected="${String(x.id === state.project)}" tabindex="0" class="${x.id === state.project ? 'is-on' : ''}" data-pick="${x.id}">
        <span class="cr-pl-t">${x.title}</span>
        <span class="cluster">${pTag(x.status)}<span class="chip">${x.kind}</span>${x.employer ? html`<span class="chip">${x.employer}</span>` : ''}</span>
        <span class="cr-sub">${filled(x)} of 6 fields filled · updated ${dayLabel((x.updated_at || '').slice(0, 10), { weekday: false })}</span></li>`)}</ul>`
      : html`<div class="cr-pad cr-padb"><div class="empty"><h3>No projects yet.</h3><p>Generate one from a story, or start blank.</p></div></div>`}
    </section>
    ${p ? html`<section class="tile tile--static cr-card" aria-labelledby="cr-pe-h">
      <h2 class="sr-only" id="cr-pe-h">Edit ${p.title}</h2>
      <form id="pf" class="cr-form">
        <label class="field cr-full">Title<input class="input cr-ptitle" name="title" value="${p.title || ''}"></label>
        <label class="field">Kind<select class="select" name="kind">${KINDS.map(k => html`<option ${k === p.kind ? 'selected' : ''}>${k}</option>`)}</select></label>
        <label class="field">Status<select class="select" name="status">${PSTATUS.map(k => html`<option ${k === p.status ? 'selected' : ''}>${k}</option>`)}</select></label>
        <label class="field cr-full">Employer connection<select class="select" name="employer"><option value="">None</option>${employers.map(e => html`<option ${e.name === p.employer ? 'selected' : ''}>${e.name}</option>`)}</select></label>
        ${fld('question', 'Question')}${fld('inputs', 'Inputs / data', 2, true)}${fld('deliverable', 'Deliverable', 2, true)}${fld('success', 'Success measure', 2, true)}${fld('extension', 'Extension (Lot Intelligence / Research Bench)', 2, true)}
        <div class="cr-full cr-rule"></div>
        ${fld('tested', 'What I tested', 3, true)}${fld('findings', 'What I found', 3, true)}${fld('next_steps', 'Next', 2)}
        <div class="cr-full cr-pfoot">
          <span class="cr-sub">${p.story_id ? html`From <a href="#/story/${p.story_id}">its story</a> · ` : ''}updated ${dayLabel((p.updated_at || '').slice(0, 10), { weekday: false })}</span>
          <span class="cluster"><button type="button" class="btn btn--danger btn--sm" data-act="delete">Delete</button><button class="btn btn--primary" type="submit">Save project</button></span>
        </div>
      </form>
      <div class="cr-rule"></div>
      <h3 class="cr-h3">Create drafts from this project</h3>
      <p class="cr-note">Drafts use only what you wrote above as first-person content. Fill in “What I tested” and “What I found” before claiming results.${(p.tested || p.findings) ? '' : ' Both are empty now.'}</p>
      <div class="cluster cr-drafts-btns">${['linkedin', 'instagram', 'video'].map(ch => html`<button class="btn" data-draft="${ch}">${channelLabel(ch)} draft</button>`)}</div>
      ${p.drafts?.length ? html`<ul class="cr-pdrafts">${p.drafts.map(d => html`<li><a href="#/draft/${d.id}">${d.title}</a><span class="cluster">${status(d.status)}<span class="chip">${channelLabel(d.channel, d.format)}</span></span></li>`)}</ul>` : ''}
    </section>` : html`<section class="tile tile--static cr-card"><div class="empty"><h3>Select or create a project.</h3><p>Projects turn a story into original analysis you can show.</p></div></section>`}
  </div>`);
  on(pane, 'click', '[data-pick]', (e, d) => { state.project = Number(d.dataset.pick); again(); });
  on(pane, 'keydown', '[data-pick]', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); state.project = Number(d.dataset.pick); again(); } });
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
async function weekly(pane, again, { weekly: w0 }) {
  const w = w0 || await api.get('/career/weekly');
  const key = (s) => `${s.kind}:${s.ref}`;
  const short = w.shortlist.filter(s => !state.skipped.has(key(s)));
  pane.innerHTML = String(html`
  <div class="cr-cols">
    <div class="stack">
      <section class="tile tile--static cr-card" aria-labelledby="cr-w1">
        <div class="section-head"><h2 class="t-h2" id="cr-w1">Trends that persisted</h2><span class="section-meta">${plural(w.story_count, 'story', 'stories')} updated this week</span></div>
        ${w.persisted.length ? html`<ul class="cr-days">${w.persisted.map(p => html`<li><span class="cr-days-t">${p.topic}</span>
          <span class="cr-days-dots" role="img" aria-label="Seen on ${p.days} of 7 days">${Array.from({ length: 7 }, (_, i) => html`<i class="${i < p.days ? 'on' : ''}"></i>`)}</span>
          <span class="cr-days-n">${p.days} days · ${plural(p.stories, 'story', 'stories')}</span></li>`)}</ul>`
        : html`<p class="cr-note">No topic appeared on two or more days this week.</p>`}
      </section>
      <section class="tile tile--static cr-card" aria-labelledby="cr-w2">
        <div class="section-head"><h2 class="t-h2" id="cr-w2">Claims that changed</h2><span class="section-meta">${w.changed.length}</span></div>
        ${w.changed.length ? html`<ul class="cr-changed">${w.changed.map(c => html`<li data-dossier-src>
          <a class="t-title" href="#/story/${c.story_id}">${c.title}</a>
          <span class="cr-sub">First: <a href="${c.original.url}" target="_blank" rel="noopener">${c.original.domain}</a> · ${dayLabel((c.original.fetched_at || '').slice(0, 10), { weekday: false })}</span>
          ${c.follow_ups.map(f => html`<span class="cr-fu">${icon('arrow-right')}<a href="${f.url}" target="_blank" rel="noopener">${f.title}</a><span class="cr-mono">${f.domain} · ${dayLabel((f.fetched_at || '').slice(0, 10), { weekday: false })}</span></span>`)}
          ${c.new_claims.length ? html`<ul class="cr-claims">${c.new_claims.map(t => html`<li>${t}</li>`)}</ul>` : ''}
        </li>`)}</ul>` : html`<p class="cr-note">No follow-up reporting changed a story this week.</p>`}
      </section>
      <section class="tile tile--static cr-card" aria-labelledby="cr-w3">
        <div class="section-head"><h2 class="t-h2" id="cr-w3">Project ideas</h2><span class="section-meta">${w.ideas.length}</span></div>
        ${w.ideas.length ? html`<ul class="cr-ideas">${w.ideas.map(i => html`<li><button class="cr-linkbtn" data-open-project="${i.id}">${i.title}</button><span class="cr-sub">${i.question}</span></li>`)}</ul>` : html`<p class="cr-note">No ideas waiting. Generate one from a story.</p>`}
      </section>
    </div>
    <section class="tile tile--static cr-card cr-short" aria-labelledby="cr-w4">
      <h2 class="section-label" id="cr-w4">This week’s shortlist · ${short.length}</h2>
      ${short.length ? html`<ul class="cr-shortlist">${short.map(s => html`<li><span class="tag tag--neutral">${s.kind}</span><p>${s.label}</p>
        <div class="cluster"><button class="btn btn--sm" data-pursue="${short.indexOf(s)}">Pursue</button><button class="btn btn--ghost btn--sm" data-skip="${key(s)}">Skip</button></div></li>`)}</ul>`
      : html`<p class="cr-note">${w.shortlist.length ? 'All skipped for now.' : 'Nothing shortlisted this week.'}</p>`}
      ${state.skipped.size ? html`<button class="btn btn--ghost btn--sm" data-act="unskip">Show ${state.skipped.size} skipped</button>` : ''}
    </section>
  </div>`);
  on(pane, 'click', '[data-skip]', (e, b) => { state.skipped.add(b.dataset.skip); weekly(pane, again, { weekly: w }); });
  on(pane, 'click', '[data-act="unskip"]', () => { state.skipped.clear(); weekly(pane, again, { weekly: w }); });
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
  <div class="cr-cols">
    <section class="tile tile--static cr-card" aria-labelledby="cr-x1">
      <div class="section-head"><h2 class="t-h2" id="cr-x1">Your experiences</h2><span class="section-meta">${list.filter(x => x.public_ok).length} of ${list.length} public OK</span></div>
      ${list.length ? html`<ul class="cr-exps">${list.map(x => html`<li data-exp="${x.id}">
        <textarea class="textarea" rows="2" data-text aria-label="Experience">${x.text}</textarea>
        <div class="cr-exp-foot">
          <label class="pp-check"><input type="checkbox" data-public ${x.public_ok ? 'checked' : ''}> Public OK: may appear as a first-person claim</label>
          <span class="cluster"><button class="btn btn--sm" data-save>Save</button><button class="btn btn--ghost btn--sm" data-del>Delete</button></span>
        </div></li>`)}</ul>`
      : html`<div class="empty"><h3>No experiences yet.</h3><p>Without them, drafts stay in observer voice: nothing is written as “I built” or “I led”.</p></div>`}
    </section>
    <section class="tile tile--static cr-card" aria-labelledby="cr-x2">
      <h2 class="section-label" id="cr-x2">Add an experience</h2>
      <p class="cr-note">Byline never invents experiences. Only entries marked <b>public OK</b> may appear as first-person claims (“I built…”, “I led…”) in drafts and outreach. Everything else is used privately for context, or not at all.</p>
      <form id="xf" class="stack-sm cr-xform">
        <textarea class="textarea" name="text" rows="4" required aria-label="New experience" placeholder="e.g. Built a Tableau dashboard tracking dealership lead response times for a class project (Fall 2026)."></textarea>
        <label class="pp-check"><input type="checkbox" name="public_ok"> Public OK</label>
        <div class="cr-end"><button class="btn btn--primary" type="submit">Add</button></div>
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

const PANES = { radar, collections, projects, weekly, experiences };
