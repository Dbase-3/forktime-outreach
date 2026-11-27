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

# Never touch another product's agent (2026-11-27: Lisna deploys landed on Forktime's
# production agent CA_ujSbWTQYGe4c for four hours, because its id was copied in by
# mistake). Refuse ids that Forktime or outreach use, and any agent carrying
# Forktime-only secrets.
agent_id() { sed -n 's/^ *id *= *"\(CA_[A-Za-z0-9]*\)".*/\1/p' "$1" 2>/dev/null | head -1; }
guard() {
  local id="$1" other
  [ -n "$id" ] || return 0
  for f in "$ROOT/../forktime-core/packages/agent/livekit.toml" "$ROOT/apps/agent/livekit.toml"; do
    other=$(agent_id "$f")
    [ -n "$other" ] && [ "$id" = "$other" ] && { echo "REFUSED: $id is the agent in $f, not Lisna's."; exit 1; }
  done
  [ "$id" = "CA_ujSbWTQYGe4c" ] && { echo "REFUSED: $id is Forktime's production agent."; exit 1; }
  if lk agent secrets --id "$id" 2>/dev/null | grep -qE '(JEV_|TELNYX_|KIOSK_)'; then
    echo "REFUSED: agent $id has Forktime secrets: it isn't Lisna's."; exit 1
  fi
  return 0
}

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

LISNA_ID=$(agent_id "$PKG/livekit.toml")
guard "$LISNA_ID"

# --secrets-only: replace the running agent's secrets and restart it (no rebuild).
if [ "${1:-}" = "--secrets-only" ]; then
  [ -n "$LISNA_ID" ] || { echo "No Lisna agent id in livekit.toml yet."; exit 1; }
  # lk asks to confirm the overwrite, even non-interactively: answer y.
  cd "$PKG" && expect -c "set timeout 120; spawn lk agent update-secrets --id $LISNA_ID --secrets-file $SECRETS --overwrite; expect -re {\[y/N\]|\(y/n\)|\?} { send \"y\r\" }; expect eof" >/dev/null
  exit 0
fi

cd "$STAGE"
if [ -n "$LISNA_ID" ]; then
  # `lk agent deploy` has no --id: it deploys to the id in ./livekit.toml. Make sure the
  # staged copy is the guarded one before anything is sent.
  [ "$(agent_id livekit.toml)" = "$LISNA_ID" ] || { echo "REFUSED: the staged livekit.toml doesn't name $LISNA_ID."; exit 1; }
  echo "Deploying to Lisna's agent ${LISNA_ID}..."
  LOG="${LISNA_DEPLOY_LOG:-/tmp/lisna-agent-deploy.log}"; echo "Progress: $LOG"
  # Answer the project confirmation if it asks; stop following logs once the new worker is ready.
  expect -c "set timeout 900; log_file -noappend $LOG; spawn lk agent deploy --secrets-file $SECRETS; expect { -re {y Yes} { send y; exp_continue } -re {\\[y/N\\]|\\(y/n\\)} { send \"y\\r\" ; exp_continue } -re {ready \\(platform-agent\\)} { send \"\\003\" ; exp_continue } eof }" >/dev/null || true
  grep -E -i "error|fail|deployed|ready \(platform-agent\)" "$LOG" | grep -v -i secret | tail -5
else
  echo "First deploy: creating a NEW Lisna agent on LiveKit Cloud (us-east)."
  BEFORE=$(lk agent list 2>/dev/null | grep -oE 'CA_[A-Za-z0-9]+' | sort -u)
  LOG="${LISNA_CREATE_LOG:-/tmp/lisna-agent-create.log}"; echo "Progress: $LOG"
  # The project confirmation is a selector ("y Yes • n Select another"): answer y. Plain [y/N] prompts too.
  # It follows the new agent's logs after the build: stop once the worker says it's ready.
  expect -c "set timeout 1500; log_file -noappend $LOG; spawn lk agent create --project ground-labs --region us-east --secrets-file $SECRETS --silent; expect { -re {y Yes} { send y; exp_continue } -re {\\[y/N\\]|\\(y/n\\)} { send \"y\\r\" ; exp_continue } -re {ready \\(platform-agent\\)} { send \"\\003\" ; exp_continue } eof }" >/dev/null || true
  NEW_ID=$(agent_id livekit.toml)
  # The id must be one that didn't exist before this run.
  if [ -z "$NEW_ID" ] || echo "$BEFORE" | grep -qx "$NEW_ID"; then echo "No NEW agent id came back (got '${NEW_ID:-none}'): livekit.toml left unchanged."; exit 1; fi
  cp livekit.toml "$PKG/livekit.toml"
  echo "Lisna agent created: $NEW_ID (saved in apps/platform-agent/livekit.toml)"
fi
