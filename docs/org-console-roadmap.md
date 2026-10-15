# Organization console roadmap

This roadmap sequences the hardening and expansion of the existing
`/console` expert information system. The console shipped in v2.18.3 with
the Store Intelligence Matrix, Decision Support, Recent Activity, Global
Chat, Live Feed, and nine domain expert modules (Inventory, Debt/Mkopo,
Rentals, Financials, Suppliers, M-Pesa, eTIMS, Audit, System). Release
v2.18.4 added the expert information minimum: a role-gated diagnostics API
with per-branch reason codes and remediation, the per-branch Expert panel in
the Branches table, and the guarded branch slug repair (see
`docs/org-console-expert-information.md`).

The modules below were already rendered by the v2.18.3 console; the roadmap
sequences their upgrade from "live figures on panels" to "actionable expert
modules with safe write paths", one domain group per release, so each
release stays reviewable and reversible.

## v2.18.5: Inventory Expert and Debt Expert

- Inventory Expert: reorder recommendations from the real stock and sales
  tables, stocktake workflow entry points, dead-stock and fast-mover views.
  Every recommendation links to the existing inventory APIs; writes stay
  behind the established role gates and audit logging.
- Debt Expert: collection worklist from the debt ledger aging buckets,
  reminder scheduling on top of the existing DebtReminder model, payment
  plan suggestions that reuse the debt-payment-plans API.

## v2.18.6: Rentals, Financials, Suppliers experts

- Rentals Expert: overdue return workflows, deposit reconciliation,
  utilization views from the EquipmentRental model.
- Financials Expert: cash position, expense review, trial-balance drill-in
  building on the existing financial endpoints.
- Suppliers Expert: purchase-order follow-up, delivery performance from the
  purchase-order history, supplier scorecards.

## v2.18.7: M-Pesa, eTIMS, Audit, System experts

- M-Pesa Expert: pending and stale STK push queue with the existing query
  and reconciliation actions, receipt mismatch views.
- eTIMS Expert: transmission queue health, retry controls over the existing
  eTIMS service.
- Audit Expert: filtered audit trails across AuditLog and SystemLog with
  saved views for common investigations.
- System Expert: schema drift history, updater status, backup inventory,
  and the branch diagnostics from v2.18.4 embedded as the workspace section.

## v2.18.8: Decision Support Action Center

- A single ranked action queue merging the alert sources (low stock, overdue
  rentals, debt thresholds, M-Pesa mismatches, eTIMS backlog, supplier
  delays) with owner assignment and completion tracking. Actions stay
  suggestions until a user with the right role executes them through the
  existing domain APIs.

## v2.18.9: Operator experience groundwork

- Command palette and keyboard shortcuts for console navigation.
- Mini Kenya map for branch geography (positions derived from store
  locations; no tracking data).
- Notifications panel over the existing Notification model.
- Cart drawer parity for the console-triggered workflows.
- Internationalization groundwork (message extraction and a Kenya English
  plus Swahili starter catalog) without changing any business logic.

## Ground rules for every release in this sequence

- One shared database with the storeId discriminator; server-side
  validation of everything; the client is never trusted for storeId, host,
  or headers.
- Org-wide reads keep using the `runWithoutTenant` pattern; routes remain
  the authorization boundary.
- Mutations are confirm-gated, rate-limited, audited, and (where a local
  database is involved) backup-first. Production PostgreSQL changes go
  through Prisma migrations, never runtime writes (see
  `docs/database-migration-policy.md`).
- Status is conveyed by text; color never carries meaning alone. No
  decorative emojis.
- Every release keeps lint, typecheck, and the vitest baselines honest and
  documents the numbers.
