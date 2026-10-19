// B2C AUTO-RECOVERY SWEEP TESTS - v2.155.0
//
// Contracts under test (the "persistence" half of the B2C retry story):
//   • The sweep early-outs HONESTLY in production without Daraja credentials
//     (configured:false, no DB churn) — the same mock discipline as the UI.
//   • pickB2CRecoveryActions is PURE: only gate-allowed, unsettled, latest-
//     FAILED payslips are re-sent; backoff/ceiling-blocked ones NEVER move
//     from the cron path; stuck PROCESSING past the stale window triggers
//     exactly one re-query sweep.
//   • Per-run isolation: a benign lifecycle refusal (NOTHING_TO_RETRY,
//     B2C_NOT_CONFIGURED) is a counted no-op; an unexpected error is recorded
//     and the tick continues to the next run.
//   • The audit sentinel is the sweep's own actor id (never a fake human).
//   • The cron route gates on x-cron-secret exactly like its siblings and
//     returns the sweep summary verbatim.
//   • The hourly dispatcher folds the sweep in (source contract).
//   • The run dialog tells the truth about auto-recovery (source contract).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const db = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  });
  return {
    payrollRun: model(),
    payrollDetail: model(),
    mpesaTransaction: model(),
  };
});

vi.mock('@/lib/db', () => ({ db }));
vi.mock('@/lib/logger', () => ({
  systemLog: vi.fn().mockResolvedValue(undefined),
  withErrorBoundary: (fn: unknown) => fn,
}));
vi.mock('@/lib/mpesa-b2c', () => ({
  isB2CConfigured: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  summarise: vi.fn(),
  retry: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@/lib/hr/payroll/disbursement-service', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    summariseRunB2CState: mocks.summarise,
    retryFailedPayrollB2C: mocks.retry,
    refreshStuckPayrollB2C: mocks.refresh,
  };
});

import {
  pickB2CRecoveryActions,
  sweepStalledPayrollB2C,
  b2cRecoveryConfigured,
  B2C_RECOVERY_ACTOR_ID,
  B2C_RECOVERY_MAX_RUNS_PER_TICK,
  type B2CRecoveryActions,
} from '@/lib/hr/payroll/b2c-recovery';
import { isB2CConfigured } from '@/lib/mpesa-b2c';
import { PayrollLifecycleError } from '@/lib/hr/payroll/run-service';
import type { B2CStateSummary } from '@/lib/hr/payroll/disbursement-service';

const summariseState = (over: Partial<B2CStateSummary> = {}): B2CStateSummary => ({
  pendingWithoutAttempt: 0,
  processing: 0,
  staleProcessing: 0,
  failed: 0,
  completed: 0,
  retryBlocked: 0,
  perPayslip: [],
  ...over,
});

// ── pickB2CRecoveryActions (pure) ────────────────────────────────────────────

describe('pickB2CRecoveryActions', () => {
  it('re-sends only gate-allowed, unsettled, latest-FAILED payslips', () => {
    const a: B2CRecoveryActions = pickB2CRecoveryActions(
      summariseState({
        failed: 2,
        perPayslip: [
          { payrollDetailId: 'd-1', attempts: 1, lastStatus: 'FAILED', lastAttemptAt: 'x', lastResultDesc: null, settled: false },
          { payrollDetailId: 'd-2', attempts: 1, lastStatus: 'FAILED', lastAttemptAt: 'x', lastResultDesc: null, settled: false, retryBlocked: true },
          { payrollDetailId: 'd-3', attempts: 2, lastStatus: 'COMPLETED', lastAttemptAt: 'x', lastResultDesc: null, settled: true },
        ],
      }),
    );
    expect(a.retryDetailIds).toEqual(['d-1']);
    expect(a.refreshStuck).toBe(false);
  });

  it('never touches payslips the retry gate blocks (backoff open or ceiling hit)', () => {
    const a = pickB2CRecoveryActions(
      summariseState({
        failed: 2,
        retryBlocked: 2,
        perPayslip: [
          { payrollDetailId: 'd-b1', attempts: 2, lastStatus: 'FAILED', lastAttemptAt: 'x', lastResultDesc: null, settled: false, retryBlocked: true, nextRetryAt: '2030-01-01T00:00:00.000Z' },
          { payrollDetailId: 'd-b2', attempts: 5, lastStatus: 'FAILED', lastAttemptAt: 'x', lastResultDesc: null, settled: false, retryBlocked: true, maxAttemptsReached: true },
        ],
      }),
    );
    expect(a.retryDetailIds).toEqual([]);
  });

  it('re-queries when a PROCESSING transaction has gone stale, and only then', () => {
    const fresh = pickB2CRecoveryActions(summariseState({ processing: 2, staleProcessing: 0 }));
    expect(fresh.refreshStuck).toBe(false);
    const stale = pickB2CRecoveryActions(summariseState({ processing: 2, staleProcessing: 1 }));
    expect(stale.refreshStuck).toBe(true);
  });

  it('is a no-op on a settled run and on an empty summary', () => {
    expect(pickB2CRecoveryActions(summariseState(), { settledRun: true })).toEqual({
      retryDetailIds: [],
      refreshStuck: false,
    } satisfies B2CRecoveryActions);
    expect(pickB2CRecoveryActions(summariseState())).toEqual({
      retryDetailIds: [],
      refreshStuck: false,
    } satisfies B2CRecoveryActions);
  });
});

