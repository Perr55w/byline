// Local, deterministic provider. Works offline with no credentials.
// It only rearranges facts found in the collected sources and the user's own notes;
// it never invents experiences, opinions, or accomplishments.
import { sentences, truncate, termHits, termHitsShadowed, tokens, domainOf } from '../text.js';

const pick = (arr, seed = 0) => arr[Math.abs(seed) % arr.length];
const lower1 = (s = '') => s.charAt(0).toLowerCase() + s.slice(1);
const trimDot = (s = '') => s.replace(/[.!?…]+$/, '');

function leadFacts(story, articles, claims) {
  const ordered = [...claims].sort((a, b) => (b.has_number - a.has_number));
  const lead = articles.find(a => a.evidence_kind === 'announcement') || articles[0] || {};
  const facts = ordered.map(c => c.text);
  if (!facts.length && lead.summary) facts.push(...sentences(lead.summary).slice(0, 3));
  return { lead, facts };
}

function topicPhrase(story) {
  const t = story.topics || [];
  return t.length ? t.slice(0, 2).join(' and ').toLowerCase() : 'AI adoption';
}

const ROLE_LENS = {
  'Agent orchestration': { who: 'teams wiring LLM agents into real workflows', decision: 'whether to build orchestration in-house or adopt a framework', test: 'map one manual workflow into agent steps and log where a human still has to intervene' },
  'AI governance': { who: 'risk, compliance and platform owners', decision: 'what review gates and documentation a launch needs', test: 'draft a one-page model risk checklist and apply it to a public AI product' },
  'Evaluation': { who: 'PMs and analysts who have to prove an AI feature works', decision: 'which metrics gate a release and how often they are re-run', test: 'build a 20-case eval set for a narrow task and compare two models on it' },
  'Analytics': { who: 'analytics engineers and BI teams', decision: 'how AI features plug into the existing data stack', test: 'recreate a dashboard question in natural language and score the answers against SQL' },
  'Business adoption': { who: 'operations leaders deciding where AI pays off', decision: 'which process to pilot first and how to measure ROI', test: 'estimate time saved on one recurring task using a before/after log' },
  'Product management': { who: 'product managers shipping AI features', decision: 'scope, pricing, and launch sequencing', test: 'write a one-page PRD for the feature and list the riskiest assumption' },
  'Business analysis': { who: 'business analysts translating needs into requirements', decision: 'which requirements change when an AI step is added to a process', test: 'document a current-state vs. future-state process map with the AI step marked' },
  'Machine learning': { who: 'ML engineers and technical PMs', decision: 'which model and deployment option fit cost and latency targets', test: 'benchmark latency and cost per task for two models on the same prompt set' }
};

/**
 * R2 S13: the employer that published the story's origin post itself, from the origin's domain: every word of the
 * employer's name (parenthetical words dropped) must be a label of the domain; the most specific match wins
 * (cloud.google.com → "Google Cloud", not "Google (other teams)"). Only an announcement-type origin counts.
 */
