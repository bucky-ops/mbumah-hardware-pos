// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Crash-Triggered Database Backup Hook (SRV-2, v2.9.0)
// ─────────────────────────────────────────────────────────────────────────────
//
// Last-ditch data-protection net: when the Node process hits an
// `uncaughtException` or an `unhandledRejection`, we snapshot the database to
// disk BEFORE anything else can go wrong, append an honest audit line, and
// file a CRITICAL SystemLog entry (best-effort — the DB itself may be what
// crashed).
//
// ## Exit semantics (deliberate, availability-first)
//
//   • uncaughtException  → backup → log → `process.exit(1)`.
//     A crash must keep behaving like a crash (non-zero exit so process
//     managers — Vercel, Task Scheduler, nodemon — restart the server and
//     health checks page Sam). We only buy the backup before dying.
//
//   • unhandledRejection → backup → log → DO NOT exit.
//     An unhandled rejection no longer takes Node down by default (Node ≥15
//     changed the default to crash, but Next.js keeps serving and Sentry
//     already captures the event). Restarting the whole POS over a stray
//     rejected promise would hurt an in-operation shop more than the
//     rejection itself. We snapshot + record, and the server stays up.
//     Re-arming is safe: the throttle below prevents backup floods when a
//     hot loop rejects repeatedly.
//
// ## Backup strategy (chosen by DATABASE_URL)
//
//   • `file:` (SQLite — laptop kits) → atomic-ish file copy of the DB file
//     plus its `-wal` / `-shm` sidecars when they exist (fs.copyFileSync —
//     synchronous, so it completes even as the process is dying).
//   • postgres (cloud/Neon) → `pg_dump` via spawnSync (60 s timeout), stdout
//     captured to `pg_dump.sql`. On Vercel serverless pg_dump does not exist
//     and the filesystem is ephemeral — that failure is RECORDED HONESTLY in
//     the JSONL log and SystemLog (never faked as success). Neon PITR is the
//     cloud disaster-recovery path; this hook is the laptop-kit lifeline.
//
// ## Never throw
//
//   Every step is individually try/caught and the whole hook is wrapped in a
//   top-level catch. The backup code must NEVER be the thing that turns a
//   recoverable rejection into a fatal crash. Failures surface as
//   `console.error('[CRASH-BACKUP] …')` lines and honest `error` fields.
//
// ## Throttle
//
//   At most one crash backup per 5 minutes per process (a rejection storm or
//   a crash-looping process must not fill the disk with snapshots).
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

import { systemLog } from '@/lib/logger';
import { LogSeverity } from '@/lib/types';

// ── Types ────────────────────────────────────────────────────────────────────

type CrashTrigger = 'uncaughtException' | 'unhandledRejection';

interface CrashBackupResult {
  ok: boolean;
  kind: string;
  /** Primary artifact (directory for sqlite copies, .sql file for pg_dump). */
  path: string | null;
  error?: string;
}

interface CrashBackupLogLine {
  timestamp: string;
  trigger: CrashTrigger;
  kind: string;
  path: string | null;
  error?: string;
  durationMs: number;
}

// ── Module state ─────────────────────────────────────────────────────────────

/** Primary double-registration guard (per module instance). */
let installed = false;

/**
 * Defense-in-depth guard across dev-HMR module re-evaluation: the flag is
 * stashed on globalThis so a hot-reloaded copy of this module cannot register
 * a second pair of listeners on the same process.
 */
const INSTALLED_FLAG = Symbol.for('mbumah.crashBackup.installed');

/** Timestamp of the last crash backup this process performed (throttle). */
let lastCrashBackupAt = 0;

const THROTTLE_MS = 5 * 60 * 1000;
const SYSTEMLOG_BUDGET_MS = 3000; // never let a hung DB stall the exit path

// ── Helpers ──────────────────────────────────────────────────────────────────

