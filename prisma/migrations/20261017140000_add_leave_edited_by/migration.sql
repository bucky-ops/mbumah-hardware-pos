-- v2.40.0: governed edit window for pending leave requests ("Corrected by HR").
--
-- HR corrects a PENDING request in place (dates, half-day, type, reason,
-- attachment) instead of the lossy cancel + refile dance. The three new
-- columns stay NULL for untouched requests; the first edit stamps who
-- corrected it, when, and (optionally) a note explaining the change.
-- Nullable: legacy rows converge to the "never edited" interpretation.
ALTER TABLE "leave_requests" ADD COLUMN "editedAt" TIMESTAMP(3);
ALTER TABLE "leave_requests" ADD COLUMN "editedByName" TEXT;
ALTER TABLE "leave_requests" ADD COLUMN "editNote" TEXT;
