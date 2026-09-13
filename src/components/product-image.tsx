'use client';

// PRODUCT IMAGE (v2.5.2) — one component, every product surface.
//
// Requirement: "real or icon images of each product are visible … when a new
// product is added, the corresponding image or a similar icon appears."
//
// The chain is: photo (imageUrl or the name-matched studio shot in
// public/products) → category icon (bundled PNG) → letter tile.
// A broken/missing photo never renders as a broken-image glyph: onError walks
// down the chain automatically. Rendering stays lightweight — plain <img>
// with lazy loading (no layout shift; grid slots reserve square boxes).

import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { deriveCategoryIcon, resolveProductImage } from '@/lib/product-images';
import { cn } from '@/lib/utils';

export interface ProductImageProps {
  /** The product's own photo URL (may be empty). */
  imageUrl?: string | null;
  /** Used to pick the matching category icon. */
  categoryId?: string | null;
  /** Used for keyword icon matching on custom categories. */
  categoryName?: string | null;
  /** Product name — alt text + the letter-tile fallback initial. */
  name: string;
  className?: string;
  /** Tailwind classes for the fallback wrapper (default fills the parent). */
  fallbackClassName?: string;
}

/** Deterministic pastel per name so letter tiles look varied but stable. */
const TILE_BG = [
  'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
  'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-200',
  'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-200',
];

export function ProductImage({
  imageUrl,
  categoryId,
  categoryName,
  name,
  className,
  fallbackClassName,
}: ProductImageProps) {
  const [stage, setStage] = useState<0 | 1 | 2>(0); // 0 photo, 1 icon, 2 letter
  const photo = imageUrl?.trim() || resolveProductImage(null, categoryId, categoryName, name);
  const icon = deriveCategoryIcon(categoryId, categoryName);

  // Current candidate for this stage (photo may be empty → start at icon).
  const src = stage === 0 ? photo : stage === 1 ? icon : null;
  const effectiveStage = src === null && stage < 2 ? (icon ? 1 : 2) : stage;

  if (effectiveStage === 2 || !src) {
    const tile = TILE_BG[name.length % TILE_BG.length];
    return (
      <div
        aria-hidden
        className={cn(
          'flex items-center justify-center font-semibold select-none',
          tile,
          fallbackClassName ?? 'h-full w-full',
          className
        )}
      >
        {name.trim() ? (
          <span className="uppercase">{name.trim().charAt(0)}</span>
        ) : (
          <Package className="h-1/2 w-1/2 opacity-50" />
        )}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setStage((s) => Math.min(2, s + 1) as 0 | 1 | 2)}
      className={cn('object-cover', className ?? 'h-full w-full')}
    />
  );
}
