'use client';

// Tiny client island for the SSR payslips page (v2.28.0).
//
// The list is now server-rendered, but the offline contract from the
// original client implementation is kept: the freshly served list is
// mirrored into localStorage under the SAME cache key the old client page
// used (mbt_self_payslips_cache_v1), so the offline story in
// docs/hr/self-service.md ("Offline view of cached payslips") still sees
// data from the last successful load.

import { useEffect } from 'react';

export const PAYSLIPS_LIST_CACHE_KEY = 'mbt_self_payslips_cache_v1';

export function PayslipsCacheWriter({ data }: { data: unknown }) {
  useEffect(() => {
    try {
      localStorage.setItem(PAYSLIPS_LIST_CACHE_KEY, JSON.stringify(data));
    } catch {
      /* storage full / private mode - the server render is the source of truth */
    }
  }, [data]);

  return null;
}
