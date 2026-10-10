// MBUMAH HARDWARE POS - Fleet activity log API (RAK, v2.11.0)
//
// GET /api/admin/fleet/log - merged, newest-first view of the per-store
// ledgers (`ledger/<store-id>.jsonl`) in the ops-log repo. Each row carries
// the event type, the acting store, and whatever detail the agent reported
// (command outcomes include versions, backup paths, durations).
//
// Query params: ?limit=50 (max 200) · ?store=<id> (single store).
// Auth: SUPER_ADMIN or STORE_OWNER. Served through the 60 s fleet cache so
// the console never hammers the GitHub API.

import { type NextRequest, NextResponse } from 'next/server';
import { withErrorBoundary } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';
import {
  getOpsConfig,
  listDir,
  readTextFile,
  sanitizeStoreId,
} from '@/lib/ops-github';

export const dynamic = 'force-dynamic';

interface LedgerLine {
  ts?: string;
  event?: string;
  [key: string]: unknown;
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
      // Torn/partial lines (power cut mid-write) are skipped, not fatal.
    }
  }
  return lines;
}

async function buildLog(
  storeFilter: string | null,
  limit: number,
): Promise<Record<string, unknown>> {
  const config = getOpsConfig();
  if (!config.configured) {
    return {
      configured: false,
      note: `Remote Ops is not configured - set ${config.missing.join(' + ')}.`,
      rows: [],
    };
  }

  let storeIds: string[] = [];
  if (storeFilter) {
    storeIds = [sanitizeStoreId(storeFilter)];
  } else {
    const dir = await listDir(config, 'ledger');
    if (dir.error) {
      return {
        configured: true,
        note: `Could not read the ops-log repo (${dir.error}).`,
        rows: [],
      };
    }
    storeIds = dir.entries
      .filter((e) => e.type === 'file' && e.name.endsWith('.jsonl'))
      .map((e) => e.name.replace(/\.jsonl$/, ''));
  }

  const ledgerReads = await Promise.all(
    storeIds.map(async (storeId) => {
      const file = await readTextFile(config, `ledger/${sanitizeStoreId(storeId)}.jsonl`);
      if (!file.content) return [];
      return parseLedger(file.content).map((line) => ({ storeId, ...line }));
    }),
  );

  const rows = ledgerReads
    .flat()
    .filter((row) => typeof row.ts === 'string' && typeof row.event === 'string')
    .sort((a, b) => (String(a.ts) < String(b.ts) ? 1 : -1))
    .slice(0, limit);

  return { configured: true, rows, count: rows.length, stores: storeIds };
}

async function getLogHandler(
  request: NextRequest,
  _session: AuthSession,
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? '50'), 1), 200);
  const storeParam = searchParams.get('store');
  const storeFilter = storeParam ? storeParam.trim() : null;

  // NOTE: deliberately not cached - this route shares no cache slot with the
  // fleet snapshot, reads are on-demand (opening the activity drawer), and
  // GitHub raw reads are cheap at this frequency.
  const data = await buildLog(storeFilter, limit);
  return NextResponse.json({ success: true, data });
}

// GET: SUPER_ADMIN or STORE_OWNER only.
export const GET = withErrorBoundary(
  requireAuth(getLogHandler, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'ADMIN_FLEET_LOG',
);
