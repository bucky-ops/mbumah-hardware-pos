-- v2.63.0: the desk keeps its own ledger — every desk visit is recorded.
--
-- The leave_requests stamp columns (deskReviewedAt/By*) only ever carry
-- the LATEST visit; every re-open overwrites them. leave_review_visits
-- keeps the full history: WHO looked (visitedById + denormalised
-- visitedByName), WHEN (createdAt), and whether THAT visit cleared a
-- pending re-check marker (clearedRecheck = hadPendingCorrection at write
-- time). The desk dialog renders it as the visit timeline. Cascade delete
-- with the request — the ledger of a deleted request has no meaning.
CREATE TABLE "leave_review_visits" (
    "id" TEXT NOT NULL,
    "leaveRequestId" TEXT NOT NULL,
    "visitedById" TEXT NOT NULL,
    "visitedByName" TEXT NOT NULL,
    "clearedRecheck" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_review_visits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leave_review_visits_leaveRequestId_createdAt_idx" ON "leave_review_visits"("leaveRequestId", "createdAt");

ALTER TABLE "leave_review_visits" ADD CONSTRAINT "leave_review_visits_leaveRequestId_fkey" FOREIGN KEY ("leaveRequestId") REFERENCES "leave_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
