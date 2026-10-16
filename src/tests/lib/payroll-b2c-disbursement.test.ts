// PAYROLL M-PESA B2C DISBURSEMENT TESTS - v2.21.0
//
// Contracts under test (EMS spec Phase 4.6 optional M-Pesa B2C disbursement):
//   • Only posted/locked runs can be disbursed (state machine guard).
//   • Production refuses mock mode when Daraja B2C is not configured.
//   • One payslip has at most ONE active disbursement transaction -
//     re-running the disbursement skips instead of double-paying.
//   • Employees without a phone number are skipped with a reason, not failed.
//   • MOCK mode settles payslips immediately (PAID + MPESA- receipt) and
//     stamps paidAt when nothing remains pending.
//   • The B2C result webhook settles the payslip exactly once (atomic claim);
//     duplicate deliveries are ignored; failures leave the payslip PENDING.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    count: vi.fn(),
  });
  return {
    mpesaTransaction: model(),
    payrollRun: model(),
    payrollDetail: model(),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
  };
});

vi.mock('@/lib/db', () => ({
  db,
  withImmutabilityBypass:
    <T,>(fn: () => Promise<T>, _reason?: string): Promise<T> =>
      fn(),
}));
vi.mock('@/lib/logger', () => ({ systemLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/hr/audit', () => ({
  hrAudit: vi.fn().mockResolvedValue(undefined),
  HrEntityType: { PAYROLL_RUN: 'PayrollRun', PAYSLIP: 'PayrollDetail' },
}));
vi.mock('@/lib/mpesa-daraja', () => ({
  normalisePhone: (raw: string) => {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.startsWith('0')) return `254${digits.slice(1)}`;
    return digits;
  },
}));

import {
  disburseRunViaMpesa,
  settlePayrollB2CResult,
  retryFailedPayrollB2C,
  refreshStuckPayrollB2C,
  summariseRunB2CState,
  B2C_STALE_PROCESSING_MS,
} from '@/lib/hr/payroll/disbursement-service';
import { PayrollLifecycleError } from '@/lib/hr/payroll/run-service';
import { initiatePayrollB2C } from '@/lib/mpesa-b2c';
import { hrAudit } from '@/lib/hr/audit';

const CTX = { storeId: 'store-1', organizationId: 'org-1', actorId: 'user-1' };

// NODE_ENV is typed read-only on ImportMetaEnv; route through a widened
// handle so tests can flip modes without tsc TS2540.
function setNodeEnv(value: string | undefined) {
  const holder = process as unknown as { env: Record<string, string | undefined> };
  if (value === undefined) delete holder.env.NODE_ENV;
  else holder.env.NODE_ENV = value;
}

function runFixture(status = 'POSTED') {
  return {
    id: 'run-1',
    storeId: 'store-1',
    status,
    paidAt: null,
    payrollPeriod: { name: 'September 2026' },
  };
}

function detailFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'detail-1',
    payrollRunId: 'run-1',
    storeId: 'store-1',
    netPay: '50000',
    paymentStatus: 'PENDING',
    employee: { employeeCode: 'MBM-JUJ-E001', firstName: 'Mary', lastName: 'Wanjiku', phone: '0712345678' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MPESA_CONSUMER_KEY;
  delete process.env.MPESA_CONSUMER_SECRET;
  delete process.env.MPESA_SHORTCODE;
  delete process.env.MPESA_INITIATOR_NAME;
  delete process.env.MPESA_INITIATOR_PASSWORD;
  delete process.env.MPESA_SECURITY_CREDENTIAL;
  delete process.env.MPESA_B2C_ALLOW_MOCK;
  setNodeEnv(undefined);
});

