#!/usr/bin/env sh
# Cron updater for the major-vis container: pull the latest GHCR image, and
# recreate the container only when the image actually changed (so cron noise
# and pointless restarts are avoided on unchanged nights).
#
# Crontab (note cron's minimal PATH — set it or use absolute paths):
#   PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
#   0 3 * * * /opt/major-vis/deploy/update.sh >> /var/log/major-vis-update.log 2>&1
#
# Overrides: IMAGE_TAG (default "latest"), PUBLIC_PORT (default 8080),
# SERVICES (default "schedule") — same envs compose.yaml honors.
set -eu

cd "$(dirname "$0")/.."

IMAGE="ghcr.io/skiados/catalog-vis:${IMAGE_TAG:-latest}"
CONTAINER="major-vis"

docker compose pull -q

new_id="$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || echo '')"
old_id="$(docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || echo '')"

if [ -n "$new_id" ] && [ "$new_id" != "$old_id" ]; then
  echo "[$(date)] update ($old_id -> $new_id); recreating $CONTAINER"
  docker compose up -d "$CONTAINER"
  docker image prune -f >/dev/null 2>&1 || true
else
  echo "[$(date)] no update"
fi