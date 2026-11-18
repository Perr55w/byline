# Running Byline everywhere you are

Your priorities, in order, were **accessibility, speed, flexibility**: one app on desktop and phone that stays fast and doesn't duplicate data. The setup below meets that for $0 and keeps everything in one place.

```
 phone (installed app) ─┐
 laptop browser ────────┼──►  Cloudflare (login + HTTPS)  ──►  tunnel  ──►  Byline on your laptop or home box
 Google Calendar feed ──┘                                                   (one SQLite file = one source of truth)
```

There is only one database, so there's nothing to sync and nothing to conflict. Every device sees the same data the moment it changes.

## Free options, compared

| Need | Recommended (free) | Free alternatives | Notes |
|---|---|---|---|
| Reach Byline from your phone | **Tailscale** (free Personal plan, up to 100 devices) | Cloudflare Tunnel (free, needs a domain ≈ $10–12/yr) · ZeroTier (free tier) | Tailscale is private (only your devices), needs no domain, and takes about 5 minutes to set up. Cloudflare Tunnel is the choice for a public URL that Google Calendar can fetch |
| Always-on server (laptop can sleep) | **Oracle Cloud Always Free** ARM VM (up to 4 cores / 24 GB RAM, free indefinitely) | A spare laptop or Raspberry Pi in your home lab (only the electricity) · Google Cloud e2-micro (free tier, small) | Runs Byline and ffmpeg fine; put it on your tailnet or behind the tunnel |
| Database | **SQLite file (what Byline already uses)** | Turso (libSQL, SQLite-compatible, free tier) · Supabase free tier (Postgres, pauses after a week idle) · Cloudflare D1 (free tier, needs a Workers port) | With one server reached from every device, a hosted database adds nothing yet. Turso is the closest drop-in if you ever need one |
| Backups | **`npm run backup`** → copy the folder to Google Drive or OneDrive | Cloudflare R2 (10 GB free) · Backblaze B2 (10 GB free) | Backups use `VACUUM INTO`, which takes a consistent snapshot even while Byline is running |
| Email | **Gmail + app password (SMTP)** | Resend (3,000/month free) · Brevo (300/day free) | Gmail covers both the digest and approved outreach, from your own address |
| Push notifications | **ntfy** (free app) | Pushover (one-time $5) · Telegram bot (free) | |
| Better drafting without paying | **Ollama** (local LLM) | LM Studio (free) | Runs on your laptop or home-lab box; see section 9 |
| CI / tests | **GitHub Actions** (2,000 free min/month on private repos) | | Included: `.github/workflows/test.yml` |

### Tailscale in 5 minutes (recommended for v1)
1. Install Tailscale on the computer running Byline and on your phone, and sign in with the same account on both.
2. On the computer, start Byline so it listens on the tailnet, and set a password (a good habit, even on a private network):

```bash
BYLINE_PASSWORD='your passphrase' HOST=0.0.0.0 npm start
```

3. On your phone, open `http://<computer-name>:4317`, where `<computer-name>` is shown in the Tailscale app, then add it to your home screen.
4. Optional: `tailscale serve 4317` gives you an HTTPS address. The service worker (offline app shell) needs HTTPS on any address other than localhost.

## 1. Run locally (no setup)

```bash
npm install
```

```bash
npm start
```

Open http://127.0.0.1:4317. With no password set, Byline refuses any request that arrives through a proxy or tunnel. That way it can't be exposed by accident.

## 2. Turn on the password

```bash
export BYLINE_PASSWORD='a long passphrase you do not use elsewhere'
```

```bash
npm start
```

Sessions last 30 days. Login attempts are rate-limited to 10 per 15 minutes.

## 3. Reach it from your phone with Cloudflare Tunnel (free)

1. Add a domain to Cloudflare (about $10–12 a year if you buy it there), or use one you already have.
2. Install `cloudflared` on the computer that runs Byline: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>
3. Create the tunnel:

```bash
cloudflared tunnel login
```

```bash
cloudflared tunnel create byline
```

