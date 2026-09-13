-- v2.5.5 (data-export download fix): inline copy of the generated export
-- file (CSV/JSON text) stored at creation time. The download endpoint
-- (GET /api/data-exports/[id]/download) reads this first because the
-- on-disk tmp file written during POST is ephemeral on Vercel serverless
-- (per-instance) and usually gone by download time. Nullable: legacy rows
-- keep working via the self-hosted file-path fallback.
ALTER TABLE "data_exports" ADD COLUMN "content" TEXT;
