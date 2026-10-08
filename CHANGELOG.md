# Changelog

All notable changes to Mbumah Hardware POS are documented in this file (Keep a Changelog format; versions follow package.json).

## [2.12.1] — hotfix

### Fixed
- **POS "per NULL" unit bug** — products saved with a NULL `unitType` (e.g. Bamburi Cement) rendered a dangling "per " on product cards and empty/"null" unit badges in the cart, catalog, inventory and POS views. All unit render sites now share one null-safe `unitLabel()` helper (`src/lib/units.ts`), with a `UNIT` fallback. Ships with an owner-run backfill script, `scripts/fix-null-units.ts` (cement/Bamburi → `BAG`, other NULL units → `PIECE`).
- **Product card badge overlap** — the top-left badge stack (NEW / RENTAL / BUNDLE / BEST SELLER / ON SALE) is capped at 55% width with per-badge truncation, and the top-right LOW STOCK / OUT OF STOCK badge at 42% with truncation, so they can no longer collide on narrow cards (both stay z-20; NEW badge rule unchanged).
- **FAB overlap on POS** — the floating home button is now hidden while the POS tab is active (it covered the checkout area on short viewports) and remains on every other tab.
- **Category chips scrollbar** — removed the `scrollbar-none` override so the existing slim `scrollbar-thin` scrollbar (6px, rounded, muted thumb, transparent track) is always visible; scroll behavior and arrows unchanged.
- **VAT labels marked "(incl.)"** — POS cart totals, last-sale receipt, checkout dialog and the printable receipt now read "VAT (16% incl.)" — an info-only clarification that prices are VAT-inclusive (KE default; VAT = Total × 0.16 / 1.16). No tax math was changed.
- **Stock counter unit** — product-card stock labels now carry a short unit suffix ("393 kg left", "12 bags left") via a shared `unitShort()` helper.
- **Duplicate nail images** — owner-run script `scripts/fix-duplicate-images.ts` clears `imageUrl` on duplicate nail product rows (one canonical image kept per size variant) so the grid falls back to category images.

### Notes
- Shift math fix, debt-crisis logic, low-stock counts, system-activity sanitization, alert dedup, and revenue-outlier handling shipped in v2.12.0 (PR #86).
