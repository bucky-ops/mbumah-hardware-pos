// v2.209.0 — the dead-letter queue's composition speaks.
//
//   - the /api/health/dlq wire has carried `byOperationType`,
//     `byTargetService` and `oldestPendingAt` since Phase 8; the desk
//     FETCHED them (the type cast at the queryFn) and rendered NOTHING.
//     This round the DLQ tab grows an In-Flight Composition strip: a
//     proportional stacked bar by operation type (the picture), operation
//     chips with matching stops (the legend), service chips (the secondary
//     breakdown) and the oldest-waited line — all from data the wire
//     already carried.
//   - the composition counts the work IN FLIGHT (pending + retrying — the
//     wire's own groupBy scope). Completed and cancelled items are
//     history, not composition, and the badge says so. A no-composition
//     queue speaks the honest nothing.
//   - the bar's palette is the measured -600 family (blue-600 5.17,
//     purple-600 5.38, teal-600 3.74, amber-600 3.19, emerald-600 3.77,
//     cyan-600 3.68 — all clear the 3:1 graphics bar on the white card
//     ground); segments cycle past six operation types and the legend
//     carries the same stop per name.
//   - `composeDlqCompositionVoice` is the ONE writer for the aria (the
//     one-writer law): caller-ordered entries (no re-ranking invented),
//     the zero law, the NaN-poison guard, singular/plural honesty, and the
//     oldest age named only when the caller carries one.
//
// Every pin reads the SOURCE OF RECORD (source bytes, not memory) — the
// house rule since the verify scripts were born.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { composeDlqCompositionVoice } from '@/lib/report-voices';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const TAB_PATH = 'src/app/(shell)/tabs/system-health-tab.tsx';
const tabSrc = read(TAB_PATH);

describe('v2.209.0 — composeDlqCompositionVoice (the one-writer law)', () => {
  it('an empty in-flight queue speaks the honest nothing', () => {
    expect(composeDlqCompositionVoice({}, {}, null)).toBe(
      'The in-flight queue is empty — nothing is waiting or retrying.',
    );
    expect(composeDlqCompositionVoice(null, undefined, null)).toBe(
      'The in-flight queue is empty — nothing is waiting or retrying.',
    );
    // A map of all-zero counts is the same nothing.
    expect(composeDlqCompositionVoice({ SEND_SMS: 0, SEND_EMAIL: 0 }, { resend: 0 }, '4m')).toBe(
      'The in-flight queue is empty — nothing is waiting or retrying.',
    );
  });

  it('one item is singular; several are plural — never "1 items"', () => {
    expect(composeDlqCompositionVoice({ SEND_SMS: 1 }, {}, null)).toBe(
      'In flight: 1 item — SEND_SMS 1.',
    );
    expect(composeDlqCompositionVoice({ SEND_SMS: 2 }, {}, null)).toBe(
      'In flight: 2 items — SEND_SMS 2.',
    );
  });

  it('entries ride CALLER ORDER — the wire\u2019s own order, never re-ranked', () => {
    const voice = composeDlqCompositionVoice({ Z_LAST: 1, A_FIRST: 3 }, {}, null);
    expect(voice).toBe('In flight: 4 items — Z_LAST 1, A_FIRST 3.');
  });

  it('the service breakdown joins when the wire carries one, stays silent when it does not', () => {
    const withSvc = composeDlqCompositionVoice({ SEND_SMS: 2 }, { twilio: 2 }, null);
    expect(withSvc).toBe('In flight: 2 items — SEND_SMS 2. By service: twilio 2.');
    const noSvc = composeDlqCompositionVoice({ SEND_SMS: 2 }, {}, null);
    expect(noSvc).not.toContain('By service');
  });

  it('the oldest age is named only when the caller carries one (pre-formatted figure contract)', () => {
    const withAge = composeDlqCompositionVoice({ SEND_SMS: 2 }, {}, '4m');
    expect(withAge).toBe('In flight: 2 items — SEND_SMS 2. The oldest item has waited 4m.');
    const noAge = composeDlqCompositionVoice({ SEND_SMS: 2 }, {}, null);
    expect(noAge).not.toContain('oldest');
  });

  it('NaN-poisoned and non-finite counts are dropped, never spoken or summed', () => {
    const voice = composeDlqCompositionVoice(
      { GOOD: 2, BROKEN: Number.NaN, WORSE: Number.POSITIVE_INFINITY, ZERO: 0 },
      { BAD: Number.NaN },
      null,
    );
    expect(voice).toBe('In flight: 2 items — GOOD 2.');
    expect(voice).not.toContain('BROKEN');
    expect(voice).not.toContain('WORSE');
    expect(voice).not.toContain('ZERO');
    expect(voice).not.toContain('NaN');
    expect(voice).not.toContain('Infinity');
  });

  it('a mixed queue reads whole: in-flight total, operations, services, oldest', () => {
    const voice = composeDlqCompositionVoice(
      { SEND_SMS: 3, CHARGE_CARD: 1 },
      { twilio: 3, daraja: 1 },
      '2h 15m',
    );
    expect(voice).toBe(
      'In flight: 4 items — SEND_SMS 3, CHARGE_CARD 1. By service: twilio 3, daraja 1. The oldest item has waited 2h 15m.',
    );
  });
});

