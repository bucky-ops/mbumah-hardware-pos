// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.107.0: the chart files its month — the per-account movement bundle.
 * The contract:
 *
 *   1. THE ZIP IS BYTE-AUDITABLE — a store-only writer decided here, no
 *      dependency: local file headers (PK\x03\x04, method 0, UTF-8 flag),
 *      a central directory (PK\x01\x02) whose offsets point at the local
 *      blocks, and an EOCD (PK\x05\x06) that counts every entry. Store
 *      means the compressed size IS the size — the CRC and the sizes are
 *      the file's own honesty, checkable with `unzip -t`.
 *   2. CRC-32 IS THE CANONICAL POLY — the IEEE check value pins it
 *      ('123456789' → 0xCBF43926); an empty input hashes to zero.
 *   3. THE MANIFEST IS THE FILE'S OWN HONESTY — MANIFEST.txt rides first:
 *      what was filed (files, posted lines), the window it filed, how many
 *      quiet accounts were left out and why, then an index row per file
 *      (code, lines, filename) through the SAME csvCell guard as every
 *      filing in the family. Employee names ride nothing.
 *   4. QUIET IS A FACT, NOT A FILE — an account with zero posted lines in
 *      the window produces no CSV (the single route already 404s on it);
 *      the bundle carries the count instead of pretending. Nothing active
 *      at all → the route answers NO_MOVEMENT_DATA.
 *   5. ONE WINDOW, THE DRAWER'S OWN — the bundle files the period's own
 *      days ([startDate, endDate + 1 day)); no window param exists, so the
 *      file can never call itself something it is not (a year is one
 *      account at a time, through the account route).
 *   6. THE ROUTE WIDENS NOTHING — the drill's exact read contract (same
 *      guard, same roles), tenant-scoped end to end, built from the SAME
 *      truth through the SAME builders (buildAccountMovement →
 *      accountMovementToCsv → buildAccountBundle), audited with counts
 *      only.
 */

import {
  crc32,
  dosDateTime,
  zipStore,
  buildAccountBundle,
  type BundleAccountFile,
} from '@/lib/hr/payroll/account-bundle';
import {
  buildAccountMovement,
  accountMovementToCsv,
} from '@/lib/hr/payroll/period-journal';

const readRepo = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const enc = (s: string) => new TextEncoder().encode(s);

