-- v2.6.0 (hardware UoM conversion): Product.sellingUnit + Product.conversionFactor.
--
-- Stock (quantity_in_stock) is ALWAYS held in the product's BASE unit
-- (`unitType` — e.g. METER of PVC pipe, TON of cement). `sellingUnit` is what
-- the counter sells in (FOOT / BAG / ...); `conversionFactor` = how many BASE
-- units one SELLING unit contains (1 FOOT = 0.3048 METER, 1 BAG = 0.05 TON).
-- Checkout deducts quantity × conversionFactor from quantityInStock.
--
-- Nullable sellingUnit / default-1 factor keep every legacy product behaving
-- exactly as before (1 selling unit = 1 base unit). Idempotent (IF NOT EXISTS)
-- so the db-push fallback path can never conflict with this migration.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "sellingUnit" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "conversionFactor" DECIMAL(12,6) NOT NULL DEFAULT 1;
