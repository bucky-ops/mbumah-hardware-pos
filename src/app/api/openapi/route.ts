// GET /api/openapi — machine-readable API contract.
//
// AUDIT FIX (Finding 6.2 — missing API documentation): serves the
// hand-maintained OpenAPI 3.0.3 document from src/lib/openapi.ts so the
// frontend team, integration partners, and future client-SDK generation all
// share one contract instead of reverse-engineering route handlers.
//
// Public (like /api/health): the spec describes shapes, contains no secrets,
// and the underlying README already documents the endpoints in prose.

import { OPENAPI_SPEC } from '@/lib/openapi';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(OPENAPI_SPEC);
}
