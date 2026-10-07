#!/usr/bin/env bash
# ============================================================================
# MBUMAH HARDWARE POS — Automatic Updater (Linux/macOS, no-Docker laptop)
# ============================================================================
# Installs the newest GitHub release during DORMANT hours (default 22:00-06:00)
# with a pre-update backup, the exact installer rebuild sequence, a health
# gate, and AUTOMATIC CODE ROLLBACK on failure (data is never touched).
#
# Every decision is recorded (one JSON line per event) in the ledger:
#   ~/mbumah-pos-data/update-ledger.jsonl
#
# Usage:
#   bash deploy/nodocker/update-pos.sh
#   ... -Force              update NOW, ignore the dormant window
#   ... -ToVersion v2.9.0   install a specific release tag instead of latest
#   ... -SkipBackup         no pre-update backup (not recommended)
#   ... -WindowStart 22:00 -WindowEnd 06:00   custom dormant window
#   ... -Quiet                scripted mode (start-pos.sh calls this on launch)
#   ... -NoStart              after the update, let the CALLER start the POS
#
# Designed for cron ("0 23 * * *"): never prompts, never fails loudly when
# offline, exits 0 on the harmless outcomes (skipped / offline / up to date).
# ============================================================================
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT" || exit 1
REPO_SLUG="bucky-ops/mbumah-hardware-pos"
LEDGER="$HOME/mbumah-pos-data/update-ledger.jsonl"

FORCE=0
SKIP_BACKUP=0
QUIET=0
NOSTART=0
TO_VERSION=""
WINDOW_START="22:00"
WINDOW_END="06:00"

while [ $# -gt 0 ]; do
  case "$1" in
    -Force|--force) FORCE=1 ;;
    -SkipBackup|--skip-backup) SKIP_BACKUP=1 ;;
    -Quiet|--quiet) QUIET=1 ;;
    -NoStart|--no-start) NOSTART=1 ;;
    -ToVersion|--to-version) TO_VERSION="${2:-}"; shift ;;
    -WindowStart) WINDOW_START="${2:-22:00}"; shift ;;
    -WindowEnd) WINDOW_END="${2:-06:00}"; shift ;;
    *) echo "[WARN] Unknown option: $1" ;;
  esac
  shift
done

# ── Helpers ──────────────────────────────────────────────────────────────────

json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n\r\t'; }

append_ledger() { # $1=event $2=from $3=to $4=detail
  mkdir -p "$(dirname "$LEDGER")" 2>/dev/null
  printf '{"ts":"%s","event":"%s","from":"%s","to":"%s","detail":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    "$(json_escape "$1")" "$(json_escape "$2")" "$(json_escape "$3")" "$(json_escape "$4")" \
    >> "$LEDGER" 2>/dev/null || true
}

get_env_value() { # $1=NAME
  [ -f "$ROOT/.env" ] || { echo ""; return; }
  grep -m1 -E "^${1}=" "$ROOT/.env" | sed -E "s/^${1}=//; s/^\"//; s/\"$//; s/^'//; s/'$//" || echo ""
}

find_app_pids() { # $1 = script name fragment (start-server.mjs / cron-local.mjs)
  local pids="" pid cwd
  for pid in $(pgrep -f "node .*deploy/nodocker/$1" 2>/dev/null); do
    cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    [ "$cwd" = "$ROOT" ] && pids="$pids $pid"
  done
  echo "$pids"
}

server_running() { [ -n "$(find_app_pids start-server.mjs)" ]; }

