// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { crc32, dosDateTime, sanitizeZipEntryName, buildStoreZip } from '@/lib/hr/payroll/zip-store';

/**
 * v2.83.0: the zero-dependency STORE zip writer behind the payslip bundle.
 * The tests ARE the zip reader: they parse the emitted bytes field by field
 * (PKWARE APPNOTE subset) so a malformed archive can never ship.
 */

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('crc32 (IEEE 802.3 — the zip polynomial)', () => {
  it('matches the standard check vectors', () => {
    expect(crc32(new Uint8Array(0))).toBe(0x00000000);
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('reads any byte-like view, not just fresh buffers', () => {
    const buf = bytes('zip zip zip');
    expect(crc32(buf)).toBe(crc32(new Uint8Array(buf).slice()));
  });
});

describe('dosDateTime', () => {
  it('encodes the DOS epoch floor exactly', () => {
    expect(dosDateTime(new Date(1980, 0, 1, 0, 0, 0))).toEqual({ date: 0x0021, time: 0x0000 });
  });

  it('packs local wall parts into the two words', () => {
    // (2026-1980)<<9 | 10<<5 | 17 and 14<<11 | 54<<5 | 8/2
    expect(dosDateTime(new Date(2026, 9, 17, 14, 54, 8))).toEqual({ date: 23889, time: 30404 });
  });

  it('clamps pre-1980 years to the DOS floor instead of going negative', () => {
    const { date } = dosDateTime(new Date(1970, 0, 1, 0, 0, 0));
    expect(date).toBe(0x0021);
  });
});

describe('sanitizeZipEntryName', () => {
  it('keeps only the last path segment', () => {
    expect(sanitizeZipEntryName('a/b/c.pdf')).toBe('c.pdf');
    expect(sanitizeZipEntryName('..\\..\\evil.pdf')).toBe('evil.pdf');
  });

  it('replaces non-printable and non-ASCII characters', () => {
    expect(sanitizeZipEntryName('slip\u00e9.pdf')).toBe('slip?.pdf');
    expect(sanitizeZipEntryName('a\u0000b.pdf')).toBe('a?b.pdf');
  });

  it('trims trailing dots and spaces (Windows filename rules)', () => {
    expect(sanitizeZipEntryName('PS-1. ')).toBe('PS-1');
    expect(sanitizeZipEntryName('PS-1...')).toBe('PS-1');
    expect(sanitizeZipEntryName('PS-1. pdf')).toBe('PS-1. pdf'); // interior dot+space survives
  });

  it('can produce an empty result — the writer refuses it', () => {
    expect(sanitizeZipEntryName('///')).toBe('');
  });
});

/** Field-by-field zip parser used by the writer contracts below. */
function parseZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const text = (start: number, len: number) => new TextDecoder().decode(zip.subarray(start, start + len));

  // Walk local headers from 0.
  const locals: Array<{ name: string; data: Uint8Array; crc: number; offset: number }> = [];
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const crc = view.getUint32(offset + 14, true);
    const compSize = view.getUint32(offset + 18, true);
    const uncompSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = text(offset + 30, nameLen);
    const data = zip.slice(offset + 30 + nameLen + extraLen, offset + 30 + nameLen + extraLen + compSize);
    locals.push({ name, data, crc, offset });
    expect(method).toBe(0); // STORE — the writer's whole point
    expect(compSize).toBe(uncompSize);
    offset += 30 + nameLen + extraLen + compSize;
  }

  // Central directory.
  const centralOffset = offset;
  const centrals: Array<{ name: string; localHeaderOffset: number; crc: number }> = [];
  while (view.getUint32(offset, true) === 0x02014b50) {
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    centrals.push({ name: text(offset + 46, nameLen), localHeaderOffset, crc: view.getUint32(offset + 16, true) });
    expect(extraLen).toBe(0);
    expect(commentLen).toBe(0);
    offset += 46 + nameLen;
  }

  // EOCD.
  expect(view.getUint32(offset, true)).toBe(0x06054b50);
  const eocd = {
    entries: view.getUint16(offset + 10, true),
    centralSize: view.getUint32(offset + 12, true),
    centralOffset: view.getUint32(offset + 16, true),
    commentLen: view.getUint16(offset + 20, true),
  };
  expect(eocd.commentLen).toBe(0);
  expect(eocd.entries).toBe(locals.length);
  expect(eocd.entries).toBe(centrals.length);
  expect(eocd.centralOffset).toBe(centralOffset);
  expect(eocd.centralSize).toBe(offset - centralOffset);
  expect(offset + 22).toBe(zip.byteLength); // archive ends exactly at the EOCD

  // Central records must point at their local headers and agree on bytes.
  for (const c of centrals) {
    const local = locals.find((l) => l.offset === c.localHeaderOffset && l.name === c.name);
    expect(local).toBeDefined();
    expect(local?.crc).toBe(c.crc);
  }
  return { locals, centrals, eocd };
}

