#!/usr/bin/env bash
# Push every variable from .env.local into the linked Vercel project, then
# redeploy. Run this yourself — it reads your own keys from your own machine and
# sends them straight to Vercel.
#
#   npm run deploy:env
#
# Requires the Vercel CLI (npx fetches it on demand) and a linked project.
set -euo pipefail

ENV_FILE="${1:-.env.local}"
[ -f "$ENV_FILE" ] || { echo "✖ $ENV_FILE not found"; exit 1; }

# Never ship these: SERVICE_ROLE bypasses row-level security and is only used by
# the local MCP server; CORTEXA_USER_ID is likewise local-only.
SKIP_REGEX='^(SUPABASE_SERVICE_ROLE_KEY|CORTEXA_USER_ID|OLLAMA_BASE_URL)$'

command -v vercel >/dev/null 2>&1 || VERCEL="npx --yes vercel@latest"
VERCEL="${VERCEL:-vercel}"

echo "→ Linking project (skipped if already linked)…"
$VERCEL link --yes >/dev/null

pushed=0 skipped=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  key="${line%%=*}"; value="${line#*=}"
  key="$(echo "$key" | tr -d '[:space:]')"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  [ -z "$key" ] || [ -z "$value" ] && continue

  if echo "$key" | grep -qE "$SKIP_REGEX"; then
    echo "  ⊘ $key (local-only, not deployed)"
    skipped=$((skipped+1)); continue
  fi

  for target in production preview development; do
    $VERCEL env rm "$key" "$target" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | $VERCEL env add "$key" "$target" >/dev/null 2>&1
  done
  echo "  ✔ $key"
  pushed=$((pushed+1))
done < "$ENV_FILE"

echo
echo "$pushed variable(s) pushed, $skipped skipped."
echo "→ Deploying to production…"
$VERCEL --prod
