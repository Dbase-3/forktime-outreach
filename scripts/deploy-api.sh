#!/bin/bash
# Deploys apps/api (Lisna's backend) to its droplet. It builds here (the 1 GB
# droplet can't compile comfortably), copies the build and the workspace's
# package manifests, installs production packages there, and (re)starts it
# under pm2. The server's .env (production settings) is never touched.
#
#   pnpm deploy:api            (LISNA_HOST overrides the server)
set -euo pipefail
HOST="${LISNA_HOST:-root@204.48.28.201}"
DIR=/opt/lisna
cd "$(dirname "$0")/.."

pnpm --filter @outreach/api build   # builds @outreach/core first (prebuild)

# Every workspace package.json goes, so the lockfile matches; only the API's build and core's.
rsync -az --relative \
  package.json pnpm-workspace.yaml pnpm-lock.yaml \
  apps/web/package.json apps/agent/package.json apps/platform/package.json apps/platform-agent/package.json \
  packages/core/package.json apps/api/package.json \
  "$HOST:$DIR/"
rsync -az --delete packages/core/dist/ "$HOST:$DIR/packages/core/dist/"
rsync -az --delete apps/api/dist/ "$HOST:$DIR/apps/api/dist/"

ssh "$HOST" bash -s <<REMOTE
set -euo pipefail
cd $DIR
CI=true pnpm install --prod --frozen-lockfile --filter "@outreach/api..." >/dev/null
cd apps/api
if pm2 describe lisna-api >/dev/null 2>&1; then
  pm2 reload lisna-api --update-env
else
  pm2 start dist/main.js --name lisna-api --cwd $DIR/apps/api --node-args="--enable-source-maps --max-old-space-size=512" --max-memory-restart 600M
fi
pm2 save >/dev/null
sleep 4
curl -fsS -m 5 http://127.0.0.1:4300/healthz && echo " <- healthy"
REMOTE
