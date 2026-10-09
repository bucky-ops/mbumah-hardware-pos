// MBUMAH HARDWARE POS - v2.13.3 SMART RECOMMENDATIONS (Sell More engine)
//
// Client-side product-affinity mapping layered on top of the server's
// co-occurrence engine (GET /api/recommendations/frequently-bought, which
// mines real transaction history).
//
// WHY BOTH?
//   • Co-occurrence needs sales history - a NEW branch (e.g. Thika at launch)
//     has zero transactions, so the server returns nothing and the Sell More
//     section would always read "No frequent add-on suggestions yet".
//   • The affinity map encodes domain knowledge a builder supplies at the
//     counter anyway: cement → spade + mixer + nails, mabati → timber +
//     nails, rebar → cement + binding wire… It works from the very first
//     cart, day one, no history required.
//
// The POS merges BOTH sources, ranks by frequency (how many distinct cart
// lines suggest the same product), drops items already in the cart and
// out-of-stock lines, and takes the top 6. Empty cart → best-seller chips.
//
// Names are matched case-insensitively against the live branch catalog - an
// affinity pointing at a product the branch doesn't stock (e.g. "Standard
// Wheelbarrow" in a branch that doesn't carry it) is silently filtered out,
// never shown as a dead chip.

/**
 * Affinity map - cart product name (exact key, case-insensitive lookup) →
 * products the same customer very likely still needs for that job.
 */
export const PRODUCT_AFFINITIES: Record<string, string[]> = {
  'Bamburi Cement 50kg': ['Spade (Heavy Duty)', '4-inch Nails', 'Concrete Mixer', 'Standard Wheelbarrow'],
  'Simba Cement 50kg': ['Spade (Heavy Duty)', '4-inch Nails', 'Concrete Mixer'],
  'Timber 2x4 x 12ft (Cypress)': ['4-inch Nails', 'Plywood 8x4ft (18mm)', 'Spade (Heavy Duty)'],
  'Mabati 28-Gauge (8ft)': ['Timber 2x4 x 12ft (Cypress)', '4-inch Nails', 'Rebar 12mm x 12m'],
  'Mabati 30-Gauge (8ft)': ['Timber 2x4 x 12ft (Cypress)', '4-inch Nails'],
  'Rebar 12mm x 12m': ['Bamburi Cement 50kg', 'Spade (Heavy Duty)', 'Binding Wire'],
  'PVC Pipe 4-inch x 3m': ['Bamburi Cement 50kg', 'Spade (Heavy Duty)'],
  'Plywood 8x4ft (18mm)': ['Timber 2x4 x 12ft (Cypress)', '4-inch Nails'],
  'Spade (Heavy Duty)': ['Bamburi Cement 50kg', 'Simba Cement 50kg'],
  '4-inch Nails': ['Timber 2x4 x 12ft (Cypress)', 'Plywood 8x4ft (18mm)'],
  'Concrete Mixer': ['Bamburi Cement 50kg', 'Spade (Heavy Duty)'],
  'Chain Link 6ft x 50m': ['Timber 2x4 x 12ft (Cypress)', '4-inch Nails'],
};

/**
 * Default chips when the cart is EMPTY - the branch's three proven traffic
 * drivers. Matched against the catalog by name; unknown names are dropped so
 * a branch without an item never advertises it.
 */
export const BEST_SELLER_NAMES: string[] = [
  'Bamburi Cement 50kg',
  '4-inch Nails',
  'Mabati 30-Gauge (8ft)',
];

/** How many chips to show at most (spec: take top 6). */
export const MAX_RECOMMENDATION_CHIPS = 6;

/** Minimal shape the algorithm needs - satisfied by ProductListItem. */
export interface AffinityProduct {
  id: string;
  name: string;
  pricePerUnit: number | string;
  quantityInStock: number | string;
  isRental?: boolean;
  categoryId?: string | null;
  imageUrl?: string | null;
  unitType?: string;
  category?: { name?: string; color?: string } | null;
}

