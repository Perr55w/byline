#!/usr/bin/env bash
# Byline launcher for macOS / Linux (a desktop, not a server: for an always-on box use deploy/linux/setup.sh).
# Reads ../../.env, keeps data in ./data, daily backups in ./backups, logs to ./logs/byline.log, restarts on a crash.
#   ./deploy/macos-linux/start.sh            run in the foreground (Ctrl-C to stop)
#   nohup ./deploy/macos-linux/start.sh &    keep it running after closing the terminal
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

export PORT="${PORT:-3000}" HOST="${HOST:-127.0.0.1}"
export BYLINE_DATA_DIR="${BYLINE_DATA_DIR:-$ROOT/data}" BYLINE_BACKUP_DIR="${BYLINE_BACKUP_DIR:-$ROOT/backups}"
# .env: KEY=value lines; comments and empty values are skipped, so the defaults above stay in place
if [ -f "$ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"; val="${line#*=}"
    [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] && [ -n "$val" ] && export "$key=$val"
  done < "$ROOT/.env"
fi

command -v node >/dev/null || { echo "Node.js 22 or newer is required: https://nodejs.org" >&2; exit 1; }
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 22 ] || { echo "Node.js 22 or newer is required (found $(node --version))" >&2; exit 1; }
mkdir -p "$ROOT/logs" "$BYLINE_DATA_DIR"

echo "Byline: http://$HOST:$PORT   (HTTPS link for your phone: tailscale serve --bg $PORT)"
trap 'kill "${child:-0}" 2>/dev/null; exit 0' INT TERM
while true; do
  echo "[$(date -Is)] starting Byline on http://$HOST:$PORT" >> "$ROOT/logs/byline.log"
  node --disable-warning=ExperimentalWarning server.js >> "$ROOT/logs/byline.log" 2>&1 &
  child=$!
  set +e; wait "$child"; code=$?; set -e
  echo "[$(date -Is)] Byline exited with code $code" >> "$ROOT/logs/byline.log"
  [ "$code" -eq 0 ] && break
  sleep 10
done
