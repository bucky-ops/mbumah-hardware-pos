import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildConsentTimelineCsv,
  consentTimelineCsvFilename,
  consentTimelineStateLabel,
  escapeConsentCsvCell,
  type ConsentTimelineCsvRow,
} from '@/lib/hr/consent-timeline-csv';

/**
 * v2.130.0 — "the timeline files its copy".
 *
 * Two things ship under that headline:
 *
 *  1. THE TIMELINE FILES ITS COPY: the consent timeline drawer (v2.129.0)
 *     grows an Export CSV door — the export-honesty theme's third beat
 *     (v2.115 case list → v2.118 access ledger → now the consent timeline).
 *     The column set is the LEDGER's own (who, when, what purpose, which
 *     policy, how long stood); there is no content field on a ConsentRecord
 *     and none in the row type, so an export can never become a back door.
 *
 *  2. THE PRIVACY TAB SPEAKS ITS FAILURES: loadConsent / loadErasure /
 *     loadRetention used to catch a failed fetch into the same null state
 *     that "not yet answered" renders as — an eternal "Loading…" spin. A
 *     failed load now renders an honest rose strip with a retry, per card.
 */

const row = (over: Partial<ConsentTimelineCsvRow> = {}): ConsentTimelineCsvRow => ({
  cycle: 1,
  grantedAt: '2026-01-01T00:00:00.000Z',
  withdrawnAt: '2026-01-29T12:00:00.000Z',
  stoodDays: 28,
  purpose: 'PAYROLL_PROCESSING',
  policyVersion: 'hr-policy-2026-01',
  employeeCode: 'MBH-1-002',
  employeeName: 'Mary Wanjiku',
  ...over,
});

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('buildConsentTimelineCsv — RFC 4180 discipline', () => {
  it('the header is the ledger\'s own column set, pinned exactly', () => {
    const csv = buildConsentTimelineCsv([]);
    expect(csv).toBe(
      'cycle,state,granted_at,withdrawn_at,stood_days,purpose,policy_version,employee_code,employee_name\r\n',
    );
  });

  it('a withdrawn cycle files STANDING\'s sibling: state WITHDRAWN, ISO stamps, day count', () => {
    const csv = buildConsentTimelineCsv([row()]);
    const body = csv.split('\r\n')[1];
    expect(body).toBe(
      '1,WITHDRAWN,2026-01-01T00:00:00.000Z,2026-01-29T12:00:00.000Z,28,PAYROLL_PROCESSING,hr-policy-2026-01,MBH-1-002,Mary Wanjiku',
    );
  });

  it('a standing cycle leaves withdrawn_at and stood_days empty — no honest day count exists', () => {
    const csv = buildConsentTimelineCsv([row({ withdrawnAt: null, stoodDays: null })]);
    const body = csv.split('\r\n')[1];
    expect(body).toBe(
      '1,STANDING,2026-01-01T00:00:00.000Z,,5,PAYROLL_PROCESSING,hr-policy-2026-01,MBH-1-002,Mary Wanjiku'.replace('5', ''),
    );
    expect(body).toContain(',,');
  });

  it('rows keep their input order — the timeline arrives oldest first and files the same', () => {
    const csv = buildConsentTimelineCsv([
      row({ cycle: 1, purpose: 'FIRST' }),
      row({ cycle: 2, withdrawnAt: null, stoodDays: null, purpose: 'SECOND' }),
    ]);
    const bodies = csv.split('\r\n').slice(1, 3);
    expect(bodies[0]).toContain(',FIRST,');
    expect(bodies[1]).toContain(',SECOND,');
    expect(bodies[1]).toContain(',STANDING,');
  });

  it('quotes on need: commas, quotes, and newlines in purpose are escaped per RFC 4180', () => {
    expect(escapeConsentCsvCell('Compute salary, statutory deductions')).toBe('"Compute salary, statutory deductions"');
    expect(escapeConsentCsvCell('say "hello"')).toBe('"say ""hello"""');
    expect(escapeConsentCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeConsentCsvCell('plain')).toBe('plain');
    expect(escapeConsentCsvCell(null)).toBe('');
    expect(escapeConsentCsvCell(undefined)).toBe('');
  });

  it('a garbage timestamp degrades to an empty cell, never "Invalid Date" on file', () => {
    const csv = buildConsentTimelineCsv([row({ grantedAt: 'not-a-date' })]);
    const body = csv.split('\r\n')[1];
    expect(body).not.toContain('Invalid Date');
    expect(body).toBe('1,WITHDRAWN,,2026-01-29T12:00:00.000Z,28,PAYROLL_PROCESSING,hr-policy-2026-01,MBH-1-002,Mary Wanjiku');
  });

  it('CRLF everywhere, trailing line ending present', () => {
    const csv = buildConsentTimelineCsv([row(), row({ cycle: 2 })]);
    expect(csv.includes('\n\r')).toBe(false);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.match(/\r\n/g)?.length).toBe(3); // header + 2 rows
  });
});

