'use client';

// MBUMAH HARDWARE POS - Email Delivery Log admin section (v2.26.0)
//
// Read-only ops console over /api/notifications/logs (SUPER_ADMIN and
// STORE_OWNER only — the same roles the Admin tab itself is gated to).
// Every outbound email attempt the central email service records is
// listable here: filter by status and type, page through the history,
// expand a row to see the parsed metadata (messageId, scheduleId,
// reportKey, actor) and the delivery error when a send failed.
//
// Styling follows the admin dense-table contract: sticky header, zebra
// hover, status chips with dark variants, focus rings everywhere, no
// horizontal scroll on mobile (subject + recipient truncate with title).

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock3,
  Download,
  Inbox,
  Mail,
  MailWarning,
  RefreshCw,
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface LogRow {
  id: string;
  type: string;
  recipient: string;
  subject: string;
  status: string; // PENDING | SENT | FAILED
  error: string | null;
  metadata: Record<string, unknown>;
  sentAt: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string; role: string } | null;
}

interface LogsResponse {
  data: LogRow[];
  pagination: { limit: number; offset: number; total: number; totalPages: number };
}

const PAGE_SIZE = 15;

const STATUS_FILTERS = ['ALL', 'SENT', 'FAILED', 'PENDING'] as const;

// The whitelist the API enforces — mirrored for the type filter dropdown so
// an unknown selection never round-trips into a silently-ignored filter.
const TYPE_FILTERS = [
  'ALL',
  'HR_REPORT_DIGEST',
  'RECEIPT',
  'LOW_STOCK',
  'DAILY_REPORT',
  'WELCOME',
  'PASSWORD_RESET',
  'TIER_UPGRADE',
  'LEAVE_DECISION',
  'LEAVE_REQUEST',
  'TEST',
] as const;

const STATUS_CHIP: Record<string, string> = {
  SENT: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900',
  FAILED: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900',
  PENDING: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
};

const TYPE_CHIP: Record<string, string> = {
  HR_REPORT_DIGEST: 'bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-900',
  RECEIPT: 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900',
  LOW_STOCK: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900',
  LEAVE_DECISION: 'bg-teal-100 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-900',
  LEAVE_REQUEST: 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-900',
};

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function chipClass(map: Record<string, string>, key: string): string {
  return map[key] ?? 'bg-muted text-muted-foreground border-border';
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'SENT') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />;
  if (status === 'FAILED') return <XCircle className="h-3.5 w-3.5 text-rose-500" aria-hidden />;
  return <Clock3 className="h-3.5 w-3.5 text-amber-500" aria-hidden />;
}

