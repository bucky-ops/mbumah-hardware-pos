'use client';

// MBUMAH HARDWARE POS - CurrencySwitcher
//
// A dropdown button that lets the cashier switch the POS display currency
// between KES, USD, UGX, and TZS for cross-border East African trade.
//
// • Trigger button shows the active currency's flag + code.
// • Each menu item shows flag, code, name, and the KES exchange rate.
// • Since v2.210.0 the rows carry their rate's HONEST SOURCE: the first
//   open fetches /api/currency/rates (the wire the CurrencyRate model
//   backs) and overlays any admin-managed (MANUAL) or API-fetched (API)
//   rows on the static list; each row names its source with a measured
//   chip (emerald admin-set / blue API / muted built-in). If the wire is
//   unreachable the rows render exactly as before — no chip, no invented
//   provenance — and the footer's "indicative" sentence stays the truth.
// • Selecting an item calls `switchCurrency()` from `useCurrency()`, which
//   updates the persisted `activeCurrency` in `useAppStore` - every
//   component that calls `useCurrency().format()` re-renders automatically.
//
// This is a DISPLAY-ONLY conversion. The canonical accounting currency
// remains KES; only the rendered strings change.

import { useRef, useState } from 'react';
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

/** What one /api/currency/rates entry teaches this component. */
interface RateWireEntry {
  code: string;
  /** How many units of this currency one KES equals (already rounded). */
  kesToRate: number;
  /** STATIC | MANUAL | API — the wire's own provenance. */
  source: string;
  updatedAt: string | null;
}

/** Per-row provenance + the DB-backed KES rate, when the wire answered. */
interface RowRate {
  /** 1 KES equals this many units of the row's currency. */
  kesToRate: number;
  source: string;
  updatedAt: string | null;
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

  // The rates wire is fetched lazily on the FIRST open — never on mount,
  // never on a timer. One attempt per session of the dropdown: a failed
  // wire leaves `rates` null and the rows render exactly as before
  // (honest absence — the footer's "indicative" sentence covers it).
  const [rates, setRates] = useState<Map<string, RowRate> | null>(null);
  const attemptedRef = useRef(false);

  const handleOpenChange = (next: boolean) => {
    if (next && !attemptedRef.current) {
      attemptedRef.current = true;
      fetch('/api/currency/rates')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((body: { data?: { currencies?: RateWireEntry[] } }) => {
          const map = new Map<string, RowRate>();
          for (const entry of body?.data?.currencies ?? []) {
            if (typeof entry?.code !== 'string') continue;
            map.set(entry.code, {
              kesToRate: entry.kesToRate,
              source: entry.source,
              updatedAt: entry.updatedAt ?? null,
            });
          }
          if (map.size > 0) setRates(map);
        })
        .catch(() => {
          // Silence is the honest state: no chip can claim provenance the
          // wire did not name. The static rows stand alone.
        });
    }
  };

  const handleSelect = (code: CurrencyCode) => {
    switchCurrency(code);
    onChange?.(code);
  };

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
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default CurrencySwitcher;
