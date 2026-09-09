// Path: src/lib/api-helpers.ts
// Shared API plumbing: response envelope, operator identity + RBAC resolution.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CreditApiError } from '@/lib/credit-service'

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status })
}

export function fail(message: string, status = 400, code = 'BAD_REQUEST') {
  return NextResponse.json({ ok: false, error: { message, code } }, { status })
}

/** Map thrown errors to responses; wrap every route handler with this. */
export function handleError(err: unknown) {
  if (err instanceof CreditApiError) {
    return fail(err.message, err.status, err.code)
  }
  if (err instanceof SyntaxError) {
    return fail('Malformed JSON body', 400, 'INVALID_JSON')
  }
  console.error('[API-ERROR]', err)
  const message = err instanceof Error ? err.message : 'Internal server error'
  return fail(message, 500, 'INTERNAL')
}

export type Role = 'OWNER' | 'MANAGER' | 'ACCOUNTANT' | 'CASHIER'

export interface Operator {
  id: string
  name: string
  role: Role
}

const ROLE_RANK: Record<Role, number> = { CASHIER: 0, ACCOUNTANT: 1, MANAGER: 2, OWNER: 3 }

/**
 * Resolve the acting operator. Production (upstream repo): derive from
 * `requireAuth` session — `session.userId` → User row. Sandbox demo: optional
 * `operatorId` in the body/query validated against the User table, falling
 * back to the branch OWNER.
 */
export async function resolveOperator(operatorId?: string | null): Promise<Operator> {
  if (operatorId) {
    const u = await db.user.findUnique({ where: { id: operatorId } })
    if (!u) throw new CreditApiError(401, 'UNKNOWN_OPERATOR', 'Unknown operator identity')
    return { id: u.id, name: u.name, role: u.role as Role }
  }
  const owner = await db.user.findFirst({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' } })
  if (!owner) throw new CreditApiError(500, 'NO_OWNER', 'No owner account seeded')
  return { id: owner.id, name: owner.name, role: owner.role as Role }
}

export function requireRole(op: Operator, min: Role, action: string): void {
  if (ROLE_RANK[op.role] < ROLE_RANK[min]) {
    throw new CreditApiError(
      403,
      'FORBIDDEN',
      `${op.role} is not authorised to ${action} — requires ${min} or above`,
    )
  }
}
