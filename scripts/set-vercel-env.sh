#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# MBUMAH HARDWARE POS — Set Vercel env vars for Neon PostgreSQL cutover
# ─────────────────────────────────────────────────────────────────────────────
#
# This script sets the 5 required env vars on the Vercel project
# `mbumah-hardware-pos-one` so that the production deployment connects to
# the NEW Neon PostgreSQL database (ep-calm-butterfly-aivj6kzm-pooler).
#
# PREREQUISITES:
#   1. A Vercel API token with project:write + env:write scopes.
#      Create one at: https://vercel.com/account/tokens
#      (The token must belong to the SAME Vercel account/team that owns
#       the `mbumah-hardware-pos-one` project.)
#   2. The `curl` and `jq` commands available.
#
# USAGE:
#   VERCEL_TOKEN=your_token_here bash scripts/set-vercel-env.sh
#
# WHAT IT DOES:
#   1. Finds the project ID for `mbumah-hardware-pos-one`.
#   2. Deletes any existing env vars with the same key (to avoid duplicates).
#   3. Creates fresh env vars for: DATABASE_URL, DIRECT_URL, NEXTAUTH_SECRET,
#      JWT_SECRET, NEXTAUTH_URL — all targeting the Production environment.
#   4. Triggers a production redeploy.
#
# After running this script, verify at:
#   https://mbumah-hardware-pos-one.vercel.app/api/health/env
#   https://mbumah-hardware-pos-one.vercel.app/api/health/db
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

PROJECT_NAME="mbumah-hardware-pos-one"
VERCEL_API="https://api.vercel.com"

# The NEW Neon PostgreSQL pooled connection string (ep-calm-butterfly)
NEON_HOST="ep-calm-butterfly-aivj6kzm-pooler.c-4.us-east-1.aws.neon.tech"
NEON_DB="neondb"
NEON_USER="neondb_owner"
NEON_PASS="npg_aRfWJIn8Neq9"

DATABASE_URL="postgresql://${NEON_USER}:${NEON_PASS}@${NEON_HOST}/${NEON_DB}?sslmode=require&pgbouncer=true&connect_timeout=15"
DIRECT_URL="postgresql://${NEON_USER}:${NEON_PASS}@${NEON_HOST}/${NEON_DB}?sslmode=require&pgbouncer=true&connect_timeout=30"

# Generate strong secrets if not already set (32+ chars base64)
NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-$(openssl rand -base64 32)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 32)}"
NEXTAUTH_URL="https://${PROJECT_NAME}.vercel.app"

# ── Validate token ───────────────────────────────────────────────────────────

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "✗ ERROR: VERCEL_TOKEN environment variable is not set."
  echo "  Create a token at https://vercel.com/account/tokens (needs project:write + env:write scopes)"
  echo "  Then run: VERCEL_TOKEN=your_token bash scripts/set-vercel-env.sh"
  exit 1
fi

echo "=== Verifying Vercel token ==="
USER_RESP=$(curl -s -H "Authorization: Bearer $VERCEL_TOKEN" "$VERCEL_API/v2/user" --max-time 15)
USER_EMAIL=$(echo "$USER_RESP" | jq -r '.user.email // empty')
DEFAULT_TEAM=$(echo "$USER_RESP" | jq -r '.user.defaultTeamId // empty')

if [[ -z "$USER_EMAIL" ]]; then
  echo "✗ Token is invalid or unauthorized. Response:"
  echo "$USER_RESP" | head -c 500
  exit 1
fi
echo "✓ Authenticated as: $USER_EMAIL (defaultTeam: $DEFAULT_TEAM)"

# ── Find the project ─────────────────────────────────────────────────────────

echo ""
echo "=== Finding project: $PROJECT_NAME ==="

# Try without team first (personal projects), then with default team
PROJECT_ID=""
for TEAM_PARAM in "" "?teamId=$DEFAULT_TEAM"; do
  RESP=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $VERCEL_TOKEN" \
    "$VERCEL_API/v9/projects/${PROJECT_NAME}${TEAM_PARAM}" --max-time 15)
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  if [[ "$CODE" == "200" ]]; then
    PROJECT_ID=$(echo "$BODY" | jq -r '.id')
    echo "✓ Found project: $PROJECT_ID"
    break
  fi
done

if [[ -z "$PROJECT_ID" ]]; then
  echo "✗ Could not find project '$PROJECT_NAME'."
  echo "  This token may not have access to the project."
  echo "  The project may be under a different Vercel account/team."
  echo ""
  echo "  Try listing all projects you can access:"
  echo "    curl -s -H 'Authorization: Bearer \$VERCEL_TOKEN' '$VERCEL_API/v9/projects?limit=100' | jq '.projects[].name'"
  exit 1
fi

# ── Helper: delete existing env var by key (idempotent) ──────────────────────

