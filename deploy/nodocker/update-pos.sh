#!/usr/bin/env bash
# ============================================================================
# MBUMAH HARDWARE POS - Automatic Updater (Linux/macOS, no-Docker laptop)
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
STATE_FILE="$HOME/mbumah-pos-data/update-state.json"

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

# v2.18.0.2: machine-local update state for the script updaters, using the
# same schema as the staged updater's updater/update-state.json
# (src/lib/updater/state.ts). Best effort only - never breaks an update.
ST_FROM="" ST_TO="" ST_CHANNEL="stable" ST_BACKUP="" ST_BUILDLOG="" ST_ROLLBACK=false
ST_STARTED="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
update_state() { # $1=state $2=progress $3=detail $4=error(optional)
  local st="$1" prog="$2" detail="$3" err="${4:-}"
  mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null
  printf '{"currentVersion":"%s","pendingVersion":"%s","state":"%s","progress":%s,"phase":"%s","detail":"%s","startedAt":"%s","updatedAt":"%s","backupPath":"%s","buildLogPath":"%s","verificationLogPath":"","error":"%s","rollbackAvailable":%s,"channel":"%s"}\n' \
    "$(json_escape "$ST_FROM")" "$(json_escape "$ST_TO")" "$(json_escape "$st")" \
    "$prog" "$(json_escape "$st")" "$(json_escape "${detail}${err:+ | $err}")" \
    "$(json_escape "$ST_STARTED")" "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    "$(json_escape "$ST_BACKUP")" "$(json_escape "$ST_BUILDLOG")" "$(json_escape "$err")" \
    "$ST_ROLLBACK" "$(json_escape "$ST_CHANNEL")" > "$STATE_FILE" 2>/dev/null || true
}

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
  # Linux no-docker installs keep standalone output (Docker parity; no
  # NTFS restrictions here). Exported for the WHOLE rebuild so the
  # verify-build-output.mjs child runs in the same mode as the build.
  export BUILD_STANDALONE=1
  update_state installing-dependencies 30 'app stopped, starting rebuild'
  echo "[BUILD 1/4] Installing dependencies (needs internet)..."
  # --include=optional (v2.18.0.1): sharp's platform binary ships as an
  # optional dependency; never let a machine-level npm config skip it.
  if ! npm install --include=optional; then echo "[FAIL] npm install failed"; return 1; fi
  echo "[BUILD 2/4] Applying the database schema..."
  if ! npm run db:push; then echo "[FAIL] db:push failed"; return 1; fi

  # v2.18.0.2: capture the build log so a degraded build is DETECTABLE.
  LOG_DIR="$HOME/mbumah-pos-data/logs"
  mkdir -p "$LOG_DIR" 2>/dev/null
  SAFE_TAG="$(printf '%s' "$TARGET_TAG" | tr -c 'A-Za-z0-9.-' '_')"
  BUILD_LOG="$LOG_DIR/build-${SAFE_TAG}-$(date +%Y%m%d-%H%M%S).log"
  ST_BUILDLOG="$BUILD_LOG"
  update_state building 55 'npm run build running'
  echo "[BUILD 3/4] Building the production app (log: $BUILD_LOG)..."
  if ! npm run build >"$BUILD_LOG" 2>&1; then
    echo "[FAIL] Build failed - last log lines:"
    tail -25 "$BUILD_LOG" 2>/dev/null | sed 's/^/  /'
    return 1
  fi

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
  # v2.18.0.2: prove the build output is COMPLETE before declaring the update
  # successful. On Linux this build IS standalone, so verify-build-output.mjs
  # delegates to the full chunk-level standalone verifier AND scans the build
  # log for trace-copy failures and real build errors.
  echo "[BUILD] Verifying the build output (standalone server, chunks, build log)..."
  update_state verifying-build 70 'verify-build-output running'
  if ! node scripts/verify-build-output.mjs --build-log "$BUILD_LOG"; then
    echo "[FAIL] Build output verification failed - see above."
    return 1
  fi
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

