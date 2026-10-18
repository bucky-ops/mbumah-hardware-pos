// v2.107.0: the chart files its month — the per-account movement bundle.
//
// The filing family's next step: the picker (v2.105.0) made any account
// askable, the browse door (v2.106.0) made the whole chart visible, and
// now one governed exit files EVERY account that posted inside the window
// as its own CSV — zipped, with a MANIFEST that says exactly what was
// filed and what was not. The zip is written by a STORE-ONLY writer in
// this file (no dependency, no compression — a month of payroll is
// bounded, and store-only keeps the format byte-auditable: the CRC and
// the sizes are the file's own honesty, checkable with `unzip -t`).
//
// House rules honored here:
//   • one pure builder per surface — every byte is decided here, tests pin
//     them, and the route only queries and forwards;
//   • the shared injection guard (csvCell) rides every manifest cell;
//   • the manifest carries COUNTS and FILENAMES — never employee names;
//   • quiet is a fact, not a file: an account with no posted lines in the
//     window is not filed (a replay with zero rows has nothing to say),
//     and the manifest says how many were left out and why.

import { csvCell } from '@/lib/hr/digest-csv';
import { periodSlug } from '@/lib/hr/payroll/period-journal';
import type { accountMovementToCsv } from '@/lib/hr/payroll/period-journal';

// ── CRC-32 (IEEE, reflected, poly 0xEDB88320) ───────────────────────────────

let CRC_TABLE: Uint32Array | null = null;

function crcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  CRC_TABLE = table;
  return table;
}

/** The zip's integrity word — computed over the UNCOMPRESSED bytes (store). */
export function crc32(bytes: Uint8Array): number {
  const table = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ── DOS date/time (the zip timestamp fields) ────────────────────────────────

/**
 * The zip's local timestamp, packed the MS-DOS way. UTC fields on purpose:
 * a filing stamp, not a promise about someone's wall clock (the CSVs carry
 * their own 'Generated (UTC)' row — the manifest repeats it).
 */
export function dosDateTime(d: Date): { date: number; time: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  const month = Math.min(12, Math.max(1, d.getUTCMonth() + 1));
  const day = Math.min(31, Math.max(1, d.getUTCDate()));
  const hours = Math.min(23, Math.max(0, d.getUTCHours()));
  const minutes = Math.min(59, Math.max(0, d.getUTCMinutes()));
  const seconds = Math.min(59, Math.max(0, d.getUTCSeconds()));
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | (seconds >> 1),
  };
}

// ── The store-only zip writer ───────────────────────────────────────────────

export interface ZipEntry {
  name: string;
  bytes: Uint8Array;
}

export interface ZipFile {
  filename: string;
  bytes: Uint8Array;
  byteSize: number;
  entryCount: number;
}

const encoder = new TextEncoder();

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * Write a zip with method 0 (store): every entry's compressed size IS its
 * size, the CRC rides beside it, and a central directory + EOCD close the
 * archive. Names are UTF-8 (flag 0x0800). Duplicate names are the CALLER's
 * sin — none is invented here (per-account filenames are unique by code).
 */
