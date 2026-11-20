# Running Byline: one-page runbook

Byline is one Node process and one SQLite file, with no required dependencies. It runs on your PC now and can move to a
Raspberry Pi or home box later by copying one folder. Everything here is $0.

```
 phone (home-screen app) ─┐                      ┌──────────── your PC ─────────────┐
 PC browser (bookmark) ───┼─► https://pc.tailnet.ts.net ─► tailscale serve ─► Byline :3000 ─► data/byline.db
                          │      (Tailscale: only your devices)            daily backup ─► backups/ (keeps 7)
```

There is one database, so there is nothing to sync. Every device sees the same data as soon as it changes.

---

## A. On your PC (now)

### 1. Install (once)
1. Install **Node.js 22 or newer** (<https://nodejs.org>, LTS) and **Git**.
2. Get the code and enter the folder:
   ```
   git clone https://github.com/Perr55w/byline.git
   cd byline
   ```
3. Create your settings file and set a password (a long passphrase **without spaces**):
   ```
   copy .env.example .env        (Windows)      cp .env.example .env      (macOS / Linux)
   ```
   Open `.env`, remove the `#` in front of `BYLINE_PASSWORD=` and type the passphrase after the `=`.
   Every setting Byline reads is listed in `.env.example`, with a one-line explanation.

### 2. Start it at every sign-in
**Windows** (PowerShell in the Byline folder):
```
powershell -ExecutionPolicy Bypass -File deploy\windows\install-autostart.ps1
```
This registers a Task Scheduler task "Byline": it starts at log-on in a hidden window and restarts if it stops. It
prints the local address, the log file (`logs\byline.log`) and the Tailscale command for step 3.
To remove it: `powershell -ExecutionPolicy Bypass -File deploy\windows\uninstall-autostart.ps1` (your data stays).
To run it once by hand instead: double-click `deploy\windows\start-byline.cmd`.

**macOS / Linux desktop:** `./deploy/macos-linux/start.sh` (add it to your login items, or run it with `nohup … &`).

Byline now answers on `http://127.0.0.1:3000` on the PC itself.

### 3. Your bookmarkable HTTPS link (phone and PC) with Tailscale
1. Install Tailscale on the PC and on your phone (<https://tailscale.com/download>, free Personal plan) and sign in to
   the same account on both.
2. On the PC, once:
   ```
   tailscale serve --bg 3000
   ```
   The first time, Tailscale may print a link to turn on **HTTPS certificates** for your tailnet: open it, click
   enable, run the command again. `--bg` keeps serving after reboots; `tailscale serve status` shows it,
   `tailscale serve reset` removes it.
3. Your link is `https://<pc-name>.<your-tailnet>.ts.net` (the PC's name is in the Tailscale app; `tailscale status`
   shows it too). Put it in `.env` so notification links open it, then restart Byline (sign out and in, or rerun the
   install script):
   ```
   BYLINE_PUBLIC_URL=https://<pc-name>.<your-tailnet>.ts.net
   ```
4. **Bookmark it** on the PC. On the phone, open it and install it as an app:
   - iPhone (Safari): Share → **Add to Home Screen**.
   - Android (Chrome): ⋮ menu → **Install app** (or Add to Home screen).
   - PC (Chrome or Edge): the install icon at the right of the address bar.
5. Sign in with your password, then go to **Settings → Security** and turn on **two-step sign-in** (any authenticator
   app). Remote sign-ins then need the 6-digit code.

**Why HTTPS, and not `http://pc-name:3000`:** service workers (the instant-loading app shell) and "install as an app"
only work in a *secure context*: HTTPS, or `localhost` on the same machine. A plain `http://` address over Tailscale is
not one, so the phone would get a slow, non-installable page, and the password would cross the network unencrypted.
`tailscale serve` gives a real certificate and keeps Byline listening only on `127.0.0.1`, so nothing else on your
Wi-Fi can reach it. Leave `HOST` unset; don't use `HOST=0.0.0.0`.

What Byline checks behind `tailscale serve`: requests arrive from the local proxy with `X-Forwarded-For` and
`X-Forwarded-Proto: https`, so they count as remote. Without `BYLINE_PASSWORD` they are refused (403). With it, sign-in
works and the session cookie is marked `Secure`. Changes are accepted only from Byline's own origin (the `ts.net`
address, `BYLINE_PUBLIC_URL`, `BYLINE_ALLOWED_ORIGINS`, or localhost); cross-site requests get 403.

### 4. Turn real data on (once)
```
npm run go-live -- --dry-run      # shows what it would do, changes nothing
npm run go-live                   # does it
```
It backs up first, removes the demo sources and demo stories (demo contacts, experiences and job posts stay until you
replace them), unpauses your real sources, syncs each one and prints an OK / failed table, and turns on the daily
schedule at 07:00 (your time zone in Settings). Run it while Byline is running or not; it is safe to run twice. A
source that fails is left as is with its error shown in **Sources**, where you can fix the URL or pause it.

### 5. Morning digest on your phone (free, optional)
1. Install the **ntfy** app and subscribe to a long, hard-to-guess topic name.
2. Put the same name in `.env` as `NTFY_TOPIC=…`, restart Byline, and turn on **Push** in Settings → Brief delivery
   (go-live does that for you when `NTFY_TOPIC` is set).
3. After each scheduled run, Byline sends one notification ("brief ready" or "quiet day") that opens Today. It is sent
   at most once a day; Settings → Brief delivery can resend it.

Email instead (or as well): a Gmail **app password** (Google account → Security → 2-Step Verification → App passwords)
in `SMTP_USER` / `SMTP_PASS`, then turn on Email in Settings.

### 6. What happens every day
- **07:00** (Settings → Schedule): collect → cluster → rank → brief → draft, then the digest. Nothing is ever posted or
  sent without your approval in Byline.
- **PC off or asleep at 07:00?** Byline checks a few seconds after it starts. If it is past 07:00 and today hasn't run,
  it runs once, right away. A failed run is retried twice, 10 minutes apart, from the stage that failed.
- **Backup:** once a day Byline writes `backups/byline-<date>/` (database + media) and keeps the last 7. For an
  off-machine copy, set `BYLINE_BACKUP_DIR` to a folder inside OneDrive or Google Drive (or let that app sync
  `backups/`). Manual backup any time: `npm run backup`.
- **Restore:** stop Byline, copy `byline.db` and `media/` from a backup folder into `data/`, start Byline.

### 7. Better drafts without paying (optional): Ollama
Settings → **Local AI (Ollama)** shows whether Ollama is installed, the install command (`ollama pull qwen2.5:7b`,
about 5 GB of disk and 8 GB of RAM while it runs) and a **Compare** button that writes one story both ways (templates and
Ollama) side by side without saving anything. If you prefer Ollama's version, pick it under Settings → AI provider. Any
Ollama failure falls back to the templates.

### 8. Check and fix
| Symptom | Look at |
|---|---|
| Is it running? | `http://127.0.0.1:3000/api/health` → `{"ok":true}` |
| It stopped / won't start | `logs\byline.log` (Windows launcher) or the terminal; port in use → change `PORT` in `.env` and in `tailscale serve` |
| Phone says 403 "no password is set" | Set `BYLINE_PASSWORD` in `.env` and restart |
| Phone says "Cross-site request blocked" | Set `BYLINE_PUBLIC_URL` to the exact `https://…ts.net` address |
| No brief this morning | The **Runs** tab (failed stage and error) and **Sources** (per-source errors) |

Updating: `git pull`, then restart Byline (Windows: sign out and in, or `Stop-ScheduledTask Byline; Start-ScheduledTask Byline`). The database upgrades itself on start (versioned migrations) and the daily backup covers you.

---

## B. Later: a Raspberry Pi or home box (always on)
A Pi 5 (4 GB) is a one-time $60–80 and draws about 5 W, so the 07:00 run happens even when the PC is off.
1. Install Raspberry Pi OS Lite (64-bit) or Ubuntu Server, then on the box:
   ```
   git clone https://github.com/Perr55w/byline.git && cd byline
   ./deploy/linux/setup.sh
   ```
   It installs Node 22 and ffmpeg if missing, creates `.env` from `.env.example`, installs the `byline` systemd service
   (`deploy/linux/byline.service`: starts at boot, restarts on failure) and prints the Tailscale command.
2. Install Tailscale on the box (`curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`), then
   `sudo tailscale serve --bg 3000`. Bookmark the new `https://<box>.<tailnet>.ts.net` link.
3. **Move your data:** stop Byline on the PC (uninstall-autostart), copy the PC's `data/` folder and `.env` to the box's
   Byline folder, then `sudo systemctl restart byline`. Nothing else moves.
4. **Updates:** `./deploy/linux/update.sh` (backup, `git pull`, restart, health check). Logs: `journalctl -u byline -f`.

---

## C. Other free options considered
| Option | Why not (for now) |
|---|---|
| Render / Fly.io / Railway free tiers | Free disks are wiped on deploy or the app sleeps, so the SQLite file is lost or the 07:00 run never fires |
| Oracle Cloud Always Free / Google Cloud e2-micro | Free and always on, but your notes and contacts would live on a cloud VM you have to secure and patch |
| Cloudflare Tunnel | Free and gives a public URL (needed only if Google Calendar must fetch the ICS feed), but needs a domain (~$10–12/yr). If you add one later: `cloudflared tunnel` to `http://127.0.0.1:3000`, keep the password + two-step sign-in, put Cloudflare Access in front, and set `BYLINE_PUBLIC_URL` |
| Tailscale Funnel | Makes the app public on the internet; not needed for your own devices |
| Cloudflare Workers + D1 | Free, but needs a port (SQLite → D1, media → R2, scheduler → Cron Triggers, ffmpeg off the server). A v2 project |

PC now, then a Pi, gives the best privacy for $0, so that is the path.
