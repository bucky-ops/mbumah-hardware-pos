// Path: src/app/api/seed/route.ts
// POST → seed the Customer Credit Engine demo portfolio (idempotent, force-reset).
// GET  → seed status (used by the UI to show the "Load demo data" button).
//
// Demo portfolio covers EVERY verdict class:
//   JOHN CONTRACTORS LTD   384,500 / 400,000 (96.1% util, 92,000 overdue 75d)
//                          → "🔴 DO NOT EXTEND CREDIT"   ← the requested example
//   Otieno & Sons Timber    78,400 /  80,000 (98% util)  → 🔴 DO NOT EXTEND
//   Wanjiru Hardware        45,000 / 100,000 SUSPENDED   → 🔴 DO NOT EXTEND
//   Kisii Quarry Suppliers 132,000 / 120,000 DEFAULTED  → 🔴 DO NOT EXTEND
//   Tumaini School          62,000 / 150,000 18d overdue → 🟠 RESTRICTED
//   Nairobi Skies Hotel    415,000 / 500,000 (83% util)  → 🟡 CAUTION
//   Kamau Electricals            0 / 250,000 on-time 91  → 🟢 GOOD STANDING
//   Beth Mwangi                  0 /  30,000 on-time 84  → 🟢 GOOD STANDING
//   Kiprop Farm Supplies         0 /  40,000 no history  → ⚪ NEW — PROVISIONAL
//
// VAT NOTE: seeded invoices use VAT-INCLUSIVE quoting (standard for Kenyan
// hardware price lists): total is the quoted figure; net = round2(total/1.16);
// vatAmount = total − net. The interactive POST /api/invoices route uses the
// VAT-EXCLUSIVE model (net price × 1.16). Both are valid VAT Act presentations
// and both are Decimal-exact.

import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { handleError, ok } from '@/lib/api-helpers'
import { recomputeCustomerScore } from '@/lib/credit-service'

const DAY = 86_400_000
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v)

function d(days: number, hour = 9): Date {
  const base = Date.now() + days * DAY
  const dt = new Date(base)
  dt.setUTCHours(hour, 0, 0, 0)
  return dt
}

/** Split an inclusive total into net + VAT with Decimal exactness. */
function vatSplit(totalInclusive: number): { net: Prisma.Decimal; vat: Prisma.Decimal; total: Prisma.Decimal } {
  const total = D(totalInclusive)
  const net = total.dividedBy(new Prisma.Decimal('1.16')).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
  return { net, vat: total.minus(net), total }
}

interface LineSpec {
  description: string
  sku: string
  qty: number
  unitPrice: number
}

/** Build 2 line items whose NET sum is exactly `net`. */
function makeLines(net: Prisma.Decimal, primary: LineSpec): LineSpec[] {
  const spent = D(primary.qty).times(D(primary.unitPrice))
  const remainder = net.minus(spent)
  const lines: LineSpec[] = [primary]
  if (remainder.gt(0)) {
    lines.push({
      description: 'Assorted fittings, fixings & delivery',
      sku: 'SRV-MISC',
      qty: 1,
      unitPrice: remainder.toNumber(),
    })
  }
  return lines
}

interface SeedInvoice {
  totalIncl: number
  issued: number // days offset
  due: number
  paid?: number // days offset when settled (undefined → open)
  method?: 'CASH' | 'MPESA' | 'BANK' | 'CHEQUE'
  primary: LineSpec
}

interface SeedCustomer {
  name: string
  type: 'INDIVIDUAL' | 'COMPANY'
  phone: string
  email?: string
  kraPin?: string
  address?: string
  creditLimit: number
  creditStatus?: 'ACTIVE' | 'SUSPENDED' | 'DEFAULTED'
  approvedAt?: number
  invoices: SeedInvoice[]
}

