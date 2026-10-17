-- v2.85.0: the walk gains its missing step. Submit-for-approval was the ONE
-- lifecycle transition with no timestamp column — its stamp rode inside
-- preparedAt (the submit action stamped preparedAt/preparedByUserId AT SUBMIT
-- TIME). The backfill copies that fact into its properly-named column, so
-- every run already past DRAFT shows the full walk without a guess: for every
-- pre-existing row, preparedAt IS the submission's stamp.

ALTER TABLE "payroll_runs" ADD COLUMN "submittedAt" TIMESTAMP(3);
ALTER TABLE "payroll_runs" ADD COLUMN "submittedById" TEXT;

UPDATE "payroll_runs"
SET "submittedAt" = "preparedAt",
    "submittedById" = "preparedByUserId"
WHERE "submittedAt" IS NULL
  AND "preparedAt" IS NOT NULL;