export function zipStore(entries: ZipEntry[], filename: string, generatedAt: Date = new Date()): ZipFile {
  const { date, time } = dosDateTime(generatedAt);

  // Pass 1: size everything.
  let totalSize = 0;
  let centralSize = 0;
  const prepared = entries.map((entry) => {
    const name = encoder.encode(String(entry.name ?? ''));
    // Realm-safe narrowing (E2E-caught in vitest: util.TextEncoder's encode
    // returns a Uint8Array from ANOTHER realm — `instanceof Uint8Array` is
    // false for it and a naive else would file the String() of the array,
    // '97,108,112…'). ArrayBuffer.isView checks the internal slot, which
    // every realm's TypedArray carries; the view re-wraps the SAME memory.
    const data = ArrayBuffer.isView(entry.bytes)
      ? new Uint8Array(entry.bytes.buffer, entry.bytes.byteOffset, entry.bytes.byteLength)
      : encoder.encode(String(entry.bytes ?? ''));
    const crc = crc32(data);
    const localSize = 30 + name.length + data.length;
    const centralEntrySize = 46 + name.length;
    totalSize += localSize;
    centralSize += centralEntrySize;
    return { name, data, crc, offset: 0 };
  });
  // Assign offsets in order.
  let cursor = 0;
  for (const p of prepared) {
    p.offset = cursor;
    cursor += 30 + p.name.length + p.data.length;
  }

  const eocdSize = 22;
  const out = new Uint8Array(totalSize + centralSize + eocdSize);
  const view = new DataView(out.buffer);

  // Pass 2: local file headers + payloads.
  for (const p of prepared) {
    const o = p.offset;
    u32(view, o, 0x04034b50); // local file header signature
    u16(view, o + 4, 20); // version needed
    u16(view, o + 6, 0x0800); // flags: UTF-8 names
    u16(view, o + 8, 0); // method: store
    u16(view, o + 10, time);
    u16(view, o + 12, date);
    u32(view, o + 14, p.crc);
    u32(view, o + 18, p.data.length); // compressed (store = size)
    u32(view, o + 22, p.data.length); // uncompressed
    u16(view, o + 26, p.name.length);
    u16(view, o + 28, 0); // extra length
    out.set(p.name, o + 30);
    out.set(p.data, o + 30 + p.name.length);
  }

  // Pass 3: central directory.
  const cdOffset = totalSize;
  let cdCursor = cdOffset;
  for (const p of prepared) {
    u32(view, cdCursor, 0x02014b50); // central directory signature
    u16(view, cdCursor + 4, 20); // version made by
    u16(view, cdCursor + 6, 20); // version needed
    u16(view, cdCursor + 8, 0x0800); // flags
    u16(view, cdCursor + 10, 0); // method: store
    u16(view, cdCursor + 12, time);
    u16(view, cdCursor + 14, date);
    u32(view, cdCursor + 16, p.crc);
    u32(view, cdCursor + 20, p.data.length);
    u32(view, cdCursor + 24, p.data.length);
    u16(view, cdCursor + 28, p.name.length);
    u16(view, cdCursor + 30, 0); // extra
    u16(view, cdCursor + 32, 0); // comment
    u16(view, cdCursor + 34, 0); // disk start
    u16(view, cdCursor + 36, 0); // internal attrs
    u32(view, cdCursor + 38, 0); // external attrs
    u32(view, cdCursor + 42, p.offset); // local header offset
    out.set(p.name, cdCursor + 46);
    cdCursor += 46 + p.name.length;
  }

  // Pass 4: EOCD.
  const eocd = cdCursor;
  u32(view, eocd, 0x06054b50);
  u16(view, eocd + 4, 0); // disk number
  u16(view, eocd + 6, 0); // disk with central dir
  u16(view, eocd + 8, prepared.length); // entries on this disk
  u16(view, eocd + 10, prepared.length); // entries total
  u32(view, eocd + 12, centralSize);
  u32(view, eocd + 16, cdOffset);
  u16(view, eocd + 20, 0); // comment length

  return {
    filename,
    bytes: out,
    byteSize: out.length,
    entryCount: prepared.length,
  };
}

// ── The bundle: manifest + per-account CSVs ────────────────────────────────

export interface BundleAccountFile {
  accountCode: string;
  lineCount: number;
  file: NonNullable<ReturnType<typeof accountMovementToCsv>>;
}

export interface AccountBundleMeta {
  organizationName: string;
  scopeLabel: string;
  periodName: string;
  windowLabel: string;
  totalAccounts: number;
  quietCount: number;
}

export interface AccountBundle {
  filename: string;
  bytes: Uint8Array;
  byteSize: number;
  entryCount: number;
  manifest: string;
  fileCount: number;
  totalLines: number;
}

/**
 * Assemble the bundle: MANIFEST.txt first (the file's own honesty — what
 * was filed, what was not, and why), then one CSV per ACTIVE account in
 * code order. The manifest is CSV-shaped through the SAME csvCell guard
 * as every filing in the family; the zip closes with a central directory
 * whose order is the manifest's order.
 */
export function buildAccountBundle(
  accountFiles: BundleAccountFile[],
  meta: AccountBundleMeta,
  generatedAt: Date = new Date(),
): AccountBundle {
  const files = [...accountFiles].sort((a, b) =>
    String(a.accountCode).localeCompare(String(b.accountCode)),
  );
  const totalLines = files.reduce((sum, f) => sum + f.lineCount, 0);

  const rows: string[] = [];
  const row = (cells: Array<string | number>) => rows.push(cells.map(csvCell).join(','));

  row(['Report', 'Payroll account movements bundle']);
  row(['Organization', meta.organizationName]);
  row(['Scope', meta.scopeLabel]);
  row(['Period', meta.periodName]);
  row(['Window', meta.windowLabel]);
  row(['Generated (UTC)', generatedAt.toISOString()]);
  row(['Files', files.length]);
  row(['Posted lines filed', totalLines]);
  row(['Accounts in the chart', meta.totalAccounts]);
  row([
    'Quiet accounts (no posted lines in the window — not filed)',
    meta.quietCount,
  ]);
  rows.push('');
  row(['Account Code', 'Posted Lines', 'File']);
  for (const f of files) {
    row([f.accountCode, f.lineCount, f.file.filename]);
  }
  const manifest = rows.join('\r\n') + '\r\n';

  const entries: ZipEntry[] = [
    { name: 'MANIFEST.txt', bytes: encoder.encode(manifest) },
    ...files.map((f) => ({ name: f.file.filename, bytes: encoder.encode(f.file.csv) })),
  ];

  // The governed slug — the SAME fragment every filing in the family uses
  // (periodSlug, never a homemade rule), so the zip's name, the CSVs'
  // names and the manifest's Period row all speak one dialect.
  const filename = `mbumah-account-movements-${periodSlug(meta.periodName, 'period')}.zip`;

  const zip = zipStore(entries, filename, generatedAt);
  return {
    filename: zip.filename,
    bytes: zip.bytes,
    byteSize: zip.byteSize,
    entryCount: zip.entryCount,
    manifest,
    fileCount: files.length,
    totalLines,
  };
}
