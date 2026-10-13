// ============================================================================
// UPDATER STATE STORE (v2.17.9 - staged updates)
// ============================================================================
// SERVER-ONLY module: never import this from a client component. The browser
// sees the updater only through /api/update/status, which returns the
// sanitized projection built by buildPublicStatus().
//
// The state file (updater/update-state.json) is the handoff point between
// the Next.js server (which accepts an update request via
// /api/update/prepare) and the detached orchestrator process
// (scripts/staged-update.mjs), which owns the file while an update runs.
// It never contains secrets: messages are static copy and error text is run
// through sanitizeError() before it is ever written to disk.
//
// All reads are defensive: a missing, corrupt or half-written file falls back
// to the idle defaults, so updater infrastructure can never 500 an API route.
// Writes are atomic (tmp file + rename) so a crash mid-write can never leave
// a torn JSON file behind.
// ============================================================================

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Full lifecycle of a staged update run. */
export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'preflight'
  | 'backing-up'
  | 'installing'
  | 'activating'
  | 'rolling-back'
  | 'done'
  | 'failed';

export interface UpdaterState {
  phase: UpdaterPhase;
  percent: number;
  message: string;
  targetVersion: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  error: string | null;
  pid: number | null;
}

const ACTIVE_PHASE_LIST: readonly UpdaterPhase[] = [
  'checking',
  'downloading',
  'preflight',
  'backing-up',
  'installing',
  'activating',
  'rolling-back',
];

/** Phases during which the system reports maintenance mode. */
export const ACTIVE_PHASES: ReadonlySet<UpdaterPhase> = new Set(ACTIVE_PHASE_LIST);

const KNOWN_PHASES: ReadonlySet<string> = new Set<string>([...ACTIVE_PHASE_LIST, 'idle', 'done', 'failed']);

export const DEFAULT_UPDATE_STATE: UpdaterState = {
  phase: 'idle',
  percent: 0,
  message: '',
  targetVersion: null,
  startedAt: null,
  updatedAt: null,
  error: null,
  pid: null,
};

/** Resolve the state file path, optionally rooted at a custom directory (tests). */
export function updateStateFilePath(directory?: string): string {
  return join(directory ?? process.cwd(), 'updater', 'update-state.json');
}

/**
 * Strip anything that could leak the deployment layout from error text:
 * absolute paths (/home/..., /Users/..., /var/..., /tmp/..., C:\...) become
 * '[path]', whitespace collapses, and the result is capped so a chatty stack
 * line can never bloat the state file or the admin status payload.
 */
export function sanitizeError(text: string): string {
  return text
    .replace(/\/(?:home|Users|var|tmp)(?:\/[^\s"'`,;)\]}]*)?/g, '[path]')
    .replace(/\b[A-Za-z]:\\[^\s"'`,;)\]}]*/g, '[path]')
    .replace(/\b[A-Za-z]:\/[^\s"'`,;)\]}]*/g, '[path]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * Read the updater state, merging whatever the file contains over the idle
 * defaults. ANY problem (missing file, corrupt JSON, wrong types) returns the
 * defaults instead of throwing - the status endpoint must never 500 because
 * updater bookkeeping is broken. Returns a fresh object on every call.
 */
export function readUpdateState(filePath?: string): UpdaterState {
  const target = filePath ?? updateStateFilePath();
  try {
    const parsed: unknown = JSON.parse(readFileSync(target, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_UPDATE_STATE };
    }
    const file = parsed as Record<string, unknown>;
    return {
      phase: typeof file.phase === 'string' && KNOWN_PHASES.has(file.phase)
        ? (file.phase as UpdaterPhase)
        : 'idle',
      percent:
        typeof file.percent === 'number' && Number.isFinite(file.percent)
          ? Math.min(100, Math.max(0, file.percent))
          : 0,
      message: typeof file.message === 'string' ? file.message : '',
      targetVersion:
        typeof file.targetVersion === 'string' && file.targetVersion.length > 0
          ? file.targetVersion
          : null,
      startedAt: typeof file.startedAt === 'string' ? file.startedAt : null,
      updatedAt: typeof file.updatedAt === 'string' ? file.updatedAt : null,
      // Sanitize again on read so a hand-edited file can never leak a path
      // through the API either.
      error:
        typeof file.error === 'string' && file.error.length > 0
          ? sanitizeError(file.error)
          : null,
      pid:
        typeof file.pid === 'number' && Number.isInteger(file.pid)
          ? file.pid
          : null,
    };
  } catch {
    return { ...DEFAULT_UPDATE_STATE };
  }
}

/**
 * Merge a partial update over the current state and persist it atomically
 * (write <file>.tmp then rename). Never throws: on a filesystem failure the
 * merged state is still returned and the problem is logged, so the caller's
 * HTTP response does not depend on disk health. startedAt is stamped when a
 * run leaves 'idle' into an active phase.
 */
export function writeUpdateState(partial: Partial<UpdaterState>, filePath?: string): UpdaterState {
  const target = filePath ?? updateStateFilePath();
  const previous = readUpdateState(target);
  const nextPhase: UpdaterPhase = partial.phase ?? previous.phase;

  const startedAt =
    previous.phase === 'idle' && ACTIVE_PHASES.has(nextPhase)
      ? new Date().toISOString()
      : partial.startedAt !== undefined
        ? partial.startedAt
        : previous.startedAt;

  const next: UpdaterState = {
    phase: nextPhase,
    percent:
      partial.percent !== undefined && Number.isFinite(partial.percent)
        ? Math.min(100, Math.max(0, partial.percent))
        : previous.percent,
    message: partial.message ?? previous.message,
    targetVersion: partial.targetVersion !== undefined ? partial.targetVersion : previous.targetVersion,
    startedAt,
    updatedAt: new Date().toISOString(),
    error:
      partial.error === null
        ? null
        : partial.error !== undefined
          ? sanitizeError(partial.error)
          : previous.error,
    pid: partial.pid !== undefined ? partial.pid : previous.pid,
  };

  try {
    mkdirSync(dirname(target), { recursive: true });
    const tmpPath = `${target}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, target);
  } catch (writeError) {
    console.error(
      '[updater] Could not persist update state:',
      writeError instanceof Error ? writeError.message : writeError,
    );
  }
  return next;
}

export interface PublicUpdateStatus {
  phase: UpdaterPhase;
  percent: number;
  message: string;
  targetVersion: string | null;
  updatedAt: string | null;
  maintenance: boolean;
}

/**
 * The public projection of the updater state: progress only. startedAt,
 * error and pid are deliberately excluded here - the status route attaches
 * them for SUPER_ADMIN / STORE_OWNER sessions from the raw state instead.
 */
export function buildPublicStatus(state: UpdaterState): PublicUpdateStatus {
  return {
    phase: state.phase,
    percent: state.percent,
    message: state.message,
    targetVersion: state.targetVersion,
    updatedAt: state.updatedAt,
    maintenance: ACTIVE_PHASES.has(state.phase),
  };
}
