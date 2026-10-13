// ============================================================================
// GET /api/update/status - staged updater progress projection (v2.17.9).
//
// Public payload (no session): phase, percent, message, targetVersion,
// updatedAt and the maintenance flag - the minimum the login page progress
// bar needs, and deliberately nothing else. When the caller is an
// authenticated SUPER_ADMIN or STORE_OWNER, the payload is extended with
// startedAt, error (already path-sanitized in the state store) and pid.
//
// A missing or corrupt state file answers the idle defaults; this endpoint
// never 500s on updater infrastructure and never exposes filesystem paths.

import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, OWNER_ROLES } from '@/lib/auth';
import { readUpdateState, buildPublicStatus } from '@/lib/updater/state';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const state = readUpdateState();
  const data: Record<string, unknown> = { ...buildPublicStatus(state) };

  try {
    const session = await getSessionFromRequest(request);
    if (session && OWNER_ROLES.includes(session.role)) {
      data.startedAt = state.startedAt;
      data.error = state.error;
      data.pid = state.pid;
    }
  } catch {
    // Session resolution (DB hiccup, missing token) must never break the
    // public progress projection - answer the minimal payload instead.
  }

  return NextResponse.json({ success: true, data });
}
