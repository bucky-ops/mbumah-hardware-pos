'use client';

import { useState, useMemo } from 'react';
import { formatKES, type ProductListItem } from '@/lib/api';
import { getCategoryImage } from '@/lib/app-config';
import { QuickAddPopup } from '@/components/pos/quick-add-popup';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, Plus, Zap } from 'lucide-react';

export function ProductCard({
  product,
  onAdd,
  cartQuantity,
}: {
  product: ProductListItem;
  onAdd: (p: ProductListItem, qty?: number) => void;
  cartQuantity?: number;
}) {
  const [isBouncing, setIsBouncing] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const categoryColor = product.category?.color || '#6b7280';
  const stockPercent = product.reorderLevel > 0
    ? Math.min((product.quantityInStock / (product.reorderLevel * 3)) * 100, 100)
    : product.quantityInStock > 0 ? 100 : 0;
  const isLowStock = product.quantityInStock <= product.reorderLevel && product.quantityInStock > 0;
  const isOutOfStock = product.quantityInStock <= 0;

  // Check if product is new (created within last 7 days)
  const isNew = useMemo(() => {
    const created = new Date(product.createdAt || Date.now());
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return created > sevenDaysAgo;
  }, [product.createdAt]);

  const stockBarColor = isOutOfStock
    ? 'bg-red-500'
    : isLowStock
      ? 'bg-amber-500'
      : 'bg-green-500';

  const unitBadgeColor: Record<string, string> = {
    PIECE: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    KILOGRAM: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
    METER: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
    LITER: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    BAG: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    BOX: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
    SET: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  };

  const handleClick = () => {
    // If already in cart, show Quick Add popup
    if (cartQuantity && cartQuantity > 0) {
      setShowQuickAdd(true);
      return;
    }
    setIsBouncing(true);
    onAdd(product);
    setTimeout(() => setIsBouncing(false), 400);
  };

  const handleQuickAdd = (qty: number) => {
    setIsBouncing(true);
    onAdd(product, qty);
    setTimeout(() => setIsBouncing(false), 400);
  };

  // Out-of-stock disables interaction (rentals can still be added)
  const disabled = isOutOfStock && !product.isRental;

  return (
    <Card
      className={`overflow-hidden transition-all duration-200 group relative h-full flex flex-col min-h-[210px] product-card-lift ${isBouncing ? 'animate-bounce-add' : ''} ${disabled ? 'opacity-60 grayscale pointer-events-none' : 'cursor-pointer'}`}
      style={{ borderTopColor: categoryColor, borderTopWidth: '4px' }}
      onClick={disabled ? undefined : handleClick}
      role="button"
      aria-label={`${product.name}, ${formatKES(product.pricePerUnit)}, ${isOutOfStock ? 'out of stock' : `${product.quantityInStock} in stock`}`}
      aria-disabled={disabled}
    >
      {/* Quick Add Popup Overlay */}
      {showQuickAdd && !disabled && (
        <QuickAddPopup
          product={product}
          currentQty={cartQuantity || 0}
          onAdd={handleQuickAdd}
          onClose={() => setShowQuickAdd(false)}
        />
      )}
      {/* In-cart indicator */}
      {cartQuantity && cartQuantity > 0 && (
        <div className="absolute top-1.5 right-1.5 z-10 bg-primary text-primary-foreground text-[11px] font-bold rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5 shadow-md ring-2 ring-background">
          {cartQuantity}
        </div>
      )}
      {/* Image area — taller & more readable */}
      <div className="h-32 bg-muted flex items-center justify-center relative overflow-hidden shrink-0">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover group-hover:scale-115 transition-transform duration-500 ease-out" />
        ) : getCategoryImage(product.categoryId) ? (
          <img src={getCategoryImage(product.categoryId)!} alt={product.category?.name || ''} className="h-full w-full object-cover group-hover:scale-115 transition-transform duration-500 ease-out" />
        ) : (
          <Package className="h-10 w-10 text-muted-foreground/25" />
        )}
        {/* Gradient overlay on hover */}
        {!disabled && (
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
            <div className="bg-white/95 dark:bg-black/80 rounded-full p-2.5 shadow-lg transform scale-50 group-hover:scale-100 transition-transform duration-200">
              {cartQuantity && cartQuantity > 0 ? <Zap className="h-5 w-5 text-primary" /> : <Plus className="h-5 w-5 text-primary" />}
            </div>
          </div>
        )}
        {/* Badges */}
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 z-20">
          {product.isRental && (
            <Badge className="bg-amber-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm">RENTAL</Badge>
          )}
          {product.isBundle && (
            <Badge className="bg-purple-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm">BUNDLE</Badge>
          )}
          {isNew && !product.isRental && !product.isBundle && (
            <Badge className="bg-green-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm animate-new-badge">NEW</Badge>
          )}
        </div>
        {/* Stock status badge (top-right when not in cart) */}
        {(!cartQuantity || cartQuantity === 0) && (
          <div className="absolute top-1.5 right-1.5 z-20">
            {isOutOfStock ? (
              <Badge variant="destructive" className="text-[10px] font-bold shadow-sm animate-shake-warning">OUT OF STOCK</Badge>
            ) : isLowStock ? (
              <Badge className="bg-amber-500 text-white text-[10px] font-semibold shadow-sm animate-shake-warning">LOW STOCK</Badge>
            ) : null}
          </div>
        )}
        {isOutOfStock && (
          <div className="absolute inset-0 bg-red-500/10 flex items-center justify-center pointer-events-none" />
        )}
      </div>
      <CardContent className="p-3 flex-1 flex flex-col gap-1">
        {/* Product name — wraps fully, never truncates words (no line-clamp so every word shows) */}
        <h3 className="font-semibold text-[15px] leading-snug break-words min-h-[2.6em]">{product.name}</h3>
        {product.category && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: categoryColor }} aria-hidden />
            <p className="text-[11px] text-muted-foreground/80 truncate">{product.category.name}</p>
          </div>
        )}
        <div className="flex items-end justify-between mt-1 gap-1.5">
          <div className="min-w-0">
            <p className="font-bold text-primary text-base leading-none break-words">{formatKES(product.pricePerUnit)}</p>
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium mt-1 inline-block ${unitBadgeColor[product.unitType] || 'bg-muted text-muted-foreground'}`}>
              per {product.unitType}
            </span>
          </div>
          {/* Quick add button — touch-friendly 44px target */}
          <Button
            type="button"
            size="icon"
            variant={disabled ? 'ghost' : 'default'}
            className="h-10 w-10 shrink-0 shadow-sm"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (cartQuantity && cartQuantity > 0) {
                setShowQuickAdd(true);
              } else {
                handleClick();
              }
            }}
            aria-label={`Add ${product.name} to cart`}
          >
            {cartQuantity && cartQuantity > 0 ? <Zap className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </Button>
        </div>
        {/* Stock bar — clear low/out-of-stock visual */}
        <div className="flex items-center gap-2 mt-auto pt-1.5">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full animate-stock-fill ${stockBarColor} relative`}
              style={{ width: `${stockPercent}%` }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
            </div>
          </div>
          <span className={`text-[10px] font-semibold shrink-0 ${isOutOfStock ? 'text-red-500' : isLowStock ? 'text-amber-500' : 'text-muted-foreground'}`}>
            {isOutOfStock ? 'Out' : `${product.quantityInStock} left`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
