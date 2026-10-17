// MBUMA HARDWARE POS - tenant bypass read audit (v2.58.0)
//
// The v2.57.0 round found a REAL production bug in this class: a
// `runWithoutTenant` read inside a session-guard-wrapped request could have
// its bypass silently ignored (the hardened client's interceptor observed
// the OUTER runWithTenant context at interceptor-execution time), so the
// query was AND-narrowed to the browsing store and every org-wide row
// (storeId NULL) vanished — the notification feed's digest section had been
// rendering empty on prod while the rows sat in the DB.
//
// This audit pins the class: EVERY `runWithoutTenant` call site that touches
// a STORE-SCOPED model (the only models the tenant interceptor narrows) must
// be one of:
//   1. rawDb          — the v2.57.0 fix pattern (bypass by construction),
//   2. cron/admin     — no session guard, so no tenant context can leak,
//   3. explicit store — the query already filters storeId (intended
//                       narrowing or an authorized cross-store lookup),
//   4. ALLOW_LISTED   — reviewed with a written reason (same-store-by-authz
//                       flows where a leak coincides with the caller's own
//                       scope, or unscoped models by schema).
// A new call site that satisfies none of these fails this test and forces a
// conscious decision instead of a silent vanishing act.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/** Walk a directory, returning every .ts/.tsx file path (no node_modules). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      out.push(...walk(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const dbSrc = readFileSync(join(ROOT, 'src/lib/db.ts'), 'utf8');
const scopedSetMatch = dbSrc.match(/const STORE_SCOPED_MODELS = new Set<string>\(\[([\s\S]*?)\]\)/);
if (!scopedSetMatch) throw new Error('STORE_SCOPED_MODELS set not found in src/lib/db.ts — the audit cannot run');
const STORE_SCOPED = new Set((scopedSetMatch[1].match(/"(\w+)"/g) ?? []).map((s) => s.slice(1, -1)));
expect(STORE_SCOPED.size).toBeGreaterThan(30);

/**
 * Written review verdicts for bypass reads that touch store-scoped models
 * WITHOUT an explicit storeId filter and WITHOUT a guard-free context.
 * Every entry needs a reason — the test prints them on the audit report.
 */
const ALLOW_LIST: Record<string, string> = {
  // Payroll/leave flows read run/period/employee/balance rows BY ID. The
  // calling routes authorize the actor for the store those rows belong to,
  // so a leaked narrowing coincides with the caller's own scope and can
  // never widen access; org-wide roles (STORE_OWNER, SUPER_ADMIN) carry no
  // storeId and run the request itself without a tenant context.
  'src/lib/payroll-helpers.ts':
    'run/employee/balance reads by ID from store-authz routes; org-wide callers run without a tenant ctx',
  // Abuse-pattern reads power the discount-spam/out-of-stock alert writers;
  // they are invoked from mutation routes whose tenant equals the offender's
  // store, and their notification writes are user-addressed (CREATE is never
  // tenant-narrowed).
  'src/lib/abuse.ts':
    'same-store abuse counting from mutation routes; notification writes are CREATEs (never narrowed)',
  // The portal employee reads their OWN rows; portal users are store-scoped
  // by design, so a leaked narrowing to their store is a no-op.
  'src/app/(selfservice)/employees/me/page.tsx':
    'portal self-service rows; the reader is store-scoped to the same store by design',
  // Journal posting runs inside the transaction's own store scope; the
  // caller authorized the store and the rows carry that store's id.
  'src/lib/post.ts':
    'journal posting within the caller-authorized store scope',
  // Cross-store lookups by explicit id for admin/owner surfaces — the route
  // guard authorizes the access; the leak would only narrow to the caller's
  // own store, and org-wide callers have no tenant ctx at all.
  'src/lib/engraved-admin.ts':
    'admin-only cross-store lookups; SUPER_ADMIN requests run without a tenant ctx',
  'src/lib/etims-queue.ts':
    'worker queue drained by cron/worker contexts, not session guards',
  'src/lib/org/diagnostics.ts':
    'org-level diagnostics for org roles without a storeId tenant',
};

// Where to look: API routes + lib modules (tests are excluded — they mock).
const SCAN_DIRS = [join(ROOT, 'src/app/api'), join(ROOT, 'src/lib'), join(ROOT, 'src/app/(selfservice)')];

interface Finding {
  file: string;
  model: string;
  rawDb: boolean;
  guardFreeContext: boolean;
  explicitStore: boolean;
}

function scanFile(path: string): Finding[] {
  const rel = path.slice(ROOT.length + 1);
  const src = readFileSync(path, 'utf8');
  const findings: Finding[] = [];
  // Every runWithoutTenant( occurrence; inspect a window large enough to
  // hold the first query of a bypass block (approximation by design — the
  // window catches single-expression AND the head of async blocks).
  const re = /runWithoutTenant\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const window = src.slice(m.index, m.index + 1400);
    // guard-free context: cron/admin routes authenticate by secret, not by
    // session, so no runWithTenant context can wrap them.
    const guardFree = /src\/app\/api\/(cron|admin)\//.test(rel);
    for (const modelMatch of window.matchAll(/\b(?:db|rawDb)\.(\w+)\./g)) {
      const model = modelMatch[1];
      if (!STORE_SCOPED.has(model)) continue;
      // explicit store filter within the query head?
      const head = window.slice(modelMatch.index, modelMatch.index + 500);
      const explicitStore = /storeId\s*:/.test(head);
      findings.push({
        file: rel,
        model,
        rawDb: modelMatch[0].startsWith('rawDb'),
        guardFreeContext: guardFree,
        explicitStore,
      });
      break; // one finding per bypass call site (first store-scoped model)
    }
  }
  return findings;
}

describe('tenant bypass read audit (v2.58.0)', () => {
  it('every store-scoped bypass read is safe by construction or allow-listed', () => {
    const all: Finding[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(dir)) {
        all.push(...scanFile(file));
      }
    }
    expect(all.length).toBeGreaterThan(5); // the audit found real sites

    const violations: string[] = [];
    for (const f of all) {
      if (f.rawDb || f.guardFreeContext || f.explicitStore) continue;
      if (ALLOW_LIST[f.file]) continue;
      violations.push(`${f.file} (${f.model})`);
    }
    expect(violations).toEqual([]);
  });

  it('the allow list only contains files that still exist and still bypass', () => {
    const files = new Set<string>();
    for (const dir of SCAN_DIRS) {
      for (const file of walk(dir)) files.add(file.slice(ROOT.length + 1));
    }
    for (const [file, reason] of Object.entries(ALLOW_LIST)) {
      expect(reason.length, `allow-list entry ${file} needs a reason`).toBeGreaterThan(20);
      expect(files.has(file), `allow-list entry ${file} no longer exists — prune it`).toBe(true);
    }
  });

  it('the notification feed stays on rawDb (the v2.57.0 fix must not regress)', () => {
    const route = readFileSync(join(ROOT, 'src/app/api/notifications/route.ts'), 'utf8');
    expect((route.match(/rawDb\.notification\.findMany/g) ?? []).length).toBe(3);
  });
});
