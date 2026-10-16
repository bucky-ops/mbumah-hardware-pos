import { describe, expect, it } from 'vitest';

import {
  B2C_MAX_RETRY_ATTEMPTS,
  B2C_RETRY_BACKOFF_CAP_MS,
  B2C_RETRY_BASE_BACKOFF_MS,
  b2cRetryBackoffMs,
  evaluateB2CRetryGate,
  formatB2CRetryWait,
} from '@/lib/hr/payroll/disbursement-service';

describe('b2cRetryBackoffMs', () => {
  it('doubles from the base per failed attempt: 2m, 4m, 8m, 16m', () => {
    expect(B2C_RETRY_BASE_BACKOFF_MS).toBe(2 * 60 * 1000);
    expect(b2cRetryBackoffMs(1)).toBe(2 * 60 * 1000);
    expect(b2cRetryBackoffMs(2)).toBe(4 * 60 * 1000);
    expect(b2cRetryBackoffMs(3)).toBe(8 * 60 * 1000);
    expect(b2cRetryBackoffMs(4)).toBe(16 * 60 * 1000);
  });

  it('caps at 30 minutes regardless of further failures', () => {
    expect(B2C_RETRY_BACKOFF_CAP_MS).toBe(30 * 60 * 1000);
    expect(b2cRetryBackoffMs(5)).toBe(B2C_RETRY_BACKOFF_CAP_MS);
    expect(b2cRetryBackoffMs(10)).toBe(B2C_RETRY_BACKOFF_CAP_MS);
    expect(b2cRetryBackoffMs(50)).toBe(B2C_RETRY_BACKOFF_CAP_MS);
  });

  it('clamps degenerate inputs to the base window', () => {
    expect(b2cRetryBackoffMs(0)).toBe(B2C_RETRY_BASE_BACKOFF_MS);
    expect(b2cRetryBackoffMs(-3)).toBe(B2C_RETRY_BASE_BACKOFF_MS);
    expect(b2cRetryBackoffMs(1.9)).toBe(B2C_RETRY_BASE_BACKOFF_MS); // floor(1.9) = 1
  });
});

describe('evaluateB2CRetryGate', () => {
  const NOW = 1_800_000_000_000;

  it('blocks and flags the ceiling once attempts reach the max', () => {
    expect(B2C_MAX_RETRY_ATTEMPTS).toBe(5);
    const gate = evaluateB2CRetryGate(5, NOW - 60 * 60 * 1000, NOW);
    expect(gate).toEqual({ allowed: false, maxReached: true, nextRetryAtMs: null, waitMs: 0 });
    // Even a long-elapsing failure stays blocked past the ceiling.
    expect(evaluateB2CRetryGate(7, NOW - 24 * 60 * 60 * 1000, NOW).maxReached).toBe(true);
  });

  it('allows the first retry once the base backoff has elapsed', () => {
    const twoMinutes = 2 * 60 * 1000;
    const allowed = evaluateB2CRetryGate(1, NOW - twoMinutes, NOW);
    expect(allowed).toEqual({ allowed: true, maxReached: false, nextRetryAtMs: null, waitMs: 0 });
    // Boundary: elapsed exactly equal to the window reopens the gate.
    expect(evaluateB2CRetryGate(1, NOW - twoMinutes - 1, NOW).allowed).toBe(true);
  });

  it('blocks with a countdown while the backoff window is still open', () => {
    const twoMinutes = 2 * 60 * 1000;
    const lastFailAt = NOW - 60 * 1000; // 1m ago, window 2m
    const gate = evaluateB2CRetryGate(1, lastFailAt, NOW);
    expect(gate.allowed).toBe(false);
    expect(gate.maxReached).toBe(false);
    expect(gate.waitMs).toBe(60 * 1000);
    expect(gate.nextRetryAtMs).toBe(lastFailAt + twoMinutes);
  });

  it('scales the wait window with the attempt count', () => {
    const fourMinutes = 4 * 60 * 1000;
    const lastFailAt = NOW - 60 * 1000; // 1m ago, window 4m for 2 fails
    const gate = evaluateB2CRetryGate(2, lastFailAt, NOW);
    expect(gate.allowed).toBe(false);
    expect(gate.waitMs).toBe(3 * 60 * 1000);
    expect(gate.nextRetryAtMs).toBe(lastFailAt + fourMinutes);
  });

  it('allows when no timestamp is known (defensive: never soft-locks)', () => {
    const gate = evaluateB2CRetryGate(1, null, NOW);
    expect(gate).toEqual({ allowed: true, maxReached: false, nextRetryAtMs: null, waitMs: 0 });
  });
});

describe('formatB2CRetryWait', () => {
  it('renders seconds, minutes and hours compactly', () => {
    expect(formatB2CRetryWait(45 * 1000)).toBe('45s');
    expect(formatB2CRetryWait(60 * 1000)).toBe('1m');
    expect(formatB2CRetryWait(90 * 1000)).toBe('1m 30s');
    expect(formatB2CRetryWait(2.4 * 60 * 1000)).toBe('2m 24s');
    expect(formatB2CRetryWait(62 * 60 * 1000)).toBe('1h 2m');
  });

  it('never renders negative waits', () => {
    expect(formatB2CRetryWait(-5000)).toBe('0s');
  });
});