ensure_cron_tasks() {
  # Self-heal (v2.10.1): re-add the nightly cron lines if they went missing
  # (or if this install got its first update via the startup check and the
  # cron offer was never accepted). Never throws.
  command -v crontab >/dev/null 2>&1 || return 0
  local app_root="$ROOT"
  local need_update=1 need_backup=1
  crontab -l 2>/dev/null | grep -q "deploy/nodocker/update-pos.sh" && need_update=0
  crontab -l 2>/dev/null | grep -q "deploy/nodocker/backup-pos.sh" && need_backup=0
  { [ "$need_update" -eq 1 ] || [ "$need_backup" -eq 1 ]; } || return 0
  {
    crontab -l 2>/dev/null
    [ "$need_update" -eq 1 ] && echo "0 23 * * * bash $app_root/deploy/nodocker/update-pos.sh >> $app_root/update-cron.log 2>&1"
    [ "$need_backup" -eq 1 ] && echo "30 2 * * * bash $app_root/deploy/nodocker/backup-pos.sh >> $app_root/backup-cron.log 2>&1"
  } | crontab - 2>/dev/null && {
    [ "$need_update" -eq 1 ] && { echo "[OK] Nightly update cron re-registered (23:00)."; append_ledger "TASK_REGISTERED" "" "" "cron update"; }
    [ "$need_backup" -eq 1 ] && { echo "[OK] Nightly backup cron re-registered (02:30)."; append_ledger "TASK_REGISTERED" "" "" "cron backup"; }
  }
  return 0
}

stop_app() {
  local pid
  for pid in $(find_app_pids start-server.mjs) $(find_app_pids cron-local.mjs); do
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null
  done
  sleep 2
  return 0
}

start_app() {
  # Detached: both processes survive this script exiting (required for cron).
  nohup node deploy/nodocker/start-server.mjs > server.log 2>&1 &
  local spid=$!
  disown "$spid" 2>/dev/null || true
  sleep 1
  nohup node deploy/nodocker/cron-local.mjs > cron.log 2>&1 &
  disown "$!" 2>/dev/null || true
}

wait_healthy() { # $1=port
  local i body stats
  for i in $(seq 1 30); do
    sleep 2
    body="$(curl -sf -m 3 "http://127.0.0.1:${1}/api/health" 2>/dev/null)" || continue
    stats="$(printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const h=JSON.parse(s);console.log(h.checks&&h.checks.database_stats?h.checks.database_stats.status:"unknown");}catch{console.log("unknown")}})' 2>/dev/null)"
    if [ "$stats" = "ok" ]; then return 0; fi
  done
  return 1
}

set_build_env() {
  # .env is the single source of truth (same precedence rule as start-server.mjs)
  local dburl durl
  dburl="$(get_env_value DATABASE_URL)"
  [ -n "$dburl" ] && export DATABASE_URL="$dburl"
  durl="$(get_env_value DIRECT_URL)"
  [ -n "$durl" ] && export DIRECT_URL="$durl"
  export SKIP_ENV_VALIDATION=1
}

run_rebuild() { # mirrors install-nodocker.sh steps 5-7 (minus seeding)
  # NOTE: the app is stopped FIRST - `next build` replaces .next (including
  # .next/standalone) and the old server keeps engine binaries locked.
  echo "[BUILD 0/4] Stopping the running POS for the rebuild..."
  stop_app
  set_build_env
  echo "[BUILD 1/4] Installing dependencies (needs internet)..."
  if ! npm install; then echo "[FAIL] npm install failed"; return 1; fi
  echo "[BUILD 2/4] Applying the database schema..."
  if ! npm run db:push; then echo "[FAIL] db:push failed"; return 1; fi
  echo "[BUILD 3/4] Building the production app..."
  if ! npm run build; then echo "[FAIL] build failed"; return 1; fi

  echo "[BUILD 4/4] Verifying the database..."
  local vrc=0
  node deploy/nodocker/verify-db.mjs || vrc=$?
  if [ "$vrc" -eq 10 ]; then
    # Reachable but empty - rollback cannot restore data; let the health gate decide.
    echo "[WARN] Database is reachable but EMPTY - continuing."
  elif [ "$vrc" -ne 0 ]; then
    echo "[FAIL] Database verification failed (exit $vrc)"
    return 1
  fi

  echo "[BUILD] Assembling the standalone server..."
  if ! mkdir -p .next/standalone/.next; then echo "[FAIL] assemble failed"; return 1; fi
  if ! cp -r .next/static .next/standalone/.next/; then echo "[FAIL] assemble failed"; return 1; fi
  if ! cp -r public .next/standalone/; then echo "[FAIL] assemble failed"; return 1; fi
  return 0
}

