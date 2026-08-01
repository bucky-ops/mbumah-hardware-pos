// POST /api/batch — Batch operations for products
//
// Supported operations:
//   • batchUpdatePrices    — Update multiple product prices at once
//   • batchUpdateStock     — Update multiple product stock levels
//   • batchDeleteProducts  — Soft-delete (deactivate) multiple products
//
// All operations are transaction-based: all succeed or all fail.
// Requires SUPER_ADMIN or STORE_OWNER role.

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { requireAuth, type AuthSession } from '@/lib/auth';
import { LogSeverity, LogComponent } from '@/lib/types';
import { APIError, ErrorCode } from '@/lib/api-error';

export const dynamic = 'force-dynamic';

// ─── Type Definitions ───────────────────────────────────────────────────────

interface BatchUpdatePricesItem {
  productId: string;
  pricePerUnit: number;
  costPrice?: number;
}

interface BatchUpdateStockItem {
  productId: string;
  quantityInStock: number;
  reorderLevel?: number;
}

interface BatchDeleteItem {
  productId: string;
}

interface BatchRequest {
  operation: 'batchUpdatePrices' | 'batchUpdateStock' | 'batchDeleteProducts';
  storeId: string;
  items: BatchUpdatePricesItem[] | BatchUpdateStockItem[] | BatchDeleteItem[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

function validateBatchRequest(body: unknown): BatchRequest {
  if (!body || typeof body !== 'object') {
    throw new APIError(400, ErrorCode.VALIDATION_ERROR, 'Request body is required.');
  }

  const req = body as Record<string, unknown>;

  if (!req.operation || typeof req.operation !== 'string') {
    throw new APIError(400, ErrorCode.VALIDATION_ERROR, 'operation is required.');
  }

  const validOperations = ['batchUpdatePrices', 'batchUpdateStock', 'batchDeleteProducts'];
  if (!validOperations.includes(req.operation)) {
    throw new APIError(
      400,
      ErrorCode.VALIDATION_ERROR,
      `Invalid operation. Must be one of: ${validOperations.join(', ')}`,
    );
  }

  if (!req.storeId || typeof req.storeId !== 'string') {
    throw new APIError(400, ErrorCode.VALIDATION_ERROR, 'storeId is required.');
  }

  if (!Array.isArray(req.items) || req.items.length === 0) {
    throw new APIError(400, ErrorCode.VALIDATION_ERROR, 'items must be a non-empty array.');
  }

  if (req.items.length > 500) {
    throw new APIError(400, ErrorCode.VALIDATION_ERROR, 'Maximum 500 items per batch operation.');
  }

  // Operation-specific validation
  const operation = req.operation as string;
  const items = req.items as Array<Record<string, unknown>>;

  if (operation === 'batchUpdatePrices') {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.productId || typeof item.productId !== 'string') {
        throw new APIError(400, ErrorCode.VALIDATION_ERROR, `items[${i}].productId is required.`);
      }
      if (typeof item.pricePerUnit !== 'number' || item.pricePerUnit < 0) {
        throw new APIError(400, ErrorCode.VALIDATION_ERROR, `items[${i}].pricePerUnit must be a non-negative number.`);
      }
      if (item.costPrice !== undefined && (typeof item.costPrice !== 'number' || item.costPrice < 0)) {
        throw new APIError(400, ErrorCode.VALIDATION_ERROR, `items[${i}].costPrice must be a non-negative number if provided.`);
      }
    }
  }

  if (operation === 'batchUpdateStock') {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.productId || typeof item.productId !== 'string') {
        throw new APIError(400, ErrorCode.VALIDATION_ERROR, `items[${i}].productId is required.`);
      }
      if (typeof item.quantityInStock !== 'number' || item.quantityInStock < 0) {
        throw new APIError(400, ErrorCode.VALIDATION_ERROR, `items[${i}].quantityInStock must be a non-negative number.`);
      }
      if (item.reorderLevel !== undefined && (typeof item.reorderLevel !== 'number' || item.reorderLevel < 0)) {
        throw new APIError(400, ErrorCode.VALIDATION_ERROR, `items[${i}].reorderLevel must be a non-negative number if provided.`);
      }
    }
  }

  if (operation === 'batchDeleteProducts') {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.productId || typeof item.productId !== 'string') {
        throw new APIError(400, ErrorCode.VALIDATION_ERROR, `items[${i}].productId is required.`);
      }
    }
  }

  return {
    operation: req.operation as BatchRequest['operation'],
    storeId: req.storeId as string,
    items: req.items as BatchRequest['items'],
  };
}

// ─── Batch Operation Handlers ────────────────────────────────────────────────

