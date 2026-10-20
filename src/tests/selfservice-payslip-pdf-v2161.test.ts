import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * selfservice-payslip-pdf-v2161 — v2.161.0 — the payslip goes home.
 *
 * The spec's Phase 4.6 built the payslip PDF for HR viewers; the EMPLOYEE
 * could read the breakdown in the portal but could never take the document
 * home. This round closes that gap:
 *
 *  1. GET /api/self-service/me/payslips/[id]/pdf — the same two builders the
 *     HR route uses (buildPayslipView + buildPayslipPdf, one source of
 *     truth), masked per the self-service posture (statutory ids stay
 *     [REDACTED] unless the caller holds hr.employee.unmask.pii), scoped by
 *     employeeId (a payslip that is not yours is a 404 — existence is not
 *     leaked), and gated on ISSUANCE: rows become immutable payslips when
 *     the run POSTS, so a non-issued detail answers 409 NOT_ISSUED.
 *  2. The honest issuance flag rides BOTH payloads (listMyPayslips and
 *     getMyPayslip) — the portal renders the download only when
 *     `issued === true`, an honest pending note when `issued === false`,
 *     and NOTHING when the field is undefined (an older cache — never a
 *     false promise).
 *  3. The dialog (not the row) carries the affordance — the row is a
 *     <button>, and an anchor inside a button is invalid HTML.
 *
 * SAME ROUND: the Phase 4.7 Lighthouse acceptance criterion is finally
 * MEASURED — mobile Lighthouse on /employees/me reads Performance 92,
 * Accessibility 100, Best Practices 96 (the 4 points are the Vercel-only
 * /_vercel/* insights scripts 404ing on the local daemon — environment, not
 * the app), SEO 100 — documented in docs/hr/self-service.md.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

const pdfRoute = readRepo('src/app/api/self-service/me/payslips/[id]/pdf/route.ts');
const selfService = readRepo('src/lib/hr/self-service.ts');
const payslipsView = readRepo('src/app/(selfservice)/employees/me/payslips/payslips-view.tsx');
const selfServiceDoc = readRepo('docs/hr/self-service.md');
const seedScript = readRepo('scripts/seed-e2e-v161.cjs');

describe('the self-service payslip PDF route', () => {
  it('guards with hr.payroll.read.own (the self-service permission, not HR roles)', () => {
    expect(pdfRoute).toContain("selfServiceGuard('hr.payroll.read.own')");
    expect(pdfRoute).not.toMatch(/hrGuard\(/);
  });

  it('hard-scopes the query to the session employee (own-data rule, 404 not 403)', () => {
    expect(pdfRoute).toMatch(/where:\s*\{\s*id,\s*employeeId:\s*employee\.id\s*\}/);
    expect(pdfRoute).toContain('PAYSLIP_NOT_FOUND');
    expect(pdfRoute).toContain("status: 404");
  });

  it('refuses non-issued payslips with 409 NOT_ISSUED and a plain-language reason', () => {
    expect(pdfRoute).toMatch(/if\s*\(!detail\.payslipIssuedAt\)/);
    expect(pdfRoute).toContain("'NOT_ISSUED'");
    expect(pdfRoute).toContain("status: 409");
    expect(pdfRoute).toContain('once the run posts');
  });

  it('reuses the canonical PDF builders — one source of truth, no re-implementation', () => {
    expect(pdfRoute).toContain('buildPayslipView');
    expect(pdfRoute).toContain('buildPayslipPdf');
    expect(pdfRoute).toMatch(/viewerCanUnmask,\s*\n\s*\}\)/);
    // The route must NOT re-implement the masking or the view shape.
    expect(pdfRoute).not.toContain('maskValue');
    expect(pdfRoute).not.toContain('REDACTED');
  });

  it('computes viewerCanUnmask server-side from the permission (never a query param)', () => {
    expect(pdfRoute).toContain("hasHrPermission(session.role, 'hr.employee.unmask.pii')");
    expect(pdfRoute).not.toMatch(/searchParams/);
  });

  it('serves the PDF with the same headers contract as the HR route', () => {
    expect(pdfRoute).toContain("'application/pdf'");
    expect(pdfRoute).toContain('inline; filename=');
    expect(pdfRoute).toContain("'no-store'");
  });
});

describe('the honest issuance flag rides both payloads', () => {
  it('listMyPayslips carries issued (payslipIssuedAt !== null)', () => {
    const listBlock = selfService.split('listMyPayslips')[1] ?? '';
    expect(listBlock).toMatch(/issued:\s*p\.payslipIssuedAt\s*!==\s*null/);
  });

  it('getMyPayslip carries issued for the dialog affordance', () => {
    const detailBlock = selfService.split('getMyPayslip')[1] ?? '';
    expect(detailBlock).toMatch(/issued:\s*p\.payslipIssuedAt\s*!==\s*null/);
  });

  it('issuedAt keeps its createdAt fallback (display-only callers stay unchanged)', () => {
    expect(selfService).toMatch(/issuedAt:\s*toIso\(p\.payslipIssuedAt\)\s*\?\?\s*p\.createdAt\.toISOString\(\)/);
  });
});

describe('the portal dialog carries the PDF affordance honestly', () => {
  it('the download renders only when issued === true, in the DIALOG (the row is a button)', () => {
    expect(payslipsView).toContain('detail.issued === true');
    expect(payslipsView).toContain('data-testid="selfservice-payslip-pdf"');
    expect(payslipsView).toContain('/api/self-service/me/payslips/${detail.id}/pdf');
    // The row card must stay a pure button — no anchor nested inside it.
    const rowBlock = payslipsView.split('<ul className="space-y-3"')[1]?.split('</ul>')[0] ?? '';
    expect(rowBlock).not.toContain('<a');
  });

  it('non-issued details get an honest pending note, old caches get silence', () => {
    expect(payslipsView).toContain("detail.issued === false");
    expect(payslipsView).toContain('data-testid="selfservice-payslip-pdf-pending"');
    expect(payslipsView).toContain('PDF download unlocks once this payslip is issued');
  });

  it('the download anchor is styled for both themes with a visible focus ring', () => {
    expect(payslipsView).toContain('border-emerald-300 bg-emerald-50');
    expect(payslipsView).toContain('dark:border-emerald-800 dark:bg-emerald-950/50');
    expect(payslipsView).toContain('focus-visible:outline-emerald-500');
  });

  it('issued rows show the issuance date on the metadata line', () => {
    expect(payslipsView).toMatch(/p\.issued\s*\?\s*` · Issued /);
  });
});

describe('the Lighthouse acceptance measurement is documented', () => {
  it('docs/hr/self-service.md records the four scores and the verdict', () => {
    // The history table row: | **v2.161.0 SSR-complete** | **92** | **100** | 96 | 100 | 153 ms | ...
    expect(selfServiceDoc).toMatch(/v2\.161\.0 SSR-complete\*\* \| \*\*92\*\* \| \*\*100\*\* \| 96 \| 100/);
    expect(selfServiceDoc).toContain('spec acceptance 10 (Lighthouse above 90) HOLDS');
  });

  it('the doc explains the 4-point best-practices cost (Vercel-only scripts)', () => {
    expect(selfServiceDoc).toContain('_vercel');
  });

  it('the doc records the PDF contract (own-data 404, NOT_ISSUED 409, masked ids)', () => {
    expect(selfServiceDoc).toContain('NOT_ISSUED');
    expect(selfServiceDoc).toContain('hr.employee.unmask.pii');
  });
});

describe('the QA seed covers both paths', () => {
  it('the seed issues a payslip for David and keeps the draft as the refusal path', () => {
    expect(seedScript).toContain("employeeCode: 'MBH-1-005'");
    expect(seedScript).toContain("payslipNumber: 'PS-2026-0901'");
    expect(seedScript).toContain("status: 'POSTED'");
    expect(seedScript).toContain('payslipIssuedAt: now');
  });
});
