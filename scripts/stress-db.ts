// scripts/stress-db.ts — Database Performance Audit (directive 3).
//
// Seeds an ISOLATED SQLite database (db/stress.db — never the live custom.db)
// with a high-volume synthetic dataset, then benchmarks the four mandated
// search vectors and proves index usage via EXPLAIN QUERY PLAN:
//
//   V1  Product by [barcode]                    (UNIQUE index via @unique)
//   V2  Transaction by [branchId, createdAt]    (mandated composite)
//   V3  Transaction by [customerId, status]     (mandated composite)
//   V4  DebtInstallment by [dueDate, status]    (mandated composite)
//
// Usage:
//   DATABASE_URL must point at a FRESH db/stress.db pushed from the schema:
//     rm -f db/stress.db && DATABASE_URL="file:/home/z/my-project/db/stress.db" \
//       bunx prisma db push --skip-generate
//     bun run scripts/stress-db.ts [--skus=10000] [--sales=100000] [--batch=1000]
//
// The script overrides the datasource URL itself (absolute path), disables
// query logging, seeds in bounded batches (memory-safe on the 4 GB pod), runs
// ANALYZE for planner statistics, and prints a p50/p95 latency report.

import { Prisma, PrismaClient } from "@prisma/client";

const STRESS_URL = "file:/home/z/my-project/db/stress.db";

const args = process.argv.slice(2);
const arg = (name: string, def: number): number => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Math.max(1, Math.trunc(Number(hit.split("=")[1]) || def)) : def;
};
const SKU_COUNT = arg("skus", 10_000);
const SALE_COUNT = arg("sales", 100_000);
const BATCH = Math.min(2_000, arg("batch", 1_000));

const p = new PrismaClient({
  datasources: { db: { url: STRESS_URL } },
  log: [], // silent — query logging would drown a 250k-row seed
});

// ── Deterministic PRNG (reproducible runs) ──────────────────────────────────
let seed = 0x6d62756d; // "mbum"
function rnd(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 1_000_000) / 1_000_000;
}
const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const randInt = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

const DAY_MS = 86_400_000;
const NOW = Date.now();
const daysAgo = (n: number): Date => new Date(NOW - Math.floor(rnd() * n) * DAY_MS);

const CATEGORIES = ["Hand Tools", "Power Tools", "Fasteners", "Plumbing", "Electrical", "Paint", "Safety", "Garden"];
const UNITS = ["PCS", "BOX", "KG", "M", "LTR"];
const STATUSES = ["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED", "CREDIT", "PARTIAL"] as const; // 4:1:1
const METHODS = ["CASH", "MPESA", "BANK_TRANSFER"] as const;

