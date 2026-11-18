import { all, get, run, now, hydrate, parse, getSettings } from '../db.js';
import { loadStory, loadExperiences, createDraft } from '../store.js';
import { getProvider } from '../ai/index.js';
import { draftContext } from './drafts.js';
import { termHits, sentences, truncate, hashString } from '../text.js';
import { generateVisual } from '../visual.js';
import { smtpConfigured } from '../smtp.js';
import { recordSent, sendOutreachNow, outreachHash } from '../outreach.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

const SKILLS = ['SQL', 'Python', 'dbt', 'Snowflake', 'BigQuery', 'Databricks', 'Tableau', 'Power BI', 'Looker', 'Excel', 'A/B testing', 'experimentation', 'statistics',
  'evals', 'evaluation', 'prompt engineering', 'RAG', 'retrieval', 'agents', 'agentic', 'MCP', 'LangGraph', 'orchestration', 'fine-tuning', 'vector database',
  'product discovery', 'roadmap', 'stakeholder management', 'requirements', 'user research', 'PRD', 'OKRs', 'process mapping', 'BPMN', 'process improvement', 'Lean', 'Six Sigma',
  'data governance', 'data quality', 'data modeling', 'semantic layer', 'AI governance', 'risk management', 'compliance', 'AWS', 'Bedrock', 'Vertex AI', 'Azure', 'Kubernetes',
  'APIs', 'MLOps', 'LLMOps', 'PyTorch', 'Jira', 'Agile', 'Scrum', 'forecasting', 'risk analytics', 'credit risk', 'manufacturing analytics', 'cost optimization', 'FinOps'];

function outreachFlags(o, contact) {
  const flags = [];
  const body = `${o.subject || ''} ${o.body || ''}`;
  const sourced = (contact.details || []).map(d => d.detail.toLowerCase()).join(' ');
  if (/\b(mutual (friend|connection)|we both know|introduced (me|by)|our (friend|colleague))\b/i.test(body) && !/connection|introduc|mutual/.test(sourced))
    flags.push({ type: 'shared_connection', message: 'Mentions a shared connection that is not recorded on the contact card.' });
  if (/\b(refer(ral)?|put in a good word|pass (my|along my) resume)\b/i.test(body) && o.purpose !== 'referral')
    flags.push({ type: 'referral', message: 'Reads like a referral request. Keep mentorship and referral asks separate.' });
  if (/\b(I|we)\s+(built|led|shipped|launched|worked on|managed)\b/i.test(body)) {
    const exp = loadExperiences().filter(e => e.public_ok).map(e => e.text.toLowerCase());
    if (!exp.length) flags.push({ type: 'work_claim', message: 'Claims work you have done; add it under Settings → Experiences (marked public) first.' });
  }
  const roleWords = body.match(/\b(as (a|the) [A-Z]?[a-z]+( [A-Z]?[a-z]+){0,3} at [A-Z][\w& ]+)/);
  if (roleWords && contact.role && !roleWords[0].toLowerCase().includes(contact.role.toLowerCase().split(' ')[0]))
    flags.push({ type: 'role', message: `Role wording “${roleWords[0]}” doesn't match the recorded role (${contact.role}).` });
  if (!(o.basis || []).some(b => b.source)) flags.push({ type: 'unsourced', message: 'No sourced public detail informs this message — personalization may be unsupported.' });
  if (o.channel === 'short' && (o.body || '').length > 200) flags.push({ type: 'length', message: `${o.body.length}/200 characters.` });
  if (o.channel === 'linkedin_note' && (o.body || '').length > 300) flags.push({ type: 'length', message: `${o.body.length}/300 characters (LinkedIn note limit).` });
  if (o.channel === 'email' && !o.recipient) flags.push({ type: 'recipient', message: 'No recipient email. Use a published professional address or one the person gave you.' });
  return flags;
}


