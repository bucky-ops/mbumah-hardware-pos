// GET /api/payroll/exports/statutory?from=&to=&storeId= — SPEC-PATH ALIAS
//
// The EMS spec's Phase 4.6 endpoint list names this exact path
// (`/api/payroll/exports/statutory`, spec v2.18.9 "Create:" section). The
// statutory-debt report handler has lived at /api/hr/reports/statutory-liability;
// this route RE-EXPORTS that handler verbatim so the spec's literal path
// works without a second implementation that could drift. The handler only
// reads query params (from/to/storeId) — never the request path — so
// behavior is byte-identical: same guard, same roles, same scope rules.
//
// Parity contract (tested in alias-paths-v2160.test.ts):
//   GET /api/payroll/exports/statutory ≡ GET /api/hr/reports/statutory-liability
//
// NOTE: Next.js requires route segment config (`dynamic`) to be statically
// declared IN this file — it cannot be re-exported — so only the handler
// is re-exported; the config mirrors the canonical route verbatim.

export { GET } from '../../../hr/reports/statutory-liability/route';
export const dynamic = 'force-dynamic';
