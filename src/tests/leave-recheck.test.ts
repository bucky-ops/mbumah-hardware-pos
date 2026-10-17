import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.59.0 desk re-check marker contracts.
 *
 * Heuristic (pure): needsDeskRecheck is the ONE definition of "this
 * correction has not been seen by the desk yet" — editedAt absent is never
 * a re-check; any edit with no desk visit is; a visit that predates the
 * edit is; a visit at-or-after the edit is not (the stamp route runs
 * strictly after the dialog opens, so an equal timestamp can only mean the
 * desk opened THIS version).
 *
 * Route (static contract on POST /api/leaves/[id]/review): the stamp is a
 * read-receipt guarded by requireStoreAccess (the same guard as the list
 * GET — seeing the rows is the qualification for marking one read),
 * answers 404 for cross-store ids (never discloses a foreign id), and
 * audits with whether a correction was waiting.
 *
 * DTO (static contract on GET /api/leaves): deskReviewedAt + the
 * server-computed needsRecheck ride every row, so the UI can never drift
 * from the rule by recomputing it locally.
 */

import { needsDeskRecheck } from '@/lib/hr/leave-recheck';

const ROOT = join(process.cwd(), 'src');

describe('needsDeskRecheck - the one shared re-check rule', () => {
  it('is false when the request was never corrected (no editedAt)', () => {
    expect(needsDeskRecheck(null, null)).toBe(false);
    expect(needsDeskRecheck(undefined, null)).toBe(false);
    expect(needsDeskRecheck(null, new Date('2026-10-17T08:00:00Z'))).toBe(false);
  });

  it('is true when corrected and never opened by the desk', () => {
    expect(needsDeskRecheck(new Date('2026-10-17T08:00:00Z'), null)).toBe(true);
    expect(needsDeskRecheck(new Date('2026-10-17T08:00:00Z'), undefined)).toBe(true);
  });

  it('is true when the last desk visit predates the last correction', () => {
    expect(
      needsDeskRecheck(new Date('2026-10-17T08:00:00Z'), new Date('2026-10-16T08:00:00Z')),
    ).toBe(true);
  });

  it('is false when the desk visited after the correction', () => {
    expect(
      needsDeskRecheck(new Date('2026-10-17T08:00:00Z'), new Date('2026-10-17T09:00:00Z')),
    ).toBe(false);
  });

  it('counts an equal-timestamp visit as having seen the edit (>= boundary)', () => {
    const same = new Date('2026-10-17T08:00:00Z');
    expect(needsDeskRecheck(same, same)).toBe(false);
  });

  it('accepts ISO strings as well as Date objects (DTO shapes)', () => {
    expect(needsDeskRecheck('2026-10-17T08:00:00.000Z', null)).toBe(true);
    expect(
      needsDeskRecheck('2026-10-17T08:00:00.000Z', '2026-10-17T08:00:00.000Z'),
    ).toBe(false);
    expect(
      needsDeskRecheck('2026-10-17T08:00:00.000Z', '2026-10-16T08:00:00.000Z'),
    ).toBe(true);
  });

  it('flips back to true the moment a NEWER correction lands (re-edit after review)', () => {
    const review = new Date('2026-10-17T09:00:00Z');
    expect(needsDeskRecheck(new Date('2026-10-17T08:00:00Z'), review)).toBe(false);
    expect(needsDeskRecheck(new Date('2026-10-17T10:00:00Z'), review)).toBe(true);
  });
});

describe('POST /api/leaves/[id]/review - static route contract', () => {
  let source: string;

  beforeEach(() => {
    source = readFileSync(join(ROOT, 'app/api/leaves/[id]/review/route.ts'), 'utf8');
  });

  it('exists and is guarded by requireStoreAccess (same family as the list GET)', () => {
    expect(source).toContain("requireStoreAccess(reviewLeaveHandler)");
  });

  it('stamps deskReviewedAt and returns the refreshed truth', () => {
    expect(source).toContain('deskReviewedAt: reviewedAt');
    expect(source).toContain('needsDeskRecheck(updated.editedAt, updated.deskReviewedAt)');
  });

  it('answers 404 for a foreign-store id instead of disclosing it', () => {
    expect(source).toContain("existing.storeId !== session.storeId");
    expect(source).toContain("status: 404");
  });

  it('audits the stamp with whether a correction was waiting', () => {
    expect(source).toContain("action: 'LEAVE_REVIEW_STAMPED'");
    expect(source).toContain('hadPendingCorrection');
  });

  it('never mutates request data beyond the receipt (no status write)', () => {
    const dataBlock = source.split('data: { deskReviewedAt')[1] ?? '';
    expect(dataBlock).not.toContain('status:');
    expect(dataBlock).not.toContain('rejectionReason');
  });
});

describe('GET /api/leaves - DTO carries the server-computed marker', () => {
  it('exposes deskReviewedAt and the shared-heuristic needsRecheck per row', () => {
    const source = readFileSync(join(ROOT, 'app/api/leaves/route.ts'), 'utf8');
    expect(source).toContain('deskReviewedAt: r.deskReviewedAt?.toISOString() ?? null');
    expect(source).toContain('needsRecheck: needsDeskRecheck(r.editedAt, r.deskReviewedAt)');
    expect(source).toContain("from '@/lib/hr/leave-recheck'");
  });

  it('the heuristic module stays pure (no server-only imports)', () => {
    const source = readFileSync(join(ROOT, 'lib/hr/leave-recheck.ts'), 'utf8');
    expect(source).not.toMatch(/from '@\/lib\/db'/);
    expect(source).not.toMatch(/from 'next\/server'/);
  });
});
