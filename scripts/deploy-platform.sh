#!/usr/bin/env bash
# Deploys apps/platform to https://forktime-platform.vercel.app from GitHub `staging`
# (Vercel project forktime-platform, GetFork AI team). Vercel builds from GitHub, so no
# local file (and no env file) is ever uploaded. Uses the Vercel CLI's saved login;
# the token is read locally and never printed. Usage: scripts/deploy-platform.sh [ref]
set -euo pipefail

REF="${1:-staging}"
AUTH="$HOME/Library/Application Support/com.vercel.cli/auth.json"
[ -f "$AUTH" ] || AUTH="$HOME/.local/share/com.vercel.cli/auth.json"
TOKEN=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['token'])" "$AUTH")
API="https://api.vercel.com"
TEAM=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/v2/teams?limit=50" | python3 -c "import json,sys;print([t['id'] for t in json.load(sys.stdin)['teams'] if t['slug']=='get-fork-ai'][0])")

ID=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" "$API/v13/deployments?teamId=$TEAM" \
  -d "{\"name\":\"forktime-platform\",\"project\":\"forktime-platform\",\"target\":\"production\",\"gitSource\":{\"type\":\"github\",\"org\":\"Dbase-3\",\"repo\":\"forktime-outreach\",\"ref\":\"$REF\"}}" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id') or ('ERROR ' + str(d.get('error'))))")
case "$ID" in ERROR*) echo "$ID"; exit 1;; esac
echo "Deploying $REF ($ID)…"

for _ in $(seq 1 60); do
  STATE=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/v13/deployments/$ID?teamId=$TEAM" | python3 -c "import json,sys;print(json.load(sys.stdin).get('readyState'))")
  case "$STATE" in
    READY) echo "Live: https://forktime-platform.vercel.app"; exit 0;;
    ERROR|CANCELED) echo "Build $STATE. Last log lines:"; curl -s -H "Authorization: Bearer $TOKEN" "$API/v3/deployments/$ID/events?teamId=$TEAM&limit=-1" | python3 -c "import json,sys;print('\n'.join((e.get('payload') or {}).get('text','') for e in json.load(sys.stdin))[-3000:])"; exit 1;;
  esac
  sleep 10
done
echo "Still building after 10 minutes: $ID"; exit 1
