// One-off QA seed for the :3100 hermetic dev database (v2.19.0 Stage G):
// links a seeded cashier User to an Employee row (self-service), and creates
// performance cycles/reviews/goals, an asset assignment, and disciplinary
// cases (incl. an already-expired warning) so the new consoles and the
// self-service portal can be exercised end-to-end in the browser.
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } },
});

async function main() {
  // 1. Self-service link: cashier user (has real SalesTransactions) <-> employee.
  const employee = await db.employee.findUnique({ where: { id: 'emp_david_otieno' } });
  const cashier = await db.user.findUnique({ where: { id: 'user_cashier_1' } });
  if (!employee || !cashier) throw new Error('run prisma db seed first (employee/user missing)');
  if (employee.userId !== cashier.id) {
    await db.employee.update({ where: { id: employee.id }, data: { userId: cashier.id } });
    console.log('linked user_cashier_1 ->', employee.id);
  } else {
    console.log('employee link already present');
  }

  // 2. Review cycle with a submitted review for the linked employee.
  let cycle = await db.reviewCycle.findFirst({ where: { name: 'H1 2026 QA Cycle' } });
  if (!cycle) {
    cycle = await db.reviewCycle.create({
      data: {
        organizationId: cashier.organizationId,
        storeId: 'store_juja_main',
        name: 'H1 2026 QA Cycle',
        periodStart: new Date('2026-01-01'),
        periodEnd: new Date('2026-06-30'),
        status: 'ACTIVE',
      },
    });
    console.log('cycle created', cycle.id);
  }
  let review = await db.performanceReview.findFirst({ where: { cycleId: cycle.id, employeeId: employee.id } });
  if (!review) {
    review = await db.performanceReview.create({
      data: {
        cycleId: cycle.id,
        employeeId: employee.id,
        reviewerUserId: 'user_super_admin',
        overallRating: 4,
        strengths: 'Reliable on the loading bay; keeps the yard organised.',
        improvements: 'Arrive before the 8am truck window.',
        status: 'SUBMITTED',
      },
    });
    console.log('review created (SUBMITTED)', review.id);
  }

  // 3. POS-sourced goal: David sells through user_cashier_1's transactions.
  let goal = await db.goal.findFirst({ where: { employeeId: employee.id, title: 'QA July sales target' } });
  if (!goal) {
    goal = await db.goal.create({
      data: {
        employeeId: employee.id,
        cycleId: cycle.id,
        title: 'QA July sales target',
        metricSource: 'SALES_TOTAL',
        targetValue: 50000,
        status: 'OPEN',
      },
    });
    console.log('goal created', goal.id);
  }

  // 4. Asset assignment (overdue on purpose).
  let asset = await db.assetAssignment.findFirst({ where: { employeeId: employee.id, assetName: 'Pallet jack QA-01' } });
  if (!asset) {
    asset = await db.assetAssignment.create({
      data: {
        employeeId: employee.id,
        storeId: 'store_juja_main',
        assetName: 'Pallet jack QA-01',
        assetTag: 'MBM-AST-QA01',
        assignedOn: new Date('2026-01-10'),
        dueReturnOn: new Date(Date.now() - 86400000),
        conditionOut: 'Good',
        status: 'ASSIGNED',
      },
    });
    console.log('asset created', asset.id);
  }

  // 5. Disciplinary: an already-expired WARNING (sweep test) + a RESTRICTED GRIEVANCE.
  let expiredWarning = await db.disciplinaryCase.findFirst({ where: { employeeId: employee.id, type: 'WARNING' } });
  if (!expiredWarning) {
    expiredWarning = await db.disciplinaryCase.create({
      data: {
        employeeId: employee.id,
        storeId: 'store_juja_main',
        type: 'WARNING',
        severity: 2,
        description: 'Late three times during the week of the stock take.',
        status: 'OPEN',
        issuedOn: new Date('2026-05-01'),
        expiresOn: new Date(Date.now() - 7 * 86400000),
        confidentiality: 'STANDARD',
        createdByUserId: 'user_super_admin',
      },
    });
    console.log('expired warning created', expiredWarning.id);
  }
  let grievance = await db.disciplinaryCase.findFirst({ where: { employeeId: employee.id, type: 'GRIEVANCE' } });
  if (!grievance) {
    grievance = await db.disciplinaryCase.create({
      data: {
        employeeId: employee.id,
        storeId: 'store_juja_main',
        type: 'GRIEVANCE',
        severity: 1,
        description: 'Shift rota dispute raised with the supervisor on Friday.',
        status: 'OPEN',
        issuedOn: new Date(),
        confidentiality: 'RESTRICTED',
        createdByUserId: 'user_super_admin',
      },
    });
    console.log('grievance created', grievance.id);
  }

  const sales = await db.salesTransaction.count({ where: { cashierId: cashier.id, paymentStatus: 'COMPLETED', transactionType: 'SALE' } });
  console.log('completed sales for cashier (POS goal source):', sales);
  console.log('STAGE G QA SEED DONE');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
