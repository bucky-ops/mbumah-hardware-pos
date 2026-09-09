// Path: src/app/api/customers/route.ts
// GET  → customer directory with live credit assessments (search + filters)
// POST → register customer with an approved credit limit
//
// FIXES vs upstream repo (bucky-ops/mbumah-hardware-pos):
//  - BOLA: no caller-supplied storeId — branch resolved server-side
//    (upstream GET /api/customers trusted ?storeId → cross-store reads).
//  - debtLimit/creditLimit creation is captured with approver identity
//    (upstream accepted raw debtLimit with no approval metadata).
//  - zod validation on every field (upstream read preferredChannel outside schema).

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { fail, handleError, ok, resolveOperator, requireRole, type Role } from '@/lib/api-helpers'
import { loadPortfolio } from '@/lib/credit-service'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = (searchParams.get('search') ?? '').trim().toLowerCase()
    const statusFilter = searchParams.get('status') ?? 'ALL' // ALL|ACTIVE|SUSPENDED|DEFAULTED
    const verdictFilter = searchParams.get('verdict') ?? 'ALL'

    const branch = await db.branch.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!branch) return ok({ entries: [], kpis: null })

    const portfolio = await loadPortfolio(branch.id)
    let entries = portfolio.entries
    if (search) {
      entries = entries.filter(
        (e) => e.name.toLowerCase().includes(search) || (e.phone ?? '').includes(search),
      )
    }
    if (statusFilter !== 'ALL') entries = entries.filter((e) => e.creditStatus === statusFilter)
    if (verdictFilter !== 'ALL')
      entries = entries.filter((e) => e.assessment.verdict.code === verdictFilter)

    return ok({ entries, kpis: portfolio.kpis, agingByBucket: portfolio.agingByBucket })
  } catch (err) {
    return handleError(err)
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  type: z.enum(['INDIVIDUAL', 'COMPANY']).default('INDIVIDUAL'),
  phone: z
    .string()
    .trim()
    .regex(/^(\+?254|0)[17]\d{8}$/, 'Use a valid Kenyan phone (07XX XXX XXX or +2547XX…) ')
    .optional()
    .or(z.literal('')),
  email: z.string().trim().email('Invalid email').optional().or(z.literal('')),
  kraPin: z
    .string()
    .trim()
    .regex(/^[A-Z]\d{9}[A-Z]$/i, 'KRA PIN format: A000000000Z')
    .optional()
    .or(z.literal('')),
  address: z.string().trim().max(200).optional().or(z.literal('')),
  creditLimit: z.number().min(0, 'Limit cannot be negative').max(50_000_000).default(0),
  approverId: z.string().min(1, 'Credit limit requires an approver'),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return fail(parsed.error.issues[0]?.message ?? 'Invalid input', 422, 'VALIDATION')
    }
    const data = parsed.data
    const approver = await resolveOperator(data.approverId)
    requireRole(approver, 'MANAGER' as Role, 'approve a new credit limit')

    const branch = await db.branch.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!branch) return fail('Seed the store first (POST /api/seed)', 409, 'NOT_SEEDED')

    if (data.phone) {
      const dup = await db.customer.findFirst({ where: { phone: data.phone } })
      if (dup) return fail(`Phone already registered to ${dup.name}`, 409, 'DUPLICATE_PHONE')
    }

    const customer = await db.customer.create({
      data: {
        branchId: branch.id,
        name: data.name,
        type: data.type,
        phone: data.phone || null,
        email: data.email || null,
        kraPin: data.kraPin ? data.kraPin.toUpperCase() : null,
        address: data.address || null,
        creditLimit: new Prisma.Decimal(data.creditLimit),
        approvedById: approver.id,
        approvedByName: approver.name,
        approvedAt: new Date(),
        notes: data.notes || null,
      },
    })

    if (data.creditLimit > 0) {
      await db.creditLimitChange.create({
        data: {
          customerId: customer.id,
          oldLimit: new Prisma.Decimal(0),
          newLimit: new Prisma.Decimal(data.creditLimit),
          reason: 'Initial credit limit at registration',
          requestedById: approver.id,
          requestedByName: approver.name,
          approvedById: approver.id,
          approvedByName: approver.name,
        },
      })
    }

    return ok({ customer }, 201)
  } catch (err) {
    return handleError(err)
  }
}
