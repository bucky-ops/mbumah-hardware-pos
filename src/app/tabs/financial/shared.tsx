'use client';

/**
 * Shared helpers for the financial tab.
 *
 * Extracted from `financial-tab.tsx` so that both the orchestrator and the
 * extracted sub-components (FinancialOverview, JournalEntriesTable,
 * AccountsList) can import them without creating a circular module dependency.
 */

import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

// --- Date helpers -----------------------------------------------------------

export function getDatePreset(preset: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().split('T')[0];
  let from: string;
  switch (preset) {
    case 'today':
      from = to;
      break;
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      from = d.toISOString().split('T')[0];
      break;
    }
    case 'month':
      from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      break;
    case 'quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3;
      from = `${now.getFullYear()}-${String(qMonth + 1).padStart(2, '0')}-01`;
      break;
    }
    case 'year':
      from = `${now.getFullYear()}-01-01`;
      break;
    default:
      from = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  }
  return { from, to };
}

export function formatRangeLabel(from: string, to: string): string {
  const f = new Date(from);
  const t = new Date(to);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${f.toLocaleDateString('en-US', opts)} – ${t.toLocaleDateString('en-US', opts)}`;
}

// --- AnimatedCounter --------------------------------------------------------

export function AnimatedCounter({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(value);
  const rafRef = useRef<number>(0);

  React.useEffect(() => {
    const start = prevRef.current;
    const end = value;
    const startTime = Date.now();
    const duration = 800;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    prevRef.current = value;
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <>{prefix}{display.toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}{suffix}</>;
}

// --- Chart of Accounts visual config ---------------------------------------

export const accountTypeColors: Record<string, { bg: string; text: string; dot: string; border: string; icon: string; gradient: string; headerBg: string }> = {
  ASSET: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    text: 'text-green-700 dark:text-green-400',
    dot: 'bg-green-500',
    border: 'border-l-green-500',
    icon: '💰',
    gradient: 'from-green-500/10 to-green-600/5',
    headerBg: 'bg-gradient-to-r from-green-100 to-green-50 dark:from-green-900/30 dark:to-green-800/10',
  },
  LIABILITY: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-700 dark:text-red-400',
    dot: 'bg-red-500',
    border: 'border-l-red-500',
    icon: '📋',
    gradient: 'from-red-500/10 to-orange-500/5',
    headerBg: 'bg-gradient-to-r from-red-100 to-orange-50 dark:from-red-900/30 dark:to-orange-800/10',
  },
  EQUITY: {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    text: 'text-purple-700 dark:text-purple-400',
    dot: 'bg-purple-500',
    border: 'border-l-purple-500',
    icon: '🏦',
    gradient: 'from-purple-500/10 to-purple-600/5',
    headerBg: 'bg-gradient-to-r from-purple-100 to-purple-50 dark:from-purple-900/30 dark:to-purple-800/10',
  },
  REVENUE: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    text: 'text-blue-700 dark:text-blue-400',
    dot: 'bg-blue-500',
    border: 'border-l-blue-500',
    icon: '📈',
    gradient: 'from-blue-500/10 to-blue-600/5',
    headerBg: 'bg-gradient-to-r from-blue-100 to-blue-50 dark:from-blue-900/30 dark:to-blue-800/10',
  },
  EXPENSE: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
    border: 'border-l-amber-500',
    icon: '📉',
    gradient: 'from-amber-500/10 to-amber-600/5',
    headerBg: 'bg-gradient-to-r from-amber-100 to-amber-50 dark:from-amber-900/30 dark:to-amber-800/10',
  },
};

export const accountTypeLabels: Record<string, string> = {
  ASSET: 'Assets',
  LIABILITY: 'Liabilities',
  EQUITY: 'Equity',
  REVENUE: 'Revenue',
  EXPENSE: 'Expenses',
};

export const accountTypeOrder = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'];

// --- Export / print utilities ----------------------------------------------

export function exportToCSV(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) {
    toast.error('No data to export');
    return;
  }
  const headers = Object.keys(data[0]);
  const csvRows = [
    headers.join(','),
    ...data.map(row => headers.map(h => {
      const val = row[h];
      const str = String(val ?? '');
      return str.includes(',') ? `"${str}"` : str;
    }).join(',')),
  ];
  const csvString = csvRows.join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${data.length} records to CSV`);
}

export function printReport() {
  window.print();
}

// Re-export React hooks so consumers can destructure from a single module if desired
export { useEffect, useRef, useState };
