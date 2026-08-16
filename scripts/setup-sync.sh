#!/usr/bin/env bash
# Creates the KV namespace the sync endpoint stores encrypted blobs in, and
# writes wrangler.toml so the binding lives in the repo rather than only in a
# dashboard. Safe to re-run: an existing namespace is reused.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$HERE/.env.local" ]] && { set -a; . "$HERE/.env.local"; set +a; }

TITLE="${KV_TITLE:-salutt-sync}"
API="https://api.cloudflare.com/client/v4"

: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN in .env.local}"

cf() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' "$@"; }

ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(cf "$API/accounts" | python3 -c '
import json,sys
r = json.load(sys.stdin).get("result") or []
print(r[0]["id"] if len(r) == 1 else "")
')}"
[[ -n "$ACCOUNT_ID" ]] || { echo "could not resolve account id" >&2; exit 1; }
echo "==> account $ACCOUNT_ID"

echo "==> looking for KV namespace '$TITLE'"
LIST=$(cf "$API/accounts/$ACCOUNT_ID/storage/kv/namespaces?per_page=100")
if ! python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("success") else 1)' <<<"$LIST"; then
  echo >&2
  echo "The API token cannot see Workers KV. Add this permission to it at" >&2
  echo "https://dash.cloudflare.com/profile/api-tokens :" >&2
  echo >&2
  echo "    Account | Workers KV Storage | Edit" >&2
  echo >&2
  echo "Edit the existing salutt-pages-deploy token, add that row, save, and" >&2
  echo "re-run this script. The token value does not change." >&2
  exit 1
fi

NS_ID=$(python3 -c "
import json,sys
d = json.load(sys.stdin)
print(next((n['id'] for n in d.get('result') or [] if n['title'] == '$TITLE'), ''))
" <<<"$LIST")

if [[ -z "$NS_ID" ]]; then
  echo "    creating it"
  NS_ID=$(cf -X POST "$API/accounts/$ACCOUNT_ID/storage/kv/namespaces" --data "{\"title\":\"$TITLE\"}" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print((d.get("result") or {}).get("id",""))')
  [[ -n "$NS_ID" ]] || { echo "could not create the namespace" >&2; exit 1; }
else
  echo "    already exists"
fi
echo "==> namespace $NS_ID"

cat > "$HERE/wrangler.toml" <<EOF
# Cloudflare Pages configuration. Kept in the repo so the KV binding the sync
# endpoint depends on is not invisible dashboard state.
name = "salutt"
compatibility_date = "2025-04-01"
pages_build_output_dir = "dist"

# One encrypted blob per user, addressed by an id derived from their recovery
# code. The server holds no key; see functions/api/sync.ts.
[[kv_namespaces]]
binding = "SALUTT_KV"
id = "$NS_ID"
EOF

echo "==> wrote wrangler.toml"
echo
echo "Now: npm run deploy"
