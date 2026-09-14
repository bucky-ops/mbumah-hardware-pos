-- ═══════════════════════════════════════════════════════════════════════════════
-- MBUMAH HARDWARE POS — PostgreSQL Row-Level Security (staged, v2.6.0)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- WHY
--   Today tenancy is enforced at the APPLICATION layer only: src/lib/db.ts
--   $extends interceptors AND `storeId = <session store>` into every Prisma
--   query (injectTenant). That is strong, but it is one bug away from failure:
--   a single `db.$queryRaw`, a native findUnique by bare id, or a future
--   codepath that forgets the tenant context can leak branch data across the
--   5-store boundary (the IDOR fixed in the debt-plan audit was exactly this
--   class of bug — caught at Layer 4, but nothing would have stopped it at the
--   database). RLS pushes the SAME rule into the ENGINE: even a forgotten
--   WHERE clause cannot return another store's rows.
--
-- STATUS: ⚠️  STAGED — NOT APPLIED BY ANY AUTOMATION.
--   This file is executed MANUALLY by a DBA as Phase 3 of the rollout below.
--   Applying policies alone is SAFE but INERT while the app connects as the
--   table owner (Postgres bypasses RLS for owners unless FORCE is set) —
--   which is also why merging this file cannot break production.
--
-- ── ROLLOUT (4 phases) ────────────────────────────────────────────────────────
--   Phase 1 (app): Prisma must set the store context per transaction. Add to
--     src/lib/db.ts a helper and use it for tenant-scoped work:
--
--       export async function withTenantRls<T>(storeId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>) {
--         return db.$transaction(async (tx) => {
--           await tx.$executeRaw`SELECT set_config('app.current_store_id', ${storeId}, true)`; // true = transaction-local
--           return fn(tx);
--         });
--       }
--
--   Phase 2 (db): create a NON-OWNER application role and move the app onto it
--     (owners/superusers bypass RLS even with FORCE):
--
--       CREATE ROLE mbumah_app LOGIN PASSWORD '<from vault>';
--       GRANT CONNECT ON DATABASE <db> TO mbumah_app;
--       GRANT USAGE ON SCHEMA public TO mbumah_app;
--       GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mbumah_app;
--       ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mbumah_app;
--       -- Then rotate DATABASE_URL (Neon) to the mbumah_app role + pooler host.
--
--   Phase 3 (db): run THIS FILE (idempotent). It enables RLS + creates the
--     `store_isolation` policy on every store-scoped table.
--
--   Phase 4 (db): after a soak period, escalate to FORCE ROW LEVEL SECURITY so
--     even the table owner is subject to policies:
--       ALTER TABLE products FORCE ROW LEVEL SECURITY;  -- per table
--     Verify with: SET app.current_store_id = 'store_juja_main'; SELECT count(*) FROM customers;
--
-- EXCLUSIONS (deliberately NOT protected here — see notes inline):
--   users / sessions          — auth must resolve any login by email globally;
--                               role checks + withSessionAuth are the boundary.
--   system_logs / security_events / audit_logs — org-level visibility for
--                               admins; audit_logs.storeId is nullable by design.
--   kra_business_profiles     — org-level configuration.
--   conversations / notifications / debt_reminders — cross-store composition
--                               (org-wide sweeps, owner dashboards); revisit in
--                               a dedicated pass if per-store chat isolation is
--                               ever required.
--
-- SESSION VARIABLE
--   Policies read current_setting('app.current_store_id', true) — the `true`
--   makes it return NULL (⇒ zero rows) instead of erroring when unset, so a
--   connection that skipped set_config fails CLOSED. Store ids in this system
--   are plain strings (e.g. 'store_juja_main'), not UUIDs.
--
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Core commerce ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    -- core commerce
    'product_categories', 'products', 'warehouse_stocks', 'stock_movements',
    'product_variants', 'bin_locations', 'serial_numbers', 'batches',
    'customers', 'customer_credits', 'customer_interactions',
    'sales_transactions', 'payments', 'mpesa_transactions', 'receipts',
    'debt_ledgers', 'debt_payments', 'debt_payment_plans',
    'equipment_rentals', 'invoices', 'gift_cards',
    -- operations
    'suppliers', 'purchase_orders', 'expenses', 'shifts', 'shift_schedules',
    'cash_drawer_logs', 'inventory',
    -- accounting & finance
    'journal_entries', 'financial_periods', 'trial_balance_snapshots',
    'budgets', 'tax_categories', 'tax_filings',
    -- loyalty, messaging, banking, HR
    'loyalty_tiers', 'loyalty_campaigns', 'loyalty_transactions',
    'bank_accounts', 'vouchers', 'voucher_campaigns',
    'employees', 'payroll_periods', 'payroll_runs', 'payroll_details',
    'leave_requests', 'attendance_records',
    -- async queues scoped per store
    'outbox_events', 'kra_submissions', 'invoices_for_kra'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Skip gracefully if a table does not exist in this environment yet.
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                   WHERE table_schema = 'public' AND table_name = t) THEN
      RAISE NOTICE 'skip % (missing)', t;
      CONTINUE;
    END IF;
    -- Skip if the table has no store_id column (schema drift guard).
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = t
                     AND column_name = 'store_id') THEN
      RAISE NOTICE 'skip % (no store_id)', t;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    -- Idempotent policy creation (Postgres has no CREATE POLICY IF NOT EXISTS).
    IF NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = t
                     AND policyname = 'store_isolation') THEN
      EXECUTE format(
        'CREATE POLICY store_isolation ON public.%I USING (store_id = current_setting(''app.current_store_id'', true));',
        t);
    END IF;

    RAISE NOTICE 'RLS enabled + policy on %', t;
  END LOOP;
END $$;

COMMIT;

-- ── Verification queries (run AFTER Phase 2/3) ────────────────────────────────
-- 1) Policies present:
--    SELECT tablename, policyname FROM pg_policies WHERE policyname='store_isolation' ORDER BY tablename;
-- 2) Fail-closed behaviour (as mbumah_app, no session var set):
--    SET app.current_store_id = '';  -- never set
--    SELECT count(*) FROM customers; -- expect 0 rows visible
-- 3) Correct scoping:
--    SELECT set_config('app.current_store_id', 'store_juja_main', false);
--    SELECT count(*) FROM customers; -- expect only juja rows
-- 4) Cross-store leak attempt:
--    SELECT count(*) FROM customers WHERE store_id <> current_setting('app.current_store_id'); -- expect 0