export function EmailDeliveryLogSection() {
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>('ALL');
  const [type, setType] = useState<(typeof TYPE_FILTERS)[number]>('ALL');
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (status !== 'ALL') params.set('status', status);
  if (type !== 'ALL') params.set('type', type);

  // NOTE: /api/notifications/logs returns { success, data, pagination } — the
  // lean apiGet helper unwraps and DISCARDS pagination, so this section reads
  // the full envelope itself (same error semantics: !ok || !success → throw).
  const query = useQuery({
    queryKey: ['admin-email-log', status, type, offset],
    queryFn: async (): Promise<LogsResponse> => {
      const res = await fetch(`/api/notifications/logs?${params.toString()}`, { credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: LogRow[]; pagination?: LogsResponse['pagination']; error?: string };
      if (!res.ok || !json.success) {
        throw new Error(json.error || `Request failed (${res.status})`);
      }
      return { data: json.data ?? [], pagination: json.pagination ?? { limit: PAGE_SIZE, offset, total: 0, totalPages: 1 } };
    },
    refetchInterval: 60_000,
  });

  const rows = query.data?.data ?? null;
  const pagination = query.data?.pagination ?? null;

  const changeFilter = (apply: () => void) => {
    apply();
    setOffset(0);
    setExpandedId(null);
  };

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4 text-sky-500" aria-hidden /> Email delivery log
            </CardTitle>
            <CardDescription className="text-xs">
              Every outbound email attempt — receipts, alerts and HR digests — with its delivery outcome.
              Read-only; rows are written by the email service itself.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            {/* v2.29.0: CSV export — a plain anchor so the browser handles the
                download natively; the href carries the ACTIVE filters, so the
                export always matches what is on screen. */}
            <a
              href={`/api/notifications/logs?format=csv&${params.toString()}`}
              download
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Export the filtered delivery log as CSV"
            >
              <Download className="h-3.5 w-3.5 text-sky-500" aria-hidden /> Export CSV
            </a>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void query.refetch()}
              className="h-8 gap-1.5 text-xs"
              aria-label="Refresh email delivery log"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${query.isFetching ? 'animate-spin' : ''}`} aria-hidden /> Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Delivery log filters">
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by delivery status">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => changeFilter(() => setStatus(s))}
                aria-pressed={status === s}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  status === s
                    ? 'border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300'
                    : 'border-border bg-card text-muted-foreground hover:bg-muted/60'
                }`}
              >
                {s === 'ALL' ? 'All statuses' : s}
              </button>
            ))}
          </div>
          <select
            value={type}
            onChange={(e) => changeFilter(() => setType(e.target.value as (typeof TYPE_FILTERS)[number]))}
            aria-label="Filter by email type"
            className="h-8 rounded-md border border-border bg-card px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {TYPE_FILTERS.map((t) => (
              <option key={t} value={t}>
                {t === 'ALL' ? 'All types' : t}
              </option>
            ))}
          </select>
          {pagination ? (
            <span className="ml-auto text-[11px] text-muted-foreground" aria-live="polite">
              {pagination.total} delivery attempt{pagination.total === 1 ? '' : 's'} recorded
            </span>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="px-4 pb-4">
        {query.isError ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {query.error instanceof Error ? query.error.message : 'Could not load the delivery log.'}
          </p>
        ) : !rows ? (
          <Skeleton className="h-48 w-full" />
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed px-6 py-8 text-center">
            <Inbox className="mx-auto h-7 w-7 text-muted-foreground/50" aria-hidden />
            <p className="mt-2 text-sm font-medium">No deliveries match this filter</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Every outbound attempt is recorded automatically — clear a filter or check back after the next send.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-[11px] text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">When</th>
                  <th scope="col" className="px-3 py-2 font-medium">Email</th>
                  <th scope="col" className="px-3 py-2 font-medium">Recipient</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Status</th>
                  <th scope="col" className="w-8 px-2 py-2" aria-label="Expand row" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const expanded = expandedId === row.id;
                  const meta = row.metadata ?? {};
                  return (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`border-b last:border-b-0 transition-colors hover:bg-muted/30 ${expanded ? 'bg-muted/20' : ''}`}
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{fmtWhen(row.createdAt)}</td>
                        <td className="max-w-[220px] px-3 py-2">
                          <p className="truncate font-medium" title={row.subject}>{row.subject}</p>
                          <Badge variant="outline" className={`mt-0.5 px-1 py-0 text-[10px] ${chipClass(TYPE_CHIP, row.type)}`}>
                            {row.type}
                          </Badge>
                        </td>
                        <td className="max-w-[200px] px-3 py-2">
                          <span className="block truncate font-mono text-[11px] text-muted-foreground" title={row.recipient}>
                            {row.recipient}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <span className="inline-flex items-center gap-1.5">
                            <StatusIcon status={row.status} />
                            <Badge variant="outline" className={`px-1 py-0 text-[10px] ${chipClass(STATUS_CHIP, row.status)}`}>
                              {row.status}
                            </Badge>
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : row.id)}
                            aria-expanded={expanded}
                            aria-label={expanded ? `Hide details for ${row.subject}` : `Show details for ${row.subject}`}
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {expanded ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className={`border-b bg-muted/10 last:border-b-0 ${expanded ? '' : ''}`}>
                          <td colSpan={5} className="px-3 py-2.5">
                            <div className="space-y-1.5">
                              {row.error ? (
                                <p className="flex items-start gap-1.5 text-rose-600 dark:text-rose-400">
                                  <MailWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                                  {row.error}
                                </p>
                              ) : (
                                <p className="text-muted-foreground">
                                  Delivered{row.sentAt ? ` — confirmed ${fmtWhen(row.sentAt)}` : ''}.
                                </p>
                              )}
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(meta).slice(0, 8).map(([k, v]) => (
                                  <span
                                    key={k}
                                    className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                                    title={`${k}: ${String(v)}`}
                                  >
                                    {k}: {String(v).slice(0, 36)}
                                  </span>
                                ))}
                              </div>
                              {row.user ? (
                                <p className="text-[11px] text-muted-foreground">
                                  Attributed to {row.user.name} ({row.user.role}) — {row.user.email}
                                </p>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 ? (
          <div className="mt-3 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              Page {Math.floor(offset / PAGE_SIZE) + 1} of {pagination.totalPages}
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="h-7 gap-1 px-2 text-xs"
                aria-label="Previous page of deliveries"
              >
                <ChevronLeft className="h-3 w-3" aria-hidden /> Prev
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + PAGE_SIZE >= pagination.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="h-7 gap-1 px-2 text-xs"
                aria-label="Next page of deliveries"
              >
                Next <ChevronRight className="h-3 w-3" aria-hidden />
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
