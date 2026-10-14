/**
 * Mbumah Hardware — Organization Console seed (v2.18.2)
 * Run: bun scripts/seed.ts   (idempotent: wipes + recreates demo data)
 *
 * Engineered demo numbers (Organization Console Expert Information System v3.0):
 *   • Revenue today            48,270   (exactly 1 transaction)
 *   • 7-day revenue            231,850  (+12% vs prior week; txns +8%)
 *   • Outstanding debt         437,479  (aging: 180,000 / 97,479 / 80,000 / 80,000)
 *   • Low-stock products       1        (org-wide)
 *   • Overdue rentals          1        (org-wide)
 *   • Pending approvals        0        (expenses)
 *   • Branches                 5        (juja-main thika ruiru nairobi-cbd nakuru)
 *   • Health                   87/100   (Revenue 100 · Stock 100 · Debt 0 · Engagement 12)
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth-utils";

const db = new PrismaClient();
const D = (n: number) => n.toFixed(2);
const DAY = 86_400_000;
const now = new Date();
const daysAgo = (d: number, h = 10, m = 0) => {
  const t = new Date(now.getTime() - d * DAY);
  t.setHours(h, m, 0, 0);
  return t;
};
const todayAt = (h: number, m = 0) => {
  const t = new Date(now);
  t.setHours(h, m, 0, 0);
  return t;
};

// deterministic LCG
let s = 42;
const rand = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
const between = (a: number, b: number) => a + rand() * (b - a);
/** Split `total` into exactly `n` positive 2dp parts (weight-normalized → exact sum). */
function randomSplit(total: number, n: number, low = 0.6, high = 1.4): number[] {
  const weights = Array.from({ length: n }, () => between(low, high));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const parts: number[] = [];
  let sum = 0;
  for (let i = 0; i < n - 1; i++) {
    const v = Math.round((total * weights[i]) / wSum * 100) / 100;
    parts.push(v); sum = Math.round((sum + v) * 100) / 100;
  }
  parts.push(Math.round((total - sum) * 100) / 100);
  return parts;
}

const BRANCHES = [
  { code: "juja-main", name: "Juja Main", town: "Juja", location: "Kimbo Junction, Garissa Rd, Juja", brandColor: "#B45309" },
  { code: "thika", name: "Thika Branch", town: "Thika", location: "Kenya Nyanja Rd, Thika Town", brandColor: "#047857" },
  { code: "ruiru", name: "Ruiru Branch", town: "Ruiru", location: "Eastern Bypass, Ruiru", brandColor: "#9A3412" },
  { code: "nairobi-cbd", name: "Nairobi CBD", town: "Nairobi", location: "Luthuli Avenue, Nairobi CBD", brandColor: "#B91C1C" },
  { code: "nakuru", name: "Nakuru Branch", town: "Nakuru", location: "Kenyatta Ave, Nakuru", brandColor: "#BE185D" },
];

const CATEGORIES = [
  "Tools", "Hardware", "Paints", "Plumbing", "Electrical", "Building Materials",
  "Cement & Concrete", "Steel & Rebar", "Timber & Boards", "Roofing", "Garden & Irrigation", "Safety & PPE",
];

const NOUNS: Record<string, string[]> = {
  "Tools": ["Claw Hammer 500g", "Adjustable Spanner 12inch", "Spirit Level 60cm", "Screwdriver Set 6pc", "Trowel Steel 8inch", "Wheelbarrow Heavy Duty", "Angle Grinder 850W", "Impact Drill 650W", "Circular Saw 1400W"],
  "Hardware": ["Wire Nails 4inch 25kg", "Wood Screws 4x40 Box", "Hinges 4inch Pair", "Bolts M12x100 Box", "Padlock 3 Keys 50mm", "Door Handle Chrome"],
  "Paints": ["Crown Silk Vinyl 20L White", "Undercoat 4L", "Gloss Enamel 4L Brown", "Wall Putty 20kg", "Wood Varnish 4L", "Emulsion 20L Cream"],
  "Plumbing": ["PVC Pipe 4inch x 6m", "PVC Elbow 2inch", "Kitchen Mixer Tap", "Toilet Suite P-Trap", "Water Tank 1000L", "PPR Pipe 20mm 4m"],
  "Electrical": ["Twin Twisted Cable 1.5mm 100m", "Socket Outlet 13A", "LED Bulb 9W E27", "DB Box 8-Way", "Circuit Breaker 32A", "Solar Panel 150W"],
  "Building Materials": ["Bamburi Nguvu Cement 32.5N 50kg", "Tile Adhesive 20kg", "Wall Plaster 25kg", "Y12 Deformed Bar 12m", "IT4 Charcoal Sheets", "Cypress Timber 2x4x14ft"],
  "Cement & Concrete": ["Bamburi Nguvu Cement 32.5N 50kg", "Ready-Mix Concrete 20MPa", "Tile Adhesive 20kg", "Wall Plaster 25kg"],
  "Steel & Rebar": ["Y12 Deformed Bar 12m", "Y16 Deformed Bar 12m", "Square Tube 2x2 6m", "Angle Iron 40x40 6m", "Binding Wire 25kg"],
  "Timber & Boards": ["Cypress Timber 2x4x14ft", "MDF Board 18mm 8x4", "Plywood 12mm 8x4", "Blockboard 9mm 8x4"],
  "Roofing": ["IT4 Charcoal Sheets", "Ridge Cap 2m", "Roofing Nails Rubber Washer", "Gutter 4inch 6m", "Fascia Board 9inch"],
  "Garden & Irrigation": ["Drip Line 16mm 100m", "Sprinkler Pop-up", "Hose Pipe 20m", "Knapsack Sprayer 16L", "Garden Fork"],
  "Safety & PPE": ["Safety Boots Size 42", "Hard Hat White", "Dust Mask 50pc", "Work Gloves Leather", "Overall Navy XXL", "Hi-Vis Vest"],
};

