// MBUMAH HARDWARE POS - Engraved Bootstrap Admin (self-healing, v2.14.0)
//
// The "engraved" admin is the one identity a fresh deployment can always log
// in with. On every boot (/api/auth/me) the app fire-and-forget calls
// ensureEngravedAdminExists(), which idempotently (re-)ensures that identity:
//
//   - missing            -> created (org/store bootstrapped if absent)
//   - deactivated        -> re-activated (+ password re-stamped)
//   - demoted            -> role reset to SUPER_ADMIN
//   - engraved flag lost -> isEngraved/isSystem re-stamped
//   - healthy            -> untouched (password is never needlessly rewritten,
//                           so an operator-changed password survives reboots)
//
// Constants mirror prisma/seed.ts exactly so local dev logins keep working:
//   email    admin@mbumahhardware.co.ke  (override with SUPER_ADMIN_EMAIL)
//   password password123                 (override with SUPER_ADMIN_PASSWORD)
//   org      org_mbumah / MBUMAH HARDWARE
//   store    store_juja_main / MBUMAH HARDWARE - Juja Main
//
// SSR-safe: server-only imports, no browser globals, never throws.

import bcrypt from 'bcryptjs';
import { db, runWithoutTenant } from '@/lib/db';

/** Canonical engraved identity - mirrors prisma/seed.ts (stage 3). */
export const ENGRAVED_ADMIN = {
  email: process.env.SUPER_ADMIN_EMAIL || 'admin@mbumahhardware.co.ke',
  name: process.env.SUPER_ADMIN_NAME || 'System Administrator',
  role: 'SUPER_ADMIN',
  isEngraved: true,
  isSystem: true,
} as const;

/**
 * Fallback password - matches prisma/seed.ts so local dev logins keep
 * working. Override with SUPER_ADMIN_PASSWORD in production deployments.
 * Only ever WRITTEN on create/repair (never on healthy boots).
 */
export const ENGRAVED_ADMIN_PASSWORD: string =
  process.env.SUPER_ADMIN_PASSWORD || 'password123';

/** Seed-aligned bootstrap org (prisma/seed.ts stage 1). */
export const ENGRAVED_ADMIN_ORG = {
  id: 'org_mbumah',
  name: 'MBUMAH HARDWARE',
  taxPin: 'P051234567A',
  status: 'ACTIVE',
} as const;

/** Seed-aligned main store (prisma/seed.ts stage 2). */
export const ENGRAVED_ADMIN_STORE = {
  id: 'store_juja_main',
  organizationId: ENGRAVED_ADMIN_ORG.id,
  name: 'MBUMAH HARDWARE - Juja Main',
  location: 'Salama M-Store, Juja',
  address: 'P.O. Box 9101-00300, Nairobi',
  phone: '0795191909',
  email: 'info@mbumahhardware.co.ke',
  taxPin: 'P051234567A',
  status: 'ACTIVE',
} as const;

export interface EngravedAdminResult {
  /** True only when the user row had to be created from nothing. */
  created: boolean;
  email: string;
  /** Machine-readable outcome: 'created' | 'repaired' | 'already-engraved' | 'error: ...'. */
  reason: string;
  /** User id of the engraved row when resolvable. */
  id?: string;
}

/**
 * Idempotently ensure the engraved bootstrap admin exists, is active, holds
 * the SUPER_ADMIN role and is flagged engraved/system. Safe to call on every
 * boot. Never throws - failures come back as `reason: 'error: ...'`.
 */
export async function ensureEngravedAdminExists(): Promise<EngravedAdminResult> {
  const email = ENGRAVED_ADMIN.email;
  try {
    return await runWithoutTenant(async () => {
      const existing = await db.user.findUnique({
        where: { email },
        select: {
          id: true,
          role: true,
          isActive: true,
          isEngraved: true,
          isSystem: true,
          storeId: true,
        },
      });

      // Healthy: nothing to do (deliberately no password rewrite).
      if (
        existing &&
        existing.isEngraved &&
        existing.isSystem &&
        existing.role === 'SUPER_ADMIN' &&
        existing.isActive
      ) {
        return { created: false, email, reason: 'already-engraved', id: existing.id };
      }

      // Resolve the org + store FKs BEFORE any create (seed-aligned ids).
      const org = await db.organization.upsert({
        where: { id: ENGRAVED_ADMIN_ORG.id },
        update: {},
        create: { ...ENGRAVED_ADMIN_ORG },
      });
      const store = await db.store.upsert({
        where: { id: ENGRAVED_ADMIN_STORE.id },
        update: {},
        create: { ...ENGRAVED_ADMIN_STORE, organizationId: org.id },
      });

      if (!existing) {
        const passwordHash = await bcrypt.hash(ENGRAVED_ADMIN_PASSWORD, 12);
        const created = await db.user.create({
          data: {
            email,
            name: ENGRAVED_ADMIN.name,
            role: ENGRAVED_ADMIN.role,
            passwordHash,
            organizationId: org.id,
            storeId: store.id,
            phone: ENGRAVED_ADMIN_STORE.phone,
            isActive: true,
            isEngraved: true,
            isSystem: true,
          },
          select: { id: true },
        });
        return { created: true, email, reason: 'created', id: created.id };
      }

      // Damaged (deactivated / demoted / un-engraved) - repair it, including
      // the password, so a boot always restores a working login.
      const passwordHash = await bcrypt.hash(ENGRAVED_ADMIN_PASSWORD, 12);
      await db.user.update({
        where: { id: existing.id },
        data: {
          organizationId: org.id,
          storeId: existing.storeId ?? store.id,
          role: 'SUPER_ADMIN',
          isActive: true,
          isEngraved: true,
          isSystem: true,
          passwordHash,
        },
      });
      return { created: false, email, reason: 'repaired', id: existing.id };
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return { created: false, email, reason: `error: ${detail.slice(0, 160)}` };
  }
}

/** Whether the given user id is the engraved (protected) bootstrap admin. */
export async function isEngravedUser(userId: string): Promise<boolean> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { isEngraved: true },
    });
    return user?.isEngraved === true;
  } catch {
    return false;
  }
}
