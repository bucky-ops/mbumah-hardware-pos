// v2.208.0 — the system health tab finds its door.
//
//   - the Phase-8 System Health surface (1,266 lines: quick stats, circuit
//     breakers, DLQ, compliance rings, audit & retention) was COMPLETE but
//     orphaned — no AppTab id, no loader, no TAB_CONFIG row, no sidebar
//     group, no case in the shell switch. This round routes it.
//   - the doors it opens: ADMIN_ROLES (SUPER_ADMIN + STORE_OWNER), the same
//     trio the /api/health/system-status wire serves with full detail (the
//     server still re-validates per request and serves a summarised view to
//     everyone else; retention + audit sections name their own SUPER_ADMIN
//     requirement in the surface).
//   - the silent pictures speak: the database response-time bar and both
//     ISO score bars gained honest aria voices composed from the wire they
//     already hold (the response-time voice names the wire's OWN 1,000ms
//     caution line — the 2,000ms scale is a paint choice, not a verdict).
//   - the -500 blind spot is re-voiced with the measured pairs: emerald-500
//     (2.54) and amber-500 (2.15) died for their -600 elders on the white
//     card ground; blue-500 (3.68), red-500 (3.76) and slate-500 (4.76)
//     already clear the 3:1 graphics bar and stay.
//   - the dead weight died: the hand-rolled Loader2 SVG (a lucide shadow)
//     and the never-opens controlled ConfirmDialog (confirmAction was only
//     ever set to null) are gone.
//
// Every pin reads the SOURCE OF RECORD (source bytes, not memory) — the
// house rule since the verify scripts were born.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { TAB_CONFIG, NAV_GROUPS, ADMIN_ROLES } from '@/lib/app-config';
import { TAB_LOADERS } from '@/lib/tab-preload';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const TAB_PATH = 'src/app/(shell)/tabs/system-health-tab.tsx';
const tabSrc = read(TAB_PATH);
const loadersSrc = read('src/lib/tab-preload.ts');
const storesSrc = read('src/lib/stores.ts');
const mainAppSrc = read('src/components/app/main-app.tsx');

