# Database Evaluation & Population Plan — Mbumah Hardware POS

**Target:** production database behind `https://mbumah-hardware-pos-one.vercel.app` (Neon PostgreSQL, Prisma ORM, multi-tenant).
**Prepared:** 12 September 2026 · **Method:** populate through the application's own REST APIs (safe, keeps journals balanced, respects RBAC/multi-tenancy).

---

## 1. What we found when we evaluated the database

The database already contains **1 organization and 5 stores** (created by the original seed), so the top-level structure you asked for already exists:

| Store ID | Name | Location (from DB) |
|---|---|---|
| `store_juja_main` | MBUMAH HARDWARE - Juja Main | Salama M-Store, Juja |
| `store_nairobi_cbd` | MBUMAH HARDWARE - Nairobi CBD Branch | Kenyatta Avenue, Nairobi |
| `store_nakuru` | MBUMAH HARDWARE - Nakuru Branch | Nakuru Town, Nakuru County |
| `store_ruiru` | MBUMAH HARDWARE - Ruiru Branch | Ruiru Town, Kiambu County |
| `store_thika` | MBUMAH HARDWARE - Thika Branch | Thika Town, Kiambu County |

**Counts at the start of this exercise (verified live):**

| Data | Juja | Nairobi CBD | Nakuru | Ruiru | Thika | Total | Target | Gap to fill |
|---|---|---|---|---|---|---|---|---|
| Users | 8 | 2 | 3 | 2 | 2 | 17 | 50 | **+33** |
| Categories | 10 | 8 | 8 | 8 | 8 | 42 | 10 per store | **+8** (2 per younger store) |
| Products | 30 | 13 | 12 | 12 | 13 | 80 | 200 (40/store) | **+120** |
| Customers | 25 | 5 | 6 | 5 | 6 | 47 | 150 (30/store) | **+103** |
| Sales transactions | 34 | 6 | 5 | 5 | 7 | 57 | 300 (60/store) | **+243** |
| Suppliers | 4 | 2 | 2 | 2 | 2 | 12 | 15 (3/store) | **+4** |
| Purchase orders | 5 | 0 | 0 | 0 | 0 | 5 | 50 (10/store) | **+45** |
| Expenses | 6 | 2 | 2 | 2 | 2 | 14 | 100 (20/store) | **+86** |
| Debt ledgers | 13 | 1 | 2 | 0 | 2 | 18 | 100 (20/store) | **+82** |
| Equipment rentals | 4 | 0 | 0 | 0 | 0 | 4 | 50 (10/store) | **+46** |
| Employees | 2 | 0 | 0 | 0 | 0 | 2 | 25 (5/store) | **+23** |

So this exercise is a **top-up**: we keep every existing record (it is live, financially consistent data) and add exactly enough records so each store reaches its quota.

---

## 2. Schema structure (what each table stores, in plain English)

```
organizations (1 row: "Mbumah Hardware" — KRA PIN, status)
    └── stores (5 rows: name, location, address, phone, email, taxPin, status)
          ├── users            (login accounts: name, email, role, password, storeId)
          ├── product_categories (name, icon, color, sort order — per store)
          ├── products         (sku, barcode, name, description/specs, unit, stock,
          │                     cost price, selling price, VAT %, rental flag)
          ├── customers        (name, phone, email, ID number, debt limit, loyalty)
          ├── sales_transactions (receipt no, subtotal, VAT, discount, total,
          │     └── sale_items     payment method CASH/MPESA/DEBT/SPLIT, status)
          │                      (one row per product sold: qty, price, cost, line total)
          ├── payments         (one row per money movement on a sale)
          ├── debt_ledgers     (amount owed / paid / balance, due date, aging bucket)
          ├── equipment_rentals(secure deposit, rate per day/week/month, return dates)
          ├── suppliers        (name, contact person, phone, payment terms, rating)
          ├── purchase_orders  (po number, status workflow, totals)
          │     └── purchase_order_items (product, qty, unit cost, received qty)
          ├── expenses         (description, amount, category, paid by, method)
          └── employees        (first/last name, job title, hire date, salary,
                                statutory numbers NSSF/NHIF/KRA-PIN, bank details)
```

**Rules the schema enforces that our data must respect**

