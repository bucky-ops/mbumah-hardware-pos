'use client';

/**
 * ExportsHistoryTable — table of past data exports with filter chips and
 * per-row Download / Delete actions. Wraps the existing shadcn/ui Table
 * components and the shared EmptyState.
 *
 * Filter chips: All, Completed, Failed, Processing (PENDING + PROCESSING).
 */

import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Inbox,
  Loader2,
  Trash2,
  XCircle,
} from 'lucide-react';

import {
  dataExportsApi,
  formatDateTime,
  type DataExportItem,
  type DataExportStatus,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { EXPORT_TYPES } from './export-type-card';

interface ExportsHistoryTableProps {
  exports: DataExportItem[];
  isLoading?: boolean;
  /** Optional filter override — if provided, the internal chips are hidden. */
  externalFilter?: DataExportStatus | 'all' | 'processing';
}

type FilterKey = 'all' | 'completed' | 'failed' | 'processing';

const FILTER_CHIPS: Array<{ key: FilterKey; label: string; color: string }> = [
  { key: 'all', label: 'All', color: 'emerald' },
  { key: 'completed', label: 'Completed', color: 'green' },
  { key: 'failed', label: 'Failed', color: 'rose' },
  { key: 'processing', label: 'Processing', color: 'amber' },
];

const CHIP_ACTIVE: Record<string, string> = {
  emerald: 'bg-emerald-500 text-white border-emerald-600',
  green: 'bg-green-500 text-white border-green-600',
  rose: 'bg-rose-500 text-white border-rose-600',
  amber: 'bg-amber-500 text-white border-amber-600',
};

const CHIP_IDLE: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900',
  green: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-300 dark:border-green-900',
  rose: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-900',
  amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900',
};

