// MBUMAH HARDWARE POS - Remote Access Kit (RAK) · GitHub control bus client
// (server-side only - v2.11.0, docs/REMOTE_ACCESS_KIT_PLAN.md §5)
//
// The private ops-log repository (default `bucky-ops/mbumah-ops-log`) is BOTH
// the command channel to the store fleet and the immutable audit ledger:
//
//   commands/<store-id>.json             the CURRENT pending command per store
//   results/<store-id>/<ts>-<cmd>.json   one result per execution
//   ledger/<store-id>.jsonl              append-only per-store history
//   fleet/ring-assignment.json           ring 0/1/2 membership (optional)
//
// The cloud is the only writer of `commands/*`; store agents write
// `results/*` + `ledger/*` with their own device tokens. Because every
// operation is an ordinary commit, the commit URL doubles as the audit
// record the console links to.
//
// Configuration (all OPTIONAL - every consumer degrades honestly when unset):
//   OPS_GITHUB_TOKEN   fine-grained PAT - Contents RW on the ops-log repo ONLY
//   OPS_LOG_REPO       "owner/repo", default 'bucky-ops/mbumah-ops-log'
//   OPS_SIGNING_KEY    HMAC-SHA256 key shared with the kits; commands are
//                      signed by the cloud and verified by the agent, so a
//                      leaked device token alone cannot command a store.

import crypto from 'node:crypto';

export type FleetCommandType =
  | 'update'
  | 'rollback'
  | 'freeze'
  | 'unfreeze'
  | 'tunnel';

export interface OpsConfig {
  token: string;
  repo: string;
  signingKey: string;
  configured: boolean;
  missing: string[];
}

const OPS_API_BASE = 'https://api.github.com';
const OPS_TIMEOUT_MS = 10_000;
/** GitHub returned transient 500s during rollout - one quiet retry on 5xx. */
const OPS_RETRY_DELAYS_MS = [800];

// Config

export function getOpsConfig(): OpsConfig {
  const token = process.env.OPS_GITHUB_TOKEN ?? '';
  const repo = process.env.OPS_LOG_REPO || 'bucky-ops/mbumah-ops-log';
  const signingKey = process.env.OPS_SIGNING_KEY ?? '';
  const missing: string[] = [];
  if (!token) missing.push('OPS_GITHUB_TOKEN');
  if (!signingKey) missing.push('OPS_SIGNING_KEY');
  return { token, repo, signingKey, configured: missing.length === 0, missing };
}

// Canonical JSON + HMAC signing

