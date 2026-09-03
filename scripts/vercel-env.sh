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
# VERCEL_OIDC_TOKEN is injected into .env.local by `vercel link` and is a
# short-lived credential Vercel manages itself — pinning a stale copy of it
# as a static env var is wrong and can break OIDC.
SKIP_REGEX='^(SUPABASE_SERVICE_ROLE_KEY|CORTEXA_USER_ID|OLLAMA_BASE_URL|VERCEL_OIDC_TOKEN|VERCEL_.*)$'

if command -v vercel >/dev/null 2>&1; then
  VC="vercel"
else
  echo "→ Vercel CLI not installed locally; using npx."
  VC="npx --yes vercel@latest"
fi

TOKEN_ARG=""
[ -n "${VERCEL_TOKEN:-}" ] && TOKEN_ARG="--token $VERCEL_TOKEN"

# Vercel refuses to store a credential-looking value under a NEXT_PUBLIC_ name
# without an explicit type, and it asks interactively — which a piped stdin can
# never answer, so the add fails silently. NEXT_PUBLIC_* values are shipped to
# browsers by definition, so declare them "config"; everything else is "secret".
add_var() {
  _key="$1"; _val="$2"; _target="$3"
  case "$_key" in
    NEXT_PUBLIC_*) _type="config" ;;
    *)             _type="secret" ;;
  esac
  $VC env add "$_key" "$_target" --type "$_type" --value "$_val" --yes $TOKEN_ARG 2>&1
}


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

  ok=1; err=""
  for target in production preview development; do
    $VC env rm "$key" "$target" --yes $TOKEN_ARG >/dev/null 2>&1 || true
    out="$(add_var "$key" "$value" "$target")" || { ok=0; err="$out"; }
  done

  if [ $ok -eq 1 ]; then
    echo "  ✔ $key"; pushed=$((pushed+1))
  else
    echo "  ✖ $key  (failed)"
    # Show the reason rather than swallowing it — the silent version of this
    # shipped a deployment missing its Supabase key.
    printf '%s\n' "$err" | tail -4 | sed 's/^/      /'
    failed=$((failed+1))
  fi
done < "$ENV_FILE"

echo
echo "$pushed pushed · $skipped skipped · $failed failed"

# ---- 4. VERIFY -------------------------------------------------------------
# `vercel env add` can report success and store nothing. Trusting its exit code
# once shipped a deployment missing NEXT_PUBLIC_SUPABASE_ANON_KEY, which failed
# at runtime with a confusing "URL and Key are required" error. So: read back
# what production will actually see, and retry anything that did not land.
echo "→ Verifying what production will actually receive…"
VERIFY_FILE="$(mktemp)"
trap 'rm -f "$VERIFY_FILE"' EXIT
$VC env pull "$VERIFY_FILE" --environment=production --yes $TOKEN_ARG >/dev/null 2>&1 || true

missing=""
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in ''|'#'*) continue ;; esac
  case "$line" in *=*) ;; *) continue ;; esac
  key="$(printf '%s' "${line%%=*}" | tr -d '[:space:]')"
  [ -z "$key" ] && continue
  printf '%s' "$key" | grep -qE "$SKIP_REGEX" && continue
  [ -z "${line#*=}" ] && continue

  if grep -qE "^${key}=" "$VERIFY_FILE" 2>/dev/null; then
    echo "  ✔ $key present"
  else
    echo "  ✖ $key MISSING — retrying"
    missing="$missing $key"
    value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"
    for target in production preview development; do
      $VC env rm "$key" "$target" --yes $TOKEN_ARG >/dev/null 2>&1 || true
      add_var "$key" "$value" "$target" >/dev/null 2>&1 || true
    done
  fi
done < "$ENV_FILE"

if [ -n "$missing" ]; then
  echo "→ Re-verifying retried variables…"
  $VC env pull "$VERIFY_FILE" --environment=production --yes $TOKEN_ARG >/dev/null 2>&1 || true
  for key in $missing; do
    if grep -qE "^${key}=" "$VERIFY_FILE" 2>/dev/null; then
      echo "  ✔ $key now present"
    else
      echo "  ✖ $key STILL missing — add it manually in the Vercel dashboard."
      failed=$((failed+1))
    fi
  done
fi

[ $failed -gt 0 ] && { echo "✖ Refusing to deploy a half-configured environment."; exit 1; }
[ $pushed -eq 0 ] && { echo "✖ Nothing pushed. Is $ENV_FILE populated?"; exit 1; }

# ---- 5. deploy -------------------------------------------------------------
echo "→ Deploying to production…"
$VC --prod $TOKEN_ARG
