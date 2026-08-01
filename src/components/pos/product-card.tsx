'use client';

import { useState, useMemo, useRef } from 'react';
import { formatKES, type ProductListItem } from '@/lib/api';
import { getCategoryImage } from '@/lib/app-config';
import { QuickAddPopup } from '@/components/pos/quick-add-popup';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Package, Plus, Zap, Star, Eye, ShoppingCart } from 'lucide-react';

export interface ProductCardProps {
  product: ProductListItem;
  onAdd: (p: ProductListItem, qty?: number) => void;
  cartQuantity?: number;
  /** Mark this product as a top seller — shows gold "Best Seller" badge with star icon */
  isBestSeller?: boolean;
  /** Original price (pre-discount). When set and > product.pricePerUnit, shows "On Sale" badge */
  originalPrice?: number;
  /** Optional callback for "View Details" quick action */
  onViewDetails?: (p: ProductListItem) => void;
}

/**
 * Enhanced product card with:
 * - Stock level indicator bar (green/amber/red)
 * - Best Seller badge with star icon
 * - On Sale badge with animated pulse
 * - Category color accent strip on left side
 * - Subtle hover overlay with quick actions (Add to Cart, View Details)
 * - Image lazy loading with blur-up effect
 * - Price tag with gradient background
 * - Quantity selector for bulk add (via QuickAddPopup)
 * - Ripple effect on Add to Cart button
 */
