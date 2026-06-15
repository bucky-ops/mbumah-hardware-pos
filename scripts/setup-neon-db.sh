#!/usr/bin/env bash
# ============================================================================
# MBUMAH HARDWARE POS - Neon PostgreSQL Database Setup
# ============================================================================
# This script creates a free Neon PostgreSQL database and configures the
# project to use it with Prisma ORM for Vercel deployment.
#
# Prerequisites:
#   - Node.js 18+ and npm
#   - A Neon account (free tier: https://neon.tech)
#
# Usage:
#   chmod +x scripts/setup-neon-db.sh
#   ./scripts/setup-neon-db.sh
# ============================================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

PROJECT_NAME="mbumah-hardware-pos"
REGION="aws-us-east-1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"
SCHEMA_FILE="$PROJECT_DIR/prisma/schema.prisma"

# ============================================================================
# Helper Functions
# ============================================================================

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

check_command() {
  if ! command -v "$1" &>/dev/null; then
    error "'$1' is required but not installed. Please install it first."
  fi
}

# ============================================================================
# Step 1: Check Prerequisites
# ============================================================================

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   MBUMAH HARDWARE POS - Neon PostgreSQL Database Setup      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

info "Checking prerequisites..."
check_command node
check_command npm
success "Node.js and npm are available"

# ============================================================================
# Step 2: Install neonctl if not present
# ============================================================================

if command -v neonctl &>/dev/null; then
  NEON_VERSION=$(neonctl --version 2>/dev/null || echo "unknown")
  success "neonctl is installed (version: $NEON_VERSION)"
else
  info "Installing neonctl CLI..."
  npm install -g neonctl
  success "neonctl installed successfully"
fi

# ============================================================================
# Step 3: Authenticate with Neon
# ============================================================================

echo ""
info "Checking Neon authentication status..."

# Check if API key is already set
if [ -n "${NEON_API_KEY:-}" ]; then
  success "NEON_API_KEY environment variable is set"
else
  # Check if neonctl has saved credentials
  if [ -f "$HOME/.config/neonctl/credentials" ] || [ -f "$HOME/.config/neonctl/.credentials" ]; then
    success "neonctl credentials found"
  else
    echo ""
    warn "No Neon authentication found. You need to authenticate."
    echo ""
    echo "  Option 1: Interactive browser login (recommended)"
    echo "    $ neonctl auth"
    echo ""
    echo "  Option 2: Use an API key from https://console.neon.tech/settings"
    echo "    $ export NEON_API_KEY=your_api_key_here"
    echo ""
    echo "  Option 3: Pass API key directly"
    echo "    $ NEON_API_KEY=your_api_key_here ./scripts/setup-neon-db.sh"
    echo ""

    read -rp "Do you want to run 'neonctl auth' now? (opens browser) [Y/n]: " AUTH_CHOICE
    AUTH_CHOICE=${AUTH_CHOICE:-Y}

    if [[ "$AUTH_CHOICE" =~ ^[Yy]$ ]]; then
      info "Opening browser for Neon authentication..."
      neonctl auth || error "Authentication failed. Please try again."
      success "Authentication successful!"
    else
      error "Authentication is required. Please set NEON_API_KEY or run 'neonctl auth' manually, then re-run this script."
    fi
  fi
fi

# ============================================================================
# Step 4: Create Neon Project
# ============================================================================

echo ""
info "Creating Neon PostgreSQL project: $PROJECT_NAME"

PROJECT_OUTPUT=$(neonctl projects create \
  --name "$PROJECT_NAME" \
  --region-id "$REGION" \
  --output json 2>&1) || {
  error "Failed to create Neon project. Output:\n$PROJECT_OUTPUT"
}

