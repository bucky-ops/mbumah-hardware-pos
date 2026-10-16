'use client';

// Tiny client island for the SSR self-service home (v2.24.0).
//
// The home page is now a server component (instant LCP), but the offline
// contract from the original client implementation is kept: the freshly
// served payload is mirrored into localStorage under the SAME cache key the
// old client page used (mbt_self_dashboard_cache_v1), so anything that
// replays the cached dashboard (and the offline story in
// docs/hr/self-service.md) still sees data from the last successful load.

import { useEffect } from 'react';

export const SELF_DASHBOARD_CACHE_KEY = 'mbt_self_dashboard_cache_v1';

export function SelfDashboardCacheWriter({ data }: { data: unknown }) {
  useEffect(() => {
    try {
      localStorage.setItem(
        SELF_DASHBOARD_CACHE_KEY,
        JSON.stringify({ at: Date.now(), data }),
      );
    } catch {
      /* storage full / private mode - the server render is the source of truth */
    }
  }, [data]);

  return null;
}
