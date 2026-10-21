'use client';

// MBUMAH HARDWARE POS - CurrencySwitcher
//
// A dropdown button that lets the cashier switch the POS display currency
// between KES, USD, UGX, and TZS for cross-border East African trade.
//
// • Trigger button shows the active currency's flag + code.
// • Each menu item shows flag, code, name, and the KES exchange rate.
// • Since v2.210.0 the rows carry their rate's HONEST SOURCE: the first
//   open reads /api/currency/rates (the wire the CurrencyRate model backs)
//   and overlays any admin-managed (MANUAL) or API-fetched (API) rows on
//   the static list; each row names its source with a measured chip
//   (emerald admin-set / blue API / muted built-in). If the wire is
//   unreachable the rows render exactly as before — no chip, no invented
//   provenance — and the footer's "indicative" sentence stays the truth.
// • Since v2.212.0 the read shares the ADMIN CARD's query cache (the SAME
//   ['admin-currency-rates'] key): laziness is preserved — nothing is
//   fetched until the first open — but once the dropdown has been opened
//   the switcher is a live observer of the one wire, so a rate the admin
//   card writes (or resets) re-renders the chips and figures HERE without
//   a remount. One wire, two surfaces, one truth — now LIVE.
// • The footer speaks the read's freshness (the timestamp the cache
//   recorded) only when the wire actually answered; silence stays silence.
// • Selecting an item calls `switchCurrency()` from `useCurrency()`, which
//   updates the persisted `activeCurrency` in `useAppStore` - every
//   component that calls `useCurrency().format()` re-renders automatically.
//
// This is a DISPLAY-ONLY conversion. The canonical accounting currency
// remains KES; only the rendered strings change.

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCurrency } from '@/hooks/use-currency';
import {
  SUPPORTED_CURRENCIES,
  formatCurrency,
  type CurrencyMeta,
} from '@/lib/currency-utils';
import type { CurrencyCode } from '@/lib/money';
import { cn } from '@/lib/utils';

export interface CurrencySwitcherProps {
  /** Optional compact variant - shows only flag + code, no "Currency" label. */
  compact?: boolean;
  /** Additional Tailwind classes for the trigger button. */
  className?: string;
  /** Optional callback fired when the user picks a currency. */
  onChange?: (currency: CurrencyCode) => void;
}

/** Per-row provenance + the DB-backed KES rate, when the wire answered. */
interface RowRate {
  /** 1 KES equals this many units of the row's currency. */
  kesToRate: number;
  source: string;
  updatedAt: string | null;
}

/**
 * THE ONE-WIRE KEY (v2.212.0): the query-cache contract shared by the
 * currency switcher (top-bar, every page) and the admin desk's Exchange
 * Rates card. One key, one cached wire body — a rate the card writes or
 * resets invalidates THIS key and both surfaces re-read the same truth.
 * The single literal lives here; the card imports it (the one-writer law
 * applied to the cache contract itself).
 */
export const ADMIN_CURRENCY_RATES_QUERY_KEY = ['admin-currency-rates'] as const;

/** What one /api/currency/rates entry teaches this component. */
interface RateWireEntry {
  code: string;
  /** How many units of this currency one KES equals (already rounded). */
  kesToRate: number;
  /** STATIC | MANUAL | API — the wire's own provenance. */
  source: string;
  updatedAt: string | null;
}

/** What the GET answers — the SAME body shape the admin card reads. */
interface RatesWireBody {
  data?: {
    currencies?: RateWireEntry[];
  };
}

/** Authenticated fetch — the SAME contract the admin card's helper keeps
 * (bearer from the persisted session when present, cookies same-origin). */
async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}

const SOURCE_PHRASE: Record<string, string> = {
  MANUAL: 'admin-set rate',
  API: 'API rate',
  STATIC: 'built-in rate',
};

/**
 * Render a single currency row in the dropdown. Extracted so the parent
 * component stays declarative and the row's aria-label is consistent.
 */
