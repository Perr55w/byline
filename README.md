# Byline

A personal workspace for following AI, ML, agentic systems, product management, and business analysis, and turning the strongest developments into source-backed LinkedIn posts, Instagram carousels and Reels, short videos, and mentoring outreach. Every piece needs your approval before it goes anywhere.

Each day it answers four questions: **What changed? Why does it matter to my work? What do I think? Post it, test it, or save it?**

## Quick start

Requirements: **Node.js 22.5+** (it uses the built-in `node:sqlite`). For video export you also need **ffmpeg** on your PATH (`brew install ffmpeg` / `winget install ffmpeg` / `apt install ffmpeg`).

```bash
cd byline
npm install          # installs only the optional Claude SDK
npm start            # http://127.0.0.1:4317
```

Open the app and click **Load demo data** on Today, or run `npm run demo` in a second terminal. The demo loads fictional organizations and people, each labeled **DEMO**, and runs today's workflow so you can try every step without any credentials or network access. You can remove the demo data later under Settings.

To run it every day on your PC and open it from your phone (autostart, a bookmarkable HTTPS link through Tailscale, password + two-step sign-in, daily backups, `npm run go-live`, the ntfy morning digest), see **[docs/DEPLOY.md](docs/DEPLOY.md)**. Your questionnaire answers, and what each one changed, are recorded in **[docs/ALIGNMENT.md](docs/ALIGNMENT.md)**, along with the AI budget estimate.

Run the acceptance tests (they use a throwaway data directory):

```bash
npm test
```

## Stack and why

The repository started empty, so I chose the simplest stack that persists data and needs no build step:

| Layer | Choice | Why |
|---|---|---|
| Server | Node 22 `http` with a ~40-line router | No framework to learn or update |
| Storage | SQLite through built-in `node:sqlite` (`data/byline.db`) | One file, no server, easy to back up |
| Frontend | Vanilla ES modules in `public/` | No bundler. The look is a dark "night newsroom" (Fraunces / Hanken Grotesk / IBM Plex Mono, violet and amber accents) |
| AI | Pluggable provider (`src/ai/`) | **Local** engine works offline. **Claude** (`@anthropic-ai/sdk`, `claude-opus-5-5`) is used automatically when `ANTHROPIC_API_KEY` is set and you're under your monthly budget |
| Media | Server-side SVG; client-side PNG export; ffmpeg for MP4 | Charts only plot comparable, unit-bearing figures taken from source-backed claims |

Every external piece can be swapped out:
- **Source connectors:** `src/connectors/index.js` (each has `status()` and `collect()`)
- **AI providers:** `src/ai/local.js` and `src/ai/claude.js` share one interface
- **Publishers:** `src/publishers/index.js`
- **Scheduler:** `src/scheduler.js`, or call `npm run daily` from cron or Task Scheduler

## The daily workflow

The daily run goes through five stages: `collect → cluster → rank → brief → draft`. Each stage is recorded in **Runs**, and you can retry from the failed stage or rerun from any stage.

- **Idempotent:** articles are unique by URL, there's one brief per date, and the automatic draft uses the key `daily:<date>:linkedin`. Rerunning a date never duplicates stories, drafts, or scheduled posts.
- **Cached:** feed responses are cached for 6 hours, so retries reuse them.
- **Quiet days:** if no story clears your publishing threshold, the brief says so and offers an evergreen draft from a saved topic.
- **Ranking:** each story is scored on interest (your priorities, watchlists, and employers), novelty, evidence quality (independent domains, primary announcements, research), practical impact, and recency, then adjusted by your feedback. Every score comes with its explanation. Engagement from X is shown separately and never counts as evidence.

Schedule the run under Settings (your time zone), or use cron:

```bash
crontab -e
```

Then add this line:

```cron
0 7 * * * cd /path/to/byline && npm run daily
```

## Safety rules built into the code

- **Untrusted content:** retrieved articles are stored as plain text and passed to Claude inside `<untrusted_source>` tags, with a system rule never to follow them. They can't trigger actions or publishing.
- **No invented experiences:** first-person text comes only from your notes (marked "Use in draft") or experiences you've marked public. The editorial checks flag any other first-person claim.
- **Approval hashes:** for posts, the hash covers the text, image, alt text, and tags. For outreach, it covers the recipient, message, and send time. Any change returns the item to review. Publishing and sending require a valid approval, and sends are idempotent.
- **Private stays private:** private notes and job-search details are excluded from exports and flagged if they show up in a public draft. Do-not-contact blocks outreach.
- **Tags:** a tag is anchored to a sentence and shows its reason and source. Removing a tag never rewrites the post.

## Feature status at handoff