async function main(): Promise<void> {
  const t0 = performance.now();
  console.log(`stress-db → skus=${SKU_COUNT} sales=${SALE_COUNT} batch=${BATCH}`);

  // ── Minimal org scaffold ──────────────────────────────────────────────────
  const branch = await p.branch.create({
    data: { code: "STRESS", name: "Stress Test Branch", location: "Benchmark" },
  });
  const user = await p.user.create({
    data: {
      email: "stress@mbumah.co.ke",
      name: "Stress Runner",
      role: "CASHIER",
      passwordHash: "stress:not-a-real-hash",
      branchId: branch.id,
    },
  });
  const customers = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      p.customer.create({
        data: { name: `Stress Customer ${i + 1}`, branchId: branch.id, creditLimit: "50000" },
        select: { id: true },
      })
    )
  );
  const customerIds = customers.map((c) => c.id);
  console.log(`scaffold: 1 branch, 1 user, ${customerIds.length} customers (${Math.round(performance.now() - t0)}ms)`);

  // ── 10k SKUs (batched createMany) ─────────────────────────────────────────
  const tSku = performance.now();
  for (let off = 0; off < SKU_COUNT; off += BATCH) {
    const n = Math.min(BATCH, SKU_COUNT - off);
    await p.product.createMany({
      data: Array.from({ length: n }, (_, i) => {
        const idx = off + i;
        const bp = randInt(50, 15_000);
        return {
          sku: `STR-${String(idx).padStart(6, "0")}`,
          barcode: `62${String(1000000000 + idx)}`, // unique
          name: `Stress SKU ${idx} — ${pick(CATEGORIES)}`,
          category: pick(CATEGORIES),
          unit: pick(UNITS),
          buyingPrice: bp,
          sellingPrice: Math.round(bp * 1.25),
          stockQty: randInt(0, 500),
          reorderLevel: randInt(3, 20),
          taxCategory: "B",
          branchId: branch.id,
        };
      }),
    });
  }
  const skuMs = performance.now() - tSku;
  console.log(`skus: ${SKU_COUNT} rows in ${Math.round(skuMs)}ms (${Math.round(SKU_COUNT / (skuMs / 1000))}/s)`);

  const productIds = (
    await p.product.findMany({ where: { branchId: branch.id }, select: { id: true } })
  ).map((r) => r.id);

  // ── 100k sales + ~250k items + payments (batched, low-memory) ─────────────
  const tSale = performance.now();
  for (let off = 0; off < SALE_COUNT; off += BATCH) {
    const n = Math.min(BATCH, SALE_COUNT - off);
    const ymd = daysAgo(365);
    const refs: string[] = [];
    const rows = Array.from({ length: n }, (_, i) => {
      const idx = off + i;
      const ref = `MBM-STR-${String(idx).padStart(7, "0")}`;
      refs.push(ref);
      const total = randInt(200, 120_000);
      const status = pick(STATUSES);
      const paid = status === "COMPLETED" ? total : status === "CREDIT" ? 0 : Math.round(total * 0.4);
      return {
        ref,
        type: "SALE",
        status,
        branchId: branch.id,
        userId: user.id,
        customerId: rnd() < 0.35 ? pick(customerIds) : null,
        subtotal: total,
        discountAmount: 0,
        vatAmount: Math.round((total / 1.16) * 0.16 * 100) / 100,
        totalAmount: total,
        amountPaid: paid,
        balanceDue: total - paid,
        vatInclusive: true,
        createdAt: new Date(NOW - Math.floor(rnd() * 365) * DAY_MS), // 365-day spread
      };
    });
    await p.transaction.createMany({ data: rows });
    // Attach items/payments to THIS batch only → bounded memory.
    const idRows = await p.transaction.findMany({
      where: { ref: { in: refs } },
      select: { id: true, totalAmount: true },
    });
    const items: { data: Prisma.TransactionItemCreateManyInput[] } = { data: [] };
    const payments: { data: Prisma.PaymentCreateManyInput[] } = { data: [] };
    for (const t of idRows) {
      const lineCount = randInt(1, 4);
      for (let l = 0; l < lineCount; l++) {
        const pid = pick(productIds);
        const qty = randInt(1, 10);
        const price = randInt(100, 8_000);
        const net = qty * price;
        items.data.push({
          transactionId: t.id,
          productId: pid,
          description: `Stress line ${l + 1}`,
          uom: "PCS",
          qty,
          unitPrice: price,
          lineDiscount: 0,
          lineNet: net,
          vatAmount: Math.round(net / 1.16 * 0.16 * 100) / 100,
          lineTotal: net,
          taxCategory: "B",
          unitCost: Math.round(price * 0.8),
        });
      }
      if (String(t.totalAmount) !== "0") {
        payments.data.push({
          transactionId: t.id,
          branchId: branch.id,
          method: pick(METHODS),
          amount: t.totalAmount,
          status: "COMPLETED",
        });
      }
    }
    await p.transactionItem.createMany({ data: items.data });
    if (payments.data.length) await p.payment.createMany({ data: payments.data });
    if ((off + n) % 20_000 === 0 || off + n === SALE_COUNT) {
      console.log(`  sales ${off + n}/${SALE_COUNT} (${Math.round(performance.now() - tSale)}ms)`);
    }
  }
  const saleMs = performance.now() - tSale;
  const itemCount = await p.transactionItem.count();
  console.log(
    `sales: ${SALE_COUNT} txns + ${itemCount} items in ${Math.round(saleMs)}ms (${Math.round(SALE_COUNT / (saleMs / 1000))} txn/s)`
  );

  // ── Debt plan installments (drives the [dueDate, status] vectors) ───────
  // Realistic distribution: plans span 2 years of 12 monthly installments,
  // paid history dominates (~90% of aged installments are PAID), only a
  // small live arrears bucket remains — matching steady-state operations.
  const tInst = performance.now();
  const account = await p.creditAccount.create({
    data: { customerId: customerIds[0], branchId: branch.id, creditLimit: "50000", totalDebt: "0" },
  });
  const planCount = 2_000;
  for (let off = 0; off < planCount; off += BATCH) {
    const n = Math.min(BATCH, planCount - off);
    await p.debtPlan.createMany({
      data: Array.from({ length: n }, () => ({
        creditAccountId: account.id,
        branchId: branch.id,
        totalAmount: 120_000,
        balanceRemaining: 120_000,
        startDate: daysAgo(730),
        dueDate: new Date(NOW + 30 * DAY_MS),
      })),
    });
    const plans = await p.debtPlan.findMany({
      where: { creditAccountId: account.id },
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: off + n,
    });
    const usePlans = plans.slice(0, off + n);
    const instRows = usePlans.flatMap((pl) =>
      Array.from({ length: 12 }, (_, seq) => {
        // planStart ∈ last 730d; installment seq falls at start + seq×30d.
        const planStart = NOW - Math.floor(rnd() * 730) * DAY_MS;
        const due = new Date(planStart + seq * 30 * DAY_MS);
        const isPast = due.getTime() < NOW - 7 * DAY_MS;
        let status: string;
        if (isPast) {
          const r = rnd();
          status = r < 0.9 ? "PAID" : r < 0.96 ? "OVERDUE" : "PARTIAL"; // ~9% live arrears
        } else if (due.getTime() < NOW) {
          const r = rnd();
          status = r < 0.7 ? "PAID" : r < 0.88 ? "OVERDUE" : "PARTIAL"; // recently due
        } else {
          status = "PENDING"; // future
        }
        return {
          debtPlanId: pl.id,
          seq: seq + 1,
          dueDate: due,
          amountDue: 10_000,
          amountPaid: status === "PAID" ? 10_000 : status === "PARTIAL" ? 4_000 : 0,
          status,
        };
      })
    );
    await p.debtInstallment.createMany({ data: instRows });
  }
  const instCount = await p.debtInstallment.count();
  console.log(`installments: ${instCount} rows in ${Math.round(performance.now() - tInst)}ms`);

  // ── Planner statistics (production hygiene; SQLite: ANALYZE) ─────────────
  await p.$executeRawUnsafe("ANALYZE");
  console.log("ANALYZE done — planner statistics refreshed\n");

  // ── Benchmarks ─────────────────────────────────────────────────────────────
  interface Bench {
    label: string;
    sql: string;
    params: unknown[];
    plan: string; // EXPLAIN QUERY PLAN must show the mandated index
    n: number;
  }
  const barcode = await p.$queryRawUnsafe<{ barcode: string }[]>(
    `SELECT barcode FROM Product WHERE barcode IS NOT NULL LIMIT 1`
  );
  const custId = pick(customerIds);
  const bench: Bench[] = [
    {
      label: "V1 barcode lookup (Product @unique index)",
      sql: `SELECT id, name FROM Product WHERE barcode = ?`,
      params: [barcode[0]?.barcode ?? "621000000000"],
      plan: `EXPLAIN QUERY PLAN SELECT id, name FROM Product WHERE barcode = 'X'`,
      n: 200,
    },
    {
      label: "V2 branch sales window ([branchId, createdAt])",
      sql: `SELECT id, totalAmount FROM "Transaction" WHERE branchId = ? AND createdAt >= ? AND createdAt < ? ORDER BY createdAt DESC LIMIT 100`,
      params: [branch.id, new Date(NOW - 30 * DAY_MS), new Date(NOW)],
      plan: `EXPLAIN QUERY PLAN SELECT id FROM "Transaction" WHERE branchId = 'X' AND createdAt >= '2020-01-01'`,
      n: 200,
    },
    {
      label: "V3 customer receivables ([customerId, status])",
      sql: `SELECT id, balanceDue FROM "Transaction" WHERE customerId = ? AND status IN ('CREDIT','PARTIAL')`,
      params: [custId],
      plan: `EXPLAIN QUERY PLAN SELECT id FROM "Transaction" WHERE customerId = 'X' AND status IN ('CREDIT','PARTIAL')`,
      n: 200,
    },
    {
      label: "V4a due installments — mandated vector ([dueDate, status])",
      sql: `SELECT id, amountDue FROM DebtInstallment WHERE dueDate <= ? AND status IN ('PENDING','PARTIAL','OVERDUE')`,
      params: [new Date(NOW + 5 * DAY_MS)],
      plan: `EXPLAIN QUERY PLAN SELECT id FROM DebtInstallment WHERE dueDate <= '2026-01-01' AND status IN ('PENDING','OVERDUE')`,
      n: 200,
    },
    {
      label: "V4b penalty cron sweep ([status, dueDate])",
      sql: `SELECT id, amountDue FROM DebtInstallment WHERE status = 'OVERDUE' AND dueDate <= ?`,
      params: [new Date(NOW)],
      plan: `EXPLAIN QUERY PLAN SELECT id FROM DebtInstallment WHERE status = 'OVERDUE' AND dueDate <= '2026-01-01'`,
      n: 200,
    },
    {
      label: "V4c weekly aging digest — narrow window ([dueDate, status])",
      sql: `SELECT id, amountDue FROM DebtInstallment WHERE dueDate >= ? AND dueDate < ? AND status IN ('PENDING','PARTIAL')`,
      params: [new Date(NOW - 7 * DAY_MS), new Date(NOW + 5 * DAY_MS)],
      plan: `EXPLAIN QUERY PLAN SELECT id FROM DebtInstallment WHERE dueDate >= '2026-01-01' AND dueDate < '2026-02-01' AND status IN ('PENDING','PARTIAL')`,
      n: 200,
    },
  ];

  console.log("── EXPLAIN QUERY PLAN (index proof) ──");
  const latencies: number[][] = [];
  for (const b of bench) {
    const plans = await p.$queryRawUnsafe<{ detail: string }[]>(b.plan);
    const using = plans
      .map((r) => r.detail)
      .find((d) => d.includes("USING INDEX") || d.includes("USING COVERING INDEX"));
    console.log(`${b.label}\n    ${using ?? `⚠ NO INDEX USED: ${plans.map((r) => r.detail).join(" | ")}`}`);
    // Warm-up ×5 then timed runs.
    for (let w = 0; w < 5; w++) await p.$queryRawUnsafe(b.sql, ...b.params);
    const times: number[] = [];
    for (let i = 0; i < b.n; i++) {
      const s = performance.now();
      await p.$queryRawUnsafe(b.sql, ...b.params);
      times.push(performance.now() - s);
    }
    times.sort((a, c) => a - c);
    latencies.push(times);
  }

  console.log("\n── LATENCY (ms, 200 runs each) ──");
  console.log("vector".padEnd(58), "p50", "p95", "mean");
  bench.forEach((b, i) => {
    const t = latencies[i];
    const p50 = t[Math.floor(t.length / 2)].toFixed(2);
    const p95 = t[Math.floor(t.length * 0.95)].toFixed(2);
    const mean = (t.reduce((s, x) => s + x, 0) / t.length).toFixed(2);
    console.log(b.label.padEnd(58), p50.padStart(6), p95.padStart(6), mean.padStart(6));
  });

  const total = Math.round(performance.now() - t0);
  console.log(
    `\nDONE in ${Math.floor(total / 60_000)}m${Math.round((total % 60_000) / 1000)}s — dataset preserved at db/stress.db`
  );
}

main()
  .catch((err) => {
    console.error("stress-db FAILED:", err);
    process.exitCode = 1;
  })
  .finally(() => p.$disconnect());
