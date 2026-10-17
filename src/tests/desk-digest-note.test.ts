import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.68.0 contracts — the morning note rings the bell.
 *
 * Gap: v2.67.0 gave the desk its morning note, but the note only greeted
 * whoever opened the org console — on a busy day the desk's story sat
 * unread until someone clicked in. The bell — the app's one universal
 * "something happened" channel — never heard about it.
 *
 * Covered here:
 *  1. Pure module (src/lib/hr/desk-digest-note.ts): marker, org-role
 *     audience (= the review-activity gate), EAT date key, honest
 *     singular/plural copy, quiet-day null, metadata shape, dedupe needle.
 *  2. The trigger: GET /api/org/review-activity ensures the note after
 *     deriving the digest — best-effort (swallow-safe try/catch), deduped
 *     per summarized day, recipients = active ORG_ROLES users, rows
 *     storeId NULL (org-wide contract), rawDb inside runWithoutTenant.
 *  3. The feed: section 9 of /api/notifications owns the marker; the
     desk_digest kind maps to a quiet info row deep-linking /org/dashboard.
 *  4. The bell: orange sunrise icon, orange dawn rail, "Morning note"
 *     chip — the strip's dawn voice in the feed's own chip language.
 *  5. What's-New 2.68.0 leads the feed with the bell story; package.json
 *     bumped.
 */

const readRepo = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

// ── 1. The pure module ──────────────────────────────────────────────────────

import {
  DESK_DIGEST_ACTION_URL,
  DESK_DIGEST_METADATA_MARKER,
  DESK_DIGEST_ORG_ROLES,
  deskDigestDateKey,
  deskDigestDedupeNeedle,
  deskDigestMetadata,
  deskDigestNoteCopy,
  deskDigestPlural,
  deskDigestShortStoreName,
  type DeskDigestNoteFigures,
} from '@/lib/hr/desk-digest-note';

const figures = (over: Partial<DeskDigestNoteFigures> = {}): DeskDigestNoteFigures => ({
  label: 'Fri, 16 Oct',
  visits: 4,
  clears: 1,
  reviewers: 2,
  requests: 2,
  busiestBranch: { storeName: 'Juja Main', visits: 4 },
  topReviewer: { name: 'System Administrator', visits: 3 },
  ...over,
});

describe('desk-digest-note — the pure module', () => {
  it('carries the marker, the deep link and the review-activity gate roles', () => {
    expect(DESK_DIGEST_METADATA_MARKER).toBe('desk_digest');
    expect(DESK_DIGEST_ACTION_URL).toBe('/org/dashboard');
    expect([...DESK_DIGEST_ORG_ROLES]).toEqual(['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER']);
  });

  it('derives the EAT wall date of the summarized day from the window start', () => {
    // The window start for the EAT day 2026-10-16 is 2026-10-15T21:00Z
    // (EAT-midnight minus the +3 offset). The key must read 2026-10-16.
    expect(deskDigestDateKey(new Date('2026-10-15T21:00:00.000Z'))).toBe('2026-10-16');
    expect(deskDigestDateKey(new Date('2026-12-31T21:00:00.000Z'))).toBe('2027-01-01');
  });

  it('writes honest singular/plural copy mirroring the strip figures', () => {
    const copy = deskDigestNoteCopy(figures());
    expect(copy?.title ?? null).toBe('Yesterday at the desk — Fri, 16 Oct');
    expect(copy?.message ?? null).toBe(
      '4 visits · 1 correction answered · 2 reviewers · 2 requests — busiest: Juja Main (4) · most active: System Administrator (3)',
    );
  });

  it('keeps singular/plural exact on a one-of-everything day', () => {
    const copy = deskDigestNoteCopy(
      figures({
        visits: 1,
        clears: 1,
        reviewers: 1,
        requests: 1,
        busiestBranch: { storeName: 'Juja Main', visits: 1 },
        topReviewer: { name: 'Grace Achieng', visits: 1 },
      }),
    );
    expect(copy?.message ?? null).toBe(
      '1 visit · 1 correction answered · 1 reviewer · 1 request — busiest: Juja Main (1) · most active: Grace Achieng (1)',
    );
  });

  it('omits the extras sentence when the day has no chips', () => {
    const copy = deskDigestNoteCopy(figures({ busiestBranch: null, topReviewer: null }));
    expect(copy?.message ?? null).toBe('4 visits · 1 correction answered · 2 reviewers · 2 requests');
  });

  it('shortens the busiest-branch name like the strip chip does', () => {
    expect(deskDigestShortStoreName('MBUMAH HARDWARE - Juja Main')).toBe('Juja Main');
    expect(deskDigestShortStoreName('mbumah hardware - Thika Road')).toBe('Thika Road');
    expect(deskDigestShortStoreName('Juja Main')).toBe('Juja Main');
    const copy = deskDigestNoteCopy(
      figures({ busiestBranch: { storeName: 'MBUMAH HARDWARE - Juja Main', visits: 4 } }),
    );
    expect(copy?.message ?? null).toContain('busiest: Juja Main (4)');
  });

  it('rings nothing on a quiet day — null copy, no fake-zero row', () => {
    expect(deskDigestNoteCopy(figures({ visits: 0, clears: 0, reviewers: 0, requests: 0, busiestBranch: null, topReviewer: null }))).toBeNull();
  });

  it('stamps metadata with the kind, the dedupe date and the figures', () => {
    const meta = deskDigestMetadata('2026-10-16', figures());
    expect(meta).toEqual({ kind: 'desk_digest', deskDigestDate: '2026-10-16', visits: 4, clears: 1 });
    expect(deskDigestDedupeNeedle('2026-10-16')).toBe('"deskDigestDate":"2026-10-16"');
  });

  it('pluralizes honestly at the boundary', () => {
    expect(deskDigestPlural(1, 'visit', 'visits')).toBe('1 visit');
    expect(deskDigestPlural(2, 'visit', 'visits')).toBe('2 visits');
    expect(deskDigestPlural(0, 'correction answered', 'corrections answered')).toBe('0 corrections answered');
  });
});

