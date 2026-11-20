#!/usr/bin/env bash
# One-time setup on a Linux home box / Raspberry Pi (Debian, Ubuntu, Raspberry Pi OS). Run from the Byline folder:
#   ./deploy/linux/setup.sh
# Installs Node.js 22 if it is missing (NodeSource), ffmpeg, a systemd service that starts Byline at boot, and
# prints the Tailscale command for the HTTPS link. Safe to run again.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUN_AS="${SUDO_USER:-$USER}"
cd "$ROOT"
sudo_() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }

need_node=1
if command -v node >/dev/null; then [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] && need_node=0; fi
if [ "$need_node" -eq 1 ]; then
  echo "Installing Node.js 22 (NodeSource)…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo_ bash -
  sudo_ apt-get install -y nodejs
fi
command -v ffmpeg >/dev/null || sudo_ apt-get install -y ffmpeg

[ -f .env ] || { cp .env.example .env; echo "Created .env from .env.example: set BYLINE_PASSWORD in it."; }
mkdir -p data backups
NODE_BIN="$(command -v node)"
sed -e "s#@USER@#$RUN_AS#g" -e "s#@ROOT@#$ROOT#g" -e "s#@NODE@#$NODE_BIN#g" deploy/linux/byline.service | sudo_ tee /etc/systemd/system/byline.service >/dev/null
sudo_ systemctl daemon-reload
sudo_ systemctl enable --now byline
sleep 3
PORT="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2)"; PORT="${PORT:-3000}"
if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null; then echo "Byline is running on http://127.0.0.1:$PORT"; else echo "Byline did not answer yet: journalctl -u byline -n 50" >&2; fi
echo
echo "HTTPS link for your phone and PC (install Tailscale first: curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up):"
echo "    sudo tailscale serve --bg $PORT"
if command -v tailscale >/dev/null; then
  dns="$(tailscale status --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,""))}catch{}})')"
  [ -n "$dns" ] && echo "    then open https://$dns and set BYLINE_PUBLIC_URL=https://$dns in .env"
fi
echo "Updates later: ./deploy/linux/update.sh"
