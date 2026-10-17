// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  payrollBundleFilename,
  buildBundleManifestCsv,
  bundleEntryFilenames,
  formatEatStamp,
} from '@/lib/hr/payroll/payslip-bundle';
import { crc32 } from '@/lib/hr/payroll/zip-store';

/**
 * v2.83.0: the payslip bundle — one zip, every payslip in a run.
 *   1. PURE: filename stamp (period + run type + EAT wall day), the
 *      manifest's filing voice (same csvCell escaper the digest emails
 *      ride), and the defensive entry-name dedupe.
 *   2. SURFACE: the route keeps the per-payslip PDF's guard + masking and
 *      the digest route's audit; the dialog's filing row carries the
 *      bundle door beside the digest CSV door (file-level contracts).
 */

const readRepo = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

describe('payrollBundleFilename', () => {
  it('stamps period, run type and the EAT wall day', () => {
    // 2026-10-17T21:54:08Z is Sat 18 Oct 02:54 EAT? No — 21:54Z + 3h = 00:54
    // EAT NEXT DAY (Sun 18 Oct). The stamp must read the EAT wall, so the
    // date flips: pinned here as the contract, not an implementation detail.
    const utc = new Date('2026-10-17T21:54:08Z');
    expect(payrollBundleFilename('October 2026', 'OFF_CYCLE', utc)).toBe(
      'mbumah-payslips-october-2026-off-cycle-20261018.zip',
    );
  });

  it('slugs hostile period names to safe, bounded fragments', () => {
    const now = new Date('2026-10-17T10:00:00Z'); // 13:00 EAT, same wall day
    expect(payrollBundleFilename('2026/01 · "January"', 'REGULAR', now)).toBe(
      'mbumah-payslips-2026-01-january-regular-20261017.zip',
    );
    const long = payrollBundleFilename('A'.repeat(80), 'BONUS', now);
    expect(long.startsWith('mbumah-payslips-aaaa')).toBe(true);
    expect(long.length).toBeLessThan(120);
  });

  it('never produces an empty slug even for an empty period name', () => {
    const name = payrollBundleFilename('///', 'REGULAR', new Date('2026-10-17T10:00:00Z'));
    expect(name).toContain('-run-');
  });
});

describe('formatEatStamp', () => {
  it('renders the EAT wall clock with the day/month voice', () => {
    expect(formatEatStamp(new Date('2026-10-17T11:54:08Z'))).toBe('Sat 17 Oct 2026 · 14:54 EAT');
  });

  it('flips the wall day when the +3 shift crosses midnight', () => {
    expect(formatEatStamp(new Date('2026-10-17T21:30:00Z'))).toBe('Sun 18 Oct 2026 · 00:30 EAT');
  });
});

