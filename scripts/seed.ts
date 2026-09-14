/**
 * Seed script — run with: bun scripts/seed.ts
 * Idempotent: wipes and recreates demo data.
 */
import { Prisma, PrismaClient } from "@prisma/client";
import { encryptKraPin, encryptPII } from "../src/lib/crypto";
import { hashPassword } from "../src/lib/auth-utils";

const db = new PrismaClient();

// Deterministic LCG for stable demo data
let seedState = 42;
function rand(): number {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function between(min: number, max: number): number {
  return min + rand() * (max - min);
}

const CATEGORIES = [
  "Cement & Concrete", "Timber & Boards", "Steel & Rebar", "Plumbing",
  "Electrical", "Paint & Finishes", "Fasteners", "Hand Tools",
  "Power Tools", "Roofing", "Garden & Irrigation", "Safety & PPE",
];

const NOUNS: Record<string, string[]> = {
  "Cement & Concrete": ["Bamburi Nguvu Cement 32.5N 50kg", "Ready-Mix Concrete 20MPa", "Tile Adhesive 20kg", "Wall Plaster 25kg"],
  "Timber & Boards": ["Cypress Timber 2x4x14ft", "MDF Board 18mm 8x4", "Plywood 12mm 8x4", "Blockboard 9mm 8x4", "Mahogany Timber 1x12x12ft"],
  "Steel & Rebar": ["Y12 Deformed Bar 12m", "Y16 Deformed Bar 12m", "Square Tube 2x2 6m", "Angle Iron 40x40 6m", "Binding Wire 25kg"],
  Plumbing: ["PVC Pipe 4inch x 6m", "PVC Elbow 2inch", "Kitchen Mixer Tap", "Toilet Suite P-Trap", "Water Tank 1000L", "PPR Pipe 20mm 4m"],
  Electrical: ["Twin Twisted Cable 1.5mm 100m", "Socket Outlet 13A", "LED Bulb 9W E27", "DB Box 8-Way", "Circuit Breaker 32A", "Solar Panel 150W"],
  "Paint & Finishes": ["Crown Silk Vinyl 20L White", "Undercoat 4L", "Gloss Enamel 4L Brown", "Wall Putty 20kg", "Wood Varnish 4L"],
  Fasteners: ["Wire Nails 4inch 25kg", "Roofing Nails 3inch 12kg", "Wood Screws 4x40 Box", "Hinges 4inch Pair", "Bolts M12x100 Box", "Nuts M12 Box"],
  "Hand Tools": ["Claw Hammer 500g", "Adjustable Spanner 12inch", "Spirit Level 60cm", "Screwdriver Set 6pc", "Trowel Steel 8inch", "Wheelbarrow Heavy Duty"],
  "Power Tools": ["Angle Grinder 850W", "Impact Drill 650W", "Circular Saw 1400W", "Jig Saw 600W", "Heat Gun 2000W"],
  Roofing: ["IT4 Charcoal Sheets", "Ridge Cap 2m", "Roofing Nails Rubber Washer", "Gutter 4inch 6m", "Fascia Board 9inch"],
  "Garden & Irrigation": ["Drip Line 16mm 100m", "Sprinkler Pop-up", "Hose Pipe 20m", "Knapsack Sprayer 16L", "Garden Fork"],
  "Safety & PPE": ["Safety Boots Size 42", "Hard Hat White", "Dust Mask 50pc", "Work Gloves Leather", "Overall Navy XXL", "Hi-Vis Vest"],
};

const UNITS: Record<string, string> = {
  "Wire Nails 4inch 25kg": "KG",
  "Roofing Nails 3inch 12kg": "KG",
  "Binding Wire 25kg": "KG",
  "Drip Line 16mm 100m": "M",
  "Gutter 4inch 6m": "M",
  "IT4 Charcoal Sheets": "M",
};

const HS_CODES: Record<string, string> = {
  "Cement & Concrete": "2523.29.00",
  "Timber & Boards": "4418.75.00",
  "Steel & Rebar": "7214.20.00",
  Plumbing: "3917.23.00",
  Electrical: "8536.69.00",
  "Paint & Finishes": "3209.10.00",
  Fasteners: "7317.00.00",
  "Hand Tools": "8205.59.00",
  "Power Tools": "8467.22.00",
  Roofing: "7308.90.00",
  "Garden & Irrigation": "8424.89.00",
  "Safety & PPE": "6401.10.00",
};

const BUILDERS = ["Kamau Construction Ltd", "Njeri Developers", "Blue Valley Contractors", "Ochieng Building Works", "Tumaini Housing Project", "Skyline Hardware Retail"];

async function main() {
  console.log("Seeding Mbumah Hardware POS…");

  await db.smsLog.deleteMany();
  await db.guarantor.deleteMany();
  await db.creditLedger.deleteMany();
  await db.debtInstallment.deleteMany();
  await db.debtPlan.deleteMany();
  await db.creditAccount.deleteMany();
  await db.drawerMovement.deleteMany();
  await db.cashDrawerSession.deleteMany();
  await db.payment.deleteMany();
  await db.mpesaTransaction.deleteMany();
  await db.transactionItem.deleteMany();
  await db.transaction.deleteMany();
  await db.stockAdjustment.deleteMany();
  await db.product.deleteMany();
  await db.customer.deleteMany();
  await db.user.deleteMany();
  await db.branch.deleteMany();
  await db.auditLog.deleteMany();

  const [hq, west] = await Promise.all([
    db.branch.create({ data: { code: "HQ", name: "Mbumah HQ — Industrial Area", location: "Baba Dogo Rd, Nairobi", kraPin: "P051234567X" } }),
    db.branch.create({ data: { code: "WS", name: "Mbumah Westlands", location: "Ring Rd Parklands, Nairobi", kraPin: "P051234567X" } }),
  ]);

  const password = hashPassword("Mbumah@2025");
  const [owner, manager, cashierHq, cashierWest] = await Promise.all([
    db.user.create({ data: { email: "owner@mbumah.co.ke", name: "Jane Mbumah", role: "OWNER", passwordHash: password, branchId: hq.id } }),
    db.user.create({ data: { email: "manager@mbumah.co.ke", name: "David Kimani", role: "MANAGER", passwordHash: password, branchId: hq.id } }),
    db.user.create({ data: { email: "cashier@mbumah.co.ke", name: "Lucy Wanjiru", role: "CASHIER", passwordHash: password, branchId: hq.id } }),
    db.user.create({ data: { email: "cashier2@mbumah.co.ke", name: "Brian Otieno", role: "CASHIER", passwordHash: password, branchId: west.id } }),
  ]);

  // ── Products (~700 SKUs across 2 branches — proves list virtualization)
  const productData: Prisma.ProductCreateManyInput[] = [];
  let skuCounter = 0;
  for (const branch of [hq, west]) {
    const branchScale = branch.id === hq.id ? 1 : 0.7;
    for (const category of CATEGORIES) {
      const count = Math.round((18 + rand() * 26) * branchScale);
      for (let i = 0; i < count; i++) {
        skuCounter++;
        const name = pick(NOUNS[category]);
        const variant = ["", " (Pack of 10)", " (Premium)", " (Contractor Grade)", " (Economy)"][Math.floor(rand() * 5)];
        const buying = Math.round(between(80, 8500));
        const selling = Math.round(buying * between(1.15, 1.6));
        const unit = UNITS[name] ?? "PCS";
        const stockQty = unit === "KG" ? Math.round(between(5, 220) * 1000) / 1000 : Math.round(between(0, 320));
        const lowStock = rand() < 0.07;
        const isTaxExempt = category === "Safety & PPE" && rand() < 0.08;
        productData.push({
          sku: `MBM-${branch.code}-${String(skuCounter).padStart(4, "0")}`,
          barcode: `62${String(1000000000 + Math.floor(rand() * 8999999999)).slice(0, 10)}`,
          name: `${name}${variant}`,
          category,
          unit,
          buyingPrice: buying,
          sellingPrice: selling,
          stockQty: lowStock ? Math.round(between(0, 4) * 100) / 100 : stockQty,
          reorderLevel: lowStock ? 10 : Math.round(between(5, 30)),
          hsCode: HS_CODES[category],
          taxCategory: isTaxExempt ? "A" : "B",
          isTaxExempt,
          branchId: branch.id,
        });
      }
    }
  }
  await db.product.createMany({ data: productData });
  const hqProducts = await db.product.findMany({ where: { branchId: hq.id }, take: 400 });
  console.log(`Created ${productData.length} products`);

  // ── Customers (PII encrypted at rest with AES-256-GCM)
  const customerSeeds = [
    { name: BUILDERS[0], phone: "+254722345678", email: "accounts@kamaucon.co.ke", nid: "34567890", creditLimit: 300000, kraPin: "P051988776Q", risk: 82 },
    { name: BUILDERS[1], phone: "+254733222111", email: "info@njeridev.co.ke", nid: "23456781", creditLimit: 150000, kraPin: "P051345678Y", risk: 68 },
    { name: BUILDERS[2], phone: "+254711998877", email: "bluevalley@gmail.com", nid: "12345672", creditLimit: 80000, kraPin: null, risk: 55 },
    { name: BUILDERS[3], phone: "+254720554433", email: "ochiengbw@yahoo.com", nid: "45678903", creditLimit: 60000, kraPin: "A009876543Z", risk: 40 },
    { name: "Walk-in Retail", phone: "+254700000000", email: "walkin@mbumah.co.ke", nid: null, creditLimit: 0, kraPin: null, risk: 50 },
    { name: BUILDERS[4], phone: "+254745112233", email: "tumaini@project.or.ke", nid: "56789014", creditLimit: 120000, kraPin: "P051654321M", risk: 74 },
  ];
  const customers: Array<{ id: string }> = [];
  for (const c of customerSeeds) {
    const customer = await db.customer.create({
      data: {
        name: c.name,
        phoneEnc: encryptPII(c.phone),
        emailEnc: encryptPII(c.email),
        nationalIdEnc: c.nid ? encryptPII(c.nid) : null,
        kraPinEnc: encryptKraPin(c.kraPin)?.enc ?? null,
        kraPinHash: encryptKraPin(c.kraPin)?.hash ?? null,
        creditLimit: c.creditLimit,
        riskScore: c.risk,
        branchId: hq.id,
      },
    });
    // One CreditAccount per credit customer (anchor of the debt module)
    if (c.creditLimit > 0) {
      await db.creditAccount.create({
        data: { customerId: customer.id, branchId: hq.id, creditLimit: c.creditLimit, totalDebt: 0, status: "ACTIVE" },
      });
    }
    customers.push(customer);
  }

  // ── Today's transactions for EOD (CASH vs MPESA vs BANK_TRANSFER split)
  const today = new Date();
  const dayStart = new Date(today);
  dayStart.setHours(8, 15, 0, 0);
  const dayEnd = new Date(today);
  dayEnd.setHours(17, 45, 0, 0);
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  let txCounter = 0;
  const nextRef = () => `MBM-HQ-${ymd}-${String(++txCounter).padStart(4, "0")}`;

  type Plan = { methods: Array<"CASH" | "MPESA" | "BANK_TRANSFER">; customerIdx: number | null; itemCount: number };
  const salePlans: Plan[] = [];
  for (let i = 0; i < 14; i++) {
    const method = i % 5 === 1 ? "MPESA" : i % 7 === 3 ? "BANK_TRANSFER" : "CASH";
    salePlans.push({ methods: [method], customerIdx: rand() < 0.25 ? Math.floor(rand() * 3) : null, itemCount: 1 + Math.floor(rand() * 5) });
  }
  salePlans.push({ methods: ["CASH", "MPESA"], customerIdx: null, itemCount: 3 }); // split tender

  for (const plan of salePlans) {
    const items = Array.from({ length: plan.itemCount }, () => pick(hqProducts));
    const createdAt = new Date(dayStart.getTime() + rand() * (dayEnd.getTime() - dayStart.getTime()));
    const tx = await db.transaction.create({
      data: {
        ref: nextRef(), type: "SALE", status: "COMPLETED",
        branchId: hq.id, userId: cashierHq.id,
        customerId: plan.customerIdx !== null ? customers[plan.customerIdx].id : null,
        subtotal: 0, discountAmount: 0, vatAmount: 0, totalAmount: 0, vatInclusive: false,
        createdAt,
      },
    });
    let subtotal = 0, vatSum = 0;
    for (const p of items) {
      const qty = p.unit === "KG" ? Math.round(between(1, 8) * 1000) / 1000 : Math.floor(between(1, 6));
      const price = Number(p.sellingPrice);
      const lineNet = Math.round(qty * price * 100) / 100;
      const lineVat = Math.round(lineNet * 0.16 * 100) / 100;
      subtotal += lineNet;
      vatSum += lineVat;
      await db.transactionItem.create({
        data: {
          transactionId: tx.id, productId: p.id, description: p.name, uom: p.unit,
          qty, unitPrice: price, discountPct: 0, lineDiscount: 0, lineNet,
          vatAmount: lineVat, lineTotal: Math.round((lineNet + lineVat) * 100) / 100,
          taxCategory: p.taxCategory,
        },
      });
    }
    subtotal = Math.round(subtotal * 100) / 100;
    vatSum = Math.round(vatSum * 100) / 100;
    const total = Math.round((subtotal + vatSum) * 100) / 100;
    const perMethod = plan.methods.length > 1 ? [Math.round(total * 0.4), total - Math.round(total * 0.4)] : [total];
    await db.transaction.update({
      where: { id: tx.id },
      data: {
        subtotal, totalAmount: total, vatAmount: vatSum, discountAmount: 0,
        amountPaid: total, balanceDue: 0,
        payments: {
          create: plan.methods.map((m, idx) => ({
            branchId: hq.id, method: m, amount: perMethod[idx],
            reference: m === "MPESA" ? `Q${Math.floor(between(100000000, 999999999))}` : m === "BANK_TRANSFER" ? `FT${Math.floor(between(100000, 999999))}` : null,
            receivedAt: createdAt,
          })),
        },
      },
    });
  }

  // ── Credit sale (30 days ago) → CreditAccount charge + debt plan v2
  const creditCustomer = customers[0];
  const creditAccount = await db.creditAccount.findUniqueOrThrow({ where: { customerId: creditCustomer.id } });
  const creditItems = [hqProducts[0], hqProducts[5], hqProducts[12]];
  let creditTotal = 0;
  const creditTx = await db.transaction.create({
    data: {
      ref: `MBM-HQ-${ymd}-CRED`, type: "SALE", status: "CREDIT",
      branchId: hq.id, userId: manager.id, customerId: creditCustomer.id,
      subtotal: 0, totalAmount: 0, vatAmount: 0, amountPaid: 0, balanceDue: 0, vatInclusive: false,
      createdAt: new Date(Date.now() - 30 * 86400000),
    },
  });
  for (const p of creditItems) {
    const qty = 10;
    const lineNet = Math.round(Number(p.sellingPrice) * qty * 100) / 100;
    const lineVat = Math.round(lineNet * 0.16 * 100) / 100;
    creditTotal += lineNet;
    await db.transactionItem.create({
      data: {
        transactionId: creditTx.id, productId: p.id, description: p.name, uom: p.unit,
        qty, unitPrice: Number(p.sellingPrice), discountPct: 0, lineDiscount: 0, lineNet,
        vatAmount: lineVat, lineTotal: Math.round((lineNet + lineVat) * 100) / 100, taxCategory: p.taxCategory,
      },
    });
  }
  creditTotal = Math.round(creditTotal * 100) / 100;
  const creditVat = Math.round(creditTotal * 0.16 * 100) / 100;
  const creditGrand = Math.round((creditTotal + creditVat) * 100) / 100;
  await db.transaction.update({
    where: { id: creditTx.id },
    data: { subtotal: creditTotal, totalAmount: creditGrand, vatAmount: creditVat, balanceDue: creditGrand },
  });
  await db.payment.create({ data: { transactionId: creditTx.id, branchId: hq.id, method: "STORE_CREDIT", amount: creditGrand, status: "PENDING", receivedAt: new Date(Date.now() - 30 * 86400000) } });

  // Ledger: CHARGE the credit sale onto the account
  await db.creditLedger.create({
    data: {
      creditAccountId: creditAccount.id, transactionType: "CHARGE", amount: creditGrand,
      previousBalance: 0, newBalance: creditGrand, referenceId: `MBM-HQ-${ymd}-CRED`,
      note: "Site materials — 30-day credit sale", performedBy: manager.id,
    },
  });
  await db.customer.update({ where: { id: creditCustomer.id }, data: { currentBalance: creditGrand } });
  await db.creditAccount.update({ where: { id: creditAccount.id }, data: { totalDebt: creditGrand } });

  // Debt plan: down payment already made, 3 monthly installments, first PAID
  const installmentAmount = Math.round(((creditGrand - 20000) / 3) * 100) / 100;
  const plan = await db.debtPlan.create({
    data: {
      creditAccountId: creditAccount.id, saleId: `MBM-HQ-${ymd}-CRED`, branchId: hq.id,
      totalAmount: creditGrand, downPayment: 20000, balanceRemaining: creditGrand - 20000,
      installmentFrequency: "MONTHLY", interestRate: 0, lateFeeRate: 2, lateFeeFlat: 200,
      gracePeriodDays: 3,
      startDate: new Date(Date.now() - 25 * 86400000),
      dueDate: new Date(Date.now() + 65 * 86400000),
      notes: "Agreed repayment schedule after site-material credit sale",
      installments: {
        create: [
          { seq: 1, amountDue: installmentAmount, amountPaid: installmentAmount, dueDate: new Date(Date.now() - 5 * 86400000), status: "PAID" },
          { seq: 2, amountDue: installmentAmount, amountPaid: 0, dueDate: new Date(Date.now() + 25 * 86400000), status: "PENDING" },
          { seq: 3, amountDue: creditGrand - 20000 - 2 * installmentAmount, amountPaid: 0, dueDate: new Date(Date.now() + 55 * 86400000), status: "PENDING" },
        ],
      },
    },
  });
  // Ledger: down payment + first installment payment
  await db.creditLedger.create({
    data: {
      creditAccountId: creditAccount.id, transactionType: "PAYMENT", amount: 20000 + installmentAmount,
      previousBalance: creditGrand, newBalance: creditGrand - 20000 - installmentAmount,
      referenceId: plan.id, note: "Down payment + installment 1", performedBy: manager.id,
    },
  });
  await db.creditAccount.update({ where: { id: creditAccount.id }, data: { totalDebt: creditGrand - 20000 - installmentAmount } });
  await db.customer.update({ where: { id: creditCustomer.id }, data: { currentBalance: creditGrand - 20000 - installmentAmount } });

  // Guarantor for the contractor credit line
  await db.guarantor.create({
    data: {
      creditAccountId: creditAccount.id, name: "Peter Kamau Mwangi",
      phoneEnc: encryptPII("+254733445566"), nationalIdEnc: encryptPII("11223344"),
      guaranteedAmount: 100000,
    },
  });

  // ── Open drawer session at HQ
  const session = await db.cashDrawerSession.create({
    data: { branchId: hq.id, userId: cashierHq.id, openingFloat: 5000, status: "OPEN" },
  });
  await db.drawerMovement.createMany({
    data: [
      { sessionId: session.id, type: "FLOAT_IN", amount: 2000, note: "Change-fund top-up" },
      { sessionId: session.id, type: "PAYOUT", amount: 1200, note: "Staff tea + delivery fuel", createdAt: new Date(Date.now() - 3 * 3600 * 1000) },
    ],
  });

  await db.auditLog.create({ data: { userId: owner.id, action: "SEED", entity: "system", meta: JSON.stringify({ products: productData.length }) } });
  console.log("Seed complete: branches=2 users=4 products=%d customers=6 transactions=%d", productData.length, txCounter + 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