**Usable now, no credentials needed**
- RSS/Atom feeds (company blogs, docs and release notes, arXiv)
- Manual URL intake, with a paste-text fallback
- Source directory with sync status and errors
- Watchlists, including questions and employer teams
- Story clustering with "new since you looked"
- Evidence cards
- Ranking with explanations
- Feedback controls and reset
- Daily brief and quiet-day handling
- Today dashboard
- Career lens and angle suggestions
- Short, long, and roundup LinkedIn formats
- Perspective editor
- Per-section locks and rewrites
- Version history and restore
- Editorial and affiliation checks
- Visuals: verified chart, text card, upload, import from URL with attribution, library, editable alt text
- LinkedIn preview, copy, PNG download, source-notes download
- Approval flow with manual "mark as published"
- Editorial calendar with drag-and-drop
- Performance entry and CSV import, compared by topic, format, angle, and channel
- Skill radar using your sources and pasted job descriptions
- Role collections, projects, story-to-project generator, interview talking points, weekly recap
- Employer watchlists and activity history (Cox Enterprises and Cox Automotive tracked separately; Google Cloud, DeepMind, and other Google teams tracked separately)
- Tag suggestions
- Contact research cards and relationship tracker
- Outreach: purpose selector, channel drafts including the 200-character option, claim review, follow-ups, meeting prep, thank-you notes, do-not-contact
- Content-to-connection suggestions
- Instagram carousel, Reel, and Story drafts with legibility preview and slide PNG export
- Video brief, scene script, storyboard, and shot list with locks
- MP4 render (vertical or landscape) with burned-in captions, plus .srt, thumbnail, and caption files
- Media rights log and synthetic-media opt-in
- Campaign workspace
- Searchable archive
- Scheduler, retries, run history, usage tracking, and a monthly budget

**Added from your questionnaire answers**
- Installable app (PWA) for phone and desktop
- Password sign-in, which is required before any proxied or tunneled access is allowed
- Cloudflare Tunnel guide
- Audio briefing using your device's built-in voice
- Email digest preview
- Long analysis as the default daily draft, a new LinkedIn article format, and an automatic Friday weekly roundup
- Investigative drafting voice; with Claude, a humor variant you have to swap in yourself
- Posting slots (Mon, Wed, Fri) with a "next open slot" button
- Private Google Calendar feed (ICS)
- Strict editorial rules: unsupported numbers and fewer than 2 credible sources block approval
- Evidence ranked by source credibility, plus two new source kinds: community and applied
- Down-weighting for funding news and model leaderboards
- Web-page connector, with Anthropic, IBM Research, Snowflake and Google Cloud seeded as sources
- IBM, Toyota, Cox Automotive and Cox Enterprises pinned for extra weight
- Lot Intelligence and Research Bench seeded as projects
- Contact segments and a KSU-alumni flag, with a weekly outreach goal
- Shape-diagram visuals
- In-browser narration recording for videos

**Needs credentials (set them as environment variables; never put them in the UI)**
- `BYLINE_PASSWORD`: required before reaching Byline from your phone or the internet. `BYLINE_PUBLIC_URL` sets the address used in links.
- `RESEND_API_KEY` and `RESEND_FROM`: the email digest (free tier).
- `NTFY_TOPIC`: phone push notifications (free).
- `ANTHROPIC_API_KEY`: Claude-quality drafting. You chose the local engine for now; Settings → AI provider switches it.
- `X_BEARER_TOKEN`: X recent-search sources.
- `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_AUTHOR_URN`: direct text posting to LinkedIn.

**Still pending**
- Uploading images to LinkedIn through the API
- Instagram Graph API publishing and the comment/DM reply queue
- Gmail sending for outreach (needs Google OAuth; today you copy the approved draft and click "mark as sent")
- Metricool scheduling and analytics (needs a paid API plan)
- Canva template export
- Automatic analytics import from LinkedIn and Instagram
- Synthetic narration generation (the opt-in gate exists, but no voice provider is wired up)

## Project layout

```
server.js                 HTTP server + router
src/db.js                 schema, settings, cache
src/pipeline.js           daily stages, clustering, ranking, intake
src/editorial.js          editorial / affiliation checks
src/visual.js             charts and cards (SVG)
src/store.js              shared story/draft records, approval hashing, locks
src/ai/                   local + Claude providers
src/connectors/           RSS/Atom, X, manual intake, article fetcher
src/publishers/           LinkedIn (optional), Instagram/email (manual)
src/routes/               content, drafts/media/video, career/people/campaigns
src/seed.js, src/demo.js  first-run defaults, fictional demo data
public/                   frontend (views in public/js/views)
test/acceptance.test.js   end-to-end acceptance checks
docs/SPEC.md              condensed product spec
```

## Credits

- Fonts: Newsreader, Schibsted Grotesk, Martian Mono (SIL Open Font License), self-hosted in `public/fonts`.
- Voice: Kokoro-82M "Heart" (Apache 2.0) via kokoro-js, run locally.
- Visual effects in `public/js/fx/` are adapted from [React Bits](https://github.com/DavidHDev/react-bits) by David Haz, licensed MIT + Commons Clause (free to use in this app; the effects themselves may not be resold).
