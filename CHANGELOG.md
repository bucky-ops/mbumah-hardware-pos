# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - v1.1.0 — Security Hardening Release

> **Release Date:** 2026-03-04
> **Branch:** `security/v1.1.0-hardening`
> **Status:** Ready for Review → Merge to `main`

This is a **security-focused release** addressing 58 findings from a comprehensive security audit. It closes critical authentication, authorization, and cryptographic gaps that could have led to full system compromise.

---

### 🔴 Critical Fixes

#### Removed Plaintext Password Fallback (C-01)
- **File:** `src/app/api/auth/login/route.ts`
- The `verifyPassword()` function had a fallback that compared passwords in **plaintext** when the stored hash started with `hashed_`. An attacker with DB read access could extract passwords directly.
- Legacy `hashed_` passwords are now **denied** login and flagged with `requiresPasswordReset: true` for forced reset.

#### Fixed Brute-Force Lockout Permanently Deactivating Accounts (C-02)
- **File:** `src/lib/brute-force.ts`
- The brute-force protection set `isActive: false` on the User record, which is the same field used for manual deactivation. An attacker could **permanently lock out any user** with just 5 failed logins.
- Now uses only the `lockedUntil` timestamp. Accounts **auto-recover** after the lockout period expires.

#### Added Authentication to 13 Previously-Unprotected API Routes (C-01 / C-05)
- **Files:** 12 route files (products, transactions, customers, journal, expenses, cash-drawer, payments/mpesa/stkpush, whatsapp/send, financial/payments, etc.)
- 22 handler functions across 12 files had **zero authentication** — they relied only on middleware checking for the *presence* of a Bearer token (not its validity). An attacker with `Authorization: Bearer anything` could read, create, modify, or delete any data.
- All handlers now use `requireAuth(request)` to validate the session against the database.

#### Removed Client-Supplied User Identity from Request Bodies (C-04)
- **Files:** `transactions/route.ts`, `financial/journal/route.ts`, `expenses/route.ts`, `cash-drawer/route.ts`
- These endpoints accepted `cashierId`, `createdBy`, `paidBy`, and `userId` from the request body, allowing attackers to **impersonate any user**.
- All identity fields now come from `session.userId` after `requireAuth()` validation.

#### M-Pesa Callback Hardening (C-06)
- **File:** `src/app/api/payments/mpesa/callback/route.ts`
- The callback endpoint was public with **no origin verification** — attackers could forge callbacks to mark payments as completed.
- Added 4-layer verification: shared-secret header (`MPESA_CALLBACK_SECRET`), replay guard for terminal transactions, amount-match validation (±0.01 KES), and 401 for unknown `CheckoutRequestID`.
- Added `SAFARICOM_CALLBACK_IP_ALLOWLIST` env var placeholder for IP whitelisting.

#### Disabled Debug Endpoint in Production
- **File:** `src/app/api/debug/route.ts`
- Triple guard: returns 404 if `NODE_ENV === 'production'`, if `DISABLE_DEBUG_ENDPOINT === 'true'`, or if `NODE_ENV !== 'development'`.

#### Reduced Health Endpoint Information Leakage
- **File:** `src/app/api/health/route.ts`
- Public endpoint previously leaked user counts, product counts, transaction counts, session counts, security event counts, locked account counts, and environment info.
- Now returns only `{ status, timestamp, responseTime }`.

---

### 🟠 High-Priority Fixes

#### Fixed CSRF Origin Validation Bypass (H-01)
- **File:** `src/lib/security.ts`
- CSRF check used `origin.includes(host)` (substring match), allowing bypass via domains like `evil-mbumah.co.ke`.
- Now uses `new URL(origin).hostname === host` for exact hostname matching.

#### Fixed User Enumeration via Lockout Messages (H-05)
- **File:** `src/app/api/auth/login/route.ts`
- Lockout response said "Account temporarily locked" (confirming account existence), while invalid credentials returned generic message.
- Both responses now return `"Invalid email or password."` with 401 status.

#### Removed Tax PIN from Auth Responses (M-06)
- **Files:** `login/route.ts`, `me/route.ts`
- The KRA Tax PIN (`organization.taxPin`) was included in login and `/me` responses — sensitive financial information.
- Removed from both endpoints.

