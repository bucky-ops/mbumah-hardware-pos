// GET/PUT /api/store-transfers/[id]
//
// AUDIT REMEDIATION — FINANCIAL_MODULE_AUDIT_REPORT.md:
//   • F3-2 (P0): the receive handler used to write `receivedBy` — a field that
//     did not exist on the StoreTransfer model — crashing with a
//     PrismaClientValidationError AFTER destination stock had already been
//     credited. Every retry double-credited stock. The columns now exist in
//     the schema and every stock mutation is wrapped in ONE $transaction with
//     an atomic status claim BEFORE any stock is touched.
//   • F3-3 (P0): `ship` never flipped status or guarded `shippedAt`, so it
//     could be repeated sequentially, double-decrementing origin stock. The
//     action now claims `IN_TRANSIT AND shippedAt = null` atomically.
//   • F3-4 (P1): `PARTIAL` was a terminal dead-end (couldn't re-receive or
//     cancel); cancel-after-ship wrote no reversal movement. PARTIAL can now
//     be received (to completion) or cancelled — with the un-received
//     remainder restored to origin and compensating TRANSFER movements
//     recorded. Status vocabulary aligned to the schema (`RECEIVED`).
//   • F3-5 (P1): client-supplied `receivedQty` was unbounded — arbitrary
//     inventory credit/debit. Now validated: `0 < qty ≤ remaining`.
//   • P0-3/SYS-1/SYS-2: endpoints are wrapped in `requireStoreAccess` and all
//     actor identities (approvedBy/shippedBy/receivedBy/cancelledBy) are
//     derived from the authenticated session — never the request body.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { requireStoreAccess, type AuthSession } from '@/lib/auth';
import { deriveTransferDestinationSku } from '@/lib/helpers';
import { LogSeverity, LogComponent } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

type TransferWithItems = NonNullable<
  Awaited<ReturnType<typeof db.storeTransfer.findUnique>>
> & { items: Array<{ id: string; productId: string; quantity: unknown; receivedQty: unknown }> };

// AUDIT FIX (oversell): sentinel error thrown inside the ship tx when the
// conditional origin-stock decrement claims 0 rows. Prisma interactive tx:
// throwing aborts/rolls back the WHOLE transaction (no partial shipment), and
// the catch below maps it to a typed 409 instead of a generic 400.
class InsufficientStockError extends Error {
  constructor(productId: string) {
    super(`Insufficient stock at source location for product ${productId}`);
    this.name = 'InsufficientStockError';
  }
}

/** Verify a non-admin session belongs to one of the two stores on the transfer. */
function assertTransferMembership(
  session: AuthSession,
  fromStoreId: string,
  toStoreId: string
): Response | null {
  if (session.role === 'SUPER_ADMIN') return null;
  if (session.storeId === fromStoreId || session.storeId === toStoreId) return null;
  return Response.json(
    { success: false, error: 'You can only access transfers involving your own store.' },
    { status: 403 }
  );
}

async function getStoreTransferHandler(
  request: NextRequest,
  session: AuthSession,
  ...args: unknown[]
): Promise<Response> {
  const context = args[0] as RouteContext;
  const { id } = await context.params;

  const transfer = await db.storeTransfer.findUnique({
    where: { id },
    include: {
      fromStore: { select: { id: true, name: true, location: true, phone: true } },
      toStore: { select: { id: true, name: true, location: true, phone: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, sku: true, quantityInStock: true, unitType: true } },
        },
      },
    },
  });

  if (!transfer) {
    return Response.json(
      { success: false, error: 'Store transfer not found.' },
      { status: 404 }
    );
  }

  const membershipError = assertTransferMembership(session, transfer.fromStoreId, transfer.toStoreId);
  if (membershipError) return membershipError;

  return Response.json({ success: true, data: transfer });
}

