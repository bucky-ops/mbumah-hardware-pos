// MBUMAH HARDWARE POS - Fleet status API (RAK, v2.11.0)
//
// GET /api/admin/fleet - one honest snapshot of the store fleet + cloud row,
// consumed by the Admin "Fleet & Remote Ops" console:
//
//   • agents[] - discovered from `ledger/*.jsonl` in the ops-log repo:
//                    last heartbeat (version/health/frozen), derived status
//                    (online/stale/offline), pending command if any, and
//                    version drift vs the latest GitHub release.
//   • cloud - the deployment the console itself runs on (version +
//                    latest release + updateAvailable).
//   • rings - optional `fleet/ring-assignment.json` from the ops repo.
//
// Auth: SUPER_ADMIN or STORE_OWNER (same posture as /api/admin/updates).
// Every upstream read is individually fault-isolated - this route ALWAYS
// answers with what it actually knows and never throws "up".

import { type NextRequest, NextResponse } from 'next/server';
import { withErrorBoundary } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { APP_VERSION, APP_BUILD_SHA } from '@/lib/version';
import {
  getOpsConfig,
  listDir,
  readTextFile,
  sanitizeStoreId,
  getFleetCache,
  setFleetCache,
  fetchLatestReleaseTag,
} from '@/lib/ops-github';

export const dynamic = 'force-dynamic';

/** Heartbeat cadence is 6 h; tolerance bands for fleet status. */
const ONLINE_MS = 7 * 60 * 60 * 1000; // within one missed heartbeat
const STALE_MS = 13 * 60 * 60 * 1000; // within two missed heartbeats

interface PendingCommand {
  'command-id': string;
  type: string;
  version?: string;
  force?: boolean;
  'issued-at': string;
  'issued-by': string;
  reason?: string;
}

interface LedgerLine {
  ts?: string;
  event?: string;
  [key: string]: unknown;
}

interface AgentView {
  storeId: string;
  status: 'online' | 'stale' | 'offline' | 'unknown';
  lastHeartbeatAt: string | null;
  lastEvent: string | null;
  lastEventAt: string | null;
  version: string | null;
  health: string | null;
  frozen: boolean;
  drift: 'up_to_date' | 'behind' | 'unknown';
  pendingCommand: {
    commandId: string;
    type: string;
    version: string | null;
    force: boolean;
    issuedAt: string;
    issuedBy: string;
    reason: string | null;
  } | null;
}

function parseLedger(content: string): LedgerLine[] {
  const lines: LedgerLine[] = [];
  for (const raw of content.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as LedgerLine;
      if (parsed && typeof parsed === 'object') lines.push(parsed);
    } catch {
      // A torn write from a power cut must not poison the whole ledger.
    }
  }
  return lines;
}

async function fetchLatestReleaseSafe(): Promise<{ tag: string | null; url: string | null; note?: string }> {
  try {
    return await fetchLatestReleaseTag();
  } catch {
    return { tag: null, url: null, note: 'Release check failed.' };
  }
}

