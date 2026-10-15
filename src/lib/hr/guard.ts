// MBUMAH HARDWARE POS - HR route guard (v2.18.5)
//
// Shared composition for every /api/hr route:
//   1. Feature flag check (hr.module.enabled) => 403 FEATURE_DISABLED when off.
//   2. Store scope via requireStoreAccess with the roles allowed for the
//      permission key (branch resolved from the session, never the client).
//   3. hr.* permission check via hasHrPermission (fail-closed) with deny
//      logging through recordPermissionDenied.
//
// Usage:
//   export const GET = hrGuard('hr.employee.read.own_branch', READ_ROLES)(handler)
// where handler is (request, session, context?) => Promise<Response>. The
// dynamic [id] routes receive the Next.js route context as the third argument.

import type { NextRequest } from 'next/server';
import { requireStoreAccess, recordPermissionDenied, type AuthSession } from '@/lib/auth';
import { hasHrPermission, type HrPermissionKey } from './permissions';
import { isHrModuleEnabled } from './feature-flag';

/** Next.js route context shape for the dynamic /api/hr/employees/[id] family. */
export type HrRouteContext = { params: Promise<{ id: string }> };

type HrHandler = (
  request: NextRequest,
  session: AuthSession,
  context?: HrRouteContext,
) => Promise<Response>;

export function hrGuard(permission: HrPermissionKey, allowedRoles?: readonly string[]) {
  return (handler: HrHandler) =>
    requireStoreAccess(
      async (request: NextRequest, session: AuthSession, ...rest: unknown[]) => {
        // 1. Module flag.
        const enabled = await isHrModuleEnabled(session.organizationId);
        if (!enabled) {
          return Response.json(
            {
              success: false,
              error: 'The Employee Management System is disabled for this organization.',
              code: 'FEATURE_DISABLED',
            },
            { status: 403 },
          );
        }

        // 2. hr.* permission (fail-closed; SUPER_ADMIN bypasses known keys only).
        if (!hasHrPermission(session.role, permission)) {
          await recordPermissionDenied({
            session,
            permission,
            request,
            resource: new URL(request.url).pathname,
          });
          return Response.json(
            {
              success: false,
              error: 'You do not have permission to perform this HR action.',
              code: 'PERMISSION_DENIED',
            },
            { status: 403 },
          );
        }

        return handler(request, session, rest[0] as HrRouteContext | undefined);
      },
      allowedRoles,
    );
}

export type { AuthSession };
