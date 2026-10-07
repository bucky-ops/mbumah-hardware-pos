// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Fleet command API (RAK, v2.11.0)
// ─────────────────────────────────────────────────────────────────────────────
//
// POST /api/admin/fleet/command — issue a signed command to one or more store
// agents. The command is committed to `commands/<store-id>.json` in the
// private ops-log repo; the commit IS the audit record (docs/REMOTE_ACCESS_
// KIT_PLAN.md §5.2). Agents pick it up on their next 15-minute poll, verify
// the HMAC signature + freshness + replay window, then execute.
//
//   type      update | rollback | freeze | unfreeze | tunnel
//   targets   1–10 store ids (as known from the fleet ledger)
//   version   required for update/rollback (a published release tag)
//   force     trading-hours override — the agent still reports, never fakes
//   ttl-minutes  remote-view session length (tunnel)
//   reason    free text; becomes part of the permanent ledger line
//
// Auth: SUPER_ADMIN only (destructive control surface).
// ─────────────────────────────────────────────────────────────────────────────

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';
import {
  getOpsConfig,
  putTextFile,
  signCommand,
  sanitizeStoreId,
  invalidateFleetCache,
  type FleetCommandType,
} from '@/lib/ops-github';

export const dynamic = 'force-dynamic';

const commandSchema = z
  .object({
    type: z.enum(['update', 'rollback', 'freeze', 'unfreeze', 'tunnel']),
    targets: z.array(z.string().min(1).max(80)).min(1, 'Pick at least one store.').max(10),
    version: z.string().max(40).optional(),
    force: z.boolean().optional(),
    ttlMinutes: z.number().int().min(5).max(240).optional(),
    reason: z.string().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.type === 'update' || value.type === 'rollback') && !value.version) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['version'],
        message: `A release tag (e.g. v2.11.0) is required for a ${value.type} command.`,
      });
    }
    if ((value.type === 'freeze' || value.force) && !value.reason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'A reason is required when freezing stores or forcing an update during trading hours.',
      });
    }
  });

function newCommandId(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `cmd-${stamp}-${randomBytes(3).toString('hex')}`;
}

async function postCommandHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  const config = getOpsConfig();
  if (!config.configured) {
    return NextResponse.json(
      {
        success: false,
        error: `Remote Ops is not configured on this server — set ${config.missing.join(' + ')}. See docs/REMOTE_ACCESS_KIT_PLAN.md §5.`,
      },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parsed = commandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid command.' },
      { status: 400 },
    );
  }

  const { type, targets, version, force, ttlMinutes, reason } = parsed.data;
  const issued: Array<{ target: string; commandId: string; commitUrl: string | null }> = [];
  const failures: Array<{ target: string; error: string }> = [];

  for (const target of targets) {
    const payload: Record<string, unknown> = {
      'command-id': newCommandId(),
      type: type as FleetCommandType,
      target,
      'issued-at': new Date().toISOString(),
      'issued-by': session.email || 'unknown-admin',
    };
    if (version) payload.version = version.startsWith('v') ? version : `v${version}`;
    if (force) payload.force = true;
    if (ttlMinutes) payload['ttl-minutes'] = ttlMinutes;
    if (reason?.trim()) payload.reason = reason.trim();

    // Signature covers every field (canonical JSON), so the agent can verify
    // the payload was authored by the cloud and was not altered in transit.
    const sig = signCommand(payload, config.signingKey);
    const full = { ...payload, sig: `hmac-sha256:${sig}` };

    const result = await putTextFile(
      config,
      `commands/${sanitizeStoreId(target)}.json`,
      `${JSON.stringify(full, null, 2)}\n`,
      `ops(${target}): ${type} command by ${payload['issued-by']}`,
    );

    if (result.error) {
      failures.push({ target, error: result.error });
    } else {
      issued.push({ target, commandId: String(payload['command-id']), commitUrl: result.commitUrl });
    }
  }

  invalidateFleetCache();

  await systemLog({
    action: 'FLEET_COMMAND',
    component: 'RAK',
    severity: failures.length > 0 ? 'WARN' : 'INFO',
    message: `Fleet ${type} command issued to [${targets.join(', ')}] by ${session.email}${version ? ` → ${version}` : ''}${force ? ' (FORCED)' : ''}${reason ? ` — ${reason}` : ''}`,
    metadata: { issued, failures, type, version, force: force === true },
  });

  if (issued.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: `No commands were committed: ${failures.map((f) => `${f.target} (${f.error})`).join('; ')}`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      issued,
      failures,
      message:
        failures.length > 0
          ? `${issued.length}/${targets.length} command(s) committed; the rest failed (see failures).`
          : `${issued.length} command(s) committed. Agents execute on their next 15-minute poll${force ? '' : ' (or at the next dormant window if the shop is open)'}.`,
    },
  });
}

// POST: SUPER_ADMIN only.
export const POST = withErrorBoundary(
  requireAuth(postCommandHandler, { roles: ['SUPER_ADMIN'] }),
  'ADMIN_FLEET_COMMAND',
);
