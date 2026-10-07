// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Admin Updates Status API (SRV-2, v2.9.0)
// ─────────────────────────────────────────────────────────────────────────────
//
// GET /api/admin/updates — one honest snapshot of the deployment's update
// posture, consumed by the admin Updates panel:
//
//   • current        — the running version/build (package.json is the source
//                      of truth; see src/lib/version.ts).
//   • channel        — 'cloud' when DATABASE_URL points at postgres, else
//                      'laptop' (SQLite kits updated by deploy-kit).
//   • latestRelease  — latest GitHub Release of bucky-ops/mbumah-hardware-pos
//                      (GITHUB_TOKEN raises the 60 req/h anonymous rate limit
//                      when set). NEVER faked: a failed fetch yields `null`
//                      plus a human-readable `releasesNote`.
//   • vercelConfigured + deployments — the 6 most recent production
//                      deployments from the Vercel API when VERCEL_TOKEN +
//                      VERCEL_PROJECT_ID exist; failures → [] + `vercelNote`.
//   • lastBackup     — most recent CRASH_BACKUP / MANUAL_BACKUP SystemLog
//                      entry, so the panel can show data-protection health.
//
// Every external call is individually try/caught — this route must ALWAYS
// answer with whatever it actually knows. It never throws "up".
//
// Auth: SUPER_ADMIN or STORE_OWNER only.
// ─────────────────────────────────────────────────────────────────────────────

import { type NextRequest, NextResponse } from 'next/server';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { APP_VERSION, APP_BUILD_SHA, APP_BUILD_LABEL } from '@/lib/version';

export const dynamic = 'force-dynamic';

const GITHUB_RELEASES_URL =
  'https://api.github.com/repos/bucky-ops/mbumah-hardware-pos/releases/latest';
const VERCEL_DEPLOYMENTS_URL = 'https://api.vercel.com/v6/deployments';

const EXTERNAL_TIMEOUT_MS = 6_000;

interface ReleaseInfo {
  tag: string;
  name: string;
  url: string;
  publishedAt: string | null;
}

interface DeploymentInfo {
  uid: string;
  state: string;
  createdAt: number;
  url: string | null;
  sha: string | null;
}

/** Strip a leading 'v' so `v2.9.0` compares equal to `2.9.0`. */
function stripLeadingV(tag: string): string {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}

// ── GitHub latest release (individually fault-isolated) ──────────────────────
async function fetchLatestRelease(): Promise<{
  release: ReleaseInfo | null;
  note?: string;
}> {
  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      // Only send when configured — an empty Bearer header is worse than none.
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    };

    const response = await fetch(GITHUB_RELEASES_URL, {
      headers,
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        return {
          release: null,
          note: process.env.GITHUB_TOKEN
            ? 'GitHub release check rate-limited or token rejected (HTTP 403/429).'
            : 'GitHub release check rate-limited (HTTP 403/429) — set GITHUB_TOKEN to raise the anonymous rate limit.',
        };
      }
      if (response.status === 404) {
        return {
          release: null,
          note: 'No GitHub release found for bucky-ops/mbumah-hardware-pos (HTTP 404) — publish a release to enable update checks.',
        };
      }
      return {
        release: null,
        note: `GitHub release check failed (HTTP ${response.status}).`,
      };
    }

    const payload = (await response.json()) as {
      tag_name?: unknown;
      name?: unknown;
      html_url?: unknown;
      published_at?: unknown;
    };

    if (typeof payload.tag_name !== 'string' || payload.tag_name === '') {
      return {
        release: null,
        note: 'GitHub release response was missing tag_name.',
      };
    }

    return {
      release: {
        tag: payload.tag_name,
        name:
          typeof payload.name === 'string' && payload.name !== ''
            ? payload.name
            : payload.tag_name,
        url:
          typeof payload.html_url === 'string'
            ? payload.html_url
            : 'https://github.com/bucky-ops/mbumah-hardware-pos/releases',
        publishedAt:
          typeof payload.published_at === 'string' ? payload.published_at : null,
      },
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.name === 'TimeoutError' || error.name === 'AbortError'
          ? 'timed out after 6s'
          : error.message
        : String(error);
    return {
      release: null,
      note: `GitHub release check failed (${detail}).`,
    };
  }
}

