import { api } from '../api.js';
import { html, on, act, toast, confirmBox, copy } from '../ui.js';
import { refreshStatus } from '../app.js';

const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu',
  'America/Toronto', 'America/Sao_Paulo', 'Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Africa/Lagos', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Seoul', 'Australia/Sydney', 'Pacific/Auckland', 'UTC'];
const splitTerms = (s) => s.split(',').map(t => t.trim()).filter(Boolean);
const validZone = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

export async function render(view) {
  let [s, st] = await Promise.all([api.get('/settings'), api.get('/status')]);
  const el = document.createElement('div');
  view.replaceChildren(el);
  let p = st.provider;
  const wp = s.writing_profile || {};
  wp.samples ||= [];

  // Read the editable lists (priorities, samples) back from the DOM so add/remove keeps unsaved edits.
  const readPriorities = () => [...el.querySelectorAll('.prio-row')].map(r => ({
    topic: r.querySelector('[data-p=topic]').value.trim(), weight: Number(r.querySelector('[data-p=weight]').value), terms: splitTerms(r.querySelector('[data-p=terms]').value)
  }));
  const readSamples = () => [...el.querySelectorAll('[data-sample]')].map(t => t.value);

  // Display: Night (default) / Proof / Match system. Stored per browser.
  const themePref = () => { try { return localStorage.getItem('byline-theme') || 'dark'; } catch { return 'dark'; } };
  const applyTheme = (v) => {
    try { localStorage.setItem('byline-theme', v); } catch { /* storage unavailable */ }
    if (window.__byline?.setTheme) return window.__byline.setTheme(v);
    if (v === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
  };

  // Security: status plus TOTP enrollment. The secret is shown only during enrollment, never afterwards.
  let sec = null, enrolling = null;
  const loadSecurity = () => api.get('/security').then(x => { sec = x; paintSecurity(); }).catch(() => {});
  const codeInput = (name, label) => html`<label class="field">${label}<input class="mono" data-code="${name}" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="6 digits" style="display:block;width:12ch;letter-spacing:.2em"></label>`;
  const paintSecurity = () => {
    const box = el.querySelector('[data-security]'); if (!box) return;
    if (!sec) { box.innerHTML = '<span class="spinner"></span> Checking…'; return; }
    const required = sec.totp_always ? 'at every sign-in' : 'when Byline is reached through a tunnel, proxy or another device';
    box.innerHTML = String(html`
      <p class="small" style="margin-top:0"><span class="dot ${sec.password_set ? 'ok' : 'warn'}"></span>${sec.password_set ? 'Password sign-in is on.' : 'No password set (BYLINE_PASSWORD). Two-step sign-in only applies once a password is set.'}</p>
      <p class="small"><span class="dot ${sec.totp_enabled ? 'ok' : ''}"></span>${sec.totp_enabled
        ? html`Two-step sign-in is on${sec.totp_source === 'env' ? html` (set by <span class="mono">BYLINE_TOTP_SECRET</span>)` : ''}. A code is asked for ${required}.`
        : 'Two-step sign-in is off.'}${sec.totp_required_now ? html` <span class="chip">needed from here</span>` : ''}</p>
      ${enrolling ? html`
        <div class="label" style="margin:14px 0 6px">1 · ADD BYLINE TO YOUR AUTHENTICATOR APP</div>
        <p class="muted small" style="margin-top:0">Choose “enter a setup key” and type the key below (time-based, 6 digits), or paste the setup link into an app that accepts one.</p>
        <div class="mono" data-totp-key style="font-size:var(--fs-md);letter-spacing:.06em;word-spacing:.3em;line-height:1.6;user-select:all">${enrolling.secret.replace(/(.{4})(?=.)/g, '$1 ')}</div>
        <div class="row" style="margin-top:8px"><input readonly data-otpauth value="${enrolling.otpauth}" aria-label="Setup link (otpauth)" class="mono small" style="flex:1 1 220px;min-width:0"><button class="sm" type="button" data-act="copy-otpauth">Copy link</button><button class="sm" type="button" data-act="copy-key">Copy key</button></div>
        <div class="label" style="margin:14px 0 6px">2 · CONFIRM WITH A CODE</div>
        <div class="row" style="align-items:flex-end">${codeInput('confirm', 'Code from the app')}<button class="primary" type="button" data-act="totp-confirm">Turn on</button><button class="ghost" type="button" data-act="totp-cancel">Cancel</button></div>
      ` : sec.totp_enabled && sec.totp_source !== 'env' ? html`
        <div class="row" style="align-items:flex-end;margin-top:10px">${codeInput('disable', 'Current code')}<button class="danger" type="button" data-act="totp-disable">Turn off two-step sign-in</button></div>
      ` : !sec.totp_enabled ? html`
        <div class="row" style="margin-top:10px"><button class="primary" type="button" data-act="totp-begin">Set up two-step sign-in</button></div>
      ` : ''}
      <p class="set-note">Works with any authenticator app (1Password, Google Authenticator, Authy, Bitwarden). Set <span class="mono">BYLINE_TOTP_ALWAYS=1</span> to ask for a code on this computer too.</p>`);
  };
  const codeVal = (name) => {
    const v = (el.querySelector(`[data-code="${name}"]`)?.value || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(v)) throw new Error('Enter the 6-digit code from your authenticator app.');
    return v;
  };

  const paint = () => {
    el.innerHTML = String(html`
    <div class="page-head">
      <div>
        <div class="kicker">Control</div>
        <h1>Settings</h1>
        <p class="lede">What Byline pays attention to, when it runs, how it writes, and what it may spend. Each section saves on its own.</p>
      </div>
    </div>

    <div class="grid g2 reveal" style="align-items:start">
      <section class="card ledger" style="grid-column:1 / -1">
        <div class="row between"><h3>Priorities</h3><span class="mono faint">weight 0 = ignore · 1 = normal · 2 = double</span></div>
        <p class="muted small" style="margin-top:0">Topics and the terms that signal them. Saving re-ranks the last 30 days of stories.</p>
        <div data-prios>${s.priorities.map((x, i) => html`<div class="prio-row">
          <input data-p="topic" value="${x.topic}" placeholder="Topic" aria-label="Topic">
          <div class="row" style="flex-wrap:nowrap"><input type="range" min="-2" max="2" step="0.1" data-p="weight" value="${x.weight}" aria-label="Weight"><span class="w">${Number(x.weight).toFixed(1)}</span></div>
          <input data-p="terms" value="${(x.terms || []).join(', ')}" placeholder="comma-separated terms" aria-label="Terms">
          <button class="sm danger" type="button" data-act="rm-prio" data-i="${i}" aria-label="Remove topic">Remove</button>
        </div>`)}</div>
        ${!s.priorities.length ? html`<div class="empty">No priorities — every story will rank as a weak match.</div>` : ''}
        <div class="row" style="margin-top:12px"><button type="button" data-act="add-prio">+ Add topic</button><button class="primary" data-save="priorities">Save priorities</button></div>
      </section>

      <section class="card">
        <h3>Publishing threshold & brief</h3>
        <div class="form-grid">
          <label class="field">Publishing threshold (0–100)<input type="number" min="0" max="100" data-f="publish_threshold" value="${s.publish_threshold}"></label>
          <label class="field">Brief size (stories)<input type="number" min="1" max="20" data-f="brief_size" value="${s.brief_size}"></label>
        </div>
        <p class="set-note">A story must score at least the threshold to get an automatic draft. Below it, the day is “quiet” and nothing is drafted.</p>
        <div class="row" style="margin-top:12px"><button class="primary" data-save="threshold">Save</button></div>
      </section>

      <section class="card">
        <h3>Schedule</h3>
        <label class="check"><input type="checkbox" data-f="schedule_enabled" ${s.schedule?.enabled ? 'checked' : ''}> Run the daily workflow automatically</label>
        <div class="form-grid" style="margin-top:10px">
          <label class="field">Time (HH:MM)<input type="time" data-f="schedule_time" value="${s.schedule?.time || '07:00'}"></label>
          <label class="field">Time zone<input data-f="timezone" list="tz-list" value="${s.timezone}" placeholder="e.g. America/New_York"></label>
        </div>
        <datalist id="tz-list">${ZONES.map(z => html`<option value="${z}">`)}</datalist>
        <p class="set-note">The server checks every minute; a failed scheduled run is retried from its failed stage up to 3 times, 10 minutes apart. Any IANA zone name works.</p>
        <div class="row" style="margin-top:12px"><button class="primary" data-save="schedule">Save</button></div>
      </section>

      <section class="card">
        <h3>AI provider</h3>
        <div class="row" style="margin-bottom:10px"><span class="dot ${p.has_key ? 'ok' : 'warn'}"></span>
          <span class="small">${p.has_key ? 'ANTHROPIC_API_KEY detected on the server' : 'ANTHROPIC_API_KEY not detected'} · active now: <strong>${p.active === 'claude' ? 'Claude' : 'local engine'}</strong></span></div>
        <div class="form-grid">
          <label class="field">Provider<select data-f="ai_provider">${[['local', 'Template engine (free, instant)'], ['ollama', 'Ollama local LLM (free)'], ['auto', 'Auto (Claude if key present)'], ['claude', 'Claude (paid, post-v1)']].map(([v, l]) => html`<option value="${v}" ${s.ai?.provider === v ? 'selected' : ''}>${l}</option>`)}</select></label>
          <label class="field">Effort<select data-f="ai_effort">${['auto', 'low', 'medium', 'high'].map(v => html`<option value="${v}" ${s.ai?.effort === v ? 'selected' : ''}>${v === 'auto' ? 'auto (per task)' : v}</option>`)}</select></label>
          <label class="field full">Model<input data-f="ai_model" value="${s.ai?.model || ''}" placeholder="claude-…"></label>
          <label class="field full">Ollama model<input data-f="ai_ollama_model" list="ollama-models" value="${s.ai?.ollama_model || 'qwen2.5:7b'}" placeholder="qwen2.5:7b"></label>
          <datalist id="ollama-models"></datalist>
          <div class="full small" id="ollama-status"><span class="spinner"></span> Checking for Ollama…</div>
        </div>
        <p class="set-note">The API key is never entered in this app. Set <span class="mono">ANTHROPIC_API_KEY</span> as an environment variable where the server runs, then restart it. Without a key (or over budget) Byline uses its free local engine.</p>
        <div class="row" style="margin-top:12px"><button class="primary" data-save="ai">Save</button></div>
      </section>

      <section class="card">
        <h3>Budget</h3>
        <label class="field">Monthly spending limit (USD)<input type="number" min="0" step="0.5" data-f="budget" value="${s.budget?.monthly_usd ?? 0}"></label>
        <p class="small" style="margin:10px 0 0">Spent this month: <strong>$${(p.month_spend_usd || 0).toFixed(4)}</strong>${p.over_budget ? html` <span class="chip red">limit reached</span>` : ''}</p>
        <p class="set-note">When spending reaches the limit, Byline switches to the local engine automatically. Per-run usage is on the <a href="#/runs">Runs</a> page.</p>
        <div class="row" style="margin-top:12px"><button class="primary" data-save="budget">Save</button></div>
      </section>

      <section class="card" style="grid-column:1 / -1">
        <h3>Writing profile</h3>
        <div class="form-grid">
          <label class="field">Tone<input data-f="wp_tone" value="${wp.tone || ''}" placeholder="clear, curious, practical"></label>
          <label class="field">Length<select data-f="wp_length">${['short', 'medium', 'long'].map(v => html`<option value="${v}" ${wp.length === v ? 'selected' : ''}>${v}</option>`)}</select></label>
          <label class="field">Depth<input data-f="wp_depth" list="depth-list" value="${wp.depth || ''}" placeholder="analytical"></label>
          <label class="field">Avoid<input data-f="wp_avoid" value="${wp.avoid || ''}" placeholder="hype, emojis, hashtag spam"></label>
        </div>
        <datalist id="depth-list"><option value="accessible"><option value="analytical"><option value="technical"><option value="deep-dive"></datalist>
        <div class="label" style="margin:14px 0 6px">WRITING SAMPLES (${wp.samples.length})</div>
        <p class="muted small" style="margin-top:0">Paste posts you’ve written so drafts match your voice. Samples guide style only — Byline never invents experiences or opinions.</p>
        <div class="stack">${wp.samples.map((x, i) => html`<div class="row" style="align-items:flex-start;flex-wrap:nowrap">
          <textarea data-sample="${i}" rows="3" style="flex:1">${x}</textarea><button class="sm danger" type="button" data-act="rm-sample" data-i="${i}">Remove</button></div>`)}</div>
        <div class="row" style="margin-top:12px"><button type="button" data-act="add-sample">+ Add sample</button><button class="primary" data-save="profile">Save writing profile</button></div>
      </section>

      <section class="card">
        <h3>Editorial rules</h3>
        <label class="check"><input type="checkbox" data-f="ed_numbers" ${s.editorial?.block_unsupported_numbers ? 'checked' : ''}> Block approval when a number isn’t in the sources</label><br>
        <label class="check" style="margin-top:6px"><input type="checkbox" data-f="ed_hype" ${s.editorial?.block_hype ? 'checked' : ''}> Block approval on hype words (otherwise just flag them)</label>
        <label class="field" style="margin-top:10px">Minimum credible independent sources to approve<input type="number" min="0" max="5" data-f="ed_min" value="${s.editorial?.min_independent_sources ?? 2}"></label>
        <p class="set-note">Credible = announcement, research, or independent reporting. Commentary, community (Reddit, HN, podcasts) and applied sources (GitHub, jobs) inform ranking but don’t count. Project drafts are exempt — they rest on your own work.</p>
        <div class="row" style="margin-top:12px"><button class="primary" data-save="editorial">Save</button></div>
      </section>

      <section class="card">
        <h3>Posting rhythm</h3>
        <div class="row">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => html`<label class="check"><input type="checkbox" data-day="${d}" ${(s.posting_days || []).includes(d) ? 'checked' : ''}> ${d}</label>`)}</div>
        <div class="form-grid" style="margin-top:10px">
          <label class="field">Weekly roundup day<select data-f="roundup_day">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => html`<option ${(s.schedule?.weekly_roundup_day || 'Fri') === d ? 'selected' : ''}>${d}</option>`)}</select></label>
          <label class="field">Outreach goal per week<input type="number" min="0" max="20" data-f="outreach_goal" value="${s.outreach_goal_per_week ?? 3}"></label>
        </div>
        <p class="set-note">Posting days drive “Next open slot” in the studio and the open slots in your calendar feed. The weekly roundup is drafted automatically on its day (once per week).</p>
        <div class="row" style="margin-top:12px"><button class="primary" data-save="posting">Save</button><button type="button" data-act="roundup-now">Draft this week’s roundup now</button></div>
      </section>

      <section class="card">
        <h3>Brief delivery</h3>
        <label class="check"><input type="checkbox" data-f="dl_email" ${s.delivery?.email ? 'checked' : ''}> Email digest after each daily run</label>
        <div class="small faint" style="margin:2px 0 8px 22px"><span class="dot ${st.delivery?.email?.configured ? 'ok' : ''}"></span>${st.delivery?.email?.note || ''}</div>
        <label class="field">Send digest to<input type="email" data-f="dl_to" value="${s.delivery?.email_to || ''}" placeholder="you@example.com"></label>
        <label class="check" style="margin-top:10px"><input type="checkbox" data-f="dl_push" ${s.delivery?.push ? 'checked' : ''}> Phone push notification</label>
        <div class="small faint" style="margin:2px 0 0 22px"><span class="dot ${st.delivery?.push?.configured ? 'ok' : ''}"></span>${st.delivery?.push?.note || ''}</div>
        <p class="set-note">Audio briefing needs no setup: use “Listen to the brief” on Today (your browser’s built-in voice, free and offline).</p>
        <div class="row" style="margin-top:12px"><button class="primary" data-save="delivery">Save</button></div>
      </section>

      <section class="card">
        <h3>Calendar feed & access</h3>
        <p class="small" style="margin-top:0">Subscribe in Google Calendar (Other calendars → From URL) to see posting slots, planned posts, follow-ups and planned sends.</p>
        <div class="row" style="flex-wrap:nowrap"><input readonly id="ics" value="${location.origin}${st.ics_path}"><button class="sm" type="button" data-act="copy-ics">Copy</button></div>
        <p class="set-note">Google Calendar must reach this address over the internet, so this works once Byline is behind your Cloudflare Tunnel (see docs/DEPLOY.md). Treat the link like a password.</p>
        <p class="small" style="margin:10px 0 0"><span class="dot ${st.auth ? 'ok' : 'warn'}"></span>${st.auth ? 'Password sign-in is on.' : 'No password set — fine on this computer. Set BYLINE_PASSWORD before reaching Byline from your phone or the internet; remote access is refused until you do.'}</p>
        ${st.auth ? html`<div class="row" style="margin-top:10px"><button class="sm ghost" type="button" data-act="logout">Sign out</button></div>` : ''}
      </section>

      <section class="card">
        <h3>Intro format</h3>
        <label class="field">One-line self-introduction used in outreach<textarea data-f="intro_format" rows="3">${s.intro_format || ''}</textarea></label>
        <p class="set-note">Inserted at the top of outreach drafts. Keep it factual.</p>
        <div class="row" style="margin-top:12px"><button class="primary" data-save="intro">Save</button></div>
      </section>

      <section class="card">
        <h3>Media</h3>
        <label class="check"><input type="checkbox" data-f="synthetic" ${s.synthetic_media_opt_in ? 'checked' : ''}> Allow synthetic narration and likeness in videos</label>
        <p class="set-note">Off by default. While off, Byline never generates a synthetic voice or a likeness of you — videos use your own recordings, on-screen text and captions. Turning it on only makes the option available; each video still needs its own approval, and generated media is always labeled.</p>
        <div class="row" style="margin-top:12px"><button class="primary" data-save="media">Save</button></div>
      </section>

      <section class="card">
        <h3>Display</h3>
        <div role="radiogroup" aria-label="Theme" style="display:flex;flex-direction:column;gap:8px">${[['dark', 'Night desk', 'Warm black. The default.'], ['light', 'Proof desk', 'Newsprint paper.'], ['system', 'Match system', 'Follow this device’s light or dark setting.']].map(([v, l, note]) => html`
          <label class="check"><input type="radio" name="byline-theme" data-theme-opt value="${v}" ${themePref() === v ? 'checked' : ''}> <strong>${l}</strong> <span class="faint small">${note}</span></label>`)}</div>
        <p class="set-note">Saved in this browser only, so your phone and computer can differ.</p>
      </section>

      <section class="card">
        <h3>Security</h3>
        <div data-security></div>
      </section>

      <section class="card flat" style="grid-column:1 / -1">
        <h3>Demo data</h3>
        <p class="muted small" style="margin-top:0">Fictional sample sources, stories and drafts — clearly labeled DEMO — for trying the full flow without credentials. ${st.counts?.demo_articles ? html`<span class="demo-flag">LOADED</span> ${st.counts.demo_articles} demo articles present.` : 'Not loaded.'}</p>
        <div class="row"><button data-act="demo-load">Load demo data</button><button class="danger" data-act="demo-clear" ${st.counts?.demo_articles ? '' : 'disabled'}>Remove demo data</button></div>
      </section>
      <section class="card flat" style="grid-column:1 / -1">
        <h3>About</h3>
        <p class="muted small" style="margin-top:0">Byline · Proof Desk, third edition. Type: Newsreader, Schibsted Grotesk, Martian Mono (SIL OFL). Voice: Kokoro-82M “Heart” (Apache 2.0), runs locally. Effects adapted from <a href="https://reactbits.dev" target="_blank" rel="noopener">React Bits</a> by David Haz (MIT + Commons Clause).</p>
      </section>
    </div>`);
    paintSecurity();
  };
  // Repaint while keeping unsaved edits in other sections.
  const repaint = () => {
    const keep = [...el.querySelectorAll('[data-f]')].map(i => [i.dataset.f, i.type === 'checkbox' ? i.checked : i.value]);
    paint();
    for (const [f, v] of keep) { const i = el.querySelector(`[data-f="${f}"]`); if (i) i.type === 'checkbox' ? (i.checked = v) : (i.value = v); }
  };
  paint();
  const checkOllama = () => api.get('/ollama').then(o => {
    const box = el.querySelector('#ollama-status'); if (!box) return;
    box.innerHTML = o.reachable ? `<span class="dot ok"></span>Ollama is running · ${o.models.length} model(s): ${o.models.join(', ') || 'none — run “ollama pull qwen2.5:7b”'}`
      : '<span class="dot"></span>Ollama not detected. Install it free from ollama.com, run <span class="mono">ollama pull qwen2.5:7b</span>, then pick “Ollama” above. Until then Byline uses the template engine.';
    el.querySelector('#ollama-models').innerHTML = o.models.map(m => `<option value="${m}">`).join('');
  }).catch(() => {});
  checkOllama();
  loadSecurity();
  on(el, 'change', '[data-theme-opt]', (e, r) => { applyTheme(r.value); toast(`Theme: ${r.closest('label').querySelector('strong').textContent}`, 'ok'); });

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

  on(el, 'input', '[data-p=weight]', (e, r) => { r.nextElementSibling.textContent = Number(r.value).toFixed(1); });
  on(el, 'click', '[data-save]', async (e, btn) => {
    await act(btn, async () => {
      const body = builders[btn.dataset.save]();
      const saved = await api.put('/settings', body);
      Object.assign(s, saved);
      Object.assign(wp, saved.writing_profile);
      toast('Settings saved', 'ok');
      if (['schedule', 'ai', 'budget'].includes(btn.dataset.save)) { refreshStatus(); st = await api.get('/status'); p = st.provider; repaint(); checkOllama(); }
    }, 'Saving…');
  });
  on(el, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'add-prio' || a === 'rm-prio') {
      s.priorities = readPriorities();
      if (a === 'add-prio') s.priorities.push({ topic: '', weight: 1, terms: [] });
      else s.priorities.splice(Number(btn.dataset.i), 1);
      wp.samples = readSamples();
      repaint();
      if (a === 'add-prio') el.querySelectorAll('[data-p=topic]')[s.priorities.length - 1]?.focus();
    }
    if (a === 'add-sample' || a === 'rm-sample') {
      wp.samples = readSamples();
      s.priorities = readPriorities();
      if (a === 'add-sample') wp.samples.push(''); else wp.samples.splice(Number(btn.dataset.i), 1);
      repaint();
      if (a === 'add-sample') [...el.querySelectorAll('[data-sample]')].pop()?.focus();
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
    if (a === 'demo-load') await act(btn, async () => { await api.post('/demo/load'); toast('Demo data loaded (fictional, labeled DEMO)', 'ok'); refreshStatus(); render(view); }, 'Loading…');
    if (a === 'demo-clear' && await confirmBox('Remove all demo sources, stories, drafts and related records? Your own data is kept.', 'Remove demo data')) await act(btn, async () => {
      await api.del('/demo'); toast('Demo data removed', 'ok'); refreshStatus(); render(view);
    }, 'Removing…');
  });
}
