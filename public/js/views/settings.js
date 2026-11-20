// Settings (functional, 70 → restyled to v4). SPEC §5: clear sections, every existing feature kept,
// a source-health summary that links to Sources, and the TTS/voice section removed (server untouched).
// Headline per F §2 Settings: "Your bar is {T}; {cleared} stories this week clear it." Section titles
// keep the names the ⌘K Index jumps to (app.js SETTINGS_SECTIONS). Each section saves on its own.
import { api } from '../api.js';
import { html, raw, on, act, toast, confirmBox, copy, icon, useStyle, timeAgo } from '../ui.js';
import { refreshStatus } from '../app.js';
import { reduced, EASE, enterItems } from '../motion.js';

const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'America/Sao_Paulo', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Africa/Lagos', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland', 'UTC'];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HEALTH = { ok: 'healthy', stale: 'stale', error: 'failing', paused: 'paused' };
// table of contents: [id, title] grouped; titles double as the ⌘K section names
const TOC = [
  ['Overview', [['sg-overview', 'Source health & status']]],
  ['Ranking', [['sg-priorities', 'Priorities'], ['sg-threshold', 'Publishing threshold & brief']]],
  ['Automation', [['sg-schedule', 'Schedule'], ['sg-ai', 'AI provider'], ['sg-budget', 'Budget']]],
  ['Writing', [['sg-profile', 'Writing profile'], ['sg-editorial', 'Editorial rules'], ['sg-intro', 'Intro format']]],
  ['Publishing', [['sg-posting', 'Posting rhythm'], ['sg-delivery', 'Brief delivery'], ['sg-media', 'Media']]],
  ['System', [['sg-access', 'Calendar feed & access'], ['sg-display', 'Display'], ['sg-security', 'Security'], ['sg-demo', 'Demo data'], ['sg-about', 'About']]]
];
// Groups shown folded by default (G3): their sections render inside a disclosure that opens on click,
// from the section nav, from the ⌘K Index (which focuses the matching h3 in the fold head) or #/settings/<id>.
const FOLDED = { Writing: 'sg-g-writing', Publishing: 'sg-g-publishing', System: 'sg-g-system' };
const SEC_GROUP = Object.fromEntries(TOC.flatMap(([g, items]) => items.map(([id]) => [id, g])));
const splitTerms = (s) => s.split(/[,\n]/).map(t => t.trim()).filter(Boolean);
const validZone = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const andList = (xs) => xs.length < 2 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
const sign = (v) => (Number(v) > 0 ? 'pos' : Number(v) < 0 ? 'neg' : 'zero');
// The fill runs from the zero mark (50%) to the value, in a neutral line colour (G1: blue only on the thumb, on hover/focus).
const fillVars = (v) => { const p = ((Number(v) + 2) / 4) * 100; return `--a:${Math.min(50, p).toFixed(1)}%;--b:${Math.max(50, p).toFixed(1)}%`; };
const weightLabel = (v) => (Number(v) < 0 ? `−${Math.abs(Number(v)).toFixed(1)}` : Number(v).toFixed(1));
const weightText = (v) => (Number(v) < 0 ? `${Math.abs(Number(v)).toFixed(1)} below zero, de-emphasized` : Number(v) === 0 ? '0, ignored' : `${Number(v).toFixed(1)}`);
// SS2: money always shows 2 decimals; a real but sub-cent amount reads "<$0.01" rather than a misleading $0.00.
const money = (v) => { const n = Number(v) || 0; return n > 0 && n < 0.005 ? '<$0.01' : `$${n.toFixed(2)}`; };
// SS1: one section per task AND per frame. A bare scheduler.yield() resumes before the next render, so two
// chunks' style + layout would land in one long frame; waiting for the frame first, then yielding (front of the
// queue in Chromium; a macrotask elsewhere), gives every section its own task and its own rendering update.
const yieldTask = () => new Promise(r => requestAnimationFrame(() => (globalThis.scheduler?.yield ? globalThis.scheduler.yield().then(r) : setTimeout(r, 0))));
const fmtTime12 = (hhmm) => { const [h, m] = String(hhmm || '07:00').split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

/** F §2 Settings headline + one-liner, from settings, /api/today (cleared), watchlists and the source summary. */
function headline(s, st, today, watch, summary) {
  const T = s.publish_threshold;
  const cleared = today?.cleared;
  const pos = (s.priorities || []).filter(p => Number(p.weight) > 0).sort((a, b) => b.weight - a.weight);
  const neg = (s.priorities || []).filter(p => Number(p.weight) < 0);
  const top = pos.slice(0, 2).map(p => p.topic);
  const sched = s.schedule?.enabled ? html`on at <b>${fmtTime12(s.schedule.time)}</b> ${st.timezone_abbr || ''}` : html`<b>off</b>`;
  const paused = summary?.all_paused ? html`; all <b>${summary.sources}</b> sources are paused` : summary?.paused ? html`; <b>${summary.paused}</b> of ${summary.sources} sources are paused` : '';
  return {
    h: cleared != null ? `Your bar is ${T}; ${plural(cleared, 'story', 'stories')} this week clear${cleared === 1 ? 's' : ''} it.` : `Your bar is ${T}.`,
    l: html`<b>${pos.length}</b> ${pos.length === 1 ? 'priority' : 'priorities'}${top.length ? html` (${andList(top)} weigh${top.length === 1 ? 's' : ''} most)` : ''}, <b>${neg.length}</b> de-emphasized, <b>${watch.length}</b> watchlist ${watch.length === 1 ? 'item' : 'items'}. The daily schedule is ${sched}${paused}.`
  };
}

export async function render(view, ctx = {}) {
  await useStyle('/css/v4/settings.css');
  let [s, st, today, watch, summary, sources] = await Promise.all([
    api.get('/settings'), api.get('/status'), api.get('/today').catch(() => null), api.get('/watchlists').catch(() => []),
    api.get('/sources/summary').catch(() => null), api.get('/sources').catch(() => [])
  ]);
  const el = document.createElement('div');
  el.className = 'sg';
  view.replaceChildren(el);
  let p = st.provider;
  const wp = s.writing_profile || {};
  wp.samples ||= [];

  // Read the editable lists (priorities, samples) back from the DOM so add/remove keeps unsaved edits.
  const readPriorities = () => [...el.querySelectorAll('.sg-prio')].map(r => ({
    topic: r.querySelector('[data-p=topic]').value.replace(/\s+/g, ' ').trim(), weight: Number(r.querySelector('[data-p=weight]').value), terms: splitTerms(r.querySelector('[data-p=terms]').value)
  }));
  const readSamples = () => [...el.querySelectorAll('[data-sample]')].map(t => t.value);

  // Display: Proof (default) / Night / Match system. Stored per browser (localStorage['byline-theme'] = light|dark|system).
  const themePref = () => { try { return localStorage.getItem('byline-theme') || 'light'; } catch { return 'light'; } };
  const applyTheme = (v) => {
    try { localStorage.setItem('byline-theme', v); } catch { /* storage unavailable */ }
    if (window.__byline?.setTheme) return window.__byline.setTheme(v);
    document.documentElement.dataset.theme = v === 'dark' ? 'night' : 'proof';
  };

  // Security: status plus TOTP enrollment. The secret is shown only during enrollment, never afterwards.
  let sec = null, enrolling = null;
  const loadSecurity = () => api.get('/security').then(x => { sec = x; paintSecurity(); }).catch(() => {});
  const codeInput = (name, label) => html`<label class="field">${label}<input class="input sg-code" data-code="${name}" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="6 digits"></label>`;
  const paintSecurity = () => {
    const fact = el.querySelector('[data-fact="sg-security"]'); if (fact && sec) fact.textContent = facts()['sg-security'];
    const box = el.querySelector('[data-security]'); if (!box) return;
    if (!sec) { box.innerHTML = '<span class="spinner"><i aria-hidden="true"></i>Checking…</span>'; return; }
    const required = sec.totp_always ? 'at every sign-in' : 'when Byline is reached through a tunnel, proxy or another device';
    box.innerHTML = String(html`
      <ul class="sg-checks">
        <li><span class="dot ${sec.password_set ? 'ok' : 'warn'}"></span>${sec.password_set ? 'Password sign-in is on.' : html`No password set (<span class="mono">BYLINE_PASSWORD</span>). Two-step sign-in only applies once a password is set.`}</li>
        <li><span class="dot ${sec.totp_enabled ? 'ok' : ''}"></span>${sec.totp_enabled
          ? html`Two-step sign-in is on${sec.totp_source === 'env' ? html` (set by <span class="mono">BYLINE_TOTP_SECRET</span>)` : ''}. A code is asked for ${required}.`
          : 'Two-step sign-in is off.'}${sec.totp_required_now ? html` <span class="tag tag--neutral">needed from here</span>` : ''}</li>
      </ul>
      ${enrolling ? html`
        <div class="sg-enroll">
          <p class="section-label">1 · Add Byline to your authenticator app</p>
          <p class="sg-help">Choose “enter a setup key” and type the key below (time-based, 6 digits), or paste the setup link into an app that accepts one.</p>
          <div class="sg-key mono" data-totp-key>${enrolling.secret.replace(/(.{4})(?=.)/g, '$1 ')}</div>
          <div class="sg-inline"><input class="input mono" readonly data-otpauth value="${enrolling.otpauth}" aria-label="Setup link (otpauth)"><button class="btn btn--secondary btn--sm" type="button" data-act="copy-otpauth">Copy link</button><button class="btn btn--secondary btn--sm" type="button" data-act="copy-key">Copy key</button></div>
          <p class="section-label">2 · Confirm with a code</p>
          <div class="sg-inline sg-inline--end">${codeInput('confirm', 'Code from the app')}<button class="btn btn--primary" type="button" data-act="totp-confirm">Turn on</button><button class="btn btn--ghost" type="button" data-act="totp-cancel">Cancel</button></div>
        </div>
      ` : sec.totp_enabled && sec.totp_source !== 'env' ? html`
        <div class="sg-inline sg-inline--end">${codeInput('disable', 'Current code')}<button class="btn btn--danger" type="button" data-act="totp-disable">Turn off two-step sign-in</button></div>
      ` : !sec.totp_enabled ? html`
        <div class="sg-actions"><button class="btn btn--primary" type="button" data-act="totp-begin">Set up two-step sign-in</button></div>
      ` : ''}
      <p class="sg-help">Works with any authenticator app (1Password, Google Authenticator, Authy, Bitwarden). Set <span class="mono">BYLINE_TOTP_ALWAYS=1</span> to ask for a code on this computer too.</p>`);
  };
  const codeVal = (name) => {
    const v = (el.querySelector(`[data-code="${name}"]`)?.value || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(v)) throw new Error('Enter the 6-digit code from your authenticator app.');
    return v;
  };

  // G2: a section's Save stays secondary until something in it changes. G3: folded groups.
  const dirty = new Set();
  const openFolds = new Set();
  const openDisc = new Set(); // SS3: Budget, Calendar feed & access and Media are closed disclosures until opened
  // SS2: a $0 limit is a choice (paid AI off), not an error; "limit reached" only when a real limit is used up.
  const budgetState = () => {
    const lim = Number(s.budget?.monthly_usd) || 0, spent = Number(p.month_spend_usd) || 0;
    if (!lim) return { sum: 'Paid AI off', tag: html`<span class="tag tag--neutral">Paid AI off · local engine only</span>` };
    const hit = spent >= lim;
    return { sum: `${money(spent)} of ${money(lim)} this month${hit ? ' · limit reached' : ''}`, tag: hit ? html`<span class="tag tag--warn">limit reached</span>` : '' };
  };
  const themeName = () => ({ light: 'Proof', dark: 'Night', system: 'Match system' }[themePref()] || 'Proof');
  const clip = (t, n = 64) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '').replace(/[\s,;:·–—-]+$/, '')}…` : t; };
  // One line of real current values per folded section, so a closed group still says what it holds.
  const facts = () => ({
    'sg-profile': `${wp.tone ? `Tone: ${clip(wp.tone, 40)}` : 'No tone set'} · ${wp.length || 'medium'} · ${plural(wp.samples.filter(x => String(x).trim()).length, 'sample')}`,
    'sg-editorial': `${plural(s.editorial?.min_independent_sources ?? 2, 'supporting source')} to approve · numbers ${s.editorial?.block_unsupported_numbers ? 'blocked' : 'flagged'} · hype ${s.editorial?.block_hype ? 'blocked' : 'flagged'}`,
    'sg-intro': s.intro_format ? `“${clip(s.intro_format, 54)}”` : 'Not set',
    'sg-posting': `${(s.posting_days || []).join(' ') || 'No days'} · roundup ${s.schedule?.weekly_roundup_day || 'Fri'} · outreach ${s.outreach_goal_per_week ?? 3} a week`,
    'sg-delivery': `Email ${s.delivery?.email ? 'on' : 'off'} · push ${s.delivery?.push ? 'on' : 'off'}`,
    'sg-media': s.synthetic_media_opt_in ? 'Synthetic narration allowed (labelled)' : 'Off: your own recordings only',
    'sg-budget': budgetState().sum,
    'sg-access': st.auth ? 'Password sign-in on · calendar feed link' : 'No password: this computer only · calendar feed link',
    'sg-display': `${themeName()} in this browser`,
    'sg-security': sec ? `Password ${sec.password_set ? 'on' : 'not set'} · two-step ${sec.totp_enabled ? 'on' : 'off'}` : (st.auth ? 'Password on' : 'No password set'),
    'sg-demo': st.counts?.demo_articles ? `${plural(st.counts.demo_articles, 'demo article')} loaded` : 'Not loaded',
    'sg-about': 'Byline v4 · fonts and licences'
  });
  const foldHead = (g) => {
    const id = FOLDED[g], open = openFolds.has(g), items = TOC.find(t => t[0] === g)[1], f = facts();
    const btn = html`<button class="btn btn--secondary btn--sm sg-fold-btn" type="button" data-fold-toggle="${g}" aria-expanded="${open}" aria-controls="${id}-b">${open ? 'Hide' : `Show ${items.length} sections`}${icon('chevron-right')}</button>`;
    // SE-2: a closed card is summary list at the top, its Show button on the card's bottom edge (aligned across the row)
    return open ? html`<div class="sg-fold-t"><h2 class="sg-fold-h" id="${id}-h">${g}</h2>${btn}</div>`
      : html`<div class="sg-fold-t"><h2 class="sg-fold-h" id="${id}-h">${g}</h2></div>
      <ul class="sg-fold-list">${items.map(([sid, t]) => html`<li><h3 class="sg-fold-i" data-for="${sid}"><button type="button" class="sg-fold-a" data-open-sec="${sid}">${t}</button></h3><span class="sg-fold-v" data-fact="${sid}" title="${f[sid]}">${f[sid]}</span></li>`)}</ul>
      <div class="sg-fold-foot">${btn}</div>`;
  };
  // A closed fold's sections are kept as markup only and built on first open (no hidden DOM in the tab change).
  const foldBodies = {};
  const fold = (g, body) => { foldBodies[g] = String(body); return html`<section class="sg-fold${openFolds.has(g) ? ' is-open' : ' tile tile--static'}" id="${FOLDED[g]}" data-fold="${g}" aria-labelledby="${FOLDED[g]}-h">
      <header class="sg-fold-head" data-fold-head="${g}">${foldHead(g)}</header>
      <div class="sg-fold-b" id="${FOLDED[g]}-b"${openFolds.has(g) ? '' : raw(' hidden')}>${openFolds.has(g) ? body : ''}</div>
    </section>`; };

  const saveBits = (save) => html`<span class="sg-dirty" data-dirty-note="${save}"${dirty.has(save) ? '' : raw(' hidden')}>Unsaved changes</span><button class="btn ${dirty.has(save) ? 'btn--primary' : 'btn--secondary'}" type="button" data-save="${save}">Save</button>`;
  // headSave: a short section keeps its Save in the header row (no footer band). disc: a closed-by-default
  // disclosure whose header carries a one-line summary of the current value (SS3).
  const section = (id, title, dek, body, { save = null, extra = '', wide = false, headSave = false, disc = null, cls = '' } = {}) => {
    const foot = !headSave && (save || extra) ? html`<footer class="sg-sec-foot">${extra}${save ? saveBits(save) : ''}</footer>` : '';
    if (disc != null) {
      const open = openDisc.has(id);
      return html`<section class="sg-sec sg-disc tile tile--static${open ? ' is-open' : ''}${cls ? ` ${cls}` : ''}" id="${id}" aria-labelledby="${id}-h" data-sg-sec data-disc="${id}">
        <header class="sg-sec-head sg-disc-head" data-disc-head="${id}"><h2 class="sg-h" id="${id}-h">${title}</h2><span class="sg-disc-sum" data-fact="${id}">${disc}</span>
          <button class="btn btn--ghost btn--sm sg-disc-btn" type="button" data-disc-toggle="${id}" aria-expanded="${open}" aria-controls="${id}-b"><span data-disc-word>${open ? 'Hide' : 'Show'}</span><span class="sr-only"> ${title}</span>${icon('chevron-right')}</button></header>
        <div class="sg-disc-b" id="${id}-b"${open ? '' : raw(' hidden')}>${dek ? html`<p class="sg-dek sg-disc-dek">${dek}</p>` : ''}<div class="sg-sec-body">${body}</div>${foot}</div>
      </section>`;
    }
    return html`
    <section class="sg-sec tile tile--static${wide ? ' sg-sec--wide' : ''}${headSave ? ' sg-sec--hsave' : ''}${cls ? ` ${cls}` : ''}" id="${id}" aria-labelledby="${id}-h" data-sg-sec>
      <header class="sg-sec-head"><div class="sg-sec-ht"><h2 class="sg-h" id="${id}-h">${title}</h2>${dek ? html`<p class="sg-dek">${dek}</p>` : ''}</div>${headSave && (save || extra) ? html`<div class="sg-hsave">${extra}${save ? saveBits(save) : ''}</div>` : ''}</header>
      <div class="sg-sec-body">${body}</div>
      ${foot}
    </section>`;
  };

  const healthHtml = () => {
    if (!summary) return html`<p class="sg-help">Source health is unavailable right now.</p>`;
    const failing = sources.filter(x => x.health === 'error' || (x.health === 'paused' && x.health_unpaused === 'error'));
    const counts = summary.all_paused ? summary.unpaused_health : { ok: summary.ok, stale: summary.stale, error: summary.error };
    const seg = Object.entries({ ok: counts.ok, stale: counts.stale, error: counts.error, ...(summary.all_paused ? {} : { paused: summary.paused }) }).filter(([, v]) => v);
    const run = st.last_run;
    return html`<div class="sg-ov">
      <a class="sg-ov-card sg-ov-src" href="#/sources">
        <span class="sg-ov-top"><span class="section-label">Sources</span><span class="sg-ov-link">Open Sources${icon('arrow-right')}</span></span>
        <span class="sg-ov-big">${summary.all_paused ? html`<b>All ${summary.sources}</b> paused` : html`<b>${summary.ok}</b> of ${summary.sources} healthy`}</span>
        <span class="sg-ov-bar" role="img" aria-label="${summary.all_paused ? 'Before the pause: ' : ''}${seg.map(([k, v]) => `${v} ${HEALTH[k]}`).join(', ')}">${seg.map(([k, v]) => html`<i data-h="${k}" style="flex:${v}"></i>`)}</span>
        <span class="sg-ov-legend">${summary.all_paused ? html`<span class="sg-ov-pre">Before the pause</span>` : ''}${seg.map(([k, v]) => html`<span><i class="sg-sw" data-h="${k}"></i>${v} ${HEALTH[k]}</span>`)}</span>
        <span class="sg-ov-meta"><b>${summary.articles_7d}</b> articles this week · <b>${summary.demo}</b> demo${summary.most_stories ? html` · most stories: ${summary.most_stories.name} (${summary.most_stories.stories_count})` : ''}</span>
        ${failing.length ? html`<span class="sg-ov-fail"><span class="sg-ov-pre">${summary.all_paused ? 'Were failing' : 'Failing'}</span>${failing.slice(0, 4).map(x => x.name).join(' · ')}${failing.length > 4 ? ` and ${failing.length - 4} more` : ''}</span>` : ''}
      </a>
      <div class="sg-ov-card">
        <span class="sg-ov-top"><span class="section-label">Collection</span></span>
        <dl class="kv sg-kv">
          <dt>Schedule</dt><dd>${s.schedule?.enabled ? html`<span class="dot ok"></span> Daily at ${fmtTime12(s.schedule.time)} ${st.timezone_abbr || ''}` : html`<span class="dot warn"></span> Off`}</dd>
          <dt>Last run</dt><dd>${run ? html`${run.status === 'failed' ? 'Failed' : 'Ran'} ${timeAgo(run.finished_at || run.started_at)} · ${run.sources_read != null ? `${run.sources_read} sources read, ${run.new_articles ?? 0} new` : run.stats?.collect ? `${run.stats.collect.sources} sources read, ${run.stats.collect.new} new` : 'no collect stage'} <a class="nowrap" href="#/runs/${run.id}">(run #${run.id})</a>` : 'No runs yet'}</dd>
          <dt>Engine</dt><dd>${p.active === 'claude' ? `Claude · ${p.model}` : p.active === 'ollama' ? 'Ollama (local)' : 'Template engine (free)'}${p.over_budget && p.budget_usd ? ' · budget reached' : ''}</dd>
          <dt>Watchlist</dt><dd>${plural(watch.length, 'item')} · <a href="#/sources/watchlists">edit</a></dd>
        </dl>
      </div>
    </div>`;
  };

  // SS1 (E1): the tab-change frame carries only the head, the section index and the overview. Every other
  // section is its own chunk, appended one task at a time after the swap with scheduler.yield() in between
  // (Priorities, Threshold, Schedule, AI provider, Budget, then the folded groups), so no task builds the page.
  const CHUNKS = [
    () => String(html`<p class="sg-group" aria-hidden="true">Ranking</p>
      ${section('sg-priorities', 'Priorities', html`Weight 0 ignores a topic, 1 is normal, 2 doubles it, below 0 de-emphasizes. Saving re-ranks the last 30 days.`, html`
        <div class="sg-prio-head" aria-hidden="true"><span>Topic</span><span>Weight</span><span>Terms</span><span></span></div>
        <div data-prios>${s.priorities.map((x, i) => html`<div class="sg-prio">
          <textarea class="input sg-ta" data-p="topic" rows="1" spellcheck="false" placeholder="Topic" aria-label="Topic ${i + 1}">${x.topic}</textarea>
          <div class="sg-w" data-sign="${sign(x.weight)}"><input type="range" min="-2" max="2" step="0.1" data-p="weight" value="${x.weight}" style="${raw(fillVars(x.weight))}" aria-label="Weight for ${x.topic || `topic ${i + 1}`}" aria-valuetext="${weightText(x.weight)}"><output class="sg-wv" data-sign="${sign(x.weight)}">${weightLabel(x.weight)}</output></div>
          <textarea class="input sg-ta" data-p="terms" rows="2" spellcheck="false" placeholder="comma-separated terms" aria-label="Terms for ${x.topic || `topic ${i + 1}`}">${(x.terms || []).join(', ')}</textarea>
          <button class="btn btn--ghost btn--icon btn--sm" type="button" data-act="rm-prio" data-i="${i}" aria-label="Remove ${x.topic || 'topic'}">${icon('x')}</button>
        </div>`)}</div>
        ${!s.priorities.length ? html`<div class="empty"><p>No priorities: every story will rank as a weak match.</p></div>` : ''}`,
        { save: 'priorities', headSave: true, extra: html`<button class="btn btn--secondary" type="button" data-act="add-prio">${icon('plus')}Add topic</button>` })}`),

    () => String(section('sg-threshold', 'Publishing threshold & brief', '', html`
        <div class="sg-thr">
          <label class="field">Publishing threshold (0–100)<input class="input" type="number" min="0" max="100" data-f="publish_threshold" value="${s.publish_threshold}"></label>
          <label class="field">Brief size (stories)<input class="input" type="number" min="1" max="20" data-f="brief_size" value="${s.brief_size}"></label>
          <p class="sg-help sg-thr-n">A story at or above the threshold gets an automatic draft; below it the day is “quiet”.${today?.ranked != null ? html` This week: <b>${today.cleared}</b> of ${today.ranked} ranked stories clear ${s.publish_threshold}.` : ''}</p>
        </div>`, { save: 'threshold', headSave: true })),

    () => String(html`<p class="sg-group" aria-hidden="true">Automation</p>
      ${section('sg-schedule', 'Schedule', 'Checked every minute; a failed run retries from its failed stage up to 3 times, 10 minutes apart.', html`
        <div class="sg-sched">
          <label class="sg-toggle"><input type="checkbox" class="switch" data-f="schedule_enabled" ${s.schedule?.enabled ? raw('checked') : ''}><span>Run the daily workflow automatically</span></label>
          <label class="field">Time (HH:MM)<input class="input" type="time" data-f="schedule_time" value="${s.schedule?.time || '07:00'}"></label>
          <label class="field">Time zone (any IANA name)<input class="input" data-f="timezone" list="tz-list" value="${s.timezone}" placeholder="e.g. America/New_York"></label>
        </div>
        <datalist id="tz-list">${ZONES.map(z => html`<option value="${z}">`)}</datalist>`, { save: 'schedule', headSave: true, cls: 'cv' })}`),

    () => String(section('sg-ai', 'AI provider', html`Set <span class="mono">ANTHROPIC_API_KEY</span> where the server runs (never in this app), then restart it.`, html`
        <p class="sg-status"><span class="dot ${p.has_key ? 'ok' : 'warn'}"></span>${p.has_key ? 'ANTHROPIC_API_KEY detected on the server' : 'ANTHROPIC_API_KEY not detected'} · active now: <b>${p.active === 'claude' ? 'Claude' : p.active === 'ollama' ? 'Ollama' : 'local engine'}</b></p>
        <div class="sg-ai4">
          <label class="field">Provider<select class="select" data-f="ai_provider">${[['local', 'Template engine (free, instant)'], ['ollama', 'Ollama local LLM (free)'], ['auto', 'Auto (Claude if key present)'], ['claude', 'Claude (paid, post-v1)']].map(([v, l]) => html`<option value="${v}"${s.ai?.provider === v ? raw(' selected') : ''}>${l}</option>`)}</select></label>
          <label class="field">Effort<select class="select" data-f="ai_effort">${['auto', 'low', 'medium', 'high'].map(v => html`<option value="${v}"${s.ai?.effort === v ? raw(' selected') : ''}>${v === 'auto' ? 'auto (per task)' : v}</option>`)}</select></label>
          <label class="field">Model<input class="input" data-f="ai_model" value="${s.ai?.model || ''}" placeholder="claude-…"></label>
          <label class="field">Ollama model<input class="input" data-f="ai_ollama_model" list="ollama-models" value="${s.ai?.ollama_model || 'qwen2.5:7b'}" placeholder="qwen2.5:7b"></label>
        </div>
        <datalist id="ollama-models"></datalist>
        <p class="sg-status" id="ollama-status"><span class="spinner"><i aria-hidden="true"></i>Checking for Ollama…</span></p>`, { save: 'ai', headSave: true, cls: 'cv' })),

    () => String(section('sg-budget', 'Budget', html`When spending reaches a limit above $0, Byline switches to the local engine automatically. A $0 limit keeps paid AI off. Per-run usage is on the <a href="#/runs">Runs</a> page.`, html`
        <div class="sg-grid2">
          <label class="field">Monthly spending limit (USD)<input class="input" type="number" min="0" step="0.5" data-f="budget" value="${s.budget?.monthly_usd ?? 0}"></label>
          <div class="sg-spend"><span class="sg-spend-l">Spent this month</span><span class="sg-spend-v">${money(p.month_spend_usd)}</span>${budgetState().tag}</div>
        </div>`, { save: 'budget', disc: budgetState().sum })),

    () => String(html`<div class="sg-folds cv">
      ${fold('Writing', html`
      ${section('sg-profile', 'Writing profile', 'Samples guide style only: Byline never invents experiences or opinions.', html`
        <div class="sg-grid4">
          <label class="field">Tone<input class="input" data-f="wp_tone" value="${wp.tone || ''}" placeholder="clear, curious, practical"></label>
          <label class="field">Length<select class="select" data-f="wp_length">${['short', 'medium', 'long'].map(v => html`<option value="${v}"${wp.length === v ? raw(' selected') : ''}>${v}</option>`)}</select></label>
          <label class="field">Depth<input class="input" data-f="wp_depth" list="depth-list" value="${wp.depth || ''}" placeholder="analytical"></label>
          <label class="field">Avoid<input class="input" data-f="wp_avoid" value="${wp.avoid || ''}" placeholder="hype, emojis, hashtag spam"></label>
        </div>
        <datalist id="depth-list"><option value="accessible"><option value="analytical"><option value="technical"><option value="deep-dive"></datalist>
        <p class="section-label sg-sub">Writing samples · ${wp.samples.length}</p>
        <p class="sg-help">Paste posts you’ve written so drafts match your voice.</p>
        <div class="sg-samples">${wp.samples.map((x, i) => html`<div class="sg-sample">
          <textarea class="textarea" data-sample="${i}" rows="3" aria-label="Writing sample ${i + 1}">${x}</textarea><button class="btn btn--ghost btn--icon btn--sm" type="button" data-act="rm-sample" data-i="${i}" aria-label="Remove sample ${i + 1}">${icon('x')}</button></div>`)}</div>`,
        { save: 'profile', extra: html`<button class="btn btn--secondary" type="button" data-act="add-sample">${icon('plus')}Add sample</button>` })}

      ${section('sg-editorial', 'Editorial rules', 'Counted toward the minimum: announcements, research and independent reporting. Commentary, community (Reddit, HN, podcasts) and applied sources (GitHub, jobs) inform ranking but don’t count. Project drafts are exempt; they rest on your own work.', html`
        <label class="sg-toggle"><input type="checkbox" class="switch" data-f="ed_numbers" ${s.editorial?.block_unsupported_numbers ? raw('checked') : ''}><span>Block approval when a number isn’t in the sources</span></label>
        <label class="sg-toggle"><input type="checkbox" class="switch" data-f="ed_hype" ${s.editorial?.block_hype ? raw('checked') : ''}><span>Block approval on hype words (otherwise just flag them)</span></label>
        <div class="sg-grid2"><label class="field">Minimum supporting sources to approve<input class="input" type="number" min="0" max="5" data-f="ed_min" value="${s.editorial?.min_independent_sources ?? 2}"></label></div>`, { save: 'editorial' })}

      ${section('sg-intro', 'Intro format', 'Inserted at the top of outreach drafts. Keep it factual.', html`
        <label class="field">One-line self-introduction used in outreach<textarea class="textarea" data-f="intro_format" rows="3">${s.intro_format || ''}</textarea></label>`, { save: 'intro' })}`)}

      ${fold('Publishing', html`
      ${section('sg-posting', 'Posting rhythm', 'Posting days drive “Next open slot” in Studio and the open slots in your calendar feed. The weekly roundup is drafted automatically on its day (once per week).', html`
        <fieldset class="sg-days"><legend class="field">Posting days</legend>${DAYS.map(d => html`<label class="sg-day"><input type="checkbox" data-day="${d}" ${(s.posting_days || []).includes(d) ? raw('checked') : ''}><span>${d}</span></label>`)}</fieldset>
        <div class="sg-grid2">
          <label class="field">Weekly roundup day<select class="select" data-f="roundup_day">${DAYS.map(d => html`<option${(s.schedule?.weekly_roundup_day || 'Fri') === d ? raw(' selected') : ''}>${d}</option>`)}</select></label>
          <label class="field">Outreach goal per week<input class="input" type="number" min="0" max="20" data-f="outreach_goal" value="${s.outreach_goal_per_week ?? 3}"></label>
        </div>`, { save: 'posting', extra: html`<button class="btn btn--secondary" type="button" data-act="roundup-now">Draft this week’s roundup now</button>` })}

      ${section('sg-delivery', 'Brief delivery', 'Sent after each daily run once the matching server variables are set.', html`
        <label class="sg-toggle"><input type="checkbox" class="switch" data-f="dl_email" ${s.delivery?.email ? raw('checked') : ''}><span>Email digest after each daily run</span></label>
        <p class="sg-note"><span class="dot ${st.delivery?.email?.configured ? 'ok' : ''}"></span>${st.delivery?.email?.note || ''}</p>
        <div class="sg-grid2"><label class="field">Send digest to<input class="input" type="email" data-f="dl_to" value="${s.delivery?.email_to || ''}" placeholder="you@example.com"></label></div>
        <label class="sg-toggle"><input type="checkbox" class="switch" data-f="dl_push" ${s.delivery?.push ? raw('checked') : ''}><span>Phone push notification</span></label>
        <p class="sg-note"><span class="dot ${st.delivery?.push?.configured ? 'ok' : ''}"></span>${st.delivery?.push?.note || ''}</p>`, { save: 'delivery' })}

      ${section('sg-media', 'Media', 'Off by default. While off, Byline never generates a synthetic voice or a likeness of you: videos use your own recordings, on-screen text and captions. Turning it on only makes the option available; each video still needs its own approval, and generated media is always labelled.', html`
        <label class="sg-toggle"><input type="checkbox" class="switch" data-f="synthetic" ${s.synthetic_media_opt_in ? raw('checked') : ''}><span>Allow synthetic narration and likeness in videos</span></label>`, { save: 'media', disc: facts()['sg-media'] })}`)}

      ${fold('System', html`
      ${section('sg-access', 'Calendar feed & access', 'Subscribe in Google Calendar (Other calendars → From URL) to see posting slots, planned posts, follow-ups and planned sends. Google must reach this address over the internet, so it works once Byline is behind your Cloudflare Tunnel (docs/DEPLOY.md). Treat the link like a password.', html`
        <div class="sg-inline"><input class="input mono" readonly id="ics" value="${location.origin}${st.ics_path}" aria-label="Calendar feed URL"><button class="btn btn--secondary" type="button" data-act="copy-ics">Copy</button></div>
        <p class="sg-status"><span class="dot ${st.auth ? 'ok' : 'warn'}"></span>${st.auth ? 'Password sign-in is on.' : 'No password set: fine on this computer. Set BYLINE_PASSWORD before reaching Byline from your phone or the internet; remote access is refused until you do.'}</p>
        ${st.auth ? html`<div class="sg-actions"><button class="btn btn--ghost btn--sm" type="button" data-act="logout">Sign out</button></div>` : ''}`, { disc: facts()['sg-access'] })}

      ${section('sg-display', 'Display', 'Saved in this browser only, so your phone and computer can differ. Also in the rail footer and the ⌘K Index.', html`
        <div class="sg-themes" role="radiogroup" aria-label="Theme">${[['light', 'Proof', 'Calm white. The default.'], ['dark', 'Night', 'Neutral graphite.'], ['system', 'Match system', 'Follow this device’s light or dark setting.']].map(([v, l, note]) => html`
          <label class="sg-theme" data-v="${v}"><input type="radio" name="byline-theme" data-theme-opt value="${v}" ${themePref() === v ? raw('checked') : ''}><span class="sg-theme-sw" aria-hidden="true"></span><span class="sg-theme-t"><b>${l}</b><span>${note}</span></span></label>`)}</div>`)}

      ${section('sg-security', 'Security', '', html`<div data-security></div>`)}

      ${section('sg-demo', 'Demo data', 'Fictional sample sources, stories and drafts, clearly labelled Demo, for trying the full flow without credentials.', html`
        <p class="sg-status">${st.counts?.demo_articles ? html`<span class="tag tag--demo">Loaded</span> ${st.counts.demo_articles} demo articles present.` : 'Not loaded.'}</p>`,
        { extra: html`<button class="btn btn--secondary" type="button" data-act="demo-load">Load demo data</button><button class="btn btn--danger" type="button" data-act="demo-clear" ${st.counts?.demo_articles ? '' : raw('disabled')}>Remove demo data</button>` })}

      ${section('sg-about', 'About', '', html`<p class="sg-help">Byline v4. Type: Newsreader, Geist and Geist Mono (SIL Open Font License), self-hosted. Zero runtime dependencies.</p>`)}`)}
      </div>`)
  ];
  let restP = null, paintSeq = 0;
  const paint = ({ rest = true } = {}) => {
    const hd = headline(s, st, today, watch, summary);
    paintSeq++;
    restP = rest ? Promise.resolve() : null;
    el.innerHTML = String(html`
    <header class="page-head">
      <p class="eyebrow">Control · each section saves on its own</p>
      <h1>${hd.h}</h1>
      <p class="lede">${hd.l}</p>
    </header>
    <div class="sg-layout">
      <nav class="sg-toc" aria-label="Settings sections">${TOC.map(([g, items]) => html`<p class="sg-toc-g">${g}</p>${items.map(([id, t]) => html`<a href="#${id}" class="sg-toc-a" data-goto="${id}">${t}</a>`)}`)}</nav>
      <div class="sg-main">
      ${section('sg-overview', 'Source health & status', '', healthHtml())}
      <div class="sg-rest" data-sg-rest>${raw(rest ? CHUNKS.map(c => c()).join('') : '')}</div>
      </div>
    </div>`);
    paintSecurity();
    spy();
  };
  // Append the remaining sections, one task each. A full repaint (save, add/remove) cancels a pump in flight.
  const paintRest = () => restP ||= (async () => {
    const seq = paintSeq, box = el.querySelector('[data-sg-rest]');
    for (let i = 0; i < CHUNKS.length; i++) {
      if (i) await yieldTask();
      if (seq !== paintSeq || !box.isConnected) return;
      const before = box.children.length;
      box.insertAdjacentHTML('beforeend', CHUNKS[i]());
      // the first two land in view on desktop: a short settle, never on the off-screen ones
      if (i < 2) enterItems([...box.children].slice(before).filter(x => !x.matches('.sg-group')), { stagger: 40, y: 6, duration: 420 });
      if (i === 3) checkOllama();
    }
    paintSecurity();
    spy();
    markClipped();
  })();

  // G4: section-nav highlight from one IntersectionObserver on .sg-sec (and closed folds, which stand in for
  // their sections): the topmost intersecting element inside the band 80 px below the top to 60% down wins.
  let io = null, spyHold = 0, spyCur = '';
  const setCurrent = (id) => {
    if (!id || id === spyCur) return;
    spyCur = id;
    el.querySelectorAll('[data-goto]').forEach(a => { if (a.dataset.goto === id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
  };
  const spy = () => {
    io?.disconnect();
    spyCur = '';
    if (!('IntersectionObserver' in window)) return;
    const live = new Map(); // target → visible height inside the band
    io = new IntersectionObserver((entries) => {
      for (const en of entries) { if (en.isIntersecting) live.set(en.target, en.intersectionRect.height); else live.delete(en.target); }
      if (Date.now() < spyHold || !live.size) return;
      // topmost intersecting section, except one whose last few pixels are just leaving the band's top edge
      let top = null, any = null;
      for (const [t, h] of live) {
        if (!any || (any.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING)) any = t;
        if (h >= 40 && (!top || (top.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING))) top = t;
      }
      top ||= any;
      setCurrent(top.dataset.fold ? TOC.find(x => x[0] === top.dataset.fold)[1][0][0] : top.id);
    }, { rootMargin: '-80px 0px -60% 0px', threshold: [0, 0.02, 0.05, 0.1, 0.25, 0.5, 1] });
    el.querySelectorAll('.sg-sec').forEach(x => { if (!x.closest('.sg-fold-b[hidden]')) io.observe(x); });
    el.querySelectorAll('.sg-fold:not(.is-open)').forEach(x => io.observe(x));
  };
  const scrollToSec = (id, { focus = true } = {}) => {
    const t = el.querySelector(`#${id}`);
    if (!t) return;
    spyHold = Date.now() + 900;
    setCurrent(id);
    t.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    if (focus) { const h = t.querySelector('h2'); h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  };
  const setFold = (g, open, { animate = true } = {}) => {
    const box = el.querySelector(`[data-fold="${g}"]`);
    if (!box || openFolds.has(g) === open) return;
    if (open) openFolds.add(g); else openFolds.delete(g);
    box.classList.toggle('is-open', open); box.classList.toggle('tile', !open); box.classList.toggle('tile--static', !open);
    box.querySelector('[data-fold-head]').innerHTML = String(foldHead(g));
    const body = box.querySelector('.sg-fold-b');
    if (open && !body.firstElementChild) { body.innerHTML = foldBodies[g]; if (g === 'System') paintSecurity(); }
    body.hidden = !open;
    if (open && animate && !reduced()) body.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE.fade });
    spy();
  };
  // SS3: open / close one disclosure section (Budget, Calendar feed & access, Media)
  const setDisc = (id, open, { animate = true } = {}) => {
    const sec = el.querySelector(`[data-disc="${id}"]`);
    if (!sec || openDisc.has(id) === open) return;
    if (open) openDisc.add(id); else openDisc.delete(id);
    sec.classList.toggle('is-open', open);
    const b = sec.querySelector('[data-disc-toggle]');
    b.setAttribute('aria-expanded', String(open));
    b.querySelector('[data-disc-word]').textContent = open ? 'Hide' : 'Show';
    const body = sec.querySelector('.sg-disc-b');
    body.hidden = !open;
    if (open && animate && !reduced()) body.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 280, easing: EASE.fade });
  };
  // open the fold (and disclosure) holding a section (from the nav, the ⌘K Index or the route), then go there
  const reveal = async (id, opts) => {
    await paintRest();
    const g = SEC_GROUP[id];
    if (FOLDED[g] && !openFolds.has(g)) setFold(g, true, { animate: false });
    if (el.querySelector(`[data-disc="${id}"]`)) setDisc(id, true, { animate: false });
    scrollToSec(id, opts);
  };
  on(el, 'click', '[data-disc-head]', (e, h) => {
    if (e.target.closest('a, input, select, textarea') || (e.target.closest('button') && !e.target.closest('[data-disc-toggle]'))) return;
    const id = h.dataset.discHead;
    setDisc(id, !openDisc.has(id));
    el.querySelector(`[data-disc-toggle="${id}"]`)?.focus({ preventScroll: true });
  });
  on(el, 'click', '[data-goto]', (e, a) => { e.preventDefault(); reveal(a.dataset.goto); });
  on(el, 'click', '[data-open-sec]', (e, b) => reveal(b.dataset.openSec));
  on(el, 'click', '[data-fold-toggle]', (e, b) => {
    const g = b.dataset.foldToggle, open = !openFolds.has(g);
    setFold(g, open);
    el.querySelector(`[data-fold-toggle="${g}"]`)?.focus({ preventScroll: true });
    if (!open) el.querySelector(`[data-fold="${g}"]`).scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  });
  // The ⌘K Index (app.js gotoSettings) scrolls to and focuses the first heading named like the section;
  // for a folded section that is the h3 in the fold head, so open the fold and continue to the section.
  el.addEventListener('focusin', (e) => {
    const h = e.target.closest?.('.sg-fold-i'); if (h && e.target === h) { requestAnimationFrame(() => reveal(h.dataset.for)); return; }
    const d = e.target.matches?.('.sg-disc > .sg-disc-head > .sg-h') && e.target.closest('[data-disc]'); if (d) setDisc(d.dataset.disc, true);
  });

  // Repaint while keeping unsaved edits in other sections.
  const repaint = () => {
    const keep = [...el.querySelectorAll('[data-f]')].map(i => [i.dataset.f, i.type === 'checkbox' ? i.checked : i.value]);
    const days = [...el.querySelectorAll('[data-day]')].map(i => [i.dataset.day, i.checked]);
    const y = window.scrollY;
    paint();
    for (const [f, v] of keep) { const i = el.querySelector(`[data-f="${f}"]`); if (i) i.type === 'checkbox' ? (i.checked = v) : (i.value = v); }
    for (const [d, v] of days) { const i = el.querySelector(`[data-day="${d}"]`); if (i) i.checked = v; }
    window.scrollTo({ top: y, behavior: 'instant' });
    checkOllama();
    markClipped();
  };
  paint({ rest: false });
  {
    const onRouted = (e) => { if (e.detail?.page?.contains(el)) { document.removeEventListener('byline:routed', onRouted); requestAnimationFrame(() => setTimeout(paintRest, 0)); } };
    if (view.closest?.('.page.current') || view.classList?.contains('current')) setTimeout(paintRest, 0);
    else { document.addEventListener('byline:routed', onRouted); setTimeout(() => { document.removeEventListener('byline:routed', onRouted); paintRest(); }, 2500); }
  }
  const target = String((ctx.params || [])[0] || "");
  if (target) {
    const g = Object.keys(FOLDED).find(k => k.toLowerCase() === target.toLowerCase() || FOLDED[k] === target);
    const id = g ? null : (SEC_GROUP[target] ? target : SEC_GROUP[`sg-${target}`] ? `sg-${target}` : null);
    const go = async () => { await paintRest(); if (g) { setFold(g, true, { animate: false }); el.querySelector(`[data-fold="${g}"]`)?.scrollIntoView({ block: 'start' }); } else if (id) reveal(id, { focus: false }); };
    const onRouted = (e) => { if (e.detail?.page?.contains(el)) { document.removeEventListener('byline:routed', onRouted); requestAnimationFrame(() => setTimeout(go, 0)); } };
    if (g || id) { document.addEventListener('byline:routed', onRouted); setTimeout(() => document.removeEventListener('byline:routed', onRouted), 4000); }
  }
  const checkOllama = () => api.get('/ollama').then(o => {
    const box = el.querySelector('#ollama-status'); if (!box) return;
    box.innerHTML = o.reachable ? `<span class="dot ok"></span>Ollama is running · ${o.models.length} model(s): ${o.models.join(', ') || 'none; run “ollama pull qwen2.5:7b”'}`
      : '<span class="dot"></span>Ollama not detected: install it free from ollama.com, run <span class="mono">ollama pull qwen2.5:7b</span>, then pick “Ollama” above.';
    el.querySelector('#ollama-models').innerHTML = o.models.map(m => `<option value="${m}">`).join('');
  }).catch(() => { const box = el.querySelector('#ollama-status'); if (box) box.innerHTML = '<span class="dot"></span>Couldn’t check for Ollama.'; });
  checkOllama();
  loadSecurity();
  on(el, 'change', '[data-theme-opt]', (e, r) => { applyTheme(r.value); const f = el.querySelector('[data-fact="sg-display"]'); if (f) f.textContent = facts()['sg-display']; toast(`Theme: ${r.closest('label').querySelector('b').textContent}`, 'ok'); });

  const val = (f) => el.querySelector(`[data-f="${f}"]`);
  const builders = {
    priorities: () => {
      const pr = readPriorities();
      if (pr.some(x => !x.topic)) throw new Error('Every priority needs a topic name.');
      if (pr.some(x => !x.terms.length)) throw new Error('Every priority needs at least one term.');
      return { priorities: pr };
    },
    threshold: () => {
      const t = Number(val('publish_threshold').value), b = Number(val('brief_size').value);
      if (!(t >= 0 && t <= 100)) throw new Error('Threshold must be between 0 and 100.');
      if (!(b >= 1 && b <= 20 && Number.isInteger(b))) throw new Error('Brief size must be a whole number from 1 to 20.');
      return { publish_threshold: t, brief_size: b };
    },
    schedule: () => {
      const tz = val('timezone').value.trim(), time = val('schedule_time').value;
      if (!validZone(tz)) throw new Error(`“${tz}” is not a valid IANA time zone.`);
      if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('Time must be HH:MM.');
      return { schedule: { ...s.schedule, enabled: val('schedule_enabled').checked, time }, timezone: tz };
    },
    ai: () => ({ ai: { ...s.ai, provider: val('ai_provider').value, model: val('ai_model').value.trim() || s.ai.model, effort: val('ai_effort').value, ollama_model: val('ai_ollama_model').value.trim() || 'qwen2.5:7b' } }),
    budget: () => {
      const b = Number(val('budget').value);
      if (!(b >= 0)) throw new Error('Budget must be zero or more.');
      return { budget: { ...s.budget, monthly_usd: b } };
    },
    profile: () => ({ writing_profile: { ...wp, tone: val('wp_tone').value.trim(), length: val('wp_length').value, depth: val('wp_depth').value.trim(), avoid: val('wp_avoid').value.trim(), samples: readSamples().map(x => x.trim()).filter(Boolean) } }),
    intro: () => ({ intro_format: val('intro_format').value.trim() }),
    media: () => ({ synthetic_media_opt_in: val('synthetic').checked }),
    editorial: () => {
      const n = Number(val('ed_min').value);
      if (!(n >= 0 && n <= 5 && Number.isInteger(n))) throw new Error('Minimum sources must be a whole number from 0 to 5.');
      return { editorial: { block_unsupported_numbers: val('ed_numbers').checked, block_hype: val('ed_hype').checked, min_independent_sources: n } };
    },
    posting: () => {
      const days = [...el.querySelectorAll('[data-day]:checked')].map(i => i.dataset.day);
      if (!days.length) throw new Error('Pick at least one posting day.');
      return { posting_days: days, schedule: { ...s.schedule, weekly_roundup_day: val('roundup_day').value }, outreach_goal_per_week: Number(val('outreach_goal').value) || 0 };
    },
    delivery: () => {
      const to = val('dl_to').value.trim();
      if (val('dl_email').checked && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new Error('Enter the email address for the digest.');
      return { delivery: { email: val('dl_email').checked, push: val('dl_push').checked, email_to: to } };
    }
  };

  on(el, 'input', '[data-p=weight]', (e, r) => {
    const o = r.nextElementSibling, v = Number(r.value);
    o.textContent = weightLabel(v); o.dataset.sign = r.parentElement.dataset.sign = sign(v);
    r.style.cssText = fillVars(v); r.setAttribute('aria-valuetext', weightText(v));
  });
  // SE-1 (R24): Topic and Terms are auto-height textareas: at most 2 lines at rest, the full value on focus. Sized by CSS
  // (field-sizing: content + a 2-line max-height); where that is unsupported, one scrollHeight read per focus or
  // edit sets the height (no measuring loop). Enter never adds a line: the value stays one comma-separated list.
  const fieldSizing = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content');
  const fitTa = (t) => { t.style.height = 'auto'; t.style.height = `${t.scrollHeight + 2}px`; };
  on(el, 'keydown', '.sg-ta', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  // A box still longer than 2 lines at rest (only on narrow desktops) fades its last line, so a cut list never
  // reads as complete. One read per box, once per paint, resize or blur; never in the tab-change frames.
  const clipOne = (t) => t.classList.toggle('is-clipped', document.activeElement !== t && t.scrollHeight > t.clientHeight + 1);
  let clipRaf = 0;
  const markClipped = () => { cancelAnimationFrame(clipRaf); clipRaf = requestAnimationFrame(() => el.querySelectorAll('.sg-ta').forEach(clipOne)); };
  el.addEventListener('focusout', (e) => { if (e.target.matches?.('.sg-ta')) requestAnimationFrame(() => clipOne(e.target)); });
  el.addEventListener('focusin', (e) => { if (e.target.matches?.('.sg-ta')) e.target.classList.remove('is-clipped'); });
  let clipT = 0;
  const onResize = () => { if (!el.isConnected) { removeEventListener('resize', onResize); return; } clearTimeout(clipT); clipT = setTimeout(markClipped, 200); };
  addEventListener('resize', onResize, { passive: true });
  if (!fieldSizing) {
    el.addEventListener('focusin', (e) => { if (e.target.matches?.('.sg-ta')) fitTa(e.target); });
    el.addEventListener('focusout', (e) => { if (e.target.matches?.('.sg-ta')) e.target.style.height = ''; });
    on(el, 'input', '.sg-ta', (e, t) => fitTa(t));
  }
  // G2: the first edit in a section promotes its Save to primary and shows "Unsaved changes"
  const markDirty = (key, on = true) => {
    if (!key) return;
    if (on) dirty.add(key); else dirty.delete(key);
    const b = el.querySelector(`[data-save="${key}"]`), n = el.querySelector(`[data-dirty-note="${key}"]`);
    if (b) { b.classList.toggle('btn--primary', on); b.classList.toggle('btn--secondary', !on); }
    if (n) n.hidden = !on;
  };
  const onEdit = (e) => { if (e.target.closest('[data-theme-opt]')) return; const sec = e.target.closest('[data-sg-sec]'); markDirty(sec?.querySelector('[data-save]')?.dataset.save); };
  el.addEventListener('input', onEdit);
  el.addEventListener('change', onEdit);
  on(el, 'click', '[data-save]', async (e, btn) => {
    await act(btn, async () => {
      const body = builders[btn.dataset.save]();
      const saved = await api.put('/settings', body);
      Object.assign(s, saved);
      Object.assign(wp, saved.writing_profile);
      toast('Settings saved', 'ok');
      markDirty(btn.dataset.save, false);
      if (['schedule', 'ai', 'budget', 'threshold', 'priorities'].includes(btn.dataset.save)) {
        refreshStatus({ force: true });
        [st, today] = await Promise.all([api.get('/status', { fresh: true }), api.get('/today', { fresh: true }).catch(() => today)]);
        p = st.provider;
        if (btn.dataset.save === 'threshold' && window.__byline) window.__byline.threshold = s.publish_threshold;
        repaint();
        el.querySelector(`[data-save="${btn.dataset.save}"]`)?.focus({ preventScroll: true });
      }
    }, 'Saving…', { done: 'Saved' });
  });
  on(el, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'add-prio' || a === 'rm-prio') {
      s.priorities = readPriorities();
      dirty.add('priorities');
      if (a === 'add-prio') s.priorities.push({ topic: '', weight: 1, terms: [] });
      else s.priorities.splice(Number(btn.dataset.i), 1);
      wp.samples = readSamples();
      repaint();
      if (a === 'add-prio') el.querySelectorAll('[data-p=topic]')[s.priorities.length - 1]?.focus();
      else el.querySelector('[data-act="add-prio"]')?.focus({ preventScroll: true });
    }
    if (a === 'add-sample' || a === 'rm-sample') {
      wp.samples = readSamples();
      s.priorities = readPriorities();
      dirty.add('profile');
      if (a === 'add-sample') wp.samples.push(''); else wp.samples.splice(Number(btn.dataset.i), 1);
      repaint();
      if (a === 'add-sample') [...el.querySelectorAll('[data-sample]')].pop()?.focus();
      else el.querySelector('[data-act="add-sample"]')?.focus({ preventScroll: true });
    }
    if (a === 'copy-ics') { const i = el.querySelector('#ics'); i.select(); try { await navigator.clipboard.writeText(i.value); toast('Calendar link copied', 'ok'); } catch { document.execCommand('copy'); } }
    if (a === 'totp-begin') await act(btn, async () => { enrolling = await api.post('/security/totp/begin'); paintSecurity(); el.querySelector('[data-code="confirm"]')?.focus(); }, 'Starting…');
    if (a === 'totp-cancel') { enrolling = null; paintSecurity(); }
    if (a === 'copy-otpauth' && enrolling) { await copy(enrolling.otpauth); }
    if (a === 'copy-key' && enrolling) { await copy(enrolling.secret); }
    if (a === 'totp-confirm') await act(btn, async () => {
      await api.post('/security/totp/confirm', { code: codeVal('confirm') });
      enrolling = null; toast('Two-step sign-in is on', 'ok'); await loadSecurity();
    }, 'Checking…');
    if (a === 'totp-disable') {
      let code; try { code = codeVal('disable'); } catch (err) { toast(err.message, 'err'); return; }
      if (await confirmBox('Turn off two-step sign-in? Signing in will need only the password.', 'Turn off')) await act(btn, async () => {
        await api.post('/security/totp/disable', { code }); toast('Two-step sign-in is off', 'ok'); await loadSecurity();
      }, 'Turning off…');
    }
    if (a === 'logout') { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; }
    if (a === 'roundup-now') await act(btn, async () => { const r = await api.post('/weekly-roundup', {}); if (r.draft_id) location.hash = `#/draft/${r.draft_id}`; else toast(r.reason, 'err'); }, 'Drafting…');
    if (a === 'demo-load') await act(btn, async () => { await api.post('/demo/load'); toast('Demo data loaded (fictional, labelled Demo)', 'ok'); refreshStatus({ force: true }); render(view); }, 'Loading…');
    if (a === 'demo-clear' && await confirmBox('Remove all demo sources, stories, drafts and related records? Your own data is kept.', 'Remove demo data')) await act(btn, async () => {
      await api.del('/demo'); toast('Demo data removed', 'ok'); refreshStatus({ force: true }); render(view);
    }, 'Removing…');
  });
}
