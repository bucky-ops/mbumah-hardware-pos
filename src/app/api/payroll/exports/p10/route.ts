// GET /api/payroll/exports/p10?year=YYYY&format=csv|json — SPEC-PATH ALIAS
//
// The EMS spec's Phase 4.6 endpoint list names this exact path
// (`/api/payroll/exports/p10`, spec v2.18.9 "Create:" section). The handler
// has lived at /api/hr/reports/p10 since the reports family shipped; this
// route RE-EXPORTS that handler verbatim so the spec's literal path works
// without a second implementation that could drift. The handler only reads
// query params (year/format) — never the request path — so behavior is
// byte-identical: same guard, same roles, same audit rows, same CSV.
//
// Parity contract (tested in alias-paths-v2160.test.ts):
//   GET /api/payroll/exports/p10 ≡ GET /api/hr/reports/p10
//
// NOTE: Next.js requires route segment config (`dynamic`) to be statically
// declared IN this file — it cannot be re-exported — so only the handler
// is re-exported; the config mirrors the canonical route verbatim.

export { GET } from '../../../hr/reports/p10/route';
export const dynamic = 'force-dynamic';