1. **Multi-tenancy:** almost every table has `storeId`; the API automatically stamps the right store. Users and employees belong to one store; one admin belongs to the organization.
2. **Roles (fixed list):** `SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER, CASHIER, ACCOUNTANT`. There is **no dedicated "inventory staff" role**, so inventory staff are modelled as `CASHIER` users whose employee profile carries the job title *Storekeeper / Inventory Clerk* (recommendation below).
3. **Employee roles (fixed list):** `STAFF, SUPERVISOR, MANAGER, CASHIER, ACCOUNTANT`.
4. **Unique values:** user emails (global), product SKUs (global), barcodes (global), PO numbers (per store), employee emails (per store). All generated data respects this.
5. **Money:** every amount is a decimal. Sales are created through the checkout API which, in one atomic step: creates the sale + items, deducts stock, writes the payment, creates the debt record (for DEBT sales), writes the receipt, and posts a **double-entry journal entry that must balance** (debits = credits) or the whole sale is rolled back.
6. **Stock guard:** checkout refuses a sale that would push a product's stock below zero.
7. **Credit guard:** a DEBT sale refuses if it would push the customer past their `debtLimit`.

---

## 3. Attribute definitions per requirement

### 3.1 Organization & 5 stores (requirement 1)
Already present (table in §1). Distinct attributes today: name, location, address, phone, email, KRA PIN.
> **Gap:** the schema has **no column for store size (m²) or operating hours**. Recommended follow-up: add `sizeSqm Int?` and `operatingHours String?` to `Store`, plus a `PUT /api/stores/[id]` endpoint. Until then we document the intended attributes here:
>
> | Store | Size | Hours | Distinct character |
> |---|---|---|---|
> | Juja Main (flagship) | 850 m², 2 floors | Mon–Sat 07:00–19:00, Sun 09:00–16:00 | Full catalogue, warehouse, rentals desk |
> | Nairobi CBD | 240 m² | Mon–Sat 07:30–19:30, Sun 09:00–17:00 | High foot traffic, fast movers only |
> | Nakuru | 420 m² | Mon–Sat 08:00–18:30, Sun 10:00–15:00 | Building materials focus |
> | Ruiru | 360 m² | Mon–Sat 07:30–18:30, Sun closed | Construction-site deliveries |
> | Thika | 380 m² | Mon–Sat 07:30–18:30, Sun 09:00–14:00 | Mixed trade + walk-in retail |

### 3.2 Users — 50 (requirement 2)
Distribution target 10 per store. Per store mix: 1 `STORE_OWNER`, 2 `BRANCH_MANAGER`, 1–2 inventory staff (`CASHIER` role + *Storekeeper* job title on their employee profile), remainder `CASHIER`. Realistic Kenyan names, unique emails `first.last.<store>@mbumahhardware.co.ke`, phones `07XX XXX XXX`, password `password123` (test data — document that production should force a change).

### 3.3 Categories — 10 (requirement 3)
Canonical list, created per store so each store owns its own catalogue tree:

1. Power Tools 2. Hand Tools 3. Building Materials 4. Electrical Supplies 5. Plumbing Supplies 6. Paint & Finishes 7. Hardware & Fasteners 8. Garden & Outdoor 9. Safety & Workwear 10. Home Appliances

Each carries an icon, a colour, a sort order and a one-line description.

### 3.4 Products — 200 (requirement 4)
40 per store, spread across the 10 categories (≈4 per category per store), generated from a 48-item template catalogue with **store-specific brand/model variations** so names differ store to store. Attributes per product: unique SKU (`MBM-<STORE>-<CAT>-<0001>`), EAN-style barcode, name, description with specs (voltage, wattage, dimensions, material…), unit type (PIECE/KILOGRAM/METER/LITER/BAG/BOX/SET), stock 12–160, reorder level, cost price ≈ 60–80 % of selling price, VAT 16 %, and 2–3 **rental-flagged** items per store (generators, concrete mixers, pressure washers…) to power requirement 11.

### 3.5 Customers — 150 (requirement 5)
30 per store. Kenyan names, phone, optional email, address (town/estate), National ID number, debt limit KES 20,000–80,000. Purchase history is produced automatically by linking customers to the sales in requirement 6 (each DEBT sale and ~50 % of paid sales carry a customerId).

