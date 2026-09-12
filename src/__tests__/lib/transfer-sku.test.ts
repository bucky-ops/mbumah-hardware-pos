import { describe, it, expect } from 'vitest';
import { deriveTransferDestinationSku, normalizeBranchCode, formatEmployeeCode, generateSKU } from '@/lib/helpers';

describe('deriveTransferDestinationSku', () => {
  it('prefers the destination branch code when available', () => {
    expect(deriveTransferDestinationSku('MBM-THI-0042', 'store_nakuru', 'nak')).toBe('MBM-THI-0042--NAK');
  });

  it('falls back to the storeId when the branch has no code yet (legacy pairs stay stable)', () => {
    expect(deriveTransferDestinationSku('QA-XFER-001', 'store_nakuru', null)).toBe('QA-XFER-001--store_nakuru');
    expect(deriveTransferDestinationSku('QA-XFER-001', 'store_nakuru')).toBe('QA-XFER-001--store_nakuru');
  });

  it('is deterministic across calls (repeated transfers hit the same row)', () => {
    const a = deriveTransferDestinationSku('MBM-THI-0001', 'store_ruiru', 'RUI');
    const b = deriveTransferDestinationSku('MBM-THI-0001', 'store_ruiru', 'RUI');
    expect(a).toBe(b);
  });

  it('differs per destination store', () => {
    expect(deriveTransferDestinationSku('S', 'store_nakuru', 'NAK')).not.toBe(
      deriveTransferDestinationSku('S', 'store_ruiru', 'RUI')
    );
  });

  it('returns null when origin SKU is missing', () => {
    expect(deriveTransferDestinationSku(null, 'store_nakuru')).toBeNull();
    expect(deriveTransferDestinationSku('', 'store_nakuru')).toBeNull();
    expect(deriveTransferDestinationSku('S', '')).toBeNull();
  });
});

describe('normalizeBranchCode', () => {
  it('uppercases and strips non-alphanumerics', () => {
    expect(normalizeBranchCode(' thika ')).toBe('THIKA');
    expect(normalizeBranchCode('nak')).toBe('NAK');
  });

  it('rejects codes that exceed 6 characters after normalization', () => {
    expect(normalizeBranchCode('juja-main')).toBeNull(); // JUJAMAIN = 8 chars
  });

  it('accepts 2-6 character codes', () => {
    expect(normalizeBranchCode('NAK')).toBe('NAK');
    expect(normalizeBranchCode('NCBD')).toBe('NCBD');
    expect(normalizeBranchCode('AB')).toBe('AB');
  });

  it('rejects codes shorter than 2 or longer than 6 characters', () => {
    expect(normalizeBranchCode('A')).toBeNull();
    expect(normalizeBranchCode('ABCDEFG')).toBeNull();
    expect(normalizeBranchCode('')).toBeNull();
    expect(normalizeBranchCode(null)).toBeNull();
    expect(normalizeBranchCode(undefined)).toBeNull();
  });
});

describe('formatEmployeeCode', () => {
  it('formats MBM-<branch>-E<NNN> with a 3-digit sequence', () => {
    expect(formatEmployeeCode('JUJ', 1)).toBe('MBM-JUJ-E001');
    expect(formatEmployeeCode('nak', 12)).toBe('MBM-NAK-E012');
    expect(formatEmployeeCode('THI', 145)).toBe('MBM-THI-E145');
  });

  it('returns null for invalid branch codes or sequences', () => {
    expect(formatEmployeeCode('A', 1)).toBeNull();
    expect(formatEmployeeCode('JUJ', 0)).toBeNull();
    expect(formatEmployeeCode('JUJ', -3)).toBeNull();
    expect(formatEmployeeCode('', 1)).toBeNull();
  });
});

describe('generateSKU with branch code', () => {
  it('embeds the branch code when supplied', () => {
    const sku = generateSKU('CEM', 'JUJ');
    expect(sku).toMatch(/^MBM-JUJ-CEM-\d{4}$/);
  });

  it('keeps the legacy MBM-<CAT>-XXXX shape without a branch code', () => {
    const sku = generateSKU('CEM');
    expect(sku).toMatch(/^MBM-CEM-\d{4}$/);
  });

  it('is unique across calls (random suffix)', () => {
    const skus = new Set(Array.from({ length: 40 }, () => generateSKU('CEM', 'NAK')));
    expect(skus.size).toBeGreaterThan(1);
  });
});