download_zip() { # $1=ref (tags/vX / heads/main) -> echoes extracted folder or ""
  local zip_file src_dir
  zip_file="${TMPDIR:-/tmp}/mbumah-update.zip"
  src_dir="${TMPDIR:-/tmp}/mbumah-update-src"
  local auth_args=""
  if [ -n "${GITHUB_TOKEN:-}" ]; then auth_args="-H Authorization:token_${GITHUB_TOKEN}"; fi
  # shellcheck disable=SC2086
  if ! curl -sfL $auth_args -o "$zip_file" "https://codeload.github.com/${REPO_SLUG}/zip/refs/$1"; then
    echo ""
    return 1
  fi
  rm -rf "$src_dir"
  if command -v unzip >/dev/null 2>&1; then
    if ! unzip -q "$zip_file" -d "$src_dir"; then echo ""; return 1; fi
  elif command -v python3 >/dev/null 2>&1; then
    if ! python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$zip_file" "$src_dir"; then
      echo ""; return 1
    fi
  else
    echo "[WARN] Neither unzip nor python3 found - cannot extract the update." >&2
    echo ""
    return 1
  fi
  local sub
  sub="$(find "$src_dir" -mindepth 1 -maxdepth 1 -type d | head -1)"
  [ -n "$sub" ] || sub="$src_dir"
  echo "$sub"
  return 0
}

overlay_tree() { # $1=source folder -> copies over ROOT without touching local state
  # Both './name' and 'name' patterns: GNU tar stores "./x" member names, BSD
  # tar (macOS) stores "x" - covering both keeps the excludes working anywhere.
  if ! tar -C "$1" \
      --exclude='./.env' --exclude='.env' \
      --exclude='./.env.local' --exclude='.env.local' \
      --exclude='./.env.development' --exclude='.env.development' \
      --exclude='./.env.production' --exclude='.env.production' \
      --exclude='./.env.example' --exclude='.env.example' \
      --exclude='*.log' \
      --exclude='./node_modules' --exclude='node_modules' \
      --exclude='./.next' --exclude='.next' \
      --exclude='./.git' --exclude='.git' \
      --exclude='./backups' --exclude='backups' \
      --exclude='./mbumah-pos-data' --exclude='mbumah-pos-data' \
      -cf - . | tar -C "$ROOT" -xf -; then
    echo "[FAIL] Copying the new source over the app folder failed."
    return 1
  fi
  # The .env TEMPLATE is not a secret - refresh it so new installs pick up new keys
  if [ -f "$1/deploy/nodocker/.env.nodocker.example" ]; then
    cp -f "$1/deploy/nodocker/.env.nodocker.example" "$ROOT/deploy/nodocker/.env.nodocker.example" 2>/dev/null || true
  fi
  return 0
}

# ============================================================================
# MAIN
# ============================================================================
echo ""
echo "=============================================================="
echo "  MBUMAH HARDWARE POS - UPDATE"
echo "=============================================================="

# ── a) Resolve root, .env, current version ──────────────────────────────────
PORT="$(get_env_value APP_PORT)"
case "$PORT" in ''|*[!0-9]*) PORT=3000 ;; esac

