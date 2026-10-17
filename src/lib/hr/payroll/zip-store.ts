// MBUMAH HARDWARE POS - Minimal STORE-mode zip writer (v2.83.0)
//
// Zero-dependency ZIP writer for the payslip bundle (one run → one .zip of
// its payslip PDFs). The POS repo deliberately carries no archive library
// (the payslip PDF writer follows the same rule); payslips are small PDFs
// whose streams are already compressed, so METHOD 0 (STORE, no deflate) is
// the honest choice: the writer stays ~120 lines, fully deterministic and
// byte-testable, and zipping PDFs again would save nothing meaningful.
//
// FORMAT CONTRACT (PKWARE APPNOTE, the subset we emit):
//   • local file header  (PK\x03\x04) per entry — 30 bytes + name
//   • central directory  (PK\x01\x02) per entry — 46 bytes + name
//   • end of central dir (PK\x05\x06)           — 22 bytes, empty comment
//   • version needed 20 (2.0), flags 0, method 0 (STORE), no data descriptor,
//     no ZIP64 — guards refuse > 65535 entries or > 4 GiB long before the
//     format breaks (a run's payslip bundle is a few dozen slips).
//   • filenames are sanitized to FLAT ASCII (sanitizeZipEntryName) so the
//     UTF-8 flag (0x0800) never needs to be set — byte layout stays fixed.
//
// PURE module: no db, no network, no env — same constraint as the payslip
// PDF writer, so unit tests run without any mocking.

// ── CRC-32 (IEEE 802.3, the zip polynomial 0xEDB88320) ─────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 of the bytes (the value zip stores for every entry). */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── DOS date/time (the only timestamp zip entries carry) ───────────────────

/**
 * DOS date/time words from the LOCAL wall parts of `date`.
 *   date = (year-1980) << 9 | month << 5 | day
 *   time = hour << 11 | minute << 5 | floor(second / 2)
 * Years before 1980 clamp to 1980 (the DOS epoch cannot go lower).
 */
export function dosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
  };
}

// ── entry-name sanitizer (flat ASCII, traversal-proof) ─────────────────────

/**
 * Reduce one entry name to a FLAT, printable-ASCII file name:
 * only the last path segment survives (both '/' and '\' split), control
 * and non-ASCII characters become '?', trailing dots/spaces are trimmed
 * (Windows refuses them in a filename). The caller decides what an empty
 * result means; buildStoreZip refuses it.
 */
export function sanitizeZipEntryName(raw: string): string {
  const segment = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const printable = segment.replace(/[^\x20-\x7E]/g, '?').trim();
  return printable.replace(/[. ]+$/, '');
}

// ── the writer ──────────────────────────────────────────────────────────────

export interface ZipEntryInput {
  name: string;
  data: Uint8Array;
}

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;

/**
 * Build a zip archive from `files` with METHOD 0 (STORE). Deterministic:
 * the same (files, now) pair produces byte-identical output, so the unit
 * tests can pin the whole layout. `now` supplies every entry's DOS
 * timestamp — pass the caller's clock, never a hidden one.
 *
 * Throws when: the list is empty, a name sanitizes to nothing, two names
 * collide, any name/sizes/count exceed the non-ZIP64 limits, or an entry
 * is not a plain { name, data } pair.
 */
