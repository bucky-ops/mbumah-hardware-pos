// QA seed for the :3200 dev database (v2.29.0): leave types + balances.
//
// The dev DB ships with ZERO leave types and ZERO balances, so the
// self-service leave page only ever shows its empty states and the request
// form has no happy path to QA. This script (idempotent — safe to re-run):
//   1. upserts the standard Kenyan leave types (by unique code),
//   2. grants every employee a current-year balance per type
//      (allocatedDays = defaultDaysPerYear, carryForward 0 — usage stays
//      owned by recomputeBalances, mirroring grantBalance semantics),
//   3. prints a summary.
//
// Run: node scripts/qa-seed-leave-dev.mjs
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } },
});

// Standard Kenyan entitlements (statutory flags per Employment Act):
const LEAVE_TYPES = [
  { code: 'ANNUAL', name: 'Annual Leave', defaultDaysPerYear: 21, isStatutory: true, carryForwardAllowed: true, maxCarryForwardDays: 10, description: 'Paid annual leave — 21 working days after 12 months of service.' },
  { code: 'SICK', name: 'Sick Leave', defaultDaysPerYear: 10, isStatutory: true, carryForwardAllowed: false, maxCarryForwardDays: 0, description: 'Paid sick leave — 7 days full + 7 days half pay with a medical certificate.' },
  { code: 'MATERNITY', name: 'Maternity Leave', defaultDaysPerYear: 90, isStatutory: true, carryForwardAllowed: false, maxCarryForwardDays: 0, description: 'Three months maternity leave on full pay.' },
  { code: 'PATERNITY', name: 'Paternity Leave', defaultDaysPerYear: 14, isStatutory: true, carryForwardAllowed: false, maxCarryForwardDays: 0, description: 'Two weeks paternity leave on full pay.' },
  { code: 'COMPASSIONATE', name: 'Compassionate Leave', defaultDaysPerYear: 5, isStatutory: false, carryForwardAllowed: false, maxCarryForwardDays: 0, description: 'Bereavement or emergency leave — 5 days per year.' },
];

const YEAR = new Date().getUTCFullYear();

async function main() {
  const typeIds = {};
  for (const t of LEAVE_TYPES) {
    const existing = await db.leaveType.findUnique({ where: { code: t.code } });
    if (existing) {
      typeIds[t.code] = existing.id;
      console.log(`leave type ${t.code}: exists (${existing.id})`);
    } else {
      const created = await db.leaveType.create({ data: t });
      typeIds[t.code] = created.id;
      console.log(`leave type ${t.code}: created (${created.id})`);
    }
  }

  const employees = await db.employee.findMany({ select: { id: true, firstName: true, lastName: true } });
  let granted = 0;
  let skipped = 0;
  for (const emp of employees) {
    for (const t of LEAVE_TYPES) {
      const existing = await db.employeeLeaveBalance.findFirst({
        where: { employeeId: emp.id, leaveTypeId: typeIds[t.code], leaveYear: YEAR },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }
      await db.employeeLeaveBalance.create({
        data: {
          employeeId: emp.id,
          leaveTypeId: typeIds[t.code],
          leaveYear: YEAR,
          allocatedDays: t.defaultDaysPerYear,
          usedDays: 0,
          pendingDays: 0,
          carryForwardDays: 0,
        },
      });
      granted += 1;
    }
  }

  console.log(`balances for ${YEAR}: ${granted} granted, ${skipped} already present (${employees.length} employees × ${LEAVE_TYPES.length} types)`);
}

main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    return db.$disconnect().then(() => process.exit(1));
  });
