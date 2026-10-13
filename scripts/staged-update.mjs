#!/usr/bin/env node
// ============================================================================
// MBUMAH HARDWARE POS - Staged update orchestrator (v2.17.9)
// ============================================================================
// Self-hosted staged updates for the no-Docker deployments (Windows laptop,
// LAN server). One detached run performs, in order:
//
//   checking     validate the request and resolve the artifact source
//   downloading  fetch (https) or copy the artifact into updater/staging
//   preflight    rehearse the schema change on a throwaway DB copy
//                (scripts/preflight-schema.mjs - the live DB is not touched)
//   backing-up   verified backup of the live database (scripts/backup-db.mjs)
//   installing   extract the release; swap the install dir when configured
//   activating   hand the new release to the runtime
//   smoke test   poll the health endpoint until it reports healthy
//
// Any failure after the backup step rolls the previous install directory and
// the database back automatically; failures before the backup step leave the
// system untouched. Progress is published to updater/update-state.json so
// GET /api/update/status can show it (schema mirrors src/lib/updater/state.ts).
//
// NOT usable on Vercel serverless: it needs filesystem and process control.
// It refuses (exit code 2) when process.env.VERCEL === '1'.
//
// Safety contract:
//   - never runs destructive SQL (no DROP / DELETE statements anywhere);
//   - never writes secrets to the state file (error text is path-sanitized);
//   - bounded runtime (step timeouts plus a bounded smoke loop).
//
// Usage:
//   node scripts/staged-update.mjs --target-version 2.17.9 \
//        --artifact-url https://example.com/mbumah-2.17.9.tar.gz
//   node scripts/staged-update.mjs --target-version 2.17.9 \
//        --artifact-path /path/to/mbumah-2.17.9.tar.gz
//
// Environment:
//   MBUMAH_INSTALL_DIR  release directory to swap (default: staging only)
//   MBUMAH_HEALTH_URL   smoke test URL (default http://localhost:3000/api/health)
//
// Exit codes: 0 = update complete and healthy, 1 = failed (rolled back),
//             2 = refused (unsupported environment or invalid usage).
// ============================================================================
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = process.cwd();