const CEMENT = (qty: number): LineSpec => ({
  description: 'Premier Cement 32.5N — 50kg bag',
  sku: 'CEM-32.5-50',
  qty,
  unitPrice: 350,
})
const STEEL = (qty: number, price: number): LineSpec => ({
  description: 'D8 Deformed Steel Bar — 12m',
  sku: 'STL-D8-12',
  qty,
  unitPrice: price,
})
const ROOF = (qty: number, price: number): LineSpec => ({
  description: 'IT4 Pre-painted Roofing Sheet — 3m',
  sku: 'ROF-IT4-3M',
  qty,
  unitPrice: price,
})
const PAINT = (qty: number, price: number): LineSpec => ({
  description: 'Crown Silk Vinyl Emulsion — 20L',
  sku: 'PNT-SV-20',
  qty,
  unitPrice: price,
})

const SEED_CUSTOMERS: SeedCustomer[] = [
  {
    name: 'JOHN CONTRACTORS LTD',
    type: 'COMPANY',
    phone: '0722123456',
    email: 'accounts@johncontractors.co.ke',
    kraPin: 'P051234567X',
    address: 'Mombasa Road, Nairobi',
    creditLimit: 400_000,
    approvedAt: -300,
    invoices: [
      { totalIncl: 105_000, issued: -300, due: -270, paid: -235, method: 'BANK', primary: CEMENT(250) },
      { totalIncl: 88_000, issued: -200, due: -170, paid: -135, method: 'MPESA', primary: STEEL(30, 2100) },
      { totalIncl: 92_000, issued: -105, due: -75, primary: CEMENT(220) },
      { totalIncl: 150_000, issued: -10, due: 20, primary: ROOF(60, 2200) },
      { totalIncl: 142_500, issued: -5, due: 25, primary: STEEL(45, 2800) },
    ],
  },
  {
    name: 'Kamau Electricals Ltd',
    type: 'COMPANY',
    phone: '0733223344',
    email: 'jkamau@kamauelectricals.co.ke',
    kraPin: 'P051765432Y',
    address: 'Luthuli Avenue, Nairobi',
    creditLimit: 250_000,
    approvedAt: -430,
    invoices: [
      { totalIncl: 210_000, issued: -430, due: -400, paid: -400, method: 'BANK', primary: PAINT(40, 4800) },
      { totalIncl: 185_000, issued: -370, due: -340, paid: -340, method: 'MPESA', primary: CEMENT(450) },
      { totalIncl: 96_000, issued: -310, due: -280, paid: -276, method: 'MPESA', primary: STEEL(35, 2400) },
      { totalIncl: 240_000, issued: -250, due: -220, paid: -220, method: 'BANK', primary: ROOF(90, 2300) },
      { totalIncl: 155_000, issued: -190, due: -160, paid: -160, method: 'MPESA', primary: CEMENT(400) },
      { totalIncl: 354_000, issued: -130, due: -100, paid: -100, method: 'BANK', primary: ROOF(130, 2400) },
    ],
  },
  {
    name: 'Nairobi Skies Hotel',
    type: 'COMPANY',
    phone: '0744556677',
    email: 'procurement@nairobiskies.co.ke',
    kraPin: 'P052345678Z',
    address: 'Upper Hill, Nairobi',
    creditLimit: 500_000,
    approvedAt: -500,
    invoices: [
      { totalIncl: 180_000, issued: -500, due: -470, paid: -470, method: 'BANK', primary: PAINT(30, 5000) },
      { totalIncl: 220_000, issued: -410, due: -380, paid: -380, method: 'BANK', primary: ROOF(80, 2400) },
      { totalIncl: 195_000, issued: -330, due: -300, paid: -300, method: 'MPESA', primary: CEMENT(500) },
      { totalIncl: 245_000, issued: -240, due: -210, paid: -210, method: 'BANK', primary: STEEL(70, 3000) },
      { totalIncl: 180_000, issued: -15, due: 15, primary: PAINT(35, 4700) },
      { totalIncl: 145_000, issued: -8, due: 22, primary: CEMENT(380) },
      { totalIncl: 90_000, issued: -2, due: 28, primary: ROOF(35, 2300) },
    ],
  },
  {
    name: 'Tumaini Secondary School',
    type: 'COMPANY',
    phone: '0712998877',
    email: 'bursar@tumainischool.ac.ke',
    kraPin: null as unknown as string,
    address: 'Kiambu Road',
    creditLimit: 150_000,
    approvedAt: -300,
    invoices: [
      { totalIncl: 120_000, issued: -300, due: -270, paid: -270, method: 'BANK', primary: CEMENT(300) },
      { totalIncl: 98_000, issued: -210, due: -180, paid: -180, method: 'CHEQUE', primary: PAINT(20, 4400) },
      { totalIncl: 102_000, issued: -150, due: -120, paid: -120, method: 'BANK', primary: STEEL(30, 2900) },
      { totalIncl: 18_000, issued: -42, due: -12, primary: PAINT(4, 4000) },
      { totalIncl: 44_000, issued: -12, due: 18, primary: CEMENT(110) },
    ],
  },
  {
    name: 'Wanjiru Hardware Retail',
    type: 'COMPANY',
    phone: '0723112233',
    email: 'wanjiru@mbumah.co.ke',
    address: 'Gikambura, Kikuyu',
    creditLimit: 100_000,
    creditStatus: 'SUSPENDED',
    approvedAt: -260,
    invoices: [
      { totalIncl: 115_000, issued: -260, due: -230, paid: -230, method: 'MPESA', primary: CEMENT(280) },
      { totalIncl: 145_000, issued: -210, due: -180, paid: -155, method: 'CHEQUE', primary: ROOF(55, 2300) },
      { totalIncl: 45_000, issued: -50, due: -20, primary: PAINT(10, 4100) },
    ],
  },
  {
    name: 'Otieno & Sons Timber',
    type: 'COMPANY',
    phone: '0756443322',
    email: 'otienosons@gmail.com',
    address: 'Ngong Road, Nairobi',
    creditLimit: 80_000,
    approvedAt: -160,
    invoices: [
      { totalIncl: 231_600, issued: -160, due: -100, paid: -100, method: 'BANK', primary: ROOF(85, 2400) },
      { totalIncl: 78_400, issued: -2, due: 28, primary: CEMENT(190) },
    ],
  },
  {
    name: 'Beth Mwangi',
    type: 'INDIVIDUAL',
    phone: '0799111000',
    address: 'Zimmerman, Nairobi',
    creditLimit: 30_000,
    approvedAt: -150,
    invoices: [
      { totalIncl: 32_000, issued: -150, due: -120, paid: -122, method: 'MPESA', primary: CEMENT(70) },
      { totalIncl: 28_000, issued: -90, due: -60, paid: -60, method: 'MPESA', primary: PAINT(6, 4200) },
      { totalIncl: 24_000, issued: -45, due: -15, paid: -15, method: 'MPESA', primary: STEEL(8, 2600) },
    ],
  },
  {
    name: 'Kiprop Farm Supplies',
    type: 'COMPANY',
    phone: '0770334455',
    email: 'kipropfarms@gmail.com',
    address: 'Eldama Ravine Road',
    creditLimit: 40_000,
    approvedAt: -7,
    invoices: [],
  },
  {
    name: 'Kisii Quarry Suppliers',
    type: 'COMPANY',
    phone: '0718889900',
    email: 'kisiiquarry@yahoo.com',
    address: 'Mlolongo, Machakos',
    creditLimit: 120_000,
    creditStatus: 'DEFAULTED',
    approvedAt: -400,
    invoices: [
      { totalIncl: 150_000, issued: -400, due: -370, paid: -290, method: 'CHEQUE', primary: ROOF(55, 2350) },
      { totalIncl: 60_000, issued: -160, due: -130, primary: CEMENT(150) },
      { totalIncl: 72_000, issued: -125, due: -95, primary: STEEL(22, 2900) },
    ],
  },
]