# v2.18.0.1: prefer the four-part correction version from the mbumah metadata
# block (package.json "version" stays three-part semver) so "already up to
# date" matches correction release tags exactly - otherwise a machine on
# v2.18.0.0 (reported as "2.18.0") rebuilds v2.18.0.0 on every start.
CURRENT_VERSION="$(node -p "const p=require('$ROOT/package.json'); (p.mbumah && p.mbumah.releaseVersion) || p.version" 2>/dev/null || echo "")"
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

# -- c) Determine the target release (v2.18.0.2: validated release selection) --
# The old code took GitHub's "releases/latest" verbatim, which returned
# four-part correction tags as if they were the next normal release (the
# field report: a machine on 2.17.7 was updated to v2.18.0.0). The selector
# (scripts/release/select-release.mjs) enforces the release rules instead:
#   stable channel (default)  -> latest valid three-part release only
#   hotfix channel            -> three-part releases plus valid four-part
#                                hotfixes for the CURRENT version's base
#   manual (-ToVersion)       -> explicit tag, still validated (format and
#                                base existence)
# Invalid tags are ignored and REPORTED, never selected. Never downgrades.
if [ -n "$TO_VERSION" ]; then
  SELECT_CHANNEL="manual"
else
  SELECT_CHANNEL="${UPDATE_CHANNEL:-$(get_env_value UPDATE_CHANNEL)}"
  case "$SELECT_CHANNEL" in stable|hotfix|manual) ;; *) SELECT_CHANNEL="stable" ;; esac
fi
ST_CHANNEL="$SELECT_CHANNEL"

GH_TIMEOUT=30; [ "$QUIET" -eq 1 ] && GH_TIMEOUT=10
SELECT_ERR="${TMPDIR:-/tmp}/mbumah-select-release.err"
SELECT_ARGS=(--current "$CURRENT_VERSION" --channel "$SELECT_CHANNEL" --timeout "$GH_TIMEOUT")
[ -n "$TO_VERSION" ] && SELECT_ARGS+=(--to-version "$TO_VERSION")

echo "[INFO] Checking GitHub for releases (channel: $SELECT_CHANNEL)..."
# shellcheck disable=SC2086
DECISION_JSON="$(node scripts/release/select-release.mjs $SELECT_ARGS 2>"$SELECT_ERR")"
SELECT_RC=$?
if [ "$SELECT_RC" -eq 2 ]; then
  # Scheduled tasks must NEVER spam errors - offline is a normal state.
  echo "[WARN] Could not reach GitHub (offline?). Will try again tomorrow."
  append_ledger "CHECK_FAILED" "$FROM_VERSION" "" "release check failed (network)"
  exit 0
fi
if [ -z "$DECISION_JSON" ]; then
  ERR_TEXT="$(tail -3 "$SELECT_ERR" 2>/dev/null | tr '\n' ' ')"
  echo "[WARN] Release check could not complete - skipping this run. $ERR_TEXT"
  append_ledger "CHECK_FAILED" "$FROM_VERSION" "" "selector exit $SELECT_RC $ERR_TEXT"
  exit 0
fi

decision_field() { # $1=json $2=jq-like path via node
  printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s);const p=process.argv[1].split(".");let v=d;for(const k of p){v=v==null?undefined:v[k]}console.log(v==null?"":String(v))}catch{console.log("")}})' "$2" 2>/dev/null
}
DECISION_ACTION="$(decision_field "$DECISION_JSON" "action")"
if [ "$DECISION_ACTION" = "parse-error" ] || [ -z "$DECISION_ACTION" ]; then
  echo "[WARN] Release check returned an unreadable decision - skipping this run."
  append_ledger "CHECK_FAILED" "$FROM_VERSION" "" "selector output unparsable"
  exit 0
fi

# Report ignored invalid tags (e.g. a four-part tag without its three-part base).
printf '%s' "$DECISION_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s);for(const ig of d.ignored||[]){console.log("IGNORED_LINE|"+ig.tag+"|"+ig.reason)}}catch{}})' | while IFS= read -r row; do
  [ -z "$row" ] && continue
  tag="${row#IGNORED_LINE|}"
  reason="${tag#*|}"
  tag="${tag%%|*}"
  echo "[INFO] Ignored invalid release tag: $tag"
  echo "       Reason: $reason"
  append_ledger "TAG_IGNORED" "$FROM_VERSION" "$tag" "$reason"
