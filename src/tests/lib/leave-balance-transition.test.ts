// MBUMAH HARDWARE POS - leave balance transition delta tests (v2.30.0)
//
// REGRESSION GUARD for the Decimal-trap bug QA caught while exercising the
// approve flow: Prisma returns Decimal columns as decimal.js objects whose
// valueOf() is a STRING, so the old inline arithmetic in
// updateLeaveBalanceOnStatusChange did `usedDays + days` as STRING
// concatenation ("0" + "2" = "02") and round2() collapsed it to 0 —
// approving leave NEVER incremented usedDays. Subtraction "worked" only
// because `-` coerces numerically, which is exactly why the REJECT path
// looked healthy while the APPROVE path silently corrupted balances.
//
// The fix routes every transition through the pure leaveStatusTransitionDelta
// (Number() coercion at the boundary). A DecimalStub below reproduces the
// decimal.js valueOf behavior to prove the trap stays closed.

import { describe, it, expect } from 'vitest';
import { leaveStatusTransitionDelta } from '@/lib/payroll-helpers';

/** Mimics decimal.js: valueOf() returns the string form, so `+` concatenates. */
class DecimalStub {
  constructor(private readonly v: number) {}
  valueOf(): string {
    return String(this.v);
  }
  toString(): string {
    return String(this.v);
  }
}

describe('leaveStatusTransitionDelta — PENDING → APPROVED moves pending to used', () => {
  it('returns (-days, +days)', () => {
    expect(leaveStatusTransitionDelta('PENDING', 'APPROVED', 2)).toEqual({ pendingDelta: -2, usedDelta: 2 });
  });

  it('survives Prisma Decimal OBJECTS without string concatenation (the v2.29.x trap)', () => {
    // Old code: round2(Decimal(0) + Decimal(2)) === round2("02") === 0.
    const delta = leaveStatusTransitionDelta('PENDING', 'APPROVED', new DecimalStub(2) as unknown as number);
    expect(delta).toEqual({ pendingDelta: -2, usedDelta: 2 });
    // The exact broken expression, for contrast:
    const broken = `${new DecimalStub(0)}` + (new DecimalStub(2) as unknown as number);
    expect(broken).toBe('02'); // what the old arithmetic actually computed
  });

  it('survives string-number inputs', () => {
    expect(leaveStatusTransitionDelta('PENDING', 'APPROVED', '1.5' as unknown as number)).toEqual({
      pendingDelta: -1.5,
      usedDelta: 1.5,
    });
  });
});

describe('leaveStatusTransitionDelta — other transitions', () => {
  it('PENDING → REJECTED / CANCELLED only releases pending', () => {
    expect(leaveStatusTransitionDelta('PENDING', 'REJECTED', 2)).toEqual({ pendingDelta: -2, usedDelta: 0 });
    expect(leaveStatusTransitionDelta('PENDING', 'CANCELLED', 3)).toEqual({ pendingDelta: -3, usedDelta: 0 });
  });

  it('APPROVED → CANCELLED only releases used', () => {
    expect(leaveStatusTransitionDelta('APPROVED', 'CANCELLED', 2)).toEqual({ pendingDelta: 0, usedDelta: -2 });
  });

  it('APPROVED → TAKEN and no-ops leave the balance untouched', () => {
    expect(leaveStatusTransitionDelta('APPROVED', 'TAKEN', 2)).toEqual({ pendingDelta: 0, usedDelta: 0 });
    expect(leaveStatusTransitionDelta('REJECTED', 'REJECTED', 2)).toEqual({ pendingDelta: 0, usedDelta: 0 });
  });

  it('clamps negative/garbage day inputs to zero', () => {
    expect(leaveStatusTransitionDelta('PENDING', 'APPROVED', -5)).toEqual({ pendingDelta: 0, usedDelta: 0 });
    expect(leaveStatusTransitionDelta('PENDING', 'APPROVED', NaN)).toEqual({ pendingDelta: 0, usedDelta: 0 });
    expect(leaveStatusTransitionDelta('PENDING', 'APPROVED', undefined as unknown as number)).toEqual({
      pendingDelta: 0,
      usedDelta: 0,
    });
  });
});
