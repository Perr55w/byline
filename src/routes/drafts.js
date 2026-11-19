import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { all, get, run, now, hydrate, parse, getSettings, MEDIA_DIR } from '../db.js';
import { loadStory, loadDraft, loadNotes, loadExperiences, loadEmployers, saveDraft, mergeLocked, createDraft, snapshot } from '../store.js';
import { getProvider } from '../ai/index.js';
import { checkDraft, blockingFlags } from '../editorial.js';
import { generateVisual, saveSvg, cardSvg, diagramSvg } from '../visual.js';
import { publishers } from '../publishers/index.js';
import { sentences, truncate } from '../text.js';
import { hashFile } from '../blurhash.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Story context for a draft: real story, or a pseudo-story built from a portfolio project. */
export function draftContext(d) {
  if (d.story_id) {
    const s = loadStory(d.story_id);
    if (s) {
      // Roundups draw on linked stories too, so their sources count as evidence.
      for (const lid of d.meta?.linked_story_ids || []) { const l = loadStory(lid); if (l) { s.articles.push(...l.articles); s.claims.push(...l.claims); } }
      return s;
    }
  }
  if (d.project_id) {
    const p = get('SELECT * FROM projects WHERE id = ?', d.project_id);
    if (p) {
      const text = [p.question, p.tested && `What I tested: ${p.tested}`, p.findings && `What I found: ${p.findings}`, p.next_steps && `Next: ${p.next_steps}`].filter(Boolean).join('. ');
      const art = { id: 0, url: `project://${p.id}`, domain: 'my project', title: p.title, summary: text, content: text, evidence_kind: 'own_work', published_at: p.updated_at };
      return { story: { id: null, title: p.title, summary: text, topics: [], companies: p.employer ? [p.employer] : [] }, articles: [art], claims: sentences(text).map(t => ({ text: t, article_id: 0, evidence_kind: 'own_work', has_number: /\d/.test(t) ? 1 : 0 })), project: p };
    }
  }
  return { story: { title: d.title || 'Untitled', topics: [], companies: [] }, articles: [], claims: [] };
}

/** Final public text with enabled tags applied (tag removal never rewrites the post). */
export function finalText(d) {
  const skip = new Set(['sources', 'checklist', 'scene', 'slide', 'frame', 'beat', 'humor_variant']);
  let sections = (d.sections || []).map(s => ({ ...s }));
  for (const t of (d.tags || []).filter(t => t.enabled)) {
    const s = sections.find(x => x.id === t.section_id);
    if (s && t.match && s.text.includes(t.match)) s.text = s.text.replace(t.match, `@${t.name}`);
  }
  if (d.channel === 'instagram' && d.format === 'reel') skip.delete('beat');
  const body = sections.filter(s => !skip.has(s.kind)).map(s => s.text.trim()).filter(Boolean).join('\n\n');
  const src = sections.find(s => s.kind === 'sources');
  return d.channel === 'linkedin' && src?.text ? `${body}\n\nSources:\n${src.text}` : body;
}

function fullDraft(id) {
  const d = loadDraft(id);
  if (!d) throw bad('Draft not found', 404);
  const ctx = draftContext(d);
  const notes = loadNotes(d.id, d.story_id);
  const flags = checkDraft({ draft: d, ...ctx, notes, experiences: loadExperiences(), employers: loadEmployers() });
  return {
    ...d, story: ctx.story, articles: ctx.articles, claims: ctx.claims, project: ctx.project || null, notes, flags,
    blocking: blockingFlags(flags).length, final_text: finalText(d),
    versions: all('SELECT id, note, created_at FROM draft_versions WHERE draft_id = ? ORDER BY id DESC LIMIT 50', d.id),
    siblings: d.story_id ? all('SELECT id, channel, format, status FROM drafts WHERE story_id = ? AND id != ?', d.story_id, d.id) : [],
    publisher: publishers[d.channel === 'video' ? 'instagram' : d.channel]?.status() || { available: false, note: 'Manual export only.' }
  };
}

function rebuildPerspective(d) {
  const notes = loadNotes(d.id, d.story_id).filter(n => n.include);
  const sec = (d.sections || []).find(s => s.kind === 'perspective');
  if (!sec || sec.locked) return d.sections;
  const text = notes.length ? notes.map(n => n.text.trim()).join('\n\n') : '[Your perspective: add a note in “My perspective” and tick “Use in draft”.]';
  return d.sections.map(s => s.id === sec.id ? { ...s, text } : s);
}

