'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  DollarSign,
  Package,
} from 'lucide-react';
import { formatKES } from '@/lib/api';

export interface SupplierPerformanceData {
  supplierId: string;
  supplierName: string;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  rating: number;
  paymentTerms: string;
  metrics: {
    totalOrders: number;
    totalSpend: number;
    onTimeDeliveryRate: number;
    avgFulfillmentDays: number;
    qualityRating: number;
    topProducts: { id: string; name: string; sku: string; totalQty: number; totalValue: number }[];
    outstandingBalance: number;
    lastOrderDate: string | null;
    trend: 'up' | 'down' | 'stable';
    performanceScore: number;
  };
}

const AVATAR_GRADIENTS = [
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-teal-600',
  'from-emerald-500 to-green-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-purple-600',
  'from-red-500 to-rose-600',
  'from-teal-500 to-cyan-600',
  'from-orange-500 to-amber-600',
];

function getAvatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

// formatKES: canonical en-KE KES formatter imported from '@/lib/api' (task 12-d)

function formatDate(date: string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('en-KE', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getDeliveryColor(rate: number): string {
  if (rate >= 90) return 'bg-emerald-500';
  if (rate >= 70) return 'bg-amber-500';
  return 'bg-red-500';
}

function getDeliveryBarColor(rate: number): string {
  if (rate >= 90) return '[&>div]:bg-emerald-500';
  if (rate >= 70) return '[&>div]:bg-amber-500';
  return '[&>div]:bg-red-500';
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'up') return <TrendingUp className="h-4 w-4 text-emerald-600" />;
  if (trend === 'down') return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
}

function StarDisplay({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`h-3.5 w-3.5 ${star <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300 fill-gray-300 dark:text-gray-600 dark:fill-gray-600'}`}
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

interface SupplierPerformanceCardProps {
  data: SupplierPerformanceData;
  onClick?: () => void;
  rank?: number;
}

export function SupplierPerformanceCard({ data, onClick, rank }: SupplierPerformanceCardProps) {
  const { metrics } = data;

  return (
    <Card
      className="bg-white/60 backdrop-blur-xl border border-white/20 hover:shadow-lg hover:-translate-y-0.5 transition-all cursor-pointer group"
      onClick={onClick}
    >
      <CardContent className="p-4">
        {/* Header: Avatar + Name + Rating + Trend */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 ring-2 ring-white/50 shadow-sm">
              <AvatarFallback className={`bg-gradient-to-br ${getAvatarGradient(data.supplierName)} text-white text-sm font-bold`}>
                {data.supplierName.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm group-hover:text-emerald-600 transition-colors">
                  {data.supplierName}
                </h3>
                {rank && (
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-mono">
                    #{rank}
                  </Badge>
                )}
              </div>
              <StarDisplay rating={data.rating} />
            </div>
          </div>
          <TrendIcon trend={metrics.trend} />
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <Package className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Orders</p>
              <Badge className="text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-0 h-5">
                {metrics.totalOrders}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <DollarSign className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Spend</p>
              <p className="text-xs font-semibold">{formatKES(metrics.totalSpend)}</p>
            </div>
          </div>
        </div>

        {/* On-Time Delivery */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">On-Time Delivery</span>
            <span className={`text-xs font-bold ${metrics.onTimeDeliveryRate >= 90 ? 'text-emerald-600' : metrics.onTimeDeliveryRate >= 70 ? 'text-amber-600' : 'text-red-600'}`}>
              {metrics.onTimeDeliveryRate}%
            </span>
          </div>
          <Progress value={metrics.onTimeDeliveryRate} className={`h-2 ${getDeliveryBarColor(metrics.onTimeDeliveryRate)}`} />
          <div className="flex items-center gap-1 mt-1">
            <span className={`w-2 h-2 rounded-full ${getDeliveryColor(metrics.onTimeDeliveryRate)}`} />
            <span className="text-[10px] text-muted-foreground">
              {metrics.onTimeDeliveryRate >= 90 ? 'Excellent' : metrics.onTimeDeliveryRate >= 70 ? 'Good' : 'Needs Improvement'}
            </span>
          </div>
        </div>

        {/* Footer: Outstanding Balance + Last Order */}
        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">
              Last: {formatDate(metrics.lastOrderDate)}
            </span>
          </div>
          {metrics.outstandingBalance > 0 && (
            <Badge className="text-[10px] bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0 h-5">
              {formatKES(metrics.outstandingBalance)} due
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
