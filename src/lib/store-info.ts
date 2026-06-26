// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Store metadata (single source of truth)
// ─────────────────────────────────────────────────────────────────────────────
//
// Used by:
//   • src/app/page.tsx          — sidebar store selector + POS receipt header
//   • src/app/tabs/*-tab.tsx    — receipt printing, invoice headers, etc.
//
// Keeping this in one place ensures receipts always show the correct branch
// name, location, and phone — no more hardcoded "Juja, Kiambu County".
// ─────────────────────────────────────────────────────────────────────────────

export interface StoreInfo {
  id: string;
  shortName: string;
  name: string;
  location: string;
  phone: string;
  email?: string;
  taxPin?: string;
}

export const STORE_LIST: StoreInfo[] = [
  {
    id: 'store_juja_main',
    shortName: 'Juja Main',
    name: 'MBUMAH HARDWARE — Juja Main',
    location: 'Salama M-Store, Juja, Kiambu County',
    phone: '0795191909',
    email: 'juja@mbumahhardware.co.ke',
    taxPin: 'P051234567A',
  },
  {
    id: 'store_thika',
    shortName: 'Thika',
    name: 'MBUMAH HARDWARE — Thika',
    location: 'Thika Town Center, Kiambu County',
    phone: '0795191909',
    email: 'thika@mbumahhardware.co.ke',
    taxPin: 'P051234567B',
  },
  {
    id: 'store_ruiru',
    shortName: 'Ruiru',
    name: 'MBUMAH HARDWARE — Ruiru',
    location: 'Ruiru Town, Kiambu County',
    phone: '0795191909',
    email: 'ruiru@mbumahhardware.co.ke',
    taxPin: 'P051234567C',
  },
  {
    id: 'store_nairobi_cbd',
    shortName: 'Nairobi CBD',
    name: 'MBUMAH HARDWARE — Nairobi CBD',
    location: 'Kenyatta Avenue, Nairobi',
    phone: '0795191909',
    email: 'nairobi@mbumahhardware.co.ke',
    taxPin: 'P051234567D',
  },
  {
    id: 'store_nakuru',
    shortName: 'Nakuru',
    name: 'MBUMAH HARDWARE — Nakuru',
    location: 'Nakuru Town, Nakuru County',
    phone: '0795191909',
    email: 'nakuru@mbumahhardware.co.ke',
    taxPin: 'P051234567E',
  },
];

/** Company-wide branding constants (shown on every receipt/report). */
export const COMPANY = {
  legalName: 'MBUMAH HARDWARE',
  tagline: 'Hardware, Building Materials & Tools',
  phone: '0795191909',
  email: 'info@mbumahhardware.co.ke',
  website: 'www.mbumahhardware.co.ke',
  /** Relative path to the logo served from /public. */
  logoPath: '/logo.png',
} as const;

/**
 * Returns the StoreInfo for a given storeId, falling back to the Juja Main
 * branch (the org HQ) when the id is unknown.
 */
export function getStoreInfo(storeId: string | null | undefined): StoreInfo {
  return (
    STORE_LIST.find((s) => s.id === storeId) ||
    STORE_LIST.find((s) => s.id === 'store_juja_main') ||
    STORE_LIST[0]
  );
}

/**
 * Returns an absolute URL for the logo, suitable for embedding in a print
 * window or PDF (where relative paths may not resolve). Uses window.location.origin
 * when available, otherwise falls back to a relative path.
 */
export function getLogoUrl(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${COMPANY.logoPath}`;
  }
  return COMPANY.logoPath;
}
