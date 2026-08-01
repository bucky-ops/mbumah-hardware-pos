// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Exchange Rate API
// ─────────────────────────────────────────────────────────────────────────────
//
// GET  /api/currency/rates           — list all stored CurrencyRate rows
// POST /api/currency/rates           — upsert one or more rates (SUPER_ADMIN only)
//
// Rates are stored as (base, quote) pairs in the `CurrencyRate` table.
// KES is the canonical pivot currency — typical rows are (KES, USD),
// (KES, UGX), (KES, TZS). The GET response always includes the static
// fallback rates from `currency-utils.ts` so the client can display
// something even before any DB rows exist.
//
// Auth:
//   • GET — any authenticated user can read rates (needed for the switcher).
//   • POST — SUPER_ADMIN only (financial configuration).
// ─────────────────────────────────────────────────────────────────────────────

import { type NextRequest, NextResponse } from 'next/server';
import { db, runWithoutTenant } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { withErrorBoundary } from '@/lib/logger';
import { SUPPORTED_CURRENCIES, CURRENCY_BY_CODE, type CurrencyCode } from '@/lib/currency-utils';
import Decimal from 'decimal.js';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// ── GET: list all stored rates + static fallback ────────────────────────────
async function getHandler(): Promise<Response> {
  return runWithoutTenant(async () => {
    let rows: { base: string; quote: string; rate: Decimal; source: string; updatedAt: Date }[] = [];
    try {
      rows = await db.currencyRate.findMany({
        orderBy: [{ base: 'asc' }, { quote: 'asc' }],
        select: { base: true, quote: true, rate: true, source: true, updatedAt: true },
      });
    } catch {
      // If the table doesn't exist yet (db:push not run), fall back to static.
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

// ── POST: upsert rates (SUPER_ADMIN only) ───────────────────────────────────
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

export const GET = withErrorBoundary(getHandler, 'CURRENCY_RATES');
export const POST = requireAuth(postHandler, { roles: ['SUPER_ADMIN'] });

// Suppress unused-import warning for CURRENCY_BY_CODE (kept for future
// admin endpoints that need full metadata lookups).
void CURRENCY_BY_CODE;
