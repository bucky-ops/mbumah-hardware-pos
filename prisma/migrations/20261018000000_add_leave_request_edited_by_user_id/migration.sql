-- v2.45.0: deterministic provenance for the leave edit window.
-- The User.id of whoever corrected the request, so the portal card can
-- distinguish "Corrected by you" (employee self-correction) from
-- "Corrected by HR" without name matching. NULL for pre-v2.45.0 edits
-- (those keep rendering from the name columns) and for never-edited rows.

ALTER TABLE "LeaveRequest" ADD COLUMN "editedByUserId" TEXT;
