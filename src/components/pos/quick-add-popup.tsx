'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Minus, Plus } from 'lucide-react';
import type { ProductListItem } from '@/lib/api';

export function QuickAddPopup({
  product,
  currentQty,
  onAdd,
  onClose,
}: {
  product: ProductListItem;
  currentQty: number;
  onAdd: (qty: number) => void;
  onClose: () => void;
}) {
  const [qty, setQty] = useState(currentQty > 0 ? currentQty + 1 : 1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  return (
    <div className="absolute inset-0 z-20 bg-black/40 backdrop-blur-[2px] rounded-lg flex items-center justify-center animate-in fade-in duration-150">
      <div className="bg-background rounded-xl shadow-xl border p-3 w-[85%] max-w-[200px] space-y-2 animate-in zoom-in-95 duration-150">
        <p className="text-xs font-semibold truncate">{product.name}</p>
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setQty(Math.max(1, qty - 1))}>
            <Minus className="h-3 w-3" />
          </Button>
          <Input
            ref={inputRef}
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="h-7 w-14 text-center text-sm font-semibold px-1"
            onKeyDown={(e) => { if (e.key === 'Enter') { onAdd(qty); onClose(); } if (e.key === 'Escape') onClose(); }}
          />
          <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setQty(qty + 1)}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex gap-1.5">
          <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={onClose}>Cancel</Button>
          <Button size="sm" className="flex-1 h-7 text-xs bg-primary" onClick={() => { onAdd(qty); onClose(); }}>
            Add {qty}
          </Button>
        </div>
      </div>
    </div>
  );
}
