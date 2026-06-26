// GET /api/reports/export (CSV: sales, inventory, debt, rentals)

import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { withErrorBoundary, systemLog } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { formatKES } from '@/lib/helpers';

export const dynamic = 'force-dynamic';

function escapeCSV(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(escapeCSV).join(',');
  const dataLines = rows.map((row) => row.map(escapeCSV).join(','));
  return [headerLine, ...dataLines].join('\n');
}

async function getExportHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  if (!storeId) {
    return Response.json(
      { success: false, error: 'storeId is required.' },
      { status: 400 }
    );
  }

  const type = searchParams.get('type') || 'sales';
  const dateFrom = searchParams.get('dateFrom') || '';
  const dateTo = searchParams.get('dateTo') || '';

  let csvContent = '';
  let filename = '';

  switch (type) {
    case 'sales': {
      filename = `sales_report_${dateFrom || 'all'}_to_${dateTo || 'all'}.csv`;

      const where: Record<string, unknown> = {
        storeId,
        transactionType: 'SALE',
      };

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

      const transactions = await db.salesTransaction.findMany({
        where,
        include: {
          items: true,
          payments: true,
          cashier: { select: { name: true } },
          customer: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      const headers = [
        'Receipt Number', 'Date', 'Cashier', 'Customer', 'Payment Method',
        'Subtotal', 'Tax', 'Discount', 'Total', 'Payment Status', 'Items Count',
      ];

      const rows = transactions.map((tx) => [
        tx.receiptNumber,
        new Date(tx.createdAt).toISOString(),
        tx.cashier.name,
        tx.customer?.name || 'Walk-in',
        tx.paymentMethod,
        tx.subtotal.toString(),
        tx.taxAmount.toString(),
        tx.discountAmount.toString(),
        tx.totalAmount.toString(),
        tx.paymentStatus,
        tx.items.length.toString(),
      ]);

      csvContent = toCSV(headers, rows);
      break;
    }

    case 'inventory': {
      filename = `inventory_report_${new Date().toISOString().split('T')[0]}.csv`;

      const products = await db.product.findMany({
        where: { storeId, isActive: true },
        include: {
          category: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
      });

      const headers = [
        'SKU', 'Product Name', 'Category', 'Unit Type', 'Quantity In Stock',
        'Reorder Level', 'Price Per Unit', 'Cost Price', 'Stock Value',
        'Retail Value', 'Low Stock', 'Rental', 'Bundle',
      ];

      const rows = products.map((p) => [
        p.sku,
        p.name,
        p.category?.name || 'Uncategorized',
        p.unitType,
        p.quantityInStock.toString(),
        p.reorderLevel.toString(),
        p.pricePerUnit.toString(),
        p.costPrice.toString(),
        (p.quantityInStock * p.costPrice).toString(),
        (p.quantityInStock * p.pricePerUnit).toString(),
        p.quantityInStock <= p.reorderLevel ? 'Yes' : 'No',
        p.isRental ? 'Yes' : 'No',
        p.isBundle ? 'Yes' : 'No',
      ]);

      csvContent = toCSV(headers, rows);
      break;
    }

    case 'debt': {
      filename = `debt_report_${new Date().toISOString().split('T')[0]}.csv`;

      const debts = await db.debtLedger.findMany({
        where: {
          storeId,
          status: { in: ['OUTSTANDING', 'PARTIAL', 'OVERDUE'] },
        },
        include: {
          customer: { select: { name: true, phone: true } },
          transaction: { select: { receiptNumber: true } },
        },
        orderBy: { dueDate: 'asc' },
      });

      const headers = [
        'Customer', 'Phone', 'Receipt Number', 'Amount Owed', 'Amount Paid',
        'Balance', 'Due Date', 'Status', 'Aging Bucket', 'Created At',
      ];

      const rows = debts.map((d) => [
        d.customer.name,
        d.customer.phone || '',
        d.transaction?.receiptNumber || '',
        d.amountOwed.toString(),
        d.amountPaid.toString(),
        d.balance.toString(),
        new Date(d.dueDate).toISOString().split('T')[0],
        d.status,
        d.agingBucket,
        new Date(d.createdAt).toISOString().split('T')[0],
      ]);

      csvContent = toCSV(headers, rows);
      break;
    }

    case 'rentals': {
      filename = `rentals_report_${new Date().toISOString().split('T')[0]}.csv`;

      const rentals = await db.equipmentRental.findMany({
        where: { storeId },
        include: {
          product: { select: { name: true, sku: true } },
          customer: { select: { name: true, phone: true } },
        },
        orderBy: { rentalStartDate: 'desc' },
      });

      const headers = [
        'Customer', 'Phone', 'Product', 'SKU', 'Status',
        'Rental Start', 'Expected Return', 'Actual Return',
        'Rate Per Day', 'Total Charge', 'Late Fees', 'Security Deposit',
        'Damage Assessment', 'Damage Charge',
      ];

      const rows = rentals.map((r) => [
        r.customer.name,
        r.customer.phone || '',
        r.product.name,
        r.product.sku,
        r.status,
        new Date(r.rentalStartDate).toISOString().split('T')[0],
        new Date(r.expectedReturnDate).toISOString().split('T')[0],
        r.actualReturnDate ? new Date(r.actualReturnDate).toISOString().split('T')[0] : '',
        r.ratePerDay.toString(),
        r.totalRentalCharge.toString(),
        r.lateFeeAccumulated.toString(),
        r.securityDeposit.toString(),
        r.damageAssessment || '',
        r.damageCharge.toString(),
      ]);

      csvContent = toCSV(headers, rows);
      break;
    }

    default:
      return Response.json(
        { success: false, error: 'Invalid export type. Supported: sales, inventory, debt, rentals' },
        { status: 400 }
      );
  }

  await systemLog({
    action: 'DATA_EXPORTED',
    component: LogComponent.SYSTEM,
    severity: LogSeverity.INFO,
    message: `Data exported: ${type} report`,
    storeId,
    metadata: { type, filename, dateFrom, dateTo },
  });

  return new Response(csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

export const GET = withErrorBoundary(getExportHandler, 'REPORTS_EXPORT');