/** `20260212-231505`-style local-time stamp for backup directories. */
function formatStamp(date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

/**
 * Resolve the crash-backup directory (WITHOUT creating it):
 *   1. `BACKUP_DIR` env override when set.
 *   2. Windows: `<Desktop>/MbumahBackups/crash` — a place Sam can find.
 *   3. Everywhere else: `<os.tmpdir()>/mbumah-backups/crash`.
 */
function resolveCrashBackupDir(): string {
  const configured = process.env.BACKUP_DIR?.trim();
  if (configured) return path.join(configured, 'crash');

  if (process.platform === 'win32') {
    return path.join(os.homedir(), 'Desktop', 'MbumahBackups', 'crash');
  }
  return path.join(os.tmpdir(), 'mbumah-backups', 'crash');
}

/** Ensure a directory exists (recursive). Returns null when creation fails. */
function ensureDir(dir: string): string | null {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (error) {
    console.error(
      '[CRASH-BACKUP] Could not create backup directory:',
      dir,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Resolve the SQLite database file from a `file:` DATABASE_URL.
 * Prisma resolves relative `file:` URLs against the schema.prisma directory,
 * which we cannot know from here — so try the plausible candidates in order
 * and use the first that actually exists.
 */
function resolveSqliteFile(databaseUrl: string): string | null {
  const raw = databaseUrl.slice('file:'.length).trim();
  if (!raw) return null;

  const candidates: string[] = [];
  if (path.isAbsolute(raw)) {
    candidates.push(raw);
  } else {
    // `file:./prisma/dev.db` relative to the project root…
    candidates.push(path.resolve(process.cwd(), raw));
    // …and `file:./dev.db` relative to the schema directory.
    candidates.push(path.resolve(process.cwd(), 'prisma', raw));
    candidates.push(path.resolve(process.cwd(), raw.replace(/^\.\//, '')));
  }

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      /* existence probe failed — try the next candidate */
    }
  }
  return null;
}

// ── Backup strategies ────────────────────────────────────────────────────────

/** SQLite: copy the db file + `-wal`/`-shm` sidecars into `<stamp>/`. */
function sqliteFileCopyBackup(
  backupDir: string,
  stamp: string,
  databaseUrl: string,
): CrashBackupResult {
  try {
    const dbFile = resolveSqliteFile(databaseUrl);
    if (!dbFile) {
      return {
        ok: false,
        kind: 'sqlite-file-copy',
        path: null,
        error: `SQLite file not found for ${databaseUrl} (checked cwd and prisma/ candidates)`,
      };
    }

    const targetDir = path.join(backupDir, stamp);
    if (!ensureDir(targetDir)) {
      return {
        ok: false,
        kind: 'sqlite-file-copy',
        path: null,
        error: `Could not create backup directory ${targetDir}`,
      };
    }

    const copied: string[] = [];
    const parts = [dbFile, `${dbFile}-wal`, `${dbFile}-shm`];
    for (const part of parts) {
      try {
        if (!fs.existsSync(part)) continue; // sidecars are optional
        const target = path.join(targetDir, path.basename(part));
        fs.copyFileSync(part, target);
        copied.push(path.basename(part));
      } catch (error) {
        // A failed sidecar copy should not abort the main-file copy.
        console.error(
          '[CRASH-BACKUP] Failed to copy',
          part,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    if (copied.length === 0) {
      return {
        ok: false,
        kind: 'sqlite-file-copy',
        path: targetDir,
        error: 'No database files could be copied',
      };
    }

    return { ok: true, kind: 'sqlite-file-copy', path: targetDir };
  } catch (error) {
    return {
      ok: false,
      kind: 'sqlite-file-copy',
      path: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Postgres: `pg_dump` stdout → `<stamp>/pg_dump.sql` (60 s timeout). */
function pgDumpBackup(
  backupDir: string,
  stamp: string,
  databaseUrl: string,
): CrashBackupResult {
  const targetDir = path.join(backupDir, stamp);
  const sqlFile = path.join(targetDir, 'pg_dump.sql');

  try {
    if (!ensureDir(targetDir)) {
      return {
        ok: false,
        kind: 'pg_dump',
        path: null,
        error: `Could not create backup directory ${targetDir}`,
      };
    }

    const result = spawnSync('pg_dump', [databaseUrl], {
      timeout: 60_000,
      encoding: 'utf8',
      // Captured dumps are bounded by maxBuffer; 256 MB covers any realistic
      // Mbumah dataset. Larger dumps are a Neon-PITR concern, not ours.
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
    });

    if (result.error) {
      // ENOENT here is EXPECTED on Vercel serverless (no pg_dump binary) and
      // on laptop kits without the Postgres client tools — record honestly.
      return {
        ok: false,
        kind: 'pg_dump',
        path: null,
        error: `pg_dump could not be executed: ${result.error.message}`,
      };
    }

    if (result.status !== 0) {
      const stderr = (result.stderr ?? '').trim().slice(0, 500);
      return {
        ok: false,
        kind: 'pg_dump',
        path: null,
        error: `pg_dump exited with status ${result.status}${stderr ? `: ${stderr}` : ''}`,
      };
    }

    if (!result.stdout || result.stdout.length === 0) {
      return {
        ok: false,
        kind: 'pg_dump',
        path: null,
        error: 'pg_dump exited 0 but produced no output',
      };
    }

    fs.writeFileSync(sqlFile, result.stdout, 'utf8');
    return { ok: true, kind: 'pg_dump', path: sqlFile };
  } catch (error) {
    return {
      ok: false,
      kind: 'pg_dump',
      path: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Append one JSON line to `<backupDir>/backup-log.jsonl`. Never throws. */
function appendBackupLogLine(
  backupDir: string,
  line: CrashBackupLogLine,
): void {
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    fs.appendFileSync(
      path.join(backupDir, 'backup-log.jsonl'),
      `${JSON.stringify(line)}\n`,
      'utf8',
    );
  } catch (error) {
    console.error(
      '[CRASH-BACKUP] Could not append to backup-log.jsonl:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Best-effort SystemLog entry. The DB may be the thing that crashed — the
 * call is raced against a 3-second budget and every failure mode is caught
 * (systemLog itself is also internally defensive).
 */
async function bestEffortSystemLog(
  trigger: CrashTrigger,
  result: CrashBackupResult,
  durationMs: number,
  error?: unknown,
): Promise<void> {
  try {
    const crashMessage =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? '');

    await Promise.race([
      systemLog({
        action: 'CRASH_BACKUP',
        component: 'SYSTEM',
        severity: LogSeverity.CRITICAL,
        message: [
          `Crash backup (${result.kind}) ${result.ok ? 'succeeded' : 'FAILED'} after ${trigger}.`,
          crashMessage ? `Crash: ${crashMessage}` : '',
          result.error ? `Backup error: ${result.error}` : '',
        ]
          .filter(Boolean)
          .join(' '),
        metadata: {
          trigger,
          kind: result.kind,
          path: result.path,
          backupOk: result.ok,
          backupError: result.error,
          durationMs,
        },
      }),
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SYSTEMLOG_BUDGET_MS);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } catch (error) {
    console.error(
      '[CRASH-BACKUP] SystemLog entry failed:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ── Core: perform the crash backup ───────────────────────────────────────────

/**
 * Run the full crash-backup sequence. NEVER throws — every step is guarded.
 * Returns nothing on purpose; callers cannot usefully react.
 */
async function runCrashBackup(
  trigger: CrashTrigger,
  crashError: unknown,
): Promise<void> {
  const startedAt = Date.now();

  // ── Throttle: at most one crash backup per 5 minutes ──────────────────────
  if (Date.now() - lastCrashBackupAt < THROTTLE_MS) {
    console.error(
      '[CRASH-BACKUP] Throttled — a crash backup ran less than 5 minutes ago; skipping',
      trigger,
    );
    return;
  }
  lastCrashBackupAt = Date.now();

  // ── Resolve backup dir (mkdir on demand) ──────────────────────────────────
  let backupDir: string | null = null;
  try {
    backupDir = ensureDir(resolveCrashBackupDir());
  } catch (error) {
    console.error(
      '[CRASH-BACKUP] Backup dir resolution failed:',
      error instanceof Error ? error.message : String(error),
    );
  }

  // ── Choose strategy + run backup ──────────────────────────────────────────
  let result: CrashBackupResult;
  const databaseUrl = process.env.DATABASE_URL ?? '';

  try {
    if (!databaseUrl) {
      result = {
        ok: false,
        kind: 'skipped',
        path: null,
        error: 'DATABASE_URL is not set — nothing to back up',
      };
    } else if (databaseUrl.startsWith('file:')) {
      result =
        backupDir !== null
          ? sqliteFileCopyBackup(backupDir, formatStamp(new Date()), databaseUrl)
          : { ok: false, kind: 'sqlite-file-copy', path: null, error: 'Backup directory unavailable' };
    } else {
      result =
        backupDir !== null
          ? pgDumpBackup(backupDir, formatStamp(new Date()), databaseUrl)
          : { ok: false, kind: 'pg_dump', path: null, error: 'Backup directory unavailable' };
    }
  } catch (error) {
    result = {
      ok: false,
      kind: 'unknown',
      path: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const durationMs = Date.now() - startedAt;

  console.error(
    `[CRASH-BACKUP] ${trigger} → ${result.ok ? 'backup OK' : 'backup FAILED'} ` +
      `(kind=${result.kind}, path=${result.path ?? 'n/a'}${result.error ? `, error=${result.error}` : ''}, ${durationMs}ms)`,
  );

  // ── JSONL audit line (local, survives even when the DB is down) ───────────
  if (backupDir !== null) {
    const line: CrashBackupLogLine = {
      timestamp: new Date().toISOString(),
      trigger,
      kind: result.kind,
      path: result.path,
      ...(result.error !== undefined ? { error: result.error } : {}),
      durationMs,
    };
    appendBackupLogLine(backupDir, line);
  }

  // ── Best-effort DB SystemLog (CRITICAL) ───────────────────────────────────
  await bestEffortSystemLog(trigger, result, durationMs, crashError);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Install the crash-triggered database backup handlers.
 *
 * Idempotent: calling this multiple times (double instrumentation, dev HMR)
 * registers the listeners exactly once per process. Never throws.
 */
export function installCrashBackup(): void {
  try {
    if (installed || (globalThis as Record<symbol, unknown>)[INSTALLED_FLAG]) {
      return;
    }

    // ── uncaughtException: backup, then KEEP CRASH SEMANTICS (exit 1). ──────
    process.on('uncaughtException', (error: Error) => {
      void runCrashBackup('uncaughtException', error)
        .catch((backupError: unknown) => {
          console.error(
            '[CRASH-BACKUP] Backup sequence threw (still exiting):',
            backupError instanceof Error ? backupError.message : String(backupError),
          );
        })
        .finally(() => {
          process.exit(1);
        });
    });

    // ── unhandledRejection: backup + log, but DO NOT exit (availability- ────
    // ── first: the server keeps serving; Sentry captures the event).      ────
    process.on('unhandledRejection', (reason: unknown) => {
      void runCrashBackup('unhandledRejection', reason).catch(
        (backupError: unknown) => {
          console.error(
            '[CRASH-BACKUP] Backup sequence threw:',
            backupError instanceof Error ? backupError.message : String(backupError),
          );
        },
      );
    });

    installed = true;
    (globalThis as Record<symbol, unknown>)[INSTALLED_FLAG] = true;
    console.error('[CRASH-BACKUP] Crash-backup hook installed');
  } catch (error) {
    // Instrumentation must NEVER break boot.
    console.error(
      '[CRASH-BACKUP] Failed to install crash-backup hook:',
      error instanceof Error ? error.message : String(error),
    );
  }
}
