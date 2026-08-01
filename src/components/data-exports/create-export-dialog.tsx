'use client';

/**
 * CreateExportDialog — form for generating a new data export.
 *
 * Fields:
 *   • Export type (select with icons) — pre-set when launched from a card.
 *   • Format (CSV / JSON).
 *   • Date range (only shown for TRANSACTIONS / TAX / SALES_SUMMARY).
 *   • Advanced filters (JSON textarea, hidden behind a toggle).
 *
 * On submit, calls `dataExportsApi.create` which synchronously runs the
 * generator and persists the file. On success, fires a toast, invalidates the
 * exports list query, and closes the dialog.
 */

import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ChevronDown,
  ChevronUp,
  Database,
  FileJson,
  FileSpreadsheet,
  Loader2,
  Sparkles,
} from 'lucide-react';

import {
  dataExportsApi,
  type DataExportFormat,
  type DataExportType,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

import { EXPORT_TYPES, type ExportTypeMeta } from './export-type-card';

interface CreateExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  /** Pre-selected export type (e.g. when launched from an ExportTypeCard). */
  presetType?: DataExportType;
  /** Called after a successful creation (e.g. to switch to history view). */
  onCreated?: () => void;
}

const TYPE_TO_META: Record<DataExportType, ExportTypeMeta> = EXPORT_TYPES.reduce(
  (acc, meta) => {
    acc[meta.type] = meta;
    return acc;
  },
  {} as Record<DataExportType, ExportTypeMeta>,
);

const FORMAT_OPTIONS: Array<{
  value: DataExportFormat;
  label: string;
  icon: React.ElementType;
  description: string;
}> = [
  {
    value: 'CSV',
    label: 'CSV',
    icon: FileSpreadsheet,
    description: 'Universal spreadsheet format (Excel, Sheets, Numbers).',
  },
  {
    value: 'JSON',
    label: 'JSON',
    icon: FileJson,
    description: 'Structured key-value pairs for API import / scripts.',
  },
];