# Parse project details
PROJECT_ID=$(echo "$PROJECT_OUTPUT" | node -e "
  let data = '';
  process.stdin.on('data', chunk => data += chunk);
  process.stdin.on('end', () => {
    try {
      const parsed = JSON.parse(data);
      // Handle both single project and array response
      const project = Array.isArray(parsed) ? parsed[0] : parsed;
      console.log(project.id || project.project?.id || '');
    } catch(e) {
      console.error('Parse error:', e.message);
      process.exit(1);
    }
  });
" 2>/dev/null) || PROJECT_ID=""

if [ -z "$PROJECT_ID" ]; then
  # Try table format parsing as fallback
  warn "Could not parse project ID from JSON. Trying alternative approach..."
  PROJECT_ID=$(echo "$PROJECT_OUTPUT" | rg -o 'id\s*\|\s*[\w-]+' | head -1 | awk '{print $NF}') || true
fi

info "Project ID: ${PROJECT_ID:-unknown}"

# ============================================================================
# Step 5: Get Connection String
# ============================================================================

echo ""
info "Retrieving database connection string..."

# Try to get connection string via neonctl
CS_OUTPUT=$(neonctl connection-string --project-id "$PROJECT_ID" --output json 2>&1) || {
  warn "Could not get connection string via CLI. Will try manual approach..."
  CS_OUTPUT=""
}

if [ -n "$CS_OUTPUT" ]; then
  DATABASE_URL=$(echo "$CS_OUTPUT" | node -e "
    let data = '';
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        console.log(parsed.connectionString || parsed.uri || parsed[0] || '');
      } catch(e) {
        // Might be plain text
        console.log(data.trim());
      }
    });
  " 2>/dev/null) || DATABASE_URL=""
fi

# If we still don't have the connection string, prompt the user
if [ -z "$DATABASE_URL" ]; then
  echo ""
  warn "Could not automatically retrieve the connection string."
  echo ""
  echo "  Please go to https://console.neon.tech and find your project."
  echo "  Copy the connection string from the Dashboard tab."
  echo ""
  echo "  It should look like:"
  echo "  postgresql://username:password@ep-xxx-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require"
  echo ""
  read -rp "Paste your DATABASE_URL here: " DATABASE_URL

  if [ -z "$DATABASE_URL" ]; then
    error "DATABASE_URL is required. Cannot continue."
  fi
fi

# Ensure sslmode=require is in the connection string (Neon requires SSL)
if [[ "$DATABASE_URL" != *"sslmode"* ]]; then
  DATABASE_URL="${DATABASE_URL}&sslmode=require"
  # Fix if there's no ? yet
  DATABASE_URL="${DATABASE_URL/\/&sslmode/\/?sslmode}"
fi

success "DATABASE_URL retrieved successfully"

# ============================================================================
# Step 6: Build Direct URL for Prisma Migrations
# ============================================================================

# Neon uses a connection pooler on port 5432 by default.
# For Prisma migrations, we need a direct connection (not pooled).
# The pooled connection uses: ep-xxx-xxx.us-east-1.aws.neon.tech
# The direct connection uses: ep-xxx-xxx.us-east-1.aws.neon.tech (same, but without pooler)

# If the URL contains pooler mode, create a direct URL
DIRECT_URL="$DATABASE_URL"
if [[ "$DIRECT_URL" == *"pooler"* ]] || [[ "$DIRECT_URL" == *":5432"* ]]; then
  # Remove pooler reference for direct connection
  DIRECT_URL="${DIRECT_URL//&pooler=true/}"
  DIRECT_URL="${DIRECT_URL//?pooler=true&/?}"
  DIRECT_URL="${DIRECT_URL//?pooler=true/}"
fi

# ============================================================================
# Step 7: Update .env File
# ============================================================================

echo ""
info "Updating .env file..."

# Backup existing .env if present
if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
  success "Backed up existing .env file"
fi

# Update or create .env
if [ -f "$ENV_FILE" ]; then
  # Update existing DATABASE_URL
  if rg -q "^DATABASE_URL=" "$ENV_FILE" 2>/dev/null; then
    # Use sed for cross-platform compatibility
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=\"$DATABASE_URL\"|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    echo "DATABASE_URL=\"$DATABASE_URL\"" >> "$ENV_FILE"
  fi

  # Add DIRECT_URL if not present
  if ! rg -q "^DIRECT_URL=" "$ENV_FILE" 2>/dev/null; then
    echo "DIRECT_URL=\"$DIRECT_URL\"" >> "$ENV_FILE"
  else
    sed -i.bak "s|^DIRECT_URL=.*|DIRECT_URL=\"$DIRECT_URL\"|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  fi
else
  # Create new .env from example
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    sed -i.bak "s|^DATABASE_URL=.*|DATABASE_URL=\"$DATABASE_URL\"|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
    echo "DIRECT_URL=\"$DIRECT_URL\"" >> "$ENV_FILE"
  else
    cat > "$ENV_FILE" << EOF
# MBUMAH HARDWARE POS - Neon PostgreSQL
DATABASE_URL="$DATABASE_URL"
DIRECT_URL="$DIRECT_URL"

