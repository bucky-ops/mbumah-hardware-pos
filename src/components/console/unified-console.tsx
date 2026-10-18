'use client';

// v2.109.0: the UNIFIED console shell — one shared implementation for the
// two faces of the same logical console.
//
//   mode="organization" -> /org/dashboard (the compact per-store summary)
//   mode="expert"       -> /console      (the full expert system: KPI row,
//                          Store Intelligence Matrix, People & payroll by
//                          branch, 9 expert modules, Decision Support, desk
//                          activity, timeline, live feed)
//
// What the shell unifies (and therefore can never drift apart again):
//   - the mode contract (a data-console-mode attribute + testid on the root),
//   - the skip-to-content landmark and the <main> landmark,
//   - the canonical HOME action: the Expert Console's Home button returns to
//     the POS workspace (the root SPA with the POS tab active) through ONE
//     navigation helper — an internal route only, never an open redirect.
//
// What it deliberately does NOT do: flatten the two headers' visual designs
// (the expert console keeps its dark chrome header, the organization console
// its light header) and it does not move either console's sections. Every
// existing capability stays exactly where it is (see
// docs/CONSOLE_MERGE_PARITY_MATRIX.md); the routes /console and
// /org/dashboard are backward-compatible and unchanged.

import type { ReactNode } from 'react';
import { useAppStore } from '@/lib/stores';

export type UnifiedConsoleMode = 'organization' | 'expert';

/**
 * The canonical POS destination, from ONE helper: the root-domain SPA with
 * the POS tab active. The tab choice rides the same zustand store the SPA
 * itself uses (persisted), and the navigation is a plain internal path —
 * never a query-supplied URL, so the Home action cannot become an open
 * redirect.
 */
export function goHomeToPos(): void {
  try {
    useAppStore.getState().setActiveTab('pos');
  } catch {
    // store not hydrated (or private mode): navigation still proceeds and
    // the SPA lands on its default tab rather than a wrong one
  }
  if (typeof window !== 'undefined') window.location.assign('/');
}

export function UnifiedConsoleShell({
  mode,
  header,
  footer,
  children,
  bodyClassName,
  mainClassName,
}: {
  mode: UnifiedConsoleMode;
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  /** Classes for the outermost wrapper (background, min-height). */
  bodyClassName?: string;
  /** Classes for the <main> landmark (the console's own width/padding). */
  mainClassName?: string;
}) {
  return (
    <div
      data-testid={`unified-console-${mode}`}
      data-console-mode={mode}
      className={`flex min-h-screen flex-col ${bodyClassName ?? ''}`}
    >
      <a
        href="#unified-console-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-orange-600 focus:px-3 focus:py-2 focus:text-xs focus:font-semibold focus:text-white"
      >
        Skip to console content
      </a>
      {header}
      <main id="unified-console-main" className={`flex-1 ${mainClassName ?? ''}`}>
        {children}
      </main>
      {footer}
    </div>
  );
}
