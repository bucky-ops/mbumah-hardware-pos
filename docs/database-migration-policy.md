# Database migration policy

This repository supports two deployment modes with one schema source
(`prisma/schema.prisma`, PostgreSQL-canonical): a local desktop mode on
SQLite and a production mode on PostgreSQL. This policy states which
database change paths are allowed in each mode, in what order, and what must
never happen. It closes audit Finding 25 (migration policy documentation).

## Local SQLite (self-hosted laptop, nodocker, development)

The local database is created and converged with declarative tooling. The
allowed sequence for a schema-affecting change is:

1. Preflight: `npm run db:preflight` (scripts/preflight-schema.mjs) checks
   the current database state against the schema before anything runs.
2. Backup: `npm run db:backup` (scripts/backup-db.mjs) copies the database
   file (plus its WAL and SHM sidecars) into a timestamped backup under the
   database directory, keeps the newest 20 by default, and verifies the copy
   is non-empty. Backup first is mandatory: every repair script below either
   runs this backup itself or requires a fresh one.
3. Push or additive repair:
   - `npm run db:push` (scripts/ensure-schema.mjs) is allowed locally: it
     applies the declarative schema with the provider resolved for the local
     environment.
   - When a push is not possible on an older database (missing columns that
     newer code expects), use the additive repair scripts: `npm run db:repair`
     (scripts/repair-db.mjs, backup plus safe additive converge plus
     verification), `npm run db:repair-workspace`
     (scripts/repair-branch-workspace-store-schema.mjs, raw additive SQL for
     the branch workspace columns), and `npm run db:repair-branch-managers`
     (scripts/repair-branch-manager-schema.mjs, for the user store binding
     columns). All of them are additive only, refuse destructive changes,
     and are idempotent no-ops on healthy databases.
4. Rollback: restore the newest backup created by scripts/backup-db.mjs (or
   a chosen timestamp) while the POS is stopped, then re-run
   `npm run db:verify`. The repair scripts automatically restore the backup
   they created when a step fails.

The v2.18.4 slug repair apply route (`POST /api/org/slug-repair/apply`)
follows this same policy at runtime: it refuses non-SQLite databases, runs
scripts/backup-db.mjs first, aborts when the backup fails, and only performs
additive row updates (filling empty slug and subdomain fields).

## Production PostgreSQL (Vercel, Neon, docker compose)

Production changes go through versioned Prisma migrations only:

- `npm run db:migrate:deploy` (scripts/setup-prisma-provider.mjs plus
  `prisma migrate deploy`) applies pending migrations. This is the only
  approved way to change a production schema.
- `prisma/migrations/` exists for this purpose and currently holds the
  financial baseline migration (20260904120000_financial_baseline) and the
  later migrations (plan approved-at, data export content, product UOM).
  New production schema changes must be added here as new migrations.
- Declarative `db:push`, raw-SQL repair scripts, and the slug repair route
  must never be pointed at a production database. The repair scripts and
  the slug repair route refuse PostgreSQL by design.

The updater must never run `prisma migrate deploy` against a production
database automatically. The staged updater (scripts/staged-update.mjs)
preflights the schema and activates a release only when the database can
serve it; when a migration is required, the updater stops and instructs the
operator to run the migration step themselves (or a migration-specific
guided step in a later release). An unattended schema migration against
production data is a data-loss class of failure and is out of scope for the
updater by policy.

## Versioning note

`prisma/schema.prisma` stays PostgreSQL-canonical in the repository. Local
tooling (scripts/setup-prisma-provider.mjs) may flip the provider to SQLite
for a local run; that flip is a working-tree convenience and must never be
committed. This is why release scripts run `git checkout --
prisma/schema.prisma` before staging commits.
