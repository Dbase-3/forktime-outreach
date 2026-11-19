#!/usr/bin/env bash
# Deploys the outreach voice agent to LiveKit Cloud.
#
#   pnpm deploy:agent
#
# Its secrets come from apps/agent/.env.prod (`pnpm setup:prod` writes it).
# The first run creates the agent on LiveKit Cloud and records its id in
# livekit.toml; later runs deploy a new version of it.
set -euo pipefail

PKG_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE="$PKG_DIR/.env.prod"
cd "$PKG_DIR"

command -v lk >/dev/null || { echo "LiveKit CLI (lk) not found: brew install livekit-cli"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "apps/agent/.env.prod not found: run pnpm setup:prod first"; exit 1; }

value_of() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }

WEB_URL=$(value_of OUTREACH_WEB_URL)
if [ -z "$WEB_URL" ] || echo "$WEB_URL" | grep -Eq "localhost|127\.0\.0\.1"; then
  echo "Set OUTREACH_WEB_URL in apps/agent/.env.prod to the deployed app's address (https://...) first."
  echo "The agent posts every call's transcript and result there."
  exit 1
fi
[ -n "$(value_of AGENT_EVENTS_KEY)" ] || { echo "AGENT_EVENTS_KEY is empty in apps/agent/.env.prod"; exit 1; }
if [ "$(value_of OUTREACH_AGENT_NAME)" != "outreach-agent" ]; then
  echo "OUTREACH_AGENT_NAME must be outreach-agent: the app dispatches calls to that name."
  exit 1
fi

# The same region as the Forktime phone agents.
REGION="${OUTREACH_AGENT_REGION:-us-east}"

echo "Deploying the outreach agent. Reports go to: $WEB_URL"
if grep -q '^\[agent\]' livekit.toml 2>/dev/null; then
  lk agent deploy --secrets-file "$ENV_FILE"
else
  echo "First deploy: creating the agent on LiveKit Cloud ($REGION)."
  lk agent create --region "$REGION" --secrets-file "$ENV_FILE" --silent
fi
