# Mbumah Hardware POS — Worklog

## Task 23 — Customer Credit Engine audit + build (agent: Z.ai Code main)

Task ID: 23
Agent: main (Principal Full-Stack Engineer / Database Architect / Cyber Security Lead)
Task: Review the customer module of https://github.com/bucky-ops/mbumah-hardware-pos, identify gaps, and build a comprehensive CUSTOMER CREDIT ENGINE (credit limit, outstanding, available credit, invoice history, due dates, days overdue, payment history, credit score, approved-by, reminders, suspended/active status, and "🔴 DO NOT EXTEND CREDIT" style status output).

Work Log:
- Cloned bucky-ops/mbumah-hardware-pos @ 485d016 into /tmp/mbumah-audit for read-only audit.
- Dispatched 3 parallel Explore agents:
  - Agent A (API layer): 9 customer-facing route files audited.
  - Agent B (debt engine): debt-helpers.ts, /api/debt, /api/debt-payment-plans, reminders, cron.
  - Agent C (UI layer): customers-tab, debt-management-tab, debt-plans, credits-tab, POS checkout.

Stage Summary (AUDIT FINDINGS — what EXISTS in the repo):
- ✅ Atomic credit-limit enforcement at checkout: `POST /api/transactions` uses conditional `updateMany({ where: { currentDebtBalance: { lte: headroom } } })` inside `$transaction` → TOCTOU-proof (transactions/route.ts:950-958).
- ✅ DebtLedger (amountOwed/amountPaid/balance/dueDate/agingBucket), DebtPayment with atomic `balance gte` claim.
- ✅ DebtPaymentPlan approval workflow: PENDING_APPROVAL → ACTIVE with approvedById + self-approval block 409.
- ✅ Reminder pipeline (schedule → process → Twilio SMS/WhatsApp/Resend email, env-gated simulation).
- ✅ Customer 360° history timeline (`/api/customers/[id]/history`, 7 parallel queries).

GAPS (what is MISSING — the exact request vs reality):
- ❌ Credit score (0–100): zero hits for creditScore/riskScore in entire src + schema.
- ❌ Approved-by for credit LIMIT changes: `PUT /api/customers/[id]` accepts raw debtLimit, no approval metadata, no old→new audit.
- ❌ Suspended/active CREDIT status: only boolean `isActive`; suspension never blocks credit sales.
- ❌ "DO NOT EXTEND CREDIT" verdict: zero hits anywhere.
- ❌ Days overdue: computed internally in calculateAgingBucket then DISCARDED; never exposed via API.
- ❌ `DebtLedger.status='OVERDUE'` is NEVER written but frontend queries it (messaging-tab.tsx:303, LowStockAlerts.tsx:46) → dead filter, always-empty results.
- ❌ agingBucket goes stale: only recomputed at payment time; no cron rolls buckets forward → by-bucket summaries misreport.
- ❌ No FIFO/oldest-first waterfall payment allocation (per-row only; overpay rejected 400).
- ❌ CustomerCredit ledger (store credit) disconnected from currentDebtBalance — never reconciled.
- ❌ BOLA hole: GET/POST /api/customers, /customers/top, /customer-credits, /customer-interactions use withSessionAuth + caller-supplied storeId → injectTenant skips injection (db.ts:582) → cross-store reads possible.
- ❌ No write-off endpoint (WRITTEN_OFF never written); lateFee/autoCharge dead fields; /api/reminders/debt/retry documented but missing; reminder pipeline has NO cron driver.
- ❌ UI dead code: stub "Send Reminder" toast, dead Active/Loyalty filter chips, Recent Transactions shows store-wide data (no customerId filter), credits-tab WhatsApp res.waLink vs res.data.waLink bug, dead filter toggle, no recharts aging chart.

DECISION: Sandbox at /home/z/my-project was RESET to base template (default Prisma User/Post schema, no worklog, git = single "Initial commit"). Therefore the credit engine is being implemented fresh in the sandbox as a verified reference implementation, with every file mapped to the GitHub repo's real paths for application upstream.

