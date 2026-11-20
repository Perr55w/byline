#!/usr/bin/env bash
# Pull the latest Byline, restart the service and check it answers. Your data is not touched (migrations run at start,
# and a backup is taken first).   ./deploy/linux/update.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
sudo_() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }
BYLINE_DATA_DIR="${BYLINE_DATA_DIR:-$ROOT/data}" BYLINE_BACKUP_DIR="${BYLINE_BACKUP_DIR:-$ROOT/backups}" \
  node --disable-warning=ExperimentalWarning scripts/backup.js "${BYLINE_BACKUP_DIR:-$ROOT/backups}"
git pull --ff-only
sudo_ systemctl restart byline
PORT="$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2)"; PORT="${PORT:-3000}"
for _ in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then echo "Byline is up (http://127.0.0.1:$PORT)"; exit 0; fi
  sleep 1
done
echo "Byline did not come back. Look at: journalctl -u byline -n 80" >&2
exit 1
