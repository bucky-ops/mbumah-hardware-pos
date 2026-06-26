# 🔒 Security Policy

## ⚠️ TL;DR — Financial & M-Pesa vulnerabilities MUST be reported PRIVATELY

**Mbumah Hardware POS processes real money.** It handles M-Pesa (Safaricom Daraja) STK Push payments, double-entry accounting ledgers, customer debt (mkopo), cash drawer reconciliation, and equipment rental deposits for Kenyan hardware businesses. **A security flaw in this codebase can cause direct, irreversible financial loss to a real shop in Juja, Thika, Ruiru, Nairobi, or Nakuru — not a hypothetical "data breach" but actual shillings walking out the door.**

> 🚨 **If you have found a vulnerability that affects M-Pesa / Daraja payment flows, ledger balances, cash drawer counts, debt records, or any other financial state — DO NOT open a public GitHub issue. DO NOT post it in a PR review. DO NOT tweet it. Report it PRIVATELY using one of the channels below.**
>
> Public disclosure of an unpatched financial vulnerability puts every deployed store at immediate risk of exploitation. We treat unauthorized public disclosure of financial-state vulnerabilities as a harmful act, not responsible research.

---

## 🚨 Reporting a Vulnerability

### Preferred — GitHub Private Vulnerability Reporting (Security Advisories)

This is the fastest, most secure path. GitHub routes the report directly to repository maintainers and gives us a private collaboration workspace to develop and ship a fix.

1. Go to **https://github.com/bucky-ops/mbumah-hardware-pos/security/advisories/new**
2. Click **"Report a vulnerability"**.
3. Fill in the advisory form. GitHub provides a CVSS calculator — please use it.
4. Submit. The maintainers receive a private notification; no public issue is created.

The Security Advisory flow also lets us request a CVE identifier from GitHub once the fix is shipped, which makes the disclosure traceable for downstream consumers.

### Alternate — Encrypted Email

