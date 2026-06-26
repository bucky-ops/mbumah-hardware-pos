'use client';

/**
 * Toolbar — search + filter toolbar pattern.
 *
 * Renders a search input on the left and an optional slot for filter controls
 * on the right. Standardizes the look-and-feel of list-page toolbars across
 * the app.
 */

import React from 'react';
import { Search, type LucideIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ToolbarProps {
  /** Current search value (controlled) */
  searchValue: string;
  /** Search change handler */
  onSearchChange: (value: string) => void;
  /** Placeholder for the search input */
  searchPlaceholder?: string;
  /** Optional icon to show on the left of the search input */
  searchIcon?: LucideIcon;
  /** Right-side filter controls slot */
  children?: React.ReactNode;
  /** Extra classes for the wrapping container */
  className?: string;
  /** Disable the search input */
  disabled?: boolean;
}

export function Toolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  searchIcon: SearchIcon = Search,
  children,
  className,
  disabled,
}: ToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 rounded-lg border bg-card/60 backdrop-blur-sm',
        className,
      )}
    >
      <div className="relative flex-1 min-w-0">
        <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          disabled={disabled}
          className="pl-8 h-9 text-sm"
        />
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">{children}</div>
      )}
    </div>
  );
}

export default Toolbar;
