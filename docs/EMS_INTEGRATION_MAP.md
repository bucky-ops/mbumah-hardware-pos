# EMS Integration Map

EMS reuses the existing platform. Nothing in this map introduces a parallel architecture.

| Existing system | Location | EMS usage |
| --- | --- | --- |
| DB session auth | src/lib/auth.ts getSessionFromRequest, AuthSession | Employee self-service uses the existing session. Employee.userId optionally links a User row. No second login system. |
| RBAC helpers | requireAuth, requireRole, requireStoreAccess, withSessionAuth, assertPermission | Every HR and payroll route composes these. New roles HR_MANAGER and EMPLOYEE are added as string constants plus permission rows. |
| Permission matrix | src/lib/permissions.ts FEATURE_PERMISSIONS, src/lib/types.ts PERMISSION_MATRIX, RolePermission table | New hr.* permission keys defined in src/lib/hr/permissions.ts follow the same dotted-key convention. |
| Tenant scoping | src/lib/db.ts runWithTenant, injectTenant; assertStoreScope, assertBodyStoreScope | All branch-scoped EMS queries resolve store from session. Client storeId is never trusted. |
| Store resolution | src/lib/workspace/server.ts resolveStoreContext | HR workspace pages resolve the store context the same way as POS pages. |
| Shift system | Shift model, src/app/api/shifts, ghost-shift canonical check (endedAt null) | Attendance reconciles against Shift. Ghost-shift logic is referenced, not duplicated. |
| Sales data | SalesTransaction (paymentStatus, transactionType) | Commission reads COMPLETED and SALE rows only. EMS never mutates sales data. |
| Accounting engine | src/lib/accounting-helpers.ts createJournalEntry, postJournalEntry, validateJournalEntryBalancing; src/lib/account-helper.ts | Payroll posts through createJournalEntry with balanced lines and JournalEntry.idempotencyKey. Payroll liability accounts come from the corrected chart of accounts. No direct Prisma journal writes from routes. |
| Receipts PDF pipeline | existing receipt rendering path | Payslip PDF reuses the pipeline and print stylesheet. |
| Notifications | src/lib/notify.ts notifyStore, notifyUser | Leave approvals, payroll status changes, probation end, document expiry alerts reuse notifyUser and notifyStore. |
| Audit trail | src/lib/audit-trail.ts auditTrail.log with hash chain | Every HR and payroll mutation logs through a service function. Denied attempts log via the existing SecurityEvent path. |
| Offline outbox | src/lib/offline-sync.ts | Attendance punch queues with idempotencyKey when offline. Payroll and PII never enter localStorage. |
| Idle timeout | src/hooks/use-idle-timeout.ts | Applies to self-service and HR workspace sessions unchanged. |
| Report exports | existing export patterns and data-export-utils (after P0-1 fix) | P10 and statutory extracts follow the same CSV and PDF conventions with audit logging. |
| Health and observability | /api/health routes, systemLog | HR schema health surfaces through the existing schema endpoint pattern. |
| Release machinery | release.yml, validate-tag.mjs, staged-update.mjs | EMS schema ships through the standard version-bump release flow with preflight and backup. |

## Explicit non-goals

1. No separate employee login system.
2. No separate database per branch.
3. No new WebSocket or queue infrastructure.
4. No direct Prisma writes for HR or payroll mutations from route handlers; service functions own them.
