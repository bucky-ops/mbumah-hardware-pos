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
