import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export interface NotificationData {
  id: string;
  type: 'out_of_stock' | 'low_stock' | 'overdue_rental' | 'large_debt' | 'new_customer' | 'recent_transaction';
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'info';
  timestamp: string;
  isRead: boolean;
  targetTab: string;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('storeId');

    if (!storeId) {
      return NextResponse.json({ success: false, error: 'storeId is required' }, { status: 400 });
    }

    const notifications: NotificationData[] = [];
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 1. Out of stock products
    const outOfStockProducts = await db.product.findMany({
      where: {
        storeId,
        quantityInStock: { lte: 0 },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        updatedAt: true,
        category: { select: { name: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    for (const p of outOfStockProducts) {
      notifications.push({
        id: `oos-${p.id}`,
        type: 'out_of_stock',
        title: 'Out of Stock',
        description: `${p.name} (${p.sku}) is completely out of stock${p.category ? ` in ${p.category.name}` : ''}`,
        severity: 'critical',
        timestamp: p.updatedAt.toISOString(),
        isRead: false,
        targetTab: 'inventory',
      });
    }

    // 2. Low stock products
    const lowStockProducts = await db.product.findMany({
      where: {
        storeId,
        quantityInStock: { gt: 0 },
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        sku: true,
        quantityInStock: true,
        reorderLevel: true,
        unitType: true,
        updatedAt: true,
        category: { select: { name: true } },
      },
      orderBy: { quantityInStock: 'asc' },
      take: 50,
    });

    for (const p of lowStockProducts) {
      if (p.quantityInStock <= p.reorderLevel) {
        notifications.push({
          id: `low-${p.id}`,
          type: 'low_stock',
          title: 'Low Stock Alert',
          description: `${p.name} has only ${Math.round(p.quantityInStock)} ${p.unitType.toLowerCase()}s left (reorder at ${Math.round(p.reorderLevel)})`,
          severity: 'warning',
          timestamp: p.updatedAt.toISOString(),
          isRead: false,
          targetTab: 'inventory',
        });
      }
    }

    // 3. Overdue rentals
    const overdueRentals = await db.equipmentRental.findMany({
      where: {
        storeId,
        status: 'OVERDUE',
      },
      include: {
        product: { select: { name: true } },
        customer: { select: { name: true } },
      },
      orderBy: { expectedReturnDate: 'asc' },
      take: 20,
    });

    for (const r of overdueRentals) {
      const daysOverdue = Math.floor(
        (now.getTime() - r.expectedReturnDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      notifications.push({
        id: `rental-${r.id}`,
        type: 'overdue_rental',
        title: 'Overdue Rental',
        description: `${r.product.name} rented by ${r.customer.name} is ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue`,
        severity: 'critical',
        timestamp: r.expectedReturnDate.toISOString(),
        isRead: false,
        targetTab: 'rentals',
      });
    }

    // 4. Large outstanding debts (balance > 50,000, not settled)
    const largeDebts = await db.debtLedger.findMany({
      where: {
        storeId,
        balance: { gt: 50000 },
        status: { not: 'SETTLED' },
      },
      include: {
        customer: { select: { name: true } },
      },
      orderBy: { balance: 'desc' },
      take: 20,
    });

    for (const d of largeDebts) {
      const isOverdue = d.status === 'OVERDUE';
      notifications.push({
        id: `debt-${d.id}`,
        type: 'large_debt',
        title: isOverdue ? 'Overdue Debt' : 'Large Outstanding Debt',
        description: `${d.customer.name} owes KES ${Math.round(d.balance).toLocaleString()}${isOverdue ? ' (OVERDUE)' : ''}`,
        severity: isOverdue ? 'critical' : 'warning',
        timestamp: d.dueDate.toISOString(),
        isRead: false,
        targetTab: 'customers',
      });
    }

    // 5. New customers registered (last 7 days)
    const newCustomers = await db.customer.findMany({
      where: {
        storeId,
        createdAt: { gte: sevenDaysAgo },
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    for (const c of newCustomers) {
      const hoursAgo = Math.floor(
        (now.getTime() - c.createdAt.getTime()) / (1000 * 60 * 60)
      );
      notifications.push({
        id: `newcust-${c.id}`,
        type: 'new_customer',
        title: 'New Customer',
        description: `${c.name} registered ${hoursAgo < 24 ? `${hoursAgo} hour${hoursAgo !== 1 ? 's' : ''} ago` : `${Math.floor(hoursAgo / 24)} day${Math.floor(hoursAgo / 24) !== 1 ? 's' : ''} ago`}`,
        severity: 'info',
        timestamp: c.createdAt.toISOString(),
        isRead: false,
        targetTab: 'customers',
      });
    }

    // 6. Recent transactions (last 24 hours)
    const recentTransactions = await db.salesTransaction.findMany({
      where: {
        storeId,
        createdAt: { gte: twentyFourHoursAgo },
        transactionType: 'SALE',
      },
      include: {
        customer: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    for (const t of recentTransactions) {
      const minutesAgo = Math.floor(
        (now.getTime() - t.createdAt.getTime()) / (1000 * 60)
      );
      if (minutesAgo < 60) {
        notifications.push({
          id: `txn-${t.id}`,
          type: 'recent_transaction',
          title: 'Recent Sale',
          description: `${t.customer?.name || 'Walk-in'} — KES ${Math.round(t.totalAmount).toLocaleString()} via ${t.paymentMethod}${minutesAgo <= 1 ? ' (just now)' : ` (${minutesAgo}m ago)`}`,
          severity: 'info',
          timestamp: t.createdAt.toISOString(),
          isRead: false,
          targetTab: 'transactions',
        });
      }
    }

    // Sort: critical first, then warning, then info. Within same severity, newest first.
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    notifications.sort((a, b) => {
      const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (sevDiff !== 0) return sevDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    return NextResponse.json({
      success: true,
      data: notifications,
      summary: {
        total: notifications.length,
        critical: notifications.filter((n) => n.severity === 'critical').length,
        warning: notifications.filter((n) => n.severity === 'warning').length,
        info: notifications.filter((n) => n.severity === 'info').length,
      },
    });
  } catch (error) {
    console.error('[Notifications API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}
