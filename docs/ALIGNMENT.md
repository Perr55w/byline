# Alignment decisions (from the 30-question questionnaire, 2026-11-18)

Each answer → what changed in Byline. Items marked **pending** need an account or credential.

## Daily use & delivery
| Answer | Change |
|---|---|
| Morning, evening, and on the phone; access on desktop + mobile; priority order accessibility → speed → flexibility | Installable **PWA** (manifest + service worker caches the app shell); mobile layout hardened; **password login** for any non-localhost access; Cloudflare Tunnel + Access guide in `docs/DEPLOY.md` |
| Runs on laptop, cloud, phone, desktop wrapper; sync across devices; prefers Cloudflare over Supabase | One instance is the single source of truth (laptop or always-on box), reached from every device through **Cloudflare Tunnel**. No data duplication → nothing to sync or conflict. A Workers + D1 port is a v2 option (see DEPLOY.md) |
| 15–30 min/day; success = under 15 min/day | Today shows the time estimate; brief stays capped at 6 stories |
| Brief delivery order: in-app → email → notification → audio | In-app (done) · **formatted email digest** (HTML, via Resend free tier — `RESEND_API_KEY`) · **phone push** via ntfy (free — `NTFY_TOPIC`) · **audio briefing** in the app using the browser's built-in voice (free, offline) |

## Sources & ranking
| Answer | Change |
|---|---|
| Source order: official + papers (credible) → X & newsletters (speculative) → podcasts/YouTube/Reddit (industry climate) → GitHub & jobs (applied practice) | New evidence kinds **community** and **application**; ranking weights evidence by this credibility order; only announcement/research/reporting count toward "independent sources" |
| Anthropic, OpenAI, IBM first; Snowflake, Google, AWS close behind | Seeded: Anthropic News (new **web-page connector** — Anthropic has no RSS), OpenAI News, IBM Research blog, Snowflake blog, Google Cloud AI blog (AWS, DeepMind already present), plus Hacker News (agents/evals query) and GitHub releases (MCP spec, Anthropic SDK) |
| More weight: agent orchestration, AI governance, product management | Weights raised to 2.0 / 2.0 / 1.9; the other topics stay at 1.1–1.4 |
| Less weight: model horse-races, funding/valuation | New **de-emphasize** topics with negative weight (leaderboard, "beats GPT", funding round, valuation…) |
| Post-worthy = checkable numbers, testable, challenges a popular claim, changes a business process | Practical-impact signals extended (contradicts, debunk, workflow, process); "testable" stories get a boost |

