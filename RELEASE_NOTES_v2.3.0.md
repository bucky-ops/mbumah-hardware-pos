# Release Notes — v2.3.0

**Release date:** 2026-09-12 · **Type:** Minor feature release (semantic versioning)

## What this release is about

Every branch, product and employee now carries a **unique, human-readable code**
derived from the branch's town/county, so any stock movement, payslip or
transfer can be traced back to the branch it belongs to — on paper as well as
in the database.

## New features

### 1. Unique branch codes (`Store.code`)
- Every branch has a short unique code (2–6 uppercase letters/digits), e.g.
  `JUJ` (Juja Main), `THI` (Thika), `RUI` (Ruiru), `NAI` (Nairobi CBD),
  `NAK` (Nakuru).
- `GET /api/branches` now returns `code`; `POST /api/branches` validates it and
  auto-derives one from the branch name when omitted (with a digit suffix if
  taken, e.g. `NAK2`).
- New `GET / PATCH /api/branches/[id]` route — branch codes can be assigned to
  existing branches; codes are normalized and uniqueness-checked (409 on a
  clash). Removing a code is refused (it would silently break traceability).

### 2. Branch-coded product SKUs
- Auto-generated SKUs now embed the branch code:
  `MBM-<branchCode>-<category>-XXXX` (e.g. `MBM-NAK-CEM-0042`). Every product
  created or restocked at a branch therefore carries that branch's code.
- Inter-store transfers derive destination SKUs from the destination branch
  code: `<originSku>--<branchCode>` (e.g. `MBM-THI-0042--NAK`). Legacy pairs
  without branch codes keep the old `<originSku>--<storeId>` form so historical
  transfer SKUs stay stable.
- `PUT /api/products/[id]` now accepts `sku` (uniqueness-checked) so legacy
  SKUs can be re-coded to the branch convention without deleting history.

### 3. Branch-coded employee staff numbers (`Employee.employeeCode`)
- Every employee record now carries a unique staff number:
  `MBM-<branchCode>-E<NNN>` (e.g. `MBM-JUJ-E001`), sequenced per branch.
- `POST /api/employees` auto-generates the next number for the branch;
  explicit codes ("E012" or full "MBM-JUJ-E012") are accepted and validated.
- `PATCH /api/employees/[id]` can set/change a staff number (uniqueness
  checked); `GET` responses include it.

## Corrections included since v2.2.0 (already live)

- Employee CRUD 500s fixed (`_count.leaves` → `leaveRequests`) + payroll
  zero-earnings guard (no more negative net pay) — PR #30.
- Inter-store transfers made functional end-to-end; POS low-stock cart guard
  (red glow + "cannot be sold until restocked" popup + server 409) — PR #31.
- POS tab hotfix (undefined `disabled` reference) — PR #32.

## Version numbering rationale

- The npm package version (`0.2.1`) had drifted from the API spec version
  (`2.2.0`). Both are now aligned.
- v2.0.0 = the multi-branch POS/ERP major release (see `PROJECT_PLAN_V2.md`).
- v2.1.0–v2.2.0 = audit remediation, financial integrity, DML completeness.
- **v2.3.0 = new, backward-compatible functionality** (branch codes,
  branch-coded SKUs, employee staff numbers) → MINOR bump per SemVer.

## Data backfill (done post-deploy via the API)

- Store codes set: Juja Main → `JUJ`, Thika → `THI`, Ruiru → `RUI`,
  Nairobi CBD → `NAI`, Nakuru → `NAK`.
- All 25 employees assigned `MBM-<code>-E###` staff numbers.
- Legacy SKUs normalized to carry branch codes (e.g. `THK-NAS-0001` →
  `MBM-THI-NAS-0001`).
