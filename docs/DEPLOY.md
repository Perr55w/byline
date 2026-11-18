# Running Byline everywhere you are

Your priorities, in order, were **accessibility, speed, flexibility**: one app on desktop and phone that stays fast and doesn't duplicate data. The setup below meets that for $0 and keeps everything in one place.

```
 phone (installed app) ─┐
 laptop browser ────────┼──►  Cloudflare (login + HTTPS)  ──►  tunnel  ──►  Byline on your laptop or home box
 Google Calendar feed ──┘                                                   (one SQLite file = one source of truth)
```

There is only one database, so there's nothing to sync and nothing to conflict. Every device sees the same data the moment it changes.

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

## 8. Later (v2): Cloudflare Workers + D1

A full serverless port would need these changes:
- Swap SQLite for D1.
- Move media to R2.
- Replace the in-process scheduler with Cron Triggers.
- Move video rendering off the server (Workers can't run ffmpeg).

It's worth doing only if the laptop/home-box setup becomes the bottleneck. The current code keeps storage, connectors and the scheduler behind small modules to make that move easier.