done

if [ "$DECISION_ACTION" = "up-to-date" ]; then
  echo "[OK] Already up to date (v$CURRENT_VERSION)."
  append_ledger "UP_TO_DATE" "$FROM_VERSION" "$(decision_field "$DECISION_JSON" "selected")" "no update needed"
  ensure_cron_tasks
  update_state idle 0 'up to date'
  exit 0
fi
if [ "$DECISION_ACTION" != "update" ]; then
  echo "[WARN] No valid release available - skipping."
  append_ledger "CHECK_FAILED" "$FROM_VERSION" "" "action=$DECISION_ACTION"
  exit 0
fi

TARGET_TAG="$(decision_field "$DECISION_JSON" "selected")"
DECISION_REASON="$(decision_field "$DECISION_JSON" "reason")"
TARGET_VERSION="${TARGET_TAG#v}"
ST_TO="$TARGET_VERSION"
echo "[INFO] Selected release: $TARGET_TAG"
echo "       $DECISION_REASON"
update_state selected 10 "selected $TARGET_TAG"

# -- c2) Dry run (UPDATE_DRY_RUN=1): report, change nothing -------------------
DRY_RUN=0
[ "${UPDATE_DRY_RUN:-}" = "1" ] && DRY_RUN=1
[ "$(get_env_value UPDATE_DRY_RUN)" = "1" ] && DRY_RUN=1
if [ "$DRY_RUN" -eq 1 ]; then
  HAS_GIT_DRY=0; [ -d "$ROOT/.git" ] && HAS_GIT_DRY=1
  LATEST_STABLE="$(decision_field "$DECISION_JSON" "latestStable")"; [ -z "$LATEST_STABLE" ] && LATEST_STABLE="none found"
  LATEST_HF="$(decision_field "$DECISION_JSON" "latestHotfixForBase")"; [ -z "$LATEST_HF" ] && LATEST_HF="none for this base"
  echo ""
  echo "UPDATE DRY RUN (UPDATE_DRY_RUN=1) - nothing will be changed."
  echo "Current version: $CURRENT_VERSION"
  echo "Latest valid stable release: $LATEST_STABLE"
  echo "Latest valid hotfix for current base: $LATEST_HF"
  echo "Selected release: $TARGET_TAG"
  echo "Reason: $DECISION_REASON"
  if [ "$HAS_GIT_DRY" -eq 1 ]; then
    echo "Would download: git fetch + git checkout $TARGET_TAG"
  else
    echo "Would download: https://codeload.github.com/${REPO_SLUG}/zip/refs/tags/$TARGET_TAG"
  fi
  echo "Would stop POS: no, because dry run"
  append_ledger "DRY_RUN" "$FROM_VERSION" "$TARGET_TAG" "dry run only, nothing was changed"
  update_state idle 0 'dry run completed, nothing changed'
  exit 0
fi

# ── d) Pre-build checks + pre-update backup (data is never auto-restored) ────
# v2.18.0.2: cheap safety checks BEFORE anything is downloaded or stopped.
PREBUILD_FAIL=""
FREE_KB="$(df -k "$ROOT" 2>/dev/null | tail -1 | awk '{print $4}')"
if [ -n "$FREE_KB" ] && [ "$FREE_KB" -lt 2097152 ] 2>/dev/null; then
  echo "[FAIL] Less than 2 GB of free disk space - an update needs about 2 GB. Free up space and run the update again."
  PREBUILD_FAIL="disk"
elif [ -n "$FREE_KB" ] && [ "$FREE_KB" -lt 5242880 ] 2>/dev/null; then
  echo "[WARN] Less than 5 GB of free disk space - the update can run, but consider freeing space."
fi
if [ -z "$PREBUILD_FAIL" ] && [ ! -w "$DB_FILE" ]; then
  echo "[FAIL] The database file is not writable (is another program holding it open?)."
  PREBUILD_FAIL="db"
