'use client';

/**
 * EmptyState — reusable empty state illustration.
 *
 * Renders a centered icon + title + description with an optional call-to-action
 * button. Used inside tables, lists, and cards when there is no data to show.
 */

import React from 'react';
import { type LucideIcon, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface EmptyStateProps {
  /** Icon to display. Defaults to an inbox icon. */
  icon?: LucideIcon;
  /** Bold title text */
  title?: string;
  /** Smaller helper text shown below the title */
  description?: string;
  /** Optional CTA button label */
  actionLabel?: string;
  /** Click handler for the CTA button */
  onAction?: () => void;
  /** Extra classes for the wrapping container */
  className?: string;
  /** Padding size; defaults to "default" */
  size?: 'sm' | 'default' | 'lg';
}

export function EmptyState({
  icon: Icon = Inbox,
  title = 'Nothing here yet',
  description,
  actionLabel,
  onAction,
  className,
  size = 'default',
}: EmptyStateProps) {
  const padding =
    size === 'sm' ? 'py-6' : size === 'lg' ? 'py-16' : 'py-12';

  return (
    <div className={cn('text-center', padding, className)}>
      <Icon className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-30" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">{title}</p>
      {description && (
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      )}
      {actionLabel && onAction && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export default EmptyState;