// ── Vercel production deployments (individually fault-isolated) ──────────────
async function fetchVercelDeployments(): Promise<{
  deployments: DeploymentInfo[];
  note?: string;
}> {
  const token = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId = process.env.VERCEL_TEAM_ID;

  if (!token || !projectId) return { deployments: [] }; // not configured — silently absent

  try {
    const url = new URL(VERCEL_DEPLOYMENTS_URL);
    url.searchParams.set('projectId', projectId);
    url.searchParams.set('target', 'production');
    url.searchParams.set('limit', '6');
    if (teamId) url.searchParams.set('teamId', teamId);

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        deployments: [],
        note: `Vercel deployments check failed (HTTP ${response.status}).`,
      };
    }

    const payload = (await response.json()) as {
      deployments?: Array<{
        uid?: unknown;
        state?: unknown;
        createdAt?: unknown;
        url?: unknown;
        meta?: { githubCommitSha?: unknown };
      }>;
    };

    const deployments: DeploymentInfo[] = (payload.deployments ?? [])
      .filter((d): d is NonNullable<typeof d> => typeof d === 'object' && d !== null)
      .map((d) => {
        const meta = d.meta as { githubCommitSha?: unknown } | undefined;
        return {
          uid: typeof d.uid === 'string' ? d.uid : '',
          state: typeof d.state === 'string' ? d.state : 'UNKNOWN',
          createdAt: typeof d.createdAt === 'number' ? d.createdAt : 0,
          url: typeof d.url === 'string' ? d.url : null,
          sha:
            typeof meta?.githubCommitSha === 'string'
              ? meta.githubCommitSha.slice(0, 7)
              : null,
        };
      })
      .filter((d) => d.uid !== '');

    return { deployments };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.name === 'TimeoutError' || error.name === 'AbortError'
          ? 'timed out after 6s'
          : error.message
        : String(error);
    return {
      deployments: [],
      note: `Vercel deployments check failed (${detail}).`,
    };
  }
}

// ── Last backup from SystemLog (individually fault-isolated) ─────────────────
async function fetchLastBackup(): Promise<{
  at: string;
  action: string;
  severity: string;
  message: string;
} | null> {
  try {
    // runWithoutTenant: crash backups log with no storeId — a tenant-scoped
    // STORE_OWNER query must still see the global record.
    return await runWithoutTenant(async () => {
      const row = await db.systemLog.findFirst({
        where: { action: { in: ['CRASH_BACKUP', 'MANUAL_BACKUP'] } },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          action: true,
          severity: true,
          message: true,
        },
      });
      if (!row) return null;
      return {
        at: row.createdAt.toISOString(),
        action: row.action,
        severity: row.severity,
        message: row.message,
      };
    });
  } catch {
    // The log table may not exist yet / DB briefly down — never block the panel.
    return null;
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────
async function getHandler(
  _request: NextRequest,
  _session: AuthSession,
): Promise<Response> {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  const channel = databaseUrl.startsWith('postgres') ? 'cloud' : 'laptop';

  const [{ release: latestRelease, note: releasesNote }, { deployments, note: vercelNote }, lastBackup] =
    await Promise.all([
      fetchLatestRelease(),
      fetchVercelDeployments(),
      fetchLastBackup(),
    ]);

  const vercelConfigured = Boolean(
    process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID,
  );

  const updateAvailable =
    latestRelease !== null && stripLeadingV(latestRelease.tag) !== APP_VERSION;

  return NextResponse.json({
    success: true,
    data: {
      current: {
        version: APP_VERSION,
        buildSha: APP_BUILD_SHA,
        buildLabel: APP_BUILD_LABEL,
      },
      channel,
      updateAvailable,
      latestRelease,
      ...(releasesNote !== undefined ? { releasesNote } : {}),
      vercelConfigured,
      deployments,
      ...(vercelNote !== undefined ? { vercelNote } : {}),
      lastBackup,
    },
  });
}

// GET: SUPER_ADMIN or STORE_OWNER only.
export const GET = withErrorBoundary(
  requireAuth(getHandler, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'ADMIN_UPDATES_GET',
);
