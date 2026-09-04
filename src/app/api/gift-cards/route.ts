// GET/POST /api/gift-cards

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { generateGiftCardCode } from '@/lib/helpers';
import { LogSeverity, LogComponent } from '@/lib/types';
import { createGiftCardSchema, validateInput } from '@/lib/validations';
import { withSessionAuth, FINANCIAL_ROLES } from '@/lib/auth';
import { recordGiftCardIssuance } from '@/lib/account-helper';
import { getSessionFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED', 'PARTIALLY_REDEEMED'];
const VALID_REASONS = [
  'CUSTOMER_LOYALTY', 'PROMOTION', 'REFUND_CREDIT', 'STORE_CREDIT',
  'GIFT', 'EMPLOYEE_AWARD', 'COMPLAINT_RESOLUTION', 'OTHER',
];

async function listGiftCardsHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const { searchParams } = new URL(request.url);

  const storeId = searchParams.get('storeId');
  const status = searchParams.get('status') || '';
  const reason = searchParams.get('reason') || '';
  const search = searchParams.get('search') || '';
  const page = parseInt(searchParams.get('page') || '1');
  const limit = parseInt(searchParams.get('limit') || '50');

  const where: Record<string, unknown> = {};

  if (storeId) {
    where.storeId = storeId;
  }

  if (status && VALID_STATUSES.includes(status)) {
    where.status = status;
  }

  if (reason && VALID_REASONS.includes(reason)) {
    where.reason = reason;
  }

  if (search) {
    where.OR = [
      { code: { contains: search } },
      { recipientName: { contains: search } },
      { recipientPhone: { contains: search } },
      { recipientEmail: { contains: search } },
    ];
  }

  const [giftCards, total] = await Promise.all([
    db.giftCard.findMany({
      where,
      include: {
        store: { select: { id: true, name: true } },
        issuedByUser: { select: { id: true, name: true } },
        issuedToCustomer: { select: { id: true, name: true, phone: true } },
        _count: { select: { redemptions: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.giftCard.count({ where }),
  ]);

  return Response.json({
    success: true,
    data: giftCards,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

async function createGiftCardHandler(...args: unknown[]): Promise<Response> {
  const request = args[0] as NextRequest;
  const body = await request.json();

  const validation = validateInput(createGiftCardSchema, body);
  if (!validation.success) {
    return Response.json({ success: false, error: validation.error }, { status: 400 });
  }
  const {
    storeId,
    reason,
    initialBalance,
    recipientName,
    recipientPhone,
    recipientEmail,
    notes,
    autoAdjustItems,
  } = validation.data;

  // Fields from body that are not in the schema but still used
  const currency = (body as Record<string, unknown>).currency || 'KES';
  // SYS-2: issuer identity comes from the session inside the tx (body ignored).
  const _issuedBy = (body as Record<string, unknown>).issuedBy || null;
  const issuedTo = (body as Record<string, unknown>).issuedTo || null;
  const expiresAt = (body as Record<string, unknown>).expiresAt || validation.data.expiryDate || null;

  // Verify store exists
  const store = await db.store.findUnique({ where: { id: storeId } });
  if (!store) {
    return Response.json(
      { success: false, error: 'Store not found.' },
      { status: 404 }
    );
  }

  // Generate a unique code
  let code: string;
  let attempts = 0;
  do {
    code = generateGiftCardCode();
    const existing = await db.giftCard.findUnique({ where: { code } });
    if (!existing) break;
    attempts++;
  } while (attempts < 10);

  if (attempts >= 10) {
    return Response.json(
      { success: false, error: 'Failed to generate a unique gift card code. Please try again.' },
      { status: 500 }
    );
  }

  const isAutoAdjust = autoAdjustItems ?? false;
  const isVisible = isAutoAdjust ? initialBalance > 0 : true;

  // ── F5-4 remediation ────────────────────────────────────────────────────
  // Issuance previously minted spendable value with NO tender record and NO
  // journal — the Gift Card Liability (2300) account was credited only at
  // redemption, structurally driving it negative while the card spent real
  // money. Now the card, the liability posting (recordGiftCardIssuance: Dr
  // Cash/M-Pesa, Cr Gift Card Liability) and a cash-drawer tender entry are
  // committed in ONE transaction. issuedBy always comes from the session.
  const session = await getSessionFromRequest(request);
  const giftCard = await db.$transaction(async (tx) => {
    const created = await tx.giftCard.create({
      data: {
        storeId,
        code,
        reason,
        initialBalance,
        currentBalance: initialBalance,
        currency: currency || 'KES',
        status: 'ACTIVE',
        recipientName: recipientName || null,
        recipientPhone: recipientPhone || null,
        recipientEmail: recipientEmail || null,
        notes: notes || null,
        issuedBy: session?.userId || null,
        issuedTo: issuedTo || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        autoAdjustItems: isAutoAdjust,
        isVisible,
      },
      include: {
        store: { select: { id: true, name: true } },
        issuedByUser: { select: { id: true, name: true } },
        issuedToCustomer: { select: { id: true, name: true, phone: true } },
      },
    });

    // Post the liability (and tender debit) — never call on zero-value cards.
    if (Number(initialBalance) > 0) {
      const store = await tx.store.findUnique({
        where: { id: storeId },
        select: { organizationId: true },
      });
      await recordGiftCardIssuance(tx, {
        organizationId: store?.organizationId || 'org_mbumah',
        storeId,
        giftCardId: created.id,
        giftCardCode: code,
        amount: Number(initialBalance),
        // Cards issued over the counter are funded by cash unless recorded
        // otherwise; the tender is auditable via the cash drawer entry.
        paymentMethod: 'CASH',
        cashierId: session?.userId || 'system', // 'system' actor seeded in prisma/seed.ts
      });

      // Cash-drawer tender entry — SUM-derived balance (R6 pattern).
      const drawerAgg = await tx.cashDrawerLog.aggregate({
        where: { storeId },
        _sum: { amount: true },
      });
      const runningBalance = Number(drawerAgg._sum.amount ?? 0) + Number(initialBalance);
      await tx.cashDrawerLog.create({
        data: {
          storeId,
          userId: session?.userId || 'system',
          action: 'CASH_IN',
          amount: initialBalance,
          balance: runningBalance,
          notes: `Gift card ${code} issued (tender for liability)`,
        },
      });
    }

    return created;
  });

  await systemLog({
    action: 'GIFT_CARD_CREATED',
    component: LogComponent.FINANCIAL,
    severity: LogSeverity.INFO,
    message: `Gift card ${code} created with balance ${initialBalance}`,
    storeId,
    metadata: { giftCardId: giftCard.id, code, initialBalance, reason },
  });

  return Response.json({ success: true, data: giftCard }, { status: 201 });
}

export const GET = withErrorBoundary(withSessionAuth(listGiftCardsHandler), 'GIFT_CARDS_LIST');
export const POST = withErrorBoundary(withSessionAuth(createGiftCardHandler, FINANCIAL_ROLES.WRITE), 'GIFT_CARDS_CREATE');
