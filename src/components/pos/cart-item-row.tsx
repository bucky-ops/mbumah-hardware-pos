'use client';

import { useState } from 'react';
import { formatKES } from '@/lib/api';
import type { CartItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Package, X, Minus, Plus, MessageSquare } from 'lucide-react';

export function CartItemRow({
  item,
  onUpdateQty,
  onRemove,
  isNew,
  note,
  onNoteChange,
}: {
  item: CartItem;
  onUpdateQty: (productId: string, qty: number) => void;
  onRemove: (productId: string) => void;
  isNew?: boolean;
  note?: string;
  onNoteChange?: (productId: string, note: string) => void;
}) {
  const quickAddAmounts = [1, 2, 5, 10];
  const [showNote, setShowNote] = useState(!!note);
  const [isEditingQty, setIsEditingQty] = useState(false);
  const [qtyInput, setQtyInput] = useState(String(item.quantity));

  const commitQtyInput = () => {
    const n = parseInt(qtyInput, 10);
    if (!Number.isNaN(n) && n > 0) {
      onUpdateQty(item.productId, n);
    } else {
      setQtyInput(String(item.quantity));
    }
    setIsEditingQty(false);
  };

  return (
    <div className={`cart-item-row group flex gap-2 p-2 rounded-lg bg-muted/40 hover:bg-muted/60 transition-all duration-200 ${isNew ? 'animate-slide-in' : 'animate-stagger-item'}`}>
      {/* Image placeholder */}
      <div className="shrink-0 w-9 h-9 rounded-md bg-muted flex items-center justify-center">
        <Package className="h-3.5 w-3.5 text-muted-foreground/40" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <p className="text-sm font-medium truncate">{item.productName}</p>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 text-muted-foreground/50 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={() => onRemove(item.productId)}
            aria-label="Remove item"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-xs text-muted-foreground">{formatKES(item.pricePerUnit)}</span>
          <span className="text-[9px] px-1 py-0 rounded bg-muted text-muted-foreground font-medium">{item.unitType}</span>
          {item.discountPercent > 0 && (
            <span className="text-[9px] text-green-600 font-medium">{item.discountPercent}% off</span>
          )}
        </div>
        {/* Quick Add buttons - hidden on desktop, shown on hover; always visible on mobile */}
        <div className="flex items-center gap-0.5 mt-1 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-200">
          {quickAddAmounts.map((amt) => (
            <button
              key={amt}
              type="button"
              onClick={() => onUpdateQty(item.productId, item.quantity + amt)}
              className="px-1 py-0 text-[8px] font-medium rounded border border-border/50 bg-background hover:bg-primary hover:text-primary-foreground transition-colors"
            >
              +{amt}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowNote(!showNote)}
            className={`px-1 py-0 text-[8px] font-medium rounded border transition-colors ${showNote ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-background hover:bg-muted'}`}
            title="Add note"
          >
            <MessageSquare className="h-2.5 w-2.5 inline" />
          </button>
        </div>
        {/* Note input */}
        {showNote && (
          <Input
            placeholder="Add a note..."
            value={note || ''}
            onChange={(e) => onNoteChange?.(item.productId, e.target.value)}
            className="h-6 text-[10px] mt-1 px-2 py-0"
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="flex items-center gap-0.5">
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6 btn-press"
            onClick={() => onUpdateQty(item.productId, item.quantity - 1)}
            aria-label="Decrease quantity"
            disabled={item.quantity <= 1}
          >
            <Minus className="h-2.5 w-2.5" />
          </Button>
          {isEditingQty ? (
            <input
              type="number"
              min={1}
              value={qtyInput}
              onChange={(e) => setQtyInput(e.target.value)}
              onBlur={commitQtyInput}
              onKeyDown={(e) => { if (e.key === 'Enter') commitQtyInput(); if (e.key === 'Escape') { setQtyInput(String(item.quantity)); setIsEditingQty(false); } }}
              className="w-9 h-6 text-center text-xs font-semibold border rounded px-0.5 bg-background"
              aria-label="Edit quantity"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <button
              type="button"
              onClick={() => { setQtyInput(String(item.quantity)); setIsEditingQty(true); }}
              className="w-7 text-center text-xs font-semibold hover:bg-muted rounded transition-colors"
              title="Click to edit quantity"
            >
              {item.quantity}
            </button>
          )}
          <Button
            variant="outline"
            size="icon"
            className="h-6 w-6 btn-press"
            onClick={() => onUpdateQty(item.productId, item.quantity + 1)}
            aria-label="Increase quantity"
          >
            <Plus className="h-2.5 w-2.5" />
          </Button>
        </div>
        <p className="text-xs font-semibold text-primary">{formatKES(item.lineTotal)}</p>
      </div>
    </div>
  );
}
