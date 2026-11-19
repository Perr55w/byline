# Byline v4 design brief (from the 40-question questionnaire, 2026-11-19)

## Verdict on v3
- Reads as "a well-made template". Look and feel are equally to blame.
- Biggest drags: layout dense like a document; not enough imagery or visual punch; effects feel bolted on.
- Weakest tabs: Today, Feed, Search, Settings.
- Newspaper theme: stagnation is not acceptable. Swap it, or show a much deeper take on it.
- Proof (light) is slightly closer to an A than Night, but both feel lackluster.

## The A-tier bar
- Ranked: every pixel deliberate and precise > feels alive and reacts > feels expensive > fast and effortless > memorable.
- Reference sites: Linear, Apple product pages, Raycast, Vercel.
- Anything missing these caps the grade at B: speed, consistent spacing, one signature visual moment, rich imagery.
- First 5 seconds: "briefed and in control". Airy screens with big type. Polished like the best pro tools. Maybe shown to recruiters.
- Wow moments: a visual map of the day's news, 3D or spatial elements, an ambient generative background.

## Fixed decisions
| Area | Decision | Fallback / note |
|---|---|---|
| Metaphor | Quiet luxury app: materials and spacing do the work | Newspaper retires as the theme |
| Personality | Serious analyst | |
| Theme | Manual Night / Proof switch | Gradual time-of-day shift later, once the switch is right |
| Night | True neutral graphite | |
| Light | Bright, clean white | Also wants to see Apple-style glass (reverses the earlier "no glass") |
| Accent | Electric blue | |
| Employer brands | One house palette, no per-company colors | |
| Headlines | Keep Newsreader serif | |
| Textures | Impartial | |
| Sections | Mixed by importance | |
| Navigation | Collapsible left rail | Better-designed masthead tabs |
| Today | Dashboard tiles | Front page (lead plus sub-stories) |
| Story | Dossier: evidence, sources, scores | Long-form article |
| Studio | Distinct workshop space | |
| Priority | Desktop first, phone solid | |
| Visuals | Abstract generative art per topic, charts and data glyphs, source photos | |

## Motion
- More animation, more cinematic, still high quality.
- Personality ranked: fluid/silky > cinematic > minimal.
- Matters most: page load and headings, tab switches, ambient background.
- Heading entrance: replace with a new signature.
- Background ranked: reactive to cursor/data > subtle ambient > rich generative.
- Sound: none. **Remove the voice briefing** (quality too low).
- Keep, but reworked to fit v4:
  - Heading entrance concept.
  - Score count-up: exponential ease-out that slows as it nears the final value.
  - Loading skeletons.

## Creative angle
- Ideas: a morning edition that assembles itself on open, story importance shown by size and weight, a news weather map of topics.
- Risk: full redesign.
- Process: 3 mockup directions side by side, then the user picks.

## Tensions to resolve in design
1. "Calm, precise pixels" vs "more cinematic motion". The screen stays still at rest, with a few large orchestrated moments (open, tab change, story open), not constant motion.
2. "Airy, big type" vs "dashboard tiles". Use few tiles with a strong size hierarchy (importance as size), not a dense grid.
3. Apple glass was ruled out in round 1 but is now requested for a look. Show it in one direction only.
