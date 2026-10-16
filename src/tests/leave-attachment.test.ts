// v2.42.0 — leave attachment validation + display metadata contracts.
//
// The attachment rules are enforced on THREE surfaces (client picker, HR
// desk API, portal self-service) and they MUST agree — these tests pin the
// shared helper so a future edit cannot desynchronise one end.

import { describe, expect, it } from 'vitest';
import {
  ALLOWED_LEAVE_ATTACHMENT_MIME,
  MAX_LEAVE_ATTACHMENT_BYTES,
  base64PayloadBytes,
  base64PayloadLengthFor,
  formatBytes,
  parseLeaveAttachmentMeta,
  validateLeaveAttachmentFile,
  validateLeaveAttachmentUrl,
} from '@/lib/hr/leave-attachment';

/** Smallest valid 1×1 PNG as base64 (decodes to exactly 70 bytes). */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TINY_PNG_BYTES = 70;

const dataUrl = (mime: string, payload: string) => `data:${mime};base64,${payload}`;

/** Narrowing helper — parse and fail loudly instead of non-null asserting. */
function expectMeta(value: string | null | undefined) {
  const meta = parseLeaveAttachmentMeta(value);
  if (!meta) throw new Error(`expected attachment metadata for: ${String(value)}`);
  return meta;
}

describe('validateLeaveAttachmentUrl — accepted values', () => {
  it('accepts null, undefined and empty as "no attachment"', () => {
    expect(validateLeaveAttachmentUrl(null)).toEqual({ ok: true });
    expect(validateLeaveAttachmentUrl(undefined)).toEqual({ ok: true });
    expect(validateLeaveAttachmentUrl('')).toEqual({ ok: true });
    expect(validateLeaveAttachmentUrl('   ')).toEqual({ ok: true });
  });

  it('accepts every allowlisted mime as a data URL', () => {
    for (const mime of ALLOWED_LEAVE_ATTACHMENT_MIME) {
      expect(validateLeaveAttachmentUrl(dataUrl(mime, TINY_PNG))).toEqual({ ok: true });
    }
  });

  it('accepts mime case-insensitively and trims surrounding whitespace', () => {
    expect(validateLeaveAttachmentUrl(`  ${dataUrl('Application/PDF', 'AAAA')}  `)).toEqual({ ok: true });
  });

  it('still accepts legacy http(s) links', () => {
    expect(validateLeaveAttachmentUrl('https://example.com/certificate.pdf')).toEqual({ ok: true });
    expect(validateLeaveAttachmentUrl('http://intranet.local/docs/leave')).toEqual({ ok: true });
  });
});

describe('validateLeaveAttachmentUrl — rejections', () => {
  it('rejects non-allowlisted data-URL mimes with a TYPE code', () => {
    const result = validateLeaveAttachmentUrl(dataUrl('application/zip', 'UEsDBA=='));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TYPE');
      expect(result.message).toContain('application/zip');
    }
  });

  it('rejects a data URL whose decoded size exceeds the 500 KB cap', () => {
    const payload = 'A'.repeat(base64PayloadLengthFor(MAX_LEAVE_ATTACHMENT_BYTES + 1));
    const result = validateLeaveAttachmentUrl(dataUrl('image/png', payload));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOO_LARGE');
      expect(result.message).toContain('500 KB');
    }
  });

  it('accepts a payload exactly at the cap (boundary)', () => {
    const payload = 'A'.repeat(base64PayloadLengthFor(MAX_LEAVE_ATTACHMENT_BYTES));
    expect(validateLeaveAttachmentUrl(dataUrl('image/png', payload))).toEqual({ ok: true });
  });

  it('rejects arbitrary strings (not a URL, not a data URL) with FORMAT', () => {
    const result = validateLeaveAttachmentUrl('javascript:alert(1)');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORMAT');
  });

  it('rejects a malformed data URL missing the base64 payload marker', () => {
    const result = validateLeaveAttachmentUrl('data:image/png,rawbytes');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('FORMAT');
  });
});

