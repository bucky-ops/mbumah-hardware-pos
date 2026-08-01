'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getCategoryImage, safeMap } from '@/lib/app-config';
import { ChevronDown } from 'lucide-react';
import type { CategoryItem } from '@/lib/api';

export function CategoryChips({
  categories,
  selected,
  onSelect,
}: {
  categories: CategoryItem[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll);
      window.addEventListener('resize', checkScroll);
    }
    return () => {
      if (el) el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll, categories]);

  const scrollBy = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (el) {
      el.scrollBy({ left: direction === 'left' ? -150 : 150, behavior: 'smooth' });
    }
  };

  return (
    <div className="relative flex items-center gap-1">
      {canScrollLeft && (
        <button
          onClick={() => scrollBy('left')}
          className="shrink-0 h-7 w-7 rounded-full border bg-background shadow-sm flex items-center justify-center hover:bg-muted transition-colors z-10"
          aria-label="Scroll categories left"
        >
          <ChevronDown className="h-3 w-3 rotate-90" />
        </button>
      )}
      <div ref={scrollRef} className="flex gap-2 overflow-x-auto scrollbar-none py-0.5 flex-1 px-1" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        <button
          onClick={() => onSelect('all')}
          className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap ${
            selected === 'all'
              ? 'bg-primary text-primary-foreground border-primary shadow-sm'
              : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
          }`}
        >
          All
        </button>
        {safeMap<CategoryItem, React.ReactNode>(categories, (cat) => {
          const catColor = cat.color || '#6b7280';
          const isActive = selected === cat.id;
          const catImage = getCategoryImage(cat.id);
          return (
            <button
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-all whitespace-nowrap flex items-center gap-1.5 min-w-fit ${
                isActive
                  ? 'text-white border-transparent shadow-sm'
                  : 'bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
              }`}
              style={isActive ? { backgroundColor: catColor, borderColor: catColor } : { borderLeftColor: catColor, borderLeftWidth: '3px' }}
            >
              {catImage && (
                <img src={catImage} alt="" className="h-4 w-4 rounded-full object-cover" />
              )}
              {cat.name}
            </button>
          );
        })}
      </div>
      {canScrollRight && (
        <button
          onClick={() => scrollBy('right')}
          className="shrink-0 h-7 w-7 rounded-full border bg-background shadow-sm flex items-center justify-center hover:bg-muted transition-colors z-10"
          aria-label="Scroll categories right"
        >
          <ChevronDown className="h-3 w-3 -rotate-90" />
        </button>
      )}
    </div>
  );
}