delete_env_var() {
  local key="$1"
  local resp
  resp=$(curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
    "$VERCEL_API/v9/projects/${PROJECT_ID}/env${TEAM_PARAM}" --max-time 15)
  local env_id
  env_id=$(echo "$resp" | jq -r --arg k "$key" '.envs[] | select(.key == $k) | .id' 2>/dev/null || true)
  if [[ -n "$env_id" ]]; then
    echo "  Deleting existing $key (id: $env_id)..."
    curl -s -X DELETE -H "Authorization: Bearer $VERCEL_TOKEN" \
      "$VERCEL_API/v9/projects/${PROJECT_ID}/env/${env_id}${TEAM_PARAM}" --max-time 15 > /dev/null
  fi
}

# ── Helper: create env var ───────────────────────────────────────────────────

create_env_var() {
  local key="$1"
  local value="$2"
  local target="${3:-production}"

  echo "  Setting $key (target: $target)..."
  delete_env_var "$key"

  local payload
  payload=$(jq -n --arg k "$key" --arg v "$value" --arg t "$target" \
    '{type: "encrypted", key: $k, value: $v, target: [$t]}')

  local resp code
  resp=$(curl -s -w "\n%{http_code}" -X POST \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    "$VERCEL_API/v10/projects/${PROJECT_ID}/env${TEAM_PARAM}" --max-time 15)
  code=$(echo "$resp" | tail -1)
  if [[ "$code" != "200" ]] && [[ "$code" != "201" ]]; then
    echo "    ✗ Failed (HTTP $code): $(echo "$resp" | sed '$d' | head -c 200)"
    return 1
  fi
  echo "    ✓ Created"
}

# ── Set all env vars ─────────────────────────────────────────────────────────

echo ""
echo "=== Setting env vars (Production environment) ==="

create_env_var "DATABASE_URL"   "$DATABASE_URL"     "production"
create_env_var "DIRECT_URL"     "$DIRECT_URL"       "production"
create_env_var "NEXTAUTH_SECRET" "$NEXTAUTH_SECRET" "production"
create_env_var "JWT_SECRET"     "$JWT_SECRET"       "production"
create_env_var "NEXTAUTH_URL"   "$NEXTAUTH_URL"     "production"

# ── Trigger redeploy ─────────────────────────────────────────────────────────

echo ""
echo "=== Triggering production redeploy ==="

# Get the latest production deployment
LATEST_DEPLOY=$(curl -s -H "Authorization: Bearer $VERCEL_TOKEN" \
  "$VERCEL_API/v6/deployments?projectId=${PROJECT_ID}&limit=1&production=true${TEAM_PARAM/&/?}" \
  --max-time 15)
DEPLOY_ID=$(echo "$LATEST_DEPLOY" | jq -r '.deployments[0].uid // empty')

if [[ -n "$DEPLOY_ID" ]]; then
  echo "  Latest deployment: $DEPLOY_ID"
  echo "  Triggering redeploy (without build cache)..."
  REDEPLOY_RESP=$(curl -s -X POST \
    -H "Authorization: Bearer $VERCEL_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"name":"'"$PROJECT_NAME"'","target":"production"}' \
    "$VERCEL_API/v13/deployments${TEAM_PARAM/&/?}" --max-time 15)
  NEW_DEPLOY_ID=$(echo "$REDEPLOY_RESP" | jq -r '.id // empty')
  NEW_DEPLOY_URL=$(echo "$REDEPLOY_RESP" | jq -r '.url // empty')
  if [[ -n "$NEW_DEPLOY_ID" ]]; then
    echo "  ✓ New deployment triggered: $NEW_DEPLOY_ID"
    [[ -n "$NEW_DEPLOY_URL" ]] && echo "  URL: https://$NEW_DEPLOY_URL"
  else
    echo "  ⚠ Redeploy response: $(echo "$REDEPLOY_RESP" | head -c 300)"
  fi
else
  echo "  ⚠ Could not find latest deployment to redeploy."
  echo "  Push a new commit to main, or use the Vercel dashboard Redeploy button."
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " ENV VARS SET (Production environment on $PROJECT_NAME)"
echo "═══════════════════════════════════════════════════════════════"
echo " DATABASE_URL     → $NEON_HOST (pooled, pgbouncer=true)"
echo " DIRECT_URL       → $NEON_HOST (pooled, pgbouncer=true)"
echo " NEXTAUTH_SECRET  → ${NEXTAUTH_SECRET:0:8}... (${#NEXTAUTH_SECRET} chars)"
echo " JWT_SECRET       → ${JWT_SECRET:0:8}... (${#JWT_SECRET} chars)"
echo " NEXTAUTH_URL     → $NEXTAUTH_URL"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo " VERIFY (wait ~2 min for build, then):"
echo "   curl -s https://${PROJECT_NAME}.vercel.app/api/health/env | jq"
echo "   curl -s https://${PROJECT_NAME}.vercel.app/api/health/db  | jq"
echo ""
echo " LOGIN:"
echo "   https://${PROJECT_NAME}.vercel.app"
echo "   admin@mbumahhardware.co.ke / password123"
