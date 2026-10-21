-- v2.209.0: the Phase-6 dead-letter queue gains its table. The lib
-- (src/lib/dead-letter-queue.ts) wrote every query against
-- db.deadLetterQueue since Phase 6, but the model never existed in any
-- schema — every DLQ-shaped route was a runtime 500 since birth, masked
-- by zero-fallbacks in the aggregator. This table is the contract the
-- code always assumed: id/storeId/operationType/targetService/payload/
-- status/retryCount/maxRetries/priority/sourceEntity*/lastError/
-- nextRetryAt/resolvedAt/metadata/enqueuedAt/updatedAt, with the indexes
-- the lib's query shapes demand (process: status+nextRetryAt; purge:
-- status+resolvedAt; list order: enqueuedAt; groupBys: operationType +
-- targetService; tenant filter: storeId).

CREATE TABLE "dead_letter_queue" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "operationType" TEXT NOT NULL,
    "targetService" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 5,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "sourceEntityId" TEXT,
    "sourceEntityType" TEXT,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "metadata" TEXT,
    "enqueuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dead_letter_queue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dead_letter_queue_status_nextRetryAt_idx" ON "dead_letter_queue"("status", "nextRetryAt");
CREATE INDEX "dead_letter_queue_status_resolvedAt_idx" ON "dead_letter_queue"("status", "resolvedAt");
CREATE INDEX "dead_letter_queue_enqueuedAt_idx" ON "dead_letter_queue"("enqueuedAt");
CREATE INDEX "dead_letter_queue_operationType_idx" ON "dead_letter_queue"("operationType");
CREATE INDEX "dead_letter_queue_targetService_idx" ON "dead_letter_queue"("targetService");
CREATE INDEX "dead_letter_queue_storeId_idx" ON "dead_letter_queue"("storeId");