// ── b2cRecoveryConfigured (mock discipline) ─────────────────────────────────

describe('b2cRecoveryConfigured', () => {
  const ORIGINAL = { NODE_ENV: process.env.NODE_ENV, MOCK: process.env.MPESA_B2C_ALLOW_MOCK };
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL.NODE_ENV;
    if (ORIGINAL.MOCK === undefined) delete process.env.MPESA_B2C_ALLOW_MOCK;
    else process.env.MPESA_B2C_ALLOW_MOCK = ORIGINAL.MOCK;
    vi.mocked(isB2CConfigured).mockReset();
  });

  it('allows when Daraja is configured regardless of environment', () => {
    vi.mocked(isB2CConfigured).mockReturnValue(true);
    process.env.NODE_ENV = 'production';
    expect(b2cRecoveryConfigured()).toBe(true);
  });

  it('early-outs in production without credentials and without the mock opt-in', () => {
    vi.mocked(isB2CConfigured).mockReturnValue(false);
    process.env.NODE_ENV = 'production';
    delete process.env.MPESA_B2C_ALLOW_MOCK;
    expect(b2cRecoveryConfigured()).toBe(false);
  });

  it('allows the explicit mock opt-in in production and any unconfigured dev run', () => {
    vi.mocked(isB2CConfigured).mockReturnValue(false);
    process.env.NODE_ENV = 'production';
    process.env.MPESA_B2C_ALLOW_MOCK = 'true';
    expect(b2cRecoveryConfigured()).toBe(true);
    process.env.NODE_ENV = 'development';
    delete process.env.MPESA_B2C_ALLOW_MOCK;
    expect(b2cRecoveryConfigured()).toBe(true);
  });
});

// ── sweepStalledPayrollB2C ───────────────────────────────────────────────────