If you cannot use GitHub Security Advisories (e.g. you don't have a GitHub account), send an encrypted email to **security@mbumah-hardware.local** (replace with the maintainer's verified email if different — verify the address on the maintainer's public profile first, do not trust any address you cannot correlate to a verified identity).

- **Subject line:** `[PRIVATE SECURITY REPORT] <short, non-exploitative summary>` (e.g. `[PRIVATE SECURITY REPORT] M-Pesa callback signature bypass`)
- **Encrypt with PGP** if you have our public key (request it via a separate, neutral-channel message first — do NOT assume a key you found online is ours without verifying the fingerprint with the maintainer out-of-band).
- **Do NOT** include live M-Pesa codes, real customer PII, or production credentials in your report. Redact them. We need the *pattern* of the vulnerability, not live exploit material.

### What to Include

To help us triage and fix the issue quickly, please include:

- **Description** of the vulnerability and its potential impact (who can do what, with what inputs).
- **Affected versions** / commit SHA (run `git rev-parse HEAD`).
- **Step-by-step reproduction** (proof of concept). Use the sandbox Daraja credentials, never production credentials.
- **Attack scenario** — especially important for this project:
  - Can it manipulate M-Pesa STK Push state (e.g. mark an unpaid sale as `PAID`)?
  - Can it spoof or replay a Daraja callback to confirm a sale that was never paid?
  - Can it alter double-entry ledger balances, or bypass the financial-immutability guard on `JournalEntry` / `JournalEntryLine` / `SystemLog`?
  - Can it escalate privileges (e.g. a `CASHIER` accessing another store's data, or a `BRANCH_MANAGER` escalating to `SUPER_ADMIN`)?
  - Can it read or modify customer debt records, cash drawer counts, or rental deposits across tenants?
  - Can it inject or extract data via the Prisma layer (SQL/NoSQL injection via raw queries, JSON fields, or unsanitized `orderBy` / `where` inputs)?
- **Suggested fix** (if you have one).
- **Whether you have already disclosed this anywhere else** (and if so, where).

### Response Timeline

| Step | Target SLA |
|------|------------|
| Acknowledge receipt of report | Within **48 hours** |
| Initial assessment & CVSS severity rating | Within **5 business days** |
| Fix or mitigation for **Critical / High** issues | Within **7 days** (financial-state flaws get priority) |
| Fix or mitigation for **Medium** issues | Within **30 days** |
| Fix or mitigation for **Low** issues | Next scheduled release |
| Coordinated public disclosure | After fix is released, reporters are notified, and downstream forks have had a reasonable window (default 14 days) to patch |

We will keep you informed throughout the remediation process and will credit you in the security advisory (unless you prefer to remain anonymous). If we cannot reproduce the issue we will ask for additional detail; please be patient — false positives happen, but so do subtle race-condition exploits that take time to characterize.

### Severity Rubric

We use a CVSS v3.1 baseline, with project-specific uplifts:

| Severity | CVSS | Example for this project |
|----------|------|--------------------------|
| **Critical** | ≥ 9.0 | Unauthenticated callback spoof that confirms unpaid M-Pesa sales; SQL injection on `/api/transactions` |
| **High** | 7.0–8.9 | Cross-store read of debt or cash drawer data; auth bypass letting a logged-out user hit `/api/dashboard` |
| **Medium** | 4.0–6.9 | IDOR allowing a `BRANCH_MANAGER` to read a sibling store's product list; XSS in a manager-only screen |
| **Low** | < 4.0 | Missing security header with no exploitable consequence; information disclosure of stack traces in error responses |

Financial-state vulnerabilities are bumped one level (e.g. a 6.5 CVSS issue that lets an attacker mark a debt as settled becomes **High** because of the direct monetary impact).

---

## 🛡️ Scope

### In Scope

- The Next.js application (`src/`) and its API routes (`src/app/api/**`).
- Authentication & authorization (NextAuth.js, RBAC, session handling, JWT issuance).
- Multi-tenant data isolation (`storeId` enforcement across all queries, including the Prisma Client Extension in `src/lib/db.ts`).
- M-Pesa Daraja integration (STK Push, callback verification, C2B/B2C, password/signature generation).
- Double-entry accounting engine & financial ledger immutability (see below).
- Prisma database access layer & query construction (including any raw SQL escapes).
- Payment, debt, cash drawer, and rental-deposit flows.
- Vercel deployment configuration (`vercel.json`, `package.json` `vercel-build` script, env var handling).

### Out of Scope

- Vulnerabilities in third-party dependencies — report these to the upstream maintainers (but please still notify us so we can patch our dependency versions). We run `npm audit` / `bun audit` on every CI run.
- Self-XSS or issues requiring the victim to paste malicious payloads into their own browser.
- Missing security headers that don't lead to exploitable behavior (we already set a strict CSP, HSTS, X-Frame-Options: DENY, etc. via `next.config.js`).
- Denial of service via unrealistic request volumes (we rely on Vercel's edge rate limiting and the database provider's connection limits).
- Social engineering of maintainers.
- Findings from automated tools (npm audit, Snyk, Dependabot) without a demonstrated exploit path — please open a regular issue or PR for these, not a security report.

---

## 🔐 Security Measures Already in Place

This project implements defense-in-depth. Contributors should understand and preserve these controls — breaking any of them in a PR is a review-blocker.

### 1. Role-Based Access Control (RBAC)

5 roles (`SUPER_ADMIN`, `STORE_OWNER`, `BRANCH_MANAGER`, `CASHIER`, `ACCOUNTANT`) with a strict permission matrix documented in the README. The matrix is enforced both in the API layer (every route checks the caller's role) and in the UI layer (every tab gates rendering on the user's role).

### 2. Multi-Tenant Isolation (Zero-Trust)

Every database query is scoped by `storeId`. This is enforced **at the ORM level** via a Prisma Client Extension backed by `AsyncLocalStorage` (`src/lib/db.ts`). When a request runs inside `runWithTenant(storeId, fn)`, every `find*` / `update*` / `delete*` on a store-scoped model automatically ANDs the current tenant's `storeId` into the `where` clause — developers cannot "forget" to scope a query. `SUPER_ADMIN` and internal cross-store flows explicitly opt out via `runWithoutTenant(fn)`.

### 3. 🔒 Financial Immutability Guard (CRITICAL — DO NOT BREAK)

Posted accounting records are **append-only by design**. A Prisma Client Extension in `src/lib/db.ts` intercepts `update`, `updateMany`, `upsert`, `delete`, and `deleteMany` on the following models and throws an `IMMUTABILITY_VIOLATION` error:

- `JournalEntry`
- `JournalEntryLine`
- `SystemLog`
- `AuditLog`

The ONLY sanctioned way to mutate these tables is through `withImmutabilityBypass(fn, reason)`, which uses `AsyncLocalStorage` to disable the guard for the duration of `fn` and emits an `[IMMUTABILITY_BYPASS]` log line with the reason. The escape hatch is reserved for:

- M-Pesa callback confirmation (sets `JournalEntry.status = 'POSTED'` after Safaricom confirms the payment).
- Journal voiding (creates a reversing entry, never deletes the original).
- Expense void (marks the original as `VOIDED` with an audit reference; never deletes).

If a security report alleges that the immutability guard can be bypassed (e.g. via a direct Prisma call from an untrusted code path, or a query that the extension doesn't intercept), it is **automatically Critical severity**.

### 4. M-Pesa Daraja Hardening

- Callback signature verification (where applicable per Daraja spec).
- Idempotency: a callback for the same `CheckoutRequestID` cannot confirm a sale twice.
- The M-Pesa passkey is loaded from env (`MPESA_PASSKEY`), never hardcoded, never logged.
- Sandbox vs Production credentials are isolated by `MPESA_ENVIRONMENT`; production credentials are rejected against the sandbox endpoint and vice versa.

### 5. Session Security

- HttpOnly, Secure, SameSite=Lax cookies.
- 30-minute idle timeout with server-side session validation on every request.
- JWT signed with `NEXTAUTH_SECRET` / `JWT_SECRET` (min 16 chars, enforced by Zod at boot).
- Logout invalidates the server-side session; the cookie is cleared.

### 6. Input Validation

- Zod schemas validate every API input at the route boundary.
- Prisma parameterizes every query — there is no raw-SQL injection surface. Any new raw SQL must use `Prisma.sql` tagged templates.

### 7. Environment Validation (Eager, Zod-based)

`src/lib/env.ts` runs Zod validation on boot (at runtime, not build time). A misconfigured secret (`NEXTAUTH_SECRET` too short, `DATABASE_URL` malformed, etc.) throws a descriptive `EnvValidationError` listing every gap — long before a cryptic 500 surfaces to a customer. The `SKIP_ENV_VALIDATION=1` flag is used ONLY in the `vercel-build` script to let `next build` collect page data without runtime secrets; it is never set at runtime.

### 8. Audit Trail

Every privileged action (user create/delete, role change, store config change, force-close shift, void journal entry, expense approval) writes an `AuditLog` entry with the actor's `userId`, the action, the entity, and a JSON metadata blob. Audit logs are themselves immutable (see #3).

---

## 🚫 Unsupported Versions

Security fixes are applied only to the latest `main` branch and the most recent release. Older versions will not receive backports — the project moves fast and the upgrade path is well-tested.

| Version | Supported |
|---------|-----------|
| `main` (latest) | ✅ Yes |
| Previous releases | ❌ No (upgrade recommended) |
| Forks | ❌ Not our responsibility — fork maintainers must track upstream |

---

## 📜 Safe Harbor

We support responsible disclosure. We will not take legal action against security researchers who:

- Make a good-faith effort to avoid privacy violations, destruction of data, and interruption or degradation of services.
- Do not access or modify data that does not belong to them (in particular, do NOT test against production stores with real customer data — use the demo seeded data on a sandbox deployment).
- Report vulnerabilities promptly and privately as described above.
- Do not demand monetary compensation as a condition of disclosure (this is an open-source project without a bug-bounty budget; we will credit you and, if you want, write you a recommendation).

We reserve the right to take action against individuals who exploit vulnerabilities for financial gain, access production data without authorization, or publicly disclose unpatched financial-state vulnerabilities after being asked to coordinate.

---

## 🔄 Security Disclosure History

| CVE / Advisory | Severity | Component | Date Resolved |
|----------------|----------|-----------|---------------|
| _(none yet — be the first to report responsibly)_ | — | — | — |

When the first advisory is published, it will be linked here along with the credit to the reporter (unless they chose to remain anonymous).

---

**Thank you for helping keep Kenyan hardware businesses and their customers safe.** 🇰🇪
