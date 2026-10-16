// (shell) layout - the FULL app shell (v2.24.0 route-group split).
//
// v2.24.0 PERF SPLIT: <Providers> (React Query, theme, toast, alert popups,
// auth-store global error handlers) used to live in the ROOT layout, so even
// the lightweight self-service portal (/employees/me) booted the entire POS
// runtime - measured at ~2.3 s of main-thread work on the Lighthouse mobile
// CPU (docs/hr/self-service.md blocker). The root layout now renders only
// html/body/fonts; EVERYTHING that needs the POS shell lives in this route
// group and mounts <Providers> here, while (selfservice) mounts the slim
// SelfServiceProviders instead.
//
// Route groups are filesystem-only: URLs are unchanged ((shell)/page.tsx is
// still "/", (shell)/hr/... is still "/hr/...", etc.).

import type { ReactNode } from 'react';
import { Providers } from '@/lib/providers';

export default function ShellLayout({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