---
Task ID: 23 (completion record)
Agent: main
Task: Build + verify the comprehensive Customer Credit Engine (continued from audit baseline above).

Work Log:
- Implemented prisma/schema.prisma: Branch/User/Customer(creditLimit, outstanding, creditStatus, creditScore, riskBand, approvedBy*)/Invoice/InvoiceItem/Payment/CreditLedgerEntry/CreditLimitChange/PaymentReminder + indexes ([branchId,createdAt], [customerId,status], [dueDate,status]).
- Implemented src/lib/credit-engine.ts (pure domain): Decimal-exact money, Nairobi day-boundary daysOverdue, aging buckets (CURRENT/D1_30/D31_60/D61_90/D90_PLUS), credit score 0–100 (payment 35/aging 25/utilisation 20/tenure+volume 20), verdict engine (DO NOT EXTEND CREDIT → RESTRICTED → CAUTION → GOOD STANDING → NEW → STANDARD), formatCreditStatusCard (exact requested output), allocateWaterfall (oldest-due-first), computeInvoiceTotals (discount BEFORE 16% VAT).
- Implemented src/lib/credit-service.ts (aggregate assembly, score recompute, portfolio KPIs) + src/lib/api-helpers.ts (envelope, operator RBAC).
- API routes: /api/credit/overview, /api/customers (GET/POST), /api/customers/[id] (GET/PATCH), [id]/credit-limit (approval trail + exposure ack + self-approval block), [id]/credit-status (suspend/reinstate/default audited), [id]/repay (waterfall, conditional decrement), [id]/remind (throttled 6h, env-gated SIMULATED send), /api/invoices (3-layer gate L1 verdict override / L2 pre-check / L3 write-time conditional claim), /api/seed (9 customers, 34 invoices, all verdict classes), /api/users.
- UI: page.tsx shell (header, operator switcher, tabs, sticky footer), overview-tab (4 KPI cards, recharts aging bar + verdict donut, watchlist), customers-tab (search, verdict chips, utilisation table), customer-360-dialog (requested status card, metrics, 5 history tabs, audit notes), action-dialogs (payment with live waterfall preview; new sale with VAT breakdown + audited override), governance-dialogs (limit, status, remind, new customer).
- Seed: JOHN CONTRACTORS LTD 384,500/400,000 (96.1% util, 92,000 overdue 75d, score 31) → 🔴 DO NOT EXTEND CREDIT — matches the requested example exactly; + Kisii (DEFAULTED), Wanjiru (SUSPENDED), Otieno (98% util), Tumaini (RESTRICTED), Nairobi Skies (CAUTION), Kamau/Beth (GOOD/STANDARD), Kiprop (NEW).
- QA fixes found by agent-browser: (1) skeleton branch missing DialogTitle → a11y error; (2) shadcn sm:max-w-lg capping dialog widths → `!` overrides; (3) customers table horizontal scroll on mobile; (4) **L3 credit-gate predicate bug** — `outstanding lte headroom` should be `outstanding lte (limit − charge)` (caught via 409 CREDIT_LIMIT_RACE in browser flow, fixed + regression-tested: within-headroom 201, over-limit 422). NOTE: upstream repo checkout uses the same `lte headroom` shape (audit agent transcription) — flagged in CREDIT_ENGINE.md §8.
- Browser-verified flows: overview render, JOHN 360 (exact requested figures), waterfall payment (92,000 settled oldest invoice first → verdict auto-upgraded to STANDARD), credit-sale block + OWNER override with reason → INV issued, outstanding 392,620/available 7,380, VAT math live (3,500→560→4,060), mobile 390px, sticky footer, demo reseed.

Stage Summary:
- Deliverables: verified engine + UI at /, CREDIT_ENGINE.md docs, seed reproduces the exact requested status line.
- Key decisions: derived OVERDUE (never stale) instead of stored status; score cached but engine is single source of truth; approval trail immutable; override is MANAGER+ with mandatory documented reason.
- Risks/next: PII encryption for phone/KRA PIN; wire session auth in place of operatorId; upstream integration per CREDIT_ENGINE.md §8 mapping incl. the predicate fix; penalty/plan merge via same ledger.

---
