'use client';

/**
 * LoadingSkeleton — flexible skeleton loaders with named variants.
 *
 * Provides common skeleton patterns: rows, cards, and a generic block. Reduces
 * duplication of inline `<Skeleton className="h-10 w-full" />` boilerplate
 * across the tab files.
 */

import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export interface LoadingSkeletonProps {
  variant?: 'rows' | 'cards' | 'block';
  /** For 'rows' and 'cards' — how many items to render */
  count?: number;
  /** For 'rows' — height of each skeleton row */
  rowHeight?: string;
  /** For 'cards' — grid template, defaults to a 4-col responsive grid */
  cardClassName?: string;
  /** For 'block' — explicit className for the single Skeleton */
  blockClassName?: string;
  /** Wrapper className */
  className?: string;
}

export function LoadingSkeleton({
  variant = 'rows',
  count = 5,
  rowHeight = 'h-10',
  cardClassName,
  blockClassName,
  className,
}: LoadingSkeletonProps) {
  if (variant === 'block') {
    return <Skeleton className={cn('w-full', blockClassName, className)} />;
  }

  if (variant === 'cards') {
    return (
      <div className={cn('grid grid-cols-2 md:grid-cols-4 gap-3', className)}>
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className={cn('h-24', cardClassName)} />
        ))}
      </div>
    );
  }

  // rows
  return (
    <div className={cn('space-y-3 p-6', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn('w-full', rowHeight)} />
      ))}
    </div>
  );
}

export default LoadingSkeleton;
