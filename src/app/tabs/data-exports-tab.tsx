'use client';

/**
 * Data Exports Tab — unified export center for the POS.
 *
 * Layout:
 *   1. Header with title + "New Export" button
 *   2. Stats cards row (ExportsStatsCards)
 *   3. "Export Types" grid — 10 cards (2/3/4 cols responsive) with stagger
 *   4. "Export History" table with filter chips
 *
 * Data is fetched via tanstack-query. Clicking a card (or the "New Export"
 * button) opens the CreateExportDialog pre-filled with that type.
 */

import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Database, Loader2, Plus, RefreshCw } from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  dataExportsApi,
  type DataExportItem,
  type DataExportType,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import {
  EXPORT_TYPES,
  ExportTypeCard,
} from '@/components/data-exports/export-type-card';
import { CreateExportDialog } from '@/components/data-exports/create-export-dialog';
import { ExportsHistoryTable } from '@/components/data-exports/exports-history-table';
import { ExportsStatsCards } from '@/components/data-exports/exports-stats-cards';

export function DataExportsTab() {
  const { currentStoreId } = useAppStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [presetType, setPresetType] = useState<DataExportType | undefined>(
    undefined,
  );

  // ── Data: stats ────────────────────────────────────────────────────────
  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ['data-exports-stats', currentStoreId],
    queryFn: async () => {
      const res = await dataExportsApi.stats(currentStoreId);
      return res.data;
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (statsError) {
      const msg = handleError(statsError, 'Load export stats');
      toast.error('Failed to load stats', { description: msg });
    }
  }, [statsError]);

  // ── Data: exports list ─────────────────────────────────────────────────
  const {
    data: exports,
    isLoading: exportsLoading,
    error: exportsError,
    refetch: refetchExports,
    isFetching,
  } = useQuery({
    queryKey: ['data-exports', currentStoreId],
    queryFn: async () => {
      const res = await dataExportsApi.list({ storeId: currentStoreId });
      return res.data ?? [];
    },
    staleTime: 15_000,
  });

  useEffect(() => {
    if (exportsError) {
      const msg = handleError(exportsError, 'Load export history');
      toast.error('Failed to load export history', { description: msg });
    }
  }, [exportsError]);

  // ── Handlers ──────────────────────────────────────────────────────────
  const handleRefresh = () => {
    refetchExports();
    refetchStats();
  };

  const handleGenerateFromCard = (type: DataExportType) => {
    setPresetType(type);
    setCreateOpen(true);
  };

  const handleNewExport = () => {
    setPresetType(undefined);
    setCreateOpen(true);
  };

  const handleOpenChange = (next: boolean) => {
    setCreateOpen(next);
    if (!next) {
      // Defer clearing presetType so the dialog doesn't visually "flicker"
      // back to the default type while it's animating closed.
      setTimeout(() => setPresetType(undefined), 100);
    }
  };

  // Safely coerce the exports list (defensive: API may return non-array on
  // partial failure).
  const exportsList: DataExportItem[] = Array.isArray(exports) ? exports : [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6 text-emerald-500" />
            Data Exports
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Generate CSV / JSON exports of your store&apos;s data — products,
            transactions, customers, debt, inventory, and more. Files are kept
            for 7 days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleNewExport}
            className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white"
          >
            <Plus className="h-4 w-4 mr-1" />
            New Export
          </Button>
        </div>
      </div>

      {/* Stats */}
      <ExportsStatsCards stats={stats} isLoading={statsLoading} />

      {/* Export Types grid */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Export Types</h2>
          <span className="text-xs text-muted-foreground">
            {EXPORT_TYPES.length} data sources available
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {EXPORT_TYPES.map((meta, idx) => (
            <ExportTypeCard
              key={meta.type}
              meta={meta}
              index={idx}
              onGenerate={handleGenerateFromCard}
            />
          ))}
        </div>
      </section>

      {/* Export History */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Export History</h2>
          <span className="text-xs text-muted-foreground">
            {exportsList.length} export{exportsList.length === 1 ? '' : 's'} ·
            showing most recent first
          </span>
        </div>
        {exportsLoading ? (
          <div className="rounded-lg border bg-card p-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <ExportsHistoryTable exports={exportsList} />
        )}
      </section>

      {/* Floating loading indicator when refreshing in background */}
      {isFetching && !exportsLoading && (
        <div className="fixed bottom-4 right-4 bg-background/90 backdrop-blur-sm border rounded-full px-3 py-1.5 text-xs text-muted-foreground shadow-md flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" />
          Syncing…
        </div>
      )}

      {/* Create-export dialog */}
      <CreateExportDialog
        open={createOpen}
        onOpenChange={handleOpenChange}
        storeId={currentStoreId}
        presetType={presetType}
      />
    </div>
  );
}

export default DataExportsTab;
