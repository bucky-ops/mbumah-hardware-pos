'use client';

import React from 'react';
import { Plus, Sparkles, Keyboard } from 'lucide-react';

export function EmptyCartState() {
  return (
    <div className="p-8 text-center">
      {/* empty cart illustration — animated */}
      <div className="relative mx-auto w-32 h-32 mb-5">
        {/* Cart body */}
        <div className="absolute bottom-6 left-4 right-4 h-16 border-2 border-muted-foreground/12 rounded-b-xl bg-muted/15 backdrop-blur-sm animate-fade-in">
          {/* Empty lines */}
          <div className="absolute top-4 left-4 right-4 space-y-2">
            <div className="h-1 bg-muted-foreground/6 rounded animate-shimmer" />
            <div className="h-1 bg-muted-foreground/6 rounded w-3/4 animate-shimmer" style={{ animationDelay: '0.3s' }} />
          </div>
          {/* Sparkle icon */}
          <Sparkles className="absolute bottom-2 right-3 h-3.5 w-3.5 text-muted-foreground/12" />
        </div>
        {/* Cart handle */}
        <div className="absolute top-2 left-7 right-7 h-8 border-t-2 border-l-2 border-r-2 border-muted-foreground/12 rounded-t-full" />
        {/* Wheels */}
        <div className="absolute bottom-3 left-7 w-4 h-4 border-2 border-muted-foreground/12 rounded-full bg-background">
          <div className="absolute inset-0.5 border border-muted-foreground/8 rounded-full" />
        </div>
        <div className="absolute bottom-3 right-7 w-4 h-4 border-2 border-muted-foreground/12 rounded-full bg-background">
          <div className="absolute inset-0.5 border border-muted-foreground/8 rounded-full" />
        </div>
        {/* Animated arrow pointing to products */}
        <div className="absolute -top-1 -right-1 animate-bounce">
          <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center ring-2 ring-primary/5">
            <Plus className="h-4 w-4 text-primary/60" />
          </div>
        </div>
        {/* Subtle glow */}
        <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-20 h-5 bg-primary/5 rounded-full blur-md" />
        {/* Floating particles around the cart */}
        <div className="absolute -top-3 left-0 w-1.5 h-1.5 bg-primary/20 rounded-full animate-float" style={{ '--float-duration': '4s', '--float-delay': '0s' } as React.CSSProperties} />
        <div className="absolute -top-2 right-2 w-1 h-1 bg-primary/15 rounded-full animate-float" style={{ '--float-duration': '5s', '--float-delay': '1s' } as React.CSSProperties} />
        <div className="absolute -bottom-1 left-2 w-1 h-1 bg-amber-400/15 rounded-full animate-float" style={{ '--float-duration': '6s', '--float-delay': '2s' } as React.CSSProperties} />
      </div>
      <p className="text-sm font-medium text-muted-foreground">Your cart is empty</p>
      <p className="text-xs text-muted-foreground/50 mt-1.5">Click on products to add them here</p>
      <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/35">
        <Keyboard className="h-3 w-3" />
        <span>Press <kbd className="px-1 py-0.5 rounded border bg-muted text-[9px]">F9</kbd> to checkout</span>
      </div>
    </div>
  );
}
