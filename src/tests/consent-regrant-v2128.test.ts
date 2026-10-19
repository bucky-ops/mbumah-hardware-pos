import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.128.0 — "the record stands corrected".
 *
 * Two things ship under that headline:
 *
 *  1. THE AUDIT-COVERAGE CORRECTION: docs/EMS_AUDIT_COVERAGE.md §4 claimed
 *     (v2.127.0) that linkPortalAccount/unlinkPortalAccount write no audit
 *     row. That was a false finding — both mutators have written hash-chained
 *     UPDATE/EMPLOYEE rows since v2.39.0, pinned by portal-link.test.ts, and
 *     were live-verified against AuditLog this round. The doc now records the
 *     correction with re-runnable evidence; the gap table stands at zero.
 *     These source contracts pin the corrected doc so the false claim cannot
 *     silently return.
 *
 *  2. THE RE-GRANT TRACE: the consent ledger's read-back now carries
 *     `priorGrants` — the append-only history depth. Because grantConsent
 *     refuses while an active record stands, every row beyond the first is a
 *     withdraw-then-re-grant cycle; a value ≥ 1 is the ledger's honest "this
 *     consent was withdrawn once". The Privacy tab renders an indigo
 *     `re-granted ×N` marker beside the status chip for exactly those rows.
 */