function loadOutreach(id) {
  const o = hydrate(get('SELECT * FROM outreach WHERE id = ?', id));
  if (!o) throw bad('Outreach not found', 404);
  const contact = hydrate(get('SELECT * FROM contacts WHERE id = ?', o.contact_id));
  o.current_hash = outreachHash(o);
  o.approval_valid = !!o.approved_hash && o.approved_hash === o.current_hash;
  o.flags = outreachFlags(o, contact);
  o.contact = contact;
  return o;
}

function loadContact(id) {
  const c = hydrate(get('SELECT * FROM contacts WHERE id = ?', id));
  if (!c) throw bad('Contact not found', 404);
  c.interactions = all('SELECT * FROM interactions WHERE contact_id = ? ORDER BY date DESC, id DESC', id);
  c.outreach = all('SELECT id, purpose, channel, status, send_at, sent_at, subject FROM outreach WHERE contact_id = ? ORDER BY id DESC', id);
  return c;
}

export function registerCareer(route) {
  // ----- experiences the user supplies (only these may appear as first-person claims) -----
  route('GET', '/api/experiences', () => all('SELECT * FROM experiences ORDER BY id DESC'));
  route('POST', '/api/experiences', ({ body }) => { run('INSERT INTO experiences(text, public_ok, created_at) VALUES(?,?,?)', body.text, body.public_ok ? 1 : 0, now()); return all('SELECT * FROM experiences ORDER BY id DESC'); });
  route('PATCH', '/api/experiences/:id', ({ params, body }) => { if ('text' in body) run('UPDATE experiences SET text = ? WHERE id = ?', body.text, params.id); if ('public_ok' in body) run('UPDATE experiences SET public_ok = ? WHERE id = ?', body.public_ok ? 1 : 0, params.id); return { ok: true }; });
  route('DELETE', '/api/experiences/:id', ({ params }) => { run('DELETE FROM experiences WHERE id = ?', params.id); return { ok: true }; });

  // ----- skill radar -----
  route('GET', '/api/career/radar', () => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const week = Date.now() - 7 * 864e5;
    const arts = all('SELECT id, url, domain, title, summary, content, fetched_at, story_id FROM articles WHERE fetched_at >= ?', since);
    const jobs = all('SELECT * FROM job_posts');
    const extra = all("SELECT name, terms FROM watchlists WHERE kind = 'skill'").flatMap(w => [w.name]);
    const out = [];
    for (const skill of [...new Set([...SKILLS, ...extra])]) {
      const ev = []; let recent = 0, older = 0, jobN = 0;
      for (const a of arts) {
        const text = `${a.title}. ${a.summary || ''} ${(a.content || '').slice(0, 3000)}`;
        if (!termHits(text, [skill]).length) continue;
        Date.parse(a.fetched_at) >= week ? recent++ : older++;
        if (ev.length < 4) ev.push({ kind: 'source', url: a.url, domain: a.domain, story_id: a.story_id, snippet: truncate(sentences(text).find(s => termHits(s, [skill]).length) || a.title, 180) });
      }
      for (const j of jobs) {
        if (!termHits(j.text || '', [skill]).length) continue;
        jobN++;
        if (ev.length < 6) ev.push({ kind: 'job', title: `${j.title} — ${j.employer || ''}`, url: j.url, snippet: truncate(sentences(j.text).find(s => termHits(s, [skill]).length) || '', 180) });
      }
      if (recent + older + jobN === 0) continue;
      out.push({ skill, source_mentions: recent + older, recent, older_rate: Math.round(older / 3.3 * 10) / 10, job_mentions: jobN, trend: recent > older / 3.3 ? 'rising' : recent < older / 3.3 / 2 ? 'cooling' : 'steady', evidence: ev });
    }
    return out.sort((a, b) => (b.job_mentions * 2 + b.source_mentions) - (a.job_mentions * 2 + a.source_mentions));
  });
  route('GET', '/api/jobposts', () => all('SELECT id, title, employer, url, substr(text,1,300) AS excerpt, created_at FROM job_posts ORDER BY id DESC'));
  route('POST', '/api/jobposts', ({ body }) => { if (!body.text) throw bad('Paste the job description text'); run('INSERT INTO job_posts(title, employer, url, text, created_at) VALUES(?,?,?,?,?)', body.title || 'Untitled role', body.employer || '', body.url || '', body.text, now()); return { ok: true }; });
  route('DELETE', '/api/jobposts/:id', ({ params }) => { run('DELETE FROM job_posts WHERE id = ?', params.id); return { ok: true }; });

  // ----- collections -----
  route('GET', '/api/collections', () => {
    const rows = all('SELECT v.*, s.title, s.summary, s.topics FROM saved v JOIN stories s ON s.id = v.story_id ORDER BY v.id DESC').map(hydrate);
    const g = {}; for (const r of rows) (g[r.collection] ||= []).push(r);
    return g;
  });

  // ----- projects (story → portfolio experiment, original analysis) -----
  route('GET', '/api/projects', () => all('SELECT * FROM projects ORDER BY updated_at DESC'));
  route('GET', '/api/projects/:id', ({ params }) => ({ ...get('SELECT * FROM projects WHERE id = ?', params.id), drafts: all('SELECT id, channel, format, status, title FROM drafts WHERE project_id = ?', params.id) }));
  route('POST', '/api/projects', ({ body }) => {
    const r = run('INSERT INTO projects(story_id, title, kind, question, inputs, deliverable, success, extension, status, employer, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      body.story_id || null, body.title || 'Untitled project', body.kind || 'experiment', body.question || '', body.inputs || '', body.deliverable || '', body.success || '', body.extension || '', body.status || 'idea', body.employer || null, now(), now());
    return get('SELECT * FROM projects WHERE id = ?', Number(r.lastInsertRowid));
  });
  route('POST', '/api/stories/:id/project', async ({ params }) => {
    const data = loadStory(params.id);
    const p = await getProvider().project({ ...data, existing: all('SELECT title FROM projects') });
    const r = run('INSERT INTO projects(story_id, title, kind, question, inputs, deliverable, success, extension, status, employer, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      data.story.id, p.title, p.kind || 'experiment', p.question, p.inputs, p.deliverable, p.success, p.extension, 'idea', data.story.companies?.[0] || null, now(), now());
    return get('SELECT * FROM projects WHERE id = ?', Number(r.lastInsertRowid));
  });
  route('PATCH', '/api/projects/:id', ({ params, body }) => {
    for (const k of ['title', 'kind', 'question', 'inputs', 'deliverable', 'success', 'extension', 'status', 'tested', 'findings', 'next_steps', 'employer']) if (k in body) run(`UPDATE projects SET ${k} = ?, updated_at = ? WHERE id = ?`, body[k], now(), params.id);
    return get('SELECT * FROM projects WHERE id = ?', params.id);
  });
  route('DELETE', '/api/projects/:id', ({ params }) => { run('DELETE FROM projects WHERE id = ?', params.id); return { ok: true }; });
  route('POST', '/api/projects/:id/drafts', async ({ params, body }) => {
    const p = get('SELECT * FROM projects WHERE id = ?', params.id);
    if (!p) throw bad('Project not found', 404);
    const ctx = draftContext({ project_id: p.id });
    const channel = body.channel || 'linkedin', format = body.format || ({ instagram: 'carousel', video: 'explainer' }[channel] || 'long');
    const sections = await getProvider().draft({ ...ctx, format, angle: 'experiment', notes: [], experiences: loadExperiences(), profile: getSettings().writing_profile, channel });
    const visual = channel === 'video' ? null : generateVisual(ctx.story, ctx.claims, ctx.articles);
    const id = createDraft({ project_id: p.id, story_id: p.story_id, campaign_id: body.campaign_id || null, channel, format, angle: 'experiment', title: p.title, sections, image_id: visual?.id ?? null,
      meta: channel === 'video' ? { orientation: 'vertical', platform: 'Instagram Reels', audience: '', purpose: 'Project trailer', length: 26 } : {} });
    return { draft_id: id };
  });

  // ----- interview talking points -----
  route('POST', '/api/career/interview', async ({ body }) => {
    const ids = body.story_ids?.length ? body.story_ids : all('SELECT story_id FROM saved WHERE collection = ?', body.collection || 'AI product management').map(r => r.story_id);
    const out = [];
    for (const id of ids.slice(0, 6)) {
      const data = loadStory(id); if (!data) continue;
      const project = get('SELECT * FROM projects WHERE story_id = ? ORDER BY id DESC LIMIT 1', id);
      out.push({ story_id: id, title: data.story.title, items: await getProvider().interview({ ...data, project }) });
    }
    return out;
  });

  // ----- weekly recap -----
  route('GET', '/api/career/weekly', () => {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const stories = all('SELECT * FROM stories WHERE updated_at >= ? ORDER BY score DESC', since).map(hydrate);
    const topicDays = {};
    for (const s of stories) for (const t of s.topics) { const days = new Set(all('SELECT substr(fetched_at,1,10) AS d FROM articles WHERE story_id = ?', s.id).map(r => r.d)); (topicDays[t] ||= new Set()); days.forEach(d => topicDays[t].add(d)); }
    const persisted = Object.entries(topicDays).map(([t, d]) => ({ topic: t, days: d.size, stories: stories.filter(s => s.topics.includes(t)).length })).filter(x => x.days >= 2).sort((a, b) => b.days - a.days);
    const changed = [];
    for (const s of stories) {
      const arts = all('SELECT id, title, domain, url, fetched_at, evidence_kind FROM articles WHERE story_id = ? ORDER BY fetched_at', s.id);
      if (arts.length < 2) continue;
      const first = Date.parse(arts[0].fetched_at);
      const later = arts.filter(a => Date.parse(a.fetched_at) - first > 12 * 36e5);
      if (later.length) changed.push({ story_id: s.id, title: s.title, original: arts[0], follow_ups: later.slice(0, 3), new_claims: all('SELECT text FROM claims WHERE story_id = ? AND article_id IN (' + later.map(() => '?').join(',') + ')', s.id, ...later.map(a => a.id)).map(c => c.text).slice(0, 3) });
    }
    const ideas = all("SELECT id, title, question FROM projects WHERE status = 'idea' ORDER BY updated_at DESC LIMIT 5");
    const shortlist = [
      ...persisted.slice(0, 2).map(p => ({ kind: 'trend', label: `Write about ${p.topic} — it showed up on ${p.days} days this week`, ref: p.topic })),
      ...changed.slice(0, 2).map(c => ({ kind: 'update', label: `Revisit “${truncate(c.title, 60)}” — ${c.follow_ups.length} follow-up report(s)`, ref: c.story_id })),
      ...ideas.slice(0, 2).map(i => ({ kind: 'project', label: `Scope project: ${truncate(i.title, 70)}`, ref: i.id }))
    ];
    return { persisted, changed, ideas, shortlist, story_count: stories.length };
  });

  // ----- contacts & relationships -----
  route('GET', '/api/contacts', ({ query }) => all(`SELECT c.*, (SELECT MAX(date) FROM interactions i WHERE i.contact_id = c.id) AS last_interaction FROM contacts c ${query.employer ? 'WHERE employer = ?' : ''} ORDER BY c.updated_at DESC`, ...(query.employer ? [query.employer] : [])).map(hydrate));
  route('GET', '/api/contacts/:id', ({ params }) => loadContact(params.id));
  route('POST', '/api/contacts', ({ body }) => {
    if (!body.name) throw bad('Name required');
    const r = run(`INSERT INTO contacts(name, role, org, employer, team, email, email_source, linkedin, instagram, why, details_json, next_step, next_date, private_note, stage, segment, ksu_alumni, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, body.name, body.role || '', body.org || '', body.employer || '', body.team || '', body.email || '', body.email_source || '', body.linkedin || '', body.instagram || '', body.why || '',
      JSON.stringify(body.details || []), body.next_step || 'Research public work', body.next_date || null, body.private_note || '', body.stage || 'researching', body.segment || 'target_team', body.ksu_alumni ? 1 : 0, now(), now());
    return loadContact(Number(r.lastInsertRowid));
  });
  route('PATCH', '/api/contacts/:id', ({ params, body }) => {
    if ('ksu_alumni' in body) run('UPDATE contacts SET ksu_alumni = ?, updated_at = ? WHERE id = ?', body.ksu_alumni ? 1 : 0, now(), params.id);
    for (const k of ['name', 'role', 'org', 'employer', 'team', 'email', 'email_source', 'linkedin', 'instagram', 'why', 'next_step', 'next_date', 'private_note', 'stage', 'segment']) if (k in body) run(`UPDATE contacts SET ${k} = ?, updated_at = ? WHERE id = ?`, body[k], now(), params.id);
    if ('details' in body) run('UPDATE contacts SET details_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(body.details), now(), params.id);
    if ('dnc' in body) {
      run('UPDATE contacts SET dnc = ?, updated_at = ? WHERE id = ?', body.dnc ? 1 : 0, now(), params.id);
      if (body.dnc) run("UPDATE outreach SET status = 'cancelled' WHERE contact_id = ? AND status IN ('draft','in_review','approved')", params.id);
    }
    return loadContact(params.id);
  });
  route('DELETE', '/api/contacts/:id', ({ params }) => { run('DELETE FROM contacts WHERE id = ?', params.id); return { ok: true }; });
  route('POST', '/api/contacts/:id/interactions', ({ params, body }) => {
    const kinds = ['introduction', 'message_sent', 'reply', 'coffee_chat', 'call', 'meeting', 'thank_you', 'follow_up', 'event', 'note'];
    if (!kinds.includes(body.kind)) throw bad('Unknown interaction kind');
    run('INSERT INTO interactions(contact_id, kind, date, notes, created_at) VALUES(?,?,?,?,?)', params.id, body.kind, body.date || now().slice(0, 10), body.notes || '', now());
    // A reply pauses follow-up reminders; a meeting moves the stage forward.
    if (body.kind === 'reply') run("UPDATE contacts SET stage = 'replied', next_date = NULL, next_step = 'Respond and propose a time' WHERE id = ?", params.id);
    if (['coffee_chat', 'call', 'meeting'].includes(body.kind)) run("UPDATE contacts SET stage = 'met', next_step = 'Send thank-you', next_date = ? WHERE id = ?", body.date || now().slice(0, 10), params.id);
    return loadContact(params.id);
  });
  route('DELETE', '/api/interactions/:id', ({ params }) => { run('DELETE FROM interactions WHERE id = ?', params.id); return { ok: true }; });
  route('POST', '/api/contacts/:id/prep', async ({ params }) => {
    const c = loadContact(params.id);
    return { questions: await getProvider().meetingPrep({ contact: c, interactions: c.interactions }) };
  });
  route('POST', '/api/contacts/:id/thankyou', async ({ params, body }) => {
    const c = loadContact(params.id);
    const r = await getProvider().thankYou({ contact: c, notes: body.notes || c.interactions[0]?.notes || '' });
    const res = run('INSERT INTO outreach(contact_id, purpose, channel, subject, body, personal_detail, basis_json, status, recipient, idempotency_key, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      c.id, 'thank_you', 'email', 'Thank you', r.body, '', '[]', 'draft', c.email || '', `ty-${c.id}-${Date.now()}`, now(), now());
    run('UPDATE contacts SET next_step = ?, updated_at = ? WHERE id = ?', r.next_action, now(), c.id);
    return { outreach_id: Number(res.lastInsertRowid), next_action: r.next_action };
  });

  route('GET', '/api/followups', () => {
    const due = all("SELECT id, name, employer, next_step, next_date, stage FROM contacts WHERE dnc = 0 AND next_date IS NOT NULL ORDER BY next_date");
    const awaitingReply = all(`SELECT o.id AS outreach_id, o.sent_at, c.id, c.name, c.employer FROM outreach o JOIN contacts c ON c.id = o.contact_id
      WHERE o.status = 'sent' AND c.dnc = 0 AND NOT EXISTS (SELECT 1 FROM interactions i WHERE i.contact_id = c.id AND i.kind = 'reply' AND i.date >= substr(o.sent_at,1,10))`)
      .map(r => ({ ...r, suggested_follow_up: new Date(Date.parse(r.sent_at) + 7 * 864e5).toISOString().slice(0, 10) }));
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)); weekStart.setHours(0, 0, 0, 0);
    const sentThisWeek = get("SELECT COUNT(*) AS n FROM outreach WHERE status = 'sent' AND sent_at >= ?", weekStart.toISOString()).n;
    return { due, awaiting_reply: awaitingReply, week: { sent: sentThisWeek, goal: getSettings().outreach_goal_per_week ?? 3 } };
  });

  // ----- outreach -----
  route('GET', '/api/outreach', ({ query }) => all(`SELECT o.*, c.name, c.employer FROM outreach o JOIN contacts c ON c.id = o.contact_id ${query.status ? 'WHERE o.status = ?' : ''} ORDER BY o.id DESC LIMIT 100`, ...(query.status ? [query.status] : [])).map(hydrate));
  route('GET', '/api/outreach/:id', ({ params }) => loadOutreach(params.id));
  route('POST', '/api/contacts/:id/outreach', async ({ params, body }) => {
    const c = loadContact(params.id);
    if (c.dnc) throw bad(`${c.name} is marked “do not contact”.`);
    const purposes = ['mentorship', 'informational', 'peer', 'event_followup', 'project_feedback'];
    if (!purposes.includes(body.purpose)) throw bad('Choose an outreach purpose');
    const basis = (body.detail_indexes?.length ? body.detail_indexes.map(i => c.details[i]) : c.details.slice(0, 1)).filter(Boolean);
    if (body.story_id) { const st = loadStory(body.story_id); if (st) basis.push({ detail: `the story “${st.story.title}”`, source: st.articles[0]?.url }); }
    const s = getSettings();
    const r = await getProvider().outreach({ contact: c, purpose: body.purpose, channel: body.channel || 'email', basis, profile: s.writing_profile, introFormat: s.intro_format });
    const recipient = (body.channel || 'email') === 'email' ? c.email : (body.channel === 'instagram_dm' ? c.instagram : c.linkedin);
    const res = run(`INSERT INTO outreach(contact_id, purpose, channel, subject, body, personal_detail, basis_json, status, recipient, send_at, campaign_id, story_id, idempotency_key, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, c.id, body.purpose, body.channel || 'email', r.subject, r.body, r.personal_detail, JSON.stringify(basis), 'draft', recipient || '', body.send_at || null, body.campaign_id || null, body.story_id || null, `o-${c.id}-${Date.now()}`, now(), now());
    return loadOutreach(Number(res.lastInsertRowid));
  });
  route('PATCH', '/api/outreach/:id', ({ params, body }) => {
    const before = loadOutreach(params.id);
    if (before.status === 'sent') throw bad('Already sent; create a new message instead.');
    for (const k of ['subject', 'body', 'recipient', 'send_at', 'channel', 'campaign_id']) if (k in body) run(`UPDATE outreach SET ${k} = ?, updated_at = ? WHERE id = ?`, body[k], now(), params.id);
    const after = loadOutreach(params.id);
    // New recipient, edited message, or changed send time → back to review.
    if (before.approved_hash && after.current_hash !== before.approved_hash) run("UPDATE outreach SET status = 'in_review', approved_hash = NULL, approved_at = NULL WHERE id = ?", params.id);
    return loadOutreach(params.id);
  });
  route('POST', '/api/outreach/:id/approve', ({ params, body }) => {
    const o = loadOutreach(params.id);
    if (o.contact.dnc) throw bad('Contact is marked “do not contact”.');
    if (body.hash !== o.current_hash) throw bad('The message, recipient, or send time changed since you reviewed it.', 409);
    if (!o.recipient) throw bad('Add the recipient (email or handle) before approving.');
    if (!o.send_at) throw bad('Choose a send time before approving.');
    run("UPDATE outreach SET status = 'approved', approved_hash = ?, approved_at = ? WHERE id = ?", o.current_hash, now(), o.id);
    return loadOutreach(o.id);
  });
  route('POST', '/api/outreach/:id/sent', ({ params }) => {
    const o = loadOutreach(params.id);
    if (o.status === 'sent') return o; // idempotent: retries never double-log
    if (!o.approval_valid) throw bad('Approve this exact recipient, message, and send time first.', 409);
    if (o.contact.dnc) throw bad('Contact is marked “do not contact”.');
    recordSent(o.id);
    return loadOutreach(o.id);
  });
  // Send an approved email through Gmail/SMTP now, or queue it for its approved send time.
  route('POST', '/api/outreach/:id/send', async ({ params }) => {
    const o = loadOutreach(params.id);
    if (o.status === 'sent') return o;
    if (!o.approval_valid) throw bad('Approve this exact recipient, message, and send time first.', 409);
    if (o.channel !== 'email') throw bad('Only email can be sent from Byline. Copy the text for LinkedIn or Instagram, then mark it sent.');
    if (!smtpConfigured()) throw bad('Email sending is not set up. Set SMTP_USER and SMTP_PASS (a Gmail app password) on the server.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.recipient)) throw bad('The recipient must be an email address.');
    if (o.send_at && Date.parse(o.send_at) > Date.now() + 60e3) {
      run("UPDATE outreach SET status = 'queued', last_error = NULL WHERE id = ? AND status IN ('approved','queued')", o.id);
      return loadOutreach(o.id);
    }
    await sendOutreachNow(o.id);
    return loadOutreach(o.id);
  });
  route('DELETE', '/api/outreach/:id', ({ params }) => { run("DELETE FROM outreach WHERE id = ? AND status != 'sent'", params.id); return { ok: true }; });

  // ----- content-to-connection suggestions (only stories you read and marked useful/saved/tested) -----
  route('GET', '/api/connections/suggestions', () => {
    const engaged = all(`SELECT DISTINCT s.id FROM stories s WHERE s.last_viewed_at IS NOT NULL AND (
      EXISTS (SELECT 1 FROM feedback f WHERE f.story_id = s.id AND f.kind = 'useful') OR EXISTS (SELECT 1 FROM saved v WHERE v.story_id = s.id) OR EXISTS (SELECT 1 FROM projects p WHERE p.story_id = s.id))`).map(r => r.id);
    const contacts = all('SELECT * FROM contacts WHERE dnc = 0').map(hydrate);
    const out = [];
    for (const sid of engaged) {
      const data = loadStory(sid);
      const text = data.articles.map(a => `${a.title} ${a.summary} ${a.author}`).join(' ');
      for (const c of contacts) {
        const byAuthor = data.articles.find(a => a.author && c.name && a.author.toLowerCase().includes(c.name.toLowerCase()));
        const teamHit = c.team && termHits(text, [c.team]).length;
        if (!byAuthor && !teamHit) continue;
        const tested = get('SELECT id, title, status FROM projects WHERE story_id = ?', sid);
        out.push({ contact: { id: c.id, name: c.name, employer: c.employer }, story: { id: sid, title: data.story.title }, source: byAuthor || data.articles[0],
          reason: byAuthor ? `${c.name} authored “${byAuthor.title}”.` : `The story covers ${c.team}, ${c.name}'s team.`,
          options: [
            { kind: 'public_response', text: tested ? `Share what you found in “${tested.title}” as a comment on their post.` : 'Comment with one specific question or observation about the piece.' },
            { kind: 'private_question', text: 'Send a short note asking one question about a tradeoff in the work.' }
          ] });
      }
    }
    return out;
  });

  // ----- campaigns -----
  route('GET', '/api/campaigns', () => all('SELECT * FROM campaigns ORDER BY id DESC').map(c => ({ ...c,
    drafts: all('SELECT id, channel, format, status FROM drafts WHERE campaign_id = ?', c.id), outreach: all('SELECT id, channel, status FROM outreach WHERE campaign_id = ?', c.id) })));
  route('POST', '/api/campaigns', ({ body }) => {
    const r = run('INSERT INTO campaigns(name, story_id, project_id, goal) VALUES(?,?,?,?)', body.name || 'Untitled campaign', body.story_id || null, body.project_id || null, body.goal || '');
    const id = Number(r.lastInsertRowid);
    if (body.draft_ids) for (const d of body.draft_ids) run('UPDATE drafts SET campaign_id = ? WHERE id = ?', id, d);
    return get('SELECT * FROM campaigns WHERE id = ?', id);
  });
  route('PATCH', '/api/campaigns/:id', ({ params, body }) => { for (const k of ['name', 'goal', 'story_id', 'project_id']) if (k in body) run(`UPDATE campaigns SET ${k} = ? WHERE id = ?`, body[k], params.id); return get('SELECT * FROM campaigns WHERE id = ?', params.id); });
  route('GET', '/api/campaigns/:id', ({ params }) => {
    const c = get('SELECT * FROM campaigns WHERE id = ?', params.id);
    if (!c) throw bad('Campaign not found', 404);
    const drafts = all('SELECT id, title, channel, format, status, approved_hash, published_at, metrics_json FROM drafts WHERE campaign_id = ?', c.id).map(hydrate);
    const outreach = all('SELECT o.id, o.channel, o.purpose, o.status, o.sent_at, o.contact_id, c.name FROM outreach o JOIN contacts c ON c.id = o.contact_id WHERE o.campaign_id = ?', c.id).map(o => {
      const later = o.sent_at ? all("SELECT kind FROM interactions WHERE contact_id = ? AND date >= ? AND kind IN ('reply','coffee_chat','call','meeting')", o.contact_id, o.sent_at.slice(0, 10)).map(i => i.kind) : [];
      return { ...o, outcomes: [...new Set(later)] };
    });
    const story = c.story_id ? loadStory(c.story_id) : null;
    return { ...c, drafts, outreach, sources: story ? story.articles.map(a => ({ title: a.title, url: a.url, kind: a.evidence_kind })) : [],
      project: c.project_id ? get('SELECT * FROM projects WHERE id = ?', c.project_id) : null,
      outcomes: { replies: outreach.filter(o => o.outcomes.includes('reply')).length, meetings: outreach.filter(o => o.outcomes.some(k => k !== 'reply')).length,
        portfolio_visits: drafts.reduce((m, d) => m + (d.metrics?.profile_visits || 0), 0) || null } };
  });
  route('DELETE', '/api/campaigns/:id', ({ params }) => { run('UPDATE drafts SET campaign_id = NULL WHERE campaign_id = ?', params.id); run('DELETE FROM campaigns WHERE id = ?', params.id); return { ok: true }; });
}
