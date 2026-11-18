// Editorial and affiliation checks. Each flag points to a section + sentence and to the evidence.
import { sentences, tokens, hasNumber, jaccard, truncate } from './text.js';
import { getSettings } from './db.js';

const CREDIBLE = new Set(['announcement', 'research', 'reporting']);

const HYPE = /\b(revolutionary|game[- ]chang\w*|unprecedented|groundbreaking|disrupt\w*|kill(s|er|ed)?|destroy\w*|always|never|everyone|nobody|guarantee\w*|proves?|definitively|will replace|the end of|massive|insane)\b/i;
const FIRST_PERSON_CLAIM = /\b(I|we)\s+(built|tested|launched|shipped|led|ran|deployed|measured|found|implemented|managed|worked on|use|used)\b|\b(my|our)\s+(team|company|employer|client|manager)\b|\bat my (job|company|work)\b/i;
const INSIDER = /\b(insider|internally|internal(ly)? (docs?|sources?|roadmap)|sources (tell|told) me|I heard that|off the record|confidential|under NDA|not yet public|leak(ed)?)\b/i;
const MOTIVE = /\b(because they want(ed)? to|clearly (trying|wants?)|desperate(ly)?|just a (cash|money) grab|obviously (trying|wants?)|their real goal)\b/i;
const JOB_SEARCH = /\b(job search|job hunt|applying (to|for)|my application|recruiter|hiring manager|interview(ing)? (at|with)|offer letter|referral)\b/i;
const PLACEHOLDER = /\[[^\]]{3,}\]/;

const PUBLIC_KINDS = new Set(['headline', 'dek', 'evidence', 'test', 'takeaways', 'hook', 'context', 'insight', 'detail', 'implication', 'perspective', 'experience', 'closing', 'item', 'slide', 'caption', 'cta', 'beat', 'frame', 'scene']);