describe('disburseRunViaMpesa', () => {
  it('rejects runs that are not POSTED or LOCKED', async () => {
    db.payrollRun.findFirst.mockResolvedValue(runFixture('APPROVED'));
    await expect(disburseRunViaMpesa(CTX, 'run-1')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('refuses mock mode in production when B2C is not configured', async () => {
    setNodeEnv('production');
    delete process.env.MPESA_B2C_ALLOW_MOCK;
    db.payrollRun.findFirst.mockResolvedValue(runFixture());
    await expect(disburseRunViaMpesa(CTX, 'run-1')).rejects.toMatchObject({
      code: 'B2C_NOT_CONFIGURED',
    });
  });

  it('allows mock on a production build with the explicit staging opt-in', async () => {
    setNodeEnv('production');
    process.env.MPESA_B2C_ALLOW_MOCK = 'true';
    db.payrollRun.findFirst.mockResolvedValue(runFixture());
    db.payrollDetail.findMany.mockResolvedValue([detailFixture({ id: 'd-optin' })]);
    db.mpesaTransaction.findFirst.mockResolvedValue(null);
    db.mpesaTransaction.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'mpx-optin', ...data }),
    );
    db.payrollDetail.update.mockResolvedValue({});
    db.payrollDetail.count.mockResolvedValue(0);
    db.payrollRun.update.mockResolvedValue({});

    const summary = await disburseRunViaMpesa(CTX, 'run-1');
    expect(summary.mode).toBe('mock');
    expect(summary.initiated).toBe(1);
  });

  it('throws RUN_NOT_FOUND for another store\u2019s run', async () => {
    db.payrollRun.findFirst.mockResolvedValue(null);
    await expect(disburseRunViaMpesa(CTX, 'missing')).rejects.toBeInstanceOf(PayrollLifecycleError);
  });

  it('skips employees without a phone number and disburses the rest (mock mode)', async () => {
    setNodeEnv('development');
    db.payrollRun.findFirst.mockResolvedValue(runFixture());
    db.payrollDetail.findMany.mockResolvedValue([
      detailFixture({ id: 'd1' }),
      detailFixture({ id: 'd2', employee: { employeeCode: 'MBM-JUJ-E002', firstName: 'Peter', lastName: 'Kamau', phone: null } }),
    ]);
    db.mpesaTransaction.findFirst.mockResolvedValue(null);
    db.mpesaTransaction.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'mpx-new', ...data }),
    );
    db.payrollDetail.update.mockResolvedValue({});
    db.payrollDetail.count.mockResolvedValue(0); // nothing pending after settlement
    db.payrollRun.update.mockResolvedValue({});

    const summary = await disburseRunViaMpesa(CTX, 'run-1');

    expect(summary.mode).toBe('mock');
    expect(summary.eligible).toBe(2);
    expect(summary.initiated).toBe(1);
    expect(summary.skipped).toHaveLength(1);
    expect(summary.skipped[0].employeeCode).toBe('MBM-JUJ-E002');
    expect(summary.receipts[0].employeeCode).toBe('MBM-JUJ-E001');
    expect(summary.receipts[0].receipt).toMatch(/^SIM/);
    // Payslip settled with an MPESA- receipt reference
    expect(db.payrollDetail.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({
          paymentStatus: 'PAID',
          paymentRef: expect.stringMatching(/^MPESA-SIM/),
        }),
      }),
    );
    // paidAt stamped when nothing remains pending
    expect(db.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run-1' }, data: { paidAt: expect.any(Date) } }),
    );
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'PayrollRun', resourceId: 'run-1' }),
    );
  });

  it('does not re-initiate a payslip that already has an active transaction', async () => {
    setNodeEnv('development');
    db.payrollRun.findFirst.mockResolvedValue(runFixture());
    db.payrollDetail.findMany.mockResolvedValue([detailFixture({ id: 'd1' })]);
    // Second call goes through initiatePayrollB2C's idempotency branch.
    db.mpesaTransaction.findFirst.mockResolvedValue({
      id: 'mpx-1',
      status: 'PROCESSING',
      checkoutRequestId: 'pb2c-1',
      merchantRequestId: null,
      mpesaReceiptNumber: null,
    });
    db.payrollRun.update.mockResolvedValue({});

    const summary = await disburseRunViaMpesa(CTX, 'run-1');
    expect(summary.alreadyInitiated).toBe(1);
    expect(summary.initiated).toBe(0);
    expect(db.mpesaTransaction.create).not.toHaveBeenCalled();
  });

  it('reports per-employee failures without aborting the batch', async () => {
    setNodeEnv('development');
    db.payrollRun.findFirst.mockResolvedValue(runFixture());
    const bad = detailFixture({ id: 'd-bad', employee: { employeeCode: 'E-BAD', firstName: 'A', lastName: 'B', phone: '123' } });
    db.payrollDetail.findMany.mockResolvedValue([bad, detailFixture({ id: 'd-good' })]);
    db.mpesaTransaction.findFirst.mockResolvedValue(null);
    db.mpesaTransaction.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'mpx-new', ...data }),
    );
    db.payrollDetail.update.mockResolvedValue({});
    db.payrollDetail.count.mockResolvedValue(1);
    db.payrollRun.update.mockResolvedValue({});

    const summary = await disburseRunViaMpesa(CTX, 'run-1');
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0].employeeCode).toBe('E-BAD');
    expect(summary.initiated).toBe(1);
    // paidAt NOT stamped when a failure occurred
    expect(db.payrollRun.update).not.toHaveBeenCalled();
  });
});