export async function GET() {
  try {
    const [branches, customers, invoices, payments] = await Promise.all([
      db.branch.count(),
      db.customer.count(),
      db.invoice.count(),
      db.payment.count(),
    ])
    return ok({ seeded: customers > 0, branches, customers, invoices, payments })
  } catch (err) {
    return handleError(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const force = Boolean((body as { force?: boolean }).force)

    const existing = await db.customer.count()
    if (existing > 0 && !force) {
      return ok({ skipped: true, message: 'Data already present — pass force=true to reset' })
    }

    // Wipe in FK-safe order (demo reset only).
    await db.paymentReminder.deleteMany()
    await db.creditLimitChange.deleteMany()
    await db.creditLedgerEntry.deleteMany()
    await db.payment.deleteMany()
    await db.invoiceItem.deleteMany()
    await db.invoice.deleteMany()
    await db.customer.deleteMany()
    await db.user.deleteMany()
    await db.branch.deleteMany()

    const branch = await db.branch.create({
      data: { name: 'Mbumah Hardware — Nairobi Main', code: 'MBM-001' },
    })

    const users = await Promise.all([
      db.user.create({ data: { name: 'Grace Wanjiku', email: 'grace@mbumah.co.ke', role: 'OWNER', branchId: branch.id } }),
      db.user.create({ data: { name: 'Daniel Otieno', email: 'daniel@mbumah.co.ke', role: 'MANAGER', branchId: branch.id } }),
      db.user.create({ data: { name: 'Amina Hassan', email: 'amina@mbumah.co.ke', role: 'ACCOUNTANT', branchId: branch.id } }),
      db.user.create({ data: { name: 'Peter Kariuki', email: 'peter@mbumah.co.ke', role: 'CASHIER', branchId: branch.id } }),
    ])
    const [owner, manager] = users

    let invoiceSeq = 0
    const createdCustomerIds: string[] = []

    for (const sc of SEED_CUSTOMERS) {
      const customer = await db.customer.create({
        data: {
          branchId: branch.id,
          name: sc.name,
          type: sc.type,
          phone: sc.phone,
          email: sc.email ?? null,
          kraPin: sc.kraPin ?? null,
          address: sc.address ?? null,
          creditLimit: D(sc.creditLimit),
          creditStatus: sc.creditStatus ?? 'ACTIVE',
          approvedById: sc.creditLimit > 200_000 ? owner.id : manager.id,
          approvedByName: sc.creditLimit > 200_000 ? owner.name : manager.name,
          approvedAt: d(sc.approvedAt ?? -1),
          notes: sc.creditStatus === 'SUSPENDED' ? '[CREDIT-STATUS] Facility suspended after bounced cheque — collections hold.' : null,
        },
      })
      createdCustomerIds.push(customer.id)

      // Registration + current-limit approval trail.
      await db.creditLimitChange.create({
        data: {
          customerId: customer.id,
          oldLimit: D(0),
          newLimit: D(Math.round(sc.creditLimit / 2)),
          reason: 'Initial limit at registration',
          requestedById: manager.id,
          requestedByName: manager.name,
          approvedById: owner.id,
          approvedByName: owner.name,
          approvedAt: d(sc.approvedAt ?? -1),
        },
      })
      if (sc.creditLimit > 0) {
        await db.creditLimitChange.create({
          data: {
            customerId: customer.id,
            oldLimit: D(Math.round(sc.creditLimit / 2)),
            newLimit: D(sc.creditLimit),
            reason:
              sc.creditLimit > 200_000
                ? 'Verified contract pipeline + clean 6-month payment record'
                : 'Standard review — steady trade pattern',
            requestedById: manager.id,
            requestedByName: manager.name,
            approvedById: owner.id,
            approvedByName: owner.name,
            approvedAt: d((sc.approvedAt ?? -1) + 30),
          },
        })
      }

      // Chronological ledger assembly: charges at issue, payments at settlement.
      type LedgerOp = { at: Date; amount: Prisma.Decimal; type: string; note: string; refId?: string }
      const ops: LedgerOp[] = []
      const statusNote =
        sc.creditStatus === 'DEFAULTED'
          ? ' — escalated to DEFAULTED after 90+ day arrears'
          : ''

      for (const si of sc.invoices) {
        invoiceSeq += 1
        const number = `INV-${new Date().getFullYear()}-${String(invoiceSeq).padStart(4, '0')}`
        const { net, vat, total } = vatSplit(si.totalIncl)
        const issuedAt = d(si.issued)
        const dueDate = d(si.due)
        const isSettled = si.paid !== undefined
        const invoice = await db.invoice.create({
          data: {
            branchId: branch.id,
            customerId: customer.id,
            number,
            subtotal: net,
            vatAmount: vat,
            total,
            amountPaid: isSettled ? total : D(0),
            status: isSettled ? 'PAID' : 'UNPAID',
            termsDays: 30,
            issuedAt,
            dueDate,
          },
        })
        const lines = makeLines(net, si.primary)
        for (const l of lines) {
          await db.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              description: l.description,
              sku: l.sku,
              qty: D(l.qty),
              unitPrice: D(l.unitPrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
              lineTotal: D(l.qty).times(D(l.unitPrice)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
            },
          })
        }
        ops.push({ at: issuedAt, amount: total, type: 'CHARGE', note: `${number} — credit sale`, refId: invoice.id })
        if (isSettled && si.paid !== undefined) {
          const paidAt = d(si.paid)
          await db.payment.create({
            data: {
              branchId: branch.id,
              customerId: customer.id,
              invoiceId: invoice.id,
              amount: total,
              method: si.method ?? 'MPESA',
              reference: si.method === 'MPESA' ? `Q${Math.abs(si.paid)}X${invoiceSeq}` : null,
              receivedById: owner.id,
              receivedByName: owner.name,
              createdAt: paidAt,
            },
          })
          ops.push({ at: paidAt, amount: total.negated(), type: 'PAYMENT', note: `${number} settled via ${si.method ?? 'MPESA'}`, refId: invoice.id })
        }
      }

      ops.sort((a, b) => a.at.getTime() - b.at.getTime())
      let running = D(0)
      for (const op of ops) {
        running = running.plus(op.amount)
        await db.creditLedgerEntry.create({
          data: {
            branchId: branch.id,
            customerId: customer.id,
            type: op.type,
            amount: op.amount,
            balanceAfter: running.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
            refType: op.type === 'CHARGE' ? 'INVOICE' : 'PAYMENT',
            refId: op.refId,
            note: op.note + (op.type === 'CHARGE' ? statusNote : ''),
            createdById: owner.id,
            createdByName: owner.name,
            createdAt: op.at,
          },
        })
      }

      // Sync the denormalized outstanding balance from the ledger replay.
      await db.customer.update({
        where: { id: customer.id },
        data: { outstanding: running.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP) },
      })

      // Historical reminders for the distressed accounts.
      if (sc.name === 'JOHN CONTRACTORS LTD') {
        await db.paymentReminder.create({
          data: {
            branchId: branch.id,
            customerId: customer.id,
            channel: 'SMS',
            message: 'URGENT reminder: John Contractors, your Mbumah Hardware account has KES 92,000 overdue (75 days past due). Total outstanding: KES 384,500. Please settle immediately to avoid facility suspension. — Mbumah Hardware Credit Desk',
            status: 'SIMULATED',
            providerRef: 'sim_seed_jcl_1',
            sentAt: d(-3),
            createdAt: d(-3),
          },
        })
      }
      if (sc.creditStatus === 'SUSPENDED' || sc.creditStatus === 'DEFAULTED') {
        await db.paymentReminder.create({
          data: {
            branchId: branch.id,
            customerId: customer.id,
            channel: 'WHATSAPP',
            message: `FINAL DEMAND: settle your overdue Mbumah Hardware balance to restore credit services. — Credit Desk${statusNote}`,
            status: 'SIMULATED',
            providerRef: 'sim_seed_demand',
            sentAt: d(-8),
            createdAt: d(-8),
          },
        })
      }
    }

    // Recompute cached scores from the real engine so stored values are
    // engine-consistent (single source of truth).
    const scores: Array<{ name: string; score: number }> = []
    for (const id of createdCustomerIds) {
      const score = await recomputeCustomerScore(db, id)
      const c = await db.customer.findUnique({ where: { id }, select: { name: true } })
      scores.push({ name: c?.name ?? id, score })
    }

    return ok({
      seeded: true,
      branch: branch.name,
      users: users.map((u) => `${u.name} (${u.role})`),
      customers: createdCustomerIds.length,
      invoices: invoiceSeq,
      scores,
    })
  } catch (err) {
    return handleError(err)
  }
}
