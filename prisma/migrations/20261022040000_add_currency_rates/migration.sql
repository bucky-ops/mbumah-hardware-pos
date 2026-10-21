-- v2.210.0: the currency wire gains its model. The /api/currency/rates
-- route (src/app/api/currency/rates/route.ts) has queried
-- db.currencyRate since birth, but the model existed in NO schema —
-- GET silently fell back to the static list and POST was a guaranteed
-- runtime 500 — the same phantom-delegate class as DeadLetterQueue
-- (v2.209.0), found by the phantom-model sweep. This table is the
-- contract the code always assumed: (base, quote) pairs with the
-- compound unique the route's `where: { base_quote }` demands, the
-- Decimal rate, the MANUAL|API source, and the timestamps the GET
-- surface reads. GLOBAL financial configuration — deliberately NOT
-- store-scoped (the route reads it inside runWithoutTenant).

CREATE TABLE "currency_rates" (
    "id" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "currency_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "currency_rates_base_quote_key" ON "currency_rates"("base", "quote");