async function updateStoreTransferHandler(
  request: NextRequest,
  session: AuthSession,
  ...args: unknown[]
): Promise<Response> {
  const context = args[0] as RouteContext;
  const { id } = await context.params;
  const body = await request.json();

  const existing = (await db.storeTransfer.findUnique({
    where: { id },
    include: { items: true },
  })) as TransferWithItems | null;

  if (!existing) {
    return Response.json(
      { success: false, error: 'Store transfer not found.' },
      { status: 404 }
    );
  }

  const membershipError = assertTransferMembership(session, existing.fromStoreId, existing.toStoreId);
  if (membershipError) return membershipError;

  const action = body.action; // approve, ship, receive, cancel
  const actorId = session.userId; // SYS-2: identity always from the session

  // ── APPROVE ──────────────────────────────────────────────────────────────
  if (action === 'approve') {
    // Atomic claim: only PENDING can move to IN_TRANSIT.
    const claimed = await db.storeTransfer.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'IN_TRANSIT', approvedBy: actorId },
    });
    if (claimed.count === 0) {
      return Response.json(
        { success: false, error: 'Only PENDING transfers can be approved (or concurrently modified).' },
        { status: 409 }
      );
    }

    await systemLog({
      action: 'STORE_TRANSFER_APPROVED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.INFO,
      message: `Transfer ${existing.transferNumber} approved`,
      storeId: existing.fromStoreId,
      userId: actorId,
      metadata: { transferId: id, transferNumber: existing.transferNumber },
    });

    const transfer = await db.storeTransfer.findUnique({
      where: { id },
      include: {
        fromStore: { select: { id: true, name: true, location: true } },
        toStore: { select: { id: true, name: true, location: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    return Response.json({ success: true, data: transfer });
  }

  // ── SHIP ─────────────────────────────────────────────────────────────────
  if (action === 'ship') {
    // All stock deduction + movement writes happen in ONE transaction, gated
    // by an atomic claim on (status = IN_TRANSIT, shippedAt = null) — the
    // double-ship window is closed (F3-3).
    const result = await db.$transaction(async (tx) => {
      const claimed = await tx.storeTransfer.updateMany({
        where: { id, status: 'IN_TRANSIT', shippedAt: null },
        data: { status: 'IN_TRANSIT', shippedAt: new Date(), shippedBy: actorId },
      });
      if (claimed.count === 0) return { ok: false as const, reason: 'not_claimable' };

      for (const item of existing.items) {
        const shippedQty = Number(item.quantity);
        // QA FIX (dual source of truth): ship MUST operate on
        // Product.quantityInStock — the same ledger POS sales and stock
        // movements use. The legacy Inventory table is maintained by nothing
        // else in the system, so keying ship on it stranded every product
        // created through the catalog API ("Origin store has no inventory
        // record") and made transfers impossible for the whole live catalog.
        // Atomic conditional decrement (row lock + `gte` predicate re-check);
        // count === 0 throws InsufficientStockError which aborts the ENTIRE
        // ship tx (no partial shipment) and surfaces as a typed 409.
        const claimedProduct = await tx.product.updateMany({
          where: { id: item.productId, quantityInStock: { gte: shippedQty } },
          data: { quantityInStock: { decrement: shippedQty } },
        });
        if (claimedProduct.count === 0) {
          throw new InsufficientStockError(item.productId);
        }
        // Best-effort sync of the legacy Inventory ledger when a row exists
        // (a missing row no longer aborts shipping).
        const inventory = await tx.inventory.findFirst({
          where: { productId: item.productId, storeId: existing.fromStoreId },
        });
        if (inventory) {
          await tx.inventory.update({
            where: { id: inventory.id },
            data: { quantityInStock: { decrement: shippedQty } },
          });
        }
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            storeId: existing.fromStoreId,
            movementType: 'TRANSFER',
            quantity: -item.quantity,
            notes: `Transfer ${existing.transferNumber} to destination store`,
            referenceId: existing.id,
            performedBy: actorId,
          },
        });
      }
      return { ok: true as const };
    }).catch((err: unknown) => {
      // AUDIT FIX: typed 409 for the conditional origin-stock decrement losing
      // the race; every other thrown error still rolls the tx back and
      // surfaces as a 400 with its message (unchanged behavior).
      if (err instanceof InsufficientStockError) {
        return { ok: false as const, reason: 'insufficient_stock' as const };
      }
      return { ok: false as const, reason: err instanceof Error ? err.message : 'ship_failed' };
    });

    if (!result.ok) {
      if (result.reason === 'insufficient_stock') {
        return Response.json(
          { success: false, error: 'Insufficient stock at source location.' },
          { status: 409 }
        );
      }
      const status = result.reason === 'not_claimable' ? 409 : 400;
      return Response.json(
        {
          success: false,
          error:
            result.reason === 'not_claimable'
              ? 'Transfer is not shippable (already shipped or not in transit).'
              : `Ship failed: ${result.reason}`,
        },
        { status }
      );
    }

    await systemLog({
      action: 'STORE_TRANSFER_SHIPPED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.INFO,
      message: `Transfer ${existing.transferNumber} shipped - stock deducted from origin`,
      storeId: existing.fromStoreId,
      userId: actorId,
      metadata: { transferId: id, transferNumber: existing.transferNumber, itemCount: existing.items.length },
    });

    const transfer = await db.storeTransfer.findUnique({
      where: { id },
      include: {
        fromStore: { select: { id: true, name: true, location: true } },
        toStore: { select: { id: true, name: true, location: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    return Response.json({ success: true, data: transfer });
  }

  // ── RECEIVE ──────────────────────────────────────────────────────────────
  if (action === 'receive') {
    // PARTIAL transfers are re-receivable (F3-4); IN_TRANSIT is the first receipt.
    if (existing.status !== 'IN_TRANSIT' && existing.status !== 'PARTIAL') {
      return Response.json(
        { success: false, error: 'Only IN_TRANSIT or PARTIAL transfers can be received.' },
        { status: 400 }
      );
    }

    const receivedItems: Array<{ productId: string; receivedQty?: number }> = body.items || [];

    // Validate bounds BEFORE mutating anything (F3-5).
    for (const item of existing.items) {
      const delta = receivedItems.find((ri) => ri.productId === item.productId)?.receivedQty;
      if (delta === undefined) continue; // not part of this receipt batch
      const qty = Number(delta);
      if (!Number.isFinite(qty) || qty <= 0) {
        return Response.json(
          { success: false, error: `Invalid receivedQty for product ${item.productId}: must be > 0.` },
          { status: 400 }
        );
      }
      const already = Number(item.receivedQty ?? 0);
      const ordered = Number(item.quantity);
      if (already + qty > ordered) {
        return Response.json(
          {
            success: false,
            error: `Over-receipt blocked for product ${item.productId}: ordered ${ordered}, already received ${already}, attempted ${qty} more.`,
          },
          { status: 400 }
        );
      }
    }

    const result = await db.$transaction(async (tx) => {
      // Atomic claim — receive is single-shot per receipt batch (F3-2).
      const claimStatuses = ['IN_TRANSIT', 'PARTIAL'];
      const claimed = await tx.storeTransfer.updateMany({
        where: { id, status: { in: claimStatuses }, shippedAt: { not: null } },
        data: { status: 'RECEIVING' as string }, // transient in-transaction state
      });
      if (claimed.count === 0) return { ok: false as const };

      let totalReceived = 0;
      for (const item of existing.items) {
        const delta =
          receivedItems.find((ri) => ri.productId === item.productId)?.receivedQty ?? 0;
        if (!delta) continue; // nothing received for this line in this batch
        const qty = Number(delta);

        const newTotal = Number(item.receivedQty ?? 0) + qty;
        await tx.storeTransferItem.update({
          where: { id: item.id },
          data: { receivedQty: newTotal },
        });

        // QA FIX (destination credit): received stock must become SELLABLE at
        // the destination. POS sales read Product.quantityInStock, but the old
        // receive path credited ONLY the legacy Inventory ledger — so a
        // completed transfer never appeared in the destination catalog.
        // Product.sku is globally unique, so the destination row is matched by
        // a deterministic derived SKU (`<originSku>--<branchCode>` when the
        // destination branch has a code, else `--<toStoreId>` for legacy
        // pairs); if it does not exist yet, the origin product is cloned into
        // the destination store with the received quantity.
        const itemProduct = await tx.product.findUnique({ where: { id: item.productId } });
        const destStore = await tx.store.findUnique({
          where: { id: existing.toStoreId },
          select: { code: true },
        });
        const destSku = deriveTransferDestinationSku(itemProduct?.sku, existing.toStoreId, destStore?.code);
        if (destSku && itemProduct) {
          const destProduct = await tx.product.findUnique({ where: { sku: destSku } });
          if (destProduct) {
            await tx.product.update({
              where: { id: destProduct.id },
              data: { quantityInStock: { increment: qty } },
            });
          } else {
            await tx.product.create({
              data: {
                storeId: existing.toStoreId,
                sku: destSku,
                name: itemProduct.name,
                description: itemProduct.description,
                unitType: itemProduct.unitType,
                quantityInStock: qty,
                reorderLevel: itemProduct.reorderLevel,
                pricePerUnit: itemProduct.pricePerUnit,
                costPrice: itemProduct.costPrice,
                taxRate: itemProduct.taxRate,
                categoryId: itemProduct.categoryId,
                isActive: true,
              },
            });
          }
        }

        // Credit destination inventory (legacy ledger — keep in sync, create
        // when the row is missing).
        const destInventory = await tx.inventory.findFirst({
          where: { productId: item.productId, storeId: existing.toStoreId },
        });
        if (destInventory) {
          await tx.inventory.update({
            where: { id: destInventory.id },
            data: { quantityInStock: { increment: qty } },
          });
        } else {
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (product) {
            await tx.inventory.create({
              data: {
                productId: item.productId,
                storeId: existing.toStoreId,
                quantityInStock: qty,
                reorderLevel: product.reorderLevel,
              },
            });
          }
        }

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            storeId: existing.toStoreId,
            movementType: 'TRANSFER',
            quantity: qty,
            notes: `Received from transfer ${existing.transferNumber}`,
            referenceId: existing.id,
            performedBy: actorId,
          },
        });
        totalReceived += qty;
      }

      // Derive the post-receipt status: PARTIAL when any line is short.
      const freshItems = await tx.storeTransferItem.findMany({ where: { transferId: id } });
      const complete = freshItems.every(
        (it) => Number(it.receivedQty ?? 0) >= Number(it.quantity)
      );
      const finalStatus = complete ? 'RECEIVED' : 'PARTIAL';

      await tx.storeTransfer.update({
        where: { id },
        data: { status: finalStatus, receivedBy: actorId, receivedAt: new Date() },
      });

      return { ok: true as const, finalStatus, totalReceived };
    });

    if (!result.ok) {
      return Response.json(
        { success: false, error: 'Transfer is not receivable (concurrently modified or not shipped).' },
        { status: 409 }
      );
    }

    await systemLog({
      action: 'STORE_TRANSFER_RECEIVED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.INFO,
      message: `Transfer ${existing.transferNumber} received - stock added to destination`,
      storeId: existing.toStoreId,
      userId: actorId,
      metadata: {
        transferId: id,
        transferNumber: existing.transferNumber,
        status: result.finalStatus,
        itemsReceivedThisBatch: result.totalReceived,
      },
    });

    const transfer = await db.storeTransfer.findUnique({
      where: { id },
      include: {
        fromStore: { select: { id: true, name: true, location: true } },
        toStore: { select: { id: true, name: true, location: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    return Response.json({ success: true, data: transfer });
  }

  // ── CANCEL ───────────────────────────────────────────────────────────────
  if (action === 'cancel') {
    // PARTIAL transfers are cancellable now (F3-4) — the un-received remainder
    // is restored to origin with compensating movements.
    if (!['PENDING', 'IN_TRANSIT', 'PARTIAL'].includes(existing.status)) {
      return Response.json(
        { success: false, error: 'Only PENDING, IN_TRANSIT or PARTIAL transfers can be cancelled.' },
        { status: 400 }
      );
    }

    const result = await db.$transaction(async (tx) => {
      const claimed = await tx.storeTransfer.updateMany({
        where: { id, status: { in: ['PENDING', 'IN_TRANSIT', 'PARTIAL'] } },
        data: { status: 'CANCELLED', cancelledBy: actorId, cancelledAt: new Date() },
      });
      if (claimed.count === 0) return { ok: false as const };

      if (existing.shippedAt) {
        // Return only the UN-RECEIVED remainder to origin (F3-4).
        for (const item of existing.items) {
          const outstanding = Number(item.quantity) - Number(item.receivedQty ?? 0);
          if (outstanding <= 0) continue;

          const inventory = await tx.inventory.findFirst({
            where: { productId: item.productId, storeId: existing.fromStoreId },
          });
          if (inventory) {
            await tx.inventory.update({
              where: { id: inventory.id },
              data: { quantityInStock: { increment: outstanding } },
            });
          }
          // Compensating movement — previously missing entirely (F3-4).
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              storeId: existing.fromStoreId,
              movementType: 'TRANSFER',
              quantity: outstanding,
              notes: `Cancelled transfer ${existing.transferNumber} — un-received stock returned to origin`,
              referenceId: existing.id,
              performedBy: actorId,
            },
          });
        }
      }
      return { ok: true as const };
    });

    if (!result.ok) {
      return Response.json(
        { success: false, error: 'Transfer could not be cancelled (concurrently modified).' },
        { status: 409 }
      );
    }

    await systemLog({
      action: 'STORE_TRANSFER_CANCELLED',
      component: LogComponent.INVENTORY,
      severity: LogSeverity.WARN,
      message: `Transfer ${existing.transferNumber} cancelled`,
      storeId: existing.fromStoreId,
      userId: actorId,
      metadata: { transferId: id, transferNumber: existing.transferNumber },
    });

    const transfer = await db.storeTransfer.findUnique({
      where: { id },
      include: {
        fromStore: { select: { id: true, name: true, location: true } },
        toStore: { select: { id: true, name: true, location: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    return Response.json({ success: true, data: transfer });
  }

  // ── Notes-only update ────────────────────────────────────────────────────
  if (body.notes !== undefined) {
    const transfer = await db.storeTransfer.update({
      where: { id },
      data: { notes: body.notes },
      include: {
        fromStore: { select: { id: true, name: true, location: true } },
        toStore: { select: { id: true, name: true, location: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    return Response.json({ success: true, data: transfer });
  }

  return Response.json(
    { success: false, error: 'Valid action required: approve, ship, receive, or cancel.' },
    { status: 400 }
  );
}

// SYS-1: these endpoints mutate stock in two stores — session + membership
// enforced (F3-3/P0-3). withErrorBoundary composes around the auth wrapper.
export const GET = withErrorBoundary(requireStoreAccess(getStoreTransferHandler) as (...args: unknown[]) => Promise<Response>, 'STORE_TRANSFER_DETAIL');
export const PUT = withErrorBoundary(requireStoreAccess(updateStoreTransferHandler) as (...args: unknown[]) => Promise<Response>, 'STORE_TRANSFER_UPDATE');