fi
case "$ROOT" in
  */Downloads/*|*/Compressed/*|*OneDrive*)
    echo "[WARN] The POS is installed inside a Downloads, Compressed or OneDrive folder."
    echo "       These folders can lock files during updates. Consider moving the app to"
    echo "       /opt/mbumah-pos (or another stable folder) and running the installer there."
    ;;
esac
if [ -n "$PREBUILD_FAIL" ]; then
  append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "pre-build checks failed ($PREBUILD_FAIL)"
  ST_ROLLBACK=false
  update_state failed 10 "pre-build checks failed ($PREBUILD_FAIL)"
  exit 1
fi

BACKUP_DIR=""
if [ "$SKIP_BACKUP" -ne 1 ]; then
  update_state backing-up 15 'creating the pre-update backup'
  STAMP="$(date +%Y%m%d-%H%M%S)"
  if [ -d "$HOME/Desktop" ]; then
    BACKUP_DIR="$HOME/Desktop/MbumahBackups/pre-update/$STAMP"
  else
    BACKUP_DIR="$HOME/MbumahBackups/pre-update/$STAMP"
  fi
  if ! mkdir -p "$BACKUP_DIR"; then
    echo "[FAIL] Could not create the pre-update backup folder."
    append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "pre-update backup failed"
    update_state failed 15 'could not create the backup folder'
    exit 1
  fi
  if ! cp -f "$DB_FILE" "$BACKUP_DIR/pos-$STAMP.db"; then
    echo "[FAIL] Pre-update backup failed - aborting (nothing was changed)."
    append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "pre-update backup failed"
    update_state failed 15 'pre-update backup failed'
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
  ST_BACKUP="$BACKUP_DIR"
fi

# ── e) Update the code (git checkout or ZIP overlay) ────────────────────────
append_ledger "UPDATE_START" "$FROM_VERSION" "$TARGET_TAG" "starting code update"
HAS_GIT=0
[ -d "$ROOT/.git" ] && HAS_GIT=1
PREV_REF=""

if [ "$HAS_GIT" -eq 1 ]; then
  update_state downloading 20 'fetching the release from GitHub'
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
    update_state failed 20 'git fetch failed'
    exit 1
  fi
  update_state extracting 25 "checking out $TARGET_TAG"
  # -f discards lockfile drift from npm install; .env is untracked and safe.
  echo "[UPDATE] Checking out $TARGET_TAG..."
  if ! git checkout -f "$TARGET_TAG"; then
    echo "[FAIL] Could not check out $TARGET_TAG."
    append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "git checkout failed"
    update_state failed 25 "git checkout $TARGET_TAG failed"
    exit 1
  fi
else
  update_state downloading 20 "downloading $TARGET_TAG as ZIP"
  echo "[UPDATE] No git folder - downloading $TARGET_TAG as ZIP..."
  SRC="$(download_zip "tags/$TARGET_TAG")"
  if [ -z "$SRC" ]; then
    echo "[FAIL] Download failed (no internet?)."
    append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "zip download failed"
    update_state failed 20 'zip download failed'
    exit 1
  fi
  update_state extracting 25 'copying the new source over the app folder'
  if ! overlay_tree "$SRC"; then
    append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "zip copy failed"
    update_state failed 25 'zip copy failed'
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
  update_state activating 85 'starting the new version'
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
  update_state activated 100 "now running $TARGET_TAG"
  ensure_cron_tasks
  exit 0
fi

echo ""
echo "[FAIL] The update did not pass the health check."
append_ledger "UPDATE_FAILED" "$FROM_VERSION" "$TARGET_TAG" "buildOk=$BUILD_OK healthy=$HEALTHY"
ST_ROLLBACK=true
update_state failed 90 "update failed (buildOk=$BUILD_OK healthy=$HEALTHY) - rolling back"

echo ""
echo "Update could not be completed."
echo "The previous version is still available and will be started now."

echo "[ROLLBACK] Going back to the previous version ($PREV_REF)..."
update_state rolled-back 80 "restoring $PREV_REF"
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
      update_state rolled-back 100 "previous version $PREV_REF is running again"
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
  update_state failed 100 'rollback rebuild/health failed'

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