const db = vi.hoisted(() => ({
  employee: { findFirst: vi.fn(), findMany: vi.fn() },
  consentRecord: { findFirst: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
}));

vi.mock('@/lib/db', () => ({ db }));

import { listConsentRecords } from '@/lib/hr/data-protection';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const SESSION = {
  userId: 'user-owner',
  role: 'STORE_OWNER',
  storeId: 'store-1',
  organizationId: 'org-1',
} as Parameters<typeof listConsentRecords>[0];

const cr = (grantedDaysAgo: number, withdrawnDaysAgo: number | null) => ({
  purpose: 'PAYROLL_PROCESSING',
  policyVersion: 'hr-policy-2026-01',
  grantedAt: new Date(Date.now() - grantedDaysAgo * 86_400_000),
  withdrawnAt: withdrawnDaysAgo === null ? null : new Date(Date.now() - withdrawnDaysAgo * 86_400_000),
});

const emp = (id: string, code: string, first: string, last: string, crs: ReturnType<typeof cr>[]) => ({
  id,
  employeeCode: code,
  firstName: first,
  lastName: last,
  consentRecords: crs,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.employee.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('priorGrants — the append-only history depth', () => {
  it('a withdrawn-then-re-granted consent reads priorGrants ≥ 1 while ACTIVE', async () => {
    // records ordered grantedAt desc: the re-grant is newest, the withdrawn row stays on file
    db.employee.findMany.mockResolvedValue([
      emp('e1', 'EMP-001', 'Ada', 'One', [cr(1, null), cr(30, 2)]),
    ]);
    const ledger = await listConsentRecords(SESSION);
    const row = ledger.records[0];
    expect(row.status).toBe('ACTIVE');
    expect(row.priorGrants).toBe(1);
    // the active record's dates surface; the withdrawn one has no withdrawnAt
    expect(row.withdrawnAt).toBeNull();
    expect(row.grantedAt).toBeTruthy();
  });

  it('a first-time consent reads priorGrants 0 — no marker implied', async () => {
    db.employee.findMany.mockResolvedValue([
      emp('e1', 'EMP-001', 'Ada', 'One', [cr(5, null)]),
    ]);
    const ledger = await listConsentRecords(SESSION);
    expect(ledger.records[0].priorGrants).toBe(0);
  });

  it('a withdrawn-only history also counts its depth honestly', async () => {
    db.employee.findMany.mockResolvedValue([
      emp('e1', 'EMP-001', 'Ada', 'One', [cr(30, 2), cr(60, 31)]),
    ]);
    const ledger = await listConsentRecords(SESSION);
    const row = ledger.records[0];
    expect(row.status).toBe('WITHDRAWN');
    expect(row.priorGrants).toBe(1);
  });

  it('two full cycles read priorGrants 2; NONE reads 0', async () => {
    // two FULL cycles = grant→withdraw, grant→withdraw, then the live grant:
    // three records, superseding two — priorGrants 2 (lesson 46: count the
    // records, not the words)
    db.employee.findMany.mockResolvedValue([
      emp('e1', 'EMP-001', 'Ada', 'One', [cr(1, null), cr(10, 5), cr(20, 11)]),
      emp('e2', 'EMP-002', 'Ben', 'Two', []),
    ]);
    const ledger = await listConsentRecords(SESSION);
    expect(ledger.records[0].priorGrants).toBe(2);
    expect(ledger.records[0].status).toBe('ACTIVE');
    expect(ledger.records[1].priorGrants).toBe(0);
    expect(ledger.records[1].status).toBe('NONE');
  });
});

describe('the Privacy tab wears the re-grant marker with honest manners', () => {
  const page = () => src('src/app/(shell)/hr/reports/page.tsx');

  it('the marker chip renders only when priorGrants > 0', () => {
    const s = page();
    expect(s).toContain('{r.priorGrants > 0 ? (');
    expect(s).toContain('re-granted ×{r.priorGrants}');
  });

  it('the marker is an indigo chip with a testid and an append-only explanation', () => {
    const s = page();
    expect(s).toContain('data-testid="hr-privacy-consent-regrant"');
    // dark twin rides the same class string
    expect(s).toContain('dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300');
    // the tooltip names the append-only ledger, not a vague "history"
    expect(s).toContain('earlier record');
    expect(s).toContain('append-only ledger');
  });

  it('the status chips keep their own testids — the marker never replaces a state', () => {
    const s = page();
    expect(s).toContain('data-testid="hr-privacy-consent-chip-active"');
    expect(s).toContain('data-testid="hr-privacy-consent-chip-withdrawn"');
    expect(s).toContain('data-testid="hr-privacy-consent-chip-none"');
  });
});

describe('the audit-coverage correction is pinned (the false gap claim cannot return)', () => {
  const doc = () => src('docs/EMS_AUDIT_COVERAGE.md');

  it('§4 records a correction with zero gaps — not a queued fix', () => {
    const s = doc();
    expect(s).toContain('Known gaps — NONE');
    expect(s).toContain('That finding was false');
    expect(s).not.toContain('fix queued as the next round');
  });

  it('the correction carries re-runnable evidence: test pin + live verification', () => {
    const s = doc();
    expect(s).toContain('portal-link.test.ts');
    // markdown line-wrap tolerant (lesson 49 class: match the sentence, not
    // the wrapping)
    expect(s).toMatch(/Portal\s+account\s+linked\./);
    expect(s).toMatch(/Portal\s+account\s+unlinked\./);
    expect(s).toContain('v2.39.0');
  });

  it('the Employees domain row claims 5/5 with the portal-link mutators included', () => {
    const s = doc();
    expect(s).toContain('linkPortalAccount, unlinkPortalAccount — **5/5**');
  });

  it('the raw count matches a fresh scan (98 call sites / 30 files at writing)', () => {
    const s = doc();
    expect(s).toContain('98 `hrAudit` call sites across 30 files');
  });

  it('the code really does audit both mutators — the doc follows the code, never the reverse', () => {
    const svc = src('src/lib/hr/employee-service.ts');
    const linkBody = svc.slice(svc.indexOf('export async function linkPortalAccount'), svc.indexOf('export async function unlinkPortalAccount'));
    const unlinkBody = svc.slice(svc.indexOf('export async function unlinkPortalAccount'));
    expect(linkBody).toContain("portalLink: 'LINK'");
    expect(linkBody).toContain('linkedUserRole: user.role');
    expect(unlinkBody).toContain("portalLink: 'UNLINK'");
    expect(unlinkBody).toContain("'Portal account unlinked.'");
  });
});
