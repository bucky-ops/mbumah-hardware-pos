// GET /api/self-service/me/documents - own document metadata
//     (fileName, type, verification status, expiry). Notes are HR-only and
//     are never included in self-service payloads.

import {
  selfServiceGuard,
  listMyDocuments,
  selfServiceErrorResponse,
} from '@/lib/hr/self-service';

export const dynamic = 'force-dynamic';

export const GET = selfServiceGuard('hr.documents.read.own')(async (_request, _session, employee) => {
  try {
    return Response.json({ success: true, data: await listMyDocuments(employee) });
  } catch (error) {
    return selfServiceErrorResponse(error);
  }
});
