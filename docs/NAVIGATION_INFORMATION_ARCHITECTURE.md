# Navigation Information Architecture

Status: current as of v2.109.0.

## Sources of truth

1. Main SPA tabs: `src/lib/app-config.ts` (`TAB_CONFIG` gives every tab a
   stable id, label, REQUIRED Lucide icon, role list; `NAV_GROUPS` gives the
   group order). `src/lib/stores.ts` owns the `AppTab` union;
   `src/lib/tab-preload.ts` owns the chunk loaders;
   `src/components/app/main-app.tsx` owns the render switch. Adding a tab
   means touching all five registries — TypeScript enforces the union.
2. Sidebar: `src/components/layout/app-sidebar.tsx` renders
   `NAV_GROUPS x TAB_CONFIG` (locked tabs render grayed-out with a lock and
   a "requires <role>" tooltip) plus the workspace links block.
3. Console routes: `/console` (Expert Console) and `/org/dashboard`
   (Organization Console) render through the shared
   `src/components/console/unified-console.tsx` shell.

## Visible sidebar order (top to bottom)

1. Notifications, store selector (workspace-aware).
2. Navigation groups, in order: Main, Sales & Credit, Finance & Insights,
   Operations, Compliance & System. The last group ends with Security and
   Admin.
3. Workspace links, in this exact order (v2.109.0: they follow the Admin
   module):
   1. Branch Selector (`/branches/select`, Building2 icon)
   2. Organization Console (`/org/dashboard`, Network icon)
   3. Expert Console (`/console`, Gauge icon)
   4. Global Chat (`/chat`, MessagesSquare icon)
4. User profile footer.

Collapsed mode mirrors the same order in the icon rail.

## Finance & Insights group

`financial`, `analytics`, `banking`, `payroll`, `people-payroll` (v2.109.0),
`transfers`. The People & Payroll tab renders the shared
"People & payroll by branch (N)" panel
(`src/components/finance/people-payroll-by-branch.tsx`) reading
`/api/org/summary` — the same endpoint and component the Expert Console
uses. The server fail-closes: the route 403s non-org roles, and the
hrPerStore block is omitted unless the HR module is on and the caller holds
an HR report permission; the tab then shows a precise reason code
(`PERMISSION_DENIED`, `HR_DATA_SOURCE_UNAVAILABLE`, `API_ERROR_SAFE`)
instead of blank or guessed numbers.

## Home action

The Expert Console header carries a Home button (Home icon, label "Home",
accessible name "Back to POS") rendered only in expert mode. It navigates
through one shared helper (`goHomeToPos` in
`src/components/console/unified-console.tsx`) to the canonical POS
destination: the root SPA with the POS tab active. The navigation is an
internal path; no query, header, or host value is trusted, so the action
cannot become an open redirect.

## Roles

Tab visibility follows `TAB_CONFIG.roles`; locked tabs stay visible with an
explanatory lock tooltip (v2.12.5 contract). Data visibility is always
server-enforced independently of the sidebar.
