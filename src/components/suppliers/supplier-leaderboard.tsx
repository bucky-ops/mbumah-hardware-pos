'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  ArrowUpDown, Trophy, Medal,
} from 'lucide-react';
import type { SupplierPerformanceData } from './supplier-performance-card';
import { formatKES } from '@/lib/api';

type SortField = 'rank' | 'name' | 'rating' | 'orders' | 'spend' | 'onTime' | 'score';
type SortDirection = 'asc' | 'desc';

interface SupplierLeaderboardProps {
  data: SupplierPerformanceData[];
  onSupplierClick?: (supplierId: string) => void;
}

// formatKES: canonical en-KE KES formatter imported from '@/lib/api' (task 12-d)

function getRankIcon(rank: number) {
  if (rank === 1) return <Trophy className="h-4 w-4 text-amber-500" />;
  if (rank === 2) return <Medal className="h-4 w-4 text-gray-400" />;
  if (rank === 3) return <Medal className="h-4 w-4 text-amber-700" />;
  return <span className="text-xs font-mono text-muted-foreground">{rank}</span>;
}

function getScoreBadge(score: number) {
  if (score >= 4) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  if (score >= 3) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
}

function SortableHeader({ field, children, onSort }: { field: SortField; children: React.ReactNode; onSort: (field: SortField) => void }) {
  return (
    <TableHead
      className="cursor-pointer hover:text-foreground transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className="h-3 w-3" />
      </div>
    </TableHead>
  );
}

export function SupplierLeaderboard({ data, onSupplierClick }: SupplierLeaderboardProps) {
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'name' ? 'asc' : 'desc');
    }
  };

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (sortField) {
        case 'rank':
          aVal = a.metrics.performanceScore;
          bVal = b.metrics.performanceScore;
          break;
        case 'name':
          aVal = a.supplierName.toLowerCase();
          bVal = b.supplierName.toLowerCase();
          break;
        case 'rating':
          aVal = a.rating;
          bVal = b.rating;
          break;
        case 'orders':
          aVal = a.metrics.totalOrders;
          bVal = b.metrics.totalOrders;
          break;
        case 'spend':
          aVal = a.metrics.totalSpend;
          bVal = b.metrics.totalSpend;
          break;
        case 'onTime':
          aVal = a.metrics.onTimeDeliveryRate;
          bVal = b.metrics.onTimeDeliveryRate;
          break;
        case 'score':
          aVal = a.metrics.performanceScore;
          bVal = b.metrics.performanceScore;
          break;
        default:
          aVal = 0;
          bVal = 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [data, sortField, sortDirection]);

  return (
    <Card className="bg-white/60 backdrop-blur-xl border border-white/20">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          Supplier Performance Leaderboard
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-96 overflow-auto custom-scrollbar">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHeader field="rank" onSort={handleSort}>Rank</SortableHeader>
                <SortableHeader field="name" onSort={handleSort}>Name</SortableHeader>
                <SortableHeader field="rating" onSort={handleSort}>Rating</SortableHeader>
                <SortableHeader field="orders" onSort={handleSort}>Orders</SortableHeader>
                <SortableHeader field="spend" onSort={handleSort}>Spend</SortableHeader>
                <SortableHeader field="onTime" onSort={handleSort}>On-Time %</SortableHeader>
                <SortableHeader field="score" onSort={handleSort}>Score</SortableHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedData.map((supplier, index) => {
                const rank = index + 1;
                return (
                  <TableRow
                    key={supplier.supplierId}
                    className="cursor-pointer hover:bg-emerald-50/50 dark:hover:bg-emerald-900/10 transition-colors"
                    onClick={() => onSupplierClick?.(supplier.supplierId)}
                  >
                    <TableCell>
                      <div className="flex items-center justify-center">
                        {getRankIcon(rank)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-sm">{supplier.supplierName}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <svg
                            key={star}
                            className={`h-3 w-3 ${star <= supplier.rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300 fill-gray-300 dark:text-gray-600 dark:fill-gray-600'}`}
                            viewBox="0 0 20 20"
                          >
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                          </svg>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs h-5">
                        {supplier.metrics.totalOrders}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {formatKES(supplier.metrics.totalSpend)}
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs border-0 h-5 ${
                        supplier.metrics.onTimeDeliveryRate >= 90
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : supplier.metrics.onTimeDeliveryRate >= 70
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {supplier.metrics.onTimeDeliveryRate}%
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={`text-xs border-0 h-5 ${getScoreBadge(supplier.metrics.performanceScore)}`}>
                        {supplier.metrics.performanceScore}/5
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {sortedData.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Trophy className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No supplier performance data available</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
