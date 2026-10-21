// MBUMAH HARDWARE POS - Exchange Rate API
//
// GET    /api/currency/rates - list all stored CurrencyRate rows
// POST   /api/currency/rates - upsert one or more rates (SUPER_ADMIN only)
// DELETE /api/currency/rates - reset one pair to its built-in rate (SUPER_ADMIN only)
//
// DELETE (v2.211.0): the admin surface that writes rates also un-writes
// them — deleting the (base, quote) row makes the pair fall back to the
// static constant, which is exactly what "Reset to built-in" means. The
// pair arrives as query params (?base=KES&quote=USD); a pair with no
// stored row answers 404 honestly (nothing to reset — the pair already
// reads its built-in rate) instead of pretending to have undone anything.
//
// Rates are stored as (base, quote) pairs in the `CurrencyRate` table
// (the model landed in v2.210.0 — the route queried db.currencyRate since
// birth while the model existed in NO schema, so GET silently fell back
// to the static list and POST was a guaranteed runtime 500).
// KES is the canonical pivot currency - typical rows are (KES, USD),
// (KES, UGX), (KES, TZS). The GET response always includes the static
// fallback rates from `currency-utils.ts` so the client can display
// something even when no DB rows exist (each entry names its own source:
// STATIC vs MANUAL vs API — the switcher speaks it per row).
//
// Auth:
//   • GET - any authenticated user can read rates (needed for the switcher;
//     enforced with requireAuth since v2.210.0 — the header always said so,
//     but the handler shipped unauthenticated).
//   • POST - SUPER_ADMIN only (financial configuration).

import { type NextRequest, NextResponse } from 'next/server';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { SUPPORTED_CURRENCIES, CURRENCY_BY_CODE, type CurrencyCode } from '@/lib/currency-utils';
import Decimal from 'decimal.js';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// GET: list all stored rates + static fallback
async function getHandler(): Promise<Response> {
  return runWithoutTenant(async () => {
    let rows: { base: string; quote: string; rate: Decimal; source: string; updatedAt: Date }[] = [];
    try {
      rows = await db.currencyRate.findMany({
        orderBy: [{ base: 'asc' }, { quote: 'asc' }],
        select: { base: true, quote: true, rate: true, source: true, updatedAt: true },
      });
    } catch {
      // The table exists since v2.210.0; this catch now covers genuine DB
      // outages only. The static fallback stays honest: every currency's
      // `source` field reads STATIC so the client can never mistake a
      // built-in constant for an admin-managed rate.
      rows = [];
    }

    // Build a lookup of DB-stored rates keyed by `${base}_${quote}`.
    const dbMap = new Map<string, { rate: string; source: string; updatedAt: string }>();
    for (const r of rows) {
      dbMap.set(`${r.base}_${r.quote}`, {
        rate: r.rate.toString(),
        source: r.source,
        updatedAt: r.updatedAt.toISOString(),
      });
    }

    // For each supported currency, surface both the static fallback rate
    // (always present) and the DB-stored rate (if any). The client should
    // prefer the DB rate when present.
    const currencies = SUPPORTED_CURRENCIES.map((c) => {
      const key = `KES_${c.code}`;
      const dbRate = dbMap.get(key);
      // Static: 1 unit of c.code = c.exchangeRateToKES KES
      // → 1 KES = 1 / c.exchangeRateToKES of c.code
      const staticRateToKES = c.exchangeRateToKES;
      return {
        code: c.code,
        name: c.name,
        symbol: c.symbol,
        flag: c.flag,
        decimals: c.decimals,
        // How many KES one unit of this currency equals.
        rateToKES: dbRate ? Number(dbRate.rate) : staticRateToKES,
        // How many units of this currency one KES equals.
        kesToRate: dbRate
          ? Number(new Decimal(1).div(dbRate.rate).toDecimalPlaces(c.decimals, Decimal.ROUND_HALF_EVEN))
          : Number(new Decimal(1).div(staticRateToKES).toDecimalPlaces(c.decimals, Decimal.ROUND_HALF_EVEN)),
        source: dbRate?.source ?? 'STATIC',
        updatedAt: dbRate?.updatedAt ?? null,
      };
    });

    return NextResponse.json({
      data: {
        baseCurrency: 'KES' as CurrencyCode,
        currencies,
        // Raw (base, quote) rows for admin tooling.
        rawRates: rows.map((r) => ({
          base: r.base,
          quote: r.quote,
          rate: r.rate.toString(),
          source: r.source,
          updatedAt: r.updatedAt.toISOString(),
        })),
      },
    });
  });
}

