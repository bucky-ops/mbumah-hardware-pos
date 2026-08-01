'use client';

// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — useCurrency hook
// ─────────────────────────────────────────────────────────────────────────────
//
// Single entry point for currency-aware display formatting throughout the POS.
// Subscribes to the `activeCurrency` field of `useAppStore`, so any component
// using this hook automatically re-renders when the cashier switches currency
// via the CurrencySwitcher dropdown.
//
// USAGE
// ─────
//   const { currency, format, convert, switchCurrency } = useCurrency();
//
//   <span>{format(1234.5)}</span>            // "Ksh 1,234.50" or "$ 8.13"
//   <span>{convert(100, 'USD')}</span>       // 100 USD → active currency
//   <button onClick={() => switchCurrency('UGX')}>Switch to UGX</button>
//
// IMPORTANT
// ─────────
// • All amounts are DISPLAY-ONLY conversions using static exchange rates.
//   Financial ledger postings / tax computation must use the `Money` class
//   with KES as the canonical accounting currency.
// • When `activeCurrency === 'KES'` (the default), `format()` is a pure
//   formatter (no conversion), so existing KES amounts render unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useMemo } from 'react';
import { useAppStore } from '@/lib/stores';
import {
  formatCurrency,
  convertCurrency,
  CURRENCY_BY_CODE,
  type CurrencyCode,
} from '@/lib/currency-utils';

export interface UseCurrencyReturn {
  /** The active display currency code (KES | USD | UGX | TZS). */
  currency: CurrencyCode;
  /**
   * Format an amount in the active currency. If the amount is given in KES
   * (the canonical accounting currency), it is first converted to the active
   * currency using the static exchange rate, then formatted.
   *
   * For non-KES `fromCurrency`, use `convert()` first then `formatCurrency()`.
   */
  format: (amount: number | string | null | undefined, fromCurrency?: CurrencyCode) => string;
  /**
   * Convert an amount from `fromCurrency` to the active display currency.
   * Returns a plain number (rounded to the active currency's decimals).
   */
  convert: (amount: number | string | null | undefined, fromCurrency: CurrencyCode) => number;
  /** Switch the active display currency. Persists to localStorage. */
  switchCurrency: (currency: CurrencyCode) => void;
  /** Metadata for the active currency (symbol, flag, decimals, …). */
  meta: typeof CURRENCY_BY_CODE[CurrencyCode];
}

export function useCurrency(): UseCurrencyReturn {
  const activeCurrency = useAppStore((s) => s.activeCurrency);
  const setActiveCurrency = useAppStore((s) => s.setActiveCurrency);

  const format = useCallback(
    (amount: number | string | null | undefined, fromCurrency: CurrencyCode = 'KES') => {
      // If from === active, no conversion needed — just format.
      if (fromCurrency === activeCurrency) {
        return formatCurrency(amount, activeCurrency);
      }
      // Otherwise convert from `fromCurrency` to `activeCurrency`, then format.
      const converted = convertCurrency(amount, fromCurrency, activeCurrency);
      return formatCurrency(converted, activeCurrency);
    },
    [activeCurrency],
  );

  const convert = useCallback(
    (amount: number | string | null | undefined, fromCurrency: CurrencyCode) => {
      return convertCurrency(amount, fromCurrency, activeCurrency);
    },
    [activeCurrency],
  );

  const switchCurrency = useCallback(
    (currency: CurrencyCode) => {
      setActiveCurrency(currency);
    },
    [setActiveCurrency],
  );

  const meta = useMemo(() => CURRENCY_BY_CODE[activeCurrency] ?? CURRENCY_BY_CODE.KES, [activeCurrency]);

  return { currency: activeCurrency, format, convert, switchCurrency, meta };
}

export default useCurrency;
