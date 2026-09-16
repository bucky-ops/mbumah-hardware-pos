// GET/PATCH /api/profile — SELF-SERVICE profile endpoint (v2.7.0)
//
// WHY THIS ROUTE EXISTS: the sidebar's "Profile & Settings" menu item used to
// show `toast.info('Profile settings coming soon')`. The only way a user could
// change their own name/phone was to ask a SUPER_ADMIN to run the Admin tab's
// user editor. This route completes the self-service surface:
//   GET   — the signed-in user's full profile (org + store included)
//   PATCH — update your OWN name / phone / avatarUrl (never role/email/store —
//           those stay admin-only through /api/users/[id] so a cashier cannot
//           promote themselves or escape their branch scope)
//
// Security model:
//   • Session-authenticated (Bearer token → db.session → user), same as
//     /api/auth/me. No role list: EVERY authenticated user may edit their
//     own profile — this is the one DML surface that is deliberately open.
//   • Self-scoped by construction: writes go to session.userId only.
//   • Every PATCH is written to the SystemLog audit trail (who changed what).
//
// NOTE: password changes live in /api/profile/password (separate route so the
// audit trail and session-revocation logic stay isolated).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  organizationId: true,
  storeId: true,
  isActive: true,
  phone: true,
  avatarUrl: true,
  lastLoginAt: true,
  createdAt: true,
  organization: { select: { id: true, name: true, taxPin: true } },
  store: {
    select: { id: true, name: true, location: true, phone: true, email: true },
  },
} as const;

function serializeUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string;
  storeId: string | null;
  isActive: boolean;
  phone: string | null;
  avatarUrl: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  organization: { id: string; name: string; taxPin: string | null };
  store: { id: string; name: string; location: string | null; phone: string | null; email: string | null } | null;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
    storeId: user.storeId,
    isActive: user.isActive,
    phone: user.phone,
    avatarUrl: user.avatarUrl,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    organization: user.organization,
    store: user.store,
  };
}

async function getProfileHandler(...args: unknown[]): Promise<Response> {
  const session = args[1] as { userId: string };
  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: USER_SELECT,
  });

  if (!user) {
    return Response.json(
      { success: false, error: 'User not found.' },
      { status: 404 }
    );
  }

  return Response.json({ success: true, data: serializeUser(user) });
}

async function patchProfileHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const session = args[1] as { userId: string; email: string };
  const body = (await request.json()) as {
    name?: unknown;
    phone?: unknown;
    avatarUrl?: unknown;
  };

  // ── Validate (same field policy as the Admin tab's user editor) ─────────
  const updates: { name?: string; phone?: string | null; avatarUrl?: string | null } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120) {
      return Response.json(
        { success: false, error: 'Name is required and must be 120 characters or fewer.' },
        { status: 400 }
      );
    }
    updates.name = name;
  }

  if (body.phone !== undefined) {
    if (body.phone === null || body.phone === '') {
      updates.phone = null;
    } else if (typeof body.phone === 'string') {
      const phone = body.phone.trim();
      // Loose phone check: digits, spaces, +, -, () — e.g. "+254 795 191 909"
      if (phone.length > 32 || !/^[0-9+()\-\s]+$/.test(phone)) {
        return Response.json(
          { success: false, error: 'Phone must be 32 characters or fewer and contain only digits and + ( ) - characters.' },
          { status: 400 }
        );
      }
      updates.phone = phone;
    } else {
      return Response.json(
        { success: false, error: 'Phone must be a string or null.' },
        { status: 400 }
      );
    }
  }

  if (body.avatarUrl !== undefined) {
    if (body.avatarUrl === null || body.avatarUrl === '') {
      updates.avatarUrl = null;
    } else if (typeof body.avatarUrl === 'string') {
      const url = body.avatarUrl.trim();
      // Only http(s) URLs — blocks javascript:/data: injection into <img src>.
      if (url.length > 500 || !/^https?:\/\//i.test(url)) {
        return Response.json(
          { success: false, error: 'Avatar URL must be an http(s) link (500 characters or fewer).' },
          { status: 400 }
        );
      }
      updates.avatarUrl = url;
    } else {
      return Response.json(
        { success: false, error: 'Avatar URL must be a string or null.' },
        { status: 400 }
      );
    }
  }

  if (Object.keys(updates).length === 0) {
    return Response.json(
      { success: false, error: 'Nothing to update. Send name, phone and/or avatarUrl.' },
      { status: 400 }
    );
  }

  const before = await db.user.findUnique({
    where: { id: session.userId },
    select: { name: true, phone: true, avatarUrl: true },
  });
  if (!before) {
    return Response.json(
      { success: false, error: 'User not found.' },
      { status: 404 }
    );
  }

  const user = await db.user.update({
    where: { id: session.userId },
    data: updates,
    select: USER_SELECT,
  });

  await systemLog({
    action: 'PROFILE_UPDATED',
    component: LogComponent.AUTH,
    severity: LogSeverity.INFO,
    message: `User ${user.email} updated their own profile (fields: ${Object.keys(updates).join(', ')}).`,
    storeId: user.storeId ?? undefined,
    metadata: {
      userId: user.id,
      fields: Object.keys(updates),
      before: {
        name: before.name,
        phone: before.phone,
        avatarUrl: before.avatarUrl,
      },
      after: {
        name: user.name,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
      },
    },
  });

  return Response.json({ success: true, data: serializeUser(user) });
}

export const GET = withErrorBoundary(withSessionAuth(getProfileHandler), 'PROFILE_GET');
export const PATCH = withErrorBoundary(withSessionAuth(patchProfileHandler), 'PROFILE_PATCH');