const TYPE_META: Record<string, { title: string; color: string }> =
  EXPORT_TYPES.reduce(
    (acc, meta) => {
      acc[meta.type] = {
        title: meta.title,
        color: meta.iconColor,
      };
      return acc;
    },
    {} as Record<string, { title: string; color: string }>,
  );

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const idx = Math.min(i, units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatDateRange(from: string | null, to: string | null): string {
  if (!from && !to) return '—';
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-KE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  if (from && to) return `${fmt(from)} → ${fmt(to)}`;
  if (from) return `From ${fmt(from)}`;
  return `Until ${fmt(to as string)}`;
}

function StatusBadge({ status }: { status: DataExportStatus }) {
  switch (status) {
    case 'COMPLETED':
      return (
        <Badge className="bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300 hover:bg-green-100">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completed
        </Badge>
      );
    case 'FAILED':
      return (
        <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 hover:bg-rose-100">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case 'PROCESSING':
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-100">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Processing
        </Badge>
      );
    case 'PENDING':
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 hover:bg-amber-100">
          <Clock className="h-3 w-3 mr-1" />
          Pending
        </Badge>
      );
    case 'EXPIRED':
      return (
        <Badge variant="secondary">
          <Clock className="h-3 w-3 mr-1" />
          Expired
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function TypeBadge({ type }: { type: string }) {
  const meta = TYPE_META[type];
  if (!meta) {
    return <Badge variant="outline">{type}</Badge>;
  }
  return (
    <Badge variant="outline" className={`border-current/30 ${meta.color}`}>
      {meta.title}
    </Badge>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function ExportsHistoryTable({
  exports,
  isLoading,
  externalFilter,
}: ExportsHistoryTableProps) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [deleteTarget, setDeleteTarget] = useState<DataExportItem | null>(null);

  // Effective filter — allow parent override (e.g. always show 'all').
  const effectiveFilter: FilterKey = externalFilter ?? filter;

  const filtered = useMemo(() => {
    if (!Array.isArray(exports)) return [];
    switch (effectiveFilter) {
      case 'completed':
        return exports.filter((e) => e.status === 'COMPLETED');
      case 'failed':
        return exports.filter((e) => e.status === 'FAILED');
      case 'processing':
        return exports.filter(
          (e) => e.status === 'PROCESSING' || e.status === 'PENDING',
        );
      case 'all':
      default:
        return exports;
    }
  }, [exports, effectiveFilter]);

  const filterCounts = useMemo(() => {
    if (!Array.isArray(exports)) {
      return { all: 0, completed: 0, failed: 0, processing: 0 };
    }
    return {
      all: exports.length,
      completed: exports.filter((e) => e.status === 'COMPLETED').length,
      failed: exports.filter((e) => e.status === 'FAILED').length,
      processing: exports.filter(
        (e) => e.status === 'PROCESSING' || e.status === 'PENDING',
      ).length,
    };
  }, [exports]);

  // ── Download mutation ──────────────────────────────────────────────────
  const downloadMutation = useMutation({
    mutationFn: async (item: DataExportItem) => {
      await dataExportsApi.download(item.id, item.exportType);
      return item;
    },
    onSuccess: (item) => {
      toast.success('Download started', {
        description: `${item.exportType} (${item.format}) — ${item.recordCount} records.`,
      });
    },
    onError: (err) => {
      const msg = handleError(err, 'Download export');
      toast.error('Download failed', { description: msg });
    },
  });

  // ── Delete mutation ────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => dataExportsApi.delete(id),
    onSuccess: () => {
      toast.success('Export deleted');
      queryClient.invalidateQueries({ queryKey: ['data-exports'] });
      queryClient.invalidateQueries({ queryKey: ['data-exports-stats'] });
      setDeleteTarget(null);
    },
    onError: (err) => {
      const msg = handleError(err, 'Delete export');
      toast.error('Delete failed', { description: msg });
    },
  });

  return (
    <div className="space-y-3">
      {/* Filter chips (hidden if parent forces a filter) */}
      {!externalFilter && (
        <div className="flex flex-wrap items-center gap-2">
          {FILTER_CHIPS.map((chip) => {
            const isActive = effectiveFilter === chip.key;
            const count = filterCounts[chip.key] ?? 0;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setFilter(chip.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  isActive ? CHIP_ACTIVE[chip.color] : CHIP_IDLE[chip.color]
                }`}
              >
                {chip.label}
                <span
                  className={`ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-semibold ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-background text-muted-foreground'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="rounded-lg border bg-card">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">
              {effectiveFilter === 'all'
                ? 'No exports generated yet. Pick a type above to get started.'
                : `No ${effectiveFilter} exports.`}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Type</TableHead>
                <TableHead className="w-[80px]">Format</TableHead>
                <TableHead className="w-[200px]">Date Range</TableHead>
                <TableHead className="text-right w-[90px]">Records</TableHead>
                <TableHead className="text-right w-[100px]">Size</TableHead>
                <TableHead className="w-[130px]">Status</TableHead>
                <TableHead className="w-[160px]">Created</TableHead>
                <TableHead className="text-right w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <TypeBadge type={item.exportType} />
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs font-medium">
                      {item.format}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateRange(item.dateFrom, item.dateTo)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.recordCount.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs">
                    {item.fileSizeBytes > 0 ? formatBytes(item.fileSizeBytes) : '—'}
                  </TableCell>
                  <TableCell>
                    {item.status === 'FAILED' && item.errorMessage ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-help">
                              <StatusBadge status={item.status} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-sm">
                            <span className="flex items-start gap-1.5 text-xs">
                              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                              <span>{item.errorMessage}</span>
                            </span>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <StatusBadge status={item.status} />
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDateTime(item.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={() => downloadMutation.mutate(item)}
                        disabled={
                          item.status !== 'COMPLETED' ||
                          downloadMutation.isPending
                        }
                        title="Download"
                      >
                        {downloadMutation.isPending &&
                        downloadMutation.variables?.id === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        <span className="sr-only">Download</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        onClick={() => setDeleteTarget(item)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="sr-only">Delete</span>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Delete confirmation */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this export?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  This will permanently remove the{' '}
                  <span className="font-semibold">
                    {deleteTarget.exportType} ({deleteTarget.format})
                  </span>{' '}
                  export and its file. This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
              disabled={deleteMutation.isPending}
              className="bg-rose-500 hover:bg-rose-600 text-white"
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