export function buildStoreZip(files: ZipEntryInput[], now: Date): Uint8Array {
  if (files.length === 0) throw new Error('buildStoreZip: an empty archive is never a useful download.');
  if (files.length > U16_MAX) throw new Error('buildStoreZip: too many entries (ZIP64 required).');

  const { date: dosDate, time: dosTime } = dosDateTime(now);

  interface StagedEntry {
    name: string;
    nameBytes: Buffer;
    data: Uint8Array;
    crc: number;
    localHeaderOffset: number;
  }

  const entries: StagedEntry[] = files.map((file) => {
    const name = sanitizeZipEntryName(file.name);
    if (!name) throw new Error(`buildStoreZip: entry name sanitizes to nothing ("${file.name}").`);
    if (file.data.byteLength > U32_MAX) throw new Error(`buildStoreZip: "${name}" exceeds the 4 GiB entry limit.`);
    const bytes = file.data;
    return { name, nameBytes: Buffer.from(name, 'ascii'), data: bytes, crc: crc32(bytes), localHeaderOffset: 0 };
  });

  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.name.length > U16_MAX) throw new Error(`buildStoreZip: name too long ("${entry.name}").`);
    if (seen.has(entry.name)) throw new Error(`buildStoreZip: duplicate entry name "${entry.name}".`);
    seen.add(entry.name);
  }

  // Layout arithmetic: local block (30 + name + data) per entry, central
  // record (46 + name) per entry, EOCD fixed 22.
  let localSpan = 0;
  for (const entry of entries) localSpan += 30 + entry.nameBytes.length + entry.data.byteLength;
  let centralSpan = 0;
  for (const entry of entries) centralSpan += 46 + entry.nameBytes.length;
  const centralOffset = localSpan;
  const centralSize = centralSpan;
  const total = localSpan + centralSize + 22;
  if (total > U32_MAX) throw new Error('buildStoreZip: archive exceeds the 4 GiB limit (ZIP64 required).');

  // An OWNING Uint8Array — never a pooled Buffer view. A Buffer.allocUnsafe
  // under ~4 KiB draws from Node's shared pool, and a view over that pool
  // would be silently clobbered by the next allocation (the deterministic
  // test caught exactly that). The archive must own its bytes.
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;

  // Local file headers + stored bytes.
  for (const entry of entries) {
    entry.localHeaderOffset = offset;
    view.setUint32(offset, 0x04034b50, true); offset += 4; // local header signature
    view.setUint16(offset, 20, true); offset += 2;         // version needed
    view.setUint16(offset, 0, true); offset += 2;          // flags
    view.setUint16(offset, 0, true); offset += 2;          // method: STORE
    view.setUint16(offset, dosTime, true); offset += 2;
    view.setUint16(offset, dosDate, true); offset += 2;
    view.setUint32(offset, entry.crc, true); offset += 4;
    view.setUint32(offset, entry.data.byteLength, true); offset += 4; // compressed
    view.setUint32(offset, entry.data.byteLength, true); offset += 4; // uncompressed
    view.setUint16(offset, entry.nameBytes.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;          // extra length
    out.set(entry.nameBytes, offset); offset += entry.nameBytes.length;
    out.set(entry.data, offset); offset += entry.data.byteLength;
  }

  // Central directory records.
  let centralCursor = centralOffset;
  for (const entry of entries) {
    const headerOffset = entry.localHeaderOffset;
    view.setUint32(centralCursor, 0x02014b50, true); centralCursor += 4; // central signature
    view.setUint16(centralCursor, 20, true); centralCursor += 2;         // version made by
    view.setUint16(centralCursor, 20, true); centralCursor += 2;         // version needed
    view.setUint16(centralCursor, 0, true); centralCursor += 2;          // flags
    view.setUint16(centralCursor, 0, true); centralCursor += 2;          // method: STORE
    view.setUint16(centralCursor, dosTime, true); centralCursor += 2;
    view.setUint16(centralCursor, dosDate, true); centralCursor += 2;
    view.setUint32(centralCursor, entry.crc, true); centralCursor += 4;
    view.setUint32(centralCursor, entry.data.byteLength, true); centralCursor += 4;
    view.setUint32(centralCursor, entry.data.byteLength, true); centralCursor += 4;
    view.setUint16(centralCursor, entry.nameBytes.length, true); centralCursor += 2;
    view.setUint16(centralCursor, 0, true); centralCursor += 2;          // extra
    view.setUint16(centralCursor, 0, true); centralCursor += 2;          // comment
    view.setUint16(centralCursor, 0, true); centralCursor += 2;          // disk start
    view.setUint16(centralCursor, 0, true); centralCursor += 2;          // internal attrs
    view.setUint32(centralCursor, 0, true); centralCursor += 4;          // external attrs
    view.setUint32(centralCursor, headerOffset, true); centralCursor += 4;
    out.set(entry.nameBytes, centralCursor); centralCursor += entry.nameBytes.length;
  }

  // End of central directory — written AFTER the central records (at
  // centralCursor, which now sits at centralOffset + centralSize), never at
  // `offset` (that is the end of the LOCAL entries — stamping it here would
  // overwrite the directory's first 22 bytes; the byte-walking test caught
  // exactly that).
  const eocdAt = centralCursor;
  view.setUint32(eocdAt, 0x06054b50, true); // EOCD signature
  view.setUint16(eocdAt + 4, 0, true);      // disk number
  view.setUint16(eocdAt + 6, 0, true);      // central dir disk
  view.setUint16(eocdAt + 8, entries.length, true);  // entries on this disk
  view.setUint16(eocdAt + 10, entries.length, true); // entries total
  view.setUint32(eocdAt + 12, centralSize, true);
  view.setUint32(eocdAt + 16, centralOffset, true);
  view.setUint16(eocdAt + 20, 0, true);     // comment length

  return out;
}