describe('crc32 — the canonical poly', () => {
  it('the IEEE check value pins the table', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
  });

  it('empty input hashes to zero; known vectors hold', () => {
    expect(crc32(enc(''))).toBe(0x00000000);
    expect(crc32(enc('a'))).toBe(0xe8b7be43);
    expect(crc32(enc('abc'))).toBe(0x352441c2);
    expect(crc32(enc('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('dosDateTime — the zip timestamp fields', () => {
  it('packs the MS-DOS way from UTC fields', () => {
    const { date, time } = dosDateTime(new Date(Date.UTC(2026, 9, 18, 12, 0, 30)));
    expect(date).toBe(((2026 - 1980) << 9) | (10 << 5) | 18);
    expect(time).toBe((12 << 11) | (0 << 5) | (30 >> 1));
  });

  it('clamps junk into range instead of corrupting the archive', () => {
    // Date.UTC NORMALIZES overflow (25:70:61 → 02:11:01 next day); the
    // clamps still floor the year at 1980 and hold every field in range.
    const { date, time } = dosDateTime(new Date(Date.UTC(1970, 0, 1, 25, 70, 61)));
    expect(date).toBe((0 << 9) | (1 << 5) | 2); // year floors at 1980
    expect(time).toBe((2 << 11) | (11 << 5) | (1 >> 1));
  });
});

describe('zipStore — the store-only writer', () => {
  it('writes a local header a spec-reader can parse, byte by byte', () => {
    const zip = zipStore([{ name: 'hello.txt', bytes: enc('hi') }], 't.zip', new Date(Date.UTC(2026, 9, 18, 12, 0, 30)));
    const v = new DataView(zip.bytes.buffer, zip.bytes.byteOffset, zip.bytes.byteLength);
    expect(zip.bytes[0]).toBe(0x50); // P
    expect(zip.bytes[1]).toBe(0x4b); // K
    expect(zip.bytes[2]).toBe(0x03);
    expect(zip.bytes[3]).toBe(0x04);
    expect(v.getUint16(4, true)).toBe(20); // version needed
    expect(v.getUint16(6, true)).toBe(0x0800); // UTF-8 flag
    expect(v.getUint16(8, true)).toBe(0); // method: store
    expect(v.getUint16(10, true)).toBe((12 << 11) | (0 << 5) | (30 >> 1)); // time
    expect(v.getUint16(12, true)).toBe(((2026 - 1980) << 9) | (10 << 5) | 18); // date
    expect(v.getUint32(14, true)).toBe(crc32(enc('hi')));
    expect(v.getUint32(18, true)).toBe(2); // compressed = size (store)
    expect(v.getUint32(22, true)).toBe(2); // uncompressed
    expect(v.getUint16(26, true)).toBe(9); // name length
    expect(Array.from(zip.bytes.slice(30, 39))).toEqual(Array.from(enc('hello.txt')));
    expect(Array.from(zip.bytes.slice(39, 41))).toEqual(Array.from(enc('hi')));
  });

  it('closes with a central directory and an EOCD that counts every entry', () => {
    const entries = [
      { name: 'a.txt', bytes: enc('alpha') },
      { name: 'b.txt', bytes: enc('beta!') },
    ];
    const zip = zipStore(entries, 'two.zip');
    expect(zip.entryCount).toBe(2);
    expect(zip.byteSize).toBe(zip.bytes.length);
    const v = new DataView(zip.bytes.buffer, zip.bytes.byteOffset, zip.bytes.byteLength);
    // local blocks: 40 + 40 = 80 → the central directory starts at 80
    expect(v.getUint32(80, true)).toBe(0x02014b50);
    expect(zip.bytes[81]).toBe(0x4b);
    // the local header offset inside the SECOND central record points at b's block
    const bRecord = 80 + 46 + 5; // cd header + a's name
    expect(v.getUint32(bRecord + 42, true)).toBe(40);
    // EOCD: the last 22 bytes
    const e = zip.byteSize - 22;
    expect(zip.bytes[e]).toBe(0x50);
    expect(zip.bytes[e + 1]).toBe(0x4b);
    expect(zip.bytes[e + 2]).toBe(0x05);
    expect(zip.bytes[e + 3]).toBe(0x06);
    expect(v.getUint16(e + 8, true)).toBe(2);
    expect(v.getUint16(e + 10, true)).toBe(2);
    expect(v.getUint32(e + 16, true)).toBe(80); // cd offset
  });

  it('a single-entry zip is deterministic for a fixed stamp (byte-for-byte)', () => {
    const stamp = new Date(Date.UTC(2026, 9, 18, 12, 0, 30));
    const a = zipStore([{ name: 'x.txt', bytes: enc('same') }], 'x.zip', stamp);
    const b = zipStore([{ name: 'x.txt', bytes: enc('same') }], 'x.zip', stamp);
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });

  it('an empty entries list writes a valid 22-byte archive', () => {
    const zip = zipStore([], 'empty.zip');
    expect(zip.entryCount).toBe(0);
    expect(zip.byteSize).toBe(22);
    expect(zip.bytes[0]).toBe(0x50);
    expect(zip.bytes[1]).toBe(0x4b);
    expect(zip.bytes[2]).toBe(0x05);
    expect(zip.bytes[3]).toBe(0x06);
  });

  it('UTF-8 names survive the round trip as bytes (é is TWO bytes — nameLen says 9)', () => {
    const zip = zipStore([{ name: 'café.csv', bytes: enc('x') }], 'u.zip');
    const v = new DataView(zip.bytes.buffer, zip.bytes.byteOffset, zip.bytes.byteLength);
    expect(v.getUint16(26, true)).toBe(9);
    const raw = zip.bytes.slice(30, 30 + 9);
    expect(new TextDecoder().decode(raw)).toBe('café.csv');
  });

  it('a TextEncoder-encoded payload files its BYTES whatever realm it came from', () => {
    // vitest's global TextEncoder can hand back a Uint8Array from another
    // realm (instanceof is FALSE there), and a naive else would archive the
    // String() of the array ('97,108,…'). The writer narrows with
    // ArrayBuffer.isView — the bytes ride as bytes, either way.
    const encoded = new TextEncoder().encode('alpha');
    const zip = zipStore([{ name: 'a.txt', bytes: encoded }], 'r.zip');
    const v = new DataView(zip.bytes.buffer, zip.bytes.byteOffset, zip.bytes.byteLength);
    expect(v.getUint32(18, true)).toBe(5); // compSize = the PAYLOAD's 5 bytes
    expect(new TextDecoder().decode(zip.bytes.slice(35, 40))).toBe('alpha');
  });
});

// The bundle composes REAL files through the REAL builders — no fixture CSVs.
const movement = buildAccountMovement(
  { accountCode: '5200', accountName: 'Salaries Expense', accountType: 'EXPENSE', normalBalance: 'DEBIT' },
  { debit: 258000, credit: 0, priorLines: 2 },
  [
    { entryNumber: 'JE-B', entryDate: '2026-10-17T09:00:00.000Z', entryDescription: 'October payroll', source: 'REGULAR', debit: 258000, credit: 0, lineDescription: 'Net pay' },
  ],
);
const csvMeta = {
  organizationName: 'MBUMAH HARDWARE',
  scopeLabel: 'MBUMAH HARDWARE - Juja Main',
  periodName: 'October 2026',
  windowLabel: '2026-10-01 → 2026-10-31',
  windowNoun: 'month' as const,
};
const file5200 = accountMovementToCsv(movement, csvMeta);
if (!file5200) throw new Error('fixture: the 5200 replay must file');
const movement2 = buildAccountMovement(
  { accountCode: '2210', accountName: 'PAYE Payable', accountType: 'LIABILITY', normalBalance: 'CREDIT' },
  { debit: 0, credit: 0, priorLines: 0 },
  [
    { entryNumber: 'JE-C', entryDate: '2026-10-17T09:00:00.000Z', entryDescription: 'October payroll', source: 'REGULAR', debit: 0, credit: 35207.4, lineDescription: 'PAYE withheld' },
  ],
);
const file2210 = accountMovementToCsv(movement2, csvMeta);
if (!file2210) throw new Error('fixture: the 2210 replay must file');

describe('buildAccountBundle — the manifest and the archive', () => {
  const files: BundleAccountFile[] = [
    { accountCode: '5200', lineCount: 1, file: file5200 },
    { accountCode: '2210', lineCount: 1, file: file2210 },
  ];
  const bundle = buildAccountBundle([...files].reverse(), {
    organizationName: 'MBUMAH HARDWARE',
    scopeLabel: 'MBUMAH HARDWARE - Juja Main',
    periodName: 'October 2026',
    windowLabel: '2026-10-01 → 2026-10-31',
    totalAccounts: 37,
    quietCount: 35,
  }, new Date(Date.UTC(2026, 9, 18, 12, 0, 30)));

  it('counts what it filed: files, posted lines, entries (+ the manifest)', () => {
    expect(bundle.fileCount).toBe(2);
    expect(bundle.totalLines).toBe(2);
    expect(bundle.entryCount).toBe(3);
  });

  it('names the archive with the governed slug', () => {
    expect(bundle.filename).toBe('mbumah-account-movements-october-2026.zip');
  });

  it('MANIFEST.txt rides FIRST in the archive', () => {
    const first = new TextDecoder().decode(bundle.bytes.slice(30, 42));
    expect(first).toBe('MANIFEST.txt');
  });

  it('the manifest says what was filed, and what was not, and why', () => {
    const m = bundle.manifest;
    expect(m.includes('Report,Payroll account movements bundle')).toBe(true);
    expect(m.includes('Organization,MBUMAH HARDWARE')).toBe(true);
    expect(m.includes('Period,October 2026')).toBe(true);
    expect(m.includes('Window,2026-10-01 → 2026-10-31')).toBe(true);
    expect(m.includes('Files,2')).toBe(true);
    expect(m.includes('Posted lines filed,2')).toBe(true);
    expect(m.includes('Accounts in the chart,37')).toBe(true);
    expect(m.includes('Quiet accounts (no posted lines in the window — not filed),35')).toBe(true);
  });

  it('the manifest indexes one row per file, code-ascending (input order never wins)', () => {
    const rows = bundle.manifest.split('\r\n');
    const i2210 = rows.findIndex((r) => r.startsWith('2210,'));
    const i5200 = rows.findIndex((r) => r.startsWith('5200,'));
    expect(i2210).toBeGreaterThanOrEqual(0);
    expect(i5200).toBeGreaterThan(i2210);
    expect(rows[i5200]).toBe(`5200,1,${file5200.filename}`);
  });

  it('the zip closes: EOCD counts manifest + files', () => {
    const e = bundle.byteSize - 22;
    const v = new DataView(bundle.bytes.buffer, bundle.bytes.byteOffset, bundle.bytes.byteLength);
    expect(v.getUint16(e + 10, true)).toBe(3);
  });

  it('each member CSV still closes its own loop (Closing = last running cell)', () => {
    // the fixture: prior 258000.00 Dr + one 258000.00 debit → closing 516000.00 Dr
    expect(file5200.csv).toContain('Closing,,,,,,516000.00,0.00,516000.00 Dr');
    expect(file2210.csv).toContain('Closing,,,,,,0.00,35207.40,35207.40 Cr');
  });

  it('an empty file list bundles down to the manifest alone (the route guards before this)', () => {
    const empty = buildAccountBundle([], {
      organizationName: 'O', scopeLabel: 'S', periodName: 'P', windowLabel: 'W',
      totalAccounts: 0, quietCount: 0,
    });
    expect(empty.fileCount).toBe(0);
    expect(empty.entryCount).toBe(1);
    expect(empty.manifest.includes('Files,0')).toBe(true);
  });
});

describe('the route — the chart files its month through the drill contract', () => {
  const ROUTE = readRepo('src/app/api/payroll/period-journal/accounts/export-bundle/route.ts');

  it('rides the exact read contract (permission + roles)', () => {
    expect(ROUTE.includes("hrGuard('hr.payroll.read.all'")).toBe(true);
    expect(ROUTE.includes("'HR_MANAGER', 'BRANCH_MANAGER', 'STORE_OWNER', 'ACCOUNTANT'")).toBe(true);
  });

  it('is tenant-scoped and honest about failures', () => {
    expect(ROUTE.includes("'periodId is required.'")).toBe(true);
    expect(ROUTE.includes("where: { id: periodId, storeId: session.storeId || '' }")).toBe(true);
    const count404 = ROUTE.split('{ status: 404 }').length - 1;
    expect(count404).toBeGreaterThanOrEqual(3);
    expect(ROUTE.includes('NO_MOVEMENT_DATA')).toBe(true);
  });

  it('serves the period\'s OWN days, posted and never voided — the exact drill window', () => {
    expect(ROUTE.includes('monthEnd.setUTCDate(monthEnd.getUTCDate() + 1);')).toBe(true);
    expect(ROUTE.includes('entryDate: { gte: period.startDate, lt: monthEnd },')).toBe(true);
    expect(ROUTE.includes('isPosted: true,')).toBe(true);
    expect(ROUTE.includes('isVoided: false,')).toBe(true);
  });

  it('accepts NO window param — the file can never call itself something it is not', () => {
    expect(ROUTE.includes("searchParams.get('window')")).toBe(false);
    expect(ROUTE.includes("windowNoun: 'month',")).toBe(true);
  });

  it('builds from the SAME builders — the zip cannot disagree with the screen', () => {
    expect(ROUTE.includes('buildAccountMovement(')).toBe(true);
    expect(ROUTE.includes('accountMovementToCsv(')).toBe(true);
    expect(ROUTE.includes('buildAccountBundle(')).toBe(true);
  });

  it('audits with COUNTS only — the codes ride the manifest, never the row', () => {
    expect(ROUTE.includes("'PAYROLL_ACCOUNT_MOVEMENTS_BUNDLE_EXPORTED'")).toBe(true);
    const meta = ROUTE.split('metadata: {')[1]?.split('}).catch')[0] ?? '';
    expect(meta.includes('files: bundle.fileCount')).toBe(true);
    expect(meta.includes('postedLines: bundle.totalLines')).toBe(true);
    expect(meta.includes('quietAccounts:')).toBe(true);
    expect(meta.includes('accountCode')).toBe(false);
  });

  it('answers a zip attachment, never a page', () => {
    expect(ROUTE.includes("'Content-Type': 'application/zip',")).toBe(true);
    expect(ROUTE.includes('attachment; filename=')).toBe(true);
    expect(ROUTE.includes("'Cache-Control': 'no-store',")).toBe(true);
  });

  it('quiet is a fact, not a file — the loop skips it and counts it', () => {
    expect(ROUTE.includes('quiet is a fact, not a file')).toBe(true);
    expect(ROUTE.includes('quietCount: accounts.length - accountFiles.length,')).toBe(true);
  });
});

describe('the page — the browse box gains its governed exit', () => {
  const PAGE = readRepo('src/app/(shell)/hr/payroll/page.tsx');

  it('carries the v2.107.0 anchors', () => {
    for (const tid of [
      'payroll-account-bundle-row',
      'payroll-account-bundle-door',
      'payroll-account-bundle-note',
    ]) {
      expect(PAGE.includes(`data-testid="${tid}"`)).toBe(true);
    }
  });

  it('the door files the accounts that POSTED — the index badges are the truth', () => {
    expect(PAGE.includes('pickerAccounts.filter((a) => a.periodLines > 0).length')).toBe(true);
    expect(PAGE.includes('bundleActiveCount > 0 && (')).toBe(true);
    expect(PAGE.includes('{bundleBusy ? \'Building…\' : `File all ${bundleActiveCount} accounts`}')).toBe(true);
    expect(PAGE.includes('one zip · month window')).toBe(true);
  });

  it('the exit rides the governed route and the download discipline', () => {
    expect(PAGE.includes('/api/payroll/period-journal/accounts/export-bundle?periodId=')).toBe(true);
    expect(PAGE.includes('encodeURIComponent(payload.period.id)')).toBe(true);
    expect(PAGE.includes('URL.createObjectURL(blob)')).toBe(true);
    expect(PAGE.includes('URL.revokeObjectURL(objUrl)')).toBe(true);
  });

  it('stale bundle state never greets the next period', () => {
    const effect = PAGE.split('useEffect(() => {\n    setCsvNote(null);')[1]?.split('}, [periodName]);')[0] ?? '';
    expect(effect).toContain('setBundleNote(null)');
    expect(effect).toContain('setBundleBusy(false)');
  });

  it('prior v2.98–v2.106 anchors survive the restructure', () => {
    for (const tid of [
      'payroll-ledger-line',
      'payroll-account-picker',
      'payroll-account-picker-idle',
      'payroll-account-picker-recent-chip',
      'payroll-account-picker-browse-door',
      'payroll-account-picker-browse',
      'payroll-account-movement',
      'payroll-account-year-strip',
    ]) {
      expect(PAGE.includes(`data-testid="${tid}"`)).toBe(true);
    }
    expect(PAGE.includes('if (pickerOpen) e.preventDefault();')).toBe(true);
  });
});

describe('whats-new — the chart-files-its-month story leads the feed', () => {
  const WN = readRepo('src/lib/whats-new.ts');

  it('2.107.0 leads and 2.106.0 follows (newest first)', () => {
    const i107 = WN.indexOf("version: '2.107.0'");
    const i106 = WN.indexOf("version: '2.106.0'");
    expect(i107).toBeGreaterThanOrEqual(0);
    expect(i106).toBeGreaterThan(i107);
  });

  it('the entry tells the bundle story with its honesty', () => {
    const slice = WN.slice(WN.indexOf("version: '2.107.0'"), WN.indexOf("version: '2.106.0'"));
    expect(slice.includes("title: 'The chart files its month'")).toBe(true);
    for (const phrase of [
      'governed exit',
      'MANIFEST.txt',
      'Quiet is a fact, not a file',
      'byte-auditable',
      'widens nothing',
    ]) {
      expect(slice.includes(phrase)).toBe(true);
    }
  });
});