```bash
cloudflared tunnel route dns byline byline.yourdomain.com
```

4. Create `~/.cloudflared/config.yml`:

```yaml
tunnel: byline
credentials-file: /Users/you/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: byline.yourdomain.com
    service: http://127.0.0.1:4317
  - service: http_status:404
```

5. Run it:

```bash
cloudflared tunnel run byline
```

To start it on every boot instead, run this once:

```bash
cloudflared service install
```

6. Optional but recommended: add **Cloudflare Access** (Zero Trust → Access → Applications → Self-hosted) for `byline.yourdomain.com`, with a one-time PIN sent to your email. That puts a second login in front of Byline's own password. It's free for up to 50 users.
7. Tell Byline its public address, so links in emails and notifications open the right place:

```bash
export BYLINE_PUBLIC_URL='https://byline.yourdomain.com'
```

## 4. Install it as an app

- **iPhone (Safari):** Share → Add to Home Screen.
- **Android (Chrome):** menu → Install app.
- **Desktop (Chrome or Edge):** the install icon in the address bar.

The installed app opens straight to Today and launches instantly, because the interface is cached. Your data always loads fresh.

## 5. Brief delivery (all free tiers)

| Channel | Setup |
|---|---|
| In-app | Nothing to set up |
| Email digest | Create a free Resend account (3,000 emails/month) and verify your domain. Set `RESEND_API_KEY` and `RESEND_FROM='Byline <brief@yourdomain.com>'`, then turn on email under Settings → Brief delivery |
| Phone push | Install the free **ntfy** app and subscribe to a hard-to-guess topic name. Set `NTFY_TOPIC` to that same name, then turn on push in Settings |
| Audio | On Today, tap **Listen to the brief**. It uses your device's built-in voice, so it's free and works offline |

## 6. Google Calendar

Settings → Calendar feed & access → copy the link. In Google Calendar, go to Other calendars → **From URL** and paste it. Google needs to reach the link over the internet, so this works once step 3 is done. Treat the link like a password.

## 7. Daily schedule while the laptop sleeps

The built-in scheduler only runs while Byline is running. If the laptop is asleep at your scheduled time, the run happens when it wakes, and retries from the failed stage if needed. For runs that happen no matter what, use an always-on machine: a Raspberry Pi or mini PC in your home lab (about $0 to run), or a small VPS (about $4–6/month) with the same tunnel setup.

## 8. Gmail sending (free)
1. Turn on 2-Step Verification on your Google account.
2. Create an **app password** at https://myaccount.google.com/apppasswords. It's 16 characters.
3. Set the following, then restart Byline:

```bash
export SMTP_USER='you@gmail.com'
export SMTP_PASS='abcd efgh ijkl mnop'
```

Byline can now:
- send the daily digest, if you switch it on under Settings → Brief delivery;
- send outreach emails you've approved, at their approved send time. A queued send is cancelled automatically if you edit the message, the recipient, or the time.

Gmail allows about 500 messages a day, which is far more than you'll need.

## 9. Free local AI with Ollama
1. Install Ollama from https://ollama.com.
2. Pull a model. `qwen2.5:7b` is about 4.7 GB and runs on 16 GB of RAM; `llama3.1:8b` is similar:

```bash
ollama pull qwen2.5:7b
```

3. In Settings → AI provider, choose **Ollama local LLM** and Save. The rail shows "Ollama (model)" when it's active.

If Ollama isn't running, each call falls back to the template engine, so nothing breaks. If Ollama runs on another machine (your home lab), set `OLLAMA_HOST=http://that-machine:11434`.

## 10. Later (v2): Cloudflare Workers + D1

A full serverless port would need these changes:
- Swap SQLite for D1.
- Move media to R2.
- Replace the in-process scheduler with Cron Triggers.
- Move video rendering off the server (Workers can't run ffmpeg).

It's worth doing only if the laptop/home-box setup becomes the bottleneck. The current code keeps storage, connectors and the scheduler behind small modules to make that move easier.
