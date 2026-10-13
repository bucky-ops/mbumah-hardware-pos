// ============================================================================
// POST /api/update/prepare - accept a staged update request (v2.17.9).
//
// Contract:
//   401  no valid session (Bearer token or mbt_token cookie)
//   403  session role is not SUPER_ADMIN or STORE_OWNER
//   501  Vercel serverless (staged updates need filesystem + process control)
//   409  an update is already active (per updater/update-state.json)
//   400  malformed targetVersion / artifactUrl values
//   202  orchestrator spawned detached; progress via GET /api/update/status
//
// The spawn is detached and unref'd on purpose: the orchestrator outlives
// this request and owns updater/update-state.json from here on.

import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { getSessionFromRequest, OWNER_ROLES } from '@/lib/auth';
import { readUpdateState, writeUpdateState, ACTIVE_PHASES } from '@/lib/updater/state';

export const dynamic = 'force-dynamic';

const TARGET_VERSION_PATTERN = /^[\w.]{1,32}$/;

export async function POST(request: NextRequest) {
  const session = await getSessionFromRequest(request).catch(() => null);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
  }
  if (!OWNER_ROLES.includes(session.role)) {
    return NextResponse.json(
      { success: false, error: 'You do not have permission to prepare updates.' },
      { status: 403 },
    );
  }

  if (process.env.VERCEL === '1') {
    return NextResponse.json(
      { success: false, error: 'Staged updates run on self-hosted deployments only.' },
      { status: 501 },
    );
  }

  if (ACTIVE_PHASES.has(readUpdateState().phase)) {
    return NextResponse.json(
      { success: false, error: 'An update is already in progress.' },
      { status: 409 },
    );
  }

  // Body is optional and parsed defensively; both fields are optional.
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const raw =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};

  let targetVersion: string | null = null;
  if (typeof raw.targetVersion === 'string' && raw.targetVersion.length > 0) {
    if (!TARGET_VERSION_PATTERN.test(raw.targetVersion)) {
      return NextResponse.json(
        { success: false, error: 'targetVersion must be 1 to 32 characters (letters, digits, dot or underscore).' },
        { status: 400 },
      );
    }
    targetVersion = raw.targetVersion;
  }

  let artifactUrl: string | null = null;
  if (typeof raw.artifactUrl === 'string' && raw.artifactUrl.length > 0) {
    if (!raw.artifactUrl.startsWith('https://')) {
      return NextResponse.json(
        { success: false, error: 'artifactUrl must be an https:// URL.' },
        { status: 400 },
      );
    }
    artifactUrl = raw.artifactUrl;
  }

  const script = join(process.cwd(), 'scripts', 'staged-update.mjs');
  const args = [script];
  if (targetVersion) args.push('--target-version', targetVersion);
  if (artifactUrl) args.push('--artifact-url', artifactUrl);
  spawn('node', args, { detached: true, stdio: 'ignore', env: process.env }).unref();

  writeUpdateState({
    phase: 'checking',
    percent: 2,
    message: 'Update preparation accepted',
    targetVersion,
  });

  return NextResponse.json({ success: true, data: { accepted: true } }, { status: 202 });
}