async function buildFleet(): Promise<Record<string, unknown>> {
  const config = getOpsConfig();
  const stripV = (tag: string) => tag.replace(/^v/, '');

  const release = await fetchLatestReleaseSafe();
  const cloud = {
    version: APP_VERSION,
    buildSha: APP_BUILD_SHA,
    latestRelease: release.tag,
    releaseUrl: release.url,
    updateAvailable: release.tag ? stripV(release.tag) !== APP_VERSION : false,
    ...(release.note ? { releasesNote: release.note } : {}),
  };

  const setupNote = config.configured
    ? undefined
    : `Remote Ops is not configured on this server - set ${config.missing.join(' + ')} (see docs/REMOTE_ACCESS_KIT_PLAN.md §5). Fleet agents and commands stay disabled until then.`;

  if (!config.configured) {
    return {
      configured: false,
      ...(setupNote ? { note: setupNote } : {}),
      repo: config.repo,
      agents: [],
      cloud,
      rings: null,
    };
  }

  // Read the ops-log repo (each step fault-isolated)
  const ledgerDir = await listDir(config, 'ledger');

  if (ledgerDir.error) {
    return {
      configured: true,
      note: `Could not read the ops-log repo (${ledgerDir.error}). Verify OPS_LOG_REPO="${config.repo}" exists and OPS_GITHUB_TOKEN has Contents read access.`,
      repo: config.repo,
      agents: [],
      cloud,
      rings: null,
    };
  }

  const storeIds = ledgerDir.entries
    .filter((e) => e.type === 'file' && e.name.endsWith('.jsonl'))
    .map((e) => e.name.replace(/\.jsonl$/, ''));

  const agents = await Promise.all(
    storeIds.map(async (storeId): Promise<AgentView> => {
      const view: AgentView = {
        storeId,
        status: 'unknown',
        lastHeartbeatAt: null,
        lastEvent: null,
        lastEventAt: null,
        version: null,
        health: null,
        frozen: false,
        drift: 'unknown',
        pendingCommand: null,
      };

      const ledger = await readTextFile(config, `ledger/${sanitizeStoreId(storeId)}.jsonl`);
      if (ledger.content) {
        const lines = parseLedger(ledger.content);
        const beats = lines.filter((l) => l.event === 'heartbeat');
        const lastBeat = beats[beats.length - 1];
        const lastLine = lines[lines.length - 1];
        if (lastLine) {
          view.lastEvent = typeof lastLine.event === 'string' ? lastLine.event : null;
          view.lastEventAt = typeof lastLine.ts === 'string' ? lastLine.ts : null;
          if (typeof lastLine.toVersion === 'string') view.version = lastLine.toVersion.replace(/^v/, '');
        }
        if (lastBeat) {
          view.lastHeartbeatAt = typeof lastBeat.ts === 'string' ? lastBeat.ts : null;
          if (typeof lastBeat.version === 'string') view.version = lastBeat.version.replace(/^v/, '');
          view.health = typeof lastBeat.health === 'string' ? lastBeat.health : null;
          view.frozen = lastBeat.frozen === true;
        }
        const beatAge = view.lastHeartbeatAt
          ? Date.now() - new Date(view.lastHeartbeatAt).getTime()
          : Number.POSITIVE_INFINITY;
        view.status = beatAge <= ONLINE_MS ? 'online' : beatAge <= STALE_MS ? 'stale' : 'offline';
        view.drift =
          release.tag && view.version
            ? stripV(release.tag) === view.version
              ? 'up_to_date'
              : 'behind'
            : 'unknown';
      }

      const pending = await readTextFile(config, `commands/${sanitizeStoreId(storeId)}.json`);
      if (pending.content) {
        try {
          const cmd = JSON.parse(pending.content) as PendingCommand;
          view.pendingCommand = {
            commandId: String(cmd['command-id'] ?? ''),
            type: String(cmd.type ?? 'unknown'),
            version: typeof cmd.version === 'string' ? cmd.version : null,
            force: cmd.force === true,
            issuedAt: String(cmd['issued-at'] ?? ''),
            issuedBy: String(cmd['issued-by'] ?? ''),
            reason: typeof cmd.reason === 'string' ? cmd.reason : null,
          };
        } catch {
          // Malformed pending file - surface as an unreadable pending command.
          view.pendingCommand = {
            commandId: '',
            type: 'unreadable',
            version: null,
            force: false,
            issuedAt: '',
            issuedBy: '',
            reason: null,
          };
        }
      }
      return view;
    }),
  );

  agents.sort((a, b) => a.storeId.localeCompare(b.storeId));

  // Optional ring assignment.
  let rings: unknown = null;
  const ringFile = await readTextFile(config, 'fleet/ring-assignment.json');
  if (ringFile.content) {
    try {
      rings = JSON.parse(ringFile.content);
    } catch {
      rings = null;
    }
  }

  return { configured: true, repo: config.repo, agents, cloud, rings };
}

async function getFleetHandler(
  _request: NextRequest,
  _session: AuthSession,
): Promise<Response> {
  const cached = getFleetCache<Record<string, unknown>>();
  if (cached) return NextResponse.json(cached);
  const data = await buildFleet();
  setFleetCache(data);
  return NextResponse.json({ success: true, data });
}

// GET: SUPER_ADMIN or STORE_OWNER only.
export const GET = withErrorBoundary(
  requireAuth(getFleetHandler, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'ADMIN_FLEET_GET',
);
