// GET /api/etims/customer-search?tin=xxx
//
// Search a customer by KRA PIN via the eTIMS taxpayer-lookup endpoint.
// Returns the customer's name and address (KRA does not return contact details).
//
// Query params:
//   tin — required (KRA PIN, format A + 9 digits + letter)
//
// Auth: any authenticated user (cashiers may look up a B2B customer's name
// before issuing an invoice).
//
// Flow:
//   1. Validate the PIN format.
//   2. Load the store's EtimsClient.
//   3. Call customerSearch(tin).
//   4. Return the customer (or null if not found).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireStoreAccess } from '@/lib/auth';
import { initializeEtimsClientFromStore } from '@/lib/etims-service';
import { validateKraPin } from '@/lib/etims-utils';

export const dynamic = 'force-dynamic';

async function customerSearchHandler(
  request: NextRequest,
  session: { userId: string; role: string; storeId: string | null; email: string },
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const tinRaw = searchParams.get('tin') || '';
  const storeId = searchParams.get('storeId') || session.storeId;

  if (!storeId) {
    return Response.json({ success: false, error: 'storeId is required.' }, { status: 400 });
  }

  // ── 1. Validate PIN ───────────────────────────────────────────────────────
  const pinCheck = validateKraPin(tinRaw);
  if (!pinCheck.valid || !pinCheck.normalized) {
    return Response.json(
      { success: false, error: pinCheck.error || 'Invalid KRA PIN.' },
      { status: 400 },
    );
  }
  const tin = pinCheck.normalized;

  // ── 2. Look up existing Customer locally (cache hit) ──────────────────────
  // We try to find a Customer with this TIN (stored in idNumber) locally first.
  // If found, we still hit KRA to refresh the name (in case it changed), but we
  // return the local customerId so the UI can pre-fill the form.
  const localCustomer = await db.customer.findFirst({
    where: { storeId, idNumber: tin },
    select: { id: true, name: true, phone: true, email: true, address: true, idNumber: true },
  });

  // ── 3. Load eTIMS client ──────────────────────────────────────────────────
  const client = await initializeEtimsClientFromStore(storeId);
  if (!client) {
    // No eTIMS profile — return only the local record (if any).
    return Response.json({
      success: true,
      data: {
        tin,
        customer: localCustomer
          ? {
              tin,
              name: localCustomer.name,
              address: localCustomer.address || undefined,
              email: localCustomer.email || undefined,
              phone: localCustomer.phone || undefined,
              localCustomerId: localCustomer.id,
            }
          : null,
        source: 'local',
      },
      message: localCustomer
        ? 'Customer found in local records (no KRA profile configured).'
        : 'No KRA profile configured and no local customer found.',
    });
  }

  // ── 4. Query KRA ──────────────────────────────────────────────────────────
  const result = await client.customerSearch(tin);

  // ── 5. Audit log ──────────────────────────────────────────────────────────
  await systemLog({
    action: 'ETIMS_CUSTOMER_SEARCH',
    component: LogComponent.AUTH,
    severity: LogSeverity.INFO,
    message: `eTIMS customer lookup for TIN ${tin}: ${result.success ? 'found' : 'not found'} — ${result.customer?.name || result.errorMessage}`,
    userId: session.userId,
    storeId,
    metadata: {
      tin,
      found: !!result.customer,
      localMatch: !!localCustomer,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
    },
  });

  return Response.json({
    success: result.success,
    data: {
      tin,
      customer: result.customer
        ? {
            ...result.customer,
            tin,
            localCustomerId: localCustomer?.id,
          }
        : null,
      result,
    },
    message: result.success
      ? result.customer
        ? `Customer found: ${result.customer.name}.`
        : 'PIN is valid but no taxpayer record returned.'
      : `Search failed: ${result.errorMessage || 'unknown error'}.`,
  });
}

export const GET = withErrorBoundary(
  requireStoreAccess(customerSearchHandler),
  'ETIMS_CUSTOMER_SEARCH',
);