describe('v2.209.0 — the surface renders what the wire always carried', () => {
  it('the strip exists and is scoped honestly', () => {
    expect(tabSrc.includes('In-Flight Composition')).toBe(true);
    expect(tabSrc.includes('pending + retrying only')).toBe(true);
    expect(tabSrc.includes('completed and cancelled are history, not composition')).toBe(true);
  });

  it('the bar is a role="img" whose aria rides the one-writer composer', () => {
    expect(tabSrc.includes('aria-label={composeDlqCompositionVoice(')).toBe(true);
    expect(tabSrc.includes('composeDlqCompositionVoice')).toBe(true);
    expect(tabSrc.includes("import { composeScoreVoice, composeDlqCompositionVoice } from '@/lib/report-voices';")).toBe(true);
  });

  it('the strip is gated on the REAL wire — no invented composition', () => {
    expect(tabSrc.includes('{dlqMetrics && (')).toBe(true);
    // The derivation filters the wire's maps through the zero law.
    expect(tabSrc.includes('Number.isFinite(n) && n > 0')).toBe(true);
    // The fetch shape is the only source of the metrics — no fallback constants.
    expect(tabSrc.includes('dlqMetrics?.byOperationType ?? {}')).toBe(true);
    expect(tabSrc.includes('dlqMetrics?.byTargetService ?? {}')).toBe(true);
  });

  it('the zero state speaks the nothing (no % of nothing)', () => {
    expect(tabSrc.includes('Nothing is waiting or retrying — every external call is accounted for.')).toBe(true);
  });

  it('segments divide by the in-flight total computed from the SAME filtered entries', () => {
    expect(tabSrc.includes('const dlqInFlight = dlqOpEntries.reduce(')).toBe(true);
    expect(tabSrc.includes('((count as number) / dlqInFlight) * 100')).toBe(true);
  });

  it('the waiting age is a DURATION voice, distinct from the time-ago voice', () => {
    expect(tabSrc.includes('function formatWaitedAge(')).toBe(true);
    expect(tabSrc.includes('The oldest item in flight has waited ${dlqOldestFigure}. ')).toBe(true);
    // The composition uses the duration formatter, not the timestamp one.
    expect(tabSrc.includes('formatWaitedAge(dlqMetrics.oldestPendingAt)')).toBe(true);
  });

  it('the measured palette holds (every stop a -600 elder, all above 3:1 on white)', () => {
    expect(tabSrc.includes("const DLQ_BAR_PALETTE = ['#2563eb', '#9333ea', '#0d9488', '#d97706', '#059669', '#0891b2'];")).toBe(true);
    expect(tabSrc.includes('blue-600 5.17')).toBe(true);
    expect(tabSrc.includes('amber-600 3.19')).toBe(true);
    // Segments and legend chips cycle the SAME palette — one truth per name.
    const segUses = (tabSrc.match(/DLQ_BAR_PALETTE\[i % DLQ_BAR_PALETTE\.length\]/g) || []).length;
    expect(segUses).toBe(2);
  });
});

describe('v2.209.0 — the wire and its guards', () => {
  it('the dlq route still answers with metrics (the strip\u2019s only source)', () => {
    const route = read('src/app/api/health/dlq/route.ts');
    expect(route.includes('metrics')).toBe(true);
    expect(route.includes('dlq.getMetrics')).toBe(true);
  });

  it('the wire\u2019s groupBy scope is pending + retrying (the badge\u2019s claim is the wire\u2019s own)', () => {
    const lib = read('src/lib/dead-letter-queue.ts');
    expect(lib.includes("where: { ...where, status: { in: ['PENDING', 'RETRYING'] } }")).toBe(true);
  });

  it('the desk\u2019s three live wires and the v2.208 voices survive untouched', () => {
    expect(tabSrc.includes("fetch('/api/health/system-status')")).toBe(true);
    expect(tabSrc.includes('fetch(`/api/health/dlq?${params}`)')).toBe(true);
    expect(tabSrc.includes("fetch('/api/health/circuit-breaker'")).toBe(true);
    expect(tabSrc.includes('within the 1,000ms caution line.')).toBe(true);
    expect(tabSrc.includes("'Overall compliance score'")).toBe(true);
  });

  it('no light-ground -500 stragglers rode in with the strip', () => {
    for (const ban of ['text-emerald-500"', 'text-amber-500"', 'text-teal-500"', 'text-purple-500"']) {
      expect(tabSrc.includes(ban), `found banned mark ${ban}`).toBe(false);
    }
  });
});

