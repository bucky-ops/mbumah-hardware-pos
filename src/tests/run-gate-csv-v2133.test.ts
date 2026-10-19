// v2.133.0 — the gate's CSV door. The serializer's mechanics (RFC 4180, the
// house way) and the desk contract (the button on the panel, the honesty
// title, the filename). The gate verdict files itself; it never carries money.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildRunGateCsv, escapeRunGateCsvCell, type RunGateCsvRow } from '@/lib/hr/payroll/run-gate-csv';

const row = (over: Partial<RunGateCsvRow> = {}): RunGateCsvRow => ({
  period: 'October 2026',
  checkedAtIso: '2026-10-19T07:00:00.000Z',
  employeeCode: 'EMP-001',
  employeeName: 'Ada One',
  gateState: 'CLEAR',
  prepareWouldReport: '',
  ...over,
});

describe('run-gate CSV — RFC 4180 mechanics, the house way', () => {
  it('the header is the gate panel\u2019s own column set, verbatim and first', () => {
    const csv = buildRunGateCsv([]);
    expect(csv.split('\r\n')[0]).toBe(
      'period,checked_at_iso,employee_code,employee_name,gate_state,prepare_would_report',
    );
  });

  it('a CLEAR employee files an empty prepare_would_report cell', () => {
    const line = buildRunGateCsv([row()]).split('\r\n')[1];
    expect(line).toBe('October 2026,2026-10-19T07:00:00.000Z,EMP-001,Ada One,CLEAR,');
  });

  it('a blocked employee carries the gate prepare would report first', () => {
    const line = buildRunGateCsv([
      row({ employeeCode: 'EMP-002', employeeName: 'Grace Two', gateState: 'MISSING_CONSENT', prepareWouldReport: 'MISSING_CONSENT' }),
    ]).split('\r\n')[1];
    expect(line).toBe('October 2026,2026-10-19T07:00:00.000Z,EMP-002,Grace Two,MISSING_CONSENT,MISSING_CONSENT');
  });

  it('quotes on comma, quote, CR or LF; doubles embedded quotes', () => {
    expect(escapeRunGateCsvCell('Okello, Jr')).toBe('"Okello, Jr"');
    expect(escapeRunGateCsvCell('The "M" Store')).toBe('"The ""M"" Store"');
    expect(escapeRunGateCsvCell('line\r\nbreak')).toBe('"line\r\nbreak"');
    expect(escapeRunGateCsvCell('plain')).toBe('plain');
  });

  it('nulls and unparseable timestamps become empty cells, never fabricated dates', () => {
    expect(escapeRunGateCsvCell(null)).toBe('');
    expect(escapeRunGateCsvCell(undefined)).toBe('');
    const line = buildRunGateCsv([row({ checkedAtIso: 'not-a-date' })]).split('\r\n')[1];
    expect(line.startsWith('October 2026,,EMP-001')).toBe(true);
  });

  it('every row ends CRLF and the file closes with one', () => {
    const csv = buildRunGateCsv([row(), row({ employeeCode: 'EMP-002' })]);
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv.match(/\r\n/g)?.length).toBe(3);
  });
});

describe('the gate CSV door — the desk contract', () => {
  const page = readFileSync('src/app/(shell)/hr/payroll/page.tsx', 'utf8');

  it('the CSV button lives on the gate panel with its own testid and aria', () => {
    expect(page).toContain('data-testid="payroll-gate-csv"');
    expect(page).toContain('aria-label={`Export the ${periodName} gate verdict as CSV`}');
  });

  it('the honesty title says what never ships: never payslip amounts', () => {
    expect(page).toContain('Never payslip amounts.');
  });

  it('the file is named run-gate-YYYY-MM-DD.csv', () => {
    expect(page).toContain('`run-gate-${new Date().toISOString().slice(0, 10)}.csv`');
  });

  it('the button is disabled when the report has no rows', () => {
    expect(page).toMatch(/disabled=\{report\.rows\.length === 0\}/);
  });

  it('the serializer rides the page, not a fetch — the export is built locally', () => {
    expect(page).toContain('buildRunGateCsv(rows)');
  });
});
