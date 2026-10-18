import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * v2.118.0 — "the ledger files its copy".
 *
 * The ledger's CSV door: the filtered ledger window exports content-free as
 * access-ledger-YYYY-MM-DD.csv.
 *  1. PURE: buildAccessLedgerCsv (RFC 4180 escaping, CRLF, header row first,
 *     nulls → empty cells), ledgerEventLabel (denied → DENIED, else OPEN),
 *     escapeLedgerCsvCell (quote-on-need, double embedded quotes).
 *  2. CONTENT-FREEDOM: the header set has no description column and the row
 *     type has no field for one — an export can never carry more than the
 *     screen it came from.
 *  3. SOURCE CONTRACTS: the ledger toolbar wears the CSV door (aria label,
 *     testid, disabled-on-empty, honest title), the export maps the FILTERED
 *     rows, and the counts line names the denied span honestly.
 */

import {
  buildAccessLedgerCsv,
  escapeLedgerCsvCell,
  ledgerEventLabel,
  type AccessLedgerCsvRow,
} from '@/lib/hr/discipline-ledger-csv';

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const row = (over: Partial<AccessLedgerCsvRow> = {}): AccessLedgerCsvRow => ({
  timestamp: '2026-10-19T08:00:00.000Z',
  denied: false,
  userName: 'Hr Manager',
  caseId: 'case-1',
  employeeName: 'Ada One',
  ...over,
});

