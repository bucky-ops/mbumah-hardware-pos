// E2E seed for v2.161.0: one ISSUED payslip for the portal QA user's employee
// (David Otieno, MBH-1-005, linked to cashier@mbumahhardware.co.ke). Creates
// a POSTED September 2026 run (idempotent on the period name + run) with one
// detail stamped payslipNumber + payslipIssuedAt — the happy path for the
// self-service PDF. The pre-existing October DRAFT detail stays untouched as
// the honest refusal path (409 NOT_ISSUED). Throwaway — QA only.
const { PrismaClient } = require('/home/z/ems/node_modules/@prisma/client');
const db = new PrismaClient({ datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } } });

(async () => {
  const employee = await db.employee.findFirst({
    where: { deletedAt: null, status: 'ACTIVE', employeeCode: 'MBH-1-005' },
    select: { id: true, employeeCode: true, firstName: true, lastName: true, storeId: true },
  });
  if (!employee) throw new Error('MBH-1-005 not found');

  // The draft October run carries the store + period conventions we mirror.
  const draftDetail = await db.payrollDetail.findFirst({
    where: { employeeId: employee.id },
    include: { payrollRun: { select: { id: true, storeId: true, payrollPeriod: { select: { id: true, name: true, startDate: true, endDate: true } } } } },
  });
  if (!draftDetail) throw new Error('no existing detail for MBH-1-005');
  const storeId = draftDetail.payrollRun.storeId;

  const issued = await db.payrollDetail.findFirst({
    where: { employeeId: employee.id, payslipIssuedAt: { not: null } },
    select: { id: true, payslipNumber: true },
  });
  if (issued) {
    console.log(JSON.stringify({ already: true, ...issued }));
    return;
  }

  // Find or create the September 2026 period on the same store.
  let period = await db.payrollPeriod.findFirst({
    where: { name: 'September 2026', storeId },
    select: { id: true, name: true },
  });
  if (!period) {
    period = await db.payrollPeriod.create({
      data: {
        storeId,
        name: 'September 2026',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2026-09-30T00:00:00.000Z'),
        status: 'CLOSED',
      },
      select: { id: true, name: true },
    });
  }

  // Find or create the POSTED run for that period.
  let run = await db.payrollRun.findFirst({
    where: { payrollPeriodId: period.id, status: 'POSTED' },
    select: { id: true },
  });
  if (!run) {
    run = await db.payrollRun.create({
      data: {
        payrollPeriodId: period.id,
        storeId,
        runType: 'REGULAR',
        status: 'POSTED',
      },
      select: { id: true },
    });
  }

  const now = new Date();
  const detail = await db.payrollDetail.create({
    data: {
      payrollRunId: run.id,
      employeeId: employee.id,
      storeId,
      basicSalary: draftDetail.basicSalary,
      houseAllowance: draftDetail.houseAllowance,
      transportAllowance: draftDetail.transportAllowance,
      medicalAllowance: draftDetail.medicalAllowance,
      otherAllowances: draftDetail.otherAllowances,
      overtimePay: draftDetail.overtimePay,
      grossPay: draftDetail.grossPay,
      paye: draftDetail.paye,
      nssf: draftDetail.nssf,
      nhif: draftDetail.nhif,
      housingLevy: draftDetail.housingLevy,
      payeArrears: draftDetail.payeArrears,
      loanDeduction: draftDetail.loanDeduction,
      otherDeductions: draftDetail.otherDeductions,
      totalDeductions: draftDetail.totalDeductions,
      netPay: draftDetail.netPay,
      daysWorked: draftDetail.daysWorked || 24,
      daysPresent: draftDetail.daysPresent || 24,
      daysAbsent: draftDetail.daysAbsent || 0,
      daysOnLeave: draftDetail.daysOnLeave || 0,
      overtimeHours: draftDetail.overtimeHours,
      deductionsBreakdown: draftDetail.deductionsBreakdown,
      computationTrace: draftDetail.computationTrace,
      paymentStatus: 'PENDING',
      payslipNumber: 'PS-2026-0901',
      payslipIssuedAt: now,
    },
    select: { id: true, payslipNumber: true, payslipIssuedAt: true },
  });

  console.log(JSON.stringify({
    seeded: true,
    employee: { id: employee.id, code: employee.employeeCode },
    period: period.name,
    runId: run.id,
    issuedDetail: detail,
    draftDetailKept: draftDetail.id,
  }, null, 2));
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