describe('validateLeaveAttachmentFile — the client picker gate', () => {
  const file = (name: string, type: string, size: number) => new File([new ArrayBuffer(size)], name, { type });

  it('accepts an allowlisted file within the cap', () => {
    expect(validateLeaveAttachmentFile(file('cert.png', 'image/png', 1024))).toEqual({ ok: true });
  });

  it('rejects disallowed types before reading anything', () => {
    const result = validateLeaveAttachmentFile(file('notes.txt', 'text/plain', 10));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TYPE');
      expect(result.message).toContain('notes.txt');
    }
  });

  it('rejects oversized files with the cap in the message', () => {
    const result = validateLeaveAttachmentFile(file('big.jpg', 'image/jpeg', MAX_LEAVE_ATTACHMENT_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('TOO_LARGE');
      expect(result.message).toContain('500 KB');
    }
  });
});

describe('base64 math', () => {
  it('computes decoded sizes padding-aware', () => {
    // TINY_PNG decodes to exactly 70 bytes.
    expect(base64PayloadBytes(TINY_PNG)).toBe(TINY_PNG_BYTES);
    expect(base64PayloadBytes('')).toBe(0);
    // "AA==" decodes to a single zero byte.
    expect(base64PayloadBytes('AA==')).toBe(1);
    // "AAA" (no padding) decodes to 2 bytes.
    expect(base64PayloadBytes('AAA')).toBe(2);
  });

  it('round-trips the payload-length helper used to build boundary cases', () => {
    const len = base64PayloadLengthFor(MAX_LEAVE_ATTACHMENT_BYTES);
    expect(base64PayloadBytes('A'.repeat(len))).toBeLessThanOrEqual(MAX_LEAVE_ATTACHMENT_BYTES);
    expect(base64PayloadBytes('A'.repeat(len + 4))).toBeGreaterThan(MAX_LEAVE_ATTACHMENT_BYTES);
  });
});

describe('parseLeaveAttachmentMeta — display metadata', () => {
  it('returns null for nothing attached', () => {
    expect(parseLeaveAttachmentMeta(null)).toBeNull();
    expect(parseLeaveAttachmentMeta(undefined)).toBeNull();
    expect(parseLeaveAttachmentMeta('')).toBeNull();
    expect(parseLeaveAttachmentMeta('   ')).toBeNull();
  });

  it('labels a PDF data URL with a .pdf name and its byte size', () => {
    const meta = expectMeta(dataUrl('application/pdf', TINY_PNG));
    expect(meta.kind).toBe('pdf');
    expect(meta.label).toBe('attachment.pdf');
    expect(meta.bytes).toBe(TINY_PNG_BYTES);
    expect(meta.mime).toBe('application/pdf');
  });

  it('labels images with their extension', () => {
    const meta = expectMeta(dataUrl('image/webp', TINY_PNG));
    expect(meta.kind).toBe('image');
    expect(meta.label).toBe('attachment.webp');
  });

  it('extracts the host from an http(s) link', () => {
    const meta = expectMeta('https://drive.example.com/a/very/long/path/certificate.pdf?query=1');
    expect(meta.kind).toBe('link');
    expect(meta.label).toBe('drive.example.com');
    expect(meta.bytes).toBeNull();
  });

  it('falls back to a truncated label for unrecognized legacy content', () => {
    const meta = expectMeta('ftp://files/cert.pdf');
    expect(meta.kind).toBe('link');
    expect(meta.label).toBe('ftp://files/cert.pdf');
  });
});

describe('formatBytes', () => {
  it('formats the human ladder', () => {
    expect(formatBytes(640)).toBe('640 B');
    expect(formatBytes(15 * 1024)).toBe('15 KB');
    expect(formatBytes(MAX_LEAVE_ATTACHMENT_BYTES)).toBe('500 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});
