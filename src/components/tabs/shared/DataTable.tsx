'use client';

/**
 * DataTable — generic table wrapper with loading and empty states.
 *
 * Reduces the boilerplate of `isLoading ? <Skeleton /> : data.length === 0 ?
 * <Empty /> : <Table>...</Table>` that is repeated across every list view
 * (journal entries, accounts, expenses, products, customers, etc.).
 */

import React from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { EmptyState, type EmptyStateProps } from './EmptyState';
import { LoadingSkeleton } from './LoadingSkeleton';

export interface DataTableColumn<T> {
  /** Unique key for React reconciliation */
  key: string;
  /** Column header text */
  header: React.ReactNode;
  /** Cell renderer */
  render: (row: T, index: number) => React.ReactNode;
  /** Optional className for both header and cells in this column */
  className?: string;
  /** Header-only className (e.g. "text-right") */
  headerClassName?: string;
  /** Cell-only className */
  cellClassName?: string;
  /** Optional width hint, e.g. "w-[40px]" */
  width?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  loading?: boolean;
  /** Number of skeleton rows to show while loading */
  loadingRows?: number;
  /** Empty state configuration */
  emptyState?: Pick<EmptyStateProps, 'icon' | 'title' | 'description' | 'actionLabel' | 'onAction'>;
  /** Click handler for a row */
  onRowClick?: (row: T) => void;
  /** Custom row key extractor */
  rowKey: (row: T, index: number) => string;
  /** Extra classes for the wrapping container */
  className?: string;
  /** Extra classes for the table body rows */
  rowClassName?: (row: T, index: number) => string | undefined;
  /** Render additional rows below a given row (e.g. expandable detail rows) */
  renderExpandedRow?: (row: T, index: number) => React.ReactNode;
  /** Whether the row at index should render its expanded content */
  isRowExpanded?: (row: T, index: number) => boolean;
  /** Wrap the table in a horizontally scrollable container (default true) */
  scrollable?: boolean;
}

export function DataTable<T>({
  columns,
  data,
  loading = false,
  loadingRows = 5,
  emptyState,
  onRowClick,
  rowKey,
  className,
  rowClassName,
  renderExpandedRow,
  isRowExpanded,
  scrollable = true,
}: DataTableProps<T>) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead
              key={col.key}
              className={cn(col.width, col.className, col.headerClassName)}
            >
              {col.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((row, index) => {
          const expanded = isRowExpanded ? isRowExpanded(row, index) : false;
          return (
            <React.Fragment key={rowKey(row, index)}>
              <TableRow
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  onRowClick && 'cursor-pointer hover:bg-muted/50 transition-colors',
                  rowClassName?.(row, index),
                )}
              >
                {columns.map((col) => (
                  <TableCell
                    key={col.key}
                    className={cn(col.className, col.cellClassName)}
                  >
                    {col.render(row, index)}
                  </TableCell>
                ))}
              </TableRow>
              {expanded && renderExpandedRow && renderExpandedRow(row, index)}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );

  return (
    <div className={className}>
      {loading ? (
        <LoadingSkeleton variant="rows" count={loadingRows} />
      ) : data.length === 0 ? (
        <EmptyState
          icon={emptyState?.icon}
          title={emptyState?.title ?? 'No records found'}
          description={emptyState?.description}
          actionLabel={emptyState?.actionLabel}
          onAction={emptyState?.onAction}
        />
      ) : scrollable ? (
        <div className="overflow-x-auto">{table}</div>
      ) : (
        table
      )}
    </div>
  );
}

export default DataTable;
