// GET/POST /api/tax/filings
//
// AUDIT FIX (Task 3-f): POST previously persisted client-supplied totalSales /
// totalTax with NO server verification — a caller could file any figures it
// liked. The handler now recomputes the period's sales + VAT directly from
// SalesTransaction rows and stores the SERVER-computed totals as authoritative.
// If the declared figures differ by more than DISCREPANCY_THRESHOLD (KES 0.05),
// the response carries additive `discrepancy` + `hasDiscrepancy` + `warning`
// fields (filing corrections are a business workflow — we flag, not fail).
// Existing response consumers are unaffected (additive fields only).

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import {
  withSessionAuth,
  getSessionFromRequest,
  FINANCIAL_ROLES,
  type AuthSession,
} from '@/lib/auth';
// AUDIT FIX (Task 3-f): canonical VAT-exclusive revenue formula + KES/Money
// (HALF_EVEN) rounding for all persisted filing totals.
import { grossRevenue } from '@/lib/profit';
import { KES, Money } from '@/lib/money';

export const dynamic = 'force-dynamic';

/** Max tolerated |declared − computed| per figure before flagging (KES). */
const DISCREPANCY_THRESHOLD = 0.05;

async function getTaxFilingsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const filingType = searchParams.get('filingType');
  const status = searchParams.get('status');
  const filingPeriod = searchParams.get('filingPeriod');
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');
  const sortBy = searchParams.get('sortBy') || 'createdAt';
  const sortOrder = searchParams.get('sortOrder') || 'desc';

  const where: Record<string, unknown> = { storeId };

  if (filingType) {
    where.filingType = filingType;
  }

  if (status) {
    where.status = status;
  }

  if (filingPeriod) {
    where.filingPeriod = filingPeriod;
  }

  if (dateFrom || dateTo) {
    const createdAt: Record<string, Date> = {};
    if (dateFrom) createdAt.gte = new Date(dateFrom);
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }
    where.createdAt = createdAt;
  }

  const validSortFields = ['filingPeriod', 'filingType', 'totalTax', 'status', 'createdAt'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
  const orderDirection = sortOrder === 'asc' ? 'asc' : 'desc';

  const [filings, total] = await Promise.all([
    db.taxFiling.findMany({
      where,
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.taxFiling.count({ where }),
  ]);

  // Summary stats
  const summary = await db.taxFiling.aggregate({
    where,
    _sum: { totalSales: true, totalTax: true, totalWht: true },
    _count: true,
  });

  return Response.json({
    success: true,
    data: filings,
    summary: {
      totalSales: summary._sum.totalSales || 0,
      totalTax: summary._sum.totalTax || 0,
      totalWht: summary._sum.totalWht || 0,
      count: summary._count,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createTaxFilingHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  // AUDIT FIX (Task 3-f): pull the authenticated session for store scoping.
  // NOTE: withSessionAuth invokes handler(...args) WITHOUT injecting the
  // session (unlike requireStoreAccess), so the session is re-resolved here —
  // the established in-handler pattern (gift-cards / debt / data-exports).
  const session: AuthSession | null = await getSessionFromRequest(request);
  const body = await request.json();

  const {
    storeId,
    filingPeriod,
    filingType,
    totalSales,
    totalTax,
    totalWht,
    filingDate,
    dueDate,
    etimsReference,
    notes,
    filedBy,
  } = body;

  if (!storeId || !filingPeriod || !filingType) {
    return Response.json(
      { success: false, error: 'storeId, filingPeriod, and filingType are required.' },
      { status: 400 }
    );
  }

  // AUDIT FIX (Task 3-f): session-based store scoping. A non-SUPER_ADMIN user
  // with a store assignment may only file for their own store (previously the
  // body storeId was trusted blindly). Org-level users (no store assignment)
  // keep cross-store capability, mirroring auth.ts runWithSessionTenant.
  if (
    session &&
    session.role !== 'SUPER_ADMIN' &&
    session.storeId &&
    session.storeId !== storeId
  ) {
    return Response.json(
      { success: false, error: 'You can only file tax returns for your own store.' },
      { status: 403 }
    );
  }

  const validTypes = ['VAT', 'WHT', 'INCOME_TAX', 'TURNOVER_TAX'];
  if (!validTypes.includes(filingType)) {
    return Response.json(
      { success: false, error: `Invalid filingType. Must be one of: ${validTypes.join(', ')}` },
      { status: 400 }
    );
  }

  // ── AUDIT FIX (Task 3-f): server-side recompute of declared totals ─────────
  // Declared figures are parsed defensively (a garbage string previously hit
  // the Prisma Decimal column and 500'd; now it degrades to 0 + a warning).
  const declaredSalesProvided = totalSales !== undefined && totalSales !== null;
  const declaredTaxProvided = totalTax !== undefined && totalTax !== null;
  const declaredSales = Money.tryParse(declaredSalesProvided ? totalSales : 0) ?? KES(0);
  const declaredTax = Money.tryParse(declaredTaxProvided ? totalTax : 0) ?? KES(0);

  // The filing period is "YYYY-MM" (schema doc + tax-tab UI). Month boundaries
  // are resolved in UTC (SalesTransaction.createdAt is stored UTC).
  const periodMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(filingPeriod));

  let computedSales: number | null = null;
  let computedTax: number | null = null;
  let recomputeNote = 'OK';
  let sourceTransactionCount = 0;

  if (periodMatch) {
    const year = Number(periodMatch[1]);
    const month = Number(periodMatch[2]); // 1-12 by regex
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEndExclusive = new Date(Date.UTC(year, month, 1));

    // Same scope as the reporting endpoints (sales-summary / daily): SALE
    // transactions that reached COMPLETED or PARTIAL payment. REFUND / VOID /
    // PENDING rows are excluded — refund netting is a documented limitation
    // shared with the reports until a dedicated credit-note flow exists.
    const posAggregate = await db.salesTransaction.aggregate({
      where: {
        storeId,
        createdAt: { gte: periodStart, lt: periodEndExclusive },
        transactionType: 'SALE',
        paymentStatus: { in: ['COMPLETED', 'PARTIAL'] },
      },
      _sum: { totalAmount: true, taxAmount: true },
      _count: true,
    });

    // totalSales = VAT-exclusive revenue: Σ(totalAmount − taxAmount) via the
    // canonical grossRevenue() helper. totalTax = Σ taxAmount. Both are the
    // SERVER-computed, authoritative figures (KRA VAT returns declare the
    // taxable value exclusive of VAT).
    computedSales = grossRevenue(posAggregate._sum.totalAmount, posAggregate._sum.taxAmount);
    computedTax = KES(posAggregate._sum.taxAmount || 0).round().toNumber();
    sourceTransactionCount = posAggregate._count;
  } else {
    // Unparseable period — nothing to recompute against. Legacy behaviour
    // (store declared totals) with an explicit warning; hard-failing here
    // would break existing consumers that file non-YYYY-MM periods.
    recomputeNote = 'FILING_PERIOD_NOT_YYYY_MM — server recompute skipped; declared totals stored unverified.';
  }

  // Authoritative stored totals = server-computed when available. totalWht has
  // no POS data source (no withholding rows in SalesTransaction) and remains
  // as declared — documented limitation.
  const storedTotalSales = computedSales !== null ? KES(computedSales).toDecimal() : declaredSales.toDecimal();
  const storedTotalTax = computedTax !== null ? KES(computedTax).toDecimal() : declaredTax.toDecimal();

  // Discrepancy check (per figure, > KES 0.05 → flag, don't fail). Deltas are
  // only meaningful when a server recompute exists (both figures are set or
  // skipped together); otherwise 0 — no flag.
  const salesDelta = computedSales !== null ? declaredSales.subtract(KES(computedSales)).toNumber() : 0;
  const taxDelta = computedTax !== null ? declaredTax.subtract(KES(computedTax)).toNumber() : 0;
  const hasDiscrepancy =
    (computedSales !== null && Math.abs(salesDelta) > DISCREPANCY_THRESHOLD) ||
    (computedTax !== null && Math.abs(taxDelta) > DISCREPANCY_THRESHOLD);

  const discrepancy = hasDiscrepancy
    ? {
        declared: { totalSales: declaredSales.toNumber(), totalTax: declaredTax.toNumber() },
        computed: { totalSales: computedSales, totalTax: computedTax },
        delta: { totalSales: salesDelta, totalTax: taxDelta },
        threshold: DISCREPANCY_THRESHOLD,
      }
    : undefined;

  const filing = await db.taxFiling.create({
    data: {
      storeId,
      filingPeriod,
      filingType,
      totalSales: storedTotalSales,
      totalTax: storedTotalTax,
      totalWht: Money.tryParse(totalWht !== undefined && totalWht !== null ? totalWht : 0)?.toDecimal() ?? KES(0).toDecimal(),
      status: 'DRAFT',
      filingDate: filingDate ? new Date(filingDate) : null,
      dueDate: dueDate ? new Date(dueDate) : null,
      etimsReference: etimsReference || null,
      notes: notes || null,
      filedBy: filedBy || null,
    },
  });

  await systemLog({
    action: 'TAX_FILING_CREATED',
    component: LogComponent.FINANCIAL,
    severity: hasDiscrepancy ? LogSeverity.WARN : LogSeverity.INFO,
    message: `Tax filing created: ${filingType} for period ${filingPeriod}${hasDiscrepancy ? ' (SERVER/DISCREPANCY: stored totals are server-computed; declared figures differed by more than KES 0.05)' : ''}`,
    storeId,
    userId: session?.userId || filedBy || undefined,
    metadata: {
      taxFilingId: filing.id,
      filingPeriod,
      filingType,
      // AUDIT FIX (Task 3-f): audit trail of declared vs computed figures.
      declared: { totalSales: declaredSales.toNumber(), totalTax: declaredTax.toNumber() },
      computed: { totalSales: computedSales, totalTax: computedTax },
      hasDiscrepancy,
      sourceTransactionCount,
      recomputeNote,
      totalTax: storedTotalTax.toNumber(),
    },
  });

  // Additive response fields only — existing consumers of `{ success, data }`
  // keep working; verification detail is extra.
  return Response.json(
    {
      success: true,
      data: filing,
      // AUDIT FIX (Task 3-f): server verification block (always present).
      serverVerification: {
        method: 'SALES_TRANSACTION_AGGREGATE',
        scope: { transactionType: 'SALE', paymentStatus: ['COMPLETED', 'PARTIAL'] },
        sourceTransactionCount,
        computedTotalSales: computedSales,
        computedTotalTax: computedTax,
        storedTotalsAuthoritative: computedSales !== null,
        note: recomputeNote,
      },
      ...(discrepancy
        ? {
            hasDiscrepancy,
            discrepancy,
            warning:
              'Declared totals differ from the server-computed POS figures by more than KES 0.05. The filing was stored with the SERVER-computed totals; reconcile the declared figures before submission.',
          }
        : {}),
    },
    { status: 201 }
  );
}

export const GET = withErrorBoundary(withSessionAuth(getTaxFilingsHandler, FINANCIAL_ROLES.WRITE), 'TAX_FILINGS_LIST');
export const POST = withErrorBoundary(withSessionAuth(createTaxFilingHandler, FINANCIAL_ROLES.WRITE), 'TAX_FILINGS_CREATE');
