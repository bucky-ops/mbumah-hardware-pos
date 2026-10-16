// One-off QA seed for the :3100 hermetic dev database (v2.20.0 Stage H):
// posts stored payroll lines (P10 source), an approved-then-terminated
// employee (turnover), an accepted offer applicant (time-to-hire), and a
// pending erasure request. Run AFTER prisma db seed + qa-seed-payroll-dev.
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } },
});

async function main() {
  const storeId = 'store_juja_main';
  const orgId = (await db.store.findUnique({ where: { id: storeId }, select: { organizationId: true } }))?.organizationId;
  if (!orgId) throw new Error('store not found');

  // 1. A payroll period + POSTED run with stored lines for 2026 (P10 source).
  let period = await db.payrollPeriod.findFirst({ where: { storeId, name: 'September 2026' } });
  if (!period) {
    period = await db.payrollPeriod.create({
      data: {
        storeId,
        name: 'September 2026',
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-30'),
        payDate: new Date('2026-10-02'),
        status: 'PAID',
        periodType: 'MONTHLY',
      },
    });
    console.log('period created', period.id);
  }
  let run = await db.payrollRun.findFirst({ where: { payrollPeriodId: period.id, status: 'POSTED' } });
  if (!run) {
    run = await db.payrollRun.create({
      data: {
        storeId,
        payrollPeriodId: period.id,
        runType: 'STANDARD',
        status: 'POSTED',
        initiatedBy: 'user_super_admin',
        processedAt: new Date('2026-10-02'),
        paidAt: new Date('2026-10-02'),
        totalGross: 236000,
        totalDeductions: 62227.4,
        totalNet: 173772.6,
        employeeCount: 2,
      },
    });
    const lines = [
      { emp: 'emp_mary_wanjiku', gross: 158000, net: 116772.6, ded: 41227.4, paye: 30120, nssf: 4320, nhif: 3400, ahl: 2370 },
      { emp: 'emp_grace_achieng', gross: 78000, net: 57000, ded: 21000, paye: 14500, nssf: 2160, nhif: 1700, ahl: 1170 },
    ];
    for (const [i, l] of lines.entries()) {
      const emp = await db.employee.findUnique({ where: { id: l.emp }, select: { employeeCode: true } });
      await db.payrollDetail.create({
        data: {
          storeId,
          payrollRunId: run.id,
          employeeId: l.emp,
          basicSalary: l.gross * 0.7,
          houseAllowance: l.gross * 0.2,
          transportAllowance: l.gross * 0.1,
          grossPay: l.gross,
          paye: l.paye,
          nssf: l.nssf,
          nhif: l.nhif,
          housingLevy: l.ahl,
          totalDeductions: l.ded,
          netPay: l.net,
          daysWorked: 22,
          daysPresent: 22,
          // Full-shaped StoredPayslipResult (v2.21.0): the payslip view parses
          // this first and falls back to the stored columns when it does not
          // match, so the stub must carry the real cents to render amounts.
          computationTrace: JSON.stringify({
            grossCents: Math.round(l.gross * 100),
            totalDeductionsCents: Math.round(l.ded * 100),
            netCents: Math.round(l.net * 100),
            earnings: [
              { code: 'BASIC', label: 'Basic salary', amountCents: Math.round(l.gross * 0.7 * 100) },
              { code: 'HOUSE', label: 'House allowance', amountCents: Math.round(l.gross * 0.2 * 100) },
              { code: 'TRANSPORT', label: 'Transport allowance', amountCents: Math.round(l.gross * 0.1 * 100) },
            ],
            deductions: [
              { code: 'PAYE', label: 'PAYE income tax', amountCents: Math.round(l.paye * 100) },
              { code: 'SHIF', label: 'Social Health Insurance Fund', amountCents: Math.round(l.nhif * 100) },
              { code: 'AHL', label: 'Affordable Housing Levy', amountCents: Math.round(l.ahl * 100) },
              { code: 'NSSF_T1', label: 'NSSF (employee)', amountCents: Math.round(l.nssf * 100) },
            ],
            employerContributions: [],
            engineSteps: ['resolveRates', 'computePayslip'],
          }),
        },
      });
      void i;
      console.log('payslip line for', emp?.employeeCode ?? l.emp);
    }
    console.log('POSTED run created', run.id);
  }

  // 2. A terminated employee in the window (turnover register).
  let exited = await db.employee.findFirst({ where: { employeeCode: 'MBM-JUJ-E900' } });
  if (!exited) {
    exited = await db.employee.create({
      data: {
        storeId,
        firstName: 'Kevin',
        lastName: 'Njoroge',
        email: 'kevin.njoroge@mbumahhardware.co.ke',
        employeeCode: 'MBM-JUJ-E900',
        jobTitle: 'Store Hand',
        employmentType: 'CONTRACT',
        hireDate: new Date('2025-02-01'),
        terminationDate: new Date('2026-08-15'),
        status: 'TERMINATED',
        basicSalary: 30000,
      },
    });
    console.log('exited employee created', exited.employeeCode);
  }

  // 3. A converted applicant (time-to-hire) with an accepted offer.
  const job = await db.recruitmentJob.findFirst({ where: { storeId, deletedAt: null } });
  if (job) {
    let applicant = await db.applicant.findFirst({ where: { email: 'faith.wanzala@example.co.ke' } });
    if (!applicant) {
      applicant = await db.applicant.create({
        data: {
          jobId: job.id,
          storeId,
          fullName: 'Faith Wanzala',
          email: 'faith.wanzala@example.co.ke',
          status: 'HIRED',
          consentGrantedAt: new Date('2026-07-01'),
          convertedEmployeeId: 'emp_mary_wanjiku',
          createdAt: new Date('2026-07-01'),
        },
      });
      await db.offer.create({
        data: {
          applicantId: applicant.id,
          proposedSalaryCents: 15800000,
          startDate: new Date('2026-08-01'),
          status: 'ACCEPTED',
          sentAt: new Date('2026-07-20'),
          respondedAt: new Date('2026-07-28'),
          createdByUserId: 'user_super_admin',
        },
      });
      console.log('converted applicant + accepted offer created');
    }
  } else {
    console.log('no recruitment job seeded — time-to-hire will be empty (fine)');
  }

  // 4. A pending erasure request for the linked employee.
  let erasure = await db.erasureRequest.findFirst({ where: { employeeId: 'emp_david_otieno', status: 'PENDING' } });
  if (!erasure) {
    erasure = await db.erasureRequest.create({
      data: {
        organizationId: orgId,
        employeeId: 'emp_david_otieno',
        requestedByUserId: 'user_super_admin',
        status: 'PENDING',
      },
    });
    console.log('erasure request created', erasure.id);
  }

  console.log('STAGE H QA SEED DONE');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
