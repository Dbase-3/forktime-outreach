#!/usr/bin/env bash
# Deploys Lisna's voice agent to LiveKit Cloud as "platform-agent" (the
# ground-labs project, beside the outreach agent: LiveKit only sends it rooms
# the Lisna API asks for by that name).
#
#   pnpm deploy:platform-agent
#
# It builds a staging folder with a copy of @outreach/core (the agent's only
# workspace dependency), takes secrets from apps/platform-agent/.env and the
# signing key from the API server (so they always match), and never prints
# them. The first run creates the agent and records its id in livekit.toml.
set -euo pipefail
PKG=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ROOT=$(cd "$PKG/../.." && pwd)
HOST="${LISNA_HOST:-root@204.48.28.201}"
API_URL="${LISNA_API_URL:-https://api.digicoinx.com}"
command -v lk >/dev/null || { echo "LiveKit CLI (lk) not found: brew install livekit-cli"; exit 1; }

pnpm --filter @outreach/core build >/dev/null
STAGE=$(mktemp -d); SECRETS=$(mktemp)
trap 'rm -rf "$STAGE" "$SECRETS"' EXIT
cp -R "$PKG/src" "$PKG/Dockerfile" "$PKG/livekit.toml" "$STAGE/"
mkdir -p "$STAGE/core" && cp -R "$ROOT/packages/core/dist" "$STAGE/core/dist"
node -e '
  const fs=require("fs"), [, src, out, coreOut]=process.argv;
  const p=JSON.parse(fs.readFileSync(src+"/package.json")); p.dependencies["@outreach/core"]="file:./core"; delete p.devDependencies; delete p.scripts;
  fs.writeFileSync(out+"/package.json", JSON.stringify(p,null,2));
  const c=JSON.parse(fs.readFileSync(src+"/../../packages/core/package.json")); delete c.devDependencies; delete c.scripts;
  c.exports={"./*":{"require":"./dist/*.js","default":"./dist/*.js"}};
  fs.writeFileSync(coreOut+"/package.json", JSON.stringify(c,null,2));
' "$PKG" "$STAGE" "$STAGE/core"

value_of() { grep -E "^$1=" "$PKG/.env" | head -1 | cut -d= -f2- | tr -d '"'; }
# Lisna's production Anthropic key lives in apps/api/.env as ANTHROPIC_API_KEY_PROD
# (so local runs keep spending on the eval key).
PROD_KEY=$(grep -E "^ANTHROPIC_API_KEY_PROD=" "$ROOT/apps/api/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d ' ')
{
  for k in LIVEKIT_URL LIVEKIT_API_KEY LIVEKIT_API_SECRET SONIOX_API_KEY ELEVENLABS_API_KEY; do echo "$k=$(value_of $k)"; done
  if [ -n "$PROD_KEY" ]; then echo "ANTHROPIC_API_KEY=$PROD_KEY"; else echo "ANTHROPIC_API_KEY_EVAL=$(value_of ANTHROPIC_API_KEY_EVAL)"; fi
  echo "PLATFORM_AGENT_NAME=platform-agent"
  echo "PLATFORM_API_URL=$API_URL"
  echo "TURN_DETECTOR=audio"   # as the outreach agent in production
  ssh -o BatchMode=yes "$HOST" "grep -E '^AGENT_RUNTIME_KEY=' /opt/lisna/apps/api/.env | tr -d '\"'"
} > "$SECRETS"
grep -q '^AGENT_RUNTIME_KEY=.\{64\}$' "$SECRETS" || { echo "Couldn't read the signing key from the API server."; exit 1; }

# --secrets-only: replace the running agent's secrets and restart it (no rebuild).
if [ "${1:-}" = "--secrets-only" ]; then
  # lk asks to confirm the overwrite, even non-interactively: answer y.
  cd "$PKG" && expect -c "set timeout 120; spawn lk agent update-secrets --secrets-file $SECRETS --overwrite; expect -re {\[y/N\]|\(y/n\)|\?} { send \"y\r\" }; expect eof" >/dev/null
  exit 0
fi

cd "$STAGE"
if grep -q '^\[agent\]' livekit.toml; then
  lk agent deploy --secrets-file "$SECRETS"
else
  echo "First deploy: creating platform-agent on LiveKit Cloud (us-east)."
  # lk asks to confirm the project even with --silent: answer y to that one question.
  # Afterwards it follows the logs: stop it with Ctrl-C once "Running", then add the id to livekit.toml.
  expect -c "set timeout 900; spawn lk agent create --region us-east --secrets-file $SECRETS --silent; expect -re {\[y/N\]|\(y/n\)|confirm} { send \"y\r\" }; expect eof"
  cp livekit.toml "$PKG/livekit.toml"
fi
