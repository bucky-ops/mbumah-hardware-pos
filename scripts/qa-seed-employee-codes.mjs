// QA seed: give every ACTIVE employee an employeeCode so the v2.35.0
// utilisation report and the v2.36.0 drill-down resolve real rows.
// Codes are per-branch sequential: MBH-<storeNum>-<seq> (e.g. MBH-1-004).
// Run: DATABASE_URL='file:/home/z/ems/prisma/prisma/dev.db' node scripts/qa-seed-employee-codes.mjs
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

async function main() {
  const stores = await db.store.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
  const storeNum = new Map(stores.map((s, i) => [s.id, i + 1]));
  const employees = await db.employee.findMany({
    where: { deletedAt: null },
    select: { id: true, employeeCode: true, storeId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const seq = new Map();
  let updated = 0;
  for (const e of employees) {
    if (e.employeeCode) continue;
    const n = (seq.get(e.storeId) ?? 0) + 1;
    seq.set(e.storeId, n);
    const code = `MBH-${storeNum.get(e.storeId) ?? 0}-${String(n).padStart(3, '0')}`;
    await db.employee.update({ where: { id: e.id }, data: { employeeCode: code } });
    updated += 1;
  }
  console.log(`stores=${stores.length} employees=${employees.length} updated=${updated}`);
  const sample = await db.employee.findMany({
    where: { deletedAt: null, employeeCode: { not: null } },
    select: { employeeCode: true, storeId: true },
    take: 5,
  });
  console.log('sample:', sample.map((s) => s.employeeCode).join(', '));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
