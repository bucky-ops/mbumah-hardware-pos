// MBUMAH HARDWARE POS - Store metadata (single source of truth)
//
// Used by:
//   • src/app/page.tsx - sidebar store selector + POS receipt header
//   • src/app/tabs/*-tab.tsx - receipt printing, invoice headers, etc.
//
// Keeping this in one place ensures receipts always show the correct branch
// name, location, and phone - no more hardcoded "Juja, Kiambu County".

export interface StoreInfo {
  id: string;
  /** Unique branch code (matches Store.code in the DB, e.g. "JUJ"). */
  code: string;
  shortName: string;
  name: string;
  location: string;
  phone: string;
  email?: string;
  taxPin?: string;
  // v2.16.0 (subdomain workspaces): path + subdomain workspace identifiers
  // and the branch accent color. Mirrors Store.slug / Store.subdomain /
  // Store.brandingColor in the DB (prisma/seed.ts keeps both in sync).
  slug: string;
  subdomain: string;
  brandingColor: string;
}

export const STORE_LIST: StoreInfo[] = [
  {
    id: 'store_juja_main',
    code: 'JUJ',
    shortName: 'Juja Main',
    name: 'MBUMAH HARDWARE - Juja Main',
    location: 'Salama M-Store, Juja, Kiambu County',
    phone: '0795191909',
    email: 'juja@mbumahhardware.co.ke',
    taxPin: 'P051234567A',
    slug: 'juja-main',
    subdomain: 'juja-main',
    brandingColor: '#B45309',
  },
  {
    id: 'store_thika',
    code: 'THI',
    shortName: 'Thika',
    name: 'MBUMAH HARDWARE - Thika',
    location: 'Thika Town Center, Kiambu County',
    phone: '0795191909',
    email: 'thika@mbumahhardware.co.ke',
    taxPin: 'P051234567B',
    slug: 'thika',
    subdomain: 'thika',
    brandingColor: '#047857',
  },
  {
    id: 'store_ruiru',
    code: 'RUI',
    shortName: 'Ruiru',
    name: 'MBUMAH HARDWARE - Ruiru',
    location: 'Ruiru Town, Kiambu County',
    phone: '0795191909',
    email: 'ruiru@mbumahhardware.co.ke',
    taxPin: 'P051234567C',
    slug: 'ruiru',
    subdomain: 'ruiru',
    brandingColor: '#9A3412',
  },
  {
    id: 'store_nairobi_cbd',
    code: 'NAI',
    shortName: 'Nairobi CBD',
    name: 'MBUMAH HARDWARE - Nairobi CBD',
    location: 'Kenyatta Avenue, Nairobi',
    phone: '0795191909',
    email: 'nairobi@mbumahhardware.co.ke',
    taxPin: 'P051234567D',
    slug: 'nairobi-cbd',
    subdomain: 'nairobi-cbd',
    brandingColor: '#B91C1C',
  },
  {
    id: 'store_nakuru',
    code: 'NAK',
    shortName: 'Nakuru',
    name: 'MBUMAH HARDWARE - Nakuru',
    location: 'Nakuru Town, Nakuru County',
    phone: '0795191909',
    email: 'nakuru@mbumahhardware.co.ke',
    taxPin: 'P051234567E',
    slug: 'nakuru',
    subdomain: 'nakuru',
    brandingColor: '#BE185D',
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
 * Workspace lookup by slug or subdomain (v2.16.0). Used by offline client
 * code that cannot call /api/stores; the server path always verifies against
 * the DB via /api/me/store-context.
 */
export function getStoreBySlug(slugOrSubdomain: string): StoreInfo | undefined {
  const needle = slugOrSubdomain.toLowerCase();
  return STORE_LIST.find((s) => s.slug === needle || s.subdomain === needle);
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
