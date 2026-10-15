#!/usr/bin/env node
/**
 * seed-rate-tables.mjs
 *
 * Idempotently inserts the Kenyan statutory rate tables (as DATA, not code)
 * for every organization: PAYE bands, personal relief, NSSF Tier I and II,
 * SHIF, and the Affordable Housing Levy. Every table carries
 * verifyWithCounsel=true and an instrument reference: these are reviewable
 * defaults, not legal advice (docs/EMS_SECURITY_PRIVACY_NOTES.md,
 * docs/hr/payroll-rate-tables.md with the payroll release).
 *
 * Insert-only: an (organizationId, type, code, effectiveFrom) row that
 * already exists is never modified. New statutory periods are new rows.
 *
 * Environment behavior matches scripts/seed-payroll-accounts.mjs: soft-skip
 * with exit 0 when the database is unreachable (CI builds use a placeholder
 * DATABASE_URL). All bounds are integer cents.
 */

const EFFECTIVE_FROM = '2024-12-01T00:00:00.000Z';

function bandRows(bands) {
  return bands.map((b, i) => ({
    order: i,
    lowerBoundCents: b.from,
    upperBoundCents: b.to ?? null,
    rateBps: b.rateBps ?? null,
    flatAmountCents: b.flat ?? null,
    reliefCents: b.relief ?? null,
    employerMatchBps: b.matchBps ?? null,
  }));
}

const RATE_TABLES = [
  {
    type: 'PAYE',
    code: 'PAYE-MONTHLY-2024',
    label: 'PAYE monthly bands (Kenya, Finance Act 2023 rates)',
    basis: 'MONTHLY',
    instrumentReference: 'Finance Act 2023, First Schedule to the Income Tax Act (as applied from Dec 2024)',
    rows: bandRows([
      { from: 0, to: 2_400_000, rateBps: 1000 },          // 0 - 24,000 KES @ 10%
      { from: 2_400_000, to: 3_233_300, rateBps: 2500 },  // 24,000 - 32,333 KES @ 25%
      { from: 3_233_300, to: 50_000_000, rateBps: 3000 }, // 32,333 - 500,000 KES @ 30%
      { from: 50_000_000, to: 80_000_000, rateBps: 3250 },// 500,000 - 800,000 KES @ 32.5%
      { from: 80_000_000, rateBps: 3500 },                // above 800,000 KES @ 35%
    ]),
  },
  {
    type: 'PERSONAL_RELIEF',
    code: 'RELIEF-MONTHLY-2024',
    label: 'Personal tax relief (KES 2,400 per month)',
    basis: 'MONTHLY',
    instrumentReference: 'Finance Act 2023, Income Tax Act section 30 (as applied from Dec 2024)',
    rows: bandRows([{ from: 0, relief: 240_000 }]), // 2,400 KES = 240,000 cents
  },
  {
    type: 'NSSF_TIER1',
    code: 'NSSF-T1-2024',
    label: 'NSSF Tier I (6% of first KES 8,000, employee and employer)',
    basis: 'MONTHLY',
    instrumentReference: 'NSSF Act 2013, Fourth Schedule (post-Feb 2025 rates upheld by Court of Appeal)',
    rows: bandRows([{ from: 0, to: 800_000, rateBps: 600, matchBps: 600 }]), // ceiling 8,000 KES
  },
  {
    type: 'NSSF_TIER2',
    code: 'NSSF-T2-2024',
    label: 'NSSF Tier II (6% of KES 8,000 to 72,000, employee and employer)',
    basis: 'MONTHLY',
    instrumentReference: 'NSSF Act 2013, Fourth Schedule (post-Feb 2025 rates upheld by Court of Appeal)',
    rows: bandRows([{ from: 800_000, to: 7_200_000, rateBps: 600, matchBps: 600 }]),
  },
  {
    type: 'SHIF',
    code: 'SHIF-2024',
    label: 'Social Health Insurance Fund (2.5% of gross, minimum KES 300)',
    basis: 'MONTHLY',
    instrumentReference: 'Social Health Insurance Act 2023, section 17 (as applied from Dec 2024)',
    rows: bandRows([{ from: 0, rateBps: 250, flat: 30_000 }]), // min contribution 300 KES
  },
  {
    type: 'HOUSING_LEVY',
    code: 'AHL-2024',
    label: 'Affordable Housing Levy (1.5% of gross, matched by employer)',
    basis: 'MONTHLY',
    instrumentReference: 'Affordable Housing Act 2024, section 4 (as applied from Dec 2024)',
    rows: bandRows([{ from: 0, rateBps: 150, matchBps: 150 }]),
  },
];

async function main() {
  let prisma;
  try {
    const mod = await import('@prisma/client');
    prisma = new mod.PrismaClient();
  } catch (err) {
    console.warn('[rate-tables] Prisma client unavailable, skipping:', err?.message || err);
    process.exit(0);
  }

  try {
    const organizations = await prisma.organization.findMany({ select: { id: true } });
    if (organizations.length === 0) {
      console.log('[rate-tables] no organizations found, nothing to do.');
      return;
    }

    const effectiveFrom = new Date(EFFECTIVE_FROM);
    let created = 0;

    for (const org of organizations) {
      for (const table of RATE_TABLES) {
        const existing = await prisma.rateTable.findUnique({
          where: {
            organizationId_type_code_effectiveFrom: {
              organizationId: org.id,
              type: table.type,
              code: table.code,
              effectiveFrom,
            },
          },
          select: { id: true },
        });
        if (existing) continue; // insert-only: never touch an existing version

        await prisma.rateTable.create({
          data: {
            organizationId: org.id,
            type: table.type,
            code: table.code,
            label: table.label,
            basis: table.basis,
            instrumentReference: table.instrumentReference,
            verifyWithCounsel: true,
            effectiveFrom,
            rows: { create: table.rows },
          },
        });
        created += 1;
      }
    }

    const total = await prisma.rateTable.count({
      where: { organizationId: { in: organizations.map((o) => o.id) } },
    });
    console.log(
      `[rate-tables] ${organizations.length} organization(s), ${created} table(s) created, ${total} versions present.`,
    );
  } catch (err) {
    console.warn('[rate-tables] database unavailable, skipping:', err?.message || err);
    process.exit(0);
  } finally {
    await prisma?.$disconnect?.().catch(() => {});
  }
}

main().catch((error) => {
  console.error('[rate-tables] unexpected failure:', error?.message || error);
  process.exit(1);
});