### 3.6 Sales transactions — 300 (requirement 6)
60 per store, created through the real checkout API so stock, payments, receipts and journals all stay correct. Payment-method mix per store (chosen so the DEBT sales produce exactly the debt ledgers required by requirement 10):

| Store | CASH | MPESA | DEBT | SPLIT | New total |
|---|---|---|---|---|---|
| Juja Main | 11 | 5 | 7 | 3 | 26 (+34 existing → 60) |
| Nairobi CBD | 20 | 10 | 19 | 5 | 54 |
| Nakuru | 21 | 11 | 18 | 5 | 55 |
| Ruiru | 20 | 10 | 20 | 5 | 55 |
| Thika | 20 | 10 | 18 | 5 | 53 |

Basket realism: 1–4 lines per sale; quantities fit the category (40 bags of cement vs 1 drill); occasional 5–10 % discount; totals KES 300–120,000; cash sales round the tender to the next 50/100/200/500/1000 note. `SPLIT` = part cash + part M-Pesa.
> Note: the checkout API stamps `createdAt = now`, so new sales are all dated today. For time-spread analytics the dev team can run the backdating SQL in §6.

### 3.7 Suppliers — 15 (requirement 7)
3 per store (Juja already has 4). Each has contact person, phone, email, town, KRA PIN, payment terms (NET_15/NET_30/IMMEDIATE), 3–5 star rating and a note describing what they supply (cement & steel, paint, tools, electrical, plumbing, timber).

### 3.8 Purchase orders — 50 (requirement 8)
10 per store (Juja gets +5 to reach 10). Each PO: 2–5 of that store's products at realistic unit costs, quantity 10–100, expected date 1–3 weeks out, and a realistic **status spread** driven through the legal status workflow `DRAFT → PENDING_APPROVAL → APPROVED → SENT → CONFIRMED`: 2 DRAFT, 2 PENDING_APPROVAL, 2 APPROVED, 2 SENT, 2 CONFIRMED per store.

### 3.9 Expenses — 100 (requirement 9)
20 per store across the schema's categories `RENT, SALARIES, UTILITIES, TRANSPORT, MAINTENANCE, SUPPLIES, OTHER` with amounts scaled to Kenyan retail (rent 35–60 k, electricity 8–25 k, transport 2–8 k, maintenance 3–15 k…). Each expense posts a balanced journal entry (debit expense account, credit cash/M-Pesa) — handled by the API.

### 3.10 Debt ledgers — 100 (requirement 10)
Created the way the business actually creates them: by selling on credit. The 82 DEBT sales from §3.6 create 82 new ledgers (30-day due date, `OUTSTANDING`, aging `CURRENT`, customer balance incremented within credit limit) → 18 existing + 82 new = **100**.

### 3.11 Equipment rentals — 50 (requirement 11)
10 per store (Juja +6). Only `isRental` products (generators, mixers, pressure washers, scaffolding). Fields: security deposit ≈ 5× daily rate, daily/weekly/monthly rates, expected return date +3…+21 days (2 per store set in the past so the overdue workflow has data), and a couple of returns processed through the real return endpoint (`RETURNED` with damage assessment NONE/MINOR).

### 3.12 Employees — 25 (requirement 12)
5 per store (Juja +3). Full HR record: names, per-store-unique email, phone, National ID, KRA PIN, NSSF & NHIF/SHIF numbers, job title (Store Manager, Senior Cashier, Inventory Clerk/Storekeeper, Sales Assistant, Cleaner/Casual), employment type (PERMANENT/CONTRACT/CASUAL), hire dates 2019–2026, basic salary KES 15,000–95,000 plus house/transport/medical allowances, bank details (Equity/KCB/Co-op/NCBA) and emergency contact. Store managers are linked to their login account via `userId`.

---

## 4. Execution order (dependencies)

```
1. users ──► 2. categories ──► 3. products ──► 4. customers ──► 5. suppliers
                                                                    │
            ┌───────────────────────────────────────────────────────┘
            ▼
   6. sales (incl. 82 DEBT sales = debt ledgers)  ──► 7. purchase orders
            │                                                  │
            ▼                                                  ▼
   8. rentals (needs rental products + customers)   9. expenses (needs manager users)
            │
            ▼
   10. employees (links to users) ──► 11. verify counts + integrity
```