const FONT_CANDIDATES = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf', '/System/Library/Fonts/Helvetica.ttc', 'C:/Windows/Fonts/arialbd.ttf'];
const ffEsc = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const wrapText = (t, n) => { const out = []; let line = ''; for (const w of String(t).split(/\s+/)) { if ((line + ' ' + w).trim().length > n) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); } if (line) out.push(line); return out.join('\n'); };

function renderVideo(d, { orientation = 'vertical', burnCaptions = true } = {}) {
  const [W, H] = orientation === 'landscape' ? [1920, 1080] : [1080, 1920];
  const scenes = d.sections.filter(s => s.kind === 'scene');
  if (!scenes.length) throw bad('No scenes to render.');
  const font = FONT_CANDIDATES.find(f => fs.existsSync(f));
  const work = path.join(MEDIA_DIR, `render-${d.id}-${Date.now()}`);
  fs.mkdirSync(work);
  const segs = [];
  scenes.forEach((sc, i) => {
    const dur = Math.max(1, Number(sc.duration) || 4);
    const media = sc.media_id ? get('SELECT * FROM images WHERE id = ?', sc.media_id) : null;
    const args = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (media && /^video\//.test(media.mime)) args.push('-t', String(dur), '-i', path.join(MEDIA_DIR, media.filename));
    else if (media && /^image\//.test(media.mime)) args.push('-loop', '1', '-t', String(dur), '-i', path.join(MEDIA_DIR, media.filename));
    else args.push('-f', 'lavfi', '-t', String(dur), '-i', `color=c=0xF3EEE4:s=${W}x${H}:r=30`);
    args.push('-f', 'lavfi', '-t', String(dur), '-i', 'anullsrc=r=44100:cl=stereo');
    let vf = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x1C1A16,setsar=1,fps=30,format=yuv420p`;
    if (font) {
      if (sc.onscreen) {
        const f = path.join(work, `on${i}.txt`); fs.writeFileSync(f, wrapText(sc.onscreen, orientation === 'landscape' ? 32 : 18));
        vf += `,drawtext=fontfile='${ffEsc(font)}':textfile='${ffEsc(f)}':fontcolor=0xF3EEE4:fontsize=${orientation === 'landscape' ? 72 : 84}:line_spacing=14:box=1:boxcolor=0x1C1A16@0.92:boxborderw=28:x=(w-text_w)/2:y=h*0.18`;
      }
      if (burnCaptions && sc.text) {
        const f = path.join(work, `cap${i}.txt`); fs.writeFileSync(f, wrapText(sc.text, orientation === 'landscape' ? 60 : 30));
        vf += `,drawtext=fontfile='${ffEsc(font)}':textfile='${ffEsc(f)}':fontcolor=white:fontsize=${orientation === 'landscape' ? 40 : 46}:line_spacing=10:box=1:boxcolor=black@0.6:boxborderw=18:x=(w-text_w)/2:y=h-text_h-h*0.12`;
      }
    }
    vf += '[v]';
    const out = path.join(work, `seg${i}.mp4`);
    args.push('-filter_complex', vf, '-map', '[v]', '-map', '1:a', '-t', String(dur), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-shortest', out);
    execFileSync('ffmpeg', args, { stdio: 'pipe' });
    segs.push({ out, dur, text: sc.text });
  });
  const list = path.join(work, 'list.txt');
  fs.writeFileSync(list, segs.map(s => `file '${s.out.replace(/'/g, "'\\''")}'`).join('\n'));
  const base = `video-${d.id}-${orientation}-${Date.now()}`;
  const mp4 = path.join(MEDIA_DIR, `${base}.mp4`);
  const narration = d.meta?.narration_id ? get('SELECT * FROM images WHERE id = ?', d.meta.narration_id) : null;
  const concatArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
  if (narration) concatArgs.push('-i', path.join(MEDIA_DIR, narration.filename), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-shortest', mp4);
  else concatArgs.push('-c', 'copy', mp4);
  execFileSync('ffmpeg', concatArgs, { stdio: 'pipe' });
  // Subtitles (SRT) from scene timings
  let t = 0; const fmt = (s) => { const ms = Math.round(s * 1000); const h = String(Math.floor(ms / 3600000)).padStart(2, '0'); const m = String(Math.floor(ms / 60000) % 60).padStart(2, '0'); const ss = String(Math.floor(ms / 1000) % 60).padStart(2, '0'); return `${h}:${m}:${ss},${String(ms % 1000).padStart(3, '0')}`; };
  const srt = segs.map((s, i) => { const a = t; t += s.dur; return `${i + 1}\n${fmt(a)} --> ${fmt(t)}\n${s.text}\n`; }).join('\n');
  fs.writeFileSync(path.join(MEDIA_DIR, `${base}.srt`), srt);
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', mp4, '-frames:v', '1', path.join(MEDIA_DIR, `${base}-thumb.jpg`)], { stdio: 'pipe' });
  const caption = (d.sections.find(s => s.kind === 'caption')?.text || '') + '\n\nSources:\n' + (d.sections.find(s => s.kind === 'sources')?.text || draftContext(d).articles.map(a => `${a.title} — ${a.url}`).join('\n'));
  fs.writeFileSync(path.join(MEDIA_DIR, `${base}-caption.txt`), caption.trim());
  fs.rmSync(work, { recursive: true, force: true });
  return { mp4: `${base}.mp4`, srt: `${base}.srt`, thumbnail: `${base}-thumb.jpg`, caption: `${base}-caption.txt`, duration: t, captions_burned: !!font && burnCaptions, font_found: !!font };
}

export function registerDrafts(route) {
  route('GET', '/api/drafts', ({ query }) => {
    const w = []; const p = [];
    if (query.channel) { w.push('channel = ?'); p.push(query.channel); }
    if (query.status) { w.push('status = ?'); p.push(query.status); } else if (!query.all) w.push("status != 'archived'");
    if (query.campaign_id) { w.push('campaign_id = ?'); p.push(query.campaign_id); }
    return all(`SELECT id, title, channel, format, angle, status, planned_date, published_at, story_id, project_id, campaign_id, image_id, updated_at, metrics_json FROM drafts ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY updated_at DESC LIMIT 200`, ...p).map(hydrate);
  });
  route('GET', '/api/drafts/:id', ({ params }) => fullDraft(params.id));
  route('PATCH', '/api/drafts/:id', ({ params, body }) => {
    const allowed = ['sections', 'tags', 'image_id', 'planned_date', 'title', 'meta', 'angle', 'format', 'campaign_id', 'metrics'];
    const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)));
    if (body.status && ['draft', 'archived', 'in_review'].includes(body.status)) patch.status = body.status;
    if (body.status === 'draft') { run('UPDATE drafts SET approved_hash = NULL, approved_at = NULL WHERE id = ?', params.id); }
    saveDraft(params.id, patch, body.note || 'edit');
    return fullDraft(params.id);
  });
  route('DELETE', '/api/drafts/:id', ({ params }) => { run('DELETE FROM drafts WHERE id = ?', params.id); return { ok: true }; });

  route('POST', '/api/drafts/:id/regenerate', async ({ params, body }) => {
    const d = loadDraft(params.id);
    const ctx = draftContext(d);
    const ai = getProvider();
    const notes = loadNotes(d.id, d.story_id);
    const seed = (d.meta?.regen || 0) + 1;
    const meta = { ...(d.meta || {}), regen: seed };
    if (body.section_id) {
      const section = d.sections.find(s => s.id === body.section_id);
      if (!section) throw bad('Section not found');
      if (section.locked) throw bad('That section is locked. Unlock it to rewrite.');
      const text = await ai.rewriteSection({ section, sections: d.sections, ...ctx, angle: body.angle || d.angle, seed, notes, profile: getSettings().writing_profile });
      saveDraft(d.id, { sections: d.sections.map(s => s.id === section.id ? { ...s, text } : s), meta }, `rewrite ${section.label}`);
    } else {
      const format = body.format || d.format, angle = body.angle || d.angle;
      const linked = (d.meta?.linked_story_ids || []).map(id => loadStory(id)?.story).filter(Boolean);
      const fresh = await ai.draft({ ...ctx, stories: linked, format, angle, notes, experiences: loadExperiences(), profile: getSettings().writing_profile, channel: d.channel, seed });
      // Video scenes keep their assigned media.
      const freshWithMedia = fresh.map(s => { const old = d.sections.find(o => o.id === s.id); return old?.media_id ? { ...s, media_id: old.media_id } : s; });
      saveDraft(d.id, { sections: mergeLocked(d.sections, freshWithMedia), format, angle, meta }, 'regenerate');
    }
    return fullDraft(d.id);
  });

  route('POST', '/api/drafts/:id/apply-notes', ({ params }) => {
    const d = loadDraft(params.id);
    saveDraft(d.id, { sections: rebuildPerspective(d) }, 'apply notes');
    return fullDraft(d.id);
  });

  // ----- approval & publishing -----
  route('POST', '/api/drafts/:id/approve', ({ params, body }) => {
    const d = fullDraft(params.id);
    if (body.hash !== d.current_hash) throw bad('The draft changed since you reviewed it. Review the current version and approve again.', 409);
    if (d.blocking) throw bad(`Resolve ${d.blocking} blocking flag(s) first (placeholders or private notes).`);
    if (d.channel === 'linkedin' && !d.image_id && !body.no_image) throw bad('No image attached. Attach one or confirm posting without an image.');
    run("UPDATE drafts SET status = 'approved', approved_hash = ?, approved_at = ? WHERE id = ?", d.current_hash, now(), d.id);
    return fullDraft(d.id);
  });
  route('POST', '/api/drafts/:id/unapprove', ({ params }) => { run("UPDATE drafts SET status = 'in_review', approved_hash = NULL, approved_at = NULL WHERE id = ?", params.id); return fullDraft(params.id); });
  route('POST', '/api/drafts/:id/submit', ({ params }) => { run("UPDATE drafts SET status = 'in_review' WHERE id = ? AND status = 'draft'", params.id); return fullDraft(params.id); });
  route('POST', '/api/drafts/:id/schedule', ({ params, body }) => {
    const d = loadDraft(params.id);
    if (!d.approval_valid) throw bad('Approve the current text and media before scheduling.');
    if (!body.date) throw bad('Date required');
    run("UPDATE drafts SET status = 'scheduled', planned_date = ? WHERE id = ?", body.date, d.id);
    return fullDraft(d.id);
  });
  route('POST', '/api/drafts/:id/plan', ({ params, body }) => {
    // Calendar drag-to-day: changes planned_date only. Status, approval and content are untouched, so a scheduled
    // post stays scheduled and approved. body.date = 'YYYY-MM-DD' to plan, or null/'' to move back to the tray.
    const d = get('SELECT id, status, planned_date FROM drafts WHERE id = ?', params.id);
    if (!d) throw bad('Draft not found', 404);
    const date = body.date || null;
    if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw bad('Date must be YYYY-MM-DD, or null to unplan.');
    if (d.status === 'published') throw bad('Published posts cannot be moved.', 409);
    run('UPDATE drafts SET planned_date = ? WHERE id = ?', date, d.id);
    return { ok: true, id: d.id, planned_date: date, previous_date: d.planned_date || null, status: d.status };
  });
  route('POST', '/api/drafts/:id/publish', async ({ params, body }) => {
    const d = loadDraft(params.id);
    if (!d.approval_valid || body.confirm_hash !== d.current_hash) throw bad('Direct publishing requires your approval of the exact current text and image.', 409);
    if (d.published_at) throw bad('Already published — not sending again.', 409);
    const pub = publishers[d.channel];
    if (!pub?.status().available) throw bad(`Direct publishing to ${d.channel} is not connected. ${pub?.status().note || ''} Use Copy/Download, post manually, then “Mark as published”.`);
    const r = await pub.publish({ text: finalText(d), hasImage: !!d.image_id });
    run("UPDATE drafts SET status = 'published', published_at = ?, publish_ref = ? WHERE id = ?", now(), r.ref, d.id);
    return fullDraft(d.id);
  });
  route('POST', '/api/drafts/:id/mark-published', ({ params, body }) => {
    const d = loadDraft(params.id);
    if (!d.approval_valid) throw bad('Approve the current version before marking it published.');
    run("UPDATE drafts SET status = 'published', published_at = ?, publish_ref = ? WHERE id = ?", body.date || now(), body.url || 'manual', d.id);
    return fullDraft(d.id);
  });

  // ----- versions -----
  route('GET', '/api/drafts/:id/versions/:vid', ({ params }) => hydrate(get('SELECT * FROM draft_versions WHERE id = ? AND draft_id = ?', params.vid, params.id)));
  route('POST', '/api/drafts/:id/versions/:vid/restore', ({ params }) => {
    const v = get('SELECT * FROM draft_versions WHERE id = ? AND draft_id = ?', params.vid, params.id);
    if (!v) throw bad('Version not found', 404);
    saveDraft(params.id, { sections: parse(v.sections_json, []) }, `restore v${v.id}`);
    return fullDraft(params.id);
  });

  // ----- notes (perspective editor) -----
  route('POST', '/api/drafts/:id/notes', ({ params, body }) => {
    const d = loadDraft(params.id);
    run('INSERT INTO notes(draft_id, story_id, text, kind, include, public_ok, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)', d.id, d.story_id, body.text || '', body.kind || 'observation', body.include ? 1 : 0, body.include ? 1 : 0, now(), now());
    return loadNotes(d.id, d.story_id);
  });
  route('PATCH', '/api/notes/:id', ({ params, body }) => {
    for (const k of ['text', 'kind']) if (k in body) run(`UPDATE notes SET ${k} = ?, updated_at = ? WHERE id = ?`, body[k], now(), params.id);
    if ('include' in body) run('UPDATE notes SET include = ?, public_ok = ?, updated_at = ? WHERE id = ?', body.include ? 1 : 0, body.include ? 1 : 0, now(), params.id);
    return get('SELECT * FROM notes WHERE id = ?', params.id);
  });
  route('DELETE', '/api/notes/:id', ({ params }) => { run('DELETE FROM notes WHERE id = ?', params.id); return { ok: true }; });

  // ----- tags -----
  route('POST', '/api/drafts/:id/tags/suggest', ({ params }) => {
    const d = loadDraft(params.id);
    const ctx = draftContext(d);
    const sourceText = ctx.articles.map(a => `${a.title} ${a.summary} ${a.content}`).join(' ');
    const existing = new Set((d.tags || []).map(t => t.name));
    const out = [...(d.tags || [])];
    const candidates = [
      ...loadEmployers().map(e => ({ name: e.name, kind: 'company', match: e.name })),
      ...all('SELECT name, org, employer FROM contacts WHERE dnc = 0').map(c => ({ name: c.name, kind: 'person', match: c.name }))
    ];
    for (const c of candidates) {
      if (existing.has(c.name)) continue;
      for (const s of d.sections.filter(x => !['sources', 'checklist'].includes(x.kind))) {
        const sent = sentences(s.text).concat([s.text]).find(x => x.includes(c.match));
        if (!sent) continue;
        const inSource = sourceText.includes(c.match);
        const src = ctx.articles.find(a => `${a.title} ${a.summary} ${a.content}`.includes(c.match));
        out.push({ name: c.name, kind: c.kind, section_id: s.id, sentence: sent, match: c.match, enabled: false,
          reason: inSource ? `The draft discusses ${c.name} directly and ${src?.domain} covers their published work.` : `The draft names ${c.name}, but no source discusses their work — tagging is not recommended.`,
          recommended: inSource, source: src ? { url: src.url, title: src.title, domain: src.domain } : null });
        break;
      }
    }
    saveDraft(d.id, { tags: out }, 'tag suggestions');
    return fullDraft(d.id);
  });

  // ----- visuals & media -----
  route('POST', '/api/drafts/:id/visual', ({ params, body }) => {
    const d = loadDraft(params.id);
    const ctx = draftContext(d);
    let id;
    if (body.kind === 'card') id = saveSvg(cardSvg({ kicker: ctx.story.topics?.[0] || 'AI briefing', title: body.title || ctx.story.title, footer: ctx.articles.map(a => a.domain).slice(0, 3).join(' · '), w: body.w || 1200, h: body.h || 1200 }), { origin: 'illustration', alt: `Text card reading “${body.title || ctx.story.title}”.` });
    else if (body.kind === 'diagram') id = saveSvg(diagramSvg(ctx), { origin: 'diagram', alt: `Four-step diagram for “${ctx.story.title}”: what changed, what it claims, what others found, what to test.` });
    else id = generateVisual(ctx.story, ctx.claims, ctx.articles).id;
    saveDraft(d.id, { image_id: id }, 'new visual');
    return fullDraft(d.id);
  });
  route('GET', '/api/plate', ({ query }) => {
    const im = get('SELECT id FROM images WHERE filename = ?', String(query.file || ''));
    if (!im) return { blurhash: null, ar: null };
    return plateFor(im.id);
  });
  route('GET', '/api/images/:id/plate', ({ params }) => plateFor(params.id));
  function plateFor(id) {
    const im = get('SELECT id, filename, mime, blurhash, ar FROM images WHERE id = ?', id);
    if (!im) return { blurhash: null, ar: null };
    if (!im.blurhash && /^image\//.test(im.mime || '')) {
      const bh = hashFile(path.join(MEDIA_DIR, im.filename));
      if (bh) { run('UPDATE images SET blurhash = ?, ar = ? WHERE id = ?', bh.hash, bh.ar, im.id); Object.assign(im, { blurhash: bh.hash, ar: bh.ar }); }
    }
    return { id: im.id, blurhash: im.blurhash, ar: im.ar };
  }
  route('GET', '/api/images', ({ query }) => all(`SELECT * FROM images ${query.kind ? 'WHERE mime LIKE ?' : ''} ORDER BY id DESC LIMIT 200`, ...(query.kind ? [`${query.kind}/%`] : [])).map(hydrate));
  route('POST', '/api/images', ({ body }) => {
    if (!body.data || !body.filename) throw bad('File data required');
    const rights = body.rights || {};
    if ((rights.synthetic_voice || rights.synthetic_likeness) && !getSettings().synthetic_media_opt_in) throw bad('Synthetic narration/likeness requires opting in under Settings → Media.');
    const ext = (path.extname(body.filename) || '').toLowerCase().replace(/[^.a-z0-9]/g, '');
    if (!/^\.(png|jpe?g|webp|gif|svg|mp4|mov|webm|mp3|wav|m4a)$/.test(ext)) throw bad('Unsupported file type');
    const filename = `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), Buffer.from(body.data.split(',').pop(), 'base64'));
    const mime = body.mime || { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' }[ext];
    const r = run('INSERT INTO images(filename, mime, origin, source_url, attribution, license, generated, alt, rights_json, created_at) VALUES(?,?,?,?,?,?,0,?,?,?)',
      filename, mime, body.origin || 'upload', body.source_url || null, body.attribution || 'Uploaded by me', body.license || 'Own work', body.alt || '', JSON.stringify(rights), now());
    const bh = /^image\//.test(mime || '') ? hashFile(path.join(MEDIA_DIR, filename)) : null;
    if (bh) run('UPDATE images SET blurhash = ?, ar = ? WHERE id = ?', bh.hash, bh.ar, Number(r.lastInsertRowid));
    return get('SELECT * FROM images WHERE id = ?', Number(r.lastInsertRowid));
  });
  route('POST', '/api/images/import', async ({ body }) => {
    if (!/^https?:\/\//.test(body.url || '')) throw bad('Image URL required');
    if (!body.attribution || !body.license) throw bad('Attribution and license are required for sourced images.');
    const res = await fetch(body.url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw bad(`Could not download image (HTTP ${res.status})`, 502);
    const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    if (!mime.startsWith('image/')) throw bad('URL is not an image');
    const ext = { 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg' }[mime] || '.jpg';
    const filename = `src-${Date.now()}${ext}`;
    fs.writeFileSync(path.join(MEDIA_DIR, filename), Buffer.from(await res.arrayBuffer()));
    const r = run('INSERT INTO images(filename, mime, origin, source_url, attribution, license, generated, alt, created_at) VALUES(?,?,?,?,?,?,0,?,?)', filename, mime, 'sourced', body.source_url || body.url, body.attribution, body.license, body.alt || '', now());
    const bh = hashFile(path.join(MEDIA_DIR, filename));
    if (bh) run('UPDATE images SET blurhash = ?, ar = ? WHERE id = ?', bh.hash, bh.ar, Number(r.lastInsertRowid));
    return get('SELECT * FROM images WHERE id = ?', Number(r.lastInsertRowid));
  });
  route('PATCH', '/api/images/:id', ({ params, body }) => {
    for (const k of ['alt', 'attribution', 'license', 'source_url']) if (k in body) run(`UPDATE images SET ${k} = ? WHERE id = ?`, body[k], params.id);
    if ('rights' in body) run('UPDATE images SET rights_json = ? WHERE id = ?', JSON.stringify(body.rights), params.id);
    // Alt text is part of the approved package: drafts using this image return to review.
    for (const d of all("SELECT id FROM drafts WHERE image_id = ? AND status IN ('approved','scheduled')", params.id)) saveDraft(d.id, {}, 'image details');
    return get('SELECT * FROM images WHERE id = ?', params.id);
  });

  // ----- adapt across channels (same story/project record, sources carried over) -----
  route('POST', '/api/drafts/:id/adapt', async ({ params, body }) => {
    const d = loadDraft(params.id);
    const ctx = draftContext(d);
    const channel = body.channel, format = body.format || ({ instagram: 'carousel', video: 'explainer', linkedin: 'long' }[channel]);
    if (!channel) throw bad('Target channel required');
    const notes = loadNotes(d.id, d.story_id);
    const sections = await getProvider().draft({ ...ctx, format, angle: d.angle, notes, experiences: loadExperiences(), profile: getSettings().writing_profile, channel });
    const id = createDraft({ story_id: d.story_id, project_id: d.project_id, campaign_id: d.campaign_id, channel, format, angle: d.angle, title: d.title, sections,
      image_id: channel === 'video' ? null : d.image_id, source_ids: d.source_ids || [], meta: { adapted_from: d.id, linked_story_ids: d.meta?.linked_story_ids || [], ...(channel === 'video' ? { orientation: 'vertical', platform: 'Instagram Reels', audience: '', purpose: '', length: 26 } : {}) } });
    for (const n of notes) run('INSERT INTO notes(draft_id, story_id, text, kind, include, public_ok, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)', id, d.story_id, n.text, n.kind, n.include, n.public_ok, now(), now());
    return { draft_id: id };
  });

  // ----- export -----
  route('GET', '/api/drafts/:id/export', ({ params }) => {
    const d = fullDraft(params.id);
    const sourceNotes = [`# Source notes — ${d.title}`, '', `Draft #${d.id} · ${d.channel}/${d.format} · status: ${d.status}`, '',
      '## Sources', ...d.articles.map(a => `- [${a.evidence_kind}] ${a.title} — ${a.domain} — ${a.url}${a.published_at ? ` (${a.published_at.slice(0, 10)})` : ''}`), '',
      '## Claims and evidence', ...d.claims.map(c => { const a = d.articles.find(x => x.id === c.article_id); return `- “${c.text}” — ${c.evidence_kind}${a ? `, ${a.url}` : ''}`; }), '',
      d.image ? `## Image\n- File: ${d.image.filename}\n- ${d.image.generated ? 'Generated in Byline' : `Source: ${d.image.source_url || 'upload'}`}\n- Attribution: ${d.image.attribution || ''}\n- License: ${d.image.license || ''}\n- Alt text: ${d.image.alt || ''}` : ''
    ].join('\n'); // private notes are intentionally excluded
    const slides = d.sections.filter(s => s.kind === 'slide').map(s => s.text);
    return { text: d.final_text, source_notes: sourceNotes, image: d.image, slides, approved: d.approval_valid };
  });

  route('POST', '/api/drafts/:id/render', ({ params, body }) => {
    const d = loadDraft(params.id);
    if (d.channel !== 'video') throw bad('Only video drafts can be rendered.');
    const out = renderVideo(d, { orientation: body.orientation || d.meta?.orientation || 'vertical', burnCaptions: body.burn_captions !== false });
    const meta = { ...(d.meta || {}), renders: [out, ...(d.meta?.renders || [])].slice(0, 5) };
    run('UPDATE drafts SET meta_json = ? WHERE id = ?', JSON.stringify(meta), d.id); // rendering does not change approved content
    return { ...out, draft: fullDraft(d.id) };
  });

  // ----- calendar & performance -----
  route('GET', '/api/calendar', ({ query }) => {
    const m = query.month || now().slice(0, 7);
    return {
      month: m,
      drafts: all("SELECT d.id, d.title, d.channel, d.format, d.status, d.planned_date, d.published_at, d.story_id, s.score, s.title AS story_title, d.approved_hash IS NOT NULL AS approved FROM drafts d LEFT JOIN stories s ON s.id = d.story_id WHERE d.status != 'archived' AND (substr(d.planned_date,1,7) = ? OR substr(d.published_at,1,7) = ?) ORDER BY COALESCE(d.planned_date, d.published_at), d.id", m, m).map(d => ({ ...d, approved: !!d.approved })),
      unplanned: all("SELECT d.id, d.title, d.channel, d.format, d.status, d.story_id, s.score, s.title AS story_title FROM drafts d LEFT JOIN stories s ON s.id = d.story_id WHERE d.planned_date IS NULL AND d.status IN ('draft','in_review','approved') ORDER BY d.updated_at DESC LIMIT 30"),
      unplanned_total: get("SELECT COUNT(*) AS n FROM drafts WHERE planned_date IS NULL AND status IN ('draft','in_review','approved')").n,
      outreach: all("SELECT o.id, o.channel, o.status, o.send_at, c.name FROM outreach o JOIN contacts c ON c.id = o.contact_id WHERE substr(o.send_at,1,7) = ?", m),
      history: all("SELECT d.id, d.title, d.channel, d.format, d.published_at, d.story_id, s.score FROM drafts d LEFT JOIN stories s ON s.id = d.story_id WHERE d.status = 'published' ORDER BY d.published_at DESC LIMIT 20")
    };
  });
  route('PATCH', '/api/drafts/:id/metrics', ({ params, body }) => {
    const d = get('SELECT metrics_json FROM drafts WHERE id = ?', params.id);
    if (!d) throw bad('Draft not found', 404);
    const m = { ...parse(d.metrics_json, {}), ...body, updated_at: now() };
    run('UPDATE drafts SET metrics_json = ? WHERE id = ?', JSON.stringify(m), params.id);
    return m;
  });
  route('POST', '/api/performance/import', ({ body }) => {
    // Minimal RFC 4180 parsing: quoted fields may contain commas and doubled quotes.
    const splitRow = (line) => {
      const out = []; let cur = '', q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
        else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
      }
      out.push(cur);
      return out;
    };
    const lines = String(body.csv || '').trim().split(/\r?\n/).filter(Boolean);
    if (!lines.length) throw bad('Paste CSV with a header row');
    const head = splitRow(lines.shift()).map(h => h.trim().toLowerCase());
    let matched = 0; const unmatched = [];
    for (const line of lines) {
      const cells = splitRow(line).map(c => c.trim()); const row = Object.fromEntries(head.map((h, i) => [h, cells[i]]));
      const d = row.draft_id ? get('SELECT id, metrics_json FROM drafts WHERE id = ?', row.draft_id) : get('SELECT id, metrics_json FROM drafts WHERE title = ?', row.title || '');
      if (!d) { unmatched.push(row.title || row.draft_id || `row ${matched + unmatched.length + 1} (no draft_id or title)`); continue; }
      const metrics = Object.fromEntries(Object.entries(row).filter(([k, v]) => !['draft_id', 'title'].includes(k) && v !== '' && !isNaN(Number(v))).map(([k, v]) => [k, Number(v)]));
      run('UPDATE drafts SET metrics_json = ? WHERE id = ?', JSON.stringify({ ...parse(d.metrics_json, {}), ...metrics, updated_at: now() }), d.id);
      matched++;
    }
    return { matched, unmatched };
  });
  route('GET', '/api/performance', () => {
    const METRICS = ['impressions', 'reach', 'reactions', 'comments', 'reposts', 'saves', 'clicks', 'profile_visits', 'meaningful_conversations', 'replies', 'meetings'];
    const rows = all("SELECT d.id, d.title, d.channel, d.format, d.angle, d.metrics_json, d.published_at, s.topics FROM drafts d LEFT JOIN stories s ON s.id = d.story_id WHERE d.status = 'published'")
      .map(r => ({ ...r, metrics: parse(r.metrics_json, {}), topic: parse(r.topics, [])[0] || 'Unassigned' }));
    const group = (key) => {
      const g = {};
      for (const r of rows) {
        const k = r[key] || 'n/a'; g[k] ||= { key: k, posts: 0 };
        g[k].posts++;
        for (const m of METRICS) if (typeof r.metrics[m] === 'number') { g[k][m + '_sum'] = (g[k][m + '_sum'] || 0) + r.metrics[m]; g[k][m + '_n'] = (g[k][m + '_n'] || 0) + 1; }
      }
      return Object.values(g).map(x => ({ key: x.key, posts: x.posts, ...Object.fromEntries(METRICS.map(m => [m, x[m + '_n'] ? Math.round(x[m + '_sum'] / x[m + '_n']) : null])) }));
    };
    return { metrics: METRICS, posts: rows, by_topic: group('topic'), by_format: group('format'), by_angle: group('angle'), by_channel: group('channel') };
  });
}
