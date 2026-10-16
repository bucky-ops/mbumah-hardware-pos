-- v2.25.0: durable email delivery log (NotificationLog).
--
-- The central email service has written every outbound email attempt to
-- this table since the delivery-log code shipped — but the model itself was
-- never added to schema.prisma, so the writes were silently swallowed and
-- GET /api/notifications/logs failed at runtime. This migration creates the
-- table for databases that follow the `prisma migrate deploy` path
-- (fresh Neon branches); existing drifted databases converge via the
-- sync-db-schema.mjs `db push` fallback.

CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "metadata" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- Attribution FK with ON DELETE SET NULL: delivery history must survive user
-- deletion (same pattern as system_logs.user_id).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_logs_user_id_fkey') THEN
        ALTER TABLE "notification_logs"
            ADD CONSTRAINT "notification_logs_user_id_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

CREATE INDEX "notification_logs_type_createdAt_idx" ON "notification_logs"("type", "createdAt");
CREATE INDEX "notification_logs_status_createdAt_idx" ON "notification_logs"("status", "createdAt");
CREATE INDEX "notification_logs_userId_idx" ON "notification_logs"("userId");
CREATE INDEX "notification_logs_createdAt_idx" ON "notification_logs"("createdAt");
