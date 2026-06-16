# Security Policy

## Reporting a Vulnerability

We take security vulnerabilities seriously. Please report them responsibly.

### How to Report

**DO NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email security reports to: **security@mbumah-hardware.local**

Include the following in your report:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)
- Your contact information for follow-up

### Response Timeline

| Action | Target SLA |
|--------|------------|
| Acknowledge receipt | 24 hours |
| Initial assessment | 72 hours |
| Status update | 7 days |
| Fix release (Critical) | 7 days |
| Fix release (High) | 30 days |
| Fix release (Medium/Low) | 90 days |

### Responsible Disclosure

We kindly request that you:
- Give us reasonable time to investigate and fix the issue before public disclosure
- Do not access or modify data that does not belong to you
- Do not perform DoS or degradation of service attacks
- Do not exploit the vulnerability beyond what is necessary to demonstrate it

We will credit researchers who responsibly report valid security issues (unless you prefer to remain anonymous).

---

## Supported Versions

| Version | Supported | Status |
|---------|-----------|--------|
| 1.1.x | ✅ | Active development (security hardening) |
| 0.2.x | ⚠️ | Critical fixes only — upgrade to 1.1.x recommended |
| < 0.2.0 | ❌ | Not supported |

---

## Security Architecture

### Authentication
- Bearer token authentication with database-backed sessions
- bcrypt password hashing (cost factor 12)
- Brute-force protection with progressive lockout (5 attempts → 15 min lockout)
- Session idle timeout (30 min) and absolute timeout (24h)
- Password complexity policy (min 8 chars + uppercase + lowercase + digit + special)

### Authorization
- Role-based access control (RBAC) with hierarchical roles
- All API routes protected with `requireAuth()` / `requireRole()`
- Multi-tenant data isolation via store-scoped queries

### Transport Security
- HTTPS enforced in production via HSTS
- Security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`

### CSRF Protection
- Origin-based validation with exact hostname matching
- Optional shared-secret bypass via `ALLOW_CSRF_BYPASS` (for testing only)

### Rate Limiting
- Per-IP-per-tier rate limits
- Tiered: auth endpoints (strict), write endpoints (moderate), read endpoints (lenient)

### Input Validation
- Zod schema validation on all input
- XSS sanitization via `sanitizeInput()` for free-text fields
- Parameterized Prisma queries (no SQL injection)
- Maximum pagination limit (100) on list endpoints

### Payment Security
- M-Pesa callback verification via shared secret + amount match + replay guard
- IP allowlist for Safaricom callback IPs (configure via `SAFARICOM_CALLBACK_IP_ALLOWLIST`)
- Payment voiding requires authentication

### Logging & Audit
- All security events logged to `security_events` table
- All authentication attempts logged
- Sensitive data masked in logs (phone numbers, secrets, config values)
- Audit trail for all financial transactions

---

## Security Configuration

### Required Environment Variables (Production)

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `NEXTAUTH_SECRET` | NextAuth secret (32+ random chars) | (generate with `openssl rand -base64 32`) |
| `JWT_SECRET` | JWT signing secret (32+ random chars) | (generate with `openssl rand -base64 32`) |
| `MPESA_CALLBACK_SECRET` | Shared secret for M-Pesa callback | (generate with `openssl rand -hex 32`) |
| `SAFARICOM_CALLBACK_IP_ALLOWLIST` | Comma-separated Safaricom IPs | `196.201.214.200,196.201.214.206` |

### Security-Relevant Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISABLE_DEBUG_ENDPOINT` | `false` | Set to `true` to disable `/api/debug` in all environments |
| `ALLOW_CSRF_BYPASS` | `false` | Set to `true` to bypass CSRF checks (testing only) |
| `SESSION_IDLE_TIMEOUT_MS` | `1800000` (30 min) | Session idle timeout in milliseconds |

### Generating Secrets

```bash
# Generate secure random secrets
openssl rand -base64 32  # For NEXTAUTH_SECRET, JWT_SECRET
openssl rand -hex 32     # For MPESA_CALLBACK_SECRET
```

---

## Security Best Practices for Deployment

1. **Never commit `.env` files** — Use `.env.example` as a template only
2. **Rotate secrets regularly** — At minimum every 90 days
3. **Use a managed database** — Don't run PostgreSQL in a container in production
4. **Enable Vercel/Cloudflare WAF** — Add a Web Application Firewall in front of the app
5. **Monitor security events** — Set up alerts on the `security_events` table
6. **Audit user permissions quarterly** — Remove unused accounts, reduce roles
7. **Keep dependencies updated** — `npm audit` runs in CI; act on findings
8. **Back up the database** — Encrypted, off-site, tested restore

---

## Security Audit History

| Date | Version | Auditor | Findings | Fixed |
|------|---------|---------|----------|-------|
| 2026-03-04 | v1.1.0 | Z.ai Code Security Review | 58 | 40 (in v1.1.0) |

See [CHANGELOG.md](./CHANGELOG.md) for detailed fix descriptions.
See [docs/SECURITY_AUDIT_v1.1.0.md](./docs/SECURITY_AUDIT_v1.1.0.md) for the full audit report.

---

## Contact

- **Security reports:** security@mbumah-hardware.local
- **General issues:** [GitHub Issues](https://github.com/bucky-ops/mbumah-hardware-pos/issues)
