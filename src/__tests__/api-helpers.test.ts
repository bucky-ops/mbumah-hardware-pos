// Unit tests for the audit-remediation API helpers:
//   • src/lib/api-pagination.ts  (parsePagination / buildPaginationMeta)
//   • src/lib/validations.ts     (validationErrorResponse — canonical 400)
//   • src/lib/rate-limit.ts      (tier enforcement incl. new WEBHOOK tier)
//
// These are pure-logic tests — no database, no network — complementing the
// financial-accounting suite. They pin down the exact clamping and response
// contracts the audit findings promised so regressions fail fast in CI.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parsePagination, buildPaginationMeta } from '@/lib/api-pagination';
import { validationErrorResponse } from '@/lib/validations';
import { isRateLimited } from '@/lib/rate-limit';

// ── parsePagination ──────────────────────────────────────────────────────────

describe('parsePagination', () => {
  const sp = (qs: string) => new URLSearchParams(qs);

  it('defaults to page 1 / limit 50 when no params are present', () => {
    expect(parsePagination(sp(''))).toEqual({ page: 1, limit: 50, skip: 0 });
  });

  it('honours explicit page and limit', () => {
    expect(parsePagination(sp('page=3&limit=25'))).toEqual({ page: 3, limit: 25, skip: 50 });
  });

  it('falls back to defaults for non-numeric input (previously NaN reached Prisma)', () => {
    expect(parsePagination(sp('page=abc&limit=xyz'))).toEqual({ page: 1, limit: 50, skip: 0 });
  });

  it('clamps page below 1 up to 1 (previously produced a negative skip)', () => {
    expect(parsePagination(sp('page=-5')).page).toBe(1);
    expect(parsePagination(sp('page=0')).page).toBe(1);
    expect(parsePagination(sp('page=-5')).skip).toBe(0);
  });

  it('clamps limit into [1, maxLimit] (previously unbounded / zero-divide)', () => {
    expect(parsePagination(sp('limit=999999')).limit).toBe(500);
    expect(parsePagination(sp('limit=999999'), { maxLimit: 100 }).limit).toBe(100);
    expect(parsePagination(sp('limit=0')).limit).toBe(1);
    expect(parsePagination(sp('limit=-50')).limit).toBe(1);
  });

  it('respects a custom defaultLimit', () => {
    expect(parsePagination(sp(''), { defaultLimit: 20 }).limit).toBe(20);
  });

  it('computes skip for multi-page access', () => {
    expect(parsePagination(sp('page=7&limit=50')).skip).toBe(300);
  });
});

// ── buildPaginationMeta ──────────────────────────────────────────────────────

describe('buildPaginationMeta', () => {
  it('matches the legacy envelope field names plus additive booleans', () => {
    expect(buildPaginationMeta(1, 50, 120)).toEqual({
      page: 1,
      limit: 50,
      skip: 0,
      total: 120,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  it('reports hasNextPage/hasPreviousPage correctly on the last page', () => {
    const meta = buildPaginationMeta(3, 50, 120);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPreviousPage).toBe(true);
  });

  it('handles an empty result set without a divide-by-zero', () => {
    const meta = buildPaginationMeta(1, 50, 0);
    expect(meta.totalPages).toBe(0);
    expect(meta.hasNextPage).toBe(false);
  });

  it('never reports negative totals', () => {
    expect(buildPaginationMeta(1, 50, -10).total).toBe(0);
  });
});

// ── validationErrorResponse ──────────────────────────────────────────────────

describe('validationErrorResponse', () => {
  const schema = z.object({
    name: z.string().min(2),
    debtLimit: z.number().nonnegative(),
  });

  it('returns HTTP 400 with the canonical success:false envelope', async () => {
    const result = schema.safeParse({ name: 'x', debtLimit: -5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const res = validationErrorResponse(result.error);
      expect(res.status).toBe(400);
      const body = (await res.json()) as {
        success: boolean;
        error: string;
        errors: Record<string, string[]>;
      };
      expect(body.success).toBe(false);
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    }
  });

  it('groups messages per field for client-side form highlighting', async () => {
    const result = schema.safeParse({ name: 'x', debtLimit: -5 });
    if (!result.success) {
      const body = (await validationErrorResponse(result.error).json()) as {
        errors: Record<string, string[]>;
      };
      // One key per offending field, each carrying at least one message.
      expect(Object.keys(body.errors).sort()).toEqual(['debtLimit', 'name']);
      expect(body.errors.name.length).toBeGreaterThan(0);
      expect(typeof body.errors.name[0]).toBe('string');
    }
  });

  it('routes root-level failures to the _root key', async () => {
    const rootSchema = z.string().email();
    const result = rootSchema.safeParse(42);
    if (!result.success) {
      const body = (await validationErrorResponse(result.error).json()) as {
        errors: Record<string, string[]>;
      };
      expect(body.errors._root).toBeDefined();
    }
  });
});

// ── rate-limit tiers (incl. the new WEBHOOK tier) ───────────────────────────

describe('isRateLimited', () => {
  it('allows requests under the tier maximum and reports remaining quota', () => {
    const key = `test:allow:${Math.random()}`;
    let last = isRateLimited(key, { max: 3, windowMs: 60_000 });
    expect(last.limited).toBe(false);
    expect(last.remaining).toBe(2);
    last = isRateLimited(key, { max: 3, windowMs: 60_000 });
    last = isRateLimited(key, { max: 3, windowMs: 60_000 });
    expect(last.limited).toBe(false);
    expect(last.remaining).toBe(0);
  });

  it('blocks at the tier maximum with a retryAfter', () => {
    const key = `test:block:${Math.random()}`;
    for (let i = 0; i < 3; i++) isRateLimited(key, { max: 3, windowMs: 60_000 });
    const blocked = isRateLimited(key, { max: 3, windowMs: 60_000 });
    expect(blocked.limited).toBe(true);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it('exposes the WEBHOOK tier added for the M-Pesa callback', () => {
    const key = `test:webhook:${Math.random()}`;
    const first = isRateLimited(key, 'WEBHOOK');
    expect(first.limited).toBe(false);
    expect(first.remaining).toBe(59); // 60/min tier
  });
});