// POST: upsert rates (SUPER_ADMIN only)
//
// Request body:
//   { rates: [{ base: "KES", quote: "USD", rate: "152.5", source?: "MANUAL" }] }
//
// `source` defaults to "MANUAL". Each rate is upserted atomically; if any
// single upsert fails the whole batch is rolled back (we run inside a tx).

const rateItemSchema = z.object({
  base: z.enum(['KES', 'USD', 'UGX', 'TZS']),
  quote: z.enum(['KES', 'USD', 'UGX', 'TZS']),
  rate: z.union([z.string(), z.number()]).refine((v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  }, 'rate must be a positive number'),
  source: z.enum(['MANUAL', 'API']).optional().default('MANUAL'),
});

const postBodySchema = z.object({
  rates: z.array(rateItemSchema).min(1, 'at least one rate is required'),
});

async function postHandler(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Validation failed.',
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  return runWithoutTenant(async () => {
    const results = await db.$transaction(
      parsed.data.rates.map((r) =>
        db.currencyRate.upsert({
          where: { base_quote: { base: r.base, quote: r.quote } },
          create: {
            base: r.base,
            quote: r.quote,
            rate: new Decimal(r.rate),
            source: r.source,
          },
          update: {
            rate: new Decimal(r.rate),
            source: r.source,
          },
          select: { base: true, quote: true, rate: true, source: true, updatedAt: true },
        }),
      ),
    );

    return NextResponse.json({
      success: true,
      data: results.map((r) => ({
        base: r.base,
        quote: r.quote,
        rate: r.rate.toString(),
        source: r.source,
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  });
}

export const GET = withErrorBoundary(requireAuth(getHandler), 'CURRENCY_RATES');
export const POST = requireAuth(postHandler, { roles: ['SUPER_ADMIN'] });

// DELETE: reset one (base, quote) pair to its built-in rate (SUPER_ADMIN only).
//
// Query params: ?base=KES&quote=USD — the same pair enum the POST accepts.
// Deleting the row removes the override; the GET falls back to the static
// constant and the switcher's chip flips back to "built-in". A pair with
// no stored row answers 404 (nothing to reset), never a silent 200.
const deletePairSchema = z.object({
  base: z.enum(['KES', 'USD', 'UGX', 'TZS']),
  quote: z.enum(['KES', 'USD', 'UGX', 'TZS']),
});

async function deleteHandler(request: NextRequest): Promise<Response> {
  const base = request.nextUrl.searchParams.get('base');
  const quote = request.nextUrl.searchParams.get('quote');
  const parsed = deletePairSchema.safeParse({ base, quote });
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: 'Validation failed — base and quote query params are required (one of KES, USD, UGX, TZS).',
        details: parsed.error.flatten(),
      },
      { status: 422 },
    );
  }

  return runWithoutTenant(async () => {
    const existing = await db.currencyRate.findUnique({
      where: { base_quote: { base: parsed.data.base, quote: parsed.data.quote } },
      select: { base: true, quote: true, rate: true, source: true, updatedAt: true },
    });
    if (!existing) {
      // The honest nothing: the pair already rides its built-in constant,
      // so there is nothing to un-write. 404, not a pretend-success.
      return NextResponse.json(
        {
          success: false,
          error: `No stored rate for ${parsed.data.base}→${parsed.data.quote} — this pair already reads its built-in rate.`,
        },
        { status: 404 },
      );
    }
    await db.currencyRate.delete({
      where: { base_quote: { base: parsed.data.base, quote: parsed.data.quote } },
    });
    return NextResponse.json({
      success: true,
      data: {
        deleted: {
          base: existing.base,
          quote: existing.quote,
          rate: existing.rate.toString(),
          source: existing.source,
          updatedAt: existing.updatedAt.toISOString(),
        },
      },
    });
  });
}

export const DELETE = requireAuth(deleteHandler, { roles: ['SUPER_ADMIN'] });

// Suppress unused-import warning for CURRENCY_BY_CODE (kept for future
// admin endpoints that need full metadata lookups).
void CURRENCY_BY_CODE;
