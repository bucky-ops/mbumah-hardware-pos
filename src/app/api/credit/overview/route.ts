// Path: src/app/api/credit/overview/route.ts
// GET → branch portfolio overview: KPIs, aging distribution, verdict mix,
// watchlist. This powers the Credit Engine dashboard.
// SECURITY: branchId must come from the session in production
// (upstream: requireStoreAccess → session.storeId).

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { handleError, ok } from '@/lib/api-helpers'
import { loadPortfolio } from '@/lib/credit-service'

export async function GET(_req: NextRequest) {
  try {
    const branch = await db.branch.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!branch) return ok({ empty: true })
    const portfolio = await loadPortfolio(branch.id)
    return ok({ branch, ...portfolio })
  } catch (err) {
    return handleError(err)
  }
}
