// PRODUCT IMAGE RESOLVER (v2.5.2) — "every product shows a realistic image,
// and a similar icon appears when the exact photo is missing."
//
// Resolution chain (cheapest → richest):
//   1. the product's own `imageUrl` (real photo, usually CDN-hosted),
//   2. a canonical category icon from /public/categories (ships with the
//      app, tiny PNG, always renders — even offline),
//   3. UI-level letter/box fallback (ProductImage component).
//
// Shared by:
//   • POST /api/products  — assigns the category icon as the default image
//     so a NEW product immediately shows a matching picture,
//   • <ProductImage />    — client fallback when a photo 404s (broken links
//     never show as broken-image icons).

/** Canonical category id → bundled icon (public/categories/*.png). */
export const CATEGORY_IMAGE_BY_ID: Record<string, string> = {
  cat_cement: '/categories/cat_cement.png',
  cat_iron_sheets: '/categories/cat_iron.png',
  cat_paints: '/categories/cat_paints.png',
  cat_iron_bars: '/categories/cat_rebar.png',
  cat_wheelbarrows: '/categories/cat_wheelbarrow.png',
  cat_mesh_wires: '/categories/cat_mesh.png',
  cat_tools: '/categories/cat_tools.png',
  cat_plumbing: '/categories/cat_plumbing.png',
  cat_electrical: '/categories/cat_electrical.png',
  cat_nails_screws: '/categories/cat_nails.png',
};

/** Keyword → icon for custom/named categories (first match wins). */
const CATEGORY_IMAGE_BY_KEYWORD: Array<{ re: RegExp; image: string }> = [
  { re: /cement|concrete|building/i, image: '/categories/cat_cement.png' },
  { re: /iron\s*sheet|roof/i, image: '/categories/cat_iron.png' },
  { re: /paint|finish|varnish|brush/i, image: '/categories/cat_paints.png' },
  { re: /rebar|steel|deformed|bar\b/i, image: '/categories/cat_rebar.png' },
  { re: /wheelbarrow|cart|trolley/i, image: '/categories/cat_wheelbarrow.png' },
  { re: /mesh|wire|binding/i, image: '/categories/cat_mesh.png' },
  { re: /tool|equipment|hardware|machine/i, image: '/categories/cat_tools.png' },
  { re: /plumb|pvc|pipe|fitt/i, image: '/categories/cat_plumbing.png' },
  { re: /electric|bulb|cable|socket|switch/i, image: '/categories/cat_electrical.png' },
  { re: /nail|screw|fasten|hammer/i, image: '/categories/cat_nails.png' },
];

/**
 * PRODUCT PHOTO LIBRARY (v2.5.2) — realistic generated studio shots shipped
 * with the app (public/products/*.jpg, 40-160KB each, ~1.3MB total). Matched
 * against the PRODUCT NAME so every store's products — and any product added
 * in the future — automatically show the right photo without a data migration.
 * The category icon below remains the fallback for everything else.
 */
export const PRODUCT_PHOTO_BY_KEYWORD: Array<{ re: RegExp; image: string }> = [
  { re: /cement/i, image: '/products/cement-50kg.jpg' },
  { re: /ballast|river\s*sand|machine\s*cut\s*stone/i, image: '/products/cement-50kg.jpg' },
  { re: /\bnails?\b|wood\s*screws?|hoop\s*iron/i, image: '/products/nails-2inch.jpg' },
  { re: /mabati|roofing\s*sheet|iron\s*sheet|galvanized/i, image: '/products/mabati-sheet.jpg' },
  { re: /\bpaint\b|dulux|duracoat|crown\s*vinyl|silk\s*20l|membrane/i, image: '/products/paint-20l.jpg' },
  { re: /rebar|\by\d+\b|deformed|round\s*bar|steel\s*bar/i, image: '/products/rebar-bundle.jpg' },
  { re: /wheelbarrow/i, image: '/products/wheelbarrow.jpg' },
  { re: /pvc|ppr|pipe|elbow|tap\b|waste\s*pipe/i, image: '/products/pvc-pipe.jpg' },
  { re: /drill|impact\s*wrench|rotary\s*hammer|hammer\s*drill/i, image: '/products/power-drill.jpg' },
  { re: /grinder|circular\s*saw|jig\s*saw|saw\b/i, image: '/products/angle-grinder.jpg' },
  { re: /hammer(?!.*drill)|wrench|spanner|screwdriver|pliers|tape\s*measure|spirit\s*level|utility\s*knife|putty\s*knife|spade|pickaxe/i, image: '/products/claw-hammer.jpg' },
  { re: /led\s*bulb|flood\s*light|bulb\b/i, image: '/products/led-bulb.jpg' },
  { re: /cable|wire\b(?!.*mesh)/i, image: '/products/cable-roll.jpg' },
  { re: /water\s*tank/i, image: '/products/water-tank.jpg' },
  { re: /timber|plywood|gypsum/i, image: '/products/timber-plank.jpg' },
  { re: /generator|pressure\s*washer|compactor|mixer(?!.*tap)|poker|tile\s*cutter/i, image: '/products/power-drill.jpg' },
  { re: /safety\s*boots|helmet|hard\s*hat/i, image: '/products/claw-hammer.jpg' },
];

/**
 * Best icon for a category — by exact id first, then by name keywords.
 * Returns null when nothing matches (UI falls back to a letter tile).
 */
export function deriveCategoryIcon(
  categoryId?: string | null,
  categoryName?: string | null
): string | null {
  if (categoryId && CATEGORY_IMAGE_BY_ID[categoryId]) return CATEGORY_IMAGE_BY_ID[categoryId];
  if (categoryName) {
    for (const { re, image } of CATEGORY_IMAGE_BY_KEYWORD) {
      if (re.test(categoryName)) return image;
    }
  }
  return null;
}

/**
 * Best photo for a PRODUCT — the full resolution chain:
 *   explicit photo URL → name-keyword studio shot → category icon → null.
 * Pure & isomorphic (no window access) — safe on the server and in tests.
 */
export function resolveProductImage(
  imageUrl?: string | null,
  categoryId?: string | null,
  categoryName?: string | null,
  productName?: string | null
): string | null {
  const url = imageUrl?.trim();
  if (url) return url;
  if (productName) {
    for (const { re, image } of PRODUCT_PHOTO_BY_KEYWORD) {
      if (re.test(productName)) return image;
    }
  }
  return deriveCategoryIcon(categoryId, categoryName);
}
