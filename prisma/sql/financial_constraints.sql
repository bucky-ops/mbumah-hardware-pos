-- ═══════════════════════════════════════════════════════════════════════════════
-- MBUMAH HARDWARE POS — Financial Integrity Constraints (PostgreSQL DDL)
--
-- AUDIT REFERENCE: FINANCIAL_MODULE_AUDIT_REPORT.md
--   • Stock non-negativity  — R1/R5 (oversell & double-credit race atlas)
--   • Journal line hygiene  — SYS ledger cross-cutting (single-sided lines)
--   • Per-entry balance     — Trial-balance drift (debit == credit per entry)
--
-- WHY NOT VALID
--   Every CHECK constraint below is added with `NOT VALID`:
--     • The constraint IS enforced for all INSERT/UPDATE statements from the
--       moment it is created (new rows can no longer violate it).
--     • Existing rows are NOT scanned, so the ALTER TABLE takes a moment
--       instead of a full-table lock — critical because prod already contains
--       rows that may pre-date these guarantees (e.g. seeded opening stock
--       balances, legacy journal lines).
--   After cleaning up any pre-existing violations, tighten to fully validated
--   with:
--       ALTER TABLE products VALIDATE CONSTRAINT chk_products_stock_nonneg;
--   (see scripts/apply-prod-constraints.md for the full runbook)
--
-- HOW TO RUN
--   psql "$DIRECT_URL" -f prisma/sql/financial_constraints.sql
--   ($DIRECT_URL = Neon direct (non-pooled) connection string — DDL must not
--   go through PgBouncer.)
--
-- IDEMPOTENCE
--   Safe to re-run: constraint additions are wrapped in DO $$ blocks that
--   check pg_constraint, and the trigger uses DROP TRIGGER IF EXISTS.
--
-- NOTE: this file is also appended to
--   prisma/migrations/20260904120000_financial_baseline/migration.sql
-- so freshly-provisioned databases (prisma migrate deploy) get the same
-- guarantees automatically.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Stock non-negativity
--    Product.quantityInStock, WarehouseStock.quantity, Inventory.quantityInStock,
--    Batch.quantity must never go negative. Application-level guards exist
--    (conditional updateMany decrements); these constraints are the hard
--    backstop that turns any residual race into a loud DB error, not silent
--    negative stock.
--    Table names verified against prisma/schema.prisma @@map values:
--      Product → products, WarehouseStock → warehouse_stocks,
--      Inventory → inventories, Batch → batches.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_products_stock_nonneg') THEN
    ALTER TABLE products
      ADD CONSTRAINT chk_products_stock_nonneg
      CHECK ("quantityInStock" >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'warehouse_stocks')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_warehouse_stocks_qty_nonneg') THEN
    ALTER TABLE warehouse_stocks
      ADD CONSTRAINT chk_warehouse_stocks_qty_nonneg
      CHECK ("quantity" >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'inventories')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_inventories_stock_nonneg') THEN
    ALTER TABLE inventories
      ADD CONSTRAINT chk_inventories_stock_nonneg
      CHECK ("quantityInStock" >= 0) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'batches')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_batches_qty_nonneg') THEN
    ALTER TABLE batches
      ADD CONSTRAINT chk_batches_qty_nonneg
      CHECK ("quantity" >= 0) NOT VALID;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Journal entry line hygiene
--    • chk_je_line_single_side — a line is EITHER a debit OR a credit
--      (double-entry 101: a row carrying both is meaningless and breaks
--      account-balance derivations).
--    • chk_je_line_nonneg — amounts are never negative; direction is encoded
--      by which column is non-zero, not by sign flips.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entry_lines')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_je_line_single_side') THEN
    ALTER TABLE journal_entry_lines
      ADD CONSTRAINT chk_je_line_single_side
      CHECK ((debit = 0) OR (credit = 0)) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'journal_entry_lines')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_je_line_nonneg') THEN
    ALTER TABLE journal_entry_lines
      ADD CONSTRAINT chk_je_line_nonneg
      CHECK (debit >= 0 AND credit >= 0) NOT VALID;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Per-entry balance trigger (DEFERRABLE INITIALLY DEFERRED)
--    After any row-level INSERT/UPDATE on journal_entry_lines, the WHOLE
--    parent entry is re-summed and must balance within 0.01. Because the
--    trigger is DEFERRABLE INITIALLY DEFERRED, the check fires at COMMIT —
--    so a multi-line entry created inside one transaction (the only sanctioned
--    way lines are written) is validated once, complete, never mid-flight.
--    A partial write that commits unbalanced raises UNBALANCED_JOURNAL_ENTRY
--    and rolls the transaction back.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_assert_je_entry_balanced()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id text;
  v_debit    numeric;
  v_credit   numeric;
BEGIN
  v_entry_id := COALESCE(NEW."journalEntryId", OLD."journalEntryId");

  SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0)
    INTO v_debit, v_credit
    FROM journal_entry_lines
   WHERE "journalEntryId" = v_entry_id;

  IF ABS(v_debit - v_credit) > 0.01 THEN
    RAISE EXCEPTION 'UNBALANCED_JOURNAL_ENTRY: journal entry % has total debit % vs total credit % (tolerance 0.01)',
      v_entry_id, v_debit, v_credit;
  END IF;

  RETURN NULL; -- AFTER trigger; return value ignored
END;
$$;

DROP TRIGGER IF EXISTS trg_je_entry_balanced ON journal_entry_lines;

CREATE CONSTRAINT TRIGGER trg_je_entry_balanced
  AFTER INSERT OR UPDATE ON journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION fn_assert_je_entry_balanced();
