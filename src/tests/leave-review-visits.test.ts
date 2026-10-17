import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.63.0 visit-ledger contracts — the desk keeps its own ledger.
 *
 * Gap: the v2.59.0 desk stamp (deskReviewedAt/By*) only ever carried the
 * LATEST visit — every re-open of the detail dialog overwrote it, so the
 * desk could never tell "three people looked at this" from "nobody has",
 * and a reviewer's earlier look was invisible the moment someone else (or
 * they themselves) visited again.
 *
 * Covered here:
 *  1. Schema: the LeaveReviewVisit model (one row per visit — WHO looked,
 *     WHEN, whether THAT visit cleared a re-check), cascade-deleted with
 *     the request, indexed for the newest-first timeline read, and the
 *     LeaveRequest back-relation.
 *  2. Route contract on POST /api/leaves/[id]/review: the visit row is
 *     written with the SAME reviewer name chain + hadPendingCorrection
 *     flag the stamp computes, best-effort under its own guard (a ledger
 *     failure must never fail the visit); the response carries the visit
 *     history (newest-first, take 8) + total count; the stamp update
 *     itself is untouched.
 *  3. Desk-dialog contract (payroll-tab.tsx): the response generic grew
 *     the ledger fields, the onSuccess files the history per request, and
 *     the dialog renders the "Visit history" timeline (count chip, emerald
 *     dot + "Cleared a re-check" chip for clearing visits, reviewer
 *     avatars, capped at 5 with an honest "+ N earlier visits on file").
 *  4. What's-New 2.63.0: the release leads with the ledger story.
 */

const ROOT = join(process.cwd(), 'src');
const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. Schema contract ──────────────────────────────────────────────────────

