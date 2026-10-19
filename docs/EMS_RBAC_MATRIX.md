# EMS RBAC Matrix

Roles are plain strings on User.role (no enum). Adding HR_MANAGER and EMPLOYEE is additive data. POS roles remain untouched.

## Roles

SUPER_ADMIN, STORE_OWNER, HR_MANAGER, BRANCH_MANAGER, ACCOUNTANT, CASHIER, EMPLOYEE.

## Permission keys

Defined in src/lib/hr/permissions.ts as typed constants, registered in the central permission layers:

hr.employee.read.own_branch, hr.employee.read.all, hr.employee.create, hr.employee.update, hr.employee.archive, hr.employee.read.pii, hr.employee.unmask.pii, hr.recruitment.read.branch, hr.recruitment.read.all, hr.recruitment.manage, hr.offer.approve, hr.onboarding.manage, hr.attendance.record.own, hr.attendance.read.branch, hr.attendance.approve.branch, hr.attendance.adjust, hr.leave.read.own, hr.leave.read.branch, hr.leave.request, hr.leave.approve.branch, hr.leave.balance.manage, hr.payroll.prepare, hr.payroll.approve, hr.payroll.post, hr.payroll.disburse, hr.payroll.correct, hr.payroll.read.own, hr.payroll.read.branch, hr.payroll.read.all, hr.performance.manage, hr.performance.review, hr.performance.read.own, hr.asset.manage, hr.discipline.manage, hr.report.branch, hr.report.all, hr.settings.manage, hr.rate-table.manage.

## Mapping

| Permission group | SUPER_ADMIN | STORE_OWNER | HR_MANAGER | BRANCH_MANAGER | ACCOUNTANT | CASHIER | EMPLOYEE |
| --- | --- | --- | --- | --- | --- | --- | --- |
| employee read | all | all | all | own branch | own branch summary only | own | own |
| employee create/update/archive | yes | yes | yes | no | no | no | no |
| PII read and unmask | yes | yes | yes | no | payslip necessity only | no | no |
| recruitment | all | all | manage | read branch | no | no | no |
| offer approve | yes | yes | yes | no | no | no | no |
| onboarding manage | yes | yes | yes | branch tasks | no | no | no |
| attendance record own | yes | yes | yes | yes | yes | yes | yes |
| attendance read/approve branch | all | all | read branch | read and approve branch | read branch | no | no |
| attendance adjust | yes | yes | yes | no | no | no | no |
| leave read own | yes | yes | yes | yes | yes | yes | yes |
| leave request | yes | yes | yes | yes | yes | yes | yes |
| leave approve branch | all | all | yes | yes | no | no | no |
| leave balance manage | yes | yes | yes | no | no | no | no |
| payroll prepare | yes | yes | yes | no | no | no | no |
| payroll approve | yes | yes | no (maker) | no | no | no | no |
| payroll post | yes | yes | no | no | no | no | no |
| payroll disburse | yes | yes | no | no | no | no | no |
| payroll correct | yes | yes | yes | no | no | no | no |
| payroll read | all | all | branch and all | own branch aggregate | all read only | own | own |
| performance manage/review | all | all | manage | review | no | no | read own |
| asset manage | yes | yes | yes | branch assign | no | no | no |
| discipline manage | yes | yes | yes | no | no | no | no |
| reports | all | all | branch | branch | all | no | own |
| settings and rate tables | yes | rate tables require explicit grant | no | no | no | no | no |

## Enforcement rules

1. Branch is resolved from the authenticated session server-side. A user without storeId cannot take branch-scoped actions.
2. Maker-checker: payroll prepare, approve, post, and disburse compare actor identities server-side; the preparer cannot approve or post. Every step is audit logged.
3. PII unmask is audit logged with the field name, never the value.
4. Cross-branch attempts return 403 or a safe 404 and raise a SecurityEvent through the existing denial path.
5. Export endpoints require hr.report.branch or hr.report.all and are audit logged; PII in exports is masked unless hr.employee.unmask.pii is held, in which case the unmask is logged.

## Security headers and rate limits (Phase 4.8, acceptance 7)

### Security headers (next.config.ts, `headers()` — all routes)

| Header | Value | Defence |
| --- | --- | --- |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains; preload` | Forces HTTPS for a year across subdomains; preload-eligible. |
| X-Frame-Options | `DENY` | Clickjacking: the app never renders in a frame. |
| X-Content-Type-Options | `nosniff` | MIME sniffing: browsers honour the declared type only. |
| X-XSS-Protection | `1; mode=block` | Legacy browser XSS filter block mode. |
| Referrer-Policy | `strict-origin-when-cross-origin` | Cross-origin navigations leak origin only, never paths or query (never tokens). |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), interest-cohort=()` | Browser hardware/FLoC surfaces are denied outright. |
| Cross-Origin-Opener-Policy | `same-origin` | Window references across origins are severed. |
| Cross-Origin-Resource-Policy | `same-origin` | Other origins cannot embed this app's responses. |
| Cross-Origin-Embedder-Policy | `credentialless` | Cross-origin embeds load without credentials (COOP/COEP/CORP triple). |

`X-Powered-By` is stripped (Next.js `poweredByHeader` off) — the framework
version is not advertised. PWA installability rides the `Link: manifest`
header with `crossorigin=use-credentials`.

### Rate limits (`src/lib/rate-limit.ts` — in-memory sliding window, per-instance)

| Tier | Budget | Applied to |
| --- | --- | --- |
| AUTH | 5 req / 15 min | Login (the desk's known 5/15 window). |
| PASSWORD_RESET | 3 req / hour | Reset flows. |
| PAYMENT | 20 req / min | Checkout/payment endpoints. |
| READ | 100 req / min | General API reads (default tier). |
| WRITE | 30 req / min | General API writes. |
| SEARCH | 30 req / min | Search endpoints. |
| MESSAGING | 10 req / min | WhatsApp/messaging sends. |
| WEBHOOK | 60 req / min per IP | Public-but-credentialed M-Pesa Daraja callbacks — the cap is the last line after credential + IP-allowlist validation. |

Exceeding a budget returns 429 with `retryAfter`; repeated AUTH failures feed
`brute-force.ts`, which locks the account and raises a SecurityEvent. The
limiter is in-memory by design (single-server deployment): a distributed
deployment must move the map to Redis before horizontal scaling — recorded in
the risk register, not discovered there.
