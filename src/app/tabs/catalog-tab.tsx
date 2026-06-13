'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Package, Search, LayoutGrid, List, Filter, ShoppingCart,
  Plus, Minus, Star, Tag, ChevronDown, X, SlidersHorizontal,
} from 'lucide-react';
import { useCartStore, useAppStore } from '@/lib/stores';
import {
  productsApi, categoriesApi, formatKES,
  type ProductListItem, type CategoryItem,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardFooter, CardHeader, CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';


type SortKey = 'name' | 'price_asc' | 'price_desc' | 'stock';
type StockFilter = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';
type ViewMode = 'grid' | 'list';

const CATEGORY_COLORS: Record<string, string> = {
  cat_cement: '#6B7280',
  cat_iron_sheets: '#3B82F6',
  cat_paints: '#8B5CF6',
  cat_iron_bars: '#EF4444',
  cat_wheelbarrows: '#F59E0B',
  cat_mesh_wires: '#6366F1',
  cat_tools: '#10B981',
  cat_plumbing: '#06B6D4',
  cat_electrical: '#F97316',
  cat_nails_screws: '#78716C',
};

const CATEGORY_IMAGES: Record<string, string> = {
  cat_cement: '/categories/cat_cement.png',
  cat_iron_sheets: '/categories/cat_iron.png',
  cat_paints: '/categories/cat_paints.png',
  cat_iron_bars: '/categories/cat_rebar.png',
  cat_wheelbarrows: '/categories/cat_wheelbarrow.png',
  cat_mesh_wires: '/categories/cat_mesh.png',
  cat_tools: '/categories/cat_tools.png',
  cat_plumbing: '/categories/cat_plumbing.png',
  cat_electrical: '/categories/cat_electrical.png',
  cat_nails_screws: '/categories/cat_nails.png',
};

function getCategoryImage(categoryId: string | null | undefined): string | null {
  if (!categoryId) return null;
  return CATEGORY_IMAGES[categoryId] || null;
}

function getStockStatus(qty: number, reorder: number) {
  if (qty <= 0) return { label: 'Out of Stock', color: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400' };
  if (qty <= reorder) return { label: 'Low Stock', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' };
  return { label: 'In Stock', color: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' };
}


export default function CatalogTab() {
  const { currentStoreId } = useAppStore();
  const cart = useCartStore();

  // Filters & view state
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showFilters, setShowFilters] = useState(false);

  // Quantity tracking per product for +/- buttons
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const getQty = (productId: string) => quantities[productId] ?? 1;
  const setQty = (productId: string, qty: number) => {
    if (qty < 1) qty = 1;
    setQuantities((prev) => ({ ...prev, [productId]: qty }));
  };

  // Data fetching

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<CategoryItem[]>({
    queryKey: ['categories', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      try {
        const res = await categoriesApi.list(currentStoreId);
        const data = res?.data;
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
  });

  const { data: products = [], isLoading: productsLoading } = useQuery<ProductListItem[]>({
    queryKey: ['catalog-products', currentStoreId],
    enabled: !!currentStoreId,
    queryFn: async () => {
      try {
        const res = await productsApi.list({ storeId: currentStoreId!, limit: 500 });
        const data = res?.data;
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    },
  });

  // Filtering & sorting

  const filteredProducts = useMemo(() => {
    let result = products.filter((p) => p.isActive);

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.description && p.description.toLowerCase().includes(q)) ||
          (p.category?.name && p.category.name.toLowerCase().includes(q)),
      );
    }

    // Category
    if (selectedCategory !== 'all') {
      result = result.filter((p) => p.categoryId === selectedCategory);
    }

    // Stock filter
    if (stockFilter === 'in_stock') result = result.filter((p) => p.quantityInStock > p.reorderLevel);
    else if (stockFilter === 'low_stock') result = result.filter((p) => p.quantityInStock > 0 && p.quantityInStock <= p.reorderLevel);
    else if (stockFilter === 'out_of_stock') result = result.filter((p) => p.quantityInStock <= 0);

    // Price range
    if (priceMin) result = result.filter((p) => p.pricePerUnit >= Number(priceMin));
    if (priceMax) result = result.filter((p) => p.pricePerUnit <= Number(priceMax));

    // Sort
    switch (sortKey) {
      case 'name':
        result.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'price_asc':
        result.sort((a, b) => a.pricePerUnit - b.pricePerUnit);
        break;
      case 'price_desc':
        result.sort((a, b) => b.pricePerUnit - a.pricePerUnit);
        break;
      case 'stock':
        result.sort((a, b) => b.quantityInStock - a.quantityInStock);
        break;
    }

    return result;
  }, [products, search, selectedCategory, stockFilter, priceMin, priceMax, sortKey]);

  // Add to cart handler

  const handleAddToCart = (product: ProductListItem) => {
    const qty = getQty(product.id);
    cart.addItem({
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      quantity: qty,
      unitType: product.unitType as 'PIECE',
      pricePerUnit: product.pricePerUnit,
      costPrice: product.costPrice,
      discountPercent: 0,
      taxRate: product.taxRate,
      isRentalItem: product.isRental,
      isBundle: product.isBundle,
    });
    toast.success(`Added ${qty}× ${product.name} to cart`, {
      description: formatKES(product.pricePerUnit * qty),
    });
  };

  // Clear all filters

  const clearFilters = () => {
    setSearch('');
    setSelectedCategory('all');
    setStockFilter('all');
    setPriceMin('');
    setPriceMax('');
    setSortKey('name');
  };

  const activeFilterCount = [
    search.trim() && 1,
    selectedCategory !== 'all' && 1,
    stockFilter !== 'all' && 1,
    priceMin && 1,
    priceMax && 1,
  ].filter(Boolean).length;

  // Render helpers

  const renderProductCard = (product: ProductListItem) => {
    const stock = getStockStatus(product.quantityInStock, product.reorderLevel);
    const catImg = getCategoryImage(product.categoryId);
    const qty = getQty(product.id);
    const inCart = cart.items.find((i) => i.productId === product.id);

    return (
      <Card
        key={product.id}
        className="group overflow-hidden transition-all duration-200 hover:shadow-lg border-border/60 flex flex-col"
      >
        {/* Image / placeholder */}
        <div className="relative h-40 bg-muted/30 overflow-hidden">
          {catImg ? (
            <img
              src={catImg}
              alt={product.category?.name || product.name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Package className="h-12 w-12 text-muted-foreground/40" />
            </div>
          )}
          {/* Category badge */}
          {product.category && (
            <Badge
              variant="secondary"
              className="absolute top-2 left-2 text-[10px] font-medium px-2 py-0.5"
              style={{
                backgroundColor: (CATEGORY_COLORS[product.categoryId || ''] || '#6B7280') + '22',
                color: CATEGORY_COLORS[product.categoryId || ''] || '#6B7280',
              }}
            >
              {product.category.name}
            </Badge>
          )}
          {/* Stock badge */}
          <Badge variant="outline" className={`absolute top-2 right-2 text-[10px] px-2 py-0.5 ${stock.color}`}>
            {stock.label}
          </Badge>
          {/* In cart indicator */}
          {inCart && (
            <div className="absolute bottom-2 right-2 bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-[10px] font-bold shadow">
              {inCart.quantity}
            </div>
          )}
        </div>

        <CardContent className="p-4 flex-1">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2 mb-1">{product.name}</h3>
          <p className="text-[11px] text-muted-foreground mb-2">SKU: {product.sku}</p>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-bold text-primary">{formatKES(product.pricePerUnit)}</span>
            <span className="text-[11px] text-muted-foreground">per {product.unitType.toLowerCase()}</span>
          </div>
          {product.quantityInStock > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {product.quantityInStock} in stock
            </p>
          )}
        </CardContent>

        <CardFooter className="p-4 pt-0 flex items-center gap-2">
          <div className="flex items-center border rounded-lg overflow-hidden">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-none"
              onClick={() => setQty(product.id, Math.max(1, qty - 1))}
              disabled={qty <= 1}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-8 text-center text-sm font-medium">{qty}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-none"
              onClick={() => setQty(product.id, qty + 1)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <Button
            size="sm"
            className="flex-1 h-8"
            onClick={() => handleAddToCart(product)}
            disabled={product.quantityInStock <= 0}
          >
            <ShoppingCart className="h-3.5 w-3.5 mr-1.5" />
            {product.quantityInStock <= 0 ? 'Unavailable' : 'Add to Cart'}
          </Button>
        </CardFooter>
      </Card>
    );
  };

  const renderProductListItem = (product: ProductListItem) => {
    const stock = getStockStatus(product.quantityInStock, product.reorderLevel);
    const catImg = getCategoryImage(product.categoryId);
    const qty = getQty(product.id);
    const inCart = cart.items.find((i) => i.productId === product.id);

    return (
      <div
        key={product.id}
        className="flex items-center gap-4 p-3 rounded-lg border border-border/60 hover:shadow-md transition-all duration-200 bg-card"
      >
        {/* Thumbnail */}
        <div className="h-16 w-16 rounded-md bg-muted/30 overflow-hidden flex-shrink-0">
          {catImg ? (
            <img src={catImg} alt={product.name} className="w-full h-full object-cover" />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Package className="h-6 w-6 text-muted-foreground/40" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="font-semibold text-sm truncate">{product.name}</h3>
            {product.category && (
              <Badge
                variant="secondary"
                className="text-[9px] px-1.5 py-0 flex-shrink-0"
                style={{
                  backgroundColor: (CATEGORY_COLORS[product.categoryId || ''] || '#6B7280') + '22',
                  color: CATEGORY_COLORS[product.categoryId || ''] || '#6B7280',
                }}
              >
                {product.category.name}
              </Badge>
            )}
            <Badge variant="outline" className={`text-[9px] px-1.5 py-0 flex-shrink-0 ${stock.color}`}>
              {stock.label}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground">SKU: {product.sku}</p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="font-bold text-primary">{formatKES(product.pricePerUnit)}</span>
            <span className="text-[11px] text-muted-foreground">per {product.unitType.toLowerCase()}</span>
            <span className="text-[11px] text-muted-foreground">• {product.quantityInStock} in stock</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {inCart && (
            <Badge variant="default" className="text-[10px] px-2">
              {inCart.quantity} in cart
            </Badge>
          )}
          <div className="flex items-center border rounded-lg overflow-hidden">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-none"
              onClick={() => setQty(product.id, Math.max(1, qty - 1))}
              disabled={qty <= 1}
            >
              <Minus className="h-3 w-3" />
            </Button>
            <span className="w-7 text-center text-xs font-medium">{qty}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-none"
              onClick={() => setQty(product.id, qty + 1)}
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <Button
            size="sm"
            className="h-7"
            onClick={() => handleAddToCart(product)}
            disabled={product.quantityInStock <= 0}
          >
            <ShoppingCart className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>
      </div>
    );
  };

  // Loading skeleton

  const renderSkeletons = () =>
    Array.from({ length: 8 }).map((_, i) => (
      <Card key={i} className="overflow-hidden">
        <Skeleton className="h-40 w-full" />
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-5 w-1/3" />
        </CardContent>
      </Card>
    ));

  // Render

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products by name, SKU, or category..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setSearch('')}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Filter toggle */}
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="relative"
          >
            <SlidersHorizontal className="h-4 w-4 mr-1.5" />
            Filters
            {activeFilterCount > 0 && (
              <Badge className="ml-1.5 h-5 w-5 p-0 flex items-center justify-center text-[10px]">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
          {/* View toggle */}
          <div className="flex border rounded-lg overflow-hidden">
            <Button
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              size="icon"
              className="h-8 w-8 rounded-none"
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="icon"
              className="h-8 w-8 rounded-none"
              onClick={() => setViewMode('list')}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            {/* Category */}
            <div className="space-y-1.5 min-w-[180px]">
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Stock status */}
            <div className="space-y-1.5 min-w-[160px]">
              <label className="text-xs font-medium text-muted-foreground">Stock Status</label>
              <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as StockFilter)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="in_stock">In Stock</SelectItem>
                  <SelectItem value="low_stock">Low Stock</SelectItem>
                  <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Price min */}
            <div className="space-y-1.5 min-w-[120px]">
              <label className="text-xs font-medium text-muted-foreground">Min Price (KES)</label>
              <Input
                type="number"
                placeholder="0"
                className="h-9"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
              />
            </div>

            {/* Price max */}
            <div className="space-y-1.5 min-w-[120px]">
              <label className="text-xs font-medium text-muted-foreground">Max Price (KES)</label>
              <Input
                type="number"
                placeholder="∞"
                className="h-9"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
              />
            </div>

            {/* Sort */}
            <div className="space-y-1.5 min-w-[160px]">
              <label className="text-xs font-medium text-muted-foreground">Sort By</label>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name (A-Z)</SelectItem>
                  <SelectItem value="price_asc">Price (Low→High)</SelectItem>
                  <SelectItem value="price_desc">Price (High→Low)</SelectItem>
                  <SelectItem value="stock">Stock Level</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Clear filters */}
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
                <X className="h-3.5 w-3.5 mr-1" />
                Clear ({activeFilterCount})
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Category quick filters (horizontal scroll) */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        <Button
          variant={selectedCategory === 'all' ? 'default' : 'outline'}
          size="sm"
          className="flex-shrink-0 h-8"
          onClick={() => setSelectedCategory('all')}
        >
          <Tag className="h-3.5 w-3.5 mr-1.5" />
          All
        </Button>
        {categories.map((c) => (
          <Button
            key={c.id}
            variant={selectedCategory === c.id ? 'default' : 'outline'}
            size="sm"
            className="flex-shrink-0 h-8"
            onClick={() => setSelectedCategory(c.id)}
          >
            <span
              className="w-2 h-2 rounded-full mr-1.5 flex-shrink-0"
              style={{ backgroundColor: CATEGORY_COLORS[c.id] || c.color || '#6B7280' }}
            />
            {c.name}
          </Button>
        ))}
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''} found
          {search && ` for "${search}"`}
        </span>
        {cart.items.length > 0 && (
          <span className="flex items-center gap-1.5 text-primary font-medium">
            <ShoppingCart className="h-3.5 w-3.5" />
            {cart.getItemCount()} item{cart.getItemCount() !== 1 ? 's' : ''} in cart • {formatKES(cart.getTotal())}
          </span>
        )}
      </div>

      <Separator />

      {/* Product grid / list */}
      <div className="flex-1 overflow-y-auto">
        {productsLoading ? (
          <div
            className={
              viewMode === 'grid'
                ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'
                : 'space-y-3'
            }
          >
            {renderSkeletons()}
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Package className="h-16 w-16 text-muted-foreground/30 mb-4" />
            <h3 className="text-lg font-semibold mb-1">No products found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {search || selectedCategory !== 'all' || stockFilter !== 'all'
                ? 'Try adjusting your search or filters to find what you\'re looking for.'
                : 'No products have been added to the catalog yet.'}
            </p>
            {activeFilterCount > 0 && (
              <Button variant="outline" className="mt-4" onClick={clearFilters}>
                Clear All Filters
              </Button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredProducts.map(renderProductCard)}
          </div>
        ) : (
          <div className="space-y-3">{filteredProducts.map(renderProductListItem)}</div>
        )}
      </div>
    </div>
  );
}
