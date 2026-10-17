// POST /api/profile/password - SELF-SERVICE password change (v2.7.0)
//
// WHY THIS ROUTE EXISTS: until now the ONLY way to change a password was a
// SUPER_ADMIN running the Admin tab's user editor. Users could not secure
// their own accounts. This route lets any signed-in user rotate their own
// password - the standard "Change password" flow every POS user expects.
//
// Security model:
//   • Session-authenticated (Bearer token), self-scoped to session.userId.
//   • REQUIRES the CURRENT password (bcrypt.compare, cost 12 hashes - same
//     cost as /api/users POST) - a stolen unlocked laptop cannot lock the
//     real user out without knowing the current password.
//   • New password: min 8 chars, must differ from the current one.
//   • SESSION HYGIENE: after a successful change, every OTHER session for
//     this user is revoked (other browsers/devices are signed out). The
//     CURRENT session is kept so the user isn't logged out mid-action.
//   • Audit: a SystemLog entry records the change (never the passwords).
//   • SECURITY NOTICE (v2.45.0): a best-effort "your password was changed"
//     email reaches the account owner after every successful rotation —
//     the one signal that reaches the victim when someone ELSE rotates the
//     password with a stolen-but-working credential.

import { type NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { withSessionAuth, getSessionFromRequest } from '@/lib/auth';
import { sendEmail, NotificationType } from '@/lib/email-service';
import { passwordChangedTemplate } from '@/lib/email-templates';

export const dynamic = 'force-dynamic';

const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_ROUNDS = 12; // same cost as /api/users POST - do not lower

interface ChangePasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

async function changePasswordHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  // NOTE: withSessionAuth does NOT pass the session as args[1] (it sets the
  // ORM tenant context via AsyncLocalStorage). Re-derive it from the request
  // same pattern as POST /api/gift-cards/redeem.
  const session = await getSessionFromRequest(request);
  if (!session) {
    return Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 }
    );
  }
  const body = (await request.json()) as ChangePasswordBody;

  const currentPassword =
    typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword =
    typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!currentPassword || !newPassword) {
    return Response.json(
      { success: false, error: 'Current password and new password are both required.' },
      { status: 400 }
    );
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return Response.json(
      { success: false, error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters long.` },
      { status: 400 }
    );
  }

  if (newPassword === currentPassword) {
    return Response.json(
      { success: false, error: 'New password must be different from the current password.' },
      { status: 400 }
    );
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, passwordHash: true, storeId: true, isActive: true },
  });

  if (!user || !user.isActive) {
    return Response.json(
      { success: false, error: 'User not found or deactivated.' },
      { status: 404 }
    );
  }

  // Verify the CURRENT password (constant-time bcrypt compare)
  const currentPasswordMatches = await bcrypt.compare(
    currentPassword,
    user.passwordHash
  );
  if (!currentPasswordMatches) {
    // Same message for "user not found" style mistakes - no oracle.
    return Response.json(
      { success: false, error: 'Current password is incorrect.' },
      { status: 400 }
    );
  }

  const newPasswordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  // Rotate the hash and revoke every OTHER session in one transaction
  // The current Bearer token is read from the Authorization header (the same
  // place getSessionFromRequest found it) and kept alive.
  const authHeader = request.headers.get('authorization');
  const currentToken = authHeader?.replace('Bearer ', '') ?? '';

  const { sessionsRevoked } = await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash: newPasswordHash,
        // v2.44.0: first sign-in rotation COMPLETE — the session becomes a
        // full citizen immediately (opaque session tokens re-read the User
        // row per request, so no token refresh is needed).
        mustChangePassword: false,
      },
    });
    const removed = await tx.session.deleteMany({
      where: {
        userId: user.id,
        ...(currentToken ? { token: { not: currentToken } } : {}),
      },
    });
    return { sessionsRevoked: removed.count };
  });

  await systemLog({
    action: 'PASSWORD_CHANGED_SELF',
    component: LogComponent.AUTH,
    severity: LogSeverity.INFO,
    message: `User ${user.email} changed their own password. ${sessionsRevoked} other session(s) revoked.`,
    storeId: user.storeId ?? undefined,
    metadata: {
      userId: user.id,
      sessionsRevoked,
      currentSessionKept: true,
    },
  });

  // v2.45.0: security notice — the account owner hears about the rotation
  // even when someone ELSE performed it with a stolen-but-working password
  // (the attacker keeps the current session; the victim's other devices
  // are signed out, and this email is the one signal that reaches them).
  // Best-effort by design: a failed send (no RESEND_API_KEY in dev — the
  // send logs to NotificationLog as FAILED) never fails the change itself.
  const changedAtIso = new Date().toISOString();
  await sendEmail({
    to: user.email,
    subject: 'Your MBUMAH HARDWARE password was changed',
    html: passwordChangedTemplate({
      userEmail: user.email,
      changedAtIso,
      sessionsRevoked,
    }),
    text: `Your MBUMAH HARDWARE password was changed on ${changedAtIso}. ${sessionsRevoked} other session(s) were signed out. If this wasn't you, contact your administrator immediately.`,
    userId: user.id,
    type: NotificationType.PASSWORD_CHANGED,
    metadata: { sessionsRevoked, currentSessionKept: true, changedAtIso },
  }).catch(() => undefined);

  return Response.json({
    success: true,
    data: { sessionsRevoked, mustChangePassword: false },
  });
}

export const POST = withErrorBoundary(withSessionAuth(changePasswordHandler), 'PROFILE_PASSWORD_CHANGE');