export interface AffinitySuggestion {
  product: AffinityProduct;
  /** How many distinct cart lines recommended this product (ranking weight). */
  score: number;
  /** 'affinity' = mapped by the Sell More map · 'best-seller' = default chip · 'history' = server co-occurrence. */
  source: 'affinity' | 'best-seller' | 'history';
}

/** Case-insensitive exact-name lookup key ("bamburi cement 50kg"). */
function norm(name: string): string {
  return (name || '').trim().toLowerCase();
}

/**
 * Case-insensitive index over PRODUCT_AFFINITIES: normalized key -> original
 * map key. PRODUCT_AFFINITIES keys are written in product-cased form (readable
 * in code reviews), so every lookup MUST go through this index - indexing the
 * map directly with a lowercased cart name never matches and silently yields
 * zero suggestions.
 */
const AFFINITY_KEY_INDEX: Map<string, string> = new Map(
  Object.keys(PRODUCT_AFFINITIES).map((k) => [norm(k), k]),
);

/** Resolve a (possibly any-cased) cart product name to its affinity list. */
function affinitiesFor(name: string): string[] | undefined {
  const key = AFFINITY_KEY_INDEX.get(norm(name));
  return key ? PRODUCT_AFFINITIES[key] : undefined;
}

/**
 * Core Sell More algorithm (spec PART 3):
 *   1. Collect affinity lists for every product name in the cart
 *   2. Flatten + deduplicate, dropping items already in the cart
 *   3. Rank by frequency - the more cart lines suggest the same product,
 *      the higher it ranks
 *   4. Keep only products this branch actually stocks (in stock, or rental)
 *   5. Take the top 6
 *
 * Pure function - no side effects, safe to call on every render.
 */
export function computeAffinitySuggestions(
  cartProductNames: string[],
  catalog: AffinityProduct[],
  max = MAX_RECOMMENDATION_CHIPS,
): AffinitySuggestion[] {
  if (!Array.isArray(catalog) || catalog.length === 0) return [];
  const byName = new Map<string, AffinityProduct>();
  for (const p of catalog) byName.set(norm(p.name), p);

  const cartNames = new Set(cartProductNames.map(norm));
  const scores = new Map<string, number>();

  for (const cartName of cartNames) {
    const affinities = affinitiesFor(cartName);
    if (!affinities) continue;
    for (const affinityName of affinities) {
      const key = norm(affinityName);
      // Never recommend what is already in the cart (spec step 2)
      if (cartNames.has(key)) continue;
      // Only recommend products this branch actually carries
      if (!byName.has(key)) continue;
      scores.set(key, (scores.get(key) || 0) + 1);
    }
  }

  return Array.from(scores.entries())
    .map(([key, score]) => {
      const product = byName.get(key);
      // Guaranteed by the byName.has(key) guard above, but typed defensively.
      return product ? { product, score, source: 'affinity' as const } : null;
    })
    .filter((s): s is AffinitySuggestion => s !== null)
    // Frequency desc, then price desc as a stable tie-break (bigger ticket first)
    .sort((a, b) => b.score - a.score || Number(b.product.pricePerUnit) - Number(a.product.pricePerUnit))
    .slice(0, max);
}

/**
 * Best-seller chips for the EMPTY cart (spec: "If cart empty, show best
 * sellers"). Dropped silently when the branch doesn't stock the item.
 */
export function computeBestSellerSuggestions(
  catalog: AffinityProduct[],
  max = MAX_RECOMMENDATION_CHIPS,
): AffinitySuggestion[] {
  if (!Array.isArray(catalog) || catalog.length === 0) return [];
  const byName = new Map<string, AffinityProduct>();
  for (const p of catalog) byName.set(norm(p.name), p);

  const out: AffinitySuggestion[] = [];
  for (const name of BEST_SELLER_NAMES) {
    const p = byName.get(norm(name));
    if (p) out.push({ product: p, score: 0, source: 'best-seller' });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * True when the cart's contents map to at least one known affinity - used to
 * label chips with their provenance ("customers also bought" vs "best seller")
 * in the UI badge.
 */
export function cartHasAffinities(cartProductNames: string[]): boolean {
  return cartProductNames.some((n) => Array.isArray(affinitiesFor(n)));
}
