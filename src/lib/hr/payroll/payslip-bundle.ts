// MBUMAH HARDWARE POS - Payslip bundle naming + manifest (v2.83.0)
//
// The payslip bundle is ONE zip carrying every payslip in a payroll run —
// the same masked slips the dialog's per-row PDF column serves, handed over
// in a single download. This module is the bundle's naming + filing voice:
//   • payrollBundleFilename — one stamp names the bundle (period + run type
//     + EAT wall day), so two bundles can never lie about what they carry.
//   • buildBundleManifestCsv — a _MANIFEST.csv rides INSIDE the zip: the
//     run facts, then one row per slip (payslip no., employee, file, net)
//     — RFC-4180 with the SAME csvCell escaper and formula-injection guard
//     every other filing file in the shop uses, never re-implemented.
//
// PURE module: no db, no network, no env — imports only the pure digest
// helpers, so unit tests run without any mocking.

import { csvCell } from '@/lib/hr/digest-csv';

/** Lowercase, non-alphanumeric → '-' (the shared filename slug voice). */
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'run'
  );
}

/**
 * 'mbumah-payslips-<period>-<runtype>-<yyyymmdd>.zip' — the yyyymmdd is the
 * EAT wall day of `now` (Kenya is UTC+3 year-round; the shop's filing clock),
 * computed by shifting the instant and reading its UTC parts.
 */
export function payrollBundleFilename(periodName: string, runType: string, now: Date): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const stamp = `${eat.getUTCFullYear()}${String(eat.getUTCMonth() + 1).padStart(2, '0')}${String(
    eat.getUTCDate(),
  ).padStart(2, '0')}`;
  return `mbumah-payslips-${slug(periodName)}-${slug(runType)}-${stamp}.zip`;
}

const EAT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const EAT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** 'Sat 17 Oct 2026 · 14:54 EAT' — the manifest's generation stamp voice. */
export function formatEatStamp(now: Date): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const day = EAT_DAYS[eat.getUTCDay()];
  const month = EAT_MONTHS[eat.getUTCMonth()];
  const hh = String(eat.getUTCHours()).padStart(2, '0');
  const mm = String(eat.getUTCMinutes()).padStart(2, '0');
  return `${day} ${eat.getUTCDate()} ${month} ${eat.getUTCFullYear()} · ${hh}:${mm} EAT`;
}

export interface BundleManifestEntry {
  payslipNumber: string | null;
  employeeName: string;
  /** The file name the slip carries INSIDE the zip (already deduped). */
  filename: string;
  net: number;
}

/**
 * The manifest that rides the zip as its first entry. Layout mirrors the
 * run digest's filing voice: a preamble block (Report / Run / Generated /
 * Slips), a blank line, then the per-slip table — CRLF framing, csvCell
 * guard on every cell (an employee name starting '=' would be a spreadsheet
 * formula without it).
 */
export function buildBundleManifestCsv(input: {
  periodName: string;
  runType: string;
  status: string;
  generatedAt: Date;
  entries: BundleManifestEntry[];
}): string {
  const lines: string[] = [];
  lines.push(csvCell('Report') + ',' + csvCell('Payslip bundle'));
  lines.push(csvCell('Run') + ',' + csvCell(`${input.periodName} · ${input.runType} · ${input.status}`));
  lines.push(csvCell('Generated') + ',' + csvCell(formatEatStamp(input.generatedAt)));
  lines.push(csvCell('Slips') + ',' + csvCell(String(input.entries.length)));
  lines.push('');
  lines.push(csvCell('Payslip no.') + ',' + csvCell('Employee') + ',' + csvCell('File') + ',' + csvCell('Net (KES)'));
  for (const entry of input.entries) {
    lines.push(
      csvCell(entry.payslipNumber ?? '—') +
        ',' +
        csvCell(entry.employeeName) +
        ',' +
        csvCell(entry.filename) +
        ',' +
        csvCell(entry.net.toFixed(2)),
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/**
 * The slip file names inside the zip: the payslip number when the run
 * issued one, else `payslip-<detailId>` — sanitized flat ASCII, and
 * DEDUPED defensively (a repeated number would collide in the archive;
 * the second occurrence gains '-2', '-3', …). Order follows the caller's
 * rows (payslip number order, employees alphabetical as a tiebreak).
 */
export function bundleEntryFilenames(rows: Array<{ payslipNumber: string | null; detailId: string }>): string[] {
  const used = new Map<string, number>();
  return rows.map((row) => {
    const base = (row.payslipNumber ?? `payslip-${row.detailId}`).replace(/[^\x20-\x7E]/g, '?').replace(/[. ]+$/, '');
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const name = count === 0 ? base : `${base}-${count + 1}`;
    return `${name}.pdf`;
  });
}