describe('LeaveReviewVisit schema - the desk ledger table', () => {
  const SCHEMA = readRepo('prisma/schema.prisma');

  it('declares the LeaveReviewVisit model mapped to leave_review_visits', () => {
    expect(SCHEMA).toContain('model LeaveReviewVisit');
    expect(SCHEMA).toContain('@@map("leave_review_visits")');
  });

  it('carries WHO looked (visitedById + denormalised visitedByName) and WHEN (createdAt)', () => {
    expect(SCHEMA).toMatch(/model LeaveReviewVisit \{[\s\S]*?visitedById\s+String/);
    expect(SCHEMA).toMatch(/model LeaveReviewVisit \{[\s\S]*?visitedByName\s+String/);
    expect(SCHEMA).toMatch(/model LeaveReviewVisit \{[\s\S]*?createdAt\s+DateTime\s+@default\(now\(\)\)/);
  });

  it('records whether THAT visit cleared a re-check marker (clearedRecheck)', () => {
    expect(SCHEMA).toMatch(/model LeaveReviewVisit \{[\s\S]*?clearedRecheck\s+Boolean/);
  });

  it('cascade-deletes with the leave request', () => {
    expect(SCHEMA).toMatch(
      /leaveRequest LeaveRequest @relation\(fields: \[leaveRequestId\], references: \[id\], onDelete: Cascade\)/,
    );
  });

  it('is indexed for the newest-first timeline read (leaveRequestId + createdAt)', () => {
    expect(SCHEMA).toContain('@@index([leaveRequestId, createdAt])');
  });

  it('hangs off LeaveRequest as the reviewVisits back-relation', () => {
    expect(SCHEMA).toMatch(/model LeaveRequest \{[\s\S]*?reviewVisits LeaveReviewVisit\[\]/);
  });
});

// ── 2. Route contract ───────────────────────────────────────────────────────

describe('POST /api/leaves/[id]/review - the visit is recorded and the history rides the response', () => {
  const ROUTE = readFileSync(join(ROOT, 'app/api/leaves/[id]/review/route.ts'), 'utf8');

  it('writes a LeaveReviewVisit row with the same reviewer name the stamp uses', () => {
    expect(ROUTE).toContain('db.leaveReviewVisit.create');
    expect(ROUTE).toMatch(/visitedById: session\.userId/);
    expect(ROUTE).toMatch(/visitedByName: reviewerName/);
  });

  it('stamps the row with THIS visit\u2019s re-check outcome (hadPendingCorrection)', () => {
    expect(ROUTE).toMatch(/clearedRecheck: hadPendingCorrection/);
  });

  it('keeps the ledger write best-effort under its own guard', () => {
    const createIdx = ROUTE.indexOf('db.leaveReviewVisit.create');
    const guardOpen = ROUTE.indexOf('try {', 0);
    expect(createIdx).toBeGreaterThan(guardOpen);
    expect(ROUTE).toMatch(/Visit-ledger write is best-effort by design/);
  });

  it('reads the history newest-first, capped at 8, with the total count', () => {
    expect(ROUTE).toMatch(/db\.leaveReviewVisit\.findMany\(\{[\s\S]*?orderBy: \{ createdAt: 'desc' \}[\s\S]*?take: 8/);
    expect(ROUTE).toContain('db.leaveReviewVisit.count({ where: { leaveRequestId: id } })');
    expect(ROUTE).toContain('Promise.all(');
  });

  it('returns visitHistory + visitCount alongside the stamp fields', () => {
    expect(ROUTE).toContain('visitHistory,');
    expect(ROUTE).toContain('visitCount,');
  });

  it('never fails the stamp when the history read misfires', () => {
    expect(ROUTE).toMatch(/History read is best-effort[\s\S]*?must never fail the[\s\S]*?stamp response/);
  });

  it('leaves the v2.59/v2.60 stamp update itself untouched', () => {
    expect(ROUTE).toMatch(/deskReviewedAt: reviewedAt/);
    expect(ROUTE).toMatch(/deskReviewedById: session\.userId/);
    expect(ROUTE).toMatch(/deskReviewedByName: reviewerName/);
  });
});

// ── 3. Desk-dialog contract ─────────────────────────────────────────────────

describe('payroll-tab desk dialog - the visit timeline renders from the ledger', () => {
  const TAB = readFileSync(join(ROOT, 'app/(shell)/tabs/payroll-tab.tsx'), 'utf8');

  it('grows the stamp-response generic with the ledger fields', () => {
    expect(TAB).toMatch(/visitHistory\?: Array<\{ visitedByName: string; visitedAt: string; clearedRecheck: boolean \}>/);
    expect(TAB).toMatch(/visitCount\?: number/);
  });

  it('files the fresh history per request in onSuccess (best-effort for old payloads)', () => {
    expect(TAB).toMatch(/setVisitLog\(\(prev\) => \(\{/);
    expect(TAB).toMatch(/Array\.isArray\(data\.visitHistory\)/);
  });

  it('renders the Visit history heading with the History icon and a count chip', () => {
    expect(TAB).toContain('data-testid="leave-visit-history"');
    expect(TAB).toContain('Visit history');
    expect(TAB).toMatch(/<History className="h-3 w-3" aria-hidden \/>/);
    expect(TAB).toMatch(/\{log\.total\} \{log\.total === 1 \? 'visit' : 'visits'\}/);
  });

  it('marks clearing visits with the emerald dot and the Cleared-a-re-check chip', () => {
    expect(TAB).toMatch(/v\.clearedRecheck\s*\n?\s*\? 'bg-emerald-500 ring-2 ring-emerald-200/);
    expect(TAB).toContain('Cleared a re-check');
    expect(TAB).toMatch(/<BadgeCheck className="h-2\.5 w-2\.5" aria-hidden \/> Cleared a re-check/);
  });

  it('wears the reviewer initial avatar on every timeline entry', () => {
    expect(TAB).toMatch(/v\.visitedByName\.trim\(\)\.charAt\(0\)\.toUpperCase\(\)/);
  });

  it('caps the visible trail at 5 and keeps the total honest (+ N earlier visits on file)', () => {
    expect(TAB).toMatch(/log\.entries\.slice\(0, 5\)/);
    expect(TAB).toMatch(/\+ \{hidden\} earlier \{hidden === 1 \? 'visit' : 'visits'\} on file/);
  });

  it('renders nothing when the ledger is empty (old responses, brand-new requests)', () => {
    expect(TAB).toMatch(/if \(!log \|\| log\.entries\.length === 0\) return null;/);
  });

  it('tags every entry for QA (data-testid leave-visit-entry)', () => {
    expect(TAB).toContain('data-testid="leave-visit-entry"');
  });

  it('never loses the action row: DialogContent caps to the viewport and scrolls internally', () => {
    const DLG = readFileSync(join(ROOT, 'components/ui/dialog.tsx'), 'utf8');
    expect(DLG).toContain('max-h-[92dvh] overflow-y-auto');
  });
});

// ── 4. What's-New ───────────────────────────────────────────────────────────

describe('whats-new 2.63.0 - the ledger story leads the release', () => {
  const WN = readFileSync(join(ROOT, 'lib/whats-new.ts'), 'utf8');

  it('carries the 2.63.0 entry first', () => {
    expect(WN.indexOf("version: '2.63.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.63.0'")).toBeLessThan(WN.indexOf("version: '2.62.0'"));
  });

  it('leads with the visit-history headline and bullet copy', () => {
    expect(WN).toContain('The desk keeps its own ledger');
    expect(WN).toContain('Visit history');
    expect(WN).toContain('Cleared a re-check');
  });
});
