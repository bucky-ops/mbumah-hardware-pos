# 🔒 Security Policy

## 🚨 Reporting a Vulnerability

**Mbumah Hardware POS handles sensitive financial data** — including M-Pesa (Safaricom Daraja) payment flows, double-entry accounting ledgers, customer debt records, and cash drawer reconciliation. Because a security flaw here can cause **real monetary loss** to Kenyan hardware businesses, we take vulnerabilities extremely seriously.

### ⚠️ Do NOT open a public GitHub issue for security vulnerabilities

If you discover a security vulnerability, **please report it privately**. Public disclosures put every deployed store at immediate risk of financial exploitation.

### How to Report

Please report vulnerabilities **privately** using **one** of these channels:

1. **Preferred — GitHub Private Vulnerability Reporting:**
   Go to the **[Security tab](https://github.com/bucky-ops/mbumah-hardware-pos/security/advisories/new)** of this repository and click **"Report a vulnerability"**. This opens a private advisory visible only to repository maintainers.

2. **Email:**
   Send details to **security@mbumah-hardware.local** (replace with the maintainer's verified email if different). Encrypt sensitive details with our PGP key if available.

### What to Include

To help us triage and fix the issue quickly, please include:

- **Description** of the vulnerability and its potential impact
- **Affected versions** / commit SHA
- **Step-by-step reproduction** (proof of concept)
- **Attack scenario** — especially important for this project:
  - Can it manipulate M-Pesa STK Push state or spoof callbacks?
  - Can it alter double-entry ledger balances or bypass immutability guards?
  - Can it escalate privileges (e.g., a `CASHIER` accessing another store's data)?
  - Can it read/modify customer debt or payment records across tenants?
- **Suggested fix** (if you have one)

### Response Timeline

| Step | Target SLA |
|------|------------|
| Acknowledge receipt of report | Within **48 hours** |
| Initial assessment & severity rating | Within **5 business days** |
| Fix or mitigation for high/critical issues | Within **30 days** |
| Coordinated public disclosure | After fix is released & reporters are notified |

We will keep you informed throughout the remediation process and will credit you in the security advisory (unless you prefer to remain anonymous).

---

## 🛡️ Scope

### In Scope
- The Next.js application (`src/`) and its API routes
- Authentication & authorization (NextAuth.js, RBAC, session handling)
- Multi-tenant data isolation (`storeId` enforcement across all queries)
- M-Pesa Daraja integration (STK Push, callbacks, C2B/B2C)
- Double-entry accounting engine & financial ledger immutability
- Prisma database access layer & query construction
- Payment, debt, and cash-handling flows

### Out of Scope
- Vulnerabilities in third-party dependencies — report these to the upstream maintainers (but please still notify us so we can patch our dependency versions)
- Self-XSS or issues requiring the victim to paste malicious payloads into their own browser
- Missing security headers that don't lead to exploitable behavior
- Denial of service via unrealistic request volumes (we rely on Vercel/infra rate limiting)
- Social engineering of maintainers

---

## 🔐 Security Measures Already in Place

This project implements defense-in-depth. Contributors should understand and preserve these controls:

- **Role-Based Access Control (RBAC):** 5 roles (`SUPER_ADMIN`, `STORE_OWNER`, `BRANCH_MANAGER`, `CASHIER`, `ACCOUNTANT`) with a strict permission matrix.
- **Multi-Tenant Isolation:** Every database query is scoped by `storeId`. Cross-store data access requires `SUPER_ADMIN` privileges.
- **Immutable Financial Records:** Journal entries and posted transactions are guarded by immutability constraints — they cannot be edited or deleted, only reversed via correcting entries (double-entry best practice).
- **Session Security:** HttpOnly cookies, 30-minute idle timeout, server-side session validation.
- **Input Validation:** Zod schemas validate all API inputs; Prisma parameterizes all queries (no raw SQL injection surface).
- **Environment Validation:** Zod-based eager env validation on boot prevents misconfigured secrets from running.

---

## 🚫 Unsupported Versions

Security fixes are applied only to the latest `main` branch and the most recent release. Older versions will not receive backports.

| Version | Supported |
|---------|-----------|
| `main` (latest) | ✅ Yes |
| Previous releases | ❌ No (upgrade recommended) |

---

## 📜 Safe Harbor

We support responsible disclosure. We will not take legal action against security researchers who:
- Make a good-faith effort to avoid privacy violations, destruction of data, and interruption or degradation of services
- Do not access or modify data that does not belong to them
- Report vulnerabilities promptly and privately as described above

---

**Thank you for helping keep Kenyan hardware businesses and their customers safe.** 🇰🇪