export function firstPartyEmployer(origin, employers = []) {
  if (!origin || origin.evidence_kind !== 'announcement' || !origin.domain) return null;
  const labels = new Set(String(origin.domain).toLowerCase().replace(/^www\./, '').split('.'));
  let best = null, bestN = 0;
  for (const e of employers) {
    const words = String(e.name || '').replace(/\([^)]*\)/g, ' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.length || !words.every(w => labels.has(w))) continue;
    if (words.length > bestN) { best = e.name; bestN = words.length; }
  }
  return best;
}
export const local = {
  name: 'local',

  async summarize({ story, articles, claims }) {
    const { lead, facts } = leadFacts(story, articles, claims);
    return truncate(facts[0] || lead.summary || story.title, 260);
  },

  async careerLens({ story, settings }) {
    const topics = story.topics?.length ? story.topics : ['Business adoption'];
    const lenses = topics.slice(0, 2).map(t => ({ topic: t, ...(ROLE_LENS[t] || ROLE_LENS['Business adoption']) }));
    const main = lenses[0];
    return {
      who: lenses.map(l => l.who).join('; '),
      decision: `It could change ${main.decision}.`,
      learn: `For AI PM, BA, and analytics roles: understand how ${story.title.replace(/\.$/, '')} affects ${topicPhrase(story)}, and what evidence would show it works outside a demo.`,
      test: lenses.map(l => l.test),
      provider: 'local heuristic'
    };
  },

  async angles({ story }) {
    const tp = topicPhrase(story);
    return [
      { key: 'tradeoff', title: 'The product tradeoff', covers: `What a product team gains and gives up if it adopts this — cost, control, speed, and risk around ${tp}.` },
      { key: 'process', title: 'The business process implication', covers: 'Which step of a real workflow changes, who owns it now, and what needs a new requirement or metric.' },
      { key: 'experiment', title: 'An experiment I could run', covers: 'A small, honest test (inputs, method, success measure) that would check the headline claim yourself.' }
    ];
  },

  async draft({ story, stories = [], articles, claims, format = 'short', angle = 'tradeoff', notes = [], experiences = [], channel = 'linkedin', seed = 0 }) {
    const { lead, facts } = leadFacts(story, articles, claims);
    const srcs = [...new Map(articles.map(a => [a.domain, a])).values()].slice(0, 4);
    const sourcesText = srcs.map(a => `• ${a.title} (${a.domain}) ${a.url}`).join('\n');
    const tp = topicPhrase(story);
    const f1 = trimDot(facts[0] || story.title), f2 = trimDot(facts[1] || ''), f3 = trimDot(facts[2] || '');
    const myNotes = notes.filter(n => n.include);
    const perspective = myNotes.length
      ? myNotes.map(n => n.text.trim()).join('\n\n')
      : '[Your perspective: add a note in “My perspective” and tick “Use in draft”.]';
    const exp = experiences.filter(e => e.public_ok);

    // Investigative arc: open with the question, then the evidence, then what it means and how to test it.
    const ann = claims.find(c => c.evidence_kind === 'announcement');
    const indep = claims.find(c => ['reporting', 'research'].includes(c.evidence_kind) && c.article_id !== ann?.article_id);
    const annDomain = articles.find(a => a.id === ann?.article_id)?.domain;
    const indDomain = articles.find(a => a.id === indep?.article_id)?.domain;
    const evidenceText = ann && indep
      ? `The announcement (${annDomain}) says: “${trimDot(ann.text)}.” Independent coverage (${indDomain}) adds: “${trimDot(indep.text)}.” Where those two disagree is where the real story is.`
      : indep ? `Independent coverage (${indDomain}) reports: “${trimDot(indep.text)}.” I haven't found the primary source yet, so treat specifics with care.`
      : ann ? `So far the main evidence is the announcement itself (${annDomain}): “${trimDot(ann.text)}.” No independent measurement yet.`
      : `The sources describe the change but don't include measurements yet.`;
    const hooks = [
      `${trimDot(story.title)}. Before taking the headline at face value, I wanted to know one thing: what does the evidence actually show?`,
      `Here's a question worth asking about ${trimDot(story.title).replace(/^./, c => c.toLowerCase())}: what changes for the teams who'd actually use it?`,
      `I went through the coverage on ${trimDot(story.title).replace(/^./, c => c.toLowerCase())}. The headline is one thing; the details tell a more useful story.`
    ];
    const angleText = {
      tradeoff: [`The tradeoff: adopting this could speed teams up, but it shifts cost, control, and risk to new places. The evidence so far is ${articles.length > 1 ? 'from more than one source' : 'mostly the announcement itself'}, so treat performance claims as a starting point.`,
        `For a product team, the decision is less "is this impressive?" and more "what do we stop owning if we adopt it, and what new failure modes do we take on?"`],
      process: [`For the business process, the shift is who reviews the output and where that check sits in the workflow. That's a requirements question before it's a tooling question.`,
        `If this lands in a real workflow, someone has to define the hand-off: what the system does, what a person verifies, and which metric shows it's working.`],
      experiment: [`A small way to test this: pick one narrow task, define fifteen to twenty test cases with expected outputs, and compare results before and after. If the improvement doesn't show up there, the headline doesn't matter much yet.`,
        `Before trusting the claim, I'd want a small, repeatable test — fixed inputs, a clear success measure, and a baseline to compare against.`]
    }[angle] || [];
    const closings = [
      `How are you measuring whether changes like this improve business outcomes, not just demos?`,
      `What would you want to see before putting this into a production workflow?`,
      `Curious where others land on this — what evidence would change your mind?`
    ];

    if (channel === 'instagram') return igSections({ story, facts, format, tp, sourcesText, closings, seed });
    if (channel === 'video') return videoSections({ story, facts, tp, seed, format });

    const S = (kind, label, text) => ({ id: kind, kind, label, text, locked: false });
    if (format === 'roundup') {
      const items = [story, ...stories].slice(0, 4);
      return [
        S('hook', 'Hook', `${['', '', 'Two', 'Three', 'Four'][items.length] || 'A few'} developments in ${tp} worth your attention — and the thread connecting them.`),
        ...items.map((s, i) => ({ id: `item_${i + 1}`, kind: 'item', label: `Story ${i + 1}`, text: `${i + 1}. ${trimDot(s.title)}. ${truncate(s.summary || '', 220)}`, locked: false })),
        S('perspective', 'My perspective', perspective),
        S('closing', 'Closing', pick(closings, seed)),
        S('sources', 'Sources', sourcesText)
      ];
    }
    if (format === 'article') {
      const takeaways = [`What changed: ${truncate(f1, 140)}.`, ann && indep ? 'The announced and independently measured results differ — read both.' : 'Independent measurement is still thin.', 'Before adopting: define a baseline, a narrow test set, and one outcome metric.'];
      return [
        S('headline', 'Headline', truncate(trimDot(story.title), 110)),
        S('dek', 'Dek (subtitle)', `What the evidence shows about ${trimDot(story.title).replace(/^./, c => c.toLowerCase())} — and what it means for ${tp}.`),
        S('hook', 'Opening', pick(hooks, seed)),
        S('context', 'What changed', `${f1}.${f2 ? ` ${f2}.` : ''}`),
        S('evidence', 'What the evidence shows', evidenceText),
        S('insight', 'Why it matters', pick(angleText, seed) || `This touches ${tp}, where many teams are still defining what "working" means.`),
        S('test', 'What I would test', `If I were evaluating this, I'd pick one narrow task, write fifteen to twenty test cases with expected outputs, run the current approach as a baseline, and compare on one outcome metric (accuracy, time per task, or cost). If the gain doesn't show up there, the headline doesn't matter yet.`),
        S('takeaways', 'Key takeaways', takeaways.map(t => `• ${t}`).join('\n')),
        S('perspective', 'My perspective', perspective),
        ...(exp.length ? [S('experience', 'From my work (approved for public use)', exp.map(e => e.text).join('\n'))] : []),
        S('closing', 'Closing question', pick(closings, seed)),
        S('sources', 'Sources', sourcesText)
      ];
    }
    const sections = [
      S('hook', 'Hook', pick(hooks, seed)),
      S('context', 'What changed', `What happened: ${f1}.${f2 ? ` ${f2}.` : ''}`)
    ];
    if (format === 'long') sections.push(S('evidence', 'What the evidence shows', evidenceText));
    sections.push(S('insight', 'Why it matters', pick(angleText, seed) || `Why it matters: this touches ${tp}, which is where many teams are still figuring out what "working" means.`));
    if (format === 'long') sections.push(S('implication', 'What I would test', `The practical move for AI product, business analysis, and analytics work: treat this as an input to a decision. Scope a small test, define the metric, then decide.`));
    sections.push(S('perspective', 'My perspective', perspective));
    if (exp.length) sections.push(S('experience', 'From my work (approved for public use)', exp.map(e => e.text).join('\n')));
    sections.push(S('closing', 'Closing', pick(closings, seed)));
    sections.push(S('sources', 'Sources', sourcesText));
    return sections;
  },

  async rewriteSection({ section, story, articles, claims, angle, seed, notes }) {
    const all = await local.draft({ story, articles, claims, format: 'long', angle, notes, seed: seed + 1 });
    const match = all.find(s => s.kind === section.kind);
    if (match && match.text !== section.text) return match.text;
    const { facts } = leadFacts(story, articles, claims);
    return section.kind === 'context' && facts[seed % Math.max(facts.length, 1)]
      ? `What happened: ${trimDot(facts[seed % facts.length])}.` : section.text;
  },

  async employerConnections({ story, articles, claims, employers, origin }) {
    const corpus = [...claims.map(c => ({ text: c.text, article_id: c.article_id })), ...articles.flatMap(a => sentences(`${a.title}. ${a.summary || ''}`).map(t => ({ text: t, article_id: a.id })))];
    // R2 S13: "named" is judged over the whole story (every title, summary and claim, the story's companies and the
    // origin's domain), not just the best-matching passage
    const allText = [story?.title || '', ...articles.map(a => `${a.title || ''}. ${a.summary || ''}`), ...claims.map(c => c.text || '')].join(' \n ');
    let companies = story?.companies || [];
    if (typeof companies === 'string') { try { companies = JSON.parse(companies); } catch { companies = []; } }
    const lc = (x) => String(x || '').toLowerCase();
    const org = origin || articles.find(a => a.evidence_kind === 'announcement') || null;
    const firstParty = firstPartyEmployer(org, employers);
    const out = [];
    for (const e of employers) {
      const terms = [...(e.terms || []), ...(e.topics || [])];
      // R3 S12 (R14): among siblings sharing a parent the longest match wins ("Google" inside "Google Cloud" is Cloud's)
      const shadow = e.parent ? employers.filter(o => o !== e && o.parent === e.parent).flatMap(o => [o.name, ...(o.terms || [])]) : [];
      let best = null, bestHits = [];
      for (const c of corpus) {
        const hits = [...new Map(termHitsShadowed(c.text, terms, shadow).map(h => [h.toLowerCase(), h])).values()]; // "adoption" / "Adoption" once
        if (hits.length > bestHits.length) { best = c; bestHits = hits; }
      }
      const isOrigin = firstParty === e.name;
      if ((!best || !bestHits.length) && !isOrigin) continue;
      const art = (best && articles.find(a => a.id === best.article_id)) || (isOrigin ? org : null) || articles[0];
      const nameHit = isOrigin || termHits(allText, [e.name]).length > 0 || companies.some(c => lc(c) === lc(e.name));
      // R3 S12: a hit on the employer's own name or its parent's ("Google") is a mention, not public work on a topic
      const topical = bestHits.filter(h => lc(h) !== lc(e.name) && lc(h) !== lc(e.parent));
      const where = art ? `${art.domain}` : 'the source';
      out.push({
        employer: e.name, matched: bestHits,
        why: best ? (topical.length ? `${e.name} works publicly on ${topical.slice(0, 3).join(', ')}; ${where} says: “${truncate(best.text, 180)}”` : `${where} names ${bestHits[0]}: “${truncate(best.text, 180)}”`) : `${e.name} published this story itself (${org?.domain || 'its own site'}).`,
        source: art ? { url: art.url, title: art.title, domain: art.domain } : null,
        mention_ok: nameHit,
        first_party: isOrigin,
        mention_note: isOrigin ? `First-party: this is ${e.name}’s own post.` : nameHit ? 'The source names this company directly, so a mention is supported.' : 'Topical overlap only — mention only if you add specific analysis of their public work.'
      });
    }
    return out.sort((a, b) => (b.first_party - a.first_party) || (b.matched.length - a.matched.length));
  },

  async outreach({ contact, purpose, channel, basis, profile, introFormat, seed = 0 }) {
    const detail = basis[0];
    const first = (contact.name || '').split(' ')[0] || 'there';
    const work = detail ? detail.detail : `your work${contact.team ? ` on ${contact.team}` : ''}`;
    const asks = {
      mentorship: `Would you be open to sharing one piece of advice on how you'd build toward a role like yours?`,
      informational: `Would you be open to a 15-minute informational chat sometime in the next few weeks?`,
      peer: `I'd like to stay connected and compare notes as we both work in this space.`,
      event_followup: `I'd love to continue the conversation — would a short follow-up chat work for you?`,
      project_feedback: `Would you be willing to look at a short summary of my project and tell me what you'd question first?`
    };
    const ask = asks[purpose] || asks.informational;
    if (channel === 'linkedin_note' || channel === 'short') {
      const body = truncate(`Hi ${first} — ${introFormat ? introFormat.replace(/\.$/, '') + '.' : ''} Your ${truncate(work, 70)} stood out. ${purpose === 'peer' ? 'Would love to connect.' : 'Would you be open to connecting?'}`, channel === 'short' ? 200 : 300);
      return { subject: '', body, personal_detail: work };
    }
    if (channel === 'instagram_dm') {
      return { subject: '', body: `Hi ${first}! ${introFormat || ''} I came across ${work} and found it really useful. ${ask}`, personal_detail: work };
    }
    const subjects = { mentorship: 'A question about your path', informational: `Quick question about ${contact.team || contact.org || 'your work'}`, peer: 'Connecting on shared interests', event_followup: 'Following up from the event', project_feedback: 'Feedback on a small analytics project?' };
    return {
      subject: subjects[purpose] || 'Quick question',
      body: `Hi ${first},\n\n${introFormat || ''}\n\nI've been following ${work}${detail?.source ? ` (${domainOf(detail.source)})` : ''}, and it connects to what I'm learning about ${profile?.focus || 'AI product management and analytics'}.\n\n${ask}\n\nNo worries at all if the timing doesn't work.\n\nThanks,\nPerry`,
      personal_detail: work
    };
  },

  async meetingPrep({ contact, interactions }) {
    const d = (contact.details || [])[0];
    return [
      d ? `You worked on ${truncate(d.detail, 80)} — what was the hardest tradeoff in that work?` : `What does a typical week look like for ${contact.role || 'your role'}?`,
      `What skills do you see separating strong ${contact.role ? contact.role.toLowerCase() + 's' : 'people in your role'} from average ones?`,
      `If you were starting out today, what's one project you'd build to learn this space?`
    ];
  },

  async thankYou({ contact, notes }) {
    const first = (contact.name || '').split(' ')[0];
    const point = sentences(notes || '')[0] || (notes || '').split('\n')[0] || 'your advice';
    return {
      body: `Hi ${first},\n\nThank you for taking the time to talk today. I especially appreciated ${lower1(trimDot(truncate(point, 160)))}.\n\nI'm going to follow up on what we discussed and will let you know how it goes.\n\nThanks again,\nPerry`,
      next_action: `Act on: ${truncate(point, 100)} — then send a short update in 2–3 weeks.`
    };
  },

  async project({ story, claims, existing = [] }) {
    const t = story.topics?.[0] || 'Business adoption';
    const lens = ROLE_LENS[t] || ROLE_LENS['Business adoption'];
    const claim = claims[0]?.text;
    const ext = existing.find(p => termHits(`${story.title} ${story.summary}`, tokens(p.title || '')).length);
    return {
      title: `Test: ${truncate(story.title, 70)}`,
      kind: 'experiment',
      question: claim ? `Does this hold up outside the launch examples: “${truncate(claim, 140)}”?` : `What practical difference does “${story.title}” make for ${lens.who}?`,
      inputs: 'A narrow, realistic task; fifteen to twenty-five test cases with expected outputs; a baseline (current tool or manual process); a cost/time log.',
      deliverable: 'A one-page write-up and a small dashboard comparing baseline vs. new approach, with methodology and limitations.',
      success: 'A measurable difference (accuracy, time, or cost) on the test set, reported with the sample size and what was not tested.',
      extension: ext ? `Extend ${ext.title}: ${lens.test}.` : `Possible extension to an existing project (e.g., Lot Intelligence or Research Bench): ${lens.test}.`
    };
  },

  async interview({ story, notes, project }) {
    const t = story.topics?.[0] || 'AI adoption';
    return [
      { question: `Tell me about a recent development in ${t.toLowerCase()} and why it matters to a business.`, notes: `Use: ${truncate(story.summary || story.title, 200)}`, label: 'example (public development — not your work)' },
      { question: `How would you decide whether to adopt something like ${truncate(story.title, 60)}?`, notes: 'Frame: problem → evidence → small test → metric → decision. Name what you would measure.', label: 'hypothesis' },
      project && project.status === 'done'
        ? { question: 'Tell me about a project where you tested a claim yourself.', notes: `${project.title}: ${project.findings || ''}`, label: 'work you have done' }
        : { question: 'How would you test the claim behind this announcement?', notes: project ? `Planned experiment: ${project.question}` : 'Describe a test set, baseline, and success measure.', label: 'future experiment (not yet done)' }
    ];
  }
};

