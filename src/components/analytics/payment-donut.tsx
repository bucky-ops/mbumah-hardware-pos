'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts';
import { CreditCard, Wallet } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatKES } from '@/lib/api';
import {
  PAYMENT_METHOD_COLORS,
  PAYMENT_METHOD_LABELS,
  paymentMethodColor,
  paymentMethodLabel,
} from '@/lib/analytics-utils';

export interface PaymentMethodRow {
  method: string;
  count: number;
  amount: number;
  percentage: number;
}

export interface PaymentBreakdownData {
  period: string;
  methods: PaymentMethodRow[];
  totalRevenue: number;
  totalCount: number;
}

interface PaymentDonutProps {
  data: PaymentBreakdownData | null;
  loading?: boolean;
  className?: string;
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: PaymentMethodRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm p-3 shadow-lg text-xs space-y-1">
      <p className="font-semibold flex items-center gap-1.5">
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: paymentMethodColor(row.method) }}
        />
        {paymentMethodLabel(row.method)}
      </p>
      <div className="grid grid-cols-2 gap-x-3">
        <span className="text-muted-foreground">Amount:</span>
        <span className="font-semibold tabular-nums text-right">{formatKES(row.amount)}</span>
        <span className="text-muted-foreground">Count:</span>
        <span className="font-semibold tabular-nums text-right">{row.count.toLocaleString('en-KE')}</span>
        <span className="text-muted-foreground">Share:</span>
        <span className="font-semibold tabular-nums text-right">{row.percentage.toFixed(1)}%</span>
      </div>
    </div>
  );
}

export function PaymentDonut({ data, loading, className }: PaymentDonutProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const rows = useMemo(() => {
    if (!data?.methods) return [];
    // Filter out zero-amount methods so the donut doesn't show empty slices.
    return data.methods.filter((m) => m.amount > 0);
  }, [data]);

  const totalRevenue = data?.totalRevenue ?? 0;
  const centerValue = activeIndex !== null && rows[activeIndex]
    ? rows[activeIndex].amount
    : totalRevenue;
  const centerLabel = activeIndex !== null && rows[activeIndex]
    ? paymentMethodLabel(rows[activeIndex].method)
    : 'Total Revenue';

  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="h-4 w-4 text-amber-500" />
          Payment Methods
        </CardTitle>
        <CardDescription>Revenue distribution by payment type</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {loading ? (
          <div className="flex flex-col items-center gap-4">
            <Skeleton className="h-[200px] w-[200px] rounded-full" />
            <div className="w-full space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          </div>
        ) : !data || rows.length === 0 ? (
          <div className="flex h-[300px] flex-col items-center justify-center text-center gap-2 text-muted-foreground">
            <Wallet className="h-10 w-10 opacity-20" />
            <p className="text-sm font-medium">No payments recorded</p>
            <p className="text-xs">Payment method breakdown will appear here.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className="relative h-[200px] w-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={rows}
                    dataKey="amount"
                    nameKey="method"
                    cx="50%"
                    cy="50%"
                    innerRadius={62}
                    outerRadius={92}
                    paddingAngle={rows.length > 1 ? 2 : 0}
                    isAnimationActive
                    animationDuration={700}
                    onMouseEnter={(_, i) => setActiveIndex(i)}
                    onMouseLeave={() => setActiveIndex(null)}
                  >
                    {rows.map((r) => (
                      <Cell
                        key={r.method}
                        fill={paymentMethodColor(r.method)}
                        stroke="var(--background)"
                        strokeWidth={2}
                        opacity={activeIndex === null || rows.indexOf(r) === activeIndex ? 1 : 0.45}
                      />
                    ))}
                  </Pie>
                  <RechartsTooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <motion.p
                  key={centerLabel}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-[10px] uppercase tracking-wide text-muted-foreground"
                >
                  {centerLabel}
                </motion.p>
                <motion.p
                  key={centerValue}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-base font-bold tabular-nums px-3"
                >
                  {formatKES(centerValue)}
                </motion.p>
              </div>
            </div>

            <div className="w-full space-y-1.5">
              {rows.map((r, i) => (
                <motion.button
                  type="button"
                  key={r.method}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(null)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                    activeIndex === i ? 'bg-accent/60' : 'hover:bg-accent/30',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: paymentMethodColor(r.method) }}
                  />
                  <span className="font-medium flex-1 text-left">
                    {PAYMENT_METHOD_LABELS[r.method] || paymentMethodLabel(r.method)}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {r.count.toLocaleString('en-KE')}
                  </span>
                  <span className="font-semibold tabular-nums w-24 text-right">
                    {formatKES(r.amount)}
                  </span>
                  <span
                    className="w-10 text-right tabular-nums text-[11px]"
                    style={{ color: paymentMethodColor(r.method) }}
                  >
                    {r.percentage.toFixed(1)}%
                  </span>
                </motion.button>
              ))}
              {/* Render zero-amount methods as faded rows so users see the full set */}
              {data.methods
                .filter((m) => m.amount === 0)
                .map((r) => (
                  <div
                    key={r.method}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs opacity-40"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0 border"
                      style={{
                        borderColor: PAYMENT_METHOD_COLORS[r.method] || '#94a3b8',
                      }}
                    />
                    <span className="font-medium flex-1">
                      {PAYMENT_METHOD_LABELS[r.method] || paymentMethodLabel(r.method)}
                    </span>
                    <span className="text-muted-foreground tabular-nums">0</span>
                    <span className="font-semibold tabular-nums w-24 text-right">
                      {formatKES(0)}
                    </span>
                    <span className="w-10 text-right tabular-nums text-[11px] text-muted-foreground">
                      0.0%
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default PaymentDonut;
