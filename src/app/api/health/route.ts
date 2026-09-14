import { NextResponse } from "next/server";

import { withErrorHandler } from "@/lib/api-error-handler";
import { db } from "@/lib/db";

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/health — public liveness probe (allowlisted in middleware).
//
// Reports process reachability plus database reachability (cheap SELECT 1).
// The probe NEVER throws: a down database still yields HTTP 200 with
// db:"down" so orchestrators can distinguish "app dead" from "db dead".
// No internals (versions, hostnames, paths) are exposed.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic"; // a cached health check is worthless

export const GET = withErrorHandler(async () => {
  let dbStatus: "up" | "down" = "down";
  try {
    await db.$queryRaw`SELECT 1`;
    dbStatus = "up";
  } catch {
    dbStatus = "down";
  }
  return NextResponse.json({ status: "ok", time: new Date().toISOString(), db: dbStatus });
});