describe('buildAccessLedgerCsv — the export wears the ledger contract', () => {
  it('header row first, then the filtered rows in input order', () => {
    const csv = buildAccessLedgerCsv([
      row({ caseId: 'case-2', employeeName: 'Ben Two', denied: true }),
      row({ caseId: 'case-1' }),
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('when_iso,event,who,case_id,case_employee');
    expect(lines[1]).toContain('case-2,Ben Two');
    expect(lines[2]).toContain('case-1,Ada One');
  });

  it('the event column speaks the chips: OPEN / DENIED', () => {
    expect(ledgerEventLabel(true)).toBe('DENIED');
    expect(ledgerEventLabel(false)).toBe('OPEN');
    const csv = buildAccessLedgerCsv([row({ denied: true }), row({ denied: false })]);
    expect(csv).toContain(',DENIED,');
    expect(csv).toContain(',OPEN,');
  });

  it('timestamps export as ISO; a garbage timestamp degrades to an empty cell', () => {
    expect(buildAccessLedgerCsv([row()])).toContain('2026-10-19T08:00:00.000Z');
    const csv = buildAccessLedgerCsv([row({ timestamp: 'not-a-date' })]);
    // the empty when_iso leads the line; the rest of the row is intact
    expect(csv).toMatch(/^when_iso,event,who,case_id,case_employee\r\n,OPEN,Hr Manager,case-1,Ada One/);
  });

  it('nulls become empty cells — no fabricated labels', () => {
    const csv = buildAccessLedgerCsv([row({ userName: null, employeeName: null })]);
    const line = csv.split('\r\n')[1];
    expect(line).toBe(`2026-10-19T08:00:00.000Z,OPEN,,case-1,`);
  });

  it('RFC 4180: cells with commas or quotes are quoted, embedded quotes doubled', () => {
    const csv = buildAccessLedgerCsv([
      row({ userName: 'Owner, "Mbumah"', employeeName: 'Nduta, Grace' }),
    ]);
    expect(csv).toContain('"Owner, ""Mbumah""",case-1,"Nduta, Grace"');
  });

  it('escapeLedgerCsvCell: quotes only when needed, doubles embedded quotes', () => {
    expect(escapeLedgerCsvCell('plain')).toBe('plain');
    expect(escapeLedgerCsvCell('a,b')).toBe('"a,b"');
    expect(escapeLedgerCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeLedgerCsvCell('line\r\nbreak')).toBe('"line\r\nbreak"');
    expect(escapeLedgerCsvCell(null)).toBe('');
    expect(escapeLedgerCsvCell(undefined)).toBe('');
    expect(escapeLedgerCsvCell(new Date('2026-10-19T08:00:00Z'))).toBe('2026-10-19T08:00:00.000Z');
  });

  it('CRLF line endings, trailing CRLF terminator', () => {
    const csv = buildAccessLedgerCsv([row(), row({ caseId: 'case-2' })]);
    expect(csv).toMatch(/\r\n$/);
    expect(csv.split('\r\n')).toHaveLength(4); // header + 2 rows + trailing
    expect(csv).not.toMatch(/[^\r]\n/);
  });

  it('content-freedom: the schema has no description surface to leak through', () => {
    // The header set is THE contract: exactly the five columns the screen
    // shows — there is no description/resolutionNotes column for content to
    // ride in on (the row type has no field for one either).
    const csv = buildAccessLedgerCsv([row({ userName: 'a, "quoted" name' })]);
    expect(csv.split('\r\n').filter(Boolean)[0]).toBe('when_iso,event,who,case_id,case_employee');
    expect(csv).not.toContain('description');
    expect(csv).not.toContain('resolutionNotes');
    // a plain row renders exactly five cells (quoting can inflate a naive
    // split — that is RFC 4180 working, not a schema change)
    const plain = buildAccessLedgerCsv([row()]).split('\r\n').filter(Boolean);
    expect(plain).toHaveLength(2);
    expect(plain[1].split(',')).toHaveLength(5);
  });

  it('an empty set exports just the header row', () => {
    const csv = buildAccessLedgerCsv([]);
    expect(csv).toBe('when_iso,event,who,case_id,case_employee\r\n');
  });
});

describe('source contracts — the ledger toolbar wears the CSV door', () => {
  it('the button: aria label, testid, disabled-on-empty, honest title', () => {
    const page = src('src/app/(shell)/hr/discipline/page.tsx');
    expect(page).toContain('aria-label="Export access ledger as CSV"');
    expect(page).toContain('data-testid="hr-discipline-ledger-csv"');
    expect(page).toContain('Only who, when, and which case are exported');
    expect(page).toContain('disabled={ledgerVisible.length === 0}');
    expect(page).toContain("a.download = `access-ledger-${new Date().toISOString().slice(0, 10)}.csv`");
  });

  it('the export maps the FILTERED rows (ledgerVisible, not ledger)', () => {
    const page = src('src/app/(shell)/hr/discipline/page.tsx');
    const exportBody = page.slice(page.indexOf('const exportLedgerCsv'));
    expect(exportBody).toContain('ledgerVisible.map');
    expect(exportBody).not.toContain('ledger.map');
    // the export maps every ledger column the screen shows — nothing more
    expect(exportBody).toContain('timestamp: r.timestamp');
    expect(exportBody).toContain('denied: r.denied');
    expect(exportBody).toContain('userName: r.userName');
    expect(exportBody).toContain('caseId: r.caseId');
    expect(exportBody).toContain('employeeName: r.employeeName');
  });

  it('the serializer keeps the content-free header set pinned', () => {
    const lib = src('src/lib/hr/discipline-ledger-csv.ts');
    expect(lib).toContain("'when_iso',");
    expect(lib).toContain("'event',");
    expect(lib).toContain("'who',");
    expect(lib).toContain("'case_id',");
    expect(lib).toContain("'case_employee',");
    expect(lib).not.toMatch(/'description'|'resolution_notes'/);
  });

  it('the counts line names the denied count with its own honest span', () => {
    const page = src('src/app/(shell)/hr/discipline/page.tsx');
    expect(page).toContain('data-testid="hr-discipline-ledger-denied-count"');
    expect(page).toContain('Denied attempts in this window');
    // v2.117 contracts survive the counts-line restructure
    expect(page).toContain('data-testid="hr-discipline-ledger-counts"');
    expect(page).toContain('aria-label="Refresh access ledger"');
  });
});
