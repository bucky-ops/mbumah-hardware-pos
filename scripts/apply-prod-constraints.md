# Applying Financial Integrity Constraints to Production (Neon)

**Audit reference:** `FINANCIAL_MODULE_AUDIT_REPORT.md` — hard DB guarantees for
stock non-negativity, single-sided journal lines, and per-entry debit = credit.

**DDL source of truth:** [`prisma/sql/financial_constraints.sql`](../sql/financial_constraints.sql)
(the same statements are appended to
`prisma/migrations/20260904120000_financial_baseline/migration.sql` so fresh
databases get them automatically via `prisma migrate deploy`).

---

## Why `NOT VALID`

Every `CHECK` constraint is added with `NOT VALID`:

- **Enforced immediately for new writes** — from the moment the `ALTER TABLE`
  commits, any `INSERT`/`UPDATE` that would violate the constraint fails.
- **Existing rows are not scanned** — PostgreSQL skips validation of rows that
  already exist. This avoids a full-table scan and a long `ACCESS EXCLUSIVE`
  lock at apply time, which matters because production already contains rows
  that may pre-date these guarantees (seeded opening stock balances, legacy
  journal lines from before the posting-remediation work).

Running without `NOT VALID` (i.e. a validating `ADD CONSTRAINT`) on a table
with existing violations — or even on a large clean table — would block all
reads and writes for the duration of the scan.

## Apply commands

Run from a machine with `psql` and the **direct** (non-pooled) Neon connection
string. DDL must not go through PgBouncer:

```bash
# 0. (Recommended) cap runaway statements so a surprise scan can't hold locks
psql "$DIRECT_URL" -c "ALTER ROLE neondb_owner SET statement_timeout = '30s';"

# 1. Apply the constraints (idempotent — safe to re-run)
psql "$DIRECT_URL" -f prisma/sql/financial_constraints.sql
```

> `ALTER ROLE ... SET statement_timeout = '30s'` sets a session default for the
> role; individual sessions can override with `SET statement_timeout`.
> Override deliberately for long maintenance jobs, keep the default tight for
> app traffic.

## Extensions

```bash
psql "$DIRECT_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

> **Caution:** `pg_stat_statements` may require a Neon support toggle /
> shared_preload_libraries change that free-tier projects cannot self-serve.
> If `CREATE EXTENSION` fails with `must be superuser` or
> `shared_preload_libraries`, open a Neon support request instead of trying to
> work around it. It is an observability nice-to-have, not a dependency of the
> constraints above.

## Post-cleanup: tighten to fully validated

`NOT VALID` constraints only protect *new* rows. After cleaning up any
pre-existing violations, re-validate each constraint (this takes a
`SHARE UPDATE EXCLUSIVE` lock — brief, does not block reads/writes except
other DDL):

```bash
# Find violating rows first (should return zero rows after cleanup):
psql "$DIRECT_URL" -c "SELECT id, sku, \"quantityInStock\" FROM products WHERE \"quantityInStock\" < 0;"
psql "$DIRECT_URL" -c "SELECT id, \"journalEntryId\" FROM journal_entry_lines WHERE debit < 0 OR credit < 0 OR (debit <> 0 AND credit <> 0);"
psql "$DIRECT_URL" -c "SELECT \"journalEntryId\", SUM(debit) AS d, SUM(credit) AS c FROM journal_entry_lines GROUP BY 1 HAVING ABS(SUM(debit) - SUM(credit)) > 0.01;"

# Then validate:
psql "$DIRECT_URL" -c "ALTER TABLE products VALIDATE CONSTRAINT chk_products_stock_nonneg;"
psql "$DIRECT_URL" -c "ALTER TABLE warehouse_stocks VALIDATE CONSTRAINT chk_warehouse_stocks_qty_nonneg;"
psql "$DIRECT_URL" -c "ALTER TABLE inventories VALIDATE CONSTRAINT chk_inventories_stock_nonneg;"
psql "$DIRECT_URL" -c "ALTER TABLE batches VALIDATE CONSTRAINT chk_batches_qty_nonneg;"
psql "$DIRECT_URL" -c "ALTER TABLE journal_entry_lines VALIDATE CONSTRAINT chk_je_line_single_side;"
psql "$DIRECT_URL" -c "ALTER TABLE journal_entry_lines VALIDATE CONSTRAINT chk_je_line_nonneg;"
```

The deferred trigger `trg_je_entry_balanced` is active from creation (no
`NOT VALID` concept applies to triggers); every new transaction writing
journal lines commits only if the entry balances within 0.01, otherwise it
fails with `UNBALANCED_JOURNAL_ENTRY`.

## Verification

```bash
# Constraints present (6 rows expected after apply):
psql "$DIRECT_URL" -c "SELECT conname, convalidated FROM pg_constraint WHERE conname LIKE 'chk\\_je%' OR conname LIKE 'chk\\_products%' OR conname LIKE 'chk\\_warehouse%' OR conname LIKE 'chk\\_inventories%' OR conname LIKE 'chk\\_batches%';"

# Trigger present:
psql "$DIRECT_URL" -c "SELECT tgname, tgdeferrable, tginitdeferred FROM pg_trigger WHERE tgname = 'trg_je_entry_balanced';"
```

`convalidated = false` is expected until the `VALIDATE CONSTRAINT` step above
has been run for each constraint.
