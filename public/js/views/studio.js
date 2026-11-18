import { api } from '../api.js';
import { html, raw, esc, on, act, toast, status, evChip, channelLabel, timeAgo, fmtDateTime, copy, download, svgToPng, fileToBase64, modal, confirmBox } from '../ui.js';

const FORMATS = { linkedin: ['long', 'article', 'roundup', 'short'], instagram: ['carousel', 'reel', 'story'], video: ['explainer', 'trailer', 'demo', 'behind-the-scenes'] };
const ANGLES = [['tradeoff', 'Product tradeoff'], ['process', 'Business process'], ['experiment', 'Experiment I could run']];
const NOTE_KINDS = ['observation', 'disagreement', 'example', 'question'];

export async function render(view, ctx) {
  const el = document.createElement('div');
  view.replaceChildren(el);
  if (ctx.name === 'draft' && ctx.params[0]) return editor(el, Number(ctx.params[0]));
  return list(el, view);
}

// ---------------------------------------------------------------- list
async function list(el) {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const channel = q.get('channel') || '';
  const drafts = await api.get(`/drafts${channel ? `?channel=${channel}` : ''}`);
  el.innerHTML = String(html`
  <div class="page-head"><div><div class="kicker">Drafts · approvals · exports</div><h1>Studio</h1>
    <p class="lede">Every piece keeps its sources attached and its own approval status. Start a new piece from any story in the Feed or any project in Career.</p></div></div>
  <div class="tabs">${[['', 'All'], ['linkedin', 'LinkedIn'], ['instagram', 'Instagram'], ['video', 'Video']].map(([k, l]) => html`<button class="${channel === k ? 'on' : ''}" data-tab="${k}">${l}</button>`)}</div>
  <section class="card">
    ${drafts.length ? html`<table><thead><tr><th>Title</th><th>Channel</th><th>Status</th><th>Planned</th><th>Updated</th></tr></thead><tbody>
      ${drafts.map(d => html`<tr class="click" data-href="#/draft/${d.id}"><td>${d.title || 'Untitled'}</td><td><span class="chip">${channelLabel(d.channel, d.format)}</span></td><td>${status(d.status)}</td><td class="mono">${d.planned_date || '—'}</td><td class="mono faint">${timeAgo(d.updated_at)}</td></tr>`)}
    </tbody></table>` : html`<div class="empty">No drafts yet. Open a story in the Feed and choose what to make from it.</div>`}
  </section>`);
  on(el, 'click', '[data-href]', (e, t) => { location.hash = t.dataset.href; });
  on(el, 'click', '[data-tab]', (e, t) => { location.hash = `#/studio${t.dataset.tab ? `?channel=${t.dataset.tab}` : ''}`; });
}

