// R2/R8 FIX TESTS (v2.5) — truthful HTTP status in normalised errors +
// friendly branch-blocked lookup messages.
//
// Background: request() used to throw plain Errors and discard
// response.status, so normaliseError() stamped EVERY failed request as
// code UNKNOWN_ERROR / statusCode 500 — a server 400 reached the console as
// a "500", which is what misled the Kenya Plumbing Co. investigation.

import { describe, it, expect } from 'vitest';
import {
  ApiRequestError,
  errorCodeForStatus,
  normaliseError,
  friendlyLookupError,
} from '@/lib/error-handler';

describe('errorCodeForStatus (R2)', () => {
  it('maps 400/422 to VALIDATION_ERROR', () => {
    expect(errorCodeForStatus(400)).toBe('VALIDATION_ERROR');
    expect(errorCodeForStatus(422)).toBe('VALIDATION_ERROR');
  });
  it('maps auth/permission statuses', () => {
    expect(errorCodeForStatus(401)).toBe('UNAUTHORIZED');
    expect(errorCodeForStatus(403)).toBe('FORBIDDEN');
  });
  it('maps 404/409/429', () => {
    expect(errorCodeForStatus(404)).toBe('NOT_FOUND');
    expect(errorCodeForStatus(409)).toBe('CONFLICT');
    expect(errorCodeForStatus(429)).toBe('RATE_LIMITED');
  });
  it('maps 5xx to SERVER_ERROR and leaves odd statuses UNKNOWN', () => {
    expect(errorCodeForStatus(500)).toBe('SERVER_ERROR');
    expect(errorCodeForStatus(503)).toBe('SERVER_ERROR');
    expect(errorCodeForStatus(418)).toBe('UNKNOWN_ERROR');
  });
});

describe('normaliseError (R2)', () => {
  it('surfaces the REAL status from ApiRequestError (400 stays 400)', () => {
    const err = new ApiRequestError(
      'storeId, debtLedgerId, amount, and paymentMethod are required.',
      400
    );
    const n = normaliseError(err);
    expect(n.statusCode).toBe(400);
    expect(n.code).toBe('VALIDATION_ERROR');
    expect(n.message).toContain('paymentMethod');
  });

  it('classifies a 403 cross-store denial as FORBIDDEN', () => {
    const n = normaliseError(
      new ApiRequestError('You can only access data from your own store.', 403)
    );
    expect(n.statusCode).toBe(403);
    expect(n.code).toBe('FORBIDDEN');
  });

  it('keeps a 500 a real 500 (SERVER_ERROR)', () => {
    const n = normaliseError(new ApiRequestError('Server error', 500));
    expect(n.statusCode).toBe(500);
    expect(n.code).toBe('SERVER_ERROR');
  });

  it('truthfully maps plain error objects that carry a status', () => {
    const err = Object.assign(new Error('Nope'), { status: 404 });
    const n = normaliseError(err);
    expect(n.statusCode).toBe(404);
    expect(n.code).toBe('NOT_FOUND');
  });

  it('still maps a generic Error to UNKNOWN/500 (true unknowns only now)', () => {
    const n = normaliseError(new Error('something exploded'));
    expect(n.statusCode).toBe(500);
    expect(n.code).toBe('UNKNOWN_ERROR');
  });
});

describe('friendlyLookupError (R8)', () => {
  it('tenant-blocked 404 → "Not available in your branch", NOT retryable', () => {
    const r = friendlyLookupError(new ApiRequestError('Customer not found.', 404));
    expect(r.title).toBe('Not available in your branch');
    expect(r.detail).toContain('different branch');
    expect(r.retryable).toBe(false);
  });

  it('tenant-blocked 403 → same friendly treatment', () => {
    const r = friendlyLookupError(
      new ApiRequestError('You can only access data from your own store.', 403)
    );
    expect(r.title).toBe('Not available in your branch');
    expect(r.retryable).toBe(false);
  });

  it('transient 503 → "Something went wrong", retryable', () => {
    const r = friendlyLookupError(new ApiRequestError('Server error', 503));
    expect(r.title).toBe('Something went wrong');
    expect(r.retryable).toBe(true);
  });

  it('message-based detection still works for plain errors', () => {
    const r = friendlyLookupError(new Error('Customer not found.'));
    expect(r.title).toBe('Not available in your branch');
    expect(r.retryable).toBe(false);
  });
});