describe('v2.209.0 — the table exists (the bug the live E2E caught)', () => {
  // The live E2E found that /api/health/dlq was a 500 since birth: the lib
  // queried db.deadLetterQueue but NO schema carried the model (the cast in
  // db.ts hid the missing delegate from TypeScript), and the surfaces masked
  // the failure — the empty state painted "processing normally" over the
  // 500 and the aggregator fell back to zeros. These pins hold the fix.
  const schemaSrc = read('prisma/schema.prisma');

  it('the DeadLetterQueue model exists with the contract the lib assumed', () => {
    expect(schemaSrc.includes('model DeadLetterQueue')).toBe(true);
    expect(schemaSrc.includes('@@map("dead_letter_queue")')).toBe(true);
    for (const field of ['storeId', 'operationType', 'targetService', 'payload', 'status', 'retryCount', 'maxRetries', 'priority', 'sourceEntityId', 'lastError', 'nextRetryAt', 'resolvedAt', 'metadata', 'enqueuedAt']) {
      expect(schemaSrc.includes(field), `field ${field}`).toBe(true);
    }
  });

  it('the postgres migration exists with the table and its indexes', () => {
    const migration = read('prisma/migrations/20261022000000_add_dead_letter_queue/migration.sql');
    expect(migration.includes('CREATE TABLE "dead_letter_queue"')).toBe(true);
    expect(migration.includes('"resolvedAt" TIMESTAMP(3)')).toBe(true);
    expect(migration.includes('dead_letter_queue_status_nextRetryAt_idx')).toBe(true);
    expect(migration.includes('dead_letter_queue_status_resolvedAt_idx')).toBe(true);
    expect(migration.includes('dead_letter_queue_enqueuedAt_idx')).toBe(true);
  });

  it('the model is NOT store-scoped in the tenant extension (the ops desk reads across stores)', () => {
    const dbSrc = read('src/lib/db.ts');
    const scopedList = dbSrc.match(/const STORE_SCOPED_MODELS = new Set<string>\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
    expect(scopedList.includes('deadLetterQueue')).toBe(false);
  });

  it('the dlq route aliases createdAt from enqueuedAt (the desk reads createdAt)', () => {
    const route = read('src/app/api/health/dlq/route.ts');
    expect(route.includes('createdAt: item.enqueuedAt')).toBe(true);
  });

  it('the aggregator never invents zeros for a failed DLQ wire', () => {
    const statusRoute = read('src/app/api/health/system-status/route.ts');
    expect(statusRoute.includes("dlqStatus = 'error';")).toBe(true);
    expect(statusRoute.includes('The DLQ wire failed to answer — counts are unavailable, not zero.')).toBe(true);
    expect(statusRoute.includes('...(dlqDetail ? { detail: dlqDetail } : {})')).toBe(true);
  });

  it('the desk\u2019s DLQ query error is NOT the empty state', () => {
    expect(tabSrc.includes('isError: dlqError')).toBe(true);
    expect(tabSrc.includes('The DLQ wire failed to answer')).toBe(true);
    expect(tabSrc.includes('unavailable, not zero — check the server logs.')).toBe(true);
    // The empty state's "processing normally" line stays ONLY on the honest
    // loaded-and-empty path.
    expect(tabSrc.includes('All external service calls are processing normally')).toBe(true);
    // The quick stat speaks the wire\u2019s own detail when it carries one.
    expect(tabSrc.includes('status.deadLetterQueue.detail ||')).toBe(true);
  });

  it('the row action icon buttons carry accessible names (tooltip-only naming was an a11y gap)', () => {
    expect(tabSrc.includes('aria-label={`Retry ${item.operationType} item`}')).toBe(true);
    expect(tabSrc.includes('aria-label={`Cancel ${item.operationType} item`}')).toBe(true);
  });

  it('the honest door law: buttons render only to the role the server would answer', () => {
    // The three mutation routes are SUPER_ADMIN-only server-side.
    for (const route of ['src/app/api/health/dlq/route.ts', 'src/app/api/health/circuit-breaker/route.ts', 'src/app/api/health/retention/route.ts']) {
      expect(read(route).includes("roles: ['SUPER_ADMIN']"), `${route} guard`).toBe(true);
    }
    // The desk derives the same gate from the auth store and gates every
    // mutation button behind it.
    expect(tabSrc.includes("const canOperateQueue = useAuthStore((s) => s.user?.role) === 'SUPER_ADMIN';")).toBe(true);
    expect(tabSrc.includes('{canOperateQueue ? (')).toBe(true);
    // The restriction is spoken where the buttons would have been — three
    // surfaces (breaker header, breaker row, DLQ header).
    expect(tabSrc.includes('Operations are restricted to the system administrator')).toBe(true);
    expect(tabSrc.includes('Breaker operations are restricted to the system administrator')).toBe(true);
    expect(tabSrc.includes('Queue operations are restricted to the system administrator')).toBe(true);
  });

  it('the breaker row\u2019s expand toggle never eats its own dialog triggers', () => {
    // The live E2E: clicking Reset inside the expanded row bubbled into the
    // row's onClick, collapsed the row and unmounted the just-opened dialog
    // — the admin could never press it. The toggle now ignores clicks from
    // the row's interactive children.
    expect(tabSrc.includes("if ((e.target as HTMLElement).closest('button, [role=\"dialog\"], a')) return;")).toBe(true);
  });

  it('confirming a dialog closes it — the toast speaks the outcome', () => {
    expect(tabSrc.includes('onConfirm();\n              setOpen(false);')).toBe(true);
  });
});