describe('v2.208.0 — the route exists end to end', () => {
  it('AppTab gains system-health: the union carries it', () => {
    expect(storesSrc.includes("'system-health'")).toBe(true);
    // The AppTab union and TAB_LOADERS must agree — the Record<AppTab, …>
    // type makes a missing key a compile error, but the source pin holds.
    expect(TAB_LOADERS['system-health']).toBeDefined();
  });

  it('the loader points at the real tab file', () => {
    expect(
      loadersSrc.includes("'system-health': () => import('../app/(shell)/tabs/system-health-tab')"),
    ).toBe(true);
  });

  it('TAB_CONFIG carries the door with ADMIN_ROLES and a real icon', () => {
    const cfg = TAB_CONFIG.find((t) => t.id === 'system-health');
    expect(cfg).toBeDefined();
    expect(cfg?.label).toBe('System Health');
    expect(cfg?.icon).toBeDefined(); // HeartPulse — never undefined
    expect(cfg?.roles).toEqual(ADMIN_ROLES);
  });

  it('the sidebar group puts it under Compliance & System', () => {
    const group = NAV_GROUPS.find((g) => g.ids.includes('system-health'));
    expect(group?.label).toBe('Compliance & System');
  });

  it('the shell switch renders it behind SectionErrorBoundary + Suspense', () => {
    expect(
      mainAppSrc.includes(
        `case 'system-health': return <SectionErrorBoundary sectionName="System Health"><Suspense fallback={<TabLoadingFallback />}><LazySystemHealthTab /></Suspense></SectionErrorBoundary>;`,
      ),
    ).toBe(true);
    expect(mainAppSrc.includes("const LazySystemHealthTab = lazy(TAB_LOADERS['system-health']);")).toBe(true);
  });

  it('no duplicate ids or labels were introduced', () => {
    const ids = TAB_CONFIG.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const labels = TAB_CONFIG.map((t) => t.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('the server wire the tab reads is guarded (requireAuth, not memory)', () => {
    const route = read('src/app/api/health/system-status/route.ts');
    expect(route.includes('requireAuth')).toBe(true);
    expect(route.includes("'SUPER_ADMIN', 'STORE_OWNER'")).toBe(true);
  });
});

describe('v2.208.0 — the silent pictures speak', () => {
  it('the database response-time bar names the wire\u2019s own caution line', () => {
    expect(tabSrc.includes('aria-label={')).toBe(true);
    expect(tabSrc.includes('Database response time ${status.database.responseTime}ms')).toBe(true);
    expect(tabSrc.includes('within the 1,000ms caution line.')).toBe(true);
    expect(tabSrc.includes('past the 1,000ms caution line.')).toBe(true);
    // The verdict follows the WIRE's warning branch (> 1000ms), stated —
    // the 2,000ms bar scale is a paint choice and never called a threshold.
    expect(tabSrc.includes('status.database.responseTime > 1000')).toBe(true);
  });

  it('both ISO score bars speak the score and a verdict derived from the score itself', () => {
    expect(tabSrc.includes('ISO 27001 score ${status.compliance.iso27001Score} of 100')).toBe(true);
    expect(tabSrc.includes('ISO 9001 score ${status.compliance.iso9001Score} of 100')).toBe(true);
    // The verdict derives from the SCORE, never from the system's overall
    // status (a different wire).
    const verdictFn = tabSrc.match(/const isoVerdict = [^\n]+/)?.[0] ?? '';
    expect(verdictFn).toContain('score >= 90');
    expect(verdictFn).toContain('score >= 70');
    expect(verdictFn).not.toContain('overallStatus');
  });

  it('the refresh cadence is stated on the surface, not just in code', () => {
    expect(tabSrc.includes('auto-refreshes every 30s')).toBe(true);
    expect(tabSrc.includes('refetchInterval: 30000')).toBe(true);
  });

  it('the compliance ring keeps its v2.207 voice', () => {
    expect(tabSrc.includes('composeScoreVoice(')).toBe(true);
    expect(tabSrc.includes("'Overall compliance score'")).toBe(true);
  });
});

describe('v2.208.0 — the measured pairs hold (graphics 3:1)', () => {
  it('the -500 marks that failed the bar are gone (light-ground classes)', () => {
    // emerald-500 2.54 / amber-500 2.15 / teal-500 2.52 / purple-500 ~3.0
    // on white: all below or at the 3:1 graphics bar — dead for their -600
    // elders. dark: variants are a different ground and keep their family.
    const lightGroundBans = [
      'text-emerald-500"',
      "text-emerald-500`",
      'text-amber-500"',
      "text-amber-500`",
      'text-teal-500"',
      'text-purple-500"',
    ];
    for (const ban of lightGroundBans) {
      expect(tabSrc.includes(ban), `found banned mark ${ban}`).toBe(false);
    }
  });

  it('the quick-stat icons ride emerald-600 / amber-600 (red-500 3.76 stays)', () => {
    expect(tabSrc.includes("'text-emerald-600' :")).toBe(true);
    expect(tabSrc.includes("'text-amber-600' :")).toBe(true);
    expect(tabSrc.includes("'text-red-500'")).toBe(true);
  });

  it('the DLQ stat-card icon map carries the measured pairs', () => {
    expect(tabSrc.includes("amber: 'text-amber-600',")).toBe(true);
    expect(tabSrc.includes("blue: 'text-blue-600',")).toBe(true);
    expect(tabSrc.includes("emerald: 'text-emerald-600',")).toBe(true);
    expect(tabSrc.includes("red: 'text-red-500',")).toBe(true);
    expect(tabSrc.includes("slate: 'text-slate-500',")).toBe(true);
  });

  it('the circuits summary captions match the badge family dark:text-*-400', () => {
    expect(tabSrc.includes('dark:text-emerald-500')).toBe(false);
    expect(tabSrc.includes('dark:text-amber-500')).toBe(false);
    expect(tabSrc.includes('dark:text-emerald-400')).toBe(true);
    expect(tabSrc.includes('dark:text-amber-400')).toBe(true);
  });

  it('the v2.207 measured dots stay (PulseIndicator -600 pairs)', () => {
    expect(tabSrc.includes("'bg-emerald-600 shadow-emerald-600/50'")).toBe(true);
    expect(tabSrc.includes("'bg-amber-600 shadow-amber-600/50'")).toBe(true);
  });
});

describe('v2.208.0 — the dead weight died', () => {
  it('no hand-rolled Loader2 SVG — lucide owns the mark', () => {
    expect(tabSrc.includes('function Loader2(')).toBe(false);
    expect(tabSrc.includes('Loader2,')).toBe(true); // imported from lucide-react
    expect(/import\s*\{[^}]*Loader2[^}]*\}\s*from\s*'lucide-react'/s.test(tabSrc)).toBe(true);
  });

  it('the never-opens controlled ConfirmDialog is gone (state + block)', () => {
    expect(tabSrc.includes('confirmAction')).toBe(false);
    expect(tabSrc.includes('breaker-reset-all')).toBe(false);
    // The REAL confirm wrappers (per-action, with children) stay.
    expect(tabSrc.includes('<ConfirmDialog')).toBe(true);
  });

  it('the mutation callbacks keep their toast + invalidation behaviour', () => {
    expect(tabSrc.includes("queryClient.invalidateQueries({ queryKey: ['dlq-items'] })")).toBe(true);
    expect(tabSrc.includes("queryClient.invalidateQueries({ queryKey: ['system-status'] })")).toBe(true);
  });
});

describe('v2.208.0 — the surface keeps its honest structure', () => {
  it('all five sub-tabs remain wired', () => {
    for (const value of ['overview', 'circuits', 'dlq', 'compliance', 'audit']) {
      expect(tabSrc.includes(`<TabsContent value="${value}"`), `tab ${value}`).toBe(true);
    }
  });

  it('the admin actions still pass through confirm dialogs (danger is deliberate)', () => {
    for (const action of ["action: 'resetAll'", "action: 'forceOpen'", "action: 'forceClose'", "action: 'retryAll'", "action: 'purge'"]) {
      expect(tabSrc.includes(action), `action ${action}`).toBe(true);
    }
  });

  it('the tab reads the three live wires it always carried', () => {
    expect(tabSrc.includes("fetch('/api/health/system-status')")).toBe(true);
    expect(tabSrc.includes('fetch(`/api/health/dlq?${params}`)')).toBe(true);
    expect(tabSrc.includes("fetch('/api/health/circuit-breaker'")).toBe(true);
  });
});
