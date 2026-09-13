// PRODUCT CODE GENERATORS (v2.5.2)
//
// FEATURE: "when a category is selected, the SKU and barcode are
// automatically generated" — used by the Inventory and Catalog add-product
// forms (auto-fill on category change + manual re-generate buttons) and by
// the products API as a server-side fallback.
//
// Consistency rule: the SKU format mirrors the server-side generateSKU()
// in src/lib/helpers.ts (MBM-<BRANCH>-<CAT>-XXXX / MBM-<CAT>-XXXX), so a
// draft SKU shown in the form follows exactly the same shape the API would
// have produced.
//
// Barcodes are valid EAN-13 numbers with a GS1 Kenya (620) prefix. They are
// scanner-readable (checksum valid); registered GS1 numbers are only needed
// for retail partner networks — until then these stay unique inside MBUMAH.

/** Store code → branch SKU segment (same normalisation as the server). */
function normalizeBranchSegment(storeCode?: string | null): string | null {
  if (!storeCode) return null;
  const code = String(storeCode).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length >= 2 && code.length <= 6 ? code : null;
}

/** Category name → 3-letter SKU segment, identical to the API derivation. */
export function deriveCategoryCode(categoryName?: string | null): string {
  if (!categoryName) return 'GEN';
  return categoryName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'GEN';
}

/** Cryptographically-random 4-digit numeric suffix (crypto-safe in browsers). */
function random4Digits(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return String(buf[0] % 10000).padStart(4, '0');
  }
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

/**
 * Draft SKU: MBM-<BRANCH>-<CAT>-XXXX when a store code is known,
 * MBM-<CAT>-XXXX otherwise (matches server generateSKU output shape).
 */
export function generateSkuDraft(categoryName?: string | null, storeCode?: string | null): string {
  const cat = deriveCategoryCode(categoryName);
  const branch = normalizeBranchSegment(storeCode);
  return branch ? `MBM-${branch}-${cat}-${random4Digits()}` : `MBM-${cat}-${random4Digits()}`;
}

/** EAN-13 mod-10 check digit for the first 12 digits. */
export function ean13CheckDigit(first12: string): string {
  const digits = first12.split('').map(Number);
  let sum = 0;
  digits.forEach((d, i) => {
    // EAN-13 weighting: odd positions ×1, even positions ×3 (1-based).
    sum += i % 2 === 0 ? d : d * 3;
  });
  return String((10 - (sum % 10)) % 10);
}

/** Validate a full EAN-13 (13 digits, correct checksum). */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === code[12];
}

/**
 * Generate a unique-shaped internal EAN-13 barcode:
 *   620 (GS1 Kenya prefix) + 9 random digits + 1 check digit.
 * The caller (API/form) remains responsible for uniqueness checks against
 * the product table before persisting.
 */
export function generateEan13Barcode(): string {
  let body = '620';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(9);
    crypto.getRandomValues(buf);
    for (let i = 0; i < 9; i++) body += String(buf[i] % 10);
  } else {
    for (let i = 0; i < 9; i++) body += String(Math.floor(Math.random() * 10));
  }
  return body + ean13CheckDigit(body);
}
