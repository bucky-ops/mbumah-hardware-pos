/**
 * Shared types for the dashboard tab sub-components.
 *
 * Extracted from `dashboard-tab.tsx` so that both the orchestrator and the
 * extracted sub-components (DashboardStats, RecentTransactions, LowStockAlerts)
 * can import them without creating a circular module dependency.
 */

import type React from 'react';

export type KpiMetricKey = 'revenue' | 'transactions' | 'avgTransaction' | 'lowStock' | 'debt';

export interface KpiDetail {
  metricKey: KpiMetricKey;
  label: string;
  value: number;
  formattedValue: string;
  icon: React.ElementType;
  color: string;
  iconBg: string;
  trend: string;
  trendUp: boolean;
}
