'use client';

// MBUMAH HARDWARE POS - useVatRate hook (v2.8.0)
//
// Single source of truth for the ADMIN-CONTROLLED VAT rate on the client.
//
//   const { vatRate, isLoading } = useVatRate();
//   <span>VAT ({vatRate}%)</span>
//
// • Reads GET /api/settings/vat (any authenticated user) via react-query and
//   mirrors the value into localStorage (see src/lib/vat-rate-cache.ts) so
//   OFFLINE receipt math keeps using the last known admin rate instead of a
//   hardcoded 16%.
// • `vatRate` falls back to the cached rate (default 16) while loading so
//   first paint never shows a wrong label.

import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '@/lib/api';
import { getCachedVatRate, setCachedVatRate } from '@/lib/vat-rate-cache';

export const VAT_RATE_QUERY_KEY = ['vat-rate'] as const;

export { getCachedVatRate, setCachedVatRate };

export function useVatRate() {
  const query = useQuery({
    queryKey: VAT_RATE_QUERY_KEY,
    queryFn: async () => {
      const data = await settingsApi.getVatRate();
      if (!data) throw new Error('Could not load VAT settings');
      setCachedVatRate(data.vatRatePercent);
      return data;
    },
    staleTime: 60_000,
    retry: 1,
  });

  return {
    vatRate: query.data?.vatRatePercent ?? getCachedVatRate(),
    isDefault: query.data?.isDefault ?? true,
    isLoading: query.isLoading,
  };
}
