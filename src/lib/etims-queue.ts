// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — KRA eTIMS Async Queue (v2.6.0)
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THIS EXISTS
// ───────────────
// KRA eTIMS availability must NEVER block (or fail) a POS checkout. Sales
// commit with `SalesTransaction.etimsStatus = 'PENDING'` and the KRA invoice
// is issued asynchronously through the transactional outbox:
//
//   1. Checkout enqueues an OutboxEvent kind='ETIMS_INVOICE' right after the
//      sale commits (non-blocking, best-effort).
//   2. The opportunistic post-checkout pump AND /api/cron/etims-retry claim
//      due events and drive ONE submission attempt each via
//      `submitEtimsInvoiceOnce` below.
//   3. Staff can force a batch from the UI via POST /api/etims/worker.
//
// This module holds the SHARED core so the manual route
// (/api/etims/issue-invoice), the outbox pump and the retry cron all run the
// exact same submission logic — one implementation, three triggers.
//
// Server-only module.
// ─────────────────────────────────────────────────────────────────────────────

import { db, runWithoutTenant } from '@/lib/db';
import { getEtimsConfig, initializeEtimsClient, isEtimsMock } from '@/lib/etims-service';
import { generateInvoiceNumber } from '@/lib/etims-utils';
import { systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';

/** Result of ONE eTIMS submission attempt for one transaction. */
export interface EtimsSubmissionResult {
  ok: boolean;
  /** KRA invoice number (also persisted to SalesTransaction.etimsInvoiceNumber). */
  invoiceNumber?: string;
  /** KRA verification URL (SalesTransaction.etimsUrl). */
  url?: string;
  /** QR payload (SalesTransaction.etimsQrCode). */
  qr?: string;
  /** Always 'ISSUED' when ok — mirrors the EtimsInvoiceResponse contract. */
  status?: 'ISSUED';
  issuedAt?: Date;
  /** True when the invoice was ALREADY issued (idempotent no-op success). */
  skipped?: boolean;
  /** Human-readable failure reason (safe to surface — no secrets). */
  error?: string;
}

// Same compliance message the manual route returns as a 503 — kept in ONE
// place so the async queue surfaces the identical control.
const MOCK_BLOCK_ERROR =
  'eTIMS integration is a mock — refusing to issue a tax invoice that was never transmitted to KRA (compliance control). Integrate the real KRA API or set ETIMS_ALLOW_MOCK_ISSUANCE=true to override.';

/**
 * Perform ONE KRA eTIMS submission attempt for a committed SalesTransaction.
 *
 * Runs inside `runWithoutTenant` — the retry cron and the manual worker are
 * cross-store by design (they claim events from ALL stores); the manager-gated
 * worker route relies on that scope for other stores' stuck events.
 *
 * Idempotent: a transaction already marked ISSUED short-circuits to
 * `{ ok: true, skipped: true }` so a duplicate event/pump never double-bills
 * the sequence counter.
 */
export async function submitEtimsInvoiceOnce(
  transactionId: string,
): Promise<EtimsSubmissionResult> {
  return runWithoutTenant(async (): Promise<EtimsSubmissionResult> => {
    const transaction = await db.salesTransaction.findUnique({
      where: { id: transactionId },
      include: {
        customer: true,
        items: { include: { product: true } },
        store: { select: { code: true } },
      },
    });

    if (!transaction) {
      return { ok: false, error: 'Transaction not found' };
    }

    // Idempotency: the invoice already exists — report success without
    // consuming another sequence number.
    if (transaction.etimsStatus === 'ISSUED') {
      return {
        ok: true,
        skipped: true,
        invoiceNumber: transaction.etimsInvoiceNumber ?? undefined,
        url: transaction.etimsUrl ?? undefined,
        qr: transaction.etimsQrCode ?? undefined,
        status: 'ISSUED',
        issuedAt: transaction.etimsIssuedAt ?? undefined,
      };
    }

    // F9-2 compliance control (same gate as the manual route): never mint
    // fake tax invoices against the mock client in production.
    if (isEtimsMock() && process.env.ETIMS_ALLOW_MOCK_ISSUANCE !== 'true') {
      return { ok: false, error: MOCK_BLOCK_ERROR };
    }

    const config = getEtimsConfig();
    const client = initializeEtimsClient(config);

    // Per-store daily sequence (F9-2): deterministic, store-scoped — the
    // same counting rule the manual route has always used.
    const dayStart = new Date(transaction.createdAt);
    dayStart.setHours(0, 0, 0, 0);
    const invoiceCount = await db.salesTransaction.count({
      where: {
        storeId: transaction.storeId,
        etimsStatus: 'ISSUED',
        createdAt: { gte: dayStart, lte: transaction.createdAt },
      },
    });

    const invoiceNumber = generateInvoiceNumber(
      transaction.store?.code || 'MBM',
      invoiceCount + 1,
      transaction.createdAt,
    );

    // NOTE: Customer has no dedicated kraPin column yet; the legacy
    // issue-invoice route read it defensively off the relation. Keep the
    // behaviour without tripping strict TS via a structural cast.
    const customerWithPin = transaction.customer as
      | (NonNullable<typeof transaction.customer> & { kraPin?: string })
      | null;

    try {
      const response = await client.issueInvoice({
        invoiceNumber,
        date: transaction.createdAt,
        customerTin: customerWithPin?.kraPin || undefined,
        customerName: transaction.customer?.name || 'Walk-in Customer',
        items: transaction.items.map((item) => ({
          itemCode: item.product?.etimsItemCode || 'ITEM00000',
          name: item.product?.name || 'Unknown',
          quantity: Number(item.quantity),
          price: Number(item.pricePerUnit),
          // F9-2: per-line tax rate (zero-rated/exempt lines must not be
          // over-declared to KRA).
          taxRate: Number(item.taxRate) / 100,
          // F9-2: line discount DERIVED from discountPercent (SaleItem has
          // no discountAmount column).
          discount:
            (Number(item.pricePerUnit) * Number(item.quantity) * Number(item.discountPercent || 0)) /
            100,
        })),
        payments: [
          {
            method: transaction.paymentMethod,
            amount: Number(transaction.totalAmount),
          },
        ],
        totalAmount: Number(transaction.totalAmount),
        vatAmount: Number(transaction.taxAmount || 0),
      });

      await db.salesTransaction.update({
        where: { id: transactionId },
        data: {
          etimsInvoiceNumber: response.invoiceNumber,
          etimsQrCode: response.qrCode,
          etimsUrl: response.url,
          etimsStatus: response.status === 'ISSUED' ? 'ISSUED' : 'PENDING',
          etimsIssuedAt: response.issuedAt,
        },
      });

      return {
        ok: response.status === 'ISSUED',
        invoiceNumber: response.invoiceNumber,
        url: response.url,
        qr: response.qrCode,
        status: response.status === 'ISSUED' ? 'ISSUED' : undefined,
        issuedAt: response.issuedAt,
        error: response.status === 'ISSUED' ? undefined : `KRA returned status ${response.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Unknown eTIMS submission failure',
      };
    }
  });
}

// ── Retry batch runner ───────────────────────────────────────────────────────

/** Default claim size per invocation (spec: up to 10 due events per run). */
export const ETIMS_RETRY_BATCH = 10;

/** Shape of the ETIMS_INVOICE outbox payload (written by checkout). */
interface EtimsEventPayload {
  transactionId?: string;
  receiptNumber?: string;
}

/** Per-item outcome reported by the retry runner (no secrets). */
export interface EtimsRetryItemResult {
  eventId: string;
  transactionId: string | null;
  receiptNumber: string | null;
  ok: boolean;
  /** True when the event was already ISSUED (idempotent skip). */
  skipped?: boolean;
  /** True when the event hit maxAttempts and was dead-lettered. */
  dead?: boolean;
  error?: string;
}

export interface EtimsRetryBatchResult {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
  results: EtimsRetryItemResult[];
}

/**
 * Claim and process ONE batch of due ETIMS_INVOICE outbox events.
 *
 * Claim idiom mirrors src/lib/outbox.ts pumpOutbox: an atomic guarded
 * `updateMany` compare-and-set (PENDING/FAILED → PROCESSING) so two
 * concurrent runners (cron + manual worker + opportunistic pump) can never
 * double-process the same event. Backoff on failure: min(2^attempts × 60s, 1h);
 * after maxAttempts the event is DEAD, a systemLog ERROR is emitted, and the
 * SalesTransaction deliberately KEEPS etimsStatus='PENDING' so staff can
 * re-issue via POST /api/etims/worker or /api/etims/issue-invoice.
 */
export async function processEtimsRetryBatch(
  batchSize: number = ETIMS_RETRY_BATCH,
): Promise<EtimsRetryBatchResult> {
  return runWithoutTenant(async (): Promise<EtimsRetryBatchResult> => {
    const now = new Date();
    const due = await db.outboxEvent.findMany({
      where: {
        kind: 'ETIMS_INVOICE',
        status: { in: ['PENDING', 'FAILED'] },
        availableAt: { lte: now },
      },
      orderBy: { availableAt: 'asc' },
      take: Math.max(1, Math.min(batchSize, 50)),
    });

    let succeeded = 0;
    let failed = 0;
    let dead = 0;
    const results: EtimsRetryItemResult[] = [];

    for (const event of due) {
      // Atomic claim — count===0 ⇒ another runner won the race.
      const claimed = await db.outboxEvent.updateMany({
        where: { id: event.id, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'PROCESSING' },
      });
      if (claimed.count === 0) continue;

      let payload: EtimsEventPayload = {};
      try {
        payload = JSON.parse(event.payload || '{}') as EtimsEventPayload;
      } catch {
        /* malformed payload → dead-letter path below */
      }
      const transactionId =
        typeof payload.transactionId === 'string' ? payload.transactionId : null;
      const receiptNumber = typeof payload.receiptNumber === 'string' ? payload.receiptNumber : null;

      const submission = transactionId
        ? await submitEtimsInvoiceOnce(transactionId)
        : { ok: false as const, error: 'ETIMS_INVOICE payload missing transactionId' };

      if (submission.ok) {
        await db.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'COMPLETED', processedAt: new Date(), lastError: null },
        });
        succeeded++;
        results.push({
          eventId: event.id,
          transactionId,
          receiptNumber,
          ok: true,
          skipped: submission.skipped,
        });
        continue;
      }

      const attempts = event.attempts + 1;
      const exhausted = attempts >= event.maxAttempts;
      const message = (submission.error || 'Unknown eTIMS failure').slice(0, 500);
      await db.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: exhausted ? 'DEAD' : 'FAILED',
          attempts,
          lastError: message,
          // min(2^attempts × 60s, 1h) — exponential backoff, one-hour cap.
          availableAt: new Date(Date.now() + Math.min(2 ** attempts * 60_000, 3_600_000)),
        },
      });

      if (exhausted) {
        dead++;
        // Tax-compliance alert: this invoice never reached KRA and will not
        // be retried automatically. etimsStatus stays 'PENDING' on purpose.
        await systemLog({
          action: 'ETIMS_INVOICE_DEAD',
          component: LogComponent.FINANCIAL,
          severity: LogSeverity.ERROR,
          message: `eTIMS invoice for transaction ${transactionId ?? 'unknown'} dead-lettered after ${attempts} attempts: ${message}`,
          storeId: event.storeId,
          metadata: { outboxId: event.id, transactionId, receiptNumber },
        }).catch(() => {});
      } else {
        failed++;
      }
      results.push({
        eventId: event.id,
        transactionId,
        receiptNumber,
        ok: false,
        dead: exhausted,
        error: message,
      });
    }

    return {
      processed: succeeded + failed + dead,
      succeeded,
      failed,
      dead,
      results,
    };
  });
}
