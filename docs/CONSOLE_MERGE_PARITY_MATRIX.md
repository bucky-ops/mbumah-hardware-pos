# Console Merge Parity Matrix

Status: current as of v2.109.0.

The Organization Console and the Expert Console are the same logical
console. v2.109.0 renders BOTH routes through one shared shell
(`src/components/console/unified-console.tsx`) and shares the
"People & payroll by branch" panel between them. Both routes are
backward-compatible and unchanged: `/console` and `/org/dashboard`.

Shared (single implementation, cannot drift):

| Capability | Lives in | Notes |
| --- | --- | --- |
| Shell, landmarks, skip link, mode attribute | `src/components/console/unified-console.tsx` | `data-console-mode` + `unified-console-{mode}` testid |
| Home action (back to POS) | `goHomeToPos` in the same file; rendered by the expert header | internal navigation only, no open redirect |
| People & payroll by branch panel | `src/components/finance/people-payroll-by-branch.tsx` | table (desktop) + cards (mobile), reason codes |
| Per-branch/org data | `/api/org/summary` | ORG_ROLES guard, server-side tenant scoping |
| Expert-diagnostics reason codes and copy | `src/components/workspace/org-console.tsx` | single source, rendered in the org mode's dialog |

Mode-specific (preserved where they are; nothing removed):

| Former Organization Console feature (`/org/dashboard`) | Disposition | Verification |
| --- | --- | --- |
| Combined org metric tiles (6 StatCards) | kept, organization mode section | E2E anchor this round |
| HR summary tiles + per-branch links | kept | E2E anchor this round |
| Branch matrix with per-branch status + alerts | kept | E2E anchor this round |
| Expert diagnostics dialog + copy diagnostics + refresh | kept (Radix focus/Escape) | E2E anchor this round |
| Global Chat link in header | kept | E2E anchor this round |
| ACCOUNTANT financial read-only mode | kept | unit/source test |
| LoginScreen for guests | kept | source test |

| Former Expert Console feature (`/console`) | Disposition | Verification |
| --- | --- | --- |
| Dark chrome header (logo, version badge, health gauge, store selector, cmd+K, notifications, chat, user chip, date, shortcuts, offline badge) | kept, now rendered via the shared shell with `showHome` | E2E anchor this round |
| Home button (Home icon, "Back to POS") | NEW, expert mode only | E2E + unit/source test |
| KPI row ("Today at a glance") | kept | E2E anchor this round |
| Store Intelligence Matrix | kept | E2E anchor this round |
| People & payroll by branch | kept, now the SHARED component + precise unavailable reason when the block is absent | E2E + unit test |
| Domain Expert Modules | kept | E2E anchor this round |
| Decision Support, Desk activity, Timeline, Live Feed | kept | E2E anchor this round |
| Command palette, chat drawer, shortcuts, changelog, login | kept | source test |
| "Where is the POS?" hint item | kept (the Home button complements it) | source test |

Deliberately NOT done (and why): the two headers' visual designs were not
flattened into one. The expert console keeps its dark brand chrome and the
organization console its light compact header; merging the pixels would
regress both surfaces' identity without adding a capability. The unification
is structural (one shell, one Home helper, one panel, one data endpoint)
rather than cosmetic.
