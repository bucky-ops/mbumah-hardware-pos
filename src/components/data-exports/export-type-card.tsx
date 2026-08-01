'use client';

/**
 * ExportTypeCard — a single tile in the "Export Types" grid.
 *
 * Each card shows an icon (colour-coded per export type), a title, a short
 * description, and a "Generate" button that opens the create-export dialog
 * pre-filled with this type. Cards stagger in via the `stagger-N` CSS classes.
 */

import React from 'react';
import {
  Award,
  Boxes,
  CircleDollarSign,
  Package,
  Receipt,
  TrendingUp,
  Truck,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type { DataExportType } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface ExportTypeMeta {
  type: DataExportType;
  title: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind gradient stops, e.g. 'from-emerald-500 to-emerald-600'. */
  gradient: string;
  /** Text colour for the icon when not on the gradient chip, e.g. 'text-emerald-600'. */
  iconColor: string;
  /** Subtle background tint for the card hover state. */
  hoverRing: string;
  /** Whether this export type supports a date-range filter. */
  supportsDateRange: boolean;
}

export const EXPORT_TYPES: ExportTypeMeta[] = [
  {
    type: 'PRODUCTS',
    title: 'Products',
    description: 'Catalog with prices, stock, categories, eTIMS codes.',
    icon: Package,
    gradient: 'from-emerald-500 to-emerald-600',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
    hoverRing: 'hover:ring-emerald-300/60 dark:hover:ring-emerald-700/50',
    supportsDateRange: false,
  },
  {
    type: 'CUSTOMERS',
    title: 'Customers',
    description: 'Customer directory with debt, loyalty, contact info.',
    icon: Users,
    gradient: 'from-cyan-500 to-cyan-600',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
    hoverRing: 'hover:ring-cyan-300/60 dark:hover:ring-cyan-700/50',
    supportsDateRange: false,
  },
  {
    type: 'TRANSACTIONS',
    title: 'Transactions',
    description: 'Sales receipts with totals, payments, cashier, items.',
    icon: Receipt,
    gradient: 'from-teal-500 to-teal-600',
    iconColor: 'text-teal-600 dark:text-teal-400',
    hoverRing: 'hover:ring-teal-300/60 dark:hover:ring-teal-700/50',
    supportsDateRange: true,
  },
  {
    type: 'DEBT',
    title: 'Debt Ledger',
    description: 'Outstanding debts with customer, balance, aging bucket.',
    icon: CircleDollarSign,
    gradient: 'from-rose-500 to-rose-600',
    iconColor: 'text-rose-600 dark:text-rose-400',
    hoverRing: 'hover:ring-rose-300/60 dark:hover:ring-rose-700/50',
    supportsDateRange: false,
  },
  {
    type: 'INVENTORY',
    title: 'Inventory',
    description: 'Stock levels, reorder points, bin locations, stock value.',
    icon: Boxes,
    gradient: 'from-amber-500 to-amber-600',
    iconColor: 'text-amber-600 dark:text-amber-400',
    hoverRing: 'hover:ring-amber-300/60 dark:hover:ring-amber-700/50',
    supportsDateRange: false,
  },
  {
    type: 'EMPLOYEES',
    title: 'Employees',
    description: 'Staff directory with role, salary, allowances, status.',
    icon: UserCog,
    gradient: 'from-violet-500 to-violet-600',
    iconColor: 'text-violet-600 dark:text-violet-400',
    hoverRing: 'hover:ring-violet-300/60 dark:hover:ring-violet-700/50',
    supportsDateRange: false,
  },
  {
    type: 'SUPPLIERS',
    title: 'Suppliers',
    description: 'Supplier list with contact, payment terms, rating.',
    icon: Truck,
    gradient: 'from-orange-500 to-orange-600',
    iconColor: 'text-orange-600 dark:text-orange-400',
    hoverRing: 'hover:ring-orange-300/60 dark:hover:ring-orange-700/50',
    supportsDateRange: false,
  },
  {
    type: 'LOYALTY',
    title: 'Loyalty',
    description: 'Customer loyalty points, tier, lifetime totals.',
    icon: Award,
    gradient: 'from-purple-500 to-purple-600',
    iconColor: 'text-purple-600 dark:text-purple-400',
    hoverRing: 'hover:ring-purple-300/60 dark:hover:ring-purple-700/50',
    supportsDateRange: false,
  },
  {
    type: 'TAX',
    title: 'Tax / VAT',
    description: 'VAT breakdown per transaction for KRA returns.',
    icon: Receipt,
    gradient: 'from-blue-500 to-blue-600',
    iconColor: 'text-blue-600 dark:text-blue-400',
    hoverRing: 'hover:ring-blue-300/60 dark:hover:ring-blue-700/50',
    supportsDateRange: true,
  },
  {
    type: 'SALES_SUMMARY',
    title: 'Sales Summary',
    description: 'Daily aggregated revenue, tax, payment-method breakdown.',
    icon: TrendingUp,
    gradient: 'from-green-500 to-green-600',
    iconColor: 'text-green-600 dark:text-green-400',
    hoverRing: 'hover:ring-green-300/60 dark:hover:ring-green-700/50',
    supportsDateRange: true,
  },
];

// Static stagger class lookup so Tailwind's JIT can statically detect them.
const STAGGER_CLASSES = [
  'stagger-1',
  'stagger-2',
  'stagger-3',
  'stagger-4',
  'stagger-5',
  'stagger-6',
  'stagger-1',
  'stagger-2',
  'stagger-3',
  'stagger-4',
];

interface ExportTypeCardProps {
  meta: ExportTypeMeta;
  /** Position in the grid (0-indexed) — used to compute the stagger delay. */
  index: number;
  onGenerate: (type: DataExportType) => void;
  disabled?: boolean;
}

export function ExportTypeCard({
  meta,
  index,
  onGenerate,
  disabled,
}: ExportTypeCardProps) {
  const Icon = meta.icon;
  const staggerClass = STAGGER_CLASSES[index % STAGGER_CLASSES.length];

  return (
    <Card
      className={`glass-card ${staggerClass} ${meta.hoverRing} hover:shadow-lg hover:-translate-y-0.5 transition-all ring-1 ring-transparent`}
    >
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div
            className={`p-2.5 rounded-xl bg-gradient-to-br ${meta.gradient} text-white shadow-sm shrink-0`}
          >
            <Icon className="h-5 w-5" />
          </div>
          {meta.supportsDateRange && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
              Date range
            </span>
          )}
        </div>
        <div>
          <h3 className="font-semibold text-base leading-tight">{meta.title}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-snug">
            {meta.description}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full mt-1"
          onClick={() => onGenerate(meta.type)}
          disabled={disabled}
        >
          Generate
        </Button>
      </CardContent>
    </Card>
  );
}