describe('initiatePayrollB2C (unit)', () => {
  it('rejects invalid phone numbers', async () => {
    await expect(
      initiatePayrollB2C({
        phone: '123',
        amount: 100,
        storeId: 's1',
        payrollDetailId: 'd1',
        employeeCode: 'E1',
        periodName: 'P',
      }),
    ).rejects.toThrow(/Invalid M-Pesa number/);
  });

  it('rejects non-positive amounts', async () => {
    await expect(
      initiatePayrollB2C({
        phone: '0712345678',
        amount: 0,
        storeId: 's1',
        payrollDetailId: 'd1',
        employeeCode: 'E1',
        periodName: 'P',
      }),
    ).rejects.toThrow(/positive/);
  });

  it('creates a COMPLETED mock transaction with a SIM receipt', async () => {
    db.mpesaTransaction.findFirst.mockResolvedValue(null);
    db.mpesaTransaction.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'mpx-new', ...data }),
    );

    const result = await initiatePayrollB2C({
      phone: '0712345678',
      amount: 50000,
      storeId: 's1',
      payrollDetailId: 'd1',
      employeeCode: 'E1',
      periodName: 'September 2026',
    });

    expect(result.mode).toBe('mock');
    expect(result.status).toBe('COMPLETED');
    expect(result.receiptNumber).toMatch(/^SIM/);
    expect(result.alreadyInitiated).toBe(false);
    expect(db.mpesaTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storeId: 's1',
        payrollDetailId: 'd1',
        status: 'COMPLETED',
        callbackReceived: true,
        phoneNumber: '254712345678',
      }),
    });
  });
});

describe('settlePayrollB2CResult', () => {
  it('settles a successful result exactly once and marks the payslip PAID', async () => {
    db.mpesaTransaction.findFirst.mockResolvedValue({
      id: 'mpx-1',
      storeId: 'store-1',
      status: 'PROCESSING',
      callbackReceived: false,
      amount: 50000,
      payrollDetailId: 'd1',
    });
    db.mpesaTransaction.updateMany.mockResolvedValue({ count: 1 });
    db.payrollDetail.update.mockResolvedValue({});
    db.payrollDetail.findFirst.mockResolvedValue({
      storeId: 'store-1',
      employee: { employeeCode: 'MBM-JUJ-E001' },
    });

    const outcome = await settlePayrollB2CResult({
      OriginatorConversationID: 'pb2c-abc',
      Result: { ResultCode: 0, ResultDesc: 'The service request is processed successfully.', TransactionID: 'SBR12ABC34' },
    });

    expect(outcome).toMatchObject({ settled: true, alreadySettled: false, outcome: 'COMPLETED' });
    expect(db.mpesaTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'mpx-1', callbackReceived: false },
      data: expect.objectContaining({ status: 'COMPLETED', mpesaReceiptNumber: 'SBR12ABC34' }),
    });
    expect(db.payrollDetail.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd1' },
        data: expect.objectContaining({
          paymentStatus: 'PAID',
          paymentRef: 'MPESA-SBR12ABC34',
        }),
      }),
    );
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({ resourceType: 'PayrollDetail', resourceId: 'd1' }),
    );
  });

  it('ignores duplicate deliveries (callback already claimed)', async () => {
    db.mpesaTransaction.findFirst.mockResolvedValue({
      id: 'mpx-1',
      status: 'COMPLETED',
      callbackReceived: true,
      payrollDetailId: 'd1',
    });

    const outcome = await settlePayrollB2CResult({
      OriginatorConversationID: 'pb2c-abc',
      Result: { ResultCode: 0, TransactionID: 'SBR1' },
    });

    expect(outcome.alreadySettled).toBe(true);
    expect(db.mpesaTransaction.updateMany).not.toHaveBeenCalled();
    expect(db.payrollDetail.update).not.toHaveBeenCalled();
  });

  it('leaves the payslip PENDING on a failed result', async () => {
    db.mpesaTransaction.findFirst.mockResolvedValue({
      id: 'mpx-2',
      storeId: 'store-1',
      status: 'PROCESSING',
      callbackReceived: false,
      amount: 100,
      payrollDetailId: 'd2',
    });
    db.mpesaTransaction.updateMany.mockResolvedValue({ count: 1 });

    const outcome = await settlePayrollB2CResult({
      OriginatorConversationID: 'pb2c-xyz',
      Result: { ResultCode: 2001, ResultDesc: 'Recipient is not registered on M-Pesa.' },
    });

    expect(outcome.outcome).toBe('FAILED');
    expect(db.mpesaTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'mpx-2', callbackReceived: false },
      data: expect.objectContaining({ status: 'FAILED' }),
    });
    expect(db.payrollDetail.update).not.toHaveBeenCalled();
  });

  it('returns UNKNOWN for payloads with no conversation reference', async () => {
    const outcome = await settlePayrollB2CResult({ Result: { ResultCode: 0 } });
    expect(outcome).toMatchObject({ settled: false, outcome: 'UNKNOWN' });
    expect(db.mpesaTransaction.findFirst).not.toHaveBeenCalled();
  });
});


