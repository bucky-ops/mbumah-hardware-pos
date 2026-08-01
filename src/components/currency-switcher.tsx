'use client';

// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — CurrencySwitcher
// ─────────────────────────────────────────────────────────────────────────────
//
// A dropdown button that lets the cashier switch the POS display currency
// between KES, USD, UGX, and TZS for cross-border East African trade.
//
// • Trigger button shows the active currency's flag + code.
// • Each menu item shows flag, code, name, and the static KES exchange rate.
// • Selecting an item calls `switchCurrency()` from `useCurrency()`, which
//   updates the persisted `activeCurrency` in `useAppStore` — every
//   component that calls `useCurrency().format()` re-renders automatically.
//
// This is a DISPLAY-ONLY conversion. The canonical accounting currency
// remains KES; only the rendered strings change.
// ─────────────────────────────────────────────────────────────────────────────

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
  /** Optional compact variant — shows only flag + code, no "Currency" label. */
  compact?: boolean;
  /** Additional Tailwind classes for the trigger button. */
  className?: string;
  /** Optional callback fired when the user picks a currency. */
  onChange?: (currency: CurrencyCode) => void;
}

/**
 * Render a single currency row in the dropdown. Extracted so the parent
 * component stays declarative and the row's aria-label is consistent.
 */
function CurrencyRow({
  meta,
  active,
  onSelect,
}: {
  meta: CurrencyMeta;
  active: boolean;
  onSelect: (code: CurrencyCode) => void;
}) {
  // Show "1 KES = N {symbol}" for non-KES currencies; for KES show "Base".
  const rateLabel =
    meta.code === 'KES'
      ? 'Base currency'
      : `1 KES = ${formatCurrency(1 / meta.exchangeRateToKES, meta.code)}`;

  return (
    <DropdownMenuItem
      // `onSelect` fires on click/Enter/Space — Radix handles a11y.
      onSelect={(e) => {
        // Prevent the dropdown from closing before our handler runs in
        // some edge cases (defensive — Radix usually handles this).
        e.preventDefault();
        onSelect(meta.code);
      }}
      className={cn(
        'flex items-center gap-2.5 px-2.5 py-2 cursor-pointer',
        'focus:bg-accent focus:text-accent-foreground',
      )}
      aria-label={`Switch display currency to ${meta.name} (${meta.code})`}
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
        <p className="text-[10px] text-muted-foreground/80 truncate">
          {rateLabel}
        </p>
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

  const handleSelect = (code: CurrencyCode) => {
    switchCurrency(code);
    onChange?.(code);
  };

  return (
    <DropdownMenu>
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
            <ChevronDown className="h-3 w-3 text-muted-foreground/70" aria-hidden />
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
            />
          ))}
        </div>
        <DropdownMenuSeparator />
        <div className="px-2.5 py-1.5 text-[10px] text-muted-foreground/70 leading-tight">
          Rates are indicative (display only).
          <br />
          Accounting currency remains KES.
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default CurrencySwitcher;
