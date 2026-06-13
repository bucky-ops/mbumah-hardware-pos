#!/usr/bin/env bash
# ============================================================================
# MBUMAH HARDWARE POS - Quick Neon DB Setup (API Key Required)
# ============================================================================
# For users who already have a Neon API key.
# Get your API key at: https://console.neon.tech/settings
#
# Usage:
#   NEON_API_KEY=your_key_here ./scripts/setup-neon-quick.sh
# ============================================================================

set -euo pipefail

: "${NEON_API_KEY:?NEON_API_KEY environment variable is required. Get one at https://console.neon.tech/settings}"

PROJECT_NAME="mbumah-hardware-pos"
REGION="aws-us-east-1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Creating Neon project: $PROJECT_NAME..."

# Create project via API
RESPONSE=$(curl -s -X POST "https://api.neon.tech/api/v2/projects" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "{
    \"project\": {
      \"name\": \"$PROJECT_NAME\",
      \"region_id\": \"$REGION\",
      \"pg_version\": 16
    }
  }")

# Parse response
PROJECT_ID=$(echo "$RESPONSE" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{ const j=JSON.parse(d); console.log(j.project?.id||j.id||''); }
    catch(e){ console.error('Parse error'); process.exit(1); }
  });
")

if [ -z "$PROJECT_ID" ]; then
  echo "ERROR: Failed to create project."
  echo "Response: $RESPONSE"
  exit 1
fi

echo "Project created! ID: $PROJECT_ID"
echo "Waiting for database to be ready..."
sleep 5

# Get connection string
CS_RESPONSE=$(curl -s "https://api.neon.tech/api/v2/projects/$PROJECT_ID/connection_string" \
  -H "Authorization: Bearer $NEON_API_KEY" \
  -H "Accept: application/json")

DATABASE_URL=$(echo "$CS_RESPONSE" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try{ const j=JSON.parse(d); console.log(j.uri||j.connectionString||j.connection_string||''); }
    catch(e){ console.error('Parse error'); process.exit(1); }
  });
")

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: Could not retrieve connection string."
  echo "Visit https://console.neon.tech to get it manually."
  exit 1
fi

# Ensure sslmode=require
if [[ "$DATABASE_URL" != *"sslmode"* ]]; then
  DATABASE_URL="${DATABASE_URL}?sslmode=require"
fi

DIRECT_URL="$DATABASE_URL"

echo ""
echo "========================================="
echo "  Neon Database Created Successfully!"
echo "========================================="
echo ""
echo "  DATABASE_URL=$DATABASE_URL"
echo "  DIRECT_URL=$DIRECT_URL"
echo ""
echo "Add these to your .env file and to Vercel environment variables."
echo ""
echo "Then run:"
echo "  npx prisma generate"
echo "  npx prisma db push"
echo "  npx prisma db seed"
