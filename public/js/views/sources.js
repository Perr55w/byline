import { api } from '../api.js';
import { html, on, act, toast, confirmBox, demoFlag, evChip, timeAgo, fmtDateTime } from '../ui.js';

const KINDS = [['rss', 'RSS / Atom feed'], ['blog', 'Company blog (feed)'], ['docs', 'Docs / release notes (feed)'], ['research', 'Research feed'], ['x', 'X search (needs API token)']];
const EVIDENCE = [['announcement', 'Announcement'], ['reporting', 'Independent reporting'], ['research', 'Research'], ['commentary', 'Commentary']];
const WATCH_KINDS = ['company', 'researcher', 'product', 'framework', 'skill', 'question', 'team', 'topic'];
const ui = { syncResult: {}, manual: null, kind: 'rss' };
const splitTerms = (s) => s.split(',').map(t => t.trim()).filter(Boolean);
const opts = (list, sel) => list.map(([v, l]) => html`<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`);

export async function render(view) {
  const [sources, st, watch, employers] = await Promise.all([
    api.get('/sources'), api.get('/status'), api.get('/watchlists'), api.get('/employers').catch(() => [])
  ]);
  const el = document.createElement('div');
  view.replaceChildren(el);

  const groups = {};
  for (const s of sources) (groups[s.grp || 'General'] ||= []).push(s);
  const readiness = Object.values(Object.fromEntries(Object.entries(st.connectors).map(([k, c]) => [c.label, { ...c, kinds: Object.entries(st.connectors).filter(([, x]) => x.label === c.label).map(([kk]) => kk) }])));
  const xReady = st.connectors.x?.ready;

  const sourceRow = (s) => {
    const res = ui.syncResult[s.id];
    const polled = !s.is_demo && s.kind !== 'manual';
    return html`<tr>
      <td style="min-width:240px"><strong>${s.name}</strong> ${demoFlag(s.is_demo)}
        <div class="mono faint" style="word-break:break-all">${s.kind === 'x' ? `query: ${s.url}` : s.url}</div>
        <div class="small muted">${s.connector} · <span class="mono">${s.kind}</span></div>
        ${s.connector_status?.ready === false ? html`<div class="ctl-err">${s.connector_status.reason}</div>` : ''}</td>
      <td>${evChip(s.evidence_kind)}${s.employer ? html`<div class="small muted" style="margin-top:4px">${s.employer}</div>` : ''}</td>
      <td>${s.kind === 'manual' ? html`<span class="faint small">—</span>` : html`<label class="check"><input type="checkbox" data-pause="${s.id}" ${s.paused ? 'checked' : ''}> paused</label>`}</td>
      <td class="small" style="min-width:200px">${s.is_demo ? html`<span class="faint">sample data · not polled</span>` : html`<span title="${fmtDateTime(s.last_sync_at)}">${s.last_sync_at ? `synced ${timeAgo(s.last_sync_at)}` : 'never synced'}</span>`}
        <span class="faint mono"> · ${s.article_count} article${s.article_count === 1 ? '' : 's'}</span>
        ${s.last_error && !s.is_demo && !(res && !res.ok) ? html`<div class="ctl-err">Last error: ${s.last_error}</div>` : ''}
        ${res ? html`<div class="${res.ok ? 'ctl-ok' : 'ctl-err'}">${res.msg}</div>` : ''}</td>
      <td><div class="row" style="flex-wrap:nowrap;justify-content:flex-end">
        ${polled ? html`<button class="sm" data-act="sync" data-id="${s.id}" ${s.connector_status?.ready === false ? html`title="${s.connector_status.reason}"` : ''}>Sync now</button>` : ''}
        <button class="sm danger" data-act="del-source" data-id="${s.id}" data-name="${s.name}">Delete</button></div></td>
    </tr>`;
  };

  el.innerHTML = String(html`
  <div class="page-head">
    <div>
      <div class="kicker">Research inputs</div>
      <h1>Sources & watchlists</h1>
      <p class="lede">Feeds, company blogs, docs and research — plus X when an API token is configured. Retrieved content is treated as untrusted data: it never changes instructions or triggers actions.</p>
    </div>
  </div>

  <div class="stack reveal">
    <div class="grid g2" style="align-items:start">
      <div class="stack">
      <section class="card accent">
        <h3>Submit a URL</h3>
        <p class="muted small" style="margin-top:0">Add a single article. It’s clustered into an existing story or starts a new one.</p>
        <form data-form="url" class="stack">
          <input name="url" type="url" required placeholder="https://…" value="${ui.manual?.url || ''}">
          <div class="row"><select name="evidence_kind" style="flex:1">${opts(EVIDENCE, 'reporting')}</select><button class="primary" type="submit">Fetch & add</button></div>
        </form>
        ${ui.manual ? html`<div class="hr"></div>
          ${ui.manual.error ? html`<div class="ctl-err" style="margin-bottom:8px">${ui.manual.error}</div>` : ''}
          <p class="muted small" style="margin-top:0">Paste the text manually instead (useful for paywalls or when the network is unavailable).</p>
          <form data-form="manual" class="stack">
            <label class="field">URL<input name="url" required value="${ui.manual.url}"></label>
            <label class="field">Title<input name="title" required></label>
            <label class="field">Text<textarea name="text" rows="6" placeholder="Paste the article text"></textarea></label>
            <div class="row"><select name="evidence_kind" style="flex:1">${opts(EVIDENCE, ui.manual.evidence_kind)}</select><button class="primary" type="submit">Add pasted article</button></div>
            <button type="button" class="ghost sm" data-act="cancel-manual">Cancel</button>
          </form>` : html`<button class="ghost sm" style="margin-top:8px" data-act="open-manual">Or paste text manually</button>`}
      </section>

      <section class="card flat">
        <h3>Connector status</h3>
        ${readiness.map(c => html`<div class="row between" style="padding:6px 0;border-top:1px solid var(--line)">
          <span><span class="dot ${c.ready ? 'ok' : 'warn'}"></span>${c.label} <span class="faint mono">${c.kinds.join(', ')}</span></span>
          <span class="small ${c.ready ? 'muted' : 'ctl-err'}">${c.ready ? 'ready' : c.reason}</span></div>`)}
        <p class="set-note">Credentials such as X_BEARER_TOKEN are read from server environment variables — never entered here. Demo sources are labeled DEMO and are never polled.</p>
      </section>
      </div>
      <section class="card">
        <h3>Add a source</h3>
        <form data-form="source" class="form-grid">
          <label class="field">Name<input name="name" required placeholder="e.g. Snowflake Engineering Blog"></label>
          <label class="field">Kind<select name="kind" data-kind>${opts(KINDS, ui.kind)}</select></label>
          <label class="field full">${ui.kind === 'x' ? 'X search query' : 'Feed URL'}
            <input name="url" ${ui.kind === 'x' ? html`placeholder='"AI agents" (from:someone OR evaluation)'` : html`type="url" placeholder="https://example.com/feed.xml"`} required></label>
          ${ui.kind === 'x' && !xReady ? html`<div class="full ctl-err">X is not configured: ${st.connectors.x.reason}. You can add the source now; it will be skipped (with that reason) until X_BEARER_TOKEN is set in the server environment.</div>` : ''}
          <label class="field">Group<input name="grp" list="grp-list" placeholder="General"></label>
          <label class="field">Evidence type<select name="evidence_kind"><option value="">Default for kind</option>${opts(EVIDENCE)}</select></label>
          <label class="field">Employer (optional)<input name="employer" list="emp-list" placeholder="e.g. AWS"></label>
          <div class="row" style="align-items:flex-end"><button class="primary" type="submit">Add source</button></div>
        </form>
        <datalist id="grp-list">${Object.keys(groups).map(g => html`<option value="${g}">`)}</datalist>
        <datalist id="emp-list">${employers.map(e => html`<option value="${e.name}">`)}</datalist>
      </section>
    </div>
      <section class="card">
        <div class="row between"><h3>Source directory</h3><span class="mono faint">${sources.length} sources</span></div>
        ${sources.length ? Object.entries(groups).map(([g, list]) => html`
          <div style="margin-top:14px"><div class="kicker" style="color:var(--violet-2);margin-bottom:4px">${g}</div>
          <div class="ctl-scroll"><table class="src-table">
            <thead><tr><th>Source</th><th>Evidence</th><th>Status</th><th>Last sync</th><th></th></tr></thead>
            <tbody>${list.map(sourceRow)}</tbody>
          </table></div></div>`) : html`<div class="empty">No sources yet. Add a feed below, or load demo data from Settings.</div>`}
      </section>
      <section class="card">
        <div class="row between"><h3>Topic watchlists</h3><span class="mono faint">${watch.length}</span></div>
        <p class="muted small" style="margin-top:0">Companies, researchers, products, frameworks, skills, questions and teams. Matches raise a story’s relevance; pinned items count 1.5×.</p>
        ${watch.length ? html`<div class="ctl-scroll"><table>
          <thead><tr><th>Kind</th><th>Name</th><th>Terms</th><th>Weight</th><th>Pin</th><th></th></tr></thead>
          <tbody>${watch.map(w => html`<tr>
            <td><span class="chip">${w.kind}</span></td>
            <td><strong>${w.name}</strong>${w.employer ? html`<div class="small muted">${w.employer}</div>` : ''}</td>
            <td style="min-width:200px"><input data-wterms="${w.id}" value="${(w.terms || []).join(', ')}" aria-label="Terms"></td>
            <td><input data-wweight="${w.id}" type="number" min="0" max="3" step="0.1" value="${w.weight}" style="width:70px" aria-label="Weight"></td>
            <td><label class="check"><input type="checkbox" data-wpin="${w.id}" ${w.pinned ? 'checked' : ''}> pinned</label></td>
            <td><button class="sm danger" data-act="del-watch" data-id="${w.id}" data-name="${w.name}">Delete</button></td>
          </tr>`)}</tbody></table></div>` : html`<div class="empty">No watchlist items yet.</div>`}
        <form data-form="watch" class="form-grid" style="margin-top:14px">
          <label class="field">Kind<select name="kind">${WATCH_KINDS.map(k => html`<option value="${k}">${k}</option>`)}</select></label>
          <label class="field">Name<input name="name" required placeholder="e.g. Model Context Protocol"></label>
          <label class="field full">Terms (comma-separated)<input name="terms" placeholder="MCP, Model Context Protocol"></label>
          <label class="field">Weight<input name="weight" type="number" min="0" max="3" step="0.1" value="1"></label>
          <div class="row" style="align-items:flex-end;justify-content:space-between"><label class="check"><input type="checkbox" name="pinned"> Pin</label><button class="primary" type="submit">Add to watchlist</button></div>
        </form>
      </section>
  </div>`);

  // ---- events ----
  on(el, 'change', '[data-kind]', (e, s) => {
    const f = s.form; const keep = Object.fromEntries(new FormData(f));
    ui.kind = s.value; render(view).then(() => {
      const nf = view.querySelector('[data-form="source"]');
      for (const [k, v] of Object.entries(keep)) if (k !== 'kind' && k !== 'url' && nf?.elements[k]) nf.elements[k].value = v;
    });
  });
  on(el, 'change', '[data-pause]', async (e, c) => {
    try { await api.patch(`/sources/${c.dataset.pause}`, { paused: c.checked }); toast(c.checked ? 'Source paused' : 'Source resumed', 'ok'); render(view); }
    catch (err) { toast(err.message, 'err'); c.checked = !c.checked; }
  });
  on(el, 'change', '[data-wterms],[data-wweight],[data-wpin]', async (e, i) => {
    const id = i.dataset.wterms || i.dataset.wweight || i.dataset.wpin;
    const body = i.dataset.wterms ? { terms: splitTerms(i.value) } : i.dataset.wweight ? { weight: Number(i.value) } : { pinned: i.checked };
    try { await api.patch(`/watchlists/${id}`, body); toast('Watchlist updated — stories re-ranked', 'ok'); if (i.dataset.wpin) render(view); }
    catch (err) { toast(err.message, 'err'); }
  });

  on(el, 'submit', 'form[data-form]', async (e, f) => {
    e.preventDefault();
    const btn = f.querySelector('button[type=submit]');
    const d = Object.fromEntries(new FormData(f));
    const kind = f.dataset.form;
    if (kind === 'source') await act(btn, async () => {
      await api.post('/sources', { name: d.name.trim(), kind: d.kind, url: d.url.trim(), grp: d.grp.trim() || 'General', evidence_kind: d.evidence_kind || undefined, employer: d.employer.trim() || null });
      toast(`Added ${d.name}`, 'ok'); ui.kind = 'rss'; render(view);
    }, 'Adding…');
    if (kind === 'watch') await act(btn, async () => {
      await api.post('/watchlists', { kind: d.kind, name: d.name.trim(), terms: splitTerms(d.terms || ''), weight: Number(d.weight || 1), pinned: !!d.pinned });
      toast(`Watching ${d.name}`, 'ok'); render(view);
    }, 'Adding…');
    if (kind === 'url') {
      try {
        await act(btn, async () => {
          const r = await api.post('/intake/url', { url: d.url.trim(), evidence_kind: d.evidence_kind }).catch(err => { ui.manual = { url: d.url.trim(), evidence_kind: d.evidence_kind, error: err.message }; throw err; });
          ui.manual = null;
          toast(r.created ? 'Article added' : 'Already in your archive', 'ok');
          if (r.story_id) location.hash = `#/story/${r.story_id}`; else render(view);
        }, 'Fetching…');
      } finally { if (ui.manual) render(view); }
    }
    if (kind === 'manual') await act(btn, async () => {
      const r = await api.post('/intake/manual', { url: d.url.trim(), title: d.title.trim(), text: d.text, evidence_kind: d.evidence_kind });
      ui.manual = null; toast('Article added from pasted text', 'ok');
      if (r.story_id) location.hash = `#/story/${r.story_id}`; else render(view);
    }, 'Adding…');
  });

  on(el, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act, id = btn.dataset.id;
    if (a === 'sync') await act(btn, async () => {
      try {
        const r = await api.post(`/sources/${id}/sync`);
        ui.syncResult[id] = { ok: true, msg: `Fetched ${r.fetched}, ${r.created} new · ${r.new_stories ?? 0} new stories, ${r.merged ?? 0} merged` };
        toast('Sync finished', 'ok');
      } catch (err) { ui.syncResult[id] = { ok: false, msg: err.message }; toast(err.message, 'err'); }
      render(view);
    }, 'Syncing…');
    if (a === 'del-source' && await confirmBox(`Delete “${btn.dataset.name}”? Articles already collected stay in your archive.`, 'Delete source')) await act(btn, async () => {
      await api.del(`/sources/${id}`); toast('Source deleted', 'ok'); render(view);
    });
    if (a === 'del-watch' && await confirmBox(`Remove “${btn.dataset.name}” from your watchlists?`, 'Remove')) await act(btn, async () => {
      await api.del(`/watchlists/${id}`); toast('Removed', 'ok'); render(view);
    });
    if (a === 'open-manual') { const u = el.querySelector('[data-form="url"] [name=url]').value; ui.manual = { url: u, evidence_kind: 'reporting', error: '' }; render(view); }
    if (a === 'cancel-manual') { ui.manual = null; render(view); }
  });
}
