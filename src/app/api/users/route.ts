// Path: src/app/api/users/route.ts
// GET → operator directory (id/name/role) for the UI operator switcher.
// Production note: this is derived from the session in the upstream repo
// (`requireAuth`); the sandbox exposes it read-only with no PII.

import { db } from '@/lib/db'
import { handleError, ok } from '@/lib/api-helpers'

export async function GET() {
  try {
    const users = await db.user.findMany({
      select: { id: true, name: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    })
    return ok(users)
  } catch (err) {
    return handleError(err)
  }
}