# Auth
NEXTAUTH_SECRET="$(openssl rand -base64 32 2>/dev/null || echo 'change-this-to-a-secure-random-string')"
NEXTAUTH_URL="http://localhost:3000"
JWT_SECRET="$(openssl rand -base64 32 2>/dev/null || echo 'change-this-in-production')"

# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_CURRENCY="KES"
EOF
  fi
fi

success ".env file updated with Neon connection strings"

# ============================================================================
# Step 8: Update Prisma Schema for PostgreSQL
# ============================================================================

echo ""
info "Updating Prisma schema for PostgreSQL..."

# Update the datasource block in schema.prisma
if [ -f "$SCHEMA_FILE" ]; then
  # Backup the schema
  cp "$SCHEMA_FILE" "$SCHEMA_FILE.bak.$(date +%Y%m%d%H%M%S)"

  # Replace the datasource block to use PostgreSQL with Neon
  # Using node for reliable multi-line replacement
  node -e "
const fs = require('fs');
let schema = fs.readFileSync('$SCHEMA_FILE', 'utf8');

// Replace the datasource block
schema = schema.replace(
  /datasource\s+db\s*\{[^}]*\}/s,
  \`datasource db {
  provider  = \"postgresql\"
  url       = env(\"DATABASE_URL\")
  directUrl = env(\"DIRECT_URL\")
}\`
);

fs.writeFileSync('$SCHEMA_FILE', schema);
console.log('Schema updated successfully');
" || warn "Could not auto-update schema. Please update manually."

  success "Prisma schema updated to use PostgreSQL"
else
  warn "Schema file not found at $SCHEMA_FILE"
fi

# ============================================================================
# Step 9: Run Prisma Migrations
# ============================================================================

echo ""
info "Running Prisma migrations against Neon database..."

cd "$PROJECT_DIR"

# Generate Prisma client
info "Generating Prisma client..."
npx prisma generate || warn "Prisma generate had issues (may need manual fix)"

# Push schema to database (using db push for initial setup)
info "Pushing schema to Neon database..."
read -rp "Run 'prisma db push' now? This will create tables in Neon. [Y/n]: " PUSH_CHOICE
PUSH_CHOICE=${PUSH_CHOICE:-Y}

if [[ "$PUSH_CHOICE" =~ ^[Yy]$ ]]; then
  npx prisma db push || {
    warn "Schema push had issues. You may need to run 'prisma migrate dev' instead."
    echo "  Try: npx prisma migrate dev --name init_neon"
  }
  success "Schema pushed to Neon database"
fi

# Seed the database
read -rp "Seed the database with initial data? [Y/n]: " SEED_CHOICE
SEED_CHOICE=${SEED_CHOICE:-Y}

if [[ "$SEED_CHOICE" =~ ^[Yy]$ ]]; then
  npx prisma db seed || warn "Database seeding had issues"
  success "Database seeded"
fi

# ============================================================================
# Step 10: Summary
# ============================================================================

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Neon Database Setup Complete!                  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Project:${NC}       $PROJECT_NAME"
echo -e "  ${CYAN}Project ID:${NC}    ${PROJECT_ID:-see console.neon.tech}"
echo -e "  ${CYAN}Region:${NC}        $REGION"
echo -e "  ${CYAN}Database URL:${NC}  $DATABASE_URL"
echo ""
echo -e "  ${YELLOW}Next Steps:${NC}"
echo ""
echo "  1. Add DATABASE_URL to Vercel Environment Variables:"
echo "     https://vercel.com/dashboard → Your Project → Settings → Environment Variables"
echo ""
echo "  2. Also add DIRECT_URL to Vercel (needed for migrations):"
echo "     DIRECT_URL=$DIRECT_URL"
echo ""
echo "  3. Deploy to Vercel:"
echo "     npx vercel --prod"
echo ""
echo "  4. Or link and deploy from the Vercel dashboard"
echo ""
echo -e "  ${YELLOW}Important Neon Free Tier Limits:${NC}"
echo "     - 0.5 GB storage"
echo "     - 100 compute hours/month"
echo "     - 1 project (upgrade for more)"
echo "     - Auto-suspend after 5 minutes of inactivity"
echo ""
echo -e "  ${YELLOW}Monitoring:${NC}"
echo "     https://console.neon.tech → Your Project → Dashboard"
echo ""