export function CreateExportDialog({
  open,
  onOpenChange,
  storeId,
  presetType,
  onCreated,
}: CreateExportDialogProps) {
  const queryClient = useQueryClient();

  // ── Form state ─────────────────────────────────────────────────────────
  const [exportType, setExportType] = useState<DataExportType>(
    presetType ?? 'PRODUCTS',
  );
  const [format, setFormat] = useState<DataExportFormat>('CSV');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [filtersJson, setFiltersJson] = useState<string>('');

  // Event-driven open/close handling — resets state when the dialog closes
  // (avoids the react-hooks/set-state-in-effect rule) and re-applies the
  // preset type when it opens.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      if (presetType) setExportType(presetType);
      // Don't wipe other fields on open — preserve previous filters.
    } else {
      // Reset on close.
      setFormat('CSV');
      setDateFrom('');
      setDateTo('');
      setShowAdvanced(false);
      setFiltersJson('');
      if (!presetType) setExportType('PRODUCTS');
    }
    onOpenChange(next);
  };

  const currentMeta = TYPE_TO_META[exportType];
  const supportsDateRange = currentMeta?.supportsDateRange ?? false;

  // ── Validation ─────────────────────────────────────────────────────────
  const validationError = useMemo<string | null>(() => {
    if (!storeId) return 'No store selected.';
    if (supportsDateRange) {
      // Either both or neither date should be set; if only one is set, error.
      if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
        return 'Please set both date-from and date-to, or leave both blank.';
      }
      if (dateFrom && dateTo) {
        const from = new Date(dateFrom);
        const to = new Date(dateTo);
        if (from.getTime() > to.getTime()) {
          return 'date-from must be earlier than date-to.';
        }
      }
    }
    // Validate advanced filters JSON if provided.
    if (showAdvanced && filtersJson.trim()) {
      try {
        const parsed = JSON.parse(filtersJson);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return 'Filters must be a JSON object (e.g. {"activeOnly": true}).';
        }
      } catch {
        return 'Filters JSON is malformed.';
      }
    }
    return null;
  }, [storeId, supportsDateRange, dateFrom, dateTo, showAdvanced, filtersJson]);

  // ── Create mutation ────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      const filters = (() => {
        if (!showAdvanced || !filtersJson.trim()) return undefined;
        try {
          return JSON.parse(filtersJson) as Record<string, unknown>;
        } catch {
          return undefined;
        }
      })();
      return dataExportsApi.create({
        storeId,
        exportType,
        format,
        dateFrom: supportsDateRange && dateFrom ? dateFrom : undefined,
        dateTo: supportsDateRange && dateTo ? dateTo : undefined,
        filters,
      });
    },
    onSuccess: (res) => {
      const recordCount = res.data?.recordCount ?? 0;
      toast.success('Export generated', {
        description: `${exportType} (${format}) — ${recordCount} record${
          recordCount === 1 ? '' : 's'
        }.`,
      });
      queryClient.invalidateQueries({ queryKey: ['data-exports'] });
      queryClient.invalidateQueries({ queryKey: ['data-exports-stats'] });
      onCreated?.();
      onOpenChange(false);
    },
    onError: (err) => {
      const msg = handleError(err, 'Generate data export');
      toast.error('Export failed', { description: msg });
    },
  });

  const handleSubmit = () => {
    if (validationError) {
      toast.error(validationError);
      return;
    }
    createMutation.mutate();
  };

  const CurrentTypeIcon = currentMeta?.icon ?? Database;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-emerald-500" />
            Generate Data Export
          </DialogTitle>
          <DialogDescription>
            Pick a data type and format. The export runs immediately and is
            stored for 7 days.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-2">
          <div className="space-y-4 px-1 pb-2">
            {/* Export type */}
            <div className="space-y-1.5">
              <Label htmlFor="export-type">Export Type</Label>
              <Select
                value={exportType}
                onValueChange={(v) => setExportType(v as DataExportType)}
              >
                <SelectTrigger id="export-type">
                  <SelectValue placeholder="Select a data type" />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="max-h-72">
                    {EXPORT_TYPES.map((meta) => {
                      const Icon = meta.icon;
                      return (
                        <SelectItem key={meta.type} value={meta.type}>
                          <div className="flex items-center gap-2">
                            <Icon className={`h-4 w-4 ${meta.iconColor}`} />
                            <span className="font-medium">{meta.title}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                  </ScrollArea>
                </SelectContent>
              </Select>
              {currentMeta && (
                <p className="text-xs text-muted-foreground px-1">
                  {currentMeta.description}
                </p>
              )}
            </div>

            {/* Format */}
            <div className="space-y-1.5">
              <Label>Format</Label>
              <div className="grid grid-cols-2 gap-2">
                {FORMAT_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isActive = format === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setFormat(opt.value)}
                      className={`text-left p-3 rounded-lg border transition-all ${
                        isActive
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-500'
                          : 'border-border hover:border-emerald-400 hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Icon
                          className={`h-4 w-4 ${
                            isActive
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-muted-foreground'
                          }`}
                        />
                        <span className="font-medium text-sm">{opt.label}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                        {opt.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date range (conditional) */}
            {supportsDateRange && (
              <div className="space-y-1.5">
                <Label>Date Range (optional)</Label>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      placeholder="From"
                      aria-label="Date from"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">From</p>
                  </div>
                  <div>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      placeholder="To"
                      aria-label="Date to"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">To</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Leave both blank to export all records.
                </p>
              </div>
            )}

            {/* Advanced filters toggle */}
            <div className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/40 transition-colors"
                aria-expanded={showAdvanced}
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  Advanced filters
                </span>
                {showAdvanced ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
              {showAdvanced && (
                <div className="px-3 pb-3 space-y-1.5">
                  <Label htmlFor="filters-json">Filters (JSON)</Label>
                  <Textarea
                    id="filters-json"
                    placeholder='e.g. {"activeOnly": true, "categoryId": "cat_cement"}'
                    value={filtersJson}
                    onChange={(e) => setFiltersJson(e.target.value)}
                    rows={4}
                    className="font-mono text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Optional. Available keys depend on the export type
                    (activeOnly, categoryId, status, customerId, etc.).
                  </p>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="border-t pt-4">
          <div className="flex items-center justify-between w-full gap-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CurrentTypeIcon className={`h-4 w-4 ${currentMeta?.iconColor ?? ''}`} />
              <span>{currentMeta?.title ?? exportType}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={createMutation.isPending}
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Generating…
                  </>
                ) : (
                  'Generate'
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