// -- .env WINS over inherited environment (same rule as backup-db.mjs) -------
const envPath = join(ROOT, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

// ---------------------------------------------------------------------------
// State file helpers. These MIRROR src/lib/updater/state.ts (same JSON
// schema, same sanitization, atomic tmp+rename writes, defaults on any read
// error) so the API route and this script always agree on the file format.
// ---------------------------------------------------------------------------
const ACTIVE_PHASES = new Set([
  'checking',
  'downloading',
  'preflight',
  'backing-up',
  'installing',
  'activating',
  'rolling-back',
]);
const KNOWN_PHASES = new Set([...ACTIVE_PHASES, 'idle', 'done', 'failed']);
const DEFAULT_STATE = {
  phase: 'idle',
  percent: 0,
  message: '',
  targetVersion: null,
  startedAt: null,
  updatedAt: null,
  error: null,
  pid: null,
};

function stateFilePath() {
  return join(ROOT, 'updater', 'update-state.json');
}

function sanitizeError(text) {
  return String(text)
    .replace(/\/(?:home|Users|var|tmp)(?:\/[^\s"'`,;)\]}]*)?/g, '[path]')
    .replace(/\b[A-Za-z]:\\[^\s"'`,;)\]}]*/g, '[path]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

function readState() {
  try {
    const parsed = JSON.parse(readFileSync(stateFilePath(), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_STATE };
    }
    return {
      phase: typeof parsed.phase === 'string' && KNOWN_PHASES.has(parsed.phase) ? parsed.phase : 'idle',
      percent: typeof parsed.percent === 'number' && Number.isFinite(parsed.percent)
        ? Math.min(100, Math.max(0, parsed.percent))
        : 0,
      message: typeof parsed.message === 'string' ? parsed.message : '',
      targetVersion: typeof parsed.targetVersion === 'string' && parsed.targetVersion.length > 0
        ? parsed.targetVersion
        : null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
      error: typeof parsed.error === 'string' && parsed.error.length > 0 ? sanitizeError(parsed.error) : null,
      pid: typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) ? parsed.pid : null,
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function writeState(partial) {
  const previous = readState();
  const nextPhase = partial.phase ?? previous.phase;
  const next = {
    phase: nextPhase,
    percent: partial.percent !== undefined && Number.isFinite(partial.percent)
      ? Math.min(100, Math.max(0, partial.percent))
      : previous.percent,
    message: partial.message ?? previous.message,
    targetVersion: partial.targetVersion !== undefined ? partial.targetVersion : previous.targetVersion,
    startedAt: previous.phase === 'idle' && ACTIVE_PHASES.has(nextPhase)
      ? new Date().toISOString()
      : (partial.startedAt !== undefined ? partial.startedAt : previous.startedAt),
    updatedAt: new Date().toISOString(),
    error: partial.error === null
      ? null
      : (partial.error !== undefined ? sanitizeError(partial.error) : previous.error),
    pid: partial.pid !== undefined ? partial.pid : previous.pid,
  };
  try {
    mkdirSync(join(ROOT, 'updater'), { recursive: true });
    const tmpPath = `${stateFilePath()}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, stateFilePath());
  } catch (writeError) {
    console.error('[update] Could not persist update state:', writeError instanceof Error ? writeError.message : writeError);
  }
  return next;
}

// -- Bounded runtime constants -----------------------------------------------
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000; // artifact fetch upper bound
const STEP_TIMEOUT_MS = 10 * 60 * 1000;     // preflight / backup upper bound
const EXTRACT_TIMEOUT_MS = 5 * 60 * 1000;   // tar extraction upper bound
const SMOKE_ATTEMPTS = 12;
const SMOKE_INTERVAL_MS = 5000;
const SMOKE_FETCH_TIMEOUT_MS = 4000;

// -- CLI ----------------------------------------------------------------------
function usage() {
  console.log('Usage: node scripts/staged-update.mjs --target-version <version> (--artifact-url <https url> | --artifact-path <local path>)');
  console.log('Environment: MBUMAH_INSTALL_DIR (release dir to swap), MBUMAH_HEALTH_URL (default http://localhost:3000/api/health)');
}

function parseArgs(argv) {
  const args = { artifactUrl: '', artifactPath: '', targetVersion: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--artifact-url') args.artifactUrl = argv[++i] ?? '';
    else if (arg === '--artifact-path') args.artifactPath = argv[++i] ?? '';
    else if (arg === '--target-version') args.targetVersion = argv[++i] ?? '';
  }
  return args;
}

// -- Database path resolution (mirror of backup-db.mjs logic, read only) -----
function sqliteLiveDbPath() {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl.startsWith('file:')) return null;
  let dbFile = databaseUrl.slice('file:'.length);
  if (!dbFile) return null;
  if (!dbFile.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(dbFile)) {
    dbFile = join(ROOT, dbFile);
  }
  return resolve(dbFile);
}

async function main() {
  // -- Refusal: serverless has no filesystem or process control --------------
  if (process.env.VERCEL === '1') {
    console.error('[update] Refused: staged updates run on self-hosted deployments only (Vercel serverless detected).');
    process.exit(2);
  }

  const args = parseArgs(process.argv.slice(2));
  const targetVersion = args.targetVersion.slice(0, 64);
  const hasArtifact = Boolean(args.artifactUrl || args.artifactPath);

  if (!targetVersion || !hasArtifact) {
    console.error('[update] Refused: an artifact source (--artifact-url or --artifact-path) and --target-version are required.');
    usage();
    writeState({
      phase: 'failed',
      error: 'Update request incomplete: an artifact source and a target version are required.',
      message: 'Update request rejected',
    });
    process.exit(1);
  }
  if (args.artifactUrl && !args.artifactUrl.startsWith('https://')) {
    console.error('[update] Refused: --artifact-url must be an https:// URL (use --artifact-path for local files).');
    usage();
    writeState({
      phase: 'failed',
      error: 'Update request rejected: artifactUrl must be an https:// URL.',
      message: 'Update request rejected',
    });
    process.exit(1);
  }

  const healthUrl = process.env.MBUMAH_HEALTH_URL || 'http://localhost:3000/api/health';
  const installDirEnv = process.env.MBUMAH_INSTALL_DIR ? resolve(process.env.MBUMAH_INSTALL_DIR) : '';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const stagingDir = join(ROOT, 'updater', 'staging', stamp);

  // Bookkeeping for the rollback path (populated as the run advances).
  let backupDone = false;
  let backupPath = null;
  let swappedFrom = null;   // previous install dir (moved aside)
  let swappedTo = null;     // install dir the new release was moved into
  let currentPercent = 2;

  // Exit 0 (done) / 1 (failed) are decided below; the failure helper keeps
  // the rollback contract in one place.
  const fail = (message, detail = '') => {
    console.error(`[FAIL] ${message}${detail ? ` ${detail}` : ''}`);
    if (!backupDone) {
      // Nothing durable was touched yet: report and stop.
      writeState({
        phase: 'failed',
        percent: currentPercent,
        message: 'Update failed',
        error: detail ? `${message}: ${detail}` : message,
      });
      process.exit(1);
    }
    // Rollback: restore the previous install directory if it was swapped,
    // then restore the database from the backup this run created.
    writeState({
      phase: 'rolling-back',
      percent: currentPercent,
      message: 'Restoring the previous version',
      error: detail ? `${message}: ${detail}` : message,
    });
    if (swappedFrom && swappedTo) {
      try {
        rmSync(swappedTo, { recursive: true, force: true });
        renameSync(swappedFrom, swappedTo);
        console.log('[ROLLBACK] Previous install directory restored.');
      } catch (restoreError) {
        console.error('[FAIL] Could not restore the previous install directory:', restoreError instanceof Error ? restoreError.message : restoreError);
      }
    }
    // Database restore: only when THIS run produced a backup file and the
    // configured database is a local SQLite file. The copy is a plain file
    // copy, never SQL.
    const liveDb = sqliteLiveDbPath();
    if (backupPath && liveDb && existsSync(backupPath)) {
      try {
        copyFileSync(backupPath, liveDb);
        // Stale WAL/SHM sidecars from the crashed session would be replayed
        // over the restored file, so remove them after the copy.
        for (const sidecar of [`${liveDb}-wal`, `${liveDb}-shm`]) {
          if (existsSync(sidecar)) rmSync(sidecar, { force: true });
        }
        console.log('[ROLLBACK] Database restored from the backup created this run.');
      } catch (dbRestoreError) {
        console.error('[FAIL] Could not restore the database from the backup:', dbRestoreError instanceof Error ? dbRestoreError.message : dbRestoreError);
      }
    } else if (backupPath) {
      console.log('[ROLLBACK] Automatic database restore skipped (not a local SQLite file). Use the backup recorded in the update state.');
    }
    writeState({
      phase: 'failed',
      percent: currentPercent,
      message: 'Update failed and was rolled back',
      error: detail ? `${message}: ${detail}` : message,
    });
    process.exit(1);
  };

  // -- checking ---------------------------------------------------------------
  console.log(`[INFO] Staged update to v${targetVersion} starting (health gate: ${healthUrl}).`);
  writeState({ phase: 'checking', percent: 2, message: 'Checking update request', targetVersion, pid: process.pid });
  currentPercent = 2;
  mkdirSync(stagingDir, { recursive: true });

  // -- downloading ------------------------------------------------------------
  console.log('[INFO] Downloading the release artifact...');
  writeState({ phase: 'downloading', percent: 10, message: 'Downloading the release artifact' });
  currentPercent = 10;
  // stagedArtifact is either a .tar.gz file (fetched or copied into staging)
  // or a local release directory passed with --artifact-path.
  let stagedArtifact = '';
  if (args.artifactUrl) {
    const artifactFile = join(stagingDir, 'artifact.tar.gz');
    try {
      const response = await fetch(args.artifactUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      if (!response.ok) fail('Artifact download failed', `HTTP ${response.status}.`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) fail('Artifact download failed', 'the response was empty.');
      writeFileSync(artifactFile, buffer);
    } catch (downloadError) {
      fail('Artifact download failed', downloadError instanceof Error ? downloadError.message : String(downloadError));
    }
    stagedArtifact = artifactFile;
  } else {
    stagedArtifact = resolve(args.artifactPath);
    if (!existsSync(stagedArtifact)) fail('Artifact not found', 'the --artifact-path does not exist.');
    if (statSync(stagedArtifact).isFile()) {
      // Copy file artifacts into staging so the run is self-contained.
      const artifactFile = join(stagingDir, 'artifact.tar.gz');
      try {
        copyFileSync(stagedArtifact, artifactFile);
        stagedArtifact = artifactFile;
      } catch (copyError) {
        fail('Artifact copy failed', copyError instanceof Error ? copyError.message : String(copyError));
      }
    }
  }
  const artifactStat = statSync(stagedArtifact);
  if (artifactStat.isDirectory()) {
    if (readdirSync(stagedArtifact).length === 0) {
      fail('Artifact verification failed', 'the release directory is empty.');
    }
  } else if (artifactStat.size === 0) {
    fail('Artifact verification failed', 'the staged file is empty.');
  }
  console.log(`[OK] Artifact staged (${artifactStat.isDirectory() ? 'release directory' : `${Math.round(artifactStat.size / 1024)} KB`}).`);
  writeState({ phase: 'downloading', percent: 40, message: 'Release artifact staged' });
  currentPercent = 40;

  // -- preflight (schema rehearsal on a throwaway copy) ------------------------
  console.log('[INFO] Schema preflight: rehearsing the update on a copy of the database...');
  writeState({ phase: 'preflight', percent: 55, message: 'Rehearsing the schema update on a copy' });
  currentPercent = 55;
  const preflight = spawnSync(process.execPath, [join(ROOT, 'scripts', 'preflight-schema.mjs')], {
    stdio: 'inherit',
    timeout: STEP_TIMEOUT_MS,
  });
  if (preflight.error) fail('Schema preflight could not run', preflight.error.message);
  if (preflight.status !== 0) fail('Schema preflight failed', 'the schema change was not safe to apply.');

  // -- backing-up ---------------------------------------------------------------
  console.log('[INFO] Backing up the database...');
  writeState({ phase: 'backing-up', percent: 65, message: 'Backing up the database' });
  currentPercent = 65;
  const backup = spawnSync(process.execPath, [join(ROOT, 'scripts', 'backup-db.mjs')], {
    encoding: 'utf8',
    timeout: STEP_TIMEOUT_MS,
  });
  if (backup.error) fail('Database backup could not run', backup.error.message);
  if (backup.status !== 0) fail('Database backup failed', 'the update was stopped before anything changed.');
  // scripts/backup-db.mjs prints several lines; the backup path is on the
  // labeled "  backup : <path>" line. Fall back to the last printed line when
  // it happens to be an existing file (the tooling may change its format).
  const backupLines = String(backup.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const labeled = [...backupLines].reverse().find((l) => /^backup\s*:\s*.+/.test(l));
  if (labeled) {
    backupPath = labeled.replace(/^backup\s*:\s*/, '');
  } else {
    const lastLine = backupLines[backupLines.length - 1];
    backupPath = lastLine && existsSync(lastLine) ? lastLine : null;
  }
  backupDone = true;
  console.log(`[OK] Database backup ready${backupPath ? `: ${backupPath}` : ''}.`);

  // -- installing ---------------------------------------------------------------
  console.log('[INFO] Installing the new release...');
  writeState({ phase: 'installing', percent: 85, message: 'Installing the new release' });
  currentPercent = 85;
  let releaseDir = '';
  if (statSync(stagedArtifact).isDirectory()) {
    releaseDir = stagedArtifact;
  } else if (/\.t(?:ar\.)?gz$/.test(stagedArtifact)) {
    const extractDir = join(stagingDir, 'release');
    mkdirSync(extractDir, { recursive: true });
    const tar = spawnSync('tar', ['-xzf', stagedArtifact, '-C', extractDir], { timeout: EXTRACT_TIMEOUT_MS });
    if (tar.error || tar.status !== 0) {
      fail('Artifact extraction failed', tar.error ? tar.error.message : `tar exited with ${tar.status}.`);
    }
    // GitHub-style archives wrap the tree in a single top-level folder.
    const entries = readdirSync(extractDir);
    releaseDir = entries.length === 1 && statSync(join(extractDir, entries[0])).isDirectory()
      ? join(extractDir, entries[0])
      : extractDir;
  } else {
    fail('Unsupported artifact format', 'expected a .tar.gz archive or a release directory.');
  }
  if (!existsSync(join(releaseDir, 'package.json'))) {
    fail('The artifact does not look like a Mbumah release', 'package.json is missing.');
  }

  if (installDirEnv) {
    const previousDir = `${installDirEnv}.previous-${stamp}`;
    try {
      renameSync(installDirEnv, previousDir);
      swappedFrom = previousDir;
      swappedTo = installDirEnv;
      renameSync(releaseDir, installDirEnv);
      console.log(`[OK] Release installed: ${installDirEnv} (previous kept at ${previousDir}).`);
    } catch (swapError) {
      fail('Install directory swap failed', swapError instanceof Error ? swapError.message : String(swapError));
    }
  } else {
    console.log('[INFO] MBUMAH_INSTALL_DIR is not set - the release is staged and verified in updater/staging (in-place overlay installs are handled by deploy/nodocker/update-pos).');
  }

  // -- activating + smoke test ---------------------------------------------------
  writeState({ phase: 'activating', percent: 92, message: 'Activating the new release' });
  currentPercent = 92;
  console.log('[INFO] Waiting for the health endpoint to report healthy...');
  for (let attempt = 1; attempt <= SMOKE_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(healthUrl, { cache: 'no-store', signal: AbortSignal.timeout(SMOKE_FETCH_TIMEOUT_MS) });
      const body = await response.json();
      if (body && body.status === 'healthy') {
        writeState({ phase: 'done', percent: 100, message: `Update to v${targetVersion} complete`, targetVersion, error: null });
        console.log(`[OK] Staged update to v${targetVersion} complete - system healthy.`);
        process.exit(0);
      }
      console.log(`[INFO] Health check ${attempt}/${SMOKE_ATTEMPTS}: ${body && body.status ? body.status : 'no status'} - retrying...`);
    } catch {
      console.log(`[INFO] Health check ${attempt}/${SMOKE_ATTEMPTS}: unreachable - retrying...`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, SMOKE_INTERVAL_MS));
  }
  fail('Smoke test failed', `the health endpoint did not report healthy after ${SMOKE_ATTEMPTS} attempts.`);
}

main().catch((unexpected) => {
  console.error('[FAIL] Staged update crashed:', unexpected instanceof Error ? unexpected.message : unexpected);
  writeState({
    phase: 'failed',
    message: 'Update failed',
    error: `Staged update crashed: ${unexpected instanceof Error ? unexpected.message : String(unexpected)}`,
  });
  process.exit(1);
});