describe('sweepStalledPayrollB2C', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isB2CConfigured).mockReturnValue(true);
    db.payrollRun.findMany.mockResolvedValue([]);
  });

  const runRow = (id: string) => ({
    id,
    storeId: 'store_x',
    store: { organizationId: 'org_x' },
  });

  it('early-outs honestly in unconfigured production without touching the database', async () => {
    vi.mocked(isB2CConfigured).mockReturnValue(false);
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    delete process.env.MPESA_B2C_ALLOW_MOCK;
    try {
      const summary = await sweepStalledPayrollB2C({ summarise: mocks.summarise, retry: mocks.retry, refresh: mocks.refresh });
      expect(summary.configured).toBe(false);
      expect(summary.mode).toBe('mock');
      expect(summary.runsScanned).toBe(0);
      expect(db.payrollRun.findMany).not.toHaveBeenCalled();
      expect(mocks.summarise).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = env;
    }
  });

  it('retries gate-allowed failures and re-queries stale transfers through the sweep sentinel', async () => {
    db.payrollRun.findMany.mockResolvedValue([runRow('run-1')]);
    mocks.summarise.mockResolvedValue(
      summariseState({
        failed: 1,
        staleProcessing: 1,
        perPayslip: [
          { payrollDetailId: 'd-1', attempts: 1, lastStatus: 'FAILED', lastAttemptAt: 'x', lastResultDesc: null, settled: false },
          { payrollDetailId: 'd-2', attempts: 1, lastStatus: 'PROCESSING', lastAttemptAt: 'x', lastResultDesc: null, settled: false },
        ],
      }),
    );
    mocks.retry.mockResolvedValue({
      mode: 'daraja', eligible: 1, initiated: 1, alreadyInitiated: 0, skipped: [], failed: [], receipts: [{ employeeCode: 'E-1', receipt: 'QK7' }], backoffSkipped: 0, maxAttemptSkipped: 0,
    });
    mocks.refresh.mockResolvedValue({ mode: 'daraja', queried: 1, settled: 0, receipts: [], message: '' });

    const summary = await sweepStalledPayrollB2C({ summarise: mocks.summarise, retry: mocks.retry, refresh: mocks.refresh });

    expect(db.payrollRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['POSTED', 'LOCKED'] }, paidAt: null }),
        take: B2C_RECOVERY_MAX_RUNS_PER_TICK,
      }),
    );
    expect(mocks.retry).toHaveBeenCalledTimes(1);
    const [ctx, runId, ids] = mocks.retry.mock.calls[0];
    expect(ctx).toMatchObject({ storeId: 'store_x', organizationId: 'org_x', actorId: B2C_RECOVERY_ACTOR_ID });
    expect(runId).toBe('run-1');
    expect(ids).toEqual(['d-1']);
    expect(mocks.refresh).toHaveBeenCalledWith(ctx, 'run-1');
    expect(summary.runsScanned).toBe(1);
    expect(summary.runsTouched).toBe(1);
    expect(summary.retriedPayslips).toBe(1);
    expect(summary.receipts).toEqual([{ employeeCode: 'E-1', receipt: 'QK7' }]);
    expect(summary.errors).toEqual([]);
  });

  it('counts a benign NOTHING_TO_RETRY refusal as a skip, not an error', async () => {
    db.payrollRun.findMany.mockResolvedValue([runRow('run-raced')]);
    mocks.summarise.mockResolvedValue(
      summariseState({
        failed: 1,
        perPayslip: [{ payrollDetailId: 'd-9', attempts: 1, lastStatus: 'FAILED', lastAttemptAt: 'x', lastResultDesc: null, settled: false }],
      }),
    );
    mocks.retry.mockRejectedValue(
      new PayrollLifecycleError('NOTHING_TO_RETRY', 'No payslip in this run has a failed B2C attempt.', 409),
    );

    const summary = await sweepStalledPayrollB2C({ summarise: mocks.summarise, retry: mocks.retry, refresh: mocks.refresh });
    expect(summary.benignSkips).toBe(1);
    expect(summary.errors).toEqual([]);
    expect(summary.outcomes[0]).toMatchObject({ runId: 'run-raced', action: 'skipped', benignCode: 'NOTHING_TO_RETRY' });
  });

  it('isolates an unexpected run failure and keeps sweeping the next run', async () => {
    db.payrollRun.findMany.mockResolvedValue([runRow('run-bad'), runRow('run-good')]);
    mocks.summarise.mockImplementation(async (runId: string) => {
      if (runId === 'run-bad') throw new Error('neon socket hangup');
      return summariseState({
        failed: 1,
        perPayslip: [{ payrollDetailId: 'd-ok', attempts: 1, lastStatus: 'FAILED', lastAttemptAt: 'x', lastResultDesc: null, settled: false }],
      });
    });
    mocks.retry.mockResolvedValue({
      mode: 'daraja', eligible: 1, initiated: 1, alreadyInitiated: 0, skipped: [], failed: [], receipts: [], backoffSkipped: 0, maxAttemptSkipped: 0,
    });

    const summary = await sweepStalledPayrollB2C({ summarise: mocks.summarise, retry: mocks.retry, refresh: mocks.refresh });
    expect(summary.errors).toEqual([{ runId: 'run-bad', message: 'neon socket hangup' }]);
    expect(summary.retriedPayslips).toBe(1);
    expect(summary.outcomes).toHaveLength(2);
  });
});

// ── route + dispatcher + dialog contracts (source) ──────────────────────────

const ROOT = resolve(__dirname, '../..');

describe('b2c-recovery contracts (source)', () => {
  const routeSrc = readFileSync(resolve(ROOT, 'src/app/api/cron/b2c-recovery/route.ts'), 'utf8');
  const dispatcherSrc = readFileSync(resolve(ROOT, 'src/app/api/cron/hourly/route.ts'), 'utf8');
  const dialogSrc = readFileSync(resolve(ROOT, 'src/components/hr/payroll-run-dialog.tsx'), 'utf8');

  it('the cron route gates on x-cron-secret and returns the sweep summary', () => {
    expect(routeSrc).toContain("request.headers.get('x-cron-secret')");
    expect(routeSrc).toContain('Forbidden: invalid or missing x-cron-secret header.');
    expect(routeSrc).toContain('CRON_SECRET env var is not set');
    expect(routeSrc).toContain('sweepStalledPayrollB2C()');
    expect(routeSrc).toContain('maxDuration = 60');
  });

  it('the hourly dispatcher folds the sweep in as a named sub-job', () => {
    expect(dispatcherSrc).toContain("import { GET as b2cRecoveryGET } from '@/app/api/cron/b2c-recovery/route'");
    expect(dispatcherSrc).toContain("{ name: 'b2c-recovery', run: () => b2cRecoveryGET(request) }");
  });

  it('the run dialog carries the auto-recovery truth line where the sweep can act', () => {
    expect(dialogSrc).toContain('data-testid="b2c-auto-recovery-note"');
    expect(dialogSrc).toContain('Auto-recovery is on');
    // only on posted/locked runs with the disburse permission - never invented
    expect(dialogSrc).toContain("status === 'POSTED' || status === 'LOCKED'");
  });
});