export function checkDraft({ draft, story, articles = [], claims = [], notes = [], experiences = [], employers = [] }) {
  const flags = [];
  const rules = { block_unsupported_numbers: true, min_independent_sources: 2, block_hype: false, ...(getSettings().editorial || {}) };
  const evidence = [
    ...claims.map(c => ({ text: c.text, toks: tokens(c.text), ref: refFor(articles.find(a => a.id === c.article_id), c.evidence_kind) })),
    ...articles.flatMap(a => sentences(`${a.title}. ${a.summary || ''} ${(a.content || '').slice(0, 4000)}`).map(t => ({ text: t, toks: tokens(t), ref: refFor(a) })))
  ];
  const publicNotes = notes.filter(n => n.include).map(n => n.text.toLowerCase());
  const privateNotes = notes.filter(n => !n.include && n.text.length > 25);
  const approvedExp = experiences.filter(e => e.public_ok).map(e => e.text.toLowerCase());
  const companyNames = employers.flatMap(e => [e.name, ...(e.name.includes(' ') ? [] : [])]);

  for (const s of draft.sections || []) {
    if (!PUBLIC_KINDS.has(s.kind)) continue;
    const text = [s.text, s.onscreen].filter(Boolean).join(' ');
    const fromUser = s.kind === 'perspective' || s.kind === 'experience';
    if (PLACEHOLDER.test(text)) flags.push(flag(s, text.match(PLACEHOLDER)[0], 'placeholder', 'Unresolved placeholder — replace it or remove the section before approval.', [], '', true));
    for (const sent of sentences(text).concat(text.length < 120 && !sentences(text).length ? [text] : [])) {
      const st = tokens(sent);
      let best = null, bestScore = 0;
      for (const e of evidence) { const sc = jaccard(st, e.toks); if (sc > bestScore) { bestScore = sc; best = e; } }
      const strong = !/\?\s*$/.test(sent) && (hasNumber(sent) || /\b(announced|launched|released|reported|found that|shows that|showed|cut|reduced|increased|outperform\w*|beats?)\b/i.test(sent));
      if (!fromUser && strong && bestScore < 0.18) {
        flags.push(flag(s, sent, 'unsupported', 'Factual-sounding claim with no close match in the sources.', best ? [best.ref] : [], 'Add a source, soften to a question, or remove the number.', rules.block_unsupported_numbers && hasNumber(sent)));
      } else if (!fromUser && hasNumber(sent) && best) {
        const nums = sent.match(/\d[\d,\.]*/g) || [];
        const missing = nums.filter(n => !best.text.includes(n.replace(/\.$/, '')) && !evidence.some(e => e.text.includes(n.replace(/\.$/, ''))));
        if (missing.length) flags.push(flag(s, sent, 'unsupported', `Number(s) ${missing.join(', ')} not found in any source.`, [best.ref], 'Check the figure against the source.', rules.block_unsupported_numbers));
      }
      if (HYPE.test(sent)) flags.push(flag(s, sent, 'exaggeration', `“${sent.match(HYPE)[0]}” goes beyond what the evidence shows.`, best ? [best.ref] : [], softenSuggestion(sent), rules.block_hype));
      if (MOTIVE.test(sent)) flags.push(flag(s, sent, 'motive', 'Assumes a company’s motive. Keep the criticism, drop the mind-reading.', best ? [best.ref] : [], sent.replace(MOTIVE, 'which suggests they may aim to')));
      if (FIRST_PERSON_CLAIM.test(sent)) {
        const low = sent.toLowerCase();
        const supported = [...publicNotes, ...approvedExp].some(n => jaccard(tokens(n), tokens(low)) > 0.3 || n.includes(low.slice(0, 40)));
        if (!supported) flags.push(flag(s, sent, 'first_person', 'First-person experience that is not in your notes or approved experiences.', [], 'Rephrase as a hypothesis (“I would test…”) or add the experience in Settings → Experiences and mark it public.'));
      }
      if (INSIDER.test(sent)) flags.push(flag(s, sent, 'affiliation', 'Wording could imply insider knowledge.', [], 'Cite the public source instead.'));
      for (const c of companyNames) {
        const re = new RegExp(`\\b(at|with|from|for) ${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*\\b(we|our|us)\\b|\\b(we|our) (team )?at ${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (re.test(sent)) flags.push(flag(s, sent, 'affiliation', `Could read as a current affiliation with ${c}.`, [], `Rephrase in third person (“${c}’s public docs show…”).`));
      }
      if (JOB_SEARCH.test(sent)) flags.push(flag(s, sent, 'sensitive', 'Job-search detail in a public draft.', [], 'Remove — public posts should stand on their own.'));
    }
    for (const n of privateNotes) {
      const chunk = n.text.slice(0, 40).toLowerCase();
      if (text.toLowerCase().includes(chunk)) flags.push(flag(s, truncate(n.text, 80), 'private', 'Text from a private note (not marked “Use in draft”) appears in the draft.', [], 'Remove it or tick “Use in draft” on that note.', true));
    }
  }

  const newest = articles.map(a => Date.parse(a.published_at || a.fetched_at)).filter(Boolean).sort((a, b) => b - a)[0];
  if (newest && Date.now() - newest > 14 * 864e5) flags.push({ section_id: null, sentence: '', type: 'stale', message: `Newest source is ${Math.round((Date.now() - newest) / 864e5)} days old — check for updates.`, evidence: [], suggestion: '' });

  for (const t of draft.tags || []) {
    if (!t.enabled) continue;
    const sec = (draft.sections || []).find(s => s.id === t.section_id);
    if (!sec || !sec.text.includes(t.sentence || '\u0000')) flags.push({ section_id: t.section_id, sentence: t.sentence || '', type: 'tag', message: `Tag @${t.name} no longer points to a sentence in the draft.`, evidence: t.source ? [t.source] : [], suggestion: 'Remove the tag or re-anchor it.' });
  }
  // Independent-source rule (project drafts rest on your own work and are exempt).
  const external = articles.filter(a => a.evidence_kind !== 'own_work');
  if (external.length) {
    const credible = new Set(external.filter(a => CREDIBLE.has(a.evidence_kind)).map(a => a.domain));
    if (credible.size < rules.min_independent_sources)
      flags.push({ section_id: null, sentence: '', type: 'thin_evidence', blocking: true,
        message: `${credible.size} credible independent source${credible.size === 1 ? '' : 's'} (announcement, research, or reporting); your rule requires ${rules.min_independent_sources}. Commentary, community, and applied sources don't count.`,
        evidence: external.slice(0, 3).map(a => refFor(a)), suggestion: 'Submit an independent report or the original announcement via Feed → Add story, or change the rule in Settings.' });
  }

  return flags;
}

export const blockingFlags = (flags) => flags.filter(f => f.blocking);

function refFor(a, kind) { return a ? { url: a.url, title: a.title, domain: a.domain, kind: kind || a.evidence_kind } : null; }
function flag(s, sentence, type, message, evidence, suggestion, blocking = false) {
  return { section_id: s.id, sentence, type, message, evidence: evidence.filter(Boolean), suggestion, blocking };
}
function softenSuggestion(sent) {
  return sent.replace(HYPE, (w) => ({ always: 'often', never: 'rarely', everyone: 'many teams', nobody: 'few teams', proves: 'suggests', prove: 'suggest', 'will replace': 'may change' }[w.toLowerCase()] || 'notable'));
}
