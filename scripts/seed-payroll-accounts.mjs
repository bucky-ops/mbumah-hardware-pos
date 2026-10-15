#!/usr/bin/env node
/**
 * seed-payroll-accounts.mjs
 *
 * Idempotently upserts the payroll statutory liability and employer expense
 * accounts for every organization. Safe to run repeatedly: existing rows are
 * never modified (update: {}) and only missing rows are created. Never drops,
 * truncates, or alters any table.
 *
 * Used by:
 *   - vercel-build (after sync-db-schema) so production databases gain the
 *     payroll chart of accounts during deployment.
 *   - Operators on local desktop mode: node scripts/seed-payroll-accounts.mjs
 *
 * Environment behavior (matches scripts/backfill-store-slugs.mjs): when the
 * Prisma client is unavailable or the database is unreachable (for example a
 * CI build check with a placeholder DATABASE_URL), the script soft-skips with
 * a warning and exits 0 so it never breaks a deploy.
 *
 * Accounts created (codes reserved for the EMS payroll engine):
 *   2210 PAYE Payable                2240 Net Pay Payable
 *   2215 NSSF Payable                2250 Other Deductions Payable
 *   2220 SHIF Payable                2260 Payroll Clearing
 *   2225 Housing Levy Payable        5210 Employer NSSF Expense
 *   2230 HELB Payable                5215 Employer Housing Levy Expense
 */

const PAYROLL_ACCOUNTS = [
  { code: '2210', name: 'PAYE Payable', type: 'LIABILITY', subType: 'STATUTORY_LIABILITY', normalBalance: 'CREDIT' },
  { code: '2215', name: 'NSSF Payable', type: 'LIABILITY', subType: 'STATUTORY_LIABILITY', normalBalance: 'CREDIT' },
  { code: '2220', name: 'SHIF Payable', type: 'LIABILITY', subType: 'STATUTORY_LIABILITY', normalBalance: 'CREDIT' },
  { code: '2225', name: 'Housing Levy Payable', type: 'LIABILITY', subType: 'STATUTORY_LIABILITY', normalBalance: 'CREDIT' },
  { code: '2230', name: 'HELB Payable', type: 'LIABILITY', subType: 'STATUTORY_LIABILITY', normalBalance: 'CREDIT' },
  { code: '2240', name: 'Net Pay Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
  { code: '2250', name: 'Other Deductions Payable', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
  { code: '2260', name: 'Payroll Clearing', type: 'LIABILITY', subType: 'CURRENT_LIABILITY', normalBalance: 'CREDIT' },
  { code: '5210', name: 'Employer NSSF Expense', type: 'EXPENSE', subType: 'PAYROLL_EXPENSE', normalBalance: 'DEBIT' },
  { code: '5215', name: 'Employer Housing Levy Expense', type: 'EXPENSE', subType: 'PAYROLL_EXPENSE', normalBalance: 'DEBIT' },
];

async function main() {
  // Lazy import: the Prisma client is generated for the ACTIVE provider at
  // whatever stage runs this (sqlite locally, postgres on Vercel/Neon).
  let prisma;
  try {
    const mod = await import('@prisma/client');
    prisma = new mod.PrismaClient();
  } catch (err) {
    console.warn('[payroll-accounts] Prisma client unavailable, skipping:', err?.message || err);
    process.exit(0); // soft-skip: never break a deploy that has no client yet
  }

  try {
    const organizations = await prisma.organization.findMany({
      select: { id: true, name: true },
    });

    if (organizations.length === 0) {
      console.log('[payroll-accounts] no organizations found, nothing to do.');
      return;
    }

    const orgIds = organizations.map((o) => o.id);
    const codes = PAYROLL_ACCOUNTS.map((a) => a.code);
    const before = await prisma.account.count({
      where: { code: { in: codes }, organizationId: { in: orgIds } },
    });

    for (const org of organizations) {
      for (const acct of PAYROLL_ACCOUNTS) {
        await prisma.account.upsert({
          where: {
            organizationId_code: { organizationId: org.id, code: acct.code },
          },
          create: { organizationId: org.id, ...acct },
          update: {},
        });
      }
    }

    const nowPresent = await prisma.account.count({
      where: { code: { in: codes }, organizationId: { in: orgIds } },
    });
    const expected = organizations.length * codes.length;

    console.log(
      `[payroll-accounts] ${organizations.length} organization(s) checked, ` +
        `${nowPresent - before} account(s) created, ${nowPresent}/${expected} payroll accounts present.`,
    );
    if (nowPresent !== expected) {
      console.error(
        '[payroll-accounts] some payroll accounts are missing after upsert. ' +
          'Inspect the accounts table for organization/code conflicts.',
      );
      process.exitCode = 1;
    }
  } catch (err) {
    // DB unreachable during a build (CI): soft-skip like sync-db-schema does.
    console.warn('[payroll-accounts] database unavailable, skipping:', err?.message || err);
    process.exit(0);
  } finally {
    await prisma?.$disconnect?.().catch(() => {});
  }
}

main().catch((error) => {
  console.error('[payroll-accounts] unexpected failure:', error?.message || error);
  process.exit(1);
});
