import { describe, it, expect } from 'vitest';
import { deriveTransferDestinationSku } from '@/lib/helpers';

describe('deriveTransferDestinationSku', () => {
  it('derives a stable per-(origin, destination) SKU', () => {
    expect(deriveTransferDestinationSku('QA-XFER-001', 'store_nakuru')).toBe('QA-XFER-001--store_nakuru');
  });

  it('is deterministic across calls (repeated transfers hit the same row)', () => {
    const a = deriveTransferDestinationSku('MBM-THI-0001', 'store_ruiru');
    const b = deriveTransferDestinationSku('MBM-THI-0001', 'store_ruiru');
    expect(a).toBe(b);
  });

  it('differs per destination store', () => {
    expect(deriveTransferDestinationSku('S', 'store_nakuru')).not.toBe(deriveTransferDestinationSku('S', 'store_ruiru'));
  });

  it('returns null when origin SKU is missing', () => {
    expect(deriveTransferDestinationSku(null, 'store_nakuru')).toBeNull();
    expect(deriveTransferDestinationSku('', 'store_nakuru')).toBeNull();
    expect(deriveTransferDestinationSku('S', '')).toBeNull();
  });
});