function igSections({ story, facts, format, tp, sourcesText, closings, seed }) {
  const S = (id, kind, label, text) => ({ id, kind, label, text, locked: false });
  if (format === 'reel') {
    return [
      S('hook', 'hook', 'Hook (0–3s)', truncate(`${trimDot(story.title)} — here's what it actually changes.`, 90)),
      S('beat_1', 'beat', 'Beat 1', `What happened: ${truncate(trimDot(facts[0] || story.title), 140)}.`),
      S('beat_2', 'beat', 'Beat 2', facts[1] ? `The detail that matters: ${truncate(trimDot(facts[1]), 140)}.` : `Why it matters for ${tp}.`),
      S('beat_3', 'beat', 'Beat 3', 'What I would test before trusting it.'),
      S('caption', 'caption', 'Caption', `${trimDot(story.title)}.\n\n${pick(closings, seed)}\n\nSources in comments.`),
      S('cta', 'cta', 'Call to action', 'Follow for weekly, source-backed AI breakdowns.'),
      S('sources', 'sources', 'Sources', sourcesText)
    ];
  }
  if (format === 'story') {
    return [
      S('frame_1', 'frame', 'Frame 1', truncate(trimDot(story.title), 80)),
      S('frame_2', 'frame', 'Frame 2', truncate(trimDot(facts[0] || ''), 120)),
      S('frame_3', 'frame', 'Frame 3', 'Poll: Would you trust this in production? Yes / Not yet'),
      S('sources', 'sources', 'Sources', sourcesText)
    ];
  }
  const slides = [
    truncate(trimDot(story.title), 70),
    `What changed\n${truncate(trimDot(facts[0] || story.summary || ''), 150)}`,
    facts[1] ? `The detail\n${truncate(trimDot(facts[1]), 150)}` : `Why it matters\nIt touches ${tp}.`,
    `The tradeoff\nSpeed vs. control, cost, and new failure modes.`,
    `How to test it\nNarrow task · a small test set · baseline · one metric.`,
    `Your take?\nSave this and tell me what you'd measure.`
  ];
  return [
    ...slides.map((t, i) => S(`slide_${i + 1}`, 'slide', `Slide ${i + 1}`, t)),
    S('caption', 'caption', 'Caption', `${trimDot(story.title)}.\n\n${pick(closings, seed)}`),
    S('sources', 'sources', 'Sources', sourcesText)
  ];
}