// ── 2. The trigger — review-activity ensures the note ───────────────────────

describe('GET /api/org/review-activity - the bell trigger', () => {
  const RA = readRepo('src/app/api/org/review-activity/route.ts');

  it('calls the note writer after deriving the digest, before the payload', () => {
    const trigger = RA.indexOf('await ensureDeskDigestNote({');
    const digest = RA.indexOf('const digestTopReviewer');
    const payload = RA.indexOf('return Response.json({');
    expect(trigger).toBeGreaterThan(digest);
    expect(trigger).toBeLessThan(payload);
  });

  it('feeds the writer the same figures the payload ships', () => {
    expect(RA).toMatch(/windowStart: yesterdayStart,/);
    expect(RA).toMatch(/label: yesterdayLabel,/);
    expect(RA).toMatch(/visits: digestVisits,/);
    expect(RA).toMatch(/clears: digestClears,/);
    expect(RA).toMatch(/reviewers: reviewerDigest\.size,/);
    expect(RA).toMatch(/requests: requestIds\.size,/);
  });

  it('is swallow-safe — a refused bell never breaks the panel', () => {
    expect(RA).toMatch(/try \{\s*await ensureDeskDigestNote/);
    expect(RA).toMatch(/\} catch \{\s*\/\* the bell note is best-effort by contract \*\/\s*\}/);
  });

  it('dedupes per summarized day via the metadata needle', () => {
    expect(RA).toMatch(/findFirst\(\{\s*where: \{ category: 'HR', metadata: \{ contains: deskDigestDedupeNeedle\(dateKey\) \} \},\s*select: \{ id: true \},\s*\}\)/);
    expect(RA).toMatch(/if \(existing\) return;/);
  });

  it('fans out to active org-role users only, storeId NULL, via rawDb', () => {
    expect(RA).toMatch(/rawDb\.user\.findMany\(\{\s*where: \{ isActive: true, role: \{ in: \[\.\.\.DESK_DIGEST_ORG_ROLES\] \} \},\s*select: \{ id: true \},\s*\}\)/);
    expect(RA).toMatch(/storeId: null,/);
    expect(RA).toMatch(/rawDb\.notification\.createMany\(/);
    expect(RA).toMatch(/type: 'SYSTEM',\s*category: 'HR',\s*priority: 'NORMAL',/);
    expect(RA).toMatch(/actionUrl: DESK_DIGEST_ACTION_URL,/);
    expect(RA).toMatch(/actionLabel: 'Open desk activity',/);
  });
});

// ── 3. The feed — section 9 owns the marker ─────────────────────────────────

describe('/api/notifications - the desk_digest feed mapping', () => {
  const NR = readRepo('src/app/api/notifications/route.ts');

  it('imports the marker and sweeps it into the section-9 OR list', () => {
    expect(NR).toContain("import { DESK_DIGEST_METADATA_MARKER } from '@/lib/hr/desk-digest-note';");
    expect(NR).toMatch(/\{ metadata: \{ contains: DESK_DIGEST_METADATA_MARKER \} \},/);
  });

  it('maps the kind to a quiet info row with the dashboard deep link', () => {
    expect(NR).toMatch(/else if \(kind === 'desk_digest'\) \{/);
    const block = NR.slice(NR.indexOf("kind === 'desk_digest'"));
    expect(block).toMatch(/type: 'desk_digest',/);
    expect(block).toMatch(/severity: 'info',/);
    expect(block).toMatch(/actionUrl: n\.actionUrl \?\? '\/org\/dashboard',/);
    expect(block).toMatch(/actionLabel: n\.actionLabel \?\? 'Open desk activity',/);
  });

  it('section 8 excludes the marker so the row never renders twice', () => {
    // The v2.38.0 double-render class: section 8 sweeps category-HR rows
    // into fake hr_digest copies unless every section-9 marker is in its
    // NOT filter. desk_digest must be excluded there too.
    const notStart = NR.indexOf('NOT: {');
    const notBlock = NR.slice(notStart, NR.indexOf('orderBy', notStart));
    expect(notBlock).toContain('DESK_DIGEST_METADATA_MARKER');
  });

  it('declares the feed type in the NotificationData union', () => {
    expect(NR).toMatch(/'payroll_paid' \| 'desk_digest';/);
  });

  it('parses the kind + date out of the metadata', () => {
    const LN = readRepo('src/lib/hr/leave-notify.ts');
    expect(LN).toMatch(/\n  \| 'desk_digest';/);
    expect(LN).toMatch(/rec\.kind === 'desk_digest'/);
    expect(LN).toMatch(/if \(typeof rec\.deskDigestDate === 'string'\) out\.deskDigestDate = rec\.deskDigestDate;/);
  });
});

// ── 4. The bell — the dawn voice in the feed ────────────────────────────────

describe('notification-center - the desk_digest row surface', () => {
  const NC = readRepo('src/components/notification-center.tsx');
  const API = readRepo('src/lib/api.ts');

  it('wears the orange sunrise icon (dawn voice, distinct from amber rails)', () => {
    expect(NC).toMatch(/case 'desk_digest':\s*\n\s*return <Sunrise className="h-4 w-4 text-orange-600 dark:text-orange-400" \/>;/);
    expect(NC).toMatch(/Sunrise,\s*\n\} from 'lucide-react';/);
  });

  it('wears the orange dawn rail', () => {
    expect(NC).toContain("notification.type === 'desk_digest' ? 'border-l-[3px] border-l-orange-400 dark:border-l-orange-500' : ''");
  });

  it('carries the orange "Morning note" chip', () => {
    const anchor = NC.indexOf("notification.type === 'desk_digest' ? (\n                          <div className=\"mt-1 flex flex-wrap items-center gap-1\">");
    expect(anchor).toBeGreaterThan(-1);
    const chip = NC.slice(anchor);
    expect(chip).toMatch(/Morning note\s*<\/span>/);
    expect(chip).toMatch(/border-orange-200 bg-orange-50/);
    expect(chip).toMatch(/dark:border-orange-900 dark:bg-orange-950\/40 dark:text-orange-300/);
  });

  it('declares the type in the client NotificationItem union', () => {
    expect(API).toMatch(/'payroll_paid' \| 'desk_digest';/);
  });
});

// ── 5. Release metadata ─────────────────────────────────────────────────────

describe('release metadata - v2.68.0', () => {
  it('leads What\'s-New with the bell story', () => {
    const WN = readRepo('src/lib/whats-new.ts');
    expect(WN.indexOf("version: '2.68.0'")).toBeGreaterThan(-1);
    expect(WN.indexOf("version: '2.68.0'")).toBeLessThan(WN.indexOf("version: '2.67.0'"));
    expect(WN).toContain('The morning note rings the bell');
    expect(WN).toMatch(/Once per day, guaranteed/);
    expect(WN).toMatch(/Quiet days stay quiet/);
    expect(WN).toMatch(/Morning note/);
  });

  it('bumps package.json to 2.68.0 (all three slots)', () => {
    const pkg = JSON.parse(readRepo('package.json'));
    expect(pkg.version).toBe('2.68.0');
    expect(pkg.mbumah.releaseVersion).toBe('2.68.0');
    expect(pkg.mbumah.baseVersion).toBe('2.68.0');
  });
});
