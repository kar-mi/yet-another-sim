#!/usr/bin/env bash
# Pull latest code, rebuild the image, and restart the container.
set -euo pipefail

cd "$(dirname "$0")"

BRANCH="${1:-main}"

echo "==> Pulling latest from origin/$BRANCH"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Rebuilding and restarting container"
rm -rf .bundle
docker compose up -d --build

echo "==> Pruning dangling images"
docker image prune -f

echo "==> Done. Status:"
docker compose ps