DB_FILE="$(get_env_value DATABASE_URL)"
case "$DB_FILE" in file:*) DB_FILE="${DB_FILE#file:}" ;; esac
case "$DB_FILE" in /*) ;; "") DB_FILE="$HOME/mbumah-pos-data/pos.db" ;; *) DB_FILE="$ROOT/$DB_FILE" ;; esac

if [ ! -f "$DB_FILE" ]; then
  echo "[WARN] Database not found at $DB_FILE - nothing to update."
  append_ledger "CHECK_FAILED" "" "" "pos.db not found (app not installed?)"
  exit 0
fi

CURRENT_VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo "")"
FROM_VERSION="$CURRENT_VERSION"
echo "[INFO] App folder : $ROOT"
echo "[INFO] Current version: $CURRENT_VERSION"
echo "[INFO] Database: $DB_FILE"

# ── b) Dormant-window check (skipped with -Force or when the POS is closed) ──
if [ "$FORCE" -ne 1 ] && server_running; then
  CUR_MIN=$(( 10#$(date +%H) * 60 + 10#$(date +%M) ))
  S_MIN=$(( 10#${WINDOW_START%%:*} * 60 + 10#${WINDOW_START##*:} ))
  E_MIN=$(( 10#${WINDOW_END%%:*} * 60 + 10#${WINDOW_END##*:} ))
  INSIDE=1
  if [ "$S_MIN" -eq "$E_MIN" ]; then
    INSIDE=1   # degenerate window = always inside
  elif [ "$S_MIN" -lt "$E_MIN" ]; then
    [ "$CUR_MIN" -ge "$S_MIN" ] && [ "$CUR_MIN" -lt "$E_MIN" ] || INSIDE=0
  else
    { [ "$CUR_MIN" -ge "$S_MIN" ] || [ "$CUR_MIN" -lt "$E_MIN" ]; } || INSIDE=0
  fi
  if [ "$INSIDE" -ne 1 ]; then
    echo "[INFO] Outside the update window ($WINDOW_START-$WINDOW_END) and the POS is running - skipping."
    echo "       Run with -Force to update now anyway."
    append_ledger "SKIPPED_WINDOW" "$FROM_VERSION" "" "window $WINDOW_START-$WINDOW_END, pos running"
    exit 0
  fi
  echo "[INFO] Inside the update window ($WINDOW_START-$WINDOW_END)."
elif server_running; then
  echo "[INFO] -Force given - ignoring the update window."
else
  echo "[INFO] POS is not running - safe to update at any time."
fi

# ── c) Determine the target release ─────────────────────────────────────────
if [ -n "$TO_VERSION" ]; then
  case "$TO_VERSION" in v*) ;; *) TO_VERSION="v$TO_VERSION" ;; esac
  TARGET_TAG="$TO_VERSION"
  echo "[INFO] Target version (requested): $TARGET_TAG"
else
  echo "[INFO] Checking GitHub for the latest release..."
  AUTH_ARGS=""
  if [ -n "${GITHUB_TOKEN:-}" ]; then AUTH_ARGS="-H Authorization:token_${GITHUB_TOKEN}"; fi
  # shellcheck disable=SC2086
  # -Quiet (startup check) uses a short timeout so an offline machine is not
  # stuck waiting; the nightly cron can afford 30s.
  GH_TIMEOUT=30; [ "$QUIET" -eq 1 ] && GH_TIMEOUT=10
  TARGET_TAG="$(curl -sf $AUTH_ARGS -m $GH_TIMEOUT "https://api.github.com/repos/${REPO_SLUG}/releases/latest" 2>/dev/null |
    grep -m1 '"tag_name"' | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')" || TARGET_TAG=""
  if [ -z "$TARGET_TAG" ]; then
    # Scheduled tasks must NEVER spam errors - offline is a normal state.
    echo "[WARN] Could not reach GitHub (offline?). Will try again tomorrow."
    append_ledger "CHECK_FAILED" "$FROM_VERSION" "" "release check failed"
    exit 0
  fi
  echo "[INFO] Latest release: $TARGET_TAG"
fi

TARGET_VERSION="${TARGET_TAG#v}"
if [ "$TARGET_VERSION" = "$CURRENT_VERSION" ]; then
  echo "[OK] Already up to date (v$CURRENT_VERSION)."
  append_ledger "UP_TO_DATE" "$FROM_VERSION" "$TARGET_TAG" "no update needed"
  ensure_cron_tasks
  exit 0
fi

# ── d) Pre-update backup (NEVER deleted; data is never auto-restored) ───────
BACKUP_DIR=""
if [ "$SKIP_BACKUP" -ne 1 ]; then
  STAMP="$(date +%Y%m%d-%H%M%S)"
  if [ -d "$HOME/Desktop" ]; then
    BACKUP_DIR="$HOME/Desktop/MbumahBackups/pre-update/$STAMP"
  else
    BACKUP_DIR="$HOME/MbumahBackups/pre-update/$STAMP"
  fi
  if ! mkdir -p "$BACKUP_DIR"; then
    echo "[FAIL] Could not create the pre-update backup folder."
    append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "pre-update backup failed"
    exit 1
  fi
  if ! cp -f "$DB_FILE" "$BACKUP_DIR/pos-$STAMP.db"; then
    echo "[FAIL] Pre-update backup failed - aborting (nothing was changed)."
    append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "pre-update backup failed"
    exit 1
  fi
  for side in pos.db-wal pos.db-shm; do
    if [ -f "${DB_FILE}-wal" ] && [ "$side" = "pos.db-wal" ]; then
      cp -f "${DB_FILE}-wal" "$BACKUP_DIR/pos.db-wal-$STAMP" || true
    fi
    if [ -f "${DB_FILE}-shm" ] && [ "$side" = "pos.db-shm" ]; then
      cp -f "${DB_FILE}-shm" "$BACKUP_DIR/pos.db-shm-$STAMP" || true
    fi
  done
  [ -f "$ROOT/.env" ] && cp -f "$ROOT/.env" "$BACKUP_DIR/env-$STAMP.bak"
  echo "[OK] Pre-update backup: $BACKUP_DIR"
  append_ledger "BACKUP" "$FROM_VERSION" "$TARGET_TAG" "$BACKUP_DIR"
fi

# ── e) Update the code (git checkout or ZIP overlay) ────────────────────────
append_ledger "UPDATE_START" "$FROM_VERSION" "$TARGET_TAG" "starting code update"
HAS_GIT=0
[ -d "$ROOT/.git" ] && HAS_GIT=1
PREV_REF=""

if [ "$HAS_GIT" -eq 1 ]; then
  # Capture where we are now so a failure can put us back exactly here.
  PREV_REF="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [ -z "$PREV_REF" ] || [ "$PREV_REF" = "HEAD" ]; then
    PREV_REF="$(git rev-parse --short HEAD 2>/dev/null || true)"
  fi
  [ -z "$PREV_REF" ] && PREV_REF="$FROM_VERSION"

  echo "[UPDATE] Fetching releases from GitHub..."
  if ! git fetch origin --tags --force; then
    echo "[FAIL] git fetch failed (no internet?)."
    append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "git fetch failed"
    exit 1
  fi
  # -f discards lockfile drift from npm install; .env is untracked and safe.
  echo "[UPDATE] Checking out $TARGET_TAG..."
  if ! git checkout -f "$TARGET_TAG"; then
    echo "[FAIL] Could not check out $TARGET_TAG."
    append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "git checkout failed"
    exit 1
  fi
else
  echo "[UPDATE] No git folder - downloading $TARGET_TAG as ZIP..."
  SRC="$(download_zip "tags/$TARGET_TAG")"
  if [ -z "$SRC" ]; then
    echo "[FAIL] Download failed (no internet?)."
    append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "zip download failed"
    exit 1
  fi
  if ! overlay_tree "$SRC"; then
    append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "zip copy failed"
    exit 1
  fi
fi

# ── f) Rebuild exactly like the installer ───────────────────────────────────
BUILD_OK=1
run_rebuild || BUILD_OK=0
HEALTHY=0

if [ "$BUILD_OK" -eq 1 ]; then
  # ── g) Restart the app and gate on REAL health (database answering) ──────
  # (the app was already stopped before the rebuild - see run_rebuild)
  if [ "$NOSTART" -eq 1 ]; then
    echo "[RESTART] -NoStart given - the caller (start-pos.sh) starts the new version."
    HEALTHY=1  # no server to gate; the caller health-gates right after start
  else
  echo "[RESTART] Starting the new version (detached, logs in server.log)..."
  start_app
  echo "[RESTART] Waiting for the POS to become ready (up to 60s)..."
  if wait_healthy "$PORT"; then HEALTHY=1; fi
  if [ "$HEALTHY" -eq 1 ]; then
    LIVE_VERSION="$(curl -sf -m 3 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null |
      node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const h=JSON.parse(s);console.log(String(h.version||""));}catch{console.log("")}})' 2>/dev/null)" || LIVE_VERSION=""
    if [ -n "$LIVE_VERSION" ] && [ "$LIVE_VERSION" != "$TARGET_VERSION" ]; then
      echo "[WARN] Server is healthy but reports version $LIVE_VERSION (expected $TARGET_VERSION)."
    fi
  fi
  fi
fi

# ── h) Success, or automatic code rollback ──────────────────────────────────
if [ "$BUILD_OK" -eq 1 ] && [ "$HEALTHY" -eq 1 ]; then
  echo ""
  echo "=============================================================="
  echo "  UPDATE COMPLETE - now running $TARGET_TAG"
  echo "=============================================================="
  [ -n "$BACKUP_DIR" ] && echo "  Pre-update backup kept at: $BACKUP_DIR"
  append_ledger "UPDATE_SUCCESS" "$FROM_VERSION" "$TARGET_TAG" "update installed and healthy"
  ensure_cron_tasks
  exit 0
fi

echo ""
echo "[FAIL] The update did not pass the health check."
append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "buildOk=$BUILD_OK healthy=$HEALTHY"

echo "[ROLLBACK] Going back to the previous version ($PREV_REF)..."
ROLLBACK_OK=0

if [ "$HAS_GIT" -eq 1 ]; then
  if git checkout -f "$PREV_REF"; then ROLLBACK_OK=1; fi
else
  # Re-download the previous version as ZIP (tag first, current branch as fallback)
  PREV_SRC="$(download_zip "tags/v$FROM_VERSION" 2>/dev/null)"
  if [ -z "$PREV_SRC" ]; then PREV_SRC="$(download_zip "heads/main" 2>/dev/null)"; fi
  if [ -n "$PREV_SRC" ] && overlay_tree "$PREV_SRC"; then ROLLBACK_OK=1; fi
fi

if [ "$ROLLBACK_OK" -eq 1 ]; then
  RB_OK=1
  run_rebuild || RB_OK=0
  if [ "$RB_OK" -eq 1 ]; then
    if [ "$NOSTART" -eq 1 ]; then
      echo "[OK] ROLLBACK SUCCESS - previous version restored (caller will start it)."
      append_ledger "ROLLBACK_SUCCESS" "$TARGET_TAG" "v$FROM_VERSION" "restored $PREV_REF (NoStart)"
      exit 1
    fi
    stop_app
    start_app
    if wait_healthy "$PORT"; then
      echo "[OK] ROLLBACK SUCCESS - the previous version is running again."
      append_ledger "ROLLBACK_SUCCESS" "$TARGET_TAG" "v$FROM_VERSION" "restored $PREV_REF"
      [ -n "$BACKUP_DIR" ] && {
        echo ""
        echo "  Your data was backed up before the update: $BACKUP_DIR"
        echo "  Data is NEVER changed by updates - no restore is needed."
      }
      exit 1
    fi
  fi
  echo "[FAIL] ROLLBACK FAILED - the rebuilt previous version is not healthy."
  append_ledger "ROLLBACK_FAILED" "$TARGET_TAG" "v$FROM_VERSION" "rollback rebuild/health failed"
  [ -n "$BACKUP_DIR" ] && echo "  Pre-update backup (data + .env): $BACKUP_DIR"
  echo "  Take a photo of this screen and send it to your developer."
  exit 1
else
  echo "[FAIL] ROLLBACK FAILED - could not restore the previous source."
  append_ledger "ROLLBACK_FAILED" "$TARGET_TAG" "v$FROM_VERSION" "could not restore source"
  [ -n "$BACKUP_DIR" ] && echo "  Pre-update backup (data + .env): $BACKUP_DIR"
  echo "  Take a photo of this screen and send it to your developer."
  exit 1
fi