// ── v2.22.0: retry-failed + stuck-status recovery ────────────────────────────

describe('retryFailedPayrollB2C', () => {
  it('rejects with NOTHING_TO_RETRY when no payslip has a failed attempt', async () => {
    db.payrollRun.findFirst.mockResolvedValue(runFixture('POSTED'));
    db.payrollDetail.findMany.mockResolvedValueOnce([{ id: 'detail-1' }]);
    db.mpesaTransaction.findMany.mockResolvedValueOnce([{ payrollDetailId: 'detail-1', status: 'COMPLETED' }]);
    await expect(retryFailedPayrollB2C(CTX, 'run-1')).rejects.toMatchObject({ code: 'NOTHING_TO_RETRY', status: 409 });
  });

  it('re-initiates only payslips whose latest attempt FAILED and settles them in mock mode', async () => {
    setNodeEnv('development');
    // Earlier tests install persistent findFirst mocks (clearAllMocks keeps
    // implementations) — reset so initiatePayrollB2C's idempotency lookup
    // sees no active transaction for the retryable payslip.
    db.mpesaTransaction.findFirst.mockReset().mockResolvedValue(undefined);
    db.payrollRun.findFirst.mockResolvedValue(runFixture('POSTED'));
    // runDetailIds → run payslips
    db.payrollDetail.findMany.mockResolvedValueOnce([{ id: 'detail-1' }, { id: 'detail-2' }]);
    // latest tx per payslip: detail-1 FAILED (retryable), detail-2 COMPLETED (untouched)
    db.mpesaTransaction.findMany.mockResolvedValueOnce([
      { payrollDetailId: 'detail-1', status: 'COMPLETED' },
      { payrollDetailId: 'detail-1', status: 'FAILED' },
      { payrollDetailId: 'detail-2', status: 'COMPLETED' },
    ]);
    // retryable details fetch (employee + money columns)
    db.payrollDetail.findMany.mockResolvedValueOnce([
      detailFixture({ id: 'detail-1', transactions: undefined }),
    ]);
    db.payrollDetail.count.mockResolvedValue(0);
    db.payrollDetail.update.mockResolvedValue({});
    db.mpesaTransaction.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'tx-new', ...args.data }));
    db.payrollRun.update.mockResolvedValue({});

    const summary = await retryFailedPayrollB2C(CTX, 'run-1');
    expect(summary.mode).toBe('mock');
    expect(summary.eligible).toBe(1);
    expect(summary.initiated).toBe(1);
    expect(summary.receipts).toHaveLength(1);
    // Payslip settled PAID with the mock receipt
    expect(db.payrollDetail.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: 'PAID' }) }),
    );
    // paidAt stamped when nothing remains pending
    expect(db.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paidAt: expect.any(Date) }) }),
    );
    // Audit carries the retry marker
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ b2cRetry: true }) }),
    );
  });

  it('never touches a payslip with an active PROCESSING transaction', async () => {
    setNodeEnv('development');
    db.payrollRun.findFirst.mockResolvedValue(runFixture('POSTED'));
    db.payrollDetail.findMany.mockResolvedValueOnce([{ id: 'detail-1' }]);
    db.mpesaTransaction.findMany.mockResolvedValueOnce([{ payrollDetailId: 'detail-1', status: 'PROCESSING' }]);
    await expect(retryFailedPayrollB2C(CTX, 'run-1')).rejects.toMatchObject({ code: 'NOTHING_TO_RETRY' });
  });
});

