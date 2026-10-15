// GET   /api/hr/employees/[id]/documents - list documents (metadata only)
// POST  /api/hr/employees/[id]/documents - register a document
// PATCH /api/hr/employees/[id]/documents?documentId=... - verify/reject
//
// Documents carry expiry dates for HR expiry alerts. File contents are not
// accepted in this release: registration records fileName and an optional
// external fileUrl (reuse of the platform upload path is planned separately).

import { db } from '@/lib/db';
import { hrGuard } from '@/lib/hr/guard';
import { hrAudit, HrEntityType } from '@/lib/hr/audit';

export const dynamic = 'force-dynamic';

const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;
const WRITE_ROLES = ['HR_MANAGER', 'STORE_OWNER'] as const;

const DOC_TYPES = ['CONTRACT', 'ID_COPY', 'KRA_PIN_CERT', 'NSSF_CARD', 'CERTIFICATE', 'OTHER'] as const;

function resolveStore(session: { role: string; storeId: string | null }, explicit?: string | null): string {
  if (session.role === 'SUPER_ADMIN') return explicit || session.storeId || '';
  return session.storeId || '';
}

async function assertEmployeeInStore(employeeId: string, storeId: string): Promise<boolean> {
  const row = await db.employee.findFirst({
    where: { id: employeeId, storeId, deletedAt: null },
    select: { id: true },
  });
  return Boolean(row);
}

export const GET = hrGuard('hr.employee.read.own_branch', READ_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const storeId = resolveStore(session, new URL(request.url).searchParams.get('storeId'));
    if (!storeId || !(await assertEmployeeInStore(id, storeId))) {
      return Response.json({ success: false, error: 'Employee not found.' }, { status: 404 });
    }

    const documents = await db.employeeDocument.findMany({
      where: { employeeId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        employeeId: true,
        type: true,
        fileName: true,
        fileUrl: true,
        issueDate: true,
        expiryDate: true,
        verificationStatus: true,
        notes: true,
        createdAt: true,
      },
    });

    return Response.json({ success: true, data: documents });
  },
);

export const POST = hrGuard('hr.employee.update', WRITE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const storeId = resolveStore(session);
    if (!storeId || !(await assertEmployeeInStore(id, storeId))) {
      return Response.json({ success: false, error: 'Employee not found.' }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const type = typeof body.type === 'string' && (DOC_TYPES as readonly string[]).includes(body.type)
      ? body.type
      : null;
    const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
    if (!type || !fileName) {
      return Response.json(
        { success: false, error: `type (one of ${DOC_TYPES.join(', ')}) and fileName are required.` },
        { status: 400 },
      );
    }

    const created = await db.employeeDocument.create({
      data: {
        employeeId: id,
        storeId,
        type,
        fileName,
        fileUrl: typeof body.fileUrl === 'string' ? body.fileUrl : null,
        issueDate: typeof body.issueDate === 'string' ? new Date(body.issueDate) : null,
        expiryDate: typeof body.expiryDate === 'string' ? new Date(body.expiryDate) : null,
        notes: typeof body.notes === 'string' ? body.notes : null,
      },
    });

    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'CREATE',
      resourceType: HrEntityType.EMPLOYEE_DOCUMENT,
      resourceId: created.id,
      storeId,
      reason: 'Employee document registered.',
      metadata: { employeeId: id, documentType: type, hasExpiry: Boolean(created.expiryDate) },
    });

    return Response.json({ success: true, data: { id: created.id } }, { status: 201 });
  },
);

export const PATCH = hrGuard('hr.employee.update', WRITE_ROLES)(
  async (request, session, context?: { params: Promise<{ id: string }> }) => {
    const { id } = (await context?.params) ?? { id: '' };
    const storeId = resolveStore(session);
    const documentId = new URL(request.url).searchParams.get('documentId');
    if (!storeId || !documentId) {
      return Response.json({ success: false, error: 'documentId is required.' }, { status: 400 });
    }

    const doc = await db.employeeDocument.findFirst({
      where: { id: documentId, employeeId: id, storeId, deletedAt: null },
      select: { id: true },
    });
    if (!doc) {
      return Response.json({ success: false, error: 'Document not found.' }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
    }

    const status = body.verificationStatus;
    if (status !== 'VERIFIED' && status !== 'REJECTED' && status !== 'PENDING') {
      return Response.json(
        { success: false, error: 'verificationStatus must be PENDING, VERIFIED, or REJECTED.' },
        { status: 400 },
      );
    }

    await db.employeeDocument.update({
      where: { id: documentId },
      data: {
        verificationStatus: status,
        verifiedByUserId: status === 'PENDING' ? null : session.userId,
        verifiedAt: status === 'PENDING' ? null : new Date(),
      },
    });

    await hrAudit({
      actorId: session.userId,
      actorRole: session.role,
      action: 'UPDATE',
      resourceType: HrEntityType.EMPLOYEE_DOCUMENT,
      resourceId: documentId,
      storeId,
      reason: `Document verification status set to ${status}.`,
      metadata: { employeeId: id },
    });

    return Response.json({ success: true, data: { id: documentId, verificationStatus: status } });
  },
);