async function batchUpdatePrices(
  storeId: string,
  items: BatchUpdatePricesItem[],
  session: AuthSession,
): Promise<{ updated: number }> {
  const productIds = items.map((item) => item.productId);

  // Verify all products exist and belong to the store
  const existingProducts = await db.product.findMany({
    where: { id: { in: productIds }, storeId, isActive: true },
    select: { id: true, name: true, pricePerUnit: true, costPrice: true },
  });

  const existingIds = new Set(existingProducts.map((p) => p.id));
  const missingIds = productIds.filter((id) => !existingIds.has(id));

  if (missingIds.length > 0) {
    throw new APIError(
      404,
      ErrorCode.NOT_FOUND,
      `Products not found or not active in store: ${missingIds.join(', ')}`,
    );
  }

  // Execute all updates in a transaction
  const result = await db.$transaction(
    items.map((item) =>
      db.product.update({
        where: { id: item.productId },
        data: {
          pricePerUnit: item.pricePerUnit,
          ...(item.costPrice !== undefined ? { costPrice: item.costPrice } : {}),
        },
      })
    ),
  );

  // Log the batch operation
  await systemLog({
    action: 'BATCH_UPDATE_PRICES',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Batch price update: ${result.length} products updated`,
    userId: session.userId,
    storeId,
    metadata: {
      count: result.length,
      productIds: productIds.slice(0, 20), // Log first 20 to avoid huge payloads
    },
  });

  return { updated: result.length };
}

async function batchUpdateStock(
  storeId: string,
  items: BatchUpdateStockItem[],
  session: AuthSession,
): Promise<{ updated: number }> {
  const productIds = items.map((item) => item.productId);

  // Verify all products exist and belong to the store
  const existingProducts = await db.product.findMany({
    where: { id: { in: productIds }, storeId, isActive: true },
    select: { id: true, name: true, quantityInStock: true },
  });

  const existingIds = new Set(existingProducts.map((p) => p.id));
  const missingIds = productIds.filter((id) => !existingIds.has(id));

  if (missingIds.length > 0) {
    throw new APIError(
      404,
      ErrorCode.NOT_FOUND,
      `Products not found or not active in store: ${missingIds.join(', ')}`,
    );
  }

  // Execute all updates in a transaction
  const result = await db.$transaction(
    items.map((item) =>
      db.product.update({
        where: { id: item.productId },
        data: {
          quantityInStock: item.quantityInStock,
          ...(item.reorderLevel !== undefined ? { reorderLevel: item.reorderLevel } : {}),
        },
      })
    ),
  );

  // Create stock movement records in a separate transaction
  await db.$transaction(
    items.map((item) =>
      db.stockMovement.create({
        data: {
          storeId,
          productId: item.productId,
          type: 'ADJUSTMENT',
          quantity: item.quantityInStock,
          reason: 'Batch stock update',
          processedById: session.userId,
        },
      })
    ),
  ).catch(() => {
    // Non-critical: stock movement logging failure shouldn't fail the operation
  });

  // Log the batch operation
  await systemLog({
    action: 'BATCH_UPDATE_STOCK',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.INFO,
    message: `Batch stock update: ${result.length} products updated`,
    userId: session.userId,
    storeId,
    metadata: {
      count: result.length,
      productIds: productIds.slice(0, 20),
    },
  });

  return { updated: result.length };
}

async function batchDeleteProducts(
  storeId: string,
  items: BatchDeleteItem[],
  session: AuthSession,
): Promise<{ deleted: number }> {
  const productIds = items.map((item) => item.productId);

  // Verify all products exist and belong to the store
  const existingProducts = await db.product.findMany({
    where: { id: { in: productIds }, storeId, isActive: true },
    select: { id: true, name: true },
  });

  const existingIds = new Set(existingProducts.map((p) => p.id));
  const missingIds = productIds.filter((id) => !existingIds.has(id));

  if (missingIds.length > 0) {
    throw new APIError(
      404,
      ErrorCode.NOT_FOUND,
      `Products not found or not active in store: ${missingIds.join(', ')}`,
    );
  }

  // Soft-delete (deactivate) all products in a transaction
  const result = await db.$transaction(
    productIds.map((id) =>
      db.product.update({
        where: { id },
        data: { isActive: false },
      })
    ),
  );

  // Log the batch operation
  await systemLog({
    action: 'BATCH_DELETE_PRODUCTS',
    component: LogComponent.INVENTORY,
    severity: LogSeverity.WARN,
    message: `Batch soft-delete: ${result.length} products deactivated`,
    userId: session.userId,
    storeId,
    metadata: {
      count: result.length,
      productIds: productIds.slice(0, 20),
    },
  });

  return { deleted: result.length };
}

// ─── Route Handler ───────────────────────────────────────────────────────────

async function batchHandler(
  request: NextRequest,
  session: AuthSession,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new APIError(400, ErrorCode.VALIDATION_ERROR, 'Invalid JSON body.');
  }

  const { operation, storeId, items } = validateBatchRequest(body);

  let result: Record<string, number>;

  switch (operation) {
    case 'batchUpdatePrices':
      result = await batchUpdatePrices(storeId, items as BatchUpdatePricesItem[], session);
      break;

    case 'batchUpdateStock':
      result = await batchUpdateStock(storeId, items as BatchUpdateStockItem[], session);
      break;

    case 'batchDeleteProducts':
      result = await batchDeleteProducts(storeId, items as BatchDeleteItem[], session);
      break;

    default:
      throw new APIError(400, ErrorCode.VALIDATION_ERROR, `Unsupported operation: ${operation}`);
  }

  return Response.json({
    success: true,
    data: {
      operation,
      ...result,
    },
  });
}

// ─── Export ───────────────────────────────────────────────────────────────────

export const POST = withErrorBoundary(
  requireAuth(batchHandler, { roles: ['SUPER_ADMIN', 'STORE_OWNER'] }),
  'BATCH_OPERATIONS',
);