describe('summariseRunB2CState', () => {
  it('aggregates per-payslip B2C state without PII', async () => {
    const now = Date.now();
    db.payrollDetail.findMany.mockResolvedValueOnce([
      { id: 'd1', paymentStatus: 'PENDING' },
      { id: 'd2', paymentStatus: 'PENDING' },
      { id: 'd3', paymentStatus: 'PAID' },
    ]);
    db.mpesaTransaction.findMany.mockResolvedValueOnce([
      { payrollDetailId: 'd1', status: 'COMPLETED', createdAt: new Date(now - 120_000), resultDesc: null },
      { payrollDetailId: 'd1', status: 'FAILED', createdAt: new Date(now - 60_000), resultDesc: 'recipient not registered' },
      { payrollDetailId: 'd2', status: 'PROCESSING', createdAt: new Date(now - 30 * 60_000), resultDesc: null },
      { payrollDetailId: 'd3', status: 'COMPLETED', createdAt: new Date(now - 90_000), resultDesc: null },
    ]);
    const state = await summariseRunB2CState('run-1');
    expect(state.failed).toBe(1);
    expect(state.processing).toBe(1);
    expect(state.staleProcessing).toBe(1); // 30 min > 10 min threshold
    expect(state.completed).toBe(1);
    const failed = state.perPayslip.find((p) => p.payrollDetailId === 'd1');
    expect(failed).toMatchObject({ attempts: 2, lastStatus: 'FAILED', settled: false });
    // No phone numbers / names / employee codes in the payload
    expect(JSON.stringify(state)).not.toMatch(/0712|Wanjiku|MBM-JUJ/);
  });
});

describe('refreshStuckPayrollB2C', () => {
  it('mock mode resolves a stuck PROCESSING transaction and settles the payslip', async () => {
    setNodeEnv('development');
    db.payrollRun.findFirst.mockResolvedValue(runFixture('POSTED'));
    db.payrollDetail.findMany.mockResolvedValueOnce([{ id: 'detail-stuck' }]);
    db.mpesaTransaction.findMany.mockResolvedValueOnce([
      {
        id: 'tx-stuck',
        checkoutRequestId: 'pb2c-stuck',
        payrollDetailId: 'detail-stuck',
        status: 'PROCESSING',
        callbackReceived: false,
        createdAt: new Date(Date.now() - B2C_STALE_PROCESSING_MS - 60_000),
      },
    ]);
    // codeById + paidStatus map fetch
    db.payrollDetail.findMany.mockResolvedValueOnce([
      { id: 'detail-stuck', paymentStatus: 'PENDING', employee: { employeeCode: 'MBM-JUJ-E002' } },
    ]);
    // queryPayrollB2CStatus mock path: locate the transaction, then complete it
    db.mpesaTransaction.findFirst.mockResolvedValue({ id: 'tx-stuck', callbackReceived: false, status: 'PROCESSING' });
    db.mpesaTransaction.update.mockResolvedValue({});
    db.payrollDetail.update.mockResolvedValue({});

    const result = await refreshStuckPayrollB2C(CTX, 'run-1');
    expect(result.mode).toBe('mock');
    expect(result.queried).toBe(1);
    expect(result.settled).toBe(1);
    expect(result.receipts[0]).toMatchObject({ employeeCode: 'MBM-JUJ-E002' });
    expect(db.payrollDetail.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ paymentStatus: 'PAID' }) }),
    );
    expect(hrAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ b2cStatusQuery: true, settled: 1 }) }),
    );
  });

  it('ignores fresh PROCESSING transactions (below the staleness threshold)', async () => {
    setNodeEnv('development');
    db.mpesaTransaction.findFirst.mockReset().mockResolvedValue(undefined);
    db.payrollRun.findFirst.mockResolvedValue(runFixture('POSTED'));
    db.payrollDetail.findMany.mockResolvedValueOnce([{ id: 'detail-1' }]);
    db.mpesaTransaction.findMany.mockResolvedValueOnce([
      {
        id: 'tx-fresh',
        checkoutRequestId: 'pb2c-fresh',
        payrollDetailId: 'detail-1',
        status: 'PROCESSING',
        callbackReceived: false,
        createdAt: new Date(Date.now() - 60_000),
      },
    ]);
    const result = await refreshStuckPayrollB2C(CTX, 'run-1');
    expect(result.queried).toBe(0);
    expect(result.message).toBe('No stuck transactions to re-query.');
  });
});
