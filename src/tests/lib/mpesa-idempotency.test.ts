// MPESA STK PUSH IDEMPOTENCY TESTS - v2.18.3.2 correction release
//
// findInFlightStkPush (src/lib/mpesa-idempotency.ts): the natural-window
// dedupe query behind the optional client-supplied idempotency key on
// POST /api/payments/mpesa/stkpush. Pure query logic - db mocked with the
// same hoisted-mock pattern as branch-workspace.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mpesaFindFirst } = vi.hoisted(() => ({
  mpesaFindFirst: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    mpesaTransaction: { findFirst: mpesaFindFirst },
  },
}));

vi.mock('@/lib/mpesa-daraja', () => ({
  normalisePhone: (raw: string) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.startsWith('0')) return `254${digits.slice(1)}`;
    if (digits.startsWith('254')) return digits;
    return digits;
  },
}));

import { findInFlightStkPush, STK_IDEMPOTENCY_WINDOW_MINUTES } from '@/lib/mpesa-idempotency';

function inFlightRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mpesa_1',
    checkoutRequestId: 'ws_CO_1',
    phoneNumber: '254712345678',
    amount: 1500,
    status: 'PROCESSING',
    createdAt: new Date(Date.now() - 60 * 1000),
    ...overrides,
  };
}

describe('findInFlightStkPush (v2.18.3.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when no in-flight push exists', async () => {
    mpesaFindFirst.mockResolvedValue(null);
    const result = await findInFlightStkPush({ phone: '0712345678', amount: 1500 });
    expect(result).toBeNull();
  });

  it('returns the most recent in-flight push when one matches', async () => {
    const row = inFlightRow();
    mpesaFindFirst.mockResolvedValue(row);
    const result = await findInFlightStkPush({ phone: '0712345678', amount: 1500 });
    expect(result).toEqual(row);
  });

  it('normalises the phone before querying', async () => {
    mpesaFindFirst.mockResolvedValue(null);
    await findInFlightStkPush({ phone: '0712 345 678', amount: 1500 });
    const where = mpesaFindFirst.mock.calls[0][0].where;
    expect(where.phoneNumber).toBe('254712345678');
  });

  it('scopes by storeId when one is provided and omits the filter when null', async () => {
    mpesaFindFirst.mockResolvedValue(null);
    await findInFlightStkPush({ storeId: 'store_juja', phone: '0712345678', amount: 1500 });
    expect(mpesaFindFirst.mock.calls[0][0].where.storeId).toBe('store_juja');

    await findInFlightStkPush({ storeId: null, phone: '0712345678', amount: 1500 });
    expect(mpesaFindFirst.mock.calls[1][0].where.storeId).toBeUndefined();
  });

  it('restricts the query to PENDING and PROCESSING rows inside the window', async () => {
    mpesaFindFirst.mockResolvedValue(null);
    await findInFlightStkPush({ phone: '0712345678', amount: 1500 });
    const where = mpesaFindFirst.mock.calls[0][0].where;
    expect(where.status).toEqual({ in: ['PENDING', 'PROCESSING'] });
    expect(where.createdAt.gte.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('uses a 10 minute default window', async () => {
    mpesaFindFirst.mockResolvedValue(null);
    await findInFlightStkPush({ phone: '0712345678', amount: 1500 });
    const where = mpesaFindFirst.mock.calls[0][0].where;
    const expectedFloor = Date.now() - STK_IDEMPOTENCY_WINDOW_MINUTES * 60 * 1000;
    expect(where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(expectedFloor - 1000);
  });

  it('returns null for an unusable phone without querying', async () => {
    mpesaFindFirst.mockResolvedValue(inFlightRow());
    const result = await findInFlightStkPush({ phone: '   ', amount: 1500 });
    expect(result).toBeNull();
    expect(mpesaFindFirst).not.toHaveBeenCalled();
  });
});