describe('consentTimelineStateLabel + filename — the ledger\'s own language', () => {
  it('state derives from withdrawnAt, the same two words the chips wear', () => {
    expect(consentTimelineStateLabel('2026-01-29T12:00:00.000Z')).toBe('WITHDRAWN');
    expect(consentTimelineStateLabel(null)).toBe('STANDING');
  });

  it('filename carries the employee code and the day, sanitized', () => {
    expect(consentTimelineCsvFilename('MBH-1-002', new Date('2026-10-19T09:00:00.000Z'))).toBe(
      'consent-timeline-MBH-1-002-2026-10-19.csv',
    );
    expect(consentTimelineCsvFilename('weird/code here!', new Date('2026-10-19T09:00:00.000Z'))).toBe(
      'consent-timeline-weird-code-here--2026-10-19.csv',
    );
  });
});

describe('the confidentiality contract — an export can never become a back door', () => {
  it('the row type has no content field: the columns are who/when/what purpose only', () => {
    const s = src('src/lib/hr/consent-timeline-csv.ts');
    const iface = s.slice(s.indexOf('export interface ConsentTimelineCsvRow'), s.indexOf('// Pinned by tests'));
    for (const field of ['cycle', 'grantedAt', 'withdrawnAt', 'stoodDays', 'purpose', 'policyVersion', 'employeeCode', 'employeeName']) {
      expect(iface).toContain(field);
    }
    for (const forbidden of ['note', 'description', 'resolution', 'salary', 'amount', 'content']) {
      expect(iface.toLowerCase().includes(forbidden)).toBe(false);
    }
  });

  it('the header array is the line that must change — named as the contract it is', () => {
    const s = src('src/lib/hr/consent-timeline-csv.ts');
    expect(s).toContain("const CSV_HEADERS = [\n  'cycle',\n  'state',\n  'granted_at',\n  'withdrawn_at',\n  'stood_days',\n  'purpose',\n  'policy_version',\n  'employee_code',\n  'employee_name',\n] as const;");
    expect(s).toContain('third beat');
  });
});

describe('the drawer\'s CSV door wears the export-honesty manners', () => {
  const page = () => src('src/app/(shell)/hr/reports/page.tsx');

  it('the door carries its testid, per-employee aria-label, and the honesty tooltip', () => {
    const s = page();
    expect(s).toContain('data-testid="hr-privacy-consent-history-csv"');
    expect(s).toContain('aria-label={`Export consent timeline CSV — ${historyPayload.employee.name}`}');
    expect(s).toContain("Only who, when, and what purpose are exported — the ledger's own columns, never more.");
  });

  it('the door renders only when the timeline has rows — an empty ledger files nothing', () => {
    const s = page();
    expect(s).toContain('{historyPayload.events.length > 0 ? (');
  });

  it('the export rides the pure serializer with the payload\'s own employee identity', () => {
    const s = page();
    expect(s).toContain('buildConsentTimelineCsv(rows)');
    expect(s).toContain('consentTimelineCsvFilename(historyPayload.employee.code)');
    expect(s).toContain('employeeCode: historyPayload.employee.code');
    expect(s).toContain('employeeName: historyPayload.employee.name');
  });
});

describe('the Privacy tab speaks its failures — no more Loading-forever', () => {
  const page = () => src('src/app/(shell)/hr/reports/page.tsx');

  it('each card has its own error strip with a retry', () => {
    const s = page();
    // v2.131.0: the strips became ONE family component (ReportFailureStrip) —
    // the testids and retry labels ride the props now, same contract.
    expect(s).toContain('testId="hr-privacy-consent-error"');
    expect(s).toContain('testId="hr-privacy-erasure-error"');
    expect(s).toContain('testId="hr-privacy-retention-error"');
    expect(s).toContain('retryLabel="Retry loading consent records"');
    expect(s).toContain('retryLabel="Retry loading erasure requests"');
    expect(s).toContain('retryLabel="Retry loading the retention desk"');
  });

  it('the strips are rose-tinted with dark twins and say the desk stays dark', () => {
    const s = page();
    // v2.131.0: the rose frame lives ONCE — inside the shared family component.
    expect(s.match(/border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-900 dark:bg-rose-950\/40/g)?.length).toBe(1);
    expect(s.match(/the desk stays dark rather than guess\./g)?.length).toBe(3);
  });

  it('the loaders mark failure on catch and clear it on success — the strip can recover', () => {
    const s = page();
    for (const setter of ['setConsentFailed', 'setErasureFailed', 'setRetentionFailed']) {
      const uses = s.split(setter).length - 1;
      expect(uses).toBe(3); // declare + set true in catch + clear on success
    }
    expect(s).toContain('setConsentFailed(true)');
    expect(s).toContain('setConsentFailed(false)');
  });

  it('skeletons remain the not-yet-answered state — failure and loading stay distinct', () => {
    const s = page();
    // three cards: error strip OR skeleton, then data
    expect(s.match(/<Skeleton className="h-28 w-full" \/>/g)?.length).toBe(3);
    expect(s).toContain('consentFailed ? (');
    expect(s).toContain('erasureFailed ? (');
    expect(s).toContain('retentionFailed ? (');
  });
});
