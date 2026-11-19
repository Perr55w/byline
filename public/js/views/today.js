import { api } from '../api.js';
import { html, on, act, toast, status, demoFlag, channelLabel, fmtDate, timeAgo, modal, scoreNum, topicsLine, plateImg, hydratePlates, titleWithFlag } from '../ui.js';

const plural = (n, w) => `${n} ${n === 1 ? w : w.replace(/y$/, 'ie') + 's'}`;
function whyRanked(it) {
  const bits = [(it.topics || []).slice(0, 3).join(', '), `${plural(it.domains.length, 'source')}`].filter(Boolean);
  return html`<div class="why-ranked"><b>Why it ranked:</b> ${bits.join(' · ')}${it.explanation ? html`<details><summary>Scoring detail</summary>${it.explanation}</details>` : ''}</div>`;
}

export async function render(view) {
  const t = await api.get('/today');
  const el = document.createElement('div');
  view.replaceChildren(el);
  const b = t.brief;
  const items = b?.items || [];

  el.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker">${fmtDate(t.date + 'T12:00:00', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <h1>Today’s briefing</h1>
      ${items.length ? html`<p class="live-dek"><b>${plural(items.length, 'story')}</b>${items.filter(i => i.qualifies).length === items.length ? html`, all post-worthy ·` : html` · <b>${items.filter(i => i.qualifies).length}</b> post-worthy ·`} <b>${t.awaiting.length}</b> draft${t.awaiting.length === 1 ? '' : 's'} awaiting review</p>`
        : html`<p class="lede">What changed, why it matters to your work, what you think — and whether it’s worth posting, testing, or saving.</p>`}
    </div>
    <div class="row">
      ${t.last_run?.finished_at ? html`<span class="ran-at">Ran ${timeAgo(t.last_run.finished_at)}</span>` : ''}
      ${!items.length ? html`<button class="primary" data-act="demo">Load demo data</button>` : ''}
      <button class="${items.length ? 'ghost' : ''}" data-act="run" data-key="R">Run today’s workflow</button>
    </div>
  </div>

  <div class="split">
    <div class="stack">
      <section class="card screened">
        <div class="row between">
          <h3 style="flex:1">The brief ${b && b.run_date !== t.date ? html`<span class="chip amber">from ${b.run_date}</span>` : ''}</h3>
          ${b ? html`<span class="mono faint">≈ ${b.reading_minutes} min read · ${items.length} stories</span>` : ''}
        </div>
        ${b ? html`<p class="brief-lead">${b.summary}</p>
          <div class="wire-slot" id="wire-player"><button class="sm" data-act="listen">▶ Listen to the brief</button></div>
          <div class="text-links"><button data-act="digest">Email digest preview</button><button data-act="deliver">Send email + push now</button></div>` : html`<div class="empty">No brief yet. Run today’s workflow, or load the demo data to try the full flow without credentials.</div>`}
        ${b?.quiet ? html`
          <div class="flag" style="margin-top:14px;border-left-color:var(--st-review);background:var(--st-review-bg)">
            <strong>Quiet day.</strong> <span class="muted">No story met your publishing threshold (${t.threshold}). Nothing will be drafted automatically.</span>
            ${t.evergreen_candidates.length ? html`<div class="stack" style="margin-top:10px">
              <div class="faint small">Prepare an evergreen draft from a saved topic:</div>
              ${t.evergreen_candidates.map(c => html`<div class="row between"><span>${c.title} <span class="chip">${c.collection}</span></span><button class="sm" data-act="evergreen" data-id="${c.id}">Draft evergreen</button></div>`)}
            </div>` : html`<p class="muted small" style="margin:8px 0 0">Save stories to a collection to unlock evergreen drafts on quiet days.</p>`}
          </div>` : ''}
        ${items.length ? html`<div>
          ${[items[0]].map(it => html`
          <article class="brief-item lead">
            <div>
              <a href="#/story/${it.story_id}" class="story-title" style="color:var(--ink)"><span class="lead-hl">${it.title}</span></a>${demoFlag(it.is_demo)}
              <p style="margin:10px 0 6px;max-width:62ch">${it.summary}</p>
              <div class="row" style="gap:6px 14px">${topicsLine(it.topics)}<span class="when">${it.domains.length} source${it.domains.length > 1 ? 's' : ''} · ${it.domains.slice(0, 3).join(' · ')}</span></div>
              ${whyRanked(it)}
            </div>
            <div class="score single" data-stamp style="--v:${Math.round(it.score)}">${scoreNum(it.score, { dec: true })}<small aria-hidden="true">Score</small><div class="galley-scale" aria-hidden="true" style="--t:${t.threshold}%"><b class="th"></b><i class="caret"></i></div></div>
          </article>`)}
        </div>` : ''}
        ${items.length > 1 ? html`<div class="fold-label">Below the fold</div><div class="below-fold">
          ${items.slice(1).map(it => html`
          <article class="brief-item">
            <div>
              <a href="#/story/${it.story_id}" class="story-title" style="color:var(--ink);font-size:var(--fs-md)">${titleWithFlag(it.title, it.is_demo)}</a>
              <div style="margin-top:6px">${topicsLine(it.topics, 2)}</div>
              <div class="when" style="margin-top:4px">${it.domains.length} source${it.domains.length > 1 ? 's' : ''}${it.qualifies ? ' · post-worthy' : ''}</div>
            </div>
            <div class="score">${scoreNum(it.score)}</div>
          </article>`)}
        </div>` : ''}
      </section>
    </div>

    <div class="stack">
      <section class="card accent crop">
        <h3>Suggested LinkedIn draft</h3>
        ${t.draft ? html`
          <a href="#/draft/${t.draft.id}" style="color:inherit">
            ${t.draft.image_file ? html`<div style="border:1px solid var(--rule-strong);margin-bottom:10px">${plateImg(t.draft.image_file)}</div>` : ''}
            <div class="story-title">${t.draft.title}</div>
          </a>
          <div class="row" style="margin-top:8px">${status(t.draft.status)}<span class="chip">${channelLabel(t.draft.channel, t.draft.format)}</span></div>
          <div class="row" style="margin-top:12px"><a class="btn" href="#/draft/${t.draft.id}">Open in studio →</a></div>`
        : html`<p class="muted small">${b?.quiet ? 'Quiet day — no automatic draft.' : 'Appears after the daily run when a story qualifies.'}</p>`}
      </section>

      <section class="card">
        <div class="row between"><h3>Awaiting review</h3><a class="mono small" href="#/studio">all drafts →</a></div>
        ${t.awaiting.length ? t.awaiting.map(d => html`<div class="row between" style="padding:7px 0;border-top:1px solid var(--line)">
          <a href="#/draft/${d.id}" style="color:var(--text);max-width:70%">${d.title}</a><span class="row">${status(d.status)}<span class="chip">${channelLabel(d.channel)}</span></span></div>`)
        : html`<p class="muted small">Nothing waiting.</p>`}
        ${t.outreach_awaiting.length ? html`<div class="hr"></div><h3>Outreach drafts</h3>${t.outreach_awaiting.map(o => html`<div class="row between small" style="padding:4px 0"><span>${o.name} · ${o.purpose.replace('_', ' ')}</span>${status(o.status)}</div>`)}` : ''}
      </section>

      ${t.followups.length ? html`<section class="card"><h3>Follow-ups due</h3>${t.followups.map(f => html`<div class="row between small" style="padding:5px 0"><a href="#/person/${f.id}">${f.name}</a><span class="muted">${f.next_step} · ${f.next_date}</span></div>`)}</section>` : ''}

      <section class="card flat">
        <h3>Last run</h3>
        ${t.last_run ? html`<div class="row between"><span>${status(t.last_run.status === 'done' ? 'approved' : t.last_run.status === 'failed' ? 'cancelled' : 'in_review')} <span class="mono">#${t.last_run.id} · ${t.last_run.run_date} · ${t.last_run.trigger}</span></span><a href="#/runs" class="mono small">details →</a></div>
          <p class="muted small" style="margin:8px 0 0">${t.last_run.error ? `Failed: ${t.last_run.error}` : `Finished ${timeAgo(t.last_run.finished_at)}.`}</p>` : html`<p class="muted small">No runs yet.</p>`}
      </section>
    </div>
  </div>`);

  hydratePlates(el);
  const slot = el.querySelector('#wire-player');
  if (slot && b) import('../player.js').then(m => { if (slot.isConnected && m.mountPlayer) { slot.innerHTML = ''; view.__player?.destroy?.(); view.__player = m.mountPlayer(slot, { date: b.run_date, stories: items });
      // the transcript repeats the stories below: keep it folded until asked for (or while playing)
      const tr = slot.querySelector('.wp-transcript');
      if (tr) { const d = document.createElement('details'); d.className = 'read-along'; d.innerHTML = '<summary>Read along</summary>'; tr.replaceWith(d); d.append(tr);
        slot.querySelector('.wp')?.addEventListener('click', (ev) => { if (ev.target.closest('.wp-play') && !d.open) d.open = true; }); }
    } }).catch(() => { /* keep the browser-voice button */ });

  on(el, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    if (a === 'run') await act(btn, async () => {
      const tc = window.__byline?.lattice?.(btn, { label: 'Going to press' });
      const r = await (window.__byline?.stagedRun || ((p) => p))(api.post('/runs', {}));
      if (tc) { r.status === 'done' ? tc.done('Printed') : tc.error('Stopped'); await new Promise(res => setTimeout(res, 700)); }
      toast(r.status === 'done' ? 'Daily run finished' : `Run failed at ${r.failed_stage}: ${r.error}`, r.status === 'done' ? 'ok' : 'err');
      render(view);
    }, 'Running…');
    if (a === 'demo') await act(btn, async () => { await api.post('/demo/load'); toast('Demo data loaded (fictional)', 'ok'); render(view); }, 'Loading…');
    if (a === 'listen') {
      if (!('speechSynthesis' in window)) return toast('This browser has no built-in voice.', 'err');
      if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.textContent = '▶ Listen to the brief'; return; }
      const script = [`Byline briefing for ${fmtDate(t.date + 'T12:00:00', { weekday: 'long', month: 'long', day: 'numeric' })}.`, b.summary,
        ...items.map((it, i) => `Story ${i + 1}. ${it.title}. ${it.summary}`), t.draft ? `Today's suggested draft is ready for your review.` : ''].join(' ');
      const u = new SpeechSynthesisUtterance(script);
      u.rate = 1.02; u.onend = () => { btn.textContent = '▶ Listen to the brief'; };
      speechSynthesis.speak(u); btn.textContent = '■ Stop';
    }
    if (a === 'digest') await act(btn, async () => {
      const r = await api.get(`/briefs/${b.run_date}/digest`);
      const m = modal(String(html`<h2>Email digest preview</h2><iframe sandbox="" style="width:100%;height:60vh;border:1px solid var(--line);background:#F3EEE4"></iframe><div class="row" style="justify-content:flex-end;margin-top:12px"><button data-close>Close</button></div>`), { wide: true });
      m.el.querySelector('iframe').srcdoc = r.html;
    });
    if (a === 'deliver') await act(btn, async () => {
      const r = await api.post(`/briefs/${b.run_date}/deliver`, { force: true });
      toast(`Email: ${r.email} · Push: ${r.push}`, Object.values(r).some(v => v === 'sent') ? 'ok' : '');
    }, 'Sending…');
    if (a === 'evergreen') await act(btn, async () => { const r = await api.post(`/stories/${btn.dataset.id}/evergreen`); location.hash = `#/draft/${r.draft_id}`; });
  });
}
