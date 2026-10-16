// MBUMAH HARDWARE POS - email delivery log CSV serializer (v2.29.0)
//
// Pure serializer behind the /api/notifications/logs?format=csv export.
// Kept out of the route so the escaping rules are unit-testable: CSV cells
// follow RFC 4180 (quote a cell when it contains a comma, quote, CR or LF;
// double any embedded quotes). Every cell is also stringified defensively —
// nulls become empty cells, dates become ISO strings.

export interface EmailLogCsvRow {
  id: string;
  type: string;
  recipient: string;
  subject: string;
  status: string;
  error: string | null;
  sentAt: Date | string | null;
  createdAt: Date | string;
  messageId?: unknown;
  userName?: string | null;
  userEmail?: string | null;
}

const CSV_HEADERS = [
  'id',
  'sent_at',
  'created_at',
  'type',
  'status',
  'recipient',
  'subject',
  'message_id',
  'triggered_by',
  'error',
] as const;

/** RFC 4180 cell escaping: quote when needed, double embedded quotes. */
export function escapeCsvCell(value: unknown): string {
  const s =
    value === null || value === undefined
      ? ''
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function iso(value: Date | string | null): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Serialize delivery-log rows to RFC 4180 CSV (CRLF line endings, header
 * row first). Rows keep their input order — the route sorts newest first.
 */
export function toEmailLogCsv(rows: EmailLogCsvRow[]): string {
  const lines: string[] = [CSV_HEADERS.join(',')];
  for (const r of rows) {
    const meta = (r as { messageId?: unknown }).messageId;
    lines.push(
      [
        escapeCsvCell(r.id),
        escapeCsvCell(iso(r.sentAt)),
        escapeCsvCell(iso(r.createdAt)),
        escapeCsvCell(r.type),
        escapeCsvCell(r.status),
        escapeCsvCell(r.recipient),
        escapeCsvCell(r.subject),
        escapeCsvCell(meta === null || meta === undefined ? '' : String(meta)),
        escapeCsvCell(r.userName ? `${r.userName} <${r.userEmail ?? ''}>` : ''),
        escapeCsvCell(r.error ?? ''),
      ].join(','),
    );
  }
  return lines.join('\r\n') + '\r\n';
}
