// Shared record access for stories and drafts (one story/project record shared across all formats).
import { all, get, run, now, hydrate, parse, tx, getSettings } from './db.js';
import { hashString } from './text.js';

export function loadStory(id) {
  const story = hydrate(get('SELECT * FROM stories WHERE id = ?', id));
  if (!story) return null;
  const articles = all(`SELECT a.*, s.name AS source_name, s.grp AS source_group FROM articles a LEFT JOIN sources s ON s.id = a.source_id
    WHERE a.story_id = ? ORDER BY COALESCE(a.published_at, a.fetched_at)`, id).map(hydrate);
  const claims = all('SELECT * FROM claims WHERE story_id = ? ORDER BY has_number DESC, id', id);
  return { story, articles, claims };
}

export const loadEmployers = () => all('SELECT * FROM employers ORDER BY pinned DESC, name').map(hydrate);
export const loadNotes = (draftId, storyId) => all('SELECT * FROM notes WHERE draft_id = ? OR (draft_id IS NULL AND story_id = ?) ORDER BY id', draftId, storyId ?? -1);
export const loadExperiences = () => all('SELECT * FROM experiences ORDER BY id');

export function loadDraft(id) {
  const d = hydrate(get('SELECT * FROM drafts WHERE id = ?', id));
  if (!d) return null;
  d.image = d.image_id ? get('SELECT * FROM images WHERE id = ?', d.image_id) : null;
  d.media = (d.meta?.media_ids || []).map(mid => get('SELECT * FROM images WHERE id = ?', mid)).filter(Boolean);
  d.requires_review = d.status === 'in_review';
  d.current_hash = approvalHash(d);
  d.approval_valid = !!d.approved_hash && d.approved_hash === d.current_hash;
  return d;
}

/** Publicly visible text of a draft: unlocked/locked doesn't matter, private kinds are excluded. */
export function publicText(d) {
  const skip = new Set(['sources', 'checklist']);
  const body = (d.sections || []).filter(s => !skip.has(s.kind) && s.kind !== 'scene' && s.kind !== 'slide').map(s => s.text.trim()).filter(Boolean).join('\n\n');
  const src = (d.sections || []).find(s => s.kind === 'sources');
  return d.channel === 'linkedin' && src ? `${body}\n\nSources:\n${src.text}` : body;
}

export function approvalHash(d) {
  const tags = (d.tags || []).filter(t => t.enabled).map(t => t.name);
  const img = d.image_id ? get('SELECT id, alt FROM images WHERE id = ?', d.image_id) : null;
  const media = (d.meta?.media_ids || []).join(',');
  return hashString(JSON.stringify([(d.sections || []).map(s => [s.text, s.onscreen || '', s.media_id || '']), tags, img?.id, img?.alt, media]));
}

export function snapshot(draftId, note) {
  const d = get('SELECT sections_json FROM drafts WHERE id = ?', draftId);
  const last = get('SELECT sections_json FROM draft_versions WHERE draft_id = ? ORDER BY id DESC LIMIT 1', draftId);
  if (last && last.sections_json === d.sections_json) return;
  run('INSERT INTO draft_versions(draft_id, sections_json, note, created_at) VALUES(?,?,?,?)', draftId, d.sections_json, note, now());
}

/** Save draft changes. Any change to approved content returns the draft to review. */
export function saveDraft(id, patch, note = 'edit') {
  return tx(() => {
    const before = loadDraft(id);
    if (!before) throw Object.assign(new Error('Draft not found'), { status: 404 });
    const merged = { ...before, ...patch };
    if (patch.sections && JSON.stringify(patch.sections) !== JSON.stringify(before.sections)) snapshot(id, `before ${note}`);
    const fields = { sections_json: JSON.stringify(merged.sections), tags_json: JSON.stringify(merged.tags || []), meta_json: JSON.stringify(merged.meta || {}),
      image_id: merged.image_id ?? null, title: merged.title, angle: merged.angle, format: merged.format, planned_date: merged.planned_date ?? null,
      campaign_id: merged.campaign_id ?? null, metrics_json: JSON.stringify(merged.metrics || {}), status: merged.status };
    const newHash = approvalHash(merged);
    if (['approved', 'scheduled'].includes(before.status) && before.approved_hash && newHash !== before.approved_hash) {
      fields.status = 'in_review';
      fields.approved_hash = null;
      fields.approved_at = null;
    }
    const keys = Object.keys(fields);
    run(`UPDATE drafts SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map(k => fields[k]), now(), id);
    return loadDraft(id);
  });
}

export function createDraft({ auto_key = null, story_id = null, project_id = null, campaign_id = null, channel = 'linkedin', format = 'short', angle = 'tradeoff', title, sections, image_id = null, source_ids = [], meta = {} }) {
  const r = run(`INSERT INTO drafts(auto_key, story_id, project_id, campaign_id, channel, format, angle, title, sections_json, image_id, source_ids_json, meta_json, status, created_at, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'draft', ?, ?)`, auto_key, story_id, project_id, campaign_id, channel, format, angle, title,
    JSON.stringify(sections), image_id, JSON.stringify(source_ids), JSON.stringify(meta), now(), now());
  const id = Number(r.lastInsertRowid);
  snapshot(id, 'generated');
  return id;
}

/** Merge regenerated sections into existing ones, keeping locked sections exactly as they were. */
export function mergeLocked(oldSections, fresh) {
  const locked = new Map(oldSections.filter(s => s.locked).map(s => [s.id, s]));
  const merged = fresh.map(s => locked.get(s.id) || s);
  for (const [id, s] of locked) if (!merged.find(m => m.id === id)) merged.push(s);
  return merged;
}

export function storyPreferences() {
  const fb = all('SELECT kind, topics, source_ids FROM feedback');
  const topic = {}, source = {};
  const delta = { useful: 0.12, repetitive: -0.08, low_quality: -0.12, off_topic: -0.15 };
  for (const f of fb) {
    const d = delta[f.kind] || 0;
    for (const t of parse(f.topics, [])) topic[t] = (topic[t] || 0) + d;
    if (f.kind === 'low_quality') for (const s of parse(f.source_ids, [])) source[s] = (source[s] || 0) + d;
  }
  const clamp = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.max(-0.6, Math.min(0.6, v))]));
  return { topic: clamp(topic), source: clamp(source), count: fb.length };
}

export const settings = getSettings;