/**
 * Deterministic JSON: object keys recursively sorted so the cloud's signature
 * and the agent's verification hash byte-identical payloads even though
 * JSON.stringify key order follows insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

export function signCommand(
  payload: Record<string, unknown>,
  signingKey: string,
): string {
  return crypto.createHmac('sha256', signingKey).update(canonicalJson(payload)).digest('hex');
}

/** Timing-safe verification; accepts an optional `hmac-sha256:` prefix. */
export function verifyCommandSignature(
  payload: Record<string, unknown>,
  signature: string,
  signingKey: string,
): boolean {
  try {
    const provided = signature.replace(/^hmac-sha256:/i, '').trim().toLowerCase();
    const expected = signCommand(payload, signingKey);
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// GitHub REST plumbing (fault-isolated, never throws)

interface GhResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function ghApi<T>(
  config: OpsConfig,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<GhResult<T>> {
  const run = async (): Promise<GhResult<T>> => {
    try {
      const response = await fetch(`${OPS_API_BASE}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${config.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(OPS_TIMEOUT_MS),
        cache: 'no-store',
      });
      const text = await response.text();
      const parsed = text ? (JSON.parse(text) as T) : null;
      if (!response.ok) {
        const message =
          (parsed as { message?: string } | null)?.message ??
          `GitHub API HTTP ${response.status}`;
        return { ok: false, status: response.status, data: parsed, error: message };
      }
      return { ok: true, status: response.status, data: parsed };
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.name === 'TimeoutError' || error.name === 'AbortError'
            ? 'timed out'
            : error.message
          : String(error);
      return { ok: false, status: 0, data: null, error: detail };
    }
  };

  let result = await run();
  for (const delay of OPS_RETRY_DELAYS_MS) {
    // Retry only on GitHub-side blips (5xx) - 404/403/401 are answers, not errors.
    if (result.ok || (result.status < 500 && result.status !== 0)) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await run();
  }
  return result;
}

interface GhContent {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir';
  content?: string;
  html_url?: string;
}

interface GhCommitResponse {
  commit: { sha: string };
  content: { html_url?: string };
}

// File operations (single-commit audit records)

/** PUT a text file (creates or updates in one commit). Returns commit info. */
export async function putTextFile(
  config: OpsConfig,
  path: string,
  content: string,
  message: string,
): Promise<{ commitSha: string | null; commitUrl: string | null; error?: string }> {
  // Existing file sha is required for updates; 404 simply means create.
  const existing = await ghApi<GhContent>(
    config,
    `/repos/${config.repo}/contents/${encodePath(path)}`,
  );
  if (!existing.ok && existing.status !== 404) {
    return { commitSha: null, commitUrl: null, error: existing.error };
  }
  const result = await ghApi<GhCommitResponse>(config, `/repos/${config.repo}/contents/${encodePath(path)}`, {
    method: 'PUT',
    body: {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(existing.ok && existing.data?.sha ? { sha: existing.data.sha } : {}),
    },
  });
  if (!result.ok || !result.data) {
    return { commitSha: null, commitUrl: null, error: result.error };
  }
  return {
    commitSha: result.data.commit?.sha ?? null,
    commitUrl: result.data.content?.html_url ?? null,
  };
}

export async function readTextFile(
  config: OpsConfig,
  path: string,
): Promise<{ content: string | null; error?: string }> {
  const result = await ghApi<GhContent>(config, `/repos/${config.repo}/contents/${encodePath(path)}`);
  if (!result.ok) {
    if (result.status === 404) return { content: null };
    return { content: null, error: result.error };
  }
  try {
    return { content: Buffer.from(result.data?.content ?? '', 'base64').toString('utf8') };
  } catch {
    return { content: null, error: 'Could not decode file content.' };
  }
}

export async function listDir(
  config: OpsConfig,
  path: string,
): Promise<{ entries: Array<{ name: string; type: 'file' | 'dir' }>; error?: string }> {
  const result = await ghApi<GhContent[]>(config, `/repos/${config.repo}/contents/${encodePath(path)}`);
  if (!result.ok) {
    if (result.status === 404) return { entries: [] };
    return { entries: [], error: result.error };
  }
  const entries = (result.data ?? [])
    .filter((e): e is GhContent => typeof e?.name === 'string')
    .map((e) => ({ name: e.name, type: e.type === 'dir' ? ('dir' as const) : ('file' as const) }));
  return { entries };
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * Append one JSONL line to `ledger/<storeId>.jsonl` (read-modify-write, one
 * commit). Ledger files stay small (heartbeats every 6h + one line per
 * command) so this stays cheap and contention-free (one agent per store).
 */
export async function appendLedgerLine(
  config: OpsConfig,
  storeId: string,
  line: Record<string, unknown>,
): Promise<{ commitSha: string | null; commitUrl: string | null; error?: string }> {
  const path = `ledger/${sanitizeStoreId(storeId)}.jsonl`;
  const existing = await readTextFile(config, path);
  if (existing.error) return { commitSha: null, commitUrl: null, error: existing.error };
  const prior = existing.content?.trimEnd() ?? '';
  const updated = `${prior ? `${prior}\n` : ''}${JSON.stringify(line)}\n`;
  return putTextFile(config, path, updated, `ops(${storeId}): ${String(line.event ?? 'event')}`);
}

export function sanitizeStoreId(storeId: string): string {
  return storeId.toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 80) || 'unknown';
}

// Shared fleet cache (60 s) so the console doesn't hammer the API

interface CacheEntry {
  at: number;
  data: unknown;
}

const FLEET_CACHE_KEY = Symbol.for('mbumah.ops.fleetCache');
const FLEET_CACHE_TTL_MS = 60_000;

export function getFleetCache<T>(): T | null {
  const cache = (globalThis as Record<symbol, unknown>)[FLEET_CACHE_KEY] as CacheEntry | undefined;
  if (!cache || Date.now() - cache.at > FLEET_CACHE_TTL_MS) return null;
  return cache.data as T;
}

export function setFleetCache(data: unknown): void {
  (globalThis as Record<symbol, unknown>)[FLEET_CACHE_KEY] = { at: Date.now(), data };
}

export function invalidateFleetCache(): void {
  (globalThis as Record<symbol, unknown>)[FLEET_CACHE_KEY] = { at: 0, data: null };
}

// Latest release (same contract as the admin/updates panel)

export async function fetchLatestReleaseTag(): Promise<{
  tag: string | null;
  url: string | null;
  note?: string;
}> {
  try {
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    // GITHUB_TOKEN (read-only release checks) - separate from OPS_GITHUB_TOKEN.
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(
      `${OPS_API_BASE}/repos/bucky-ops/mbumah-hardware-pos/releases/latest`,
      { headers, signal: AbortSignal.timeout(6_000), cache: 'no-store' },
    );
    if (!response.ok) {
      return { tag: null, url: null, note: `Release check failed (HTTP ${response.status}).` };
    }
    const payload = (await response.json()) as { tag_name?: unknown; html_url?: unknown };
    if (typeof payload.tag_name !== 'string' || payload.tag_name === '') {
      return { tag: null, url: null, note: 'Release response missing tag_name.' };
    }
    return {
      tag: payload.tag_name,
      url: typeof payload.html_url === 'string' ? payload.html_url : null,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { tag: null, url: null, note: `Release check failed (${detail}).` };
  }
}