// ---------------------------------------------------------------- slide rendering (Instagram)
function wrap(text, max) {
  const out = []; let line = '';
  for (const w of String(text).split(/\s+/)) { if ((line + ' ' + w).trim().length > max) { if (line) out.push(line); line = w; } else line = (line + ' ' + w).trim(); }
  if (line) out.push(line);
  return out;
}
export function slideSvg(text, i, n) {
  const [head, ...rest] = String(text).split('\n');
  const body = rest.join(' ').trim();
  const headSize = head.length > 60 ? 64 : head.length > 36 ? 78 : 96;
  const headLines = wrap(head, Math.floor(1700 / headSize));
  const bodyLines = wrap(body, 34);
  const bodySize = bodyLines.length > 6 ? 40 : 46;
  let y = body ? 360 : 675 - (headLines.length * headSize * 1.1) / 2 + headSize;
  const t = headLines.map(l => { const s = `<text x="90" y="${y}" font-family="Fraunces, Georgia, serif" font-weight="600" font-size="${headSize}" fill="#f4f0ff">${esc(l)}</text>`; y += headSize * 1.12; return s; }).join('');
  y += 40;
  const b = bodyLines.map(l => { const s = `<text x="90" y="${y}" font-family="Hanken Grotesk, sans-serif" font-size="${bodySize}" fill="#d8d2ee">${esc(l)}</text>`; y += bodySize * 1.4; return s; }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
<defs><radialGradient id="g${i}" cx="85%" cy="5%" r="95%"><stop offset="0" stop-color="#3b2a72"/><stop offset=".6" stop-color="#151226"/><stop offset="1" stop-color="#0b0a12"/></radialGradient></defs>
<rect width="1080" height="1350" fill="url(#g${i})"/><rect x="90" y="140" width="16" height="16" fill="#f5b544"/>
<text x="122" y="156" font-family="IBM Plex Mono, monospace" font-size="28" letter-spacing="4" fill="#c9b8ff">${i + 1} / ${n}</text>${t}${b}
<text x="90" y="1250" font-family="IBM Plex Mono, monospace" font-size="26" fill="#8f89aa">${i === n - 1 ? 'Sources in caption' : 'Swipe →'}</text></svg>`;
  const issues = [];
  if (text.length > 170) issues.push(`${text.length} chars — aim for under 170 per slide`);
  if (bodyLines.length > 8) issues.push('Too many body lines; split the slide');
  if (y > 1200) issues.push('Text runs into the footer');
  return { svg, issues };
}

// ---------------------------------------------------------------- editor
async function editor(el, id) {
  let d = await api.get(`/drafts/${id}`);
  let images = [];
  const saveTimers = {};

  const sectionHtml = (s) => {
    const flags = d.flags.filter(f => f.section_id === s.id);
    const isScene = s.kind === 'scene';
    return html`
    <div class="section-block ${s.locked ? 'locked' : ''} ${flags.length ? 'flagged' : ''}" id="sec-${s.id}" data-sec="${s.id}">
      <div class="section-head">
        <span class="label">${s.label}</span>
        ${flags.length ? html`<span class="chip red">${flags.length} flag${flags.length > 1 ? 's' : ''}</span>` : ''}
        ${s.locked ? html`<span class="chip amber">locked</span>` : ''}
        <div class="tools">
          <button class="sm ghost" data-act="lock" data-id="${s.id}" title="Locked sections survive regeneration">${s.locked ? 'Unlock' : 'Lock'}</button>
          ${s.kind === 'humor_variant' ? html`<button class="sm amber" data-act="use-humor" data-id="${s.id}" title="Swap this into the public hook">Use as hook</button>` : ''}
          <button class="sm" data-act="rewrite" data-id="${s.id}" ${s.locked ? 'disabled' : ''}>Rewrite</button>
        </div>
      </div>
      <textarea data-field="text" data-id="${s.id}" rows="${Math.max(2, Math.ceil((s.text || '').length / 80))}" ${s.locked ? 'readonly' : ''}>${s.text}</textarea>
      ${isScene ? html`<div class="form-grid" style="margin-top:8px">
        <label class="field">On-screen text<input data-field="onscreen" data-id="${s.id}" value="${s.onscreen || ''}" ${s.locked ? 'readonly' : ''}></label>
        <label class="field">Duration (s)<input type="number" min="1" max="60" data-field="duration" data-id="${s.id}" value="${s.duration || 4}" ${s.locked ? 'readonly' : ''}></label>
        <label class="field">B-roll / shot idea<input data-field="broll" data-id="${s.id}" value="${s.broll || ''}" ${s.locked ? 'readonly' : ''}></label>
        <label class="field">Media for this scene<select data-field="media_id" data-id="${s.id}" ${s.locked ? 'disabled' : ''}>
          <option value="">Title card (no media)</option>
          ${images.filter(m => /^(image|video)\//.test(m.mime) && m.mime !== 'image/svg+xml').map(m => html`<option value="${m.id}" ${String(s.media_id) === String(m.id) ? 'selected' : ''}>${m.mime.split('/')[0]} · ${m.attribution || m.filename}</option>`)}
        </select></label></div>` : ''}
    </div>`;
  };

  const flagsHtml = () => d.flags.length ? d.flags.map((f, i) => html`
    <div class="flag ${f.blocking ? 'blocking' : ''}">
      <div class="row between"><span class="chip red">${f.type.replace('_', ' ')}${f.blocking ? ' · blocks approval' : ''}</span>
        ${f.section_id ? html`<a href="javascript:void 0" class="mono small" data-act="goto" data-id="${f.section_id}">go to section →</a>` : ''}</div>
      ${f.sentence ? html`<div class="q" style="margin-top:6px">“${f.sentence}”</div>` : ''}
      <div style="margin-top:4px">${f.message}</div>
      ${f.evidence?.length ? html`<div class="small" style="margin-top:4px">Evidence: ${f.evidence.map(e => html`<a href="${e.url}" target="_blank" rel="noopener noreferrer">${e.domain || e.title}</a> `)}</div>` : ''}
      ${f.suggestion ? html`<div class="small muted" style="margin-top:4px">Suggestion: ${f.suggestion}
        ${f.sentence && f.section_id && ['exaggeration', 'motive'].includes(f.type) ? html` <button class="sm" data-act="apply-fix" data-i="${i}">Apply</button>` : ''}</div>` : ''}
    </div>`) : html`<p class="muted small">No issues found. Checks cover unsupported claims, stale sources, exaggeration, first-person claims, affiliation/insider wording, motive assumptions, and private details.</p>`;

  const notesHtml = () => html`
    ${d.notes.length ? d.notes.map(n => html`
      <div class="note ${n.include ? 'included' : ''}" data-note="${n.id}">
        <textarea data-note-text="${n.id}" rows="2" placeholder="Rough notes, first-person observations, disagreements, examples…">${n.text}</textarea>
        <div class="row between" style="margin-top:6px">
          <div class="row"><select data-note-kind="${n.id}" style="width:auto;padding:4px 8px">${NOTE_KINDS.map(k => html`<option ${n.kind === k ? 'selected' : ''}>${k}</option>`)}</select>
            <label class="check"><input type="checkbox" data-note-include="${n.id}" ${n.include ? 'checked' : ''}> Use in draft (public)</label></div>
          <button class="sm danger" data-act="del-note" data-id="${n.id}">Delete</button>
        </div>
      </div>`) : html`<p class="muted small">Notes are private by default. Tick “Use in draft” to let one appear in the public perspective section.</p>`}`;

  const tagsHtml = () => (d.tags || []).length ? d.tags.map((t, i) => html`
    <div style="padding:8px 0;border-top:1px solid var(--line)">
      <div class="row between"><strong>@${t.name}</strong>
        <div class="row"><span class="chip ${t.recommended ? 'green' : 'amber'}">${t.recommended ? 'recommended' : 'not recommended'}</span>
          <label class="check"><input type="checkbox" data-tag="${i}" ${t.enabled ? 'checked' : ''}> Use tag</label></div></div>
      <div class="q small" style="margin-top:4px;font-family:var(--display);font-style:italic">“${t.sentence}”</div>
      <div class="small muted">${t.reason} ${t.source ? html`<a href="${t.source.url}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</div>
    </div>`) : html`<p class="muted small">Suggestions appear when the draft names a target employer or a contact. You choose each tag; removing one never rewrites the post.</p>`;

  const visualHtml = () => {
    const im = d.image;
    return html`
      ${im ? html`
        <img src="/media/${im.filename}" alt="${im.alt || ''}" style="width:100%;border-radius:8px;border:1px solid var(--line)">
        <div class="row" style="margin-top:8px">${im.generated ? html`<span class="chip violet">Generated in Byline</span>` : html`<span class="chip blue">${im.origin === 'sourced' ? 'Sourced image' : 'Uploaded'}</span>`}
          ${im.origin === 'chart' ? html`<span class="chip green">chart from source-backed figures</span>` : ''}</div>
        <div class="form-grid" style="margin-top:10px">
          <label class="field full">Alt text<textarea data-img-field="alt" rows="2">${im.alt || ''}</textarea></label>
          <label class="field">Attribution<input data-img-field="attribution" value="${im.attribution || ''}"></label>
          <label class="field">License<input data-img-field="license" value="${im.license || ''}"></label>
          <label class="field full">Original source<input data-img-field="source_url" value="${im.source_url || ''}"></label>
        </div>` : html`<div class="empty">No image attached.</div>`}
      <div class="row" style="margin-top:10px">
        <button class="sm" data-act="visual" data-kind="auto">Recommend visual</button>
        <button class="sm" data-act="visual" data-kind="card">Text card</button>
        <button class="sm" data-act="visual" data-kind="diagram">Diagram</button>
        <button class="sm" data-act="upload">Upload image</button>
        <button class="sm" data-act="import">From URL</button>
        <button class="sm" data-act="library">Library</button>
        ${im ? html`<button class="sm ghost" data-act="no-image">Remove</button>` : ''}
      </div>`;
  };

  const previewHtml = () => {
    if (d.channel === 'linkedin') {
      const text = d.final_text;
      const short = text.length > 210 ? text.slice(0, 210).replace(/\s+\S*$/, '') : text;
      return html`<div class="li-preview">
        <div class="li-head"><div class="li-avatar">PW</div><div><div style="font-weight:600">Perry Watson</div><div style="font-size:12px;color:#a8a8a8">AI product · analytics · KSU</div><div style="font-size:12px;color:#a8a8a8">now · 🌐</div></div></div>
        <div class="li-body" id="li-body">${short}${text.length > 210 ? html`<span class="li-more" data-act="more">…see more</span>` : ''}</div>
        ${d.image ? html`<img class="li-img" src="/media/${d.image.filename}" alt="${d.image.alt || ''}">` : ''}
        <div class="li-bar"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>
      </div>
      <div class="mono faint" style="margin-top:6px">${text.length} characters · first ${Math.min(210, text.length)} show before “see more”</div>`;
    }
    if (d.channel === 'instagram') {
      const slides = d.sections.filter(s => s.kind === 'slide' || s.kind === 'frame' || s.kind === 'beat' || s.kind === 'hook');
      const rendered = slides.map((s, i) => ({ s, ...slideSvg(s.text, i, slides.length) }));
      return html`<div class="slides">${rendered.map((r, i) => html`<div><div class="slide-frame">${raw(r.svg)}</div>
        <div class="small ${r.issues.length ? '' : 'faint'}" style="margin-top:4px;color:${r.issues.length ? 'var(--amber)' : ''}">${r.issues.length ? r.issues.join('; ') : `${r.s.label}: legible`}</div></div>`)}</div>
        <div class="hr"></div><div class="mono faint">CAPTION</div><pre class="code" style="max-height:160px">${d.sections.find(s => s.kind === 'caption')?.text || ''}</pre>`;
    }
    if (d.channel === 'video') {
      const scenes = d.sections.filter(s => s.kind === 'scene');
      const total = scenes.reduce((m, s) => m + Number(s.duration || 0), 0);
      const renders = d.meta?.renders || [];
      return html`<div class="timeline">${scenes.map(s => html`<div style="flex:${s.duration || 1}" title="${s.label}">${s.duration}s</div>`)}</div>
        <div class="mono faint" style="margin:6px 0 12px">${scenes.length} scenes · ${total}s total · ${d.meta?.orientation || 'vertical'}</div>
        ${renders.length ? html`<video src="/media/${renders[0].mp4}" controls style="width:100%;max-height:420px;border-radius:8px;background:#000"></video>
          <div class="row" style="margin-top:8px">
            <a class="btn" href="/media/${renders[0].mp4}?download">MP4</a><a class="btn" href="/media/${renders[0].thumbnail}?download">Thumbnail</a>
            <a class="btn" href="/media/${renders[0].srt}?download">Subtitles (.srt)</a><a class="btn" href="/media/${renders[0].caption}?download">Caption</a></div>
          <p class="small muted">${renders[0].captions_burned ? 'Captions burned in; .srt included for platforms that support uploads.' : 'No system font found for burned-in text — use the .srt file.'}</p>`
          : html`<div class="empty">Render a preview once your scenes and media are ready.</div>`}`;
    }
    return html`<pre class="code">${d.final_text}</pre>`;
  };

  const approvalHtml = () => {
    const pub = d.publisher;
    return html`
      <div class="row between"><span>${status(d.status)}</span><span class="mono faint">${d.approved_at ? `approved ${timeAgo(d.approved_at)}` : 'not approved'}</span></div>
      <ul class="small" style="padding-left:18px;margin:10px 0">
        <li style="color:${d.blocking ? 'var(--red)' : 'var(--green)'}">${d.blocking ? `${d.blocking} blocking flag(s) to resolve` : 'No blocking flags'}</li>
        <li class="muted">${d.flags.length - d.blocking} advisory flag(s) — review them</li>
        ${d.channel === 'linkedin' ? html`<li style="color:${d.image ? 'var(--green)' : 'var(--amber)'}">${d.image ? 'Image attached with alt text' + (d.image.alt ? '' : ' (alt text missing!)') : 'No image attached'}</li>` : ''}
        <li class="muted">Approval covers this exact text${d.channel !== 'video' ? ' and image' : ' and media'}; any edit returns it to review.</li>
      </ul>
      <div class="row">
        ${d.status === 'draft' ? html`<button class="sm" data-act="submit">Submit for review</button>` : ''}
        ${!d.approval_valid ? html`<button class="primary" data-act="approve" ${d.blocking ? 'disabled' : ''}>Approve this version</button>` : html`<button class="sm ghost" data-act="unapprove">Withdraw approval</button>`}
      </div>
      ${d.approval_valid && d.status !== 'published' ? html`<div class="row" style="margin-top:10px">
        <input type="date" id="sched-date" value="${d.planned_date || ''}" style="width:auto"><button class="sm ghost" data-act="next-slot">Next open slot</button><button class="sm" data-act="schedule">Schedule</button></div>` : ''}
      <div class="hr"></div>
      <h3>Export</h3>
      <div class="row">
        <button class="sm" data-act="copy">Copy post text</button>
        ${d.image ? html`<button class="sm" data-act="dl-image">Download image</button>` : ''}
        ${d.channel === 'instagram' ? html`<button class="sm" data-act="dl-slides">Download slides + caption</button>` : ''}
        <button class="sm" data-act="dl-notes">Download source notes</button>
      </div>
      <p class="small faint">Exports never include your private notes.</p>
      <div class="hr"></div>
      <h3>Publish</h3>
      ${d.status === 'published' ? html`<p class="small">Published ${fmtDateTime(d.published_at)}${d.publish_ref && d.publish_ref !== 'manual' ? ` · ${d.publish_ref}` : ' (manual)'}.</p>
        <a class="btn" href="#/performance">Enter performance metrics →</a>` : html`
        <p class="small muted">${pub.available ? pub.note : `Direct publishing not connected. ${pub.note}`}</p>
        <div class="row">
          ${pub.available ? html`<button class="amber" data-act="publish" ${d.approval_valid ? '' : 'disabled'}>Publish now</button>` : ''}
          <button class="sm" data-act="mark-published" ${d.approval_valid ? '' : 'disabled'}>I posted it — mark as published</button>
        </div>`}`;
  };

  const versionsHtml = () => d.versions.length ? d.versions.map(v => html`<div class="row between small" style="padding:4px 0;border-top:1px solid var(--line)">
    <span><span class="mono">v${v.id}</span> · ${v.note} · <span class="faint">${timeAgo(v.created_at)}</span></span>
    <span class="row"><button class="sm ghost" data-act="view-version" data-id="${v.id}">View</button><button class="sm" data-act="restore" data-id="${v.id}">Restore</button></span></div>`) : html`<p class="muted small">No versions yet.</p>`;

  const videoBriefHtml = () => {
    const m = d.meta || {};
    return html`<section class="card"><h3>Video brief</h3><div class="form-grid">
      <label class="field">Audience<input data-meta="audience" value="${m.audience || ''}" placeholder="e.g. analytics hiring managers"></label>
      <label class="field">Purpose<input data-meta="purpose" value="${m.purpose || ''}" placeholder="e.g. explain a project result"></label>
      <label class="field">Platform<select data-meta="platform">${['Instagram Reels', 'LinkedIn video', 'YouTube Shorts', 'YouTube', 'TikTok'].map(p => html`<option ${m.platform === p ? 'selected' : ''}>${p}</option>`)}</select></label>
      <label class="field">Target length (s)<input type="number" data-meta="length" value="${m.length || 30}"></label>
      <label class="field">Orientation<select data-meta="orientation">${['vertical', 'landscape'].map(o => html`<option ${m.orientation === o ? 'selected' : ''}>${o}</option>`)}</select></label>
      <label class="field">Narration audio<select data-meta="narration_id"><option value="">None (silent + captions)</option>${images.filter(x => x.mime?.startsWith('audio/')).map(a => html`<option value="${a.id}" ${String(m.narration_id) === String(a.id) ? 'selected' : ''}>${a.attribution || a.filename}</option>`)}</select></label>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="sm" data-act="upload-media">Upload footage / audio</button>
      <button class="sm" data-act="record">● Record narration</button>
      <button class="primary" data-act="render">Render preview MP4</button>
      <label class="check"><input type="checkbox" id="burn" checked> Burn in captions</label>
    </div>
    <div class="small muted" style="margin-top:8px">Media rights: ${images.filter(x => !x.generated).slice(0, 6).map(x => `${x.mime?.split('/')[0]} — ${x.attribution || 'unattributed'} (${x.license || 'no license'})`).join(' · ') || 'no uploads yet'}. Synthetic narration or likeness stays off unless you opt in under Settings.</div>
    </section>`;
  };

  function paint() {
    const ctx = d.story;
    el.innerHTML = String(html`
    <div class="page-head">
      <div style="max-width:900px">
        <div class="kicker"><a href="#/studio">← Studio</a> · ${channelLabel(d.channel, d.format)} · draft #${d.id}${d.meta?.adapted_from ? ` · adapted from #${d.meta.adapted_from}` : ''}</div>
        <h1>${d.title || 'Untitled'}</h1>
        <div class="row" style="margin-top:10px">${status(d.status)}
          ${d.story_id ? html`<a class="chip violet" href="#/story/${d.story_id}">story #${d.story_id}</a>` : ''}
          ${d.project ? html`<a class="chip green" href="#/career">project: ${d.project.title}</a>` : ''}
          ${d.siblings.map(s => html`<a class="chip" href="#/draft/${s.id}">${channelLabel(s.channel, s.format)} · ${s.status.replace('_', ' ')}</a>`)}
          ${d.meta?.generated_by ? html`<span class="chip">engine: ${d.meta.generated_by}</span>` : ''}
        </div>
      </div>
    </div>
    <div class="studio">
      <div class="stack">
        <section class="card flat">
          <div class="row between">
            <div class="row">
              <label class="field">Format<select id="format" style="width:auto">${(FORMATS[d.channel] || [d.format]).map(f => html`<option ${f === d.format ? 'selected' : ''}>${f}</option>`)}</select></label>
              <label class="field">Angle<select id="angle" style="width:auto">${ANGLES.map(([k, l]) => html`<option value="${k}" ${k === d.angle ? 'selected' : ''}>${l}</option>`)}</select></label>
            </div>
            <button class="primary" data-act="regen">Regenerate unlocked sections</button>
          </div>
          <p class="small faint" style="margin:8px 0 0">Locked sections and your notes are preserved on every regeneration.</p>
        </section>
        ${d.channel === 'video' ? videoBriefHtml() : ''}
        <div class="stack" id="sections">${d.sections.map(sectionHtml)}</div>

        <section class="card">
          <div class="row between"><h3>My perspective</h3><div class="row"><button class="sm" data-act="add-note">Add note</button><button class="sm primary" data-act="apply-notes">Apply notes to draft</button></div></div>
          <div class="stack" id="notes">${notesHtml()}</div>
        </section>

        <section class="card"><h3>Editorial & affiliation checks</h3><div class="stack" id="flags">${flagsHtml()}</div></section>

        <section class="card"><div class="row between"><h3>Tags</h3><button class="sm" data-act="suggest-tags">Suggest tags</button></div><div id="tags">${tagsHtml()}</div></section>

        <section class="card"><h3>Version history</h3><div id="versions">${versionsHtml()}</div></section>
      </div>

      <div class="stack">
        <section class="card accent"><h3>Preview</h3><div id="preview">${previewHtml()}</div></section>
        ${d.channel !== 'video' ? html`<section class="card"><h3>Visual</h3><div id="visual">${visualHtml()}</div></section>` : ''}
        <section class="card"><h3>Review & approval</h3><div id="approval">${approvalHtml()}</div></section>
        <section class="card"><h3>Sources attached</h3>
          ${d.articles.map(a => html`<div class="source-row">${evChip(a.evidence_kind)}<a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.title}</a><span class="mono faint">${a.domain}</span></div>`)}
        </section>
        <section class="card"><h3>Adapt to another format</h3>
          <p class="small muted" style="margin-top:-4px">Same story record and sources; facts preserved, hook and structure adapted. Notes are copied.</p>
          <div class="row">
            <button class="sm" data-act="adapt" data-channel="linkedin" data-format="long">LinkedIn analysis</button>
            <button class="sm" data-act="adapt" data-channel="instagram" data-format="carousel">IG carousel</button>
            <button class="sm" data-act="adapt" data-channel="instagram" data-format="reel">IG Reel</button>
            <button class="sm" data-act="adapt" data-channel="instagram" data-format="story">IG Story</button>
            <button class="sm" data-act="adapt" data-channel="video" data-format="explainer">Video</button>
          </div>
        </section>
        <section class="card flat"><button class="sm danger" data-act="archive">${d.status === 'archived' ? 'Restore draft' : 'Archive draft'}</button></section>
      </div>
    </div>`);
  }

  function refreshPanels() {
    const set = (sel, v) => { const n = el.querySelector(sel); if (n) n.innerHTML = Array.isArray(v) ? v.join('') : String(v); };
    set('#flags', flagsHtml()); set('#approval', approvalHtml()); set('#preview', previewHtml()); set('#tags', tagsHtml()); set('#versions', versionsHtml());
    for (const s of d.sections) {
      const b = el.querySelector(`#sec-${CSS.escape(s.id)}`);
      if (b) b.classList.toggle('flagged', d.flags.some(f => f.section_id === s.id));
    }
    const st = el.querySelector('.page-head .status'); if (st) st.outerHTML = String(status(d.status));
  }

  async function saveSections(note) {
    d = await api.patch(`/drafts/${id}`, { sections: d.sections, note });
    refreshPanels();
  }
  const reload = async () => { d = await api.get(`/drafts/${id}`); paint(); };

  images = await api.get('/images');
  paint();

  // --- inputs (autosave) ---
  el.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.field) {
      const s = d.sections.find(x => x.id === t.dataset.id);
      if (!s) return;
      s[t.dataset.field] = t.dataset.field === 'duration' ? Number(t.value) : t.dataset.field === 'media_id' ? (t.value ? Number(t.value) : null) : t.value;
      if (t.tagName === 'TEXTAREA') t.rows = Math.max(2, Math.ceil(t.value.length / 80));
      clearTimeout(saveTimers.sec);
      saveTimers.sec = setTimeout(() => saveSections('edit').catch(err => toast(err.message, 'err')), 700);
    }
    if (t.dataset.noteText) {
      clearTimeout(saveTimers['n' + t.dataset.noteText]);
      saveTimers['n' + t.dataset.noteText] = setTimeout(async () => { await api.patch(`/notes/${t.dataset.noteText}`, { text: t.value }); d = await api.get(`/drafts/${id}`); refreshPanels(); }, 700);
    }
    if (t.dataset.imgField) {
      clearTimeout(saveTimers.img);
      saveTimers.img = setTimeout(async () => { await api.patch(`/images/${d.image.id}`, { [t.dataset.imgField]: t.value }); d = await api.get(`/drafts/${id}`); refreshPanels(); }, 700);
    }
  });
  el.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.noteInclude) { await api.patch(`/notes/${t.dataset.noteInclude}`, { include: t.checked }); d = await api.get(`/drafts/${id}`); el.querySelector('#notes').innerHTML = String(notesHtml()); refreshPanels(); toast(t.checked ? 'Note will be used — click “Apply notes to draft”' : 'Note is private again', 'ok'); }
    if (t.dataset.noteKind) await api.patch(`/notes/${t.dataset.noteKind}`, { kind: t.value });
    if (t.dataset.tag !== undefined && t.dataset.tag !== '') {
      const tags = d.tags.map((x, i) => i === Number(t.dataset.tag) ? { ...x, enabled: t.checked } : x);
      d = await api.patch(`/drafts/${id}`, { tags, note: 'tags' }); refreshPanels();
    }
    if (t.dataset.meta) {
      const meta = { ...(d.meta || {}), [t.dataset.meta]: t.type === 'number' ? Number(t.value) : (t.dataset.meta === 'narration_id' ? (t.value ? Number(t.value) : null) : t.value) };
      d = await api.patch(`/drafts/${id}`, { meta, note: 'video brief' }); refreshPanels();
    }
    if (t.dataset.field === 'media_id') { /* handled by input */ }
  });

  // --- actions ---
  on(el, 'click', '[data-act]', async (e, btn) => {
    const a = btn.dataset.act;
    const sid = btn.dataset.id;
    try {
      if (a === 'lock') { const s = d.sections.find(x => x.id === sid); s.locked = !s.locked; await saveSections(s.locked ? `lock ${s.label}` : `unlock ${s.label}`); paint(); }
      if (a === 'rewrite') await act(btn, async () => { d = await api.post(`/drafts/${id}/regenerate`, { section_id: sid, angle: el.querySelector('#angle').value }); paint(); toast('Section rewritten — earlier text saved in history', 'ok'); }, 'Rewriting…');
      if (a === 'regen') await act(btn, async () => { d = await api.post(`/drafts/${id}/regenerate`, { format: el.querySelector('#format').value, angle: el.querySelector('#angle').value }); paint(); toast('Regenerated unlocked sections', 'ok'); }, 'Regenerating…');
      if (a === 'goto') el.querySelector(`#sec-${CSS.escape(sid)}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      if (a === 'apply-fix') {
        const f = d.flags[Number(btn.dataset.i)];
        const s = d.sections.find(x => x.id === f.section_id);
        if (s && s.text.includes(f.sentence)) { s.text = s.text.replace(f.sentence, f.suggestion); await saveSections(`fix ${f.type}`); paint(); }
      }
      if (a === 'add-note') { d.notes = await api.post(`/drafts/${id}/notes`, { text: '', kind: 'observation' }); el.querySelector('#notes').innerHTML = String(notesHtml()); el.querySelector('#notes textarea:last-of-type')?.focus(); }
      if (a === 'del-note') { await api.del(`/notes/${sid}`); await reload(); }
      if (a === 'apply-notes') await act(btn, async () => { d = await api.post(`/drafts/${id}/apply-notes`); paint(); toast('Perspective section updated from your selected notes', 'ok'); });
      if (a === 'suggest-tags') await act(btn, async () => { d = await api.post(`/drafts/${id}/tags/suggest`); refreshPanels(); });
      if (a === 'restore') await act(btn, async () => { d = await api.post(`/drafts/${id}/versions/${sid}/restore`); paint(); toast('Version restored (current text saved first)', 'ok'); });
      if (a === 'view-version') {
        const v = await api.get(`/drafts/${id}/versions/${sid}`);
        modal(String(html`<h2>Version v${v.id}</h2><p class="muted small">${v.note} · ${fmtDateTime(v.created_at)}</p>${(v.sections || []).map(s => html`<div class="mono faint" style="margin-top:10px">${s.label}${s.locked ? ' · locked' : ''}</div><div style="white-space:pre-wrap">${s.text}</div>`)}<div class="row" style="justify-content:flex-end;margin-top:16px"><button data-close>Close</button></div>`), { wide: true });
      }
      if (a === 'more') { el.querySelector('#li-body').textContent = d.final_text; }
      if (a === 'visual') await act(btn, async () => { d = await api.post(`/drafts/${id}/visual`, { kind: btn.dataset.kind }); paint(); });
      if (a === 'no-image') { d = await api.patch(`/drafts/${id}`, { image_id: null, note: 'remove image' }); paint(); }
      if (a === 'upload' || a === 'upload-media') uploadDialog(a === 'upload-media');
      if (a === 'import') importDialog();
      if (a === 'library') libraryDialog();
      if (a === 'submit') { d = await api.post(`/drafts/${id}/submit`); refreshPanels(); }
      if (a === 'approve') {
        const noImage = d.channel === 'linkedin' && !d.image ? await confirmBox('No image is attached. Approve this post as text-only?', 'Approve text-only') : false;
        if (d.channel === 'linkedin' && !d.image && !noImage) return;
        await act(btn, async () => { d = await api.post(`/drafts/${id}/approve`, { hash: d.current_hash, no_image: noImage }); refreshPanels(); toast('Approved this exact version', 'ok'); });
      }
      if (a === 'unapprove') { d = await api.post(`/drafts/${id}/unapprove`); refreshPanels(); }
      if (a === 'next-slot') { const r = await api.get(`/slots/next?channel=${d.channel}`); if (r.date) el.querySelector('#sched-date').value = r.date; else toast('No open slot in the next 60 days', 'err'); }
      if (a === 'use-humor') {
        const v = d.sections.find(x => x.id === sid), hook = d.sections.find(x => x.kind === 'hook');
        if (!hook || hook.locked) return toast('Unlock the hook first.', 'err');
        const old = hook.text; hook.text = v.text; v.text = old;
        await saveSections('swap in humor hook'); paint(); toast('Humor hook swapped in — the plain version is kept as the variant', 'ok');
      }
      if (a === 'record') recordNarration();
      if (a === 'schedule') await act(btn, async () => { d = await api.post(`/drafts/${id}/schedule`, { date: el.querySelector('#sched-date').value }); refreshPanels(); toast('Scheduled — it’s on the calendar', 'ok'); });
      if (a === 'copy') copy(d.final_text);
      if (a === 'dl-image') await act(btn, async () => {
        const im = d.image;
        if (im.mime === 'image/svg+xml') download(`byline-${id}.png`, await svgToPng(`/media/${im.filename}`, 1200, 1200));
        else { const blob = await (await fetch(`/media/${im.filename}`)).blob(); download(im.filename, blob); }
      });
      if (a === 'dl-slides') await act(btn, async () => {
        const slides = d.sections.filter(s => ['slide', 'frame', 'beat', 'hook'].includes(s.kind));
        for (let i = 0; i < slides.length; i++) download(`byline-${id}-slide-${i + 1}.png`, await svgToPng(slideSvg(slides[i].text, i, slides.length).svg, 1080, 1350));
        const exp = await api.get(`/drafts/${id}/export`);
        download(`byline-${id}-caption.txt`, exp.text);
      });
      if (a === 'dl-notes') { const exp = await api.get(`/drafts/${id}/export`); download(`byline-${id}-source-notes.md`, exp.source_notes, 'text/markdown'); }
      if (a === 'publish') {
        if (!await confirmBox(`Publish this exact approved version to ${channelLabel(d.channel)} now?`, 'Publish')) return;
        await act(btn, async () => { d = await api.post(`/drafts/${id}/publish`, { confirm_hash: d.current_hash }); paint(); toast('Published', 'ok'); });
      }
      if (a === 'mark-published') await act(btn, async () => { d = await api.post(`/drafts/${id}/mark-published`, {}); paint(); toast('Marked as published', 'ok'); });
      if (a === 'adapt') await act(btn, async () => { const r = await api.post(`/drafts/${id}/adapt`, { channel: btn.dataset.channel, format: btn.dataset.format }); location.hash = `#/draft/${r.draft_id}`; }, 'Adapting…');
      if (a === 'render') await act(btn, async () => { const r = await api.post(`/drafts/${id}/render`, { orientation: d.meta?.orientation, burn_captions: el.querySelector('#burn')?.checked !== false }); d = r.draft; paint(); toast(`Rendered ${Math.round(r.duration)}s MP4`, 'ok'); }, 'Rendering…');
      if (a === 'archive') { d = await api.patch(`/drafts/${id}`, { status: d.status === 'archived' ? 'draft' : 'archived' }); paint(); }
    } catch (err) { toast(err.message, 'err'); }
  });

  function recordNarration() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Recording needs a browser with microphone support (Chrome, Edge, Safari 14.1+).', 'err');
    const script = d.sections.filter(x => x.kind === 'scene').map((x, i) => `${i + 1}. ${x.text}`).join('\n');
    const m = modal(String(html`<h2>Record narration</h2><p class="muted small">Read the scenes in order. Your recording is saved as your own voice in the media rights log and set as this video's narration.</p>
      <pre class="code" style="max-height:220px">${script}</pre>
      <div class="row" style="margin-top:12px"><button class="primary" id="rec">● Start recording</button><span class="mono" id="timer">0:00</span></div>
      <audio id="play" controls style="width:100%;margin-top:12px" hidden></audio>
      <div class="row" style="justify-content:flex-end;margin-top:14px"><button data-close>Cancel</button><button class="primary" id="save" disabled>Use this take</button></div>`));
    let rec, chunks = [], blob, t0, tick, stream;
    const recBtn = m.el.querySelector('#rec');
    recBtn.onclick = async () => {
      if (rec?.state === 'recording') { rec.stop(); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { return toast('Microphone permission was denied.', 'err'); }
      chunks = []; rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop()); clearInterval(tick);
        blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const a = m.el.querySelector('#play'); a.src = URL.createObjectURL(blob); a.hidden = false;
        recBtn.textContent = '● Record again'; m.el.querySelector('#save').disabled = false;
      };
      rec.start(); t0 = Date.now(); recBtn.textContent = '■ Stop';
      tick = setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000); m.el.querySelector('#timer').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }, 500);
    };
    m.el.querySelector('#save').onclick = (ev) => act(ev.target, async () => {
      const ext = (blob.type.includes('mp4') ? '.m4a' : '.webm');
      const img = await api.post('/images', { filename: `narration-${id}${ext}`, mime: blob.type.split(';')[0].replace('video/', 'audio/'), data: await fileToBase64(blob),
        attribution: 'My own recorded voice', license: 'Own work', rights: { type: 'audio', own_voice: true } });
      images = await api.get('/images');
      d = await api.patch(`/drafts/${id}`, { meta: { ...(d.meta || {}), narration_id: img.id }, note: 'record narration' });
      m.close(); paint(); toast('Narration saved and attached', 'ok');
    }, 'Saving…');
  }

  function uploadDialog(media) {
    const m = modal(String(html`<h2>${media ? 'Upload footage, image, or audio' : 'Upload an image'}</h2>
      <div class="form-grid">
        <label class="field full">File<input type="file" id="f" accept="${media ? 'image/*,video/*,audio/*' : 'image/*'}"></label>
        <label class="field">Attribution<input id="attr" value="Me"></label>
        <label class="field">License<input id="lic" value="Own work"></label>
        <label class="field full">Original source (optional)<input id="src"></label>
        ${!media ? html`<label class="field full">Alt text<textarea id="alt" rows="2"></textarea></label>` : ''}
        ${media ? html`<label class="check full"><input type="checkbox" id="synth"> This contains synthetic narration or a generated likeness</label>` : ''}
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button data-close>Cancel</button><button class="primary" id="go">Upload</button></div>`));
    m.el.querySelector('#go').onclick = async (ev) => {
      const file = m.el.querySelector('#f').files[0];
      if (!file) return toast('Choose a file', 'err');
      await act(ev.target, async () => {
        const synth = m.el.querySelector('#synth')?.checked;
        const img = await api.post('/images', { filename: file.name, mime: file.type, data: await fileToBase64(file), attribution: m.el.querySelector('#attr').value, license: m.el.querySelector('#lic').value,
          source_url: m.el.querySelector('#src').value, alt: m.el.querySelector('#alt')?.value || '', rights: { type: file.type.split('/')[0], synthetic_voice: synth && file.type.startsWith('audio'), synthetic_likeness: synth && !file.type.startsWith('audio') } });
        images = await api.get('/images');
        if (!media) d = await api.patch(`/drafts/${id}`, { image_id: img.id, note: 'upload image' });
        m.close(); paint(); toast('Uploaded', 'ok');
      }, 'Uploading…');
    };
  }
  function importDialog() {
    const m = modal(String(html`<h2>Use a sourced image</h2><p class="muted small">Attribution and license are required and saved with the image.</p>
      <div class="form-grid"><label class="field full">Image URL<input id="u"></label><label class="field">Attribution (creator / site)<input id="attr"></label>
      <label class="field">License<input id="lic" placeholder="e.g. CC BY 4.0, Unsplash License"></label><label class="field full">Page where you found it<input id="src"></label>
      <label class="field full">Alt text<textarea id="alt" rows="2"></textarea></label></div>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button data-close>Cancel</button><button class="primary" id="go">Import</button></div>`));
    m.el.querySelector('#go').onclick = (ev) => act(ev.target, async () => {
      const g = (s) => m.el.querySelector(s).value;
      const img = await api.post('/images/import', { url: g('#u'), attribution: g('#attr'), license: g('#lic'), source_url: g('#src') || g('#u'), alt: g('#alt') });
      d = await api.patch(`/drafts/${id}`, { image_id: img.id, note: 'sourced image' }); m.close(); paint();
    }, 'Downloading…');
  }
  async function libraryDialog() {
    images = await api.get('/images?kind=image');
    const m = modal(String(html`<h2>Image library</h2><div class="thumbs">${images.map(i => html`<img src="/media/${i.filename}" data-pick="${i.id}" class="${d.image_id === i.id ? 'sel' : ''}" title="${i.generated ? 'Generated' : i.attribution}" alt="${i.alt || ''}">`)}</div>
      <div class="row" style="justify-content:flex-end;margin-top:16px"><button data-close>Close</button></div>`), { wide: true });
    on(m.el, 'click', '[data-pick]', async (e, t) => { d = await api.patch(`/drafts/${id}`, { image_id: Number(t.dataset.pick), note: 'choose image' }); m.close(); paint(); });
  }
}
