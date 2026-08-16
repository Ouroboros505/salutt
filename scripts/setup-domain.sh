#!/usr/bin/env bash
# One-shot: create/deploy the Pages project and attach the custom domain.
#
# Needs CLOUDFLARE_API_TOKEN in the environment, with permission
#   Account -> Cloudflare Pages -> Edit
# and, to attach the domain, also
#   Zone -> DNS -> Edit   (on the montejongas.com zone)
#
# Re-running is safe: deploys are incremental and the domain step is skipped if
# it already exists.
set -euo pipefail

# Credentials live in a gitignored .env.local next to the project, rather than
# in a shell rc file: it is explicit, easy to delete, and does not depend on
# which shell or profile happens to be loaded.
if [[ -f "$(dirname "$0")/../.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$(dirname "$0")/../.env.local"
  set +a
fi

PROJECT="${PAGES_PROJECT:-salutt}"
DOMAIN="${PAGES_DOMAIN:-salutt.montejongas.com}"
API="https://api.cloudflare.com/client/v4"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  cat >&2 <<EOF
CLOUDFLARE_API_TOKEN is not set.

  1. https://dash.cloudflare.com/profile/api-tokens -> Create Token -> Custom
     Permissions: Account | Cloudflare Pages  | Edit
                  Account | Account Settings  | Read
                  Zone    | DNS               | Edit   (zone: montejongas.com)
  2. write it to .env.local in the project root:
         CLOUDFLARE_API_TOKEN=<token>
     (gitignored; this script sources it automatically)
  3. re-run this script

EOF
  exit 1
fi

cf() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' "$@"; }
ok() { python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("success") else 1)'; }

echo "==> resolving account"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(cf "$API/accounts" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if not d.get("success"):
    errs = "; ".join(e.get("message", str(e)) for e in (d.get("errors") or []))
    sys.stderr.write("    token rejected by Cloudflare: " + (errs or "unknown error") + "\n")
    sys.stderr.write("    check the token has Account | Account Settings | Read\n")
    sys.exit(1)
r = d.get("result") or []
if len(r) == 0:
    sys.stderr.write("    token can see no accounts\n"); sys.exit(1)
if len(r) > 1:
    names = ", ".join(a["name"] + "=" + a["id"] for a in r)
    sys.stderr.write("    token sees several accounts; set CLOUDFLARE_ACCOUNT_ID to one of: " + names + "\n")
    sys.exit(1)
print(r[0]["id"])
')}"
echo "    account $ACCOUNT_ID"

echo "==> building and deploying"
CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID" npm run deploy

echo "==> attaching $DOMAIN"
EXISTING=$(cf "$API/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/domains" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(" ".join(x["name"] for x in d.get("result") or []))')

if grep -qw "$DOMAIN" <<<"$EXISTING"; then
  echo "    already attached"
else
  RESP=$(cf -X POST "$API/accounts/$ACCOUNT_ID/pages/projects/$PROJECT/domains" \
    --data "{\"name\":\"$DOMAIN\"}")
  if ok <<<"$RESP"; then
    echo "    attached — certificate provisioning takes a minute or two"
  else
    echo "    could not attach automatically:" >&2
    python3 -c 'import json,sys; print("   ", json.load(sys.stdin).get("errors"))' <<<"$RESP" >&2
    echo "    add it by hand: Pages -> $PROJECT -> Custom domains -> $DOMAIN" >&2
  fi
fi

cat <<EOF

Done.

  https://$DOMAIN

On the phone: open it in Chrome -> menu -> Add to Home Screen.
Install from THIS url and not from a dev address — browser storage is keyed to
origin, so the log follows whichever one you installed from.
EOF
