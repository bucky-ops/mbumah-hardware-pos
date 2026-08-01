'use client';

import { Package } from 'lucide-react';

export function EmptyProductsState({ searchQuery }: { searchQuery: string }) {
  return (
    <div className="text-center py-16">
      <div className="relative mx-auto w-20 h-20 mb-4">
        <div className="absolute inset-0 bg-muted rounded-2xl" />
        <Package className="absolute inset-0 m-auto h-10 w-10 text-muted-foreground/30" />
      </div>
      <p className="text-base font-medium text-muted-foreground">No products found</p>
      {searchQuery ? (
        <p className="text-sm text-muted-foreground/60 mt-1">
          No results for &ldquo;{searchQuery}&rdquo;. Try a different search term.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground/60 mt-1">Try adjusting your search or filters</p>
      )}
    </div>
  );
}