## LinkedIn voice & editorial
| Answer | Change |
|---|---|
| 3× per week | Posting slots **Mon / Wed / Fri** (editable); Studio offers "next open slot"; slots appear in the calendar feed |
| Story-driven, investigative, measurable, fair-minded; humor only if you vet it | Writing profile updated; local templates rewritten to an investigative arc (question → evidence → what it means → what I'd test). With Claude enabled, a **humor variant** of the hook is generated as a separate, never-published section you can swap in |
| Long analysis, weekly roundup, LinkedIn newsletter/article first | Daily auto-draft is now **long analysis**; **weekly roundup** auto-drafted on Fridays (idempotent per week); new **article** format (headline, dek, sections, takeaways, sources) |
| Charts, text cards, source screenshots, diagrams; web photos and shape illustrations OK | Added **shape-diagram** visual (process / flow card generated from the story); source-image import keeps attribution/license |
| Block on unsupported numbers; require 2+ independent sources; flag hype but let you keep it | Unsupported numbers and < 2 independent sources now **block approval** (project drafts exempt — they rest on your own work); hype stays advisory. All three are toggles in Settings |

## AI & budget
| Answer | Change |
|---|---|
| Local engine only for now | `ai.provider = local` |
| Calculate minimum MVP and final-product budget | See below |

### Budget estimate
Assumptions per day: brief summaries + career lenses for 6 stories (≈3k input / 400 output tokens each), one long draft (≈6k / 1.5k), three section rewrites (≈4k / 400), plus ~10 outreach drafts per week. ≈ 36k input + 5k output tokens/day ≈ 1.1M input + 0.16M output per month. Prices: Anthropic list prices as of Nov 2026 (Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50 per million tokens) — re-check before enabling.

| Setup | AI cost / month | Notes |
|---|---|---|
| **MVP (now): local engine** | **$0** | Everything works; drafts are template-based |
| Haiku 5.5 for everything | ≈ $0.20 | Big quality jump over templates for summaries; weaker long-form writing |
| Mixed: Haiku for summaries/lenses, Opus 5.5 for drafts & rewrites | ≈ $3–4 | Recommended first paid step |
| Sonnet 5.5 for everything | ≈ $4 | Solid all-round |
| Opus 5.5 for everything | ≈ $8 | Best drafts; the $10 default cap covers it |

Other running costs: hosting $0 on your laptop/home box via Cloudflare Tunnel (or ≈ $4–6/mo for a small VPS if it must run with the laptop off) · Resend email and ntfy push $0 on free tiers · optional domain ≈ $10–12/yr · Metricool's API needs a paid plan (pending) · Canva free tier for templates.
**Minimum to run v1: $0/month. Comfortable final product: ≈ $5–15/month.**

### Post-v1: the $30 Claude wallet (planned, not active)
v1 runs on free resources only: the template engine, or Ollama locally. After v1, the plan is a **$30 wallet over 3 months** with Opus 5.5 for every task, to see how the program really performs and leave room for fixes. Measured more carefully, Opus 5.5 thinks before answering and that thinking is billed as output, so the realistic cost is **≈ $10–11 a month**. That fits the wallet with little margin. The code is in place but switched off. To turn it on, set:
- `settings.wallet = { total_usd: 30, months: 3, start: 'YYYY-MM-DD', daily_cap_usd: 1.5 }`
- `ANTHROPIC_API_KEY` on the server
- AI provider → Auto

Built-in protections: spending is tracked against an even pace but not blocked by it; a $1.50 daily safety cap; a hard stop at $30 or when the period ends; quick tasks like summaries run at low effort; and summaries are cached per set of sources.

## Career & relationships
| Answer | Change |
|---|---|
| Big push: IBM Consulting/watsonx, Toyota, Cox Automotive, Cox Enterprises (existing connections) | Those four pinned with a ranking boost; others stay tracked |
| Roles incl. AI engineering | "AI engineering" added to priorities, skill radar terms (Python, evals, RAG, agents, MLOps), and interview prep |
| Summer 2027 internship, full-time by 2028, or a move in current job | Weekly recap shortlist leans toward projects and employer-relevant posts |
| Extend Lot Intelligence, Research Bench, a new analytics dashboard, a new agent-evaluation project | Seeded as projects (fill in the details); story-to-project suggestions link to them |
| Experiments, teardowns, case studies, short demo videos | Project kinds updated (experiment, teardown, case study, demo video) |
| 2–3 outreach/week via email, Instagram DM, KSU alumni network; target teams, alumni, founders/operators | Contacts get a **segment** (target team / KSU alumni / founder-operator / peer) and a KSU-alumni flag; default channel email; weekly outreach goal of 3 shown in People |

## Instagram & video
| Answer | Change |
|---|---|
| Career/personal brand; story explainers first; your own voice | Video default = story explainer; **record narration in the browser** (per draft) — stored with media rights as your own voice |

## Integrations
| Answer | Status |
|---|---|
| Gmail sending after approval | **Done (free):** Gmail app password over SMTP. It sends the digest and approved outreach emails at their approved time, with no OAuth or Google Cloud project needed |
| Google Calendar | **Done (no OAuth needed):** subscribe Google Calendar to Byline's private **ICS feed** (posting slots, scheduled posts, follow-ups, planned sends) |
| Instagram publishing, Metricool, Canva | **Pending** credentials/paid API; manual export covers them today |
| Cloudflare / Supabase | Free comparison in DEPLOY.md. Recommended for v1: **Tailscale** (phone access, no domain) and **Oracle Cloud Always Free** (always-on), with SQLite kept as the database. `npm run backup` handles backups |
