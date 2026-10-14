// Engraved admin — self-healing super-user (STEP 4 spec).
//
// The engraved admin is the bootstrappable SUPER_ADMIN account:
//   • email    admin@mbumahhardware.co.ke
//   • role     SUPER_ADMIN, isEngraved + isSystem flags set
//   • password re-stamped ONLY when the row is created or marked for repair
//
// Healing runs from POST /api/system/post, POST /api/system/heal and
// fire-and-forget from /api/auth/me — so even if the users table or the whole
// DB file is deleted, the next boot recreates org store + admin.
//
// DELETE / deactivate / demote of the engraved admin is refused with
// 403 ENGRAVED_ADMIN_PROTECTED (guarded in /api/users).

import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth-utils";

export const ENGRAVED_ADMIN = {
  email: "admin@mbumahhardware.co.ke",
  name: "System Administrator",
  role: "SUPER_ADMIN",
  password: "password123", // seeded default; rotation recommended (SECURITY.md)
} as const;

export function isEngravedAdmin(user: { email?: string | null; isEngraved?: boolean } | null): boolean {
  return Boolean(user && (user.isEngraved || user.email?.toLowerCase() === ENGRAVED_ADMIN.email));
}

/**
 * Upsert the engraved admin. Returns { created, repaired }:
 *  • created  — row did not exist (fresh DB / deleted file) → full insert
 *  • repaired — row existed but had drifted (wrong role / inactive /
 *               missing flags) → role + flags restored, password untouched
 */
export async function ensureEngravedAdmin(): Promise<{
  created: boolean;
  repaired: boolean;
  email: string;
  branchId: string;
}> {
  const branch =
    (await db.branch.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } })) ??
    (await db.branch.create({
      data: {
        code: "juja-main",
        name: "Juja Main",
        slug: "juja-main",
        subdomain: "juja-main.mbumah.co.ke",
        town: "Juja",
        location: "Kimbo Junction, Garissa Rd, Juja",
        kraPin: "P051234567X",
        brandColor: "#B45309",
      },
    }));

  const existing = await db.user.findUnique({ where: { email: ENGRAVED_ADMIN.email } });

  if (!existing) {
    const created = await db.user.create({
      data: {
        email: ENGRAVED_ADMIN.email,
        name: ENGRAVED_ADMIN.name,
        role: ENGRAVED_ADMIN.role,
        passwordHash: hashPassword(ENGRAVED_ADMIN.password),
        branchId: branch.id,
        isActive: true,
        isEngraved: true,
        isSystem: true,
        phone: "0795191909",
      },
    });
    return { created: true, repaired: false, email: created.email, branchId: created.branchId };
  }

  const drifted =
    existing.role !== ENGRAVED_ADMIN.role || !existing.isActive || !existing.isEngraved || !existing.isSystem;
  if (drifted) {
    await db.user.update({
      where: { email: ENGRAVED_ADMIN.email },
      data: { role: ENGRAVED_ADMIN.role, isActive: true, isEngraved: true, isSystem: true },
    });
  }
  return { created: false, repaired: drifted, email: existing.email, branchId: existing.branchId };
}
