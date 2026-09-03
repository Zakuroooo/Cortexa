#!/usr/bin/env bash
# Push every variable from .env.local into the linked Vercel project, then
# deploy to production.
#
#   npm run deploy:env
#
# Runs `vercel login` first if you are not authenticated (opens a browser once).
# Alternatively export a token to run fully unattended:
#   VERCEL_TOKEN=xxxxx npm run deploy:env
set -uo pipefail

ENV_FILE="${ENV_FILE:-.env.local}"
PROJECT="${VERCEL_PROJECT:-cortexa}"
SCOPE="${VERCEL_SCOPE:-zakuroooos-projects}"

[ -f "$ENV_FILE" ] || { echo "✖ $ENV_FILE not found"; exit 1; }

# Never ship these. SERVICE_ROLE bypasses row-level security and is used only by
# the local MCP server; the others are local-only too.
SKIP_REGEX='^(SUPABASE_SERVICE_ROLE_KEY|CORTEXA_USER_ID|OLLAMA_BASE_URL)$'

if command -v vercel >/dev/null 2>&1; then
  VC="vercel"
else
  echo "→ Vercel CLI not installed locally; using npx."
  VC="npx --yes vercel@latest"
fi

TOKEN_ARG=""
[ -n "${VERCEL_TOKEN:-}" ] && TOKEN_ARG="--token $VERCEL_TOKEN"

# ---- 1. authenticate -------------------------------------------------------
echo "→ Checking Vercel authentication…"
if ! $VC whoami $TOKEN_ARG >/dev/null 2>&1; then
  echo "  Not logged in. Opening browser for login…"
  echo "  (pick the account 04pranay@gmail.com)"
  $VC login || { echo "✖ Login failed or cancelled."; exit 1; }
  $VC whoami >/dev/null 2>&1 || { echo "✖ Still not authenticated."; exit 1; }
fi
echo "  ✔ authenticated as $($VC whoami $TOKEN_ARG 2>/dev/null)"

# ---- 2. link to the EXISTING project ---------------------------------------
# Naming the project and scope explicitly matters: a bare `vercel link` can
# auto-create a second project instead of attaching to the deployed one.
echo "→ Linking to project '$PROJECT' (scope: $SCOPE)…"
$VC link --yes --project "$PROJECT" --scope "$SCOPE" $TOKEN_ARG >/dev/null || {
  echo "✖ Could not link. Check the project name and that you have access."
  exit 1
}
echo "  ✔ linked"

# ---- 3. push variables -----------------------------------------------------
echo "→ Pushing environment variables…"
pushed=0; skipped=0; failed=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  case "$line" in *=*) ;; *) continue ;; esac

  key="${line%%=*}"; value="${line#*=}"
  key="$(printf '%s' "$key" | tr -d '[:space:]')"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  [ -z "$key" ] && continue
  [ -z "$value" ] && continue

  if printf '%s' "$key" | grep -qE "$SKIP_REGEX"; then
    echo "  ⊘ $key  (local-only — never deployed)"
    skipped=$((skipped+1)); continue
  fi

  ok=1
  for target in production preview development; do
    $VC env rm "$key" "$target" --yes $TOKEN_ARG >/dev/null 2>&1 || true
    printf '%s' "$value" | $VC env add "$key" "$target" $TOKEN_ARG >/dev/null 2>&1 || ok=0
  done

  if [ $ok -eq 1 ]; then
    echo "  ✔ $key"; pushed=$((pushed+1))
  else
    echo "  ✖ $key  (failed)"; failed=$((failed+1))
  fi
done < "$ENV_FILE"

echo
echo "$pushed pushed · $skipped skipped · $failed failed"
[ $failed -gt 0 ] && { echo "✖ Some variables failed — fix them before deploying."; exit 1; }
[ $pushed -eq 0 ] && { echo "✖ Nothing pushed. Is $ENV_FILE populated?"; exit 1; }

# ---- 4. deploy -------------------------------------------------------------
echo "→ Deploying to production…"
$VC --prod $TOKEN_ARG