#### Added Security Response Headers (H-04)
- **File:** `src/middleware.ts`
- Added `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- Added `Strict-Transport-Security` (HSTS) in production.

#### Fixed Rate-Limit Key Dilution (M-10)
- **File:** `src/middleware.ts`
- Rate-limit key was `${tier}:${clientIp}:${pathname}` — different API paths had separate counters, allowing attackers to multiply their allowed requests.
- Changed to `${tier}:${clientIp}` to aggregate per-IP-per-tier.

#### Strengthened Password Policy (M-03)
- **File:** `src/lib/validations.ts`
- Password validation was `z.string().min(6)` — no complexity requirements.
- Now requires min 8 chars + uppercase + lowercase + digit + special character.

#### Added Session Idle Timeout (M-09)
- **Files:** `verify/route.ts`, `me/route.ts`
- Sessions had a `lastActiveAt` field but it was never updated; sessions were valid for full 24h regardless of activity.
- Both endpoints now invalidate sessions idle for >30 minutes and update `lastActiveAt` on each success.

#### Fixed Logout Without Valid Session (M-07)
- **File:** `src/middleware.ts`
- `/api/auth/logout` was in `PUBLIC_PATHS`, allowing logout without auth.
- Removed from `PUBLIC_PATHS`; now requires Bearer token.

#### Improved Request Size Validation (M-04)
- **File:** `src/lib/security.ts`
- `isRequestSizeValid()` returned `true` for missing/unparseable `Content-Length`, allowing chunked requests to bypass the size limit.
- Added `Transfer-Encoding: chunked` detection; rejects unparseable Content-Length.

#### Removed Sensitive Config Values from System Config Response (H-05)
- **File:** `src/app/api/system-config/route.ts`
- GET endpoint returned all config values including potentially secret ones.
- Added `isSensitiveConfigKey()` / `maskConfigValue()` / `maskSensitiveConfig()` helpers. Sensitive keys (matching `secret`, `password`, `token`, `apikey`, `key`, `pin`) are masked in both GET response and PUT audit logs.

#### Removed Loyalty Points / Debt Limit Manipulation from Customer Update (H-02)
- **File:** `src/app/api/customers/[id]/route.ts`
- Customer update allowed modifying `loyaltyPoints` and `debtLimit` from the request body, enabling unauthorized credit/loyalty manipulation.
- Removed from `allowedFields`; comment notes need for dedicated admin endpoints.

#### Fixed Customer Creation Bypassing Validation (H-09)
- **Files:** `src/lib/validations.ts`, `src/app/api/customers/route.ts`
- After Zod validation, the handler read `preferredChannel` and `isActive` from raw body, bypassing the schema.
- Added both fields to `createCustomerSchema`; handler now uses `validation.data`.

#### Fixed CI Security Scans Bypass (H-05)
- **File:** `.github/workflows/node.js.yml`
- `npm audit`, `better-npm-audit`, and `gitleaks` had `continue-on-error: true` — vulnerabilities and secret leaks never failed the build.
- Removed `continue-on-error`; threshold set to `moderate` severity.

#### Replaced Weak Seed Passwords with Random Generation (H-07)
- **File:** `prisma/seed.ts`
- All 12 seeded users (including SUPER_ADMIN) used the password `password123`.
- Each user now gets a unique 16-char password from `crypto.randomBytes` with one char per policy class (upper/lower/digit/special), Fisher-Yates shuffled, bcrypt-hashed at cost 12.
- Credentials dumped to `.seed-passwords.local` (mode 0600, gitignored) and stderr banner.

---

### 🟡 Medium-Priority Fixes

#### Replaced Insecure RNG with Crypto-Secure Alternatives (M-03)
- **File:** `src/lib/helpers.ts`
- Receipt numbers, journal entry numbers, SKU codes, and gift card codes all used `Math.random()` — not cryptographically secure and predictable.
- Replaced with `crypto.randomBytes`. Added `secureRandomDigits(n)` (32-bit rejection sampling) and `secureRandomFromAlphabet(alphabet, n)` (per-byte rejection sampling, zero modulo bias).

#### Removed SQL Keyword Stripping Anti-Pattern (M-01)
- **File:** `src/lib/security.ts`
- `sanitizeInput()` stripped SQL keywords (SELECT, INSERT, etc.) which broke legitimate input (e.g., "SELECT brand hammers") and didn't prevent SQL injection (Prisma uses parameterized queries).
- Function is now a pure XSS sanitizer.

#### Removed CSRF Development Bypass (M-02)
- **File:** `src/lib/security.ts`
- CSRF validation was bypassed when `NODE_ENV === 'development'` and no Origin/Referer headers were present.
- Removed the NODE_ENV bypass; now gated on explicit `ALLOW_CSRF_BYPASS=true` env var only.

#### Enforced Maximum Pagination Limits (M-01)
- **Files:** 9 list endpoints (products, transactions, customers, expenses, cash-drawer, financial/journal, security/events, system-logs, audit-logs)
- All list endpoints accepted `limit` without a maximum — `?limit=999999` could cause memory exhaustion.
- Now capped at 100 via `Math.min(Math.max(parseInt(...) || '<default>', 1), 100)`.

#### Masked Phone Numbers in M-Pesa Logs (L-02)
- **Files:** `mpesa/stkpush/route.ts`, `mpesa/callback/route.ts`
- Phone numbers were logged in plaintext.
- Now masked via `maskSensitiveData(value, 'phone')` — returns `***` + last 4 digits.

#### Sanitized Error Messages (L-01)
- **Files:** `transactions/route.ts`, `financial/journal/route.ts`, `debug/route.ts`
- Error messages revealed which product/account IDs didn't exist (information leakage).
- Replaced with generic messages. Added `sanitizeDebugError()` classifier that buckets raw DB errors into 5 generic categories.

---

### 🟢 Low-Priority Fixes

- Added `.seed-passwords.local` to `.gitignore`.
- Updated CI summary line to reflect blocking behavior of security scans.

---

### ⚠️ Known Limitations & Follow-ups

These items are documented as follow-ups and require schema changes or additional architecture work:

1. **Session tokens stored unhashed in DB (H-03)** — Hash with SHA-256 before storing. Requires migration to look up sessions by `SHA-256(token)`.
2. **In-memory rate limiting / brute-force state (H-02)** — Migrate to Redis (Upstash) or Vercel KV for serverless compatibility. State is currently lost on cold start.
3. **Migrate monetary fields from Float to Decimal (M-01 from config audit)** — Critical for financial accuracy. Requires Prisma migration.
4. **Add `mustChangePassword` field to User schema** — For forced password reset flow. Login already returns `requiresReset`; just needs the DB column.
5. **Add `callbackHmac` column to MpesaTransaction** — For full HMAC-SHA256 callback verification (currently using shared secret + amount match).
6. **Populate `SAFARICOM_CALLBACK_IP_ALLOWLIST`** — Ops must confirm Daraja production egress IPs before go-live.
7. **Move session tokens from localStorage to httpOnly cookies (H-02 from config audit)** — Requires frontend refactor.
8. **Remove `unsafe-inline` / `unsafe-eval` from CSP** — Replace with nonce-based CSP. Requires Next.js nonce setup.
9. **Create dedicated admin endpoints for loyalty/debt-limit adjustment** — Currently no path exists after H-02 fix.
10. **Migrate from next-auth v4 to Auth.js v5** — Improved security features and CSRF protection.

---

### 📊 Audit Summary

| Severity | Findings | Fixed in v1.1.0 | Follow-up |
|----------|----------|-----------------|-----------|
| Critical | 7 | 7 | 0 |
| High | 17 | 14 | 3 |
| Medium | 17 | 13 | 4 |
| Low | 17 | 6 | 11 |
| **Total** | **58** | **40** | **18** |

---

## [0.2.0] - 2026-06-12

### Initial Public Release
- Multi-tenant hardware store POS & ERP system
- Authentication with RBAC (SUPER_ADMIN, BRANCH_MANAGER, CASHIER, ACCOUNTANT, etc.)
- Inventory management with stock movements
- Sales transactions with multi-payment support (Cash, M-Pesa, Card, Credit)
- Customer management with credit accounts and loyalty program
- Supplier management with purchase orders
- Financial accounting with double-entry journal
- Banking module with reconciliations
- Tax management (KRA-compliant for Kenya)
- Reports & analytics dashboard
- WhatsApp messaging integration
- Multi-store transfers
- Gift cards & voucher campaigns
- Rental management
- Audit logs & security event tracking

---

## Version History

| Version | Date | Type | Notes |
|---------|------|------|-------|
| 0.2.0 | 2026-06-12 | Initial | First public release |
| 1.1.0 | 2026-03-04 | Security | 40 of 58 audit findings resolved |