describe('buildStoreZip', () => {
  const NOW = new Date(2026, 9, 17, 14, 54, 8);
  const files = [
    { name: '_MANIFEST.csv', data: bytes('Report,Payslip bundle\r\nSlips,2\r\n') },
    { name: 'PS-2026-0001.pdf', data: bytes('%PDF-1.4 slip one') },
    { name: 'PS-2026-0002.pdf', data: bytes('%PDF-1.4 slip two') },
  ];

  it('produces an archive a field-by-field reader can walk', () => {
    const zip = buildStoreZip(files, NOW);
    const { locals, eocd } = parseZip(zip);
    expect(eocd.entries).toBe(3);
    expect(locals.map((l) => l.name)).toEqual(['_MANIFEST.csv', 'PS-2026-0001.pdf', 'PS-2026-0002.pdf']);
    expect(new TextDecoder().decode(locals[0].data)).toBe('Report,Payslip bundle\r\nSlips,2\r\n');
    expect(new TextDecoder().decode(locals[1].data)).toBe('%PDF-1.4 slip one');
  });

  it('stores every byte honestly (CRC + content survive the round trip)', () => {
    const zip = buildStoreZip(files, NOW);
    const { locals } = parseZip(zip);
    for (const local of locals) {
      expect(local.crc).toBe(crc32(local.data));
    }
  });

  it('is deterministic: the same (files, now) builds byte-identical output', () => {
    expect(buildStoreZip(files, NOW)).toEqual(buildStoreZip(files, NOW));
  });

  it('stamps the DOS time from the passed clock, not a hidden now()', () => {
    const view = new DataView(buildStoreZip(files, NOW).buffer);
    const expected = dosDateTime(NOW);
    expect(view.getUint16(10, true)).toBe(expected.time);
    expect(view.getUint16(12, true)).toBe(expected.date);
    // A different clock produces a different stamp (not frozen at module load).
    const other = buildStoreZip(files, new Date(2024, 4, 1, 9, 0, 0));
    const otherView = new DataView(other.buffer);
    expect(otherView.getUint16(12, true)).toBe(dosDateTime(new Date(2024, 4, 1, 9, 0, 0)).date);
  });

  it('refuses an empty archive, duplicate names, and empty names', () => {
    expect(() => buildStoreZip([], NOW)).toThrow(/empty archive/);
    expect(() =>
      buildStoreZip(
        [
          { name: 'a.pdf', data: bytes('1') },
          { name: 'a.pdf', data: bytes('2') },
        ],
        NOW,
      ),
    ).toThrow(/duplicate entry name/);
    expect(() => buildStoreZip([{ name: '///', data: bytes('1') }], NOW)).toThrow(/sanitizes to nothing/);
  });

  it('refuses entry counts beyond the non-ZIP64 limit', () => {
    const many = Array.from({ length: 65536 }, (_, i) => ({ name: `f${i}.txt`, data: new Uint8Array(1) }));
    expect(() => buildStoreZip(many, NOW)).toThrow(/ZIP64/);
  });
});