function videoSections({ story, facts, tp, format }) {
  const scene = (i, narration, onscreen, duration, broll) => ({ id: `scene_${i}`, kind: 'scene', label: `Scene ${i}`, text: narration, onscreen, duration, broll, media_id: null, locked: false });
  return [
    scene(1, `${trimDot(story.title)}. Here's what it changes.`, truncate(trimDot(story.title), 60), 4, 'Title card or screen recording of the source page'),
    scene(2, `What happened: ${truncate(trimDot(facts[0] || story.summary || ''), 160)}.`, 'What changed', 6, 'Screenshot of the announcement (with attribution)'),
    scene(3, facts[1] ? `The detail that matters: ${truncate(trimDot(facts[1]), 160)}.` : `Why it matters for ${tp}.`, 'Why it matters', 6, 'Simple chart or diagram'),
    scene(4, 'Before trusting it, I would run a small test: a narrow task, a baseline, and one success measure.', 'How I would test it', 6, 'You on camera or a notebook screen recording'),
    scene(5, 'Sources are in the caption. What would you measure?', 'Your take?', 4, 'End card'),
    { id: 'caption', kind: 'caption', label: 'Caption', text: `${trimDot(story.title)} — a quick breakdown. Sources below.`, locked: false },
    { id: 'checklist', kind: 'checklist', label: 'Recording checklist', text: '• Quiet room, mic 15cm away\n• Screen at 1080p, notifications off\n• Record each scene separately\n• Capture source screenshots with URLs visible\n• Log rights for every clip and track', locked: false }
  ];
}