const UNITS: Record<string, string> = {
  "Wire Nails 4inch 25kg": "KG", "Roofing Nails 3inch 12kg": "KG", "Binding Wire 25kg": "KG",
  "Drip Line 16mm 100m": "M", "Gutter 4inch 6m": "M", "IT4 Charcoal Sheets": "M",
};

async function wipe() {
  const tables = [
    db.journalLine, db.journalEntry, db.chatMessage, db.notification, db.systemLog, db.systemConfig,
    db.shift, db.receipt, db.giftCard, db.rental, db.expense, db.purchaseOrderItem, db.purchaseOrder,
    db.supplier, db.bundleItem, db.bundle, db.stockMovement, db.smsLog, db.paymentReminder,
    db.creditLimitChange, db.creditLedgerEntry, db.invoiceItem, db.invoice, db.payment,
    db.mpesaTransaction, db.transactionItem, db.transaction, db.debtInstallment, db.debtPlan,
    db.creditLedger, db.guarantor, db.creditAccount, db.stocktakeItem, db.stocktake,
    db.drawerMovement, db.cashDrawerSession, db.stockAdjustment, db.product, db.customer,
    db.auditLog, db.user, db.branch, db.category,
  ];
  for (const t of tables) await t.deleteMany();
}

async function main() {
  console.log("Seeding Mbumah Hardware — Organization Console v2.18.2…");
  await wipe();

  // ── Branches ──────────────────────────────────────────────────────────────
  const branches: Record<string, { id: string }> = {};
  for (const b of BRANCHES) {
    branches[b.code] = await db.branch.create({
      data: {
        code: b.code, name: b.name, location: b.location, town: b.town,
        kraPin: "P051234567X", slug: b.code, subdomain: `${b.code}.mbumah.co.ke`,
        brandColor: b.brandColor, sizeSqm: b.code === "juja-main" ? 850 : 420,
      },
    });
  }
  const juja = branches["juja-main"];

  // ── Categories ────────────────────────────────────────────────────────────
  for (let i = 0; i < CATEGORIES.length; i++) {
    await db.category.create({ data: { name: CATEGORIES[i], sortOrder: i, icon: "package" } });
  }

  // ── Users (all password123; engraved admin per STEP 4 spec) ──────────────
  const pw = hashPassword("password123");
  const mkUser = (email: string, name: string, role: string, branchId: string, extra = {}) =>
    db.user.create({ data: { email, name, role, passwordHash: pw, branchId, ...extra } });

  const admin = await mkUser("admin@mbumahhardware.co.ke", "System Administrator", "SUPER_ADMIN", juja.id, { isEngraved: true, isSystem: true, phone: "0795191909" });
  await mkUser("owner@mbumahhardware.co.ke", "Peter Mbumah", "STORE_OWNER", juja.id, { phone: "0759963601" });
  for (const b of BRANCHES) {
    const local = b.code === "nairobi-cbd" ? "nairobi" : b.code;
    await mkUser(`${local}.manager@mbumahhardware.co.ke`, `${b.name} Manager`, "BRANCH_MANAGER", branches[b.code].id);
  }
  const warehouse = await mkUser("warehouse@mbumahhardware.co.ke", "Joseph Kariuki", "INVENTORY_MANAGER", juja.id);
  const accountant = await mkUser("accounts@mbumahhardware.co.ke", "Mercy Achieng", "ACCOUNTANT", juja.id);
  const cashier = await mkUser("cashier@mbumahhardware.co.ke", "Grace Wanjiku", "CASHIER", juja.id);
  await mkUser("thika.cashier@mbumahhardware.co.ke", "Samuel Njoroge", "CASHIER", branches["thika"].id);
  await mkUser("nakuru.cashier@mbumahhardware.co.ke", "Faith Chebet", "CASHIER", branches["nakuru"].id);

  // ── Products (~700 SKUs; exactly 1 low-stock org-wide) ────────────────────
  const plan: Record<string, number> = { "juja-main": 250, thika: 140, ruiru: 110, "nairobi-cbd": 100, nakuru: 100 };
  let skuN = 0;
  let lowStockTarget: { id: string } | null = null;
  const productIdsByBranch: Record<string, string[]> = {};
  for (const b of BRANCHES) {
    productIdsByBranch[b.code] = [];
    for (const cat of CATEGORIES) {
      const count = Math.max(2, Math.round(plan[b.code] / CATEGORIES.length));
      for (let i = 0; i < count; i++) {
        skuN++;
        const name = pick(NOUNS[cat]);
        const variant = ["", " (Pack of 10)", " (Premium)", " (Contractor Grade)", " (Economy)"][Math.floor(rand() * 5)];
        const buying = Math.round(between(80, 8500));
        const reorder = Math.round(between(5, 30));
        const unit = UNITS[name] ?? "PCS";
        const isTheLowOne = b.code === "juja-main" && cat === "Tools" && name.startsWith("Claw Hammer") && !lowStockTarget;
        const stockQty = isTheLowOne ? 3 : Math.round(reorder * between(1.6, 9) * 100) / 100;
        const p = await db.product.create({
          data: {
            sku: `MBM-${b.code.slice(0, 3).toUpperCase()}-${String(skuN).padStart(4, "0")}`,
            barcode: `62${String(1000000000 + Math.floor(rand() * 8999999999)).slice(0, 10)}`,
            name: `${name}${variant}`, category: cat, unit,
            buyingPrice: D(buying), sellingPrice: D(Math.round(buying * between(1.15, 1.6))),
            stockQty: D(stockQty), reorderLevel: D(reorder),
            taxCategory: "B", branchId: branches[b.code].id,
          },
        });
        productIdsByBranch[b.code].push(p.id);
        if (isTheLowOne) lowStockTarget = { id: p.id };
      }
    }
  }
  console.log(`Products: ${skuN}, low-stock=1 (${lowStockTarget ? "ok" : "MISSING"})`);

  // ── This week's sales: 1 today (48,270 net), 36 across 6 days, prior week ~34 ──
  const todayNet = 48270;
  const week7 = [26400, 31250, 29800, 33600, 30530, 32000]; // days 1..6 (yesterday..6d ago); +today = 231,850
  let txSeq = 0;
  const ref = (d = 0) => {
    const dt = d === 0 ? now : daysAgo(d);
    const ymd = `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
    return `MBM-${ymd}-${String(++txSeq).padStart(4, "0")}`;
  };

  async function sale(branchCode: string, net: number, when: Date, method: "CASH" | "MPESA" | "BANK_TRANSFER", items = 3) {
    const branchId = branches[branchCode].id;
    const prodIds = productIdsByBranch[branchCode];
    const vat = Math.round(net * 0.16 * 100) / 100;
    const tx = await db.transaction.create({
      data: {
        ref: ref(), type: "SALE", status: "COMPLETED", branchId, userId: cashier.id,
        subtotal: D(net), vatAmount: D(vat), totalAmount: D(net + vat),
        amountPaid: D(net + vat), balanceDue: "0", vatInclusive: false, createdAt: when,
      },
    });
    const perLine = Math.round((net / items) * 100) / 100;
    for (let i = 0; i < items; i++) {
      const pid = prodIds[Math.floor(rand() * prodIds.length)];
      const prod = await db.product.findUniqueOrThrow({ where: { id: pid } });
      const lineNet = i === items - 1 ? Math.round((net - perLine * (items - 1)) * 100) / 100 : perLine;
      const lineVat = Math.round(lineNet * 0.16 * 100) / 100;
      await db.transactionItem.create({
        data: {
          transactionId: tx.id, productId: pid, description: prod.name, uom: prod.unit,
          qty: 1, unitPrice: D(lineNet), lineNet: D(lineNet), vatAmount: D(lineVat),
          lineTotal: D(lineNet + lineVat), taxCategory: "B", unitCost: D(Number(prod.buyingPrice)),
        },
      });
    }
    await db.payment.create({
      data: {
        transactionId: tx.id, branchId, method, amount: D(net + vat),
        reference: method === "MPESA" ? `Q${Math.floor(between(100000000, 999999999))}` : method === "BANK_TRANSFER" ? `FT${Math.floor(between(100000, 999999))}` : null,
        receivedAt: when, receivedByName: "Grace Wanjiku",
      },
    });
    // double-entry journal
    const je = await db.journalEntry.create({ data: { branchId, date: when, memo: `Sale ${tx.ref}`, refType: "TRANSACTION", refId: tx.id } });
    const acct = method === "MPESA" ? "1100 M-Pesa Receivable" : method === "BANK_TRANSFER" ? "1010 Bank" : "1000 Cash";
    await db.journalLine.createMany({
      data: [
        { entryId: je.id, account: acct, debit: D(net + vat), credit: "0" },
        { entryId: je.id, account: "4000 Sales Revenue", debit: "0", credit: D(net) },
        { entryId: je.id, account: "2100 VAT Payable 16%", debit: "0", credit: D(vat) },
      ],
    });
    // stock movements for 1 line (kept light)
    if (rand() < 0.5) {
      await db.stockMovement.create({
        data: { branchId, productId: prodIds[0], type: "SALE", qty: D(-1), reason: `Sale ${tx.ref}`, userId: cashier.id, userName: "Grace Wanjiku", referenceId: tx.id, createdAt: when },
      });
    }
    return tx;
  }

  // THE sale of the day — Juja Main, M-Pesa (matched)
  const bigSale = await sale("juja-main", todayNet, todayAt(9, 42), "MPESA", 4);
  await db.mpesaTransaction.create({
    data: {
      checkoutRequestId: `ws_CO_DEMO_${Date.now()}`, merchantRequestId: "29115-34620561-1",
      phone: "254722345678", amount: D(todayNet * 1.16), purpose: "SALE", branchId: juja.id, status: "SUCCESS",
      resultCode: 0, resultDesc: "The service request is processed successfully.",
      mpesaReceipt: "QK71HKM2VX", verified: true, transactionId: bigSale.id, createdAt: todayAt(9, 43),
    },
  });
  await db.receipt.create({
    data: { branchId: juja.id, number: "MBM-R-0001", transactionId: bigSale.id, total: D(todayNet * 1.16), smsStatus: "SIMULATED", pdfGenerated: true, customerName: "Walk-in", createdAt: todayAt(9, 44) },
  });

  // This week: round-robin branch coverage (every branch gets sales), exact
  // daily totals; 26 txns + 1 today = 27 (prior 25 → txns +8%)
  let rr = 0;
  const nextBranch = () => BRANCHES[rr++ % BRANCHES.length].code;
  for (let d = 1; d <= 6; d++) {
    const n = [5, 4, 4, 5, 4, 4][d - 1];
    const nets = randomSplit(week7[d - 1], n);
    for (const net of nets) {
      await sale(nextBranch(), net, daysAgo(d, 8 + Math.floor(rand() * 10)), pick(["CASH", "CASH", "MPESA", "BANK_TRANSFER"] as const));
    }
  }
  // Prior week: per-branch amounts EXACTLY track this week's mix scaled by
  // 1/1.12 → every branch lands at ≈ +12% and org total is exactly 207,008.93.
  const P = 207008.93;
  const weekStart = daysAgo(6, 0, 0);
  const weekByBranch = await db.transaction.groupBy({
    by: ["branchId"],
    _sum: { subtotal: true },
    where: { type: "SALE", createdAt: { gte: weekStart } },
  });
  const W = weekByBranch.reduce((a, g) => a + Number(g._sum.subtotal ?? 0), 0);
  const targets = weekByBranch
    .filter((g) => Number(g._sum.subtotal ?? 0) > 0)
    .map((g) => ({ branchId: g.branchId, amount: (Number(g._sum.subtotal ?? 0) / W) * P }));
  const tSum = targets.reduce((a, t) => a + t.amount, 0);
  for (const t of targets) t.amount = (t.amount / tSum) * P;
  const ks = targets.map((t) => Math.max(1, Math.round((25 * t.amount) / P)));
  let kSum = ks.reduce((a, b) => a + b, 0);
  while (kSum > 25) {
    const maxIdx = ks.reduce((best, v, i) => (v > ks[best] ? i : best), 0);
    if (ks[maxIdx] <= 1) break; // impossible with 25 txns across 5 branches
    ks[maxIdx]--; kSum--;
  }
  while (kSum < 25) {
    const i = ks.indexOf(Math.min(...ks));
    ks[i]++; kSum++;
  }
  const branchCodeById = new Map(Object.values(branches).map((b, i) => [b.id, BRANCHES[i].code] as const));
  for (let i = 0; i < targets.length; i++) {
    const code = branchCodeById.get(targets[i].branchId) ?? "juja-main";
    const nets = randomSplit(targets[i].amount, ks[i]);
    for (const net of nets) {
      await sale(code, net, daysAgo(7 + (i % 7), 8 + Math.floor(rand() * 10)), pick(["CASH", "MPESA", "BANK_TRANSFER"] as const));
    }
  }

  // M-Pesa edge cases (Expert module): mismatch, duplicate, timeout
  await db.mpesaTransaction.create({ data: { checkoutRequestId: "ws_CO_DEMO_PENDING_1", phone: "254733222111", amount: "18400.00", purpose: "SALE", branchId: branches["thika"].id, status: "PENDING", createdAt: new Date(now.getTime() - 12 * 60_000) } }); // stale → mismatch (thika)
  await db.mpesaTransaction.create({ data: { checkoutRequestId: "ws_CO_DEMO_DUP_1", phone: "254711998877", amount: "5200.00", purpose: "DEBT_REPAY", branchId: branches["nakuru"].id, status: "SUCCESS", resultCode: 0, resultDesc: "Duplicate callback ignored", mpesaReceipt: "QK71HLM3PY", verified: true, createdAt: daysAgo(0, 8, 5) } });
  await db.mpesaTransaction.create({ data: { checkoutRequestId: "ws_CO_DEMO_TO_1", phone: "254720554433", amount: "9800.00", purpose: "SALE", branchId: branches["ruiru"].id, status: "TIMEOUT", resultCode: 1037, resultDesc: "DS timeout user cannot be reached", createdAt: daysAgo(1, 16) } });

  // ── Credit portfolio: outstanding 437,479 exact ───────────────────────────
  // buckets: current 180,000 · 1-30d 97,479 · 31-60d 80,000 · 61-90+d 80,000
  let invSeq = 0;
  async function creditInvoice(opts: {
    customer: { id: string }; branchCode: string; totalIncl: number; issuedDaysAgo: number; dueDays: number;
    paidAtDaysAgo?: number; method?: "CASH" | "MPESA" | "BANK" | "CHEQUE"; primary: string; sku: string; qty: number; unitPrice: number;
  }) {
    const { customer, branchCode, totalIncl, issuedDaysAgo, dueDays } = opts;
    const net = Math.round((totalIncl / 1.16) * 100) / 100;
    const vat = Math.round((totalIncl - net) * 100) / 100;
    const number = `INV-${now.getFullYear()}-${String(++invSeq).padStart(4, "0")}`;
    const issuedAt = daysAgo(issuedDaysAgo, 9);
    const dueDate = new Date(issuedAt.getTime() + dueDays * DAY);
    const settled = opts.paidAtDaysAgo !== undefined;
    const inv = await db.invoice.create({
      data: {
        branchId: branches[branchCode].id, customerId: customer.id, number,
        subtotal: D(net), vatAmount: D(vat), total: D(totalIncl),
        amountPaid: settled ? D(totalIncl) : "0", status: settled ? "PAID" : "UNPAID",
        termsDays: 30, issuedAt, dueDate,
        etimsStatus: opts.branchCode === "nakuru" && !settled ? "PENDING" : opts.branchCode === "nairobi-cbd" && !settled ? "PENDING" : "COMPLIANT",
        items: { create: { description: opts.primary, sku: opts.sku, qty: D(opts.qty), unitPrice: D(opts.unitPrice), lineTotal: D(net) } },
      },
    });
    if (settled) {
      await db.payment.create({
        data: { invoiceId: inv.id, customerId: customer.id, branchId: branches[branchCode].id, method: opts.method ?? "MPESA", amount: D(totalIncl), reference: `Q${Math.floor(between(100000000, 999999999))}`, receivedAt: daysAgo(opts.paidAtDaysAgo!, 14), receivedById: accountant.id, receivedByName: "Mercy Achieng" },
      });
      // Ledger replay: CHARGE at issue, negated PAYMENT at settlement (net 0)
      await db.creditLedgerEntry.createMany({
        data: [
          { branchId: branches[branchCode].id, customerId: customer.id, type: "CHARGE", amount: D(totalIncl), balanceAfter: D(totalIncl), refType: "INVOICE", refId: inv.id, note: `${number} — credit sale`, createdById: admin.id, createdByName: "System Administrator", createdAt: issuedAt },
          { branchId: branches[branchCode].id, customerId: customer.id, type: "PAYMENT", amount: D(-totalIncl), balanceAfter: "0", refType: "PAYMENT", refId: inv.id, note: `${number} settled via ${opts.method ?? "MPESA"}`, createdById: admin.id, createdByName: "System Administrator", createdAt: daysAgo(opts.paidAtDaysAgo!, 14) },
        ],
      });
    } else {
      await db.creditLedgerEntry.create({
        data: { branchId: branches[branchCode].id, customerId: customer.id, type: "CHARGE", amount: D(totalIncl), balanceAfter: D(totalIncl), refType: "INVOICE", refId: inv.id, note: `${number} — credit sale`, createdById: admin.id, createdByName: "System Administrator", createdAt: issuedAt },
      });
    }
    return inv;
  }

  const custDefs = [
    { name: "JOHN CONTRACTORS LTD", type: "COMPANY", phone: "0722123456", email: "accounts@johncontractors.co.ke", kraPin: "P051234567X", address: "Mombasa Road, Nairobi", creditLimit: 400000, branch: "juja-main" },
    { name: "Otieno & Sons Timber", type: "COMPANY", phone: "0756443322", email: "otienosons@gmail.com", address: "Ngong Road, Nairobi", creditLimit: 80000, branch: "thika" },
    { name: "Wanjiru Hardware Retail", type: "COMPANY", phone: "0723112233", email: "wanjiru@mbumahhardware.co.ke", address: "Gikambura, Kikuyu", creditLimit: 100000, branch: "ruiru", status: "SUSPENDED" },
    { name: "Kisii Quarry Suppliers", type: "COMPANY", phone: "0718889900", email: "kisiiquarry@yahoo.com", address: "Mlolongo, Machakos", creditLimit: 120000, branch: "nairobi-cbd", status: "DEFAULTED" },
    { name: "Tumaini Secondary School", type: "COMPANY", phone: "0712998877", email: "bursar@tumainischool.ac.ke", address: "Kiambu Road", creditLimit: 150000, branch: "juja-main" },
    { name: "Nairobi Skies Hotel", type: "COMPANY", phone: "0744556677", email: "procurement@nairobiskies.co.ke", kraPin: "P052345678Z", address: "Upper Hill, Nairobi", creditLimit: 500000, branch: "nairobi-cbd" },
    { name: "Beth Mwangi", type: "INDIVIDUAL", phone: "0799111000", address: "Zimmerman, Nairobi", creditLimit: 50000, branch: "juja-main" },
  ];
  const customers: Record<string, { id: string }> = {};
  for (const c of custDefs) {
    const cu = await db.customer.create({
      data: {
        name: c.name, type: c.type, phone: c.phone, email: c.email, kraPin: c.kraPin, address: c.address,
        creditLimit: D(c.creditLimit), creditStatus: c.status ?? "ACTIVE",
        riskScore: c.status === "DEFAULTED" ? 92 : c.status === "SUSPENDED" ? 78 : Math.floor(between(25, 60)),
        branchId: branches[c.branch].id, approvedByName: "Peter Mbumah", approvedAt: daysAgo(300),
        onTimePayments: c.status ? 0 : Math.floor(between(60, 95)),
      },
    });
    customers[c.name] = cu;
    await db.creditAccount.create({ data: { customerId: cu.id, branchId: branches[c.branch].id, creditLimit: D(c.creditLimit), totalDebt: "0", status: "ACTIVE" } });
  }
  const C = (n: string) => customers[n];

  // current 180,000
  await creditInvoice({ customer: C("JOHN CONTRACTORS LTD"), branchCode: "juja-main", totalIncl: 100000, issuedDaysAgo: 10, dueDays: 30, primary: "IT4 Pre-painted Roofing Sheet — 3m", sku: "ROF-IT4-3M", qty: 42, unitPrice: 2050 });
  await creditInvoice({ customer: C("Tumaini Secondary School"), branchCode: "juja-main", totalIncl: 50000, issuedDaysAgo: 12, dueDays: 30, primary: "Premier Cement 32.5N — 50kg bag", sku: "CEM-32.5-50", qty: 120, unitPrice: 360 });
  await creditInvoice({ customer: C("Nairobi Skies Hotel"), branchCode: "nairobi-cbd", totalIncl: 30000, issuedDaysAgo: 8, dueDays: 30, primary: "Crown Silk Vinyl Emulsion — 20L", sku: "PNT-SV-20", qty: 6, unitPrice: 4300 });
  // 1-30d overdue 97,479
  await creditInvoice({ customer: C("Wanjiru Hardware Retail"), branchCode: "ruiru", totalIncl: 45000, issuedDaysAgo: 48, dueDays: 30, primary: "Premier Cement 32.5N — 50kg bag", sku: "CEM-32.5-50", qty: 100, unitPrice: 390 });
  await creditInvoice({ customer: C("Otieno & Sons Timber"), branchCode: "thika", totalIncl: 22479, issuedDaysAgo: 40, dueDays: 30, primary: "D8 Deformed Steel Bar — 12m", sku: "STL-D8-12", qty: 9, unitPrice: 2150 });
  await creditInvoice({ customer: C("Beth Mwangi"), branchCode: "juja-main", totalIncl: 30000, issuedDaysAgo: 35, dueDays: 30, primary: "Crown Silk Vinyl Emulsion — 20L", sku: "PNT-SV-20", qty: 6, unitPrice: 4350 });
  // 31-60d 80,000
  await creditInvoice({ customer: C("Otieno & Sons Timber"), branchCode: "thika", totalIncl: 30000, issuedDaysAgo: 75, dueDays: 30, primary: "Premier Cement 32.5N — 50kg bag", sku: "CEM-32.5-50", qty: 66, unitPrice: 395 });
  await creditInvoice({ customer: C("Kisii Quarry Suppliers"), branchCode: "nairobi-cbd", totalIncl: 50000, issuedDaysAgo: 70, dueDays: 30, primary: "Y12 Deformed Bar 12m", sku: "STL-Y12-12", qty: 21, unitPrice: 2050 });
  // 61-90d+ 80,000
  await creditInvoice({ customer: C("JOHN CONTRACTORS LTD"), branchCode: "juja-main", totalIncl: 80000, issuedDaysAgo: 105, dueDays: 30, primary: "Premier Cement 32.5N — 50kg bag", sku: "CEM-32.5-50", qty: 175, unitPrice: 395 });

  // settled history (for loyalty/score + eTIMS mix)
  await creditInvoice({ customer: C("JOHN CONTRACTORS LTD"), branchCode: "juja-main", totalIncl: 105000, issuedDaysAgo: 300, dueDays: 30, paidAtDaysAgo: 265, method: "BANK", primary: "Premier Cement 32.5N — 50kg bag", sku: "CEM-32.5-50", qty: 250, unitPrice: 350 });
  await creditInvoice({ customer: C("JOHN CONTRACTORS LTD"), branchCode: "juja-main", totalIncl: 88000, issuedDaysAgo: 200, dueDays: 30, paidAtDaysAgo: 165, method: "MPESA", primary: "D8 Deformed Steel Bar — 12m", sku: "STL-D8-12", qty: 30, unitPrice: 2100 });
  await creditInvoice({ customer: C("Nairobi Skies Hotel"), branchCode: "nairobi-cbd", totalIncl: 180000, issuedDaysAgo: 500, dueDays: 30, paidAtDaysAgo: 470, method: "BANK", primary: "Crown Silk Vinyl Emulsion — 20L", sku: "PNT-SV-20", qty: 30, unitPrice: 5000 });

  // sync customer outstanding + credit accounts
  const outs = await db.creditLedgerEntry.groupBy({ by: ["customerId"], _sum: { amount: true } });
  for (const o of outs) {
    const bal = Number(o._sum.amount ?? 0);
    await db.customer.update({ where: { id: o.customerId }, data: { outstanding: D(Math.max(bal, 0)) } });
    await db.creditAccount.updateMany({ where: { customerId: o.customerId }, data: { totalDebt: D(Math.max(bal, 0)) } });
  }

  // reminders (engagement)
  await db.paymentReminder.create({ data: { branchId: juja.id, customerId: C("JOHN CONTRACTORS LTD").id, channel: "SMS", message: "URGENT: John Contractors, KES 80,000 is 75 days overdue. Settle to avoid facility suspension. — Mbumah Credit Desk", status: "SIMULATED", providerRef: "sim_seed_jcl", sentAt: daysAgo(3), createdAt: daysAgo(3) } });
  await db.paymentReminder.create({ data: { branchId: branches["ruiru"].id, customerId: C("Wanjiru Hardware Retail").id, channel: "WHATSAPP", message: "FINAL DEMAND: settle overdue balance to restore credit services. — Credit Desk", status: "SIMULATED", providerRef: "sim_seed_demand", sentAt: daysAgo(8), createdAt: daysAgo(8) } });

  // ── Rentals: exactly 1 OVERDUE ────────────────────────────────────────────
  const rentalDefs = [
    { bc: "juja-main", item: "Concrete Mixer 350L", qty: 1, rate: 1500, deposit: 10000, status: "OVERDUE", out: 12, exp: 7, cust: "JOHN CONTRACTORS LTD" },
    { bc: "juja-main", item: "Scaffolding Set (6 uprights)", qty: 1, rate: 900, deposit: 8000, status: "ACTIVE", out: 2, exp: 12, cust: "Tumaini Secondary School" },
    { bc: "thika", item: "Plate Compactor", qty: 1, rate: 2200, deposit: 15000, status: "ACTIVE", out: 1, exp: 9, cust: null },
    { bc: "ruiru", item: "Submersible Water Pump", qty: 2, rate: 800, deposit: 6000, status: "ACTIVE", out: 3, exp: 14, cust: "Nairobi Skies Hotel" },
    { bc: "nairobi-cbd", item: "Welding Machine 250A", qty: 1, rate: 1200, deposit: 10000, status: "RETURNED", out: 20, exp: 15, cust: "Kisii Quarry Suppliers" },
    { bc: "nakuru", item: "Tile Cutter 600mm", qty: 1, rate: 500, deposit: 3000, status: "RETURNED", out: 30, exp: 26, cust: null },
  ];
  for (const r of rentalDefs) {
    // rentOutAt = daysAgo(r.out); expectedReturnAt = rentOutAt + r.exp days = daysAgo(r.out - r.exp)
    const expectedReturnAt = daysAgo(r.out - r.exp, 17);
    const returnedAt = r.status === "RETURNED" ? daysAgo(Math.max(r.out - r.exp, 0), 16) : null;
    await db.rental.create({
      data: {
        branchId: branches[r.bc].id, customerId: r.cust ? C(r.cust).id : null,
        itemDescription: r.item, qty: r.qty, dailyRate: D(r.rate), deposit: D(r.deposit),
        status: r.status, rentOutAt: daysAgo(r.out, 9), expectedReturnAt,
        returnedAt,
      },
    });
  }

  // ── Suppliers + purchase orders ───────────────────────────────────────────
  const suppliers = [
    { name: "Bamburi Regional", category: "Cement", lead: 3, onTime: 96, score: 94 },
    { name: "Devki Steel Mills", category: "Steel & Rebar", lead: 5, onTime: 91, score: 88 },
    { name: "Crown Paints Distributors", category: "Paints", lead: 4, onTime: 93, score: 90 },
    { name: "Netafim Irrigation KE", category: "Garden & Irrigation", lead: 14, onTime: 70, score: 62 }, // delayed
    { name: "Kenbro Tiles & Adhesives", category: "Building Materials", lead: 6, onTime: 89, score: 86 },
    { name: "Twiga Tools Imports", category: "Tools", lead: 21, onTime: 82, score: 78 },
  ];
  const sup: Record<string, { id: string }> = {};
  for (const sp of suppliers) {
    sup[sp.name] = await db.supplier.create({
      data: { name: sp.name, contactName: pick(["Charles O.", "Mary W.", "Kip R.", "Asha M.", "John K."]), phone: `07${Math.floor(between(10000000, 99999999))}`, email: `sales@${sp.name.toLowerCase().replace(/[^a-z]+/g, "")}.co.ke`, category: sp.category, leadTimeDays: sp.lead, onTimeRate: sp.onTime, fulfillmentScore: sp.score },
    });
  }
  let poSeq = 0;
  const poDefs = [
    { sup: "Bamburi Regional", bc: "juja-main", status: "RECEIVED", total: 352000, days: 9 },
    { sup: "Devki Steel Mills", bc: "juja-main", status: "RECEIVED", total: 198500, days: 6 },
    { sup: "Crown Paints Distributors", bc: "thika", status: "SENT", total: 84600, days: 2 },
    { sup: "Netafim Irrigation KE", bc: "ruiru", status: "SENT", total: 61200, days: 11 }, // delayed
    { sup: "Kenbro Tiles & Adhesives", bc: "nairobi-cbd", status: "PARTIAL", total: 45800, days: 4 },
  ];
  for (const po of poDefs) {
    poSeq++;
    await db.purchaseOrder.create({
      data: {
        branchId: branches[po.bc].id, supplierId: sup[po.sup].id, number: `PO-2026-${String(poSeq).padStart(3, "0")}`,
        status: po.status, total: D(po.total), expectedAt: new Date(now.getTime() + between(-3, 10) * DAY), createdAt: daysAgo(po.days, 11),
        items: { create: { description: `${po.sup} — assorted stock`, qty: D(Math.round(po.total / 400)), unitCost: D(400), receivedQty: po.status === "RECEIVED" ? D(Math.round(po.total / 400)) : po.status === "PARTIAL" ? D(Math.round(po.total / 800)) : "0" } },
      },
    });
  }

  // ── Expenses: all APPROVED (Pending = 0) ──────────────────────────────────
  const expDefs = [
    { bc: "juja-main", cat: "RENT", desc: " premises — monthly", amt: 85000, d: 20 },
    { bc: "juja-main", cat: "SALARIES", desc: " staff wages", amt: 142000, d: 18 },
    { bc: "thika", cat: "RENT", desc: " premises — monthly", amt: 52000, d: 19 },
    { bc: "thika", cat: "UTILITIES", desc: " KPLC bill", amt: 18300, d: 10 },
    { bc: "ruiru", cat: "TRANSPORT", desc: " delivery run — Nakuru", amt: 9500, d: 8 },
    { bc: "nairobi-cbd", cat: "MAINTENANCE", desc: " forklift service", amt: 22800, d: 6 },
    { bc: "nakuru", cat: "UTILITIES", desc: " water + internet", amt: 6400, d: 5 },
    { bc: "juja-main", cat: "OTHER", desc: " county single permit", amt: 12000, d: 3 },
  ];
  for (const e of expDefs) {
    await db.expense.create({
      data: { branchId: branches[e.bc].id, category: e.cat, description: e.bc + e.desc, amount: D(e.amt), status: "APPROVED", requestedByName: "Grace Wanjiku", approvedByName: "Peter Mbumah", approvedAt: daysAgo(e.d, 15), createdAt: daysAgo(e.d, 9) },
    });
    const je = await db.journalEntry.create({ data: { branchId: branches[e.bc].id, date: daysAgo(e.d, 15), memo: `Expense ${e.cat}`, refType: "EXPENSE" } });
    await db.journalLine.createMany({
      data: [
        { entryId: je.id, account: `6${e.cat === "RENT" ? "000" : e.cat === "SALARIES" ? "100" : "200"} ${e.cat.charAt(0)}${e.cat.slice(1).toLowerCase()} Expense`, debit: D(e.amt), credit: "0" },
        { entryId: je.id, account: "1000 Cash", debit: "0", credit: D(e.amt) },
      ],
    });
  }

  // ── Gift cards ────────────────────────────────────────────────────────────
  await db.giftCard.create({ data: { code: "MBH-GC-8842-KEN", branchId: juja.id, initialAmount: "20000", balance: "12400", issuedByName: "Grace Wanjiku" } });
  await db.giftCard.create({ data: { code: "MBH-GC-9031-THR", branchId: branches["thika"].id, initialAmount: "5000", balance: "0", status: "REDEEMED", redeemedAt: daysAgo(4) } });
  await db.giftCard.create({ data: { code: "MBH-GC-7715-NKR", branchId: branches["nakuru"].id, initialAmount: "10000", balance: "10000", expiresAt: new Date(now.getTime() + 90 * DAY) } });

  // ── Shifts: Juja OPEN, others closed yesterday ────────────────────────────
  await db.shift.create({ data: { branchId: juja.id, userId: cashier.id, startedAt: todayAt(8, 15), startingCash: "5000", status: "OPEN" } });
  for (const bc of ["thika", "ruiru", "nairobi-cbd", "nakuru"]) {
    await db.shift.create({ data: { branchId: branches[bc].id, userId: cashier.id, startedAt: daysAgo(1, 8), endedAt: daysAgo(1, 18), startingCash: "5000", endingCash: D(Math.round(between(18000, 42000))), expectedCash: D(Math.round(between(18000, 42000))), status: "CLOSED" } });
  }
  const jujaSession = await db.cashDrawerSession.create({ data: { branchId: juja.id, userId: cashier.id, openingFloat: "5000", status: "OPEN", openedAt: todayAt(8, 15) } });
  await db.drawerMovement.createMany({
    data: [
      { sessionId: jujaSession.id, type: "FLOAT_IN" as const, amount: "2000", note: "Change-fund top-up", createdAt: todayAt(8, 20) },
      { sessionId: jujaSession.id, type: "PAYOUT" as const, amount: "1200", note: "Staff tea + delivery fuel", createdAt: todayAt(11, 30) },
    ],
  });

  // ── Global chat: 3 unread for admin ───────────────────────────────────────
  const chat = [
    { u: "Grace Wanjiku", r: "CASHIER", b: juja.id, c: "Good morning team — M-Pesa line 1 is confirmed working.", d: 0, h: 8, m: 5 },
    { u: "Thika Branch Manager", r: "BRANCH_MANAGER", b: null, c: "Thika here: we have a stale STK push (18,400) pending over 10 minutes — flagging for reconciliation.", d: 0, h: 9, m: 12 },
    { u: "Mercy Achieng", r: "ACCOUNTANT", b: juja.id, c: "Trial balance for last week is clean. VAT schedule filed.", d: 0, h: 9, m: 40 },
    { u: "Nakuru Branch Manager", r: "BRANCH_MANAGER", b: null, c: "Nakuru eTIMS submission for INV batch is queued — will confirm by noon.", d: 0, h: 10, m: 2 },
    { u: "Peter Mbumah", r: "STORE_OWNER", b: juja.id, c: "Reminder: stock take at Juja Main this Saturday 7 AM.", d: 1, h: 17, m: 3 },
  ];
  for (const m of chat) {
    await db.chatMessage.create({ data: { branchId: m.b, userId: null, userName: m.u, userRole: m.r, content: m.c, createdAt: daysAgo(m.d, m.h, m.m) } });
  }

  // ── Notifications: 4 unread ───────────────────────────────────────────────
  const notifDefs = [
    { type: "STOCK_LOW", title: "Low stock: Claw Hammer 500g", body: "Juja Main · 3 left (reorder at 10)", severity: "warning", bc: "juja-main" },
    { type: "RENTAL_OVERDUE", title: "Rental overdue: Concrete Mixer 350L", body: "Juja Main · out 12 days, expected back 5 days ago", severity: "critical", bc: "juja-main" },
    { type: "DEBT_LARGE", title: "Debt exposure above KES 400,000", body: "Org-wide outstanding KES 437,479 — 80,000 in 90+ days", severity: "critical", bc: null },
    { type: "MPESA_MISMATCH", title: "M-Pesa mismatch at Thika", body: "STK push 18,400 pending >10 min — reconcile", severity: "warning", bc: "thika" },
  ];
  for (const n of notifDefs) {
    await db.notification.create({
      data: { branchId: n.bc ? branches[n.bc].id : null, type: n.type, title: n.title, body: n.body, severity: n.severity, dedupeKey: `${n.type}:${n.bc ?? "org"}`, read: false, createdAt: daysAgo(0, 8 + Math.floor(rand() * 3)) },
    });
  }
  await db.notification.create({ data: { branchId: null, type: "SYSTEM", title: "Nightly backup completed", body: "Snapshot 14.2 MB — all tables verified", severity: "info", dedupeKey: `SYSTEM:backup:${now.getDate()}`, read: true, createdAt: daysAgo(1, 2) } });

  // ── System logs (mirror the console live feed) ────────────────────────────
  await db.systemLog.createMany({
    data: [
      { level: "ERROR", component: "DecisionSupport", message: "Debt >400k shake alert", metadata: JSON.stringify({ total: 437479 }), createdAt: todayAt(14, 19, 10) },
      { level: "INFO", component: "Revenue", message: "Revenue 48,270 KES", metadata: JSON.stringify({ txns: 1 }), createdAt: todayAt(14, 20, 2) },
      { level: "WARN", component: "MpesaExpert", message: "M-Pesa mismatch thika", metadata: JSON.stringify({ checkoutRequestId: "ws_CO_DEMO_PENDING_1" }), createdAt: todayAt(14, 21, 55) },
      { level: "INFO", component: "eTIMS", message: "2 invoices pending KRA submission", metadata: null, createdAt: todayAt(13, 45) },
      { level: "INFO", component: "System", message: "Engraved admin verified (self-healing OK)", metadata: null, createdAt: todayAt(6, 0) },
      { level: "WARN", component: "Rentals", message: "Rental overdue: Concrete Mixer 350L (5 days)", metadata: null, createdAt: daysAgo(1, 18, 30) },
    ],
  });

  // ── Audit trail (Recent Activity Timeline) ────────────────────────────────
  const auditDefs = [
    { action: "CREATE", entity: "Transaction", by: "Grace Wanjiku", role: "CASHIER", meta: { ref: bigSale.ref, total: todayNet * 1.16 }, h: 9, m: 42 },
    { action: "MPESA_CONFIRM", entity: "MpesaTransaction", by: "Grace Wanjiku", role: "CASHIER", meta: { receipt: "QK71HKM2VX" }, h: 9, m: 43 },
    { action: "APPROVE", entity: "Expense", by: "Peter Mbumah", role: "STORE_OWNER", meta: { category: "MAINTENANCE", amount: 22800 }, h: 11, m: 5 },
    { action: "CREATE", entity: "PurchaseOrder", by: "Joseph Kariuki", role: "INVENTORY_MANAGER", meta: { number: "PO-2026-003" }, h: 11, m: 48 },
    { action: "REMIND", entity: "Customer", by: "Mercy Achieng", role: "ACCOUNTANT", meta: { customer: "JOHN CONTRACTORS LTD" }, h: 12, m: 15 },
    { action: "LOGIN_SUCCESS", entity: "User", by: "System Administrator", role: "SUPER_ADMIN", meta: { ip: "10.0.0.2" }, h: 12, m: 40 },
    { action: "STOCK_ADJUST", entity: "Product", by: "Joseph Kariuki", role: "INVENTORY_MANAGER", meta: { type: "WRITE_OFF", qty: 2 }, h: 13, m: 22 },
    { action: "GIFT_CARD_ISSUE", entity: "GiftCard", by: "Faith Chebet", role: "CASHIER", meta: { code: "MBH-GC-7715-NKR" }, h: 13, m: 55 },
  ];
  for (const a of auditDefs) {
    await db.auditLog.create({ data: { userId: admin.id, action: a.action, entity: a.entity, entityId: null, meta: JSON.stringify(a.meta), ip: "10.0.0.2", userName: a.by, role: a.role, createdAt: todayAt(a.h, a.m) } });
  }

  // ── System config ─────────────────────────────────────────────────────────
  await db.systemConfig.createMany({
    data: [
      { key: "org_name", value: "Mbumah Hardware" },
      { key: "release_commit", value: "e49f48ec8f1119d71cde324d4453f2cc8b927b0b" },
      { key: "release_channel", value: "stable" },
      { key: "update_channel", value: "stable" },
      { key: "health_weights", value: JSON.stringify({ revenue: 30, stock: 25, debt: 25, engagement: 20 }) },
      { key: "canonical_demo_domain", value: "mbumahhardware.co.ke" },
      { key: "workspace_root_domain", value: "mbumah.co.ke" },
    ],
  });

  console.log("Seed complete: branches=5 users=11 products=%d invoices=%d debt=437,479 rentals=%d suppliers=%d", skuN, invSeq, rentalDefs.length, suppliers.length);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
