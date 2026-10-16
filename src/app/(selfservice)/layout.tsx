// (selfservice) layout - the SLIM shell for /employees/me (v2.24.0).
//
// Mounted instead of the POS <Providers> for the whole /employees/me tree:
// no React Query, no auth/app stores, no alert popups, no toaster. The
// portal pages use plain fetch + local state + localStorage caching, so the
// only provider they need is the theme (dark mode) + a crash boundary.
// Cuts the POS runtime (~2.3 s main-thread on the Lighthouse mobile CPU)
// out of the self-service boot entirely - the documented remediation for
// the Lighthouse 81 -> 90 gap in docs/hr/self-service.md.

import type { ReactNode } from 'react';
import { SelfServiceProviders } from '@/lib/providers-selfservice';

export default function SelfServiceLayout({ children }: { children: ReactNode }) {
  return <SelfServiceProviders>{children}</SelfServiceProviders>;
}
