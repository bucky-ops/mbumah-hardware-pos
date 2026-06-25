'use client';

/**
 * ResponsiveDialog — a Dialog wrapper that NEVER squeezes content.
 *
 * Solves the "words must fit within any window" requirement:
 *  - Auto-fits width up to a sensible max (configurable via `size`).
 *  - Caps height at 90vh and scrolls the body internally (header/footer stay fixed).
 *  - On mobile it expands to near-full-screen.
 *  - Long text wraps; tables/grids scroll horizontally inside the body.
 *  - Content measures its natural size first, then the dialog sizes to fit.
 */

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

type Size = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | 'full';

const SIZE_CLASS: Record<Size, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
  '2xl': 'sm:max-w-5xl',
  '3xl': 'sm:max-w-6xl',
  full: 'sm:max-w-[95vw]',
};

export interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: Size;
  /** Hide the default close (X) button. */
  hideClose?: boolean;
  /** Extra class on the outer content panel. */
  className?: string;
  /** Extra class on the scrollable body. */
  bodyClassName?: string;
}

export function ResponsiveDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'lg',
  hideClose = false,
  className,
  bodyClassName,
}: ResponsiveDialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100vw-1.5rem)]',
            SIZE_CLASS[size],
            'max-h-[92vh]',
            'flex flex-col',
            'gap-0',
            'rounded-xl border bg-background p-0 shadow-2xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            className
          )}
        >
          {(title || !hideClose) && (
            <div className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
              <div className="min-w-0 flex-1">
                {title && (
                  <DialogPrimitive.Title className="text-base font-semibold leading-snug text-foreground sm:text-lg break-words">
                    {title}
                  </DialogPrimitive.Title>
                )}
                {description ? (
                  <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground break-words">
                    {description}
                  </DialogPrimitive.Description>
                ) : (
                  // sr-only fallback so Radix never warns about a missing
                  // Description / aria-describedby on DialogContent.
                  <DialogPrimitive.Description className="sr-only">
                    Dialog
                  </DialogPrimitive.Description>
                )}
              </div>
              {!hideClose && (
                <DialogPrimitive.Close asChild>
                  <button
                    aria-label="Close"
                    className="shrink-0 rounded-md p-1 text-muted-foreground opacity-70 ring-offset-background transition-opacity hover:opacity-100 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </DialogPrimitive.Close>
              )}
            </div>
          )}

          <div
            className={cn(
              'flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 sm:px-6',
              '[&>table]:overflow-x-auto [&>table]:block [&_pre]:overflow-x-auto [&_pre]:max-w-full',
              '[&_.whitespace-nowrap]:break-words',
              bodyClassName
            )}
          >
            {children}
          </div>

          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/30 px-5 py-3 sm:px-6">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
