import { db } from "@/lib/db";

/** Fire-and-forget audit trail. Never throws into the caller's flow. */
export async function audit(entry: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        meta: entry.meta ? JSON.stringify(entry.meta) : null,
        ip: entry.ip ?? null,
      },
    });
  } catch (err) {
    console.error("[audit] failed to persist", entry.action, err);
  }
}
