#!/usr/bin/env sh
# Cron updater for the major-vis container: refresh the deploy files the repo
# owns (compose.yaml + deploy/Caddyfile), pull the latest GHCR image, and
# recreate the stack only when the image actually changed (so cron noise and
# pointless restarts are avoided — a run with nothing new is just a cheap
# `docker compose pull -q` + a log line, so running it every hour is fine).
# `.env` is never touched — operator settings (client secret, domains) survive
# every update.
#
# Crontab (note cron's minimal PATH — set it or use absolute paths):
#   PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
#   17 * * * * /opt/major-vis/deploy/update.sh >> /var/log/major-vis-update.log 2>&1
#   (hourly at :17; any minute works — pick one that avoids the top of the
#    hour, and re-run `crontab -e` after editing this file)
#
# Overrides: IMAGE_TAG (default "latest"), PUBLIC_PORT (default 8080),
# SERVICES (default "schedule") — same envs compose.yaml honors.
set -eu

cd "$(dirname "$0")/.."

REPO_BASE="${REPO_BASE:-https://raw.githubusercontent.com/skiadas/catalog-vis/main}"

# Files the repo owns. A failed refresh is non-fatal — a network hiccup must
# not block an image update (the current file stays in place).
refresh() {
  tmp="$(mktemp)"
  if curl -fsSLo "$tmp" "$REPO_BASE/$1"; then
    mv -f "$tmp" "$1"
  else
    rm -f "$tmp"
    echo "[$(date)] could not refresh $1 (keeping the current file)" >&2
  fi
}
refresh compose.yaml
refresh deploy/Caddyfile

IMAGE="ghcr.io/skiadas/catalog-vis:${IMAGE_TAG:-latest}"
CONTAINER="major-vis"

docker compose pull -q

new_id="$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || echo '')"
old_id="$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || echo '')"

if [ -n "$new_id" ] && [ "$new_id" != "$old_id" ]; then
  echo "[$(date)] update ($old_id -> $new_id)"
  docker compose up -d
  docker image prune -f >/dev/null 2>&1 || true
else
  echo "[$(date)] no update"
fi