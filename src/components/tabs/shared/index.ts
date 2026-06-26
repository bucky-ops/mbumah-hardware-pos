/**
 * Shared tab sub-components — reusable building blocks extracted from the
 * oversized tab files (dashboard, financial, reports, etc.).
 *
 * These are intentionally framework-agnostic and presentational: they receive
 * data and callbacks as props and emit user-intent events via callbacks.
 */

export { StatCard, type StatCardProps } from './StatCard';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { LoadingSkeleton, type LoadingSkeletonProps } from './LoadingSkeleton';
export { DataTable, type DataTableColumn, type DataTableProps } from './DataTable';
export { Toolbar, type ToolbarProps } from './Toolbar';