Scripts live in `scripts/populate/`:
- `mbumah_client.py` — authenticated API client (CSRF + Bearer, retries, re-login)
- `catalog.py` — canonical categories, product templates, name pools
- `populate.py` — phased population, resumable, per-store chunking
- `verify.py` — final counts vs targets + financial-integrity scan

Every step is idempotent-ish: names/emails/SKUs are checked against the store's existing data before posting, and a failed record is retried once; a duplicate returns HTTP 409 which we treat as success.

---

## 5. Data-quality guardrails honoured during population

1. Journals stay balanced — sales/expenses go through the app's own transactional writers only.
2. No product sells below zero stock; local stock ledger tracks every unit sold/rented.
3. No customer exceeds their credit limit; DEBT spread across many customers.
4. All money rounded to 2 dp before sending; totals = sum of lines.
5. RBAC respected — population runs as SUPER_ADMIN (the only role allowed to assign STORE_OWNER/ACCOUNTANT and approve POs).
6. Audit trail preserved — every API write logs `POPULATE_*` entries to `system_logs` with the actor.

---

## 6. Known gaps found during evaluation (recommendations)

1. **Sub-cent journal "dust" (pre-existing, now fixed in code):** the `/api/health` endpoint reported `unbalanced entries in last 24h` and `/api/financial/audit` flagged sale entries (e.g. JE-20260905-C63A5, JE-20260905-DB73A, JE-20260910-77C22, JE-20260912-58C5D). At 2 dp the debits and credits are identical (e.g. 94,025.00 = 94,025.00); the difference is decimal dust beyond 2 dp left by VAT extraction (revenue = total ÷ 1.16 produces repeating decimals stored at 30-dp column scale). **Fixes shipped with this population round:** ① every sale-journal line is now rounded to 2 dp before posting and any residual is absorbed into the tender leg so new entries balance exactly; ② the integrity auditors (`quickIntegrityCheck`, `verifyEntryBalance`) now compare at the currency's 2 dp scale so historical dust no longer produces false CRITICAL alarms. Optional one-time data cleanup (dev team, inside a transaction after backup): `UPDATE journal_entry_lines SET debit = ROUND(debit,2), credit = ROUND(credit,2) WHERE ROUND(debit,2) <> debit OR ROUND(credit,2) <> credit;` plus the matching header totals.
2. **No store size / operating-hours columns** (see §3.1) — recommend `sizeSqm`, `operatingHours` + `PUT /api/stores/[id]`.
3. **No inventory-staff RBAC role** — recommend adding `STOREKEEPER` to the role enum with products/stock permissions only.
4. **Checkout has no `date` field** — new sales are dated "now"; expenses/rentals likewise cannot be backdated via API. Recommend accepting an optional ISO `date` (SUPER_ADMIN only) or providing a DB-level seed script for historical data.
5. **Legacy categories coexist with the canonical 10** — every store now has the canonical 10 (Power Tools → Home Appliances). The 8–10 legacy names (Cement, Iron Sheets, Paints…) cannot be deleted because historical products reference them (the DELETE endpoint correctly refuses with 409). This is correct behaviour; the two taxonomies coexist.
6. **Default test password** — all populated users share `password123`; production should enforce first-login password rotation.

---

## 7. Final state after population (expected)

| Data | Juja | Nairobi CBD | Nakuru | Ruiru | Thika | Total |
|---|---|---|---|---|---|---|
| Users | 10 | 10 | 10 | 10 | 10 | **50** |
| Categories | 10 | 10 | 10 | 10 | 10 | **50 rows / 10 types** |
| Products | 40 | 40 | 40 | 40 | 40 | **200** |
| Customers | 30 | 30 | 30 | 30 | 30 | **150** |
| Sales | 60 | 60 | 60 | 60 | 60 | **300** |
| Suppliers | 4+ | 3 | 3 | 3 | 3 | **15+** |
| Purchase orders | 10 | 10 | 10 | 10 | 10 | **50** |
| Expenses | 20 | 20 | 20 | 20 | 20 | **100** |
| Debt ledgers | 20 | 20 | 20 | 20 | 20 | **100** |
| Rentals | 10 | 10 | 10 | 10 | 10 | **50** |
| Employees | 5 | 5 | 5 | 5 | 5 | **25** |