describe('buildBundleManifestCsv', () => {
  const entries = [
    { payslipNumber: 'PS-2026-0001', employeeName: 'Jane Wanjiku', filename: 'PS-2026-0001.pdf', net: 39554.4 },
    { payslipNumber: null, employeeName: '=cmd|\' /C calc\'!A0', filename: 'payslip-det-2.pdf', net: 0 },
  ];

  it('carries the preamble block, the slip table, and CRLF framing', () => {
    const csv = buildBundleManifestCsv({
      periodName: 'October 2026',
      runType: 'OFF_CYCLE',
      status: 'POSTED',
      generatedAt: new Date('2026-10-17T11:54:08Z'),
      entries,
    });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Report,Payslip bundle');
    expect(lines[1]).toBe('Run,October 2026 · OFF_CYCLE · POSTED');
    expect(lines[2]).toBe('Generated,Sat 17 Oct 2026 · 14:54 EAT');
    expect(lines[3]).toBe('Slips,2');
    expect(lines[4]).toBe('');
    expect(lines[5]).toBe('Payslip no.,Employee,File,Net (KES)');
    expect(lines[6]).toBe('PS-2026-0001,Jane Wanjiku,PS-2026-0001.pdf,39554.40');
    // Formula-injection guard: a hostile employee name gets the apostrophe.
    expect(lines[7]).toContain("'=cmd");
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('emits an honest dash for a slip without a number', () => {
    const csv = buildBundleManifestCsv({
      periodName: 'P', runType: 'REGULAR', status: 'DRAFT',
      generatedAt: new Date('2026-10-17T11:54:08Z'),
      entries: [{ payslipNumber: null, employeeName: 'A B', filename: 'x.pdf', net: 12 }],
    });
    expect(csv).toContain('—,A B,x.pdf,12.00');
  });
});

describe('bundleEntryFilenames', () => {
  it('names slips after their payslip number, falling back to the detail id', () => {
    expect(
      bundleEntryFilenames([
        { payslipNumber: 'PS-1', detailId: 'd1' },
        { payslipNumber: null, detailId: 'd2' },
      ]),
    ).toEqual(['PS-1.pdf', 'payslip-d2.pdf']);
  });

  it('dedupes colliding numbers defensively instead of zipping over them', () => {
    expect(
      bundleEntryFilenames([
        { payslipNumber: 'PS-1', detailId: 'd1' },
        { payslipNumber: 'PS-1', detailId: 'd2' },
        { payslipNumber: 'PS-1', detailId: 'd3' },
      ]),
    ).toEqual(['PS-1.pdf', 'PS-1-2.pdf', 'PS-1-3.pdf']);
  });
});

describe('v2.83.0 payslip bundle surface contracts', () => {
  const ROUTE = readRepo('src/app/api/payroll/runs/[id]/payslips-bundle/route.ts');
  const DIALOG = readRepo('src/components/hr/payroll-run-dialog.tsx');
  const HELPER = readRepo('src/components/hr/payslip-bundle-download.ts');

  it('the route keeps the per-payslip PDF contract: same guard, same roles, same masking input', () => {
    expect(ROUTE).toContain("hrGuard('hr.payroll.read.all'");
    expect(ROUTE).toContain("const READ_ROLES = ['HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'] as const;");
    expect(ROUTE).toContain('hasHrPermission(session.role, \'hr.employee.unmask.pii\')');
    expect(ROUTE).toContain('viewerCanUnmask');
    // Branch-scoped on BOTH the run and its details — a cross-branch id 404s.
    expect(ROUTE).toContain('storeId: session.storeId || \'\'');
    expect((ROUTE.match(/storeId: session\.storeId \|\| ''/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('the route refuses honestly when there is nothing to hand over', () => {
    expect(ROUTE).toContain("code: 'NO_PAYSLIPS'");
    expect(ROUTE).toContain('This run has no payslips yet');
  });

  it('every slip rides the SAME view→pdf pipeline the PDF column uses', () => {
    expect(ROUTE).toContain('buildPayslipView({');
    expect(ROUTE).toContain('buildPayslipPdf(view)');
  });

  it('the manifest rides INSIDE the zip, before the slips', () => {
    const manifestAt = ROUTE.indexOf("{ name: '_MANIFEST.csv'");
    const slipsAt = ROUTE.indexOf('...entries.map((e) => ({ name: e.filename, data: e.pdf }))');
    expect(manifestAt).toBeGreaterThan(-1);
    expect(slipsAt).toBeGreaterThan(manifestAt);
    expect(ROUTE).toContain('buildStoreZip(files, now)');
  });

  it('the export is audit-logged like the digest export', () => {
    expect(ROUTE).toContain("action: 'PAYROLL_RUN_BUNDLE_EXPORTED'");
    expect(ROUTE).toContain('HrEntityType.DATA_EXPORT');
    expect(ROUTE).toContain("channel: 'ad_hoc_download'");
  });

  it('the client helper honours the server filename and speaks in structured errors', () => {
    expect(HELPER).toContain('`/api/payroll/runs/${runId}/payslips-bundle`');
    expect(HELPER).toContain('X-Payroll-Bundle-Filename');
    expect(HELPER).toContain('URL.createObjectURL(blob)');
    expect(HELPER).toContain('formatCsvSize(blob.size)');
  });

  it('the dialog files the bundle beside the digest CSV, in the violet family', () => {
    const csvDoorAt = DIALOG.indexOf("aria-label=\"Download the digest CSV for this run\"");
    const bundleDoorAt = DIALOG.indexOf('Download every payslip in this run as a zip bundle');
    expect(csvDoorAt).toBeGreaterThan(-1);
    expect(bundleDoorAt).toBeGreaterThan(csvDoorAt); // bundle sits after the digest door
    expect(DIALOG).toContain('border-violet-300 text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40 dark:hover:text-violet-200');
    expect(DIALOG).toContain('{bundleBusy ? \'Zipping…\' : `Payslip bundle (${payslips?.length ?? 0})`}');
    expect(DIALOG).toContain('<FileArchive className="h-3.5 w-3.5" />');
  });

  it('the bundle door waits for the payslips it names, and is honest while working', () => {
    expect(DIALOG).toContain('disabled={bundleBusy}');
    expect(DIALOG).toContain('(payslips?.length ?? 0) > 0 && (');
    expect(DIALOG).toContain('aria-label={`Download every payslip in this run as a zip bundle (${payslips?.length ?? 0} payslips)`}');
  });

  it('the bundle note resets with the run and renders in the note family', () => {
    expect(DIALOG).toContain('setBundleNote(null);\n      void load(runId);');
    expect(DIALOG).toContain('{bundleNote && (');
    expect(DIALOG).toContain("bundleNote.tone === 'ok'");
  });

  it('the zip writer the route leans on is the real one (crc vector wired through)', () => {
    // Guard against a future copy-paste replacing the writer with a stub:
    // the module's CRC must still match the IEEE check vector.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
