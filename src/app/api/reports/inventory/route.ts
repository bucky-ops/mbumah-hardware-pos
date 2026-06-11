/**
 * MBUMAH HARDWARE POS - Inventory Status Report API
 * GET /api/reports/inventory - Inventory status report with valuation
 */

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary } from '@/lib/logger';

async function getInventoryReportHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const categoryId = searchParams.get('categoryId') || '';
  const stockStatus = searchParams.get('stockStatus') || ''; // low, out, normal, all
  const isRental = searchParams.get('isRental');
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '100');
  const sortBy = searchParams.get('sortBy') || 'name';
  const sortOrder = searchParams.get('sortOrder') || 'asc';

  const where: Record<string, unknown> = { storeId, isActive: true };

  if (categoryId) {
    where.categoryId = categoryId;
  }

  if (isRental !== null && isRental !== undefined && isRental !== '') {
    where.isRental = isRental === 'true';
  }

  if (stockStatus === 'out') {
    where.quantityInStock = { lte: 0 };
  } else if (stockStatus === 'low') {
    where.quantityInStock = { gt: 0, lte: 10 };
  } else if (stockStatus === 'normal') {
    where.quantityInStock = { gt: 10 };
  }

  const validSortFields = ['name', 'sku', 'quantityInStock', 'pricePerUnit', 'costPrice'];
  const sortField = validSortFields.includes(sortBy) ? sortBy : 'name';
  const orderDirection = sortOrder === 'desc' ? 'desc' : 'asc';

  const [products, total] = await Promise.all([
    db.product.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, color: true } },
        warehouseStocks: true,
        stockMovements: {
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: {
            movementType: true,
            quantity: true,
            createdAt: true,
          },
        },
      },
      orderBy: { [sortField]: orderDirection },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.product.count({ where }),
  ]);

  // Enrich products with computed fields
  const enrichedProducts = products.map((product) => {
    const stockValue = product.quantityInStock * product.costPrice;
    const retailValue = product.quantityInStock * product.pricePerUnit;
    const potentialProfit = retailValue - stockValue;
    const isLowStock = product.quantityInStock <= product.reorderLevel;
    const isOutOfStock = product.quantityInStock <= 0;

    const totalWarehouseQty = product.warehouseStocks.reduce((sum, ws) => sum + ws.quantity, 0);

    return {
      id: product.id,
      name: product.name,
      sku: product.sku,
      barcode: product.barcode,
      category: product.category,
      unitType: product.unitType,
      quantityInStock: product.quantityInStock,
      reorderLevel: product.reorderLevel,
      pricePerUnit: product.pricePerUnit,
      costPrice: product.costPrice,
      taxRate: product.taxRate,
      isRental: product.isRental,
      isBundle: product.isBundle,
      imageUrl: product.imageUrl,
      stockValue,
      retailValue,
      potentialProfit,
      isLowStock,
      isOutOfStock,
      totalWarehouseQty,
      recentMovements: product.stockMovements,
    };
  });

  // Aggregate summary
  const allActiveProducts = await db.product.findMany({
    where: { storeId, isActive: true },
    select: {
      quantityInStock: true,
      reorderLevel: true,
      costPrice: true,
      pricePerUnit: true,
      isRental: true,
    },
  });

  const totalStockValue = allActiveProducts.reduce((sum, p) => sum + p.quantityInStock * p.costPrice, 0);
  const totalRetailValue = allActiveProducts.reduce((sum, p) => sum + p.quantityInStock * p.pricePerUnit, 0);
  const lowStockCount = allActiveProducts.filter((p) => p.quantityInStock > 0 && p.quantityInStock <= p.reorderLevel).length;
  const outOfStockCount = allActiveProducts.filter((p) => p.quantityInStock <= 0).length;
  const rentalItemCount = allActiveProducts.filter((p) => p.isRental).length;

  return Response.json({
    success: true,
    data: enrichedProducts,
    summary: {
      totalProducts: allActiveProducts.length,
      totalStockValue,
      totalRetailValue,
      potentialProfit: totalRetailValue - totalStockValue,
      lowStockCount,
      outOfStockCount,
      rentalItemCount,
      healthyStockCount: allActiveProducts.length - lowStockCount - outOfStockCount,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

export const GET = withErrorBoundary(getInventoryReportHandler, 'REPORTS_INVENTORY');
