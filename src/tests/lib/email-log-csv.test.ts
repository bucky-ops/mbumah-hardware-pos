// MBUMAH HARDWARE POS - email delivery log CSV export tests (v2.29.0)
//
// Covers the pure serializer behind /api/notifications/logs?format=csv:
// RFC 4180 cell escaping (comma / quote / CR / LF / null), ISO date
// rendering, the header row, and the full row shape (message_id from
// metadata, triggered_by attribution, error passthrough). The CSV is what
// admins will open in a spreadsheet, so a malformed escape silently
// corrupts their offline audit trail — hence the strictness here.

import { describe, it, expect } from 'vitest';
import { escapeCsvCell, toEmailLogCsv, type EmailLogCsvRow } from '@/lib/email-log-csv';

describe('escapeCsvCell', () => {
  it('leaves plain cells untouched', () => {
    expect(escapeCsvCell('SENT')).toBe('SENT');
    expect(escapeCsvCell(42)).toBe('42');
  });

  it('quotes cells containing commas, quotes, CR or LF', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders null/undefined as empty cells and dates as ISO', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell(new Date('2026-10-16T07:30:00.000Z'))).toBe('2026-10-16T07:30:00.000Z');
  });
});

describe('toEmailLogCsv', () => {
  const row: EmailLogCsvRow = {
    id: 'log-1',
    type: 'HR_REPORT_DIGEST',
    recipient: 'owner@mbumahhardware.co.ke',
    subject: 'Headcount digest — October',
    status: 'FAILED',
    error: 'RESEND_API_KEY missing; retry after "config"',
    sentAt: new Date('2026-10-16T06:00:00.000Z'),
    createdAt: new Date('2026-10-16T06:00:05.000Z'),
    messageId: 'resend-123',
    userName: 'System Administrator',
    userEmail: 'admin@mbumahhardware.co.ke',
  };

  it('emits the header row then one CRLF line per row', () => {
    const csv = toEmailLogCsv([row]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,sent_at,created_at,type,status,recipient,subject,message_id,triggered_by,error');
    expect(lines).toHaveLength(3); // header + row + trailing empty from final CRLF
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('carries message_id, triggered_by and the error through', () => {
    const fields = toEmailLogCsv([row]).split('\r\n')[1].split(',');
    // Only the error cell gets quoted (it contains quotes) — every other
    // cell in this fixture has no comma/quote/CR/LF, so RFC 4180 leaves it
    // bare and the naive split stays index-aligned through the tail.
    expect(fields[0]).toBe('log-1');
    expect(fields[1]).toBe('2026-10-16T06:00:00.000Z');
    expect(fields[2]).toBe('2026-10-16T06:00:05.000Z');
    expect(fields[3]).toBe('HR_REPORT_DIGEST');
    expect(fields[4]).toBe('FAILED');
    expect(fields[5]).toBe('owner@mbumahhardware.co.ke');
    expect(fields[6]).toBe('Headcount digest — October');
    expect(fields[7]).toBe('resend-123');
    expect(fields[8]).toBe('System Administrator <admin@mbumahhardware.co.ke>');
    expect(fields[9]).toBe('"RESEND_API_KEY missing; retry after ""config"""');
  });

  it('doubles embedded quotes inside quoted cells (RFC 4180)', () => {
    const csv = toEmailLogCsv([{ ...row, error: 'boom "x", y' }]);
    expect(csv).toContain('"boom ""x"", y"');
  });

  it('renders absent messageId / user / dates as empty cells', () => {
    const csv = toEmailLogCsv([
      { ...row, messageId: undefined, userName: null, userEmail: null, sentAt: null, error: null },
    ]);
    const line = csv.split('\r\n')[1];
    // sent_at is empty, created_at still renders, messageId empty →
    // 'log-1,<empty sent_at>,<created>,HR_REPORT_DIGEST' prefix, and with
    // no user + no error the tail is subject + three empty cells.
    expect(line.startsWith('log-1,,2026-10-16T06:00:05.000Z,HR_REPORT_DIGEST')).toBe(true);
    expect(line).not.toContain('resend-123');
    expect(line.endsWith(',Headcount digest — October,,,')).toBe(true);
  });
});
