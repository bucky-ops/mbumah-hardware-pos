import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const MODELS = [
  "product",
  "customer",
  "transaction",
  "payment",
  "debtPlan",
  "debtInstallment",
  "creditLedger",
  "creditAccount",
  "guarantor",
  "smsLog",
  "mpesaTransaction",
  "user",
  "auditLog",
  "stockAdjustment",
  "cashDrawerSession",
] as const;

async function main() {
  const out: Record<string, number> = {};
  const store = db as unknown as Record<string, { count(): Promise<number> }>;
  for (const m of MODELS) {
    out[m] = await store[m].count();
  }
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