function CurrencyRow({
  meta,
  active,
  onSelect,
  dbRate,
}: {
  meta: CurrencyMeta;
  active: boolean;
  onSelect: (code: CurrencyCode) => void;
  /** Present only when the rates wire answered for this row. */
  dbRate?: RowRate;
}) {
  // Show "1 KES = N {symbol}" for non-KES currencies; for KES show "Base".
  // A DB-backed row (admin-set or API) speaks its own figure; the static
  // constant is only the fallback, never a claim about the wire.
  const rateLabel =
    meta.code === 'KES'
      ? 'Base currency'
      : `1 KES = ${formatCurrency(dbRate ? dbRate.kesToRate : 1 / meta.exchangeRateToKES, meta.code)}`;

  const sourcePhrase = dbRate ? SOURCE_PHRASE[dbRate.source] : undefined;

  return (
    <DropdownMenuItem
      // `onSelect` fires on click/Enter/Space - Radix handles a11y.
      onSelect={(e) => {
        // Prevent the dropdown from closing before our handler runs in
        // some edge cases (defensive - Radix usually handles this).
        e.preventDefault();
        onSelect(meta.code);
      }}
      className={cn(
        'flex items-center gap-2.5 px-2.5 py-2 cursor-pointer',
        'focus:bg-accent focus:text-accent-foreground',
      )}
      aria-label={`Switch display currency to ${meta.name} (${meta.code})${sourcePhrase ? ` — ${sourcePhrase}` : ''}`}
      role="menuitemradio"
      aria-checked={active}
    >
      <span className="text-base leading-none shrink-0" aria-hidden>
        {meta.flag}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold">{meta.code}</span>
          <span className="text-xs text-muted-foreground truncate">
            · {meta.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-[10px] text-muted-foreground tabular-nums truncate">
            {rateLabel}
          </p>
          {dbRate && sourcePhrase && (
            <span
              title={dbRate.updatedAt ? `Rate updated ${dbRate.updatedAt}` : undefined}
              className={cn(
                'shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium leading-tight',
                dbRate.source === 'MANUAL' &&
                  'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
                dbRate.source === 'API' &&
                  'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
                dbRate.source === 'STATIC' && 'text-muted-foreground',
              )}
            >
              {dbRate.source === 'MANUAL' ? 'admin-set' : dbRate.source === 'API' ? 'API' : 'built-in'}
            </span>
          )}
        </div>
      </div>
      {active && (
        <Check className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
      )}
    </DropdownMenuItem>
  );
}

export function CurrencySwitcher({
  compact = false,
  className,
  onChange,
}: CurrencySwitcherProps) {
  const { currency, switchCurrency, meta } = useCurrency();

  // THE LAZY OBSERVER (v2.212.0): the wire is read through the SAME query
  // cache the admin card uses (one key, one truth), but the query stays
  // DISABLED until the first open — never on mount, never on a timer
  // (refetchInterval false). After the first open the switcher is a live
  // observer: a rate the card writes or resets invalidates the shared key
  // and the chips/figures here re-render WITHOUT a remount. A failed wire
  // leaves `rates` empty and the rows render exactly as before (honest
  // absence — the footer's "indicative" sentence covers it).
  const [opened, setOpened] = useState(false);

  const ratesQuery = useQuery({
    queryKey: ADMIN_CURRENCY_RATES_QUERY_KEY,
    queryFn: async (): Promise<RatesWireBody> => {
      const res = await authedFetch('/api/currency/rates');
      if (!res.ok) throw new Error(`The rates wire answered ${res.status}`);
      return (await res.json()) as RatesWireBody;
    },
    enabled: opened,
    staleTime: 30_000,
    refetchInterval: false,
  });

  const rates = useMemo(() => {
    const map = new Map<string, RowRate>();
    for (const entry of ratesQuery.data?.data?.currencies ?? []) {
      if (typeof entry?.code !== 'string') continue;
      map.set(entry.code, {
        kesToRate: entry.kesToRate,
        source: entry.source,
        updatedAt: entry.updatedAt ?? null,
      });
    }
    return map.size > 0 ? map : null;
  }, [ratesQuery.data]);

  const handleOpenChange = (next: boolean) => {
    if (next) setOpened(true);
  };

  const handleSelect = (code: CurrencyCode) => {
    switchCurrency(code);
    onChange?.(code);
  };

  // THE TRIGGER'S HOVER TRUTH (v2.212.0): once the wire has answered, the
  // trigger's tooltip speaks the ACTIVE currency's own figure and source —
  // the same voice the rows use, so hover teaches what the menu will say.
  // Silence stays silence: before the wire answers the trigger claims
  // nothing (the static constant is never presented as wire truth).
  const activeRow = currency !== 'KES' ? rates?.get(currency) : undefined;
  const triggerTitle = activeRow
    ? `1 KES = ${formatCurrency(activeRow.kesToRate, currency)} · ${SOURCE_PHRASE[activeRow.source] ?? 'wire rate'}`
    : undefined;

  // THE FRESHNESS VOICE (v2.212.0): the footer speaks WHEN the wire
  // answered (the cache's own recorded read time) — honest recency, not a
  // pretend "live". Before the first answer the footer stays exactly the
  // three sentences it has always had.
  const readAt = rates && ratesQuery.dataUpdatedAt > 0 ? new Date(ratesQuery.dataUpdatedAt) : null;
  const freshnessLabel = readAt
    ? `Wire read at ${readAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
    : null;
  const freshnessTitle = readAt ? readAt.toLocaleString() : undefined;

  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={compact ? 'sm' : 'default'}
          className={cn(
            'gap-1.5 font-semibold tabular-nums',
            'h-9 px-2.5',
            className,
          )}
          aria-label={`Display currency: ${meta.name}. Click to change.`}
          aria-haspopup="menu"
          title={triggerTitle}
        >
          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="text-base leading-none" aria-hidden>
            {meta.flag}
          </span>
          <span className="text-xs">{currency}</span>
          {!compact && (
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64"
        // Constrain height + custom scrollbar so it never overflows the
        // viewport on small screens.
        // (4 currencies fit without scroll, but the style is forward-looking.)
      >
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Display Currency
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div
          className="max-h-80 overflow-y-auto scrollbar-thin"
          role="group"
          aria-label="Supported currencies"
        >
          {SUPPORTED_CURRENCIES.map((c) => (
            <CurrencyRow
              key={c.code}
              meta={c}
              active={c.code === currency}
              onSelect={handleSelect}
              dbRate={rates?.get(c.code)}
            />
          ))}
        </div>
        <DropdownMenuSeparator />
        <div className="px-2.5 py-1.5 text-[10px] text-muted-foreground leading-tight">
          Rates are indicative (display only).
          <br />
          Accounting currency remains KES.
          <br />
          Each chip names its source: admin-set, API, or built-in.
          {freshnessLabel && (
            <>
              <br />
              <span
                title={freshnessTitle}
                className="tabular-nums"
              >
                {freshnessLabel}
              </span>
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default CurrencySwitcher;
