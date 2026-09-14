import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/api/withErrorHandler";
import { roleAtLeast, type Role, type SessionUser } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Route-level auth guards (defense layer 2 — middleware is layer 1).
//
// BOLA/IDOR NOTES
//  • `assertBranchAccess` enforces that the authenticated user may only touch
//    resources belonging to their own branch. OWNERS may cross branches;
//    MANAGER/CASHIER are fenced in.
//  • For every resource read, pass the ROW's branchId here — the middleware
//    only sees URL/query/body hints; the authoritative check is this one,
//    because it compares against the persisted resource, not client input.
// ─────────────────────────────────────────────────────────────────────────────

export async function requireAuth(req: NextRequest): Promise<SessionUser> {
  const user = await getSessionUser(req);
  if (!user) throw ApiError.unauthorized();
  return user;
}

export async function requireRole(req: NextRequest, minRole: Role): Promise<SessionUser> {
  const user = await requireAuth(req);
  if (!roleAtLeast(user.role, minRole)) throw ApiError.forbidden(`Requires ${minRole} role`);
  return user;
}

/** Reject cross-branch access unless the user is an OWNER. */
export function assertBranchAccess(user: SessionUser, resourceBranchId: string | null | undefined): void {
  if (!resourceBranchId) return;
  if (user.role === "OWNER") return;
  if (user.branchId !== resourceBranchId) {
    throw ApiError.forbidden("Cross-branch access denied (BOLA protection)");
  }
}

/** Extract + validate a branchId the client is *targeting* (query or body). */
export function assertTargetBranch(user: SessionUser, targetBranchId: string | null | undefined): void {
  if (!targetBranchId) return;
  if (user.role === "OWNER") return;
  if (user.branchId !== targetBranchId) {
    throw ApiError.forbidden("Branch mismatch between session and request (BOLA protection)");
  }
}