export function ProductCard({
  product,
  onAdd,
  cartQuantity,
  isBestSeller = false,
  originalPrice,
  onViewDetails,
}: ProductCardProps) {
  const [isBouncing, setIsBouncing] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [ripple, setRipple] = useState<{ x: number; y: number; id: number } | null>(null);
  const rippleIdRef = useRef(0);

  const categoryColor = product.category?.color || '#6b7280';
  const stockPercent = product.reorderLevel > 0
    ? Math.min((product.quantityInStock / (product.reorderLevel * 3)) * 100, 100)
    : product.quantityInStock > 0 ? 100 : 0;
  const isLowStock = product.quantityInStock <= product.reorderLevel && product.quantityInStock > 0;
  const isOutOfStock = product.quantityInStock <= 0;

  // On-sale detection: originalPrice (if provided) > current price
  const isOnSale = !!originalPrice && originalPrice > product.pricePerUnit;
  const discountPct = isOnSale && originalPrice
    ? Math.round(((originalPrice - product.pricePerUnit) / originalPrice) * 100)
    : 0;

  // Check if product is new (created within last 7 days)
  const isNew = useMemo(() => {
    const created = new Date(product.createdAt || Date.now());
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return created > sevenDaysAgo;
  }, [product.createdAt]);

  // Stock level color: green >50%, amber 20-50%, red <20%
  const stockBarColor = isOutOfStock
    ? 'bg-red-500'
    : stockPercent < 20
      ? 'bg-red-500'
      : stockPercent < 50
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
    // If already in cart, show Quick Add popup for bulk quantity selector
    if (cartQuantity && cartQuantity > 0) {
      setShowQuickAdd(true);
      return;
    }
    triggerRipple(0, 0);
    setIsBouncing(true);
    onAdd(product);
    setTimeout(() => setIsBouncing(false), 400);
  };

  const handleQuickAdd = (qty: number) => {
    setIsBouncing(true);
    onAdd(product, qty);
    setTimeout(() => setIsBouncing(false), 400);
  };

  // Ripple effect on Add to Cart button click
  const triggerRipple = (x: number, y: number) => {
    const id = ++rippleIdRef.current;
    setRipple({ x, y, id });
    setTimeout(() => {
      if (rippleIdRef.current === id) setRipple(null);
    }, 600);
  };

  const handleAddClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    triggerRipple(e.clientX - rect.left, e.clientY - rect.top);
    if (cartQuantity && cartQuantity > 0) {
      setShowQuickAdd(true);
    } else {
      handleClick();
    }
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
      {/* Category accent strip on left side of card */}
      <span
        className="category-accent-strip"
        style={{ backgroundColor: categoryColor }}
        aria-hidden
      />

      {/* Quick Add Popup Overlay (bulk quantity selector) */}
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
        <div className="absolute top-1.5 right-1.5 z-10 bg-primary text-primary-foreground text-[11px] font-bold rounded-full min-w-[22px] h-[22px] flex items-center justify-center px-1.5 shadow-md ring-2 ring-background animate-badge-pop">
          {cartQuantity}
        </div>
      )}

      {/* Image area — taller & more readable */}
      <div className="h-32 bg-muted flex items-center justify-center relative overflow-hidden shrink-0">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            className={`h-full w-full object-cover group-hover:scale-115 transition-transform duration-500 ease-out img-blur-up ${imageLoaded ? 'img-loaded' : ''}`}
          />
        ) : getCategoryImage(product.categoryId) ? (
          <img
            src={getCategoryImage(product.categoryId)!}
            alt={product.category?.name || ''}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            className={`h-full w-full object-cover group-hover:scale-115 transition-transform duration-500 ease-out img-blur-up ${imageLoaded ? 'img-loaded' : ''}`}
          />
        ) : (
          <Package className="h-10 w-10 text-muted-foreground/25" />
        )}
        {/* Blur-up placeholder shimmer while image loads */}
        {!imageLoaded && (product.imageUrl || getCategoryImage(product.categoryId)) && (
          <div className="absolute inset-0 shimmer-bg" aria-hidden />
        )}

        {/* Hover overlay with quick actions */}
        {!disabled && (
          <div className="product-hover-overlay">
            <Button
              type="button"
              size="sm"
              className="h-7 px-2 text-[10px] bg-white/95 hover:bg-white text-foreground shadow-md"
              onClick={(e) => {
                e.stopPropagation();
                handleClick();
              }}
            >
              {cartQuantity && cartQuantity > 0 ? (
                <><Zap className="h-3 w-3 mr-1" />Quick Add</>
              ) : (
                <><Plus className="h-3 w-3 mr-1" />Add to Cart</>
              )}
            </Button>
            {onViewDetails && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-[10px] bg-white/80 hover:bg-white/95 text-foreground shadow-md"
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDetails(product);
                }}
              >
                <Eye className="h-3 w-3 mr-1" />View
              </Button>
            )}
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 z-20 max-w-[60%]">
          {product.isRental && (
            <Badge className="bg-amber-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm">RENTAL</Badge>
          )}
          {product.isBundle && (
            <Badge className="bg-purple-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm">BUNDLE</Badge>
          )}
          {isBestSeller && (
            <Badge className="best-seller-badge text-[10px] px-1.5 py-0.5 font-semibold flex items-center gap-0.5">
              <Star className="h-2.5 w-2.5 fill-current" />BEST SELLER
            </Badge>
          )}
          {isOnSale && (
            <Badge className="bg-red-600 text-white text-[10px] px-1.5 py-0.5 font-semibold shadow-sm animate-on-sale flex items-center gap-0.5">
              ON SALE · -{discountPct}%
            </Badge>
          )}
          {isNew && !product.isRental && !product.isBundle && !isBestSeller && (
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
        {/* Product name — wraps fully, never truncates words */}
        <h3 className="font-semibold text-[15px] leading-snug break-words min-h-[2.6em]">{product.name}</h3>
        {product.category && (
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: categoryColor }} aria-hidden />
            <p className="text-[11px] text-muted-foreground/80 truncate">{product.category.name}</p>
          </div>
        )}
        <div className="flex items-end justify-between mt-1 gap-1.5">
          <div className="min-w-0">
            {/* Price tag with gradient background; shows struck-through original if on sale */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="price-tag text-[13px] leading-none">{formatKES(product.pricePerUnit)}</span>
              {isOnSale && originalPrice && (
                <span className="text-[10px] text-muted-foreground line-through font-medium" aria-label={`Original price ${formatKES(originalPrice)}`}>
                  {formatKES(originalPrice)}
                </span>
              )}
            </div>
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium mt-1 inline-block ${unitBadgeColor[product.unitType] || 'bg-muted text-muted-foreground'}`}>
              per {product.unitType}
            </span>
          </div>

          {/* Quick add button — touch-friendly 44px target with gradient + ripple + press animation */}
          <Button
            type="button"
            size="icon"
            variant={disabled ? 'ghost' : 'default'}
            className={`relative overflow-hidden h-10 w-10 shrink-0 shadow-md btn-press ${
              disabled
                ? ''
                : 'bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white shadow-emerald-500/30'
            }`}
            disabled={disabled}
            onClick={handleAddClick}
            aria-label={`Add ${product.name} to cart`}
          >
            {/* Glossy gradient sheen on top */}
            {!disabled && (
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 rounded-t-md bg-gradient-to-b from-white/25 to-transparent" aria-hidden />
            )}
            {cartQuantity && cartQuantity > 0 ? <Zap className="h-4 w-4 relative z-10" /> : <Plus className="h-4 w-4 relative z-10" />}
            {/* Ripple element */}
            {ripple && (
              <span
                key={ripple.id}
                className="pointer-events-none absolute rounded-full bg-white/40 animate-ripple"
                style={{
                  left: ripple.x || '50%',
                  top: ripple.y || '50%',
                  width: '12px',
                  height: '12px',
                  transform: 'translate(-50%, -50%)',
                }}
                aria-hidden
              />
            )}
          </Button>
        </div>

        {/* Stock bar — clear low/out-of-stock visual with colored thresholds */}
        <div className="flex items-center gap-2 mt-auto pt-1.5">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden" role="progressbar" aria-valuenow={stockPercent} aria-valuemin={0} aria-valuemax={100} aria-label={`Stock level: ${stockPercent}%`}>
            <div
              className={`h-full rounded-full animate-stock-fill ${stockBarColor} relative`}
              style={{ width: `${stockPercent}%` }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
            </div>
          </div>
          <span className={`text-[10px] font-semibold shrink-0 ${isOutOfStock ? 'text-red-500' : stockPercent < 50 ? 'text-amber-500' : stockPercent < 20 ? 'text-red-500' : 'text-muted-foreground'}`}>
            {isOutOfStock ? 'Out' : (
              <span className="flex items-center gap-0.5">
                <ShoppingCart className="h-2.5 w-2.5" aria-hidden />
                {product.quantityInStock} left
              </span>
            )}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
