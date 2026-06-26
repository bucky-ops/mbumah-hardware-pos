'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Package, Search, LayoutGrid, List, ShoppingCart,
  Plus, Minus, Tag, X, SlidersHorizontal,
  Pencil, Trash2, MessageCircle, AlertTriangle, MoreVertical,
  Loader2, Copy,
} from 'lucide-react';
import { useCartStore, useAppStore } from '@/lib/stores';
import {
  productsApi, categoriesApi, whatsappApi, formatKES,
  openWhatsApp,
  type ProductListItem, type CategoryItem, type CreateProductPayload,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';
import { ProductImageUpload } from '@/components/product-image-upload';
import { Button } from '@/components/ui/button';
import {
  Card, CardContent, CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ResponsiveDialog,
} from '@/components/ui/responsive-dialog';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

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

const UNIT_TYPES: { value: string; label: string }[] = [
  { value: 'PIECE', label: 'Piece' },
  { value: 'KILOGRAM', label: 'Kilogram' },
  { value: 'METER', label: 'Meter' },
  { value: 'LITER', label: 'Liter' },
  { value: 'BAG', label: 'Bag' },
  { value: 'BOX', label: 'Box' },
  { value: 'SET', label: 'Set' },
];

function getCategoryImage(categoryId: string | null | undefined): string | null {
  if (!categoryId) return null;
  return CATEGORY_IMAGES[categoryId] || null;
}

function getStockStatus(qty: number, reorder: number) {
  if (qty <= 0) return { label: 'Out of Stock', color: 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400', tone: 'out' as const };
  if (qty <= reorder) return { label: 'Low Stock', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400', tone: 'low' as const };
  return { label: 'In Stock', color: 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400', tone: 'ok' as const };
}

// Empty product form shape
const EMPTY_PRODUCT: ProductFormState = {
  name: '', sku: '', barcode: '', categoryId: '',
  pricePerUnit: '', costPrice: '', taxRate: '16',
  quantityInStock: '', reorderLevel: '10', unitType: 'PIECE',
  description: '', imageUrl: '', isRental: false, isBundle: false,
};

interface ProductFormState {
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  pricePerUnit: string;
  costPrice: string;
  taxRate: string;
  quantityInStock: string;
  reorderLevel: string;
  unitType: string;
  description: string;
  imageUrl: string;
  isRental: boolean;
  isBundle: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CatalogTab() {
  const { currentStoreId } = useAppStore();
  const cart = useCartStore();
  const queryClient = useQueryClient();

  // Filters & view state
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [stockFilter, setStockFilter] = useState<StockFilter>('all');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showFilters, setShowFilters] = useState(false);

  // Quantity tracking per product for +/- buttons
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  // Product editor (Add / Edit) — uses ResponsiveDialog
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductListItem | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ProductListItem | null>(null);

  // WhatsApp catalog send
  const [waOpen, setWaOpen] = useState(false);
  const [waPhone, setWaPhone] = useState('');

  const getQty = (productId: string) => quantities[productId] ?? 1;
  const setQty = (productId: string, qty: number) => {
    if (qty < 1) qty = 1;
    setQuantities((prev) => ({ ...prev, [productId]: qty }));
  };

  // ---------------------------------------------------------------------------
  // Debounce search input (300ms)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  // ---------------------------------------------------------------------------
  // Data fetching (stable queryKeys, auto-refetch via providers)
  // ---------------------------------------------------------------------------

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<CategoryItem[]>({
    queryKey: ['categories', currentStoreId],
    queryFn: () => categoriesApi.list(currentStoreId).then((r) => Array.isArray(r.data) ? r.data : []),
  });

  const { data: products = [], isLoading: productsLoading } = useQuery<ProductListItem[]>({
    queryKey: ['catalog-products', currentStoreId],
    queryFn: () => productsApi.list({ storeId: currentStoreId, limit: 500 }).then((r) => Array.isArray(r.data) ? r.data : []),
  });

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createProductMutation = useMutation({
    mutationFn: productsApi.create,
    onSuccess: () => {
      toast.success('Product added to catalog');
      queryClient.invalidateQueries({ queryKey: ['catalog-products', currentStoreId] });
      closeEditor();
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Create product');
      toast.error(msg);
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateProductPayload> }) => productsApi.update(id, data),
    onSuccess: () => {
      toast.success('Product updated');
      queryClient.invalidateQueries({ queryKey: ['catalog-products', currentStoreId] });
      closeEditor();
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Update product');
      toast.error(msg);
    },
  });

  const deleteProductMutation = useMutation({
    mutationFn: productsApi.delete,
    onSuccess: () => {
      toast.success('Product deleted');
      queryClient.invalidateQueries({ queryKey: ['catalog-products', currentStoreId] });
      setDeleteTarget(null);
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Delete product');
      toast.error(msg);
    },
  });

  const duplicateProductMutation = useMutation({
    mutationFn: productsApi.create,
    onSuccess: () => {
      toast.success('Product duplicated');
      queryClient.invalidateQueries({ queryKey: ['catalog-products', currentStoreId] });
    },
    onError: (err: unknown) => {
      const msg = handleError(err, 'Duplicate product');
      toast.error(msg);
    },
  });

  // ---------------------------------------------------------------------------
  // Filtering & sorting
  // ---------------------------------------------------------------------------

  const filteredProducts = useMemo(() => {
    let result = products.filter((p) => p.isActive);

    // Debounced search — filters by name / SKU / description / category
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)) ||
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
  }, [products, debouncedSearch, selectedCategory, stockFilter, priceMin, priceMax, sortKey]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

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

  // ----- Product editor (Add / Edit) -----

  const openAddEditor = () => {
    setEditingProduct(null);
    setForm(EMPTY_PRODUCT);
    setEditorOpen(true);
  };

  const openEditEditor = (product: ProductListItem) => {
    setEditingProduct(product);
    setForm({
      name: product.name,
      sku: product.sku,
      barcode: product.barcode || '',
      categoryId: product.categoryId || '',
      pricePerUnit: String(product.pricePerUnit ?? ''),
      costPrice: String(product.costPrice ?? ''),
      taxRate: String(product.taxRate ?? '16'),
      quantityInStock: String(product.quantityInStock ?? ''),
      reorderLevel: String(product.reorderLevel ?? '10'),
      unitType: product.unitType || 'PIECE',
      description: product.description || '',
      imageUrl: product.imageUrl || '',
      isRental: !!product.isRental,
      isBundle: !!product.isBundle,
    });
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditingProduct(null);
    setForm(EMPTY_PRODUCT);
  };

  const submitEditor = () => {
    if (!form.name.trim() || !form.sku.trim()) {
      toast.error('Product name and SKU are required');
      return;
    }
    const payload: CreateProductPayload = {
      storeId: currentStoreId,
      name: form.name.trim(),
      sku: form.sku.trim(),
      barcode: form.barcode.trim() || undefined,
      categoryId: form.categoryId || undefined,
      pricePerUnit: Number(form.pricePerUnit) || 0,
      costPrice: Number(form.costPrice) || 0,
      taxRate: Number(form.taxRate) || 0,
      quantityInStock: Number(form.quantityInStock) || 0,
      reorderLevel: Number(form.reorderLevel) || 0,
      unitType: form.unitType,
      description: form.description.trim() || undefined,
      imageUrl: form.imageUrl.trim() || undefined,
      isRental: form.isRental,
      isBundle: form.isBundle,
    };
    if (editingProduct) {
      updateProductMutation.mutate({ id: editingProduct.id, data: payload });
    } else {
      createProductMutation.mutate(payload);
    }
  };

  const handleDuplicate = (product: ProductListItem) => {
    duplicateProductMutation.mutate({
      storeId: currentStoreId,
      name: product.name + ' (Copy)',
      sku: product.sku + '-COPY',
      barcode: product.barcode || undefined,
      categoryId: product.categoryId || undefined,
      pricePerUnit: product.pricePerUnit,
      costPrice: product.costPrice,
      taxRate: product.taxRate,
      quantityInStock: 0,
      reorderLevel: product.reorderLevel,
      unitType: product.unitType,
      description: product.description || undefined,
      isRental: product.isRental,
      isBundle: product.isBundle,
    });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteProductMutation.mutate(deleteTarget.id);
  };

  // ----- WhatsApp catalog send -----

  const handleSendCatalogWhatsApp = async () => {
    const phone = waPhone.trim();
    if (!phone) {
      toast.error('Please enter a WhatsApp phone number');
      return;
    }
    try {
      // Try the backend document-sender first (so the store's full catalog is
      // rendered server-side into the WhatsApp message).
      const res = await whatsappApi.sendDocument({
        type: 'inventory',
        storeId: currentStoreId,
        phone,
      });
      if (res?.waLink) {
        window.open(res.waLink, '_blank');
        toast.success('Catalog sent via WhatsApp');
        setWaOpen(false);
        setWaPhone('');
        return;
      }
      throw new Error('No WhatsApp link returned');
    } catch (err) {
      // Fallback: build a wa.me link with the current filtered product list
      try {
        const lines = filteredProducts.slice(0, 40).map(
          (p, i) => `${i + 1}. ${p.name} — ${formatKES(p.pricePerUnit)} (${p.sku})`,
        );
        const header = `*Mbumah Hardware — Product Catalog*\n${filteredProducts.length} item(s) available:\n\n`;
        const footer = `\n\nReply to order. Thank you!`;
        const message = header + lines.join('\n') + footer;
        openWhatsApp(phone, message);
        toast.success('Catalog opened in WhatsApp');
        setWaOpen(false);
        setWaPhone('');
      } catch (e2) {
        const msg = handleError(err, 'Send catalog via WhatsApp');
        toast.error(msg || 'Failed to send catalog');
        // surface the underlying fallback error in console only
        handleError(e2, 'WhatsApp fallback');
      }
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderProductCard = (product: ProductListItem) => {
    const stock = getStockStatus(product.quantityInStock, product.reorderLevel);
    const catImg = getCategoryImage(product.categoryId);
    const qty = getQty(product.id);
    const inCart = cart.items.find((i) => i.productId === product.id);
    const isLow = stock.tone !== 'ok';

    return (
      <Card
        key={product.id}
        className={`group overflow-hidden transition-all duration-200 hover:shadow-lg border-border/60 flex flex-col ${
          isLow ? 'ring-1 ring-amber-300 dark:ring-amber-700/60' : ''
        }`}
      >
        {/* Image / placeholder — prefer product photo, fall back to category image */}
        <div className="relative h-40 bg-muted/30 overflow-hidden">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : catImg ? (
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
          {/* Admin actions */}
          <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-7 w-7 shadow-md"
                  aria-label="Product actions"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); openEditEditor(product); }}>
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleDuplicate(product); }}>
                  <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={(e) => { e.preventDefault(); setDeleteTarget(product); }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-lg font-bold text-primary">{formatKES(product.pricePerUnit)}</span>
            <span className="text-[11px] text-muted-foreground">per {product.unitType.toLowerCase()}</span>
          </div>
          {product.quantityInStock > 0 ? (
            <p className="text-[11px] text-muted-foreground mt-1">
              {product.quantityInStock} in stock
            </p>
          ) : (
            <p className="text-[11px] text-red-600 mt-1">Unavailable</p>
          )}
          {/* Restock hint */}
          {stock.tone === 'low' && (
            <div className="mt-2 rounded-md border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 px-2 py-1 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-[10px] text-amber-700 dark:text-amber-400">
                Restock hint: reorder below {product.reorderLevel} {product.unitType.toLowerCase()}s
              </span>
            </div>
          )}
          {stock.tone === 'out' && (
            <div className="mt-2 rounded-md border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 px-2 py-1 flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-red-600 dark:text-red-400 shrink-0" />
              <span className="text-[10px] text-red-700 dark:text-red-400">
                Restock hint: out of stock — order now
              </span>
            </div>
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
    const isLow = stock.tone !== 'ok';

    return (
      <div
        key={product.id}
        className={`flex items-center gap-4 p-3 rounded-lg border border-border/60 hover:shadow-md transition-all duration-200 bg-card ${
          isLow ? 'ring-1 ring-amber-300 dark:ring-amber-700/60' : ''
        }`}
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
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
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
            {stock.tone !== 'ok' && (
              <span className="text-[10px] text-amber-700 dark:text-amber-400 inline-flex items-center gap-0.5">
                <AlertTriangle className="h-3 w-3" />
                {stock.tone === 'out' ? 'Order now' : `Reorder ≤${product.reorderLevel}`}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">SKU: {product.sku}</p>
          <div className="flex items-baseline gap-2 mt-1 flex-wrap">
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Product actions">
                <MoreVertical className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); openEditEditor(product); }}>
                <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={(e) => { e.preventDefault(); handleDuplicate(product); }}>
                <Copy className="h-3.5 w-3.5 mr-2" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={(e) => { e.preventDefault(); setDeleteTarget(product); }}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

  // ---------------------------------------------------------------------------
  // Loading skeleton
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Margin preview for editor
  // ---------------------------------------------------------------------------

  const editorMargin = (() => {
    const p = Number(form.pricePerUnit) || 0;
    const c = Number(form.costPrice) || 0;
    if (p <= 0) return null;
    return ((p - c) / p) * 100;
  })();

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full gap-4">
      {/* ---- Header bar ---- */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products by name, SKU, barcode, or category..."
            className="pl-10"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search catalog"
          />
          {search && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* WhatsApp send catalog */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWaOpen(true)}
            className="text-green-700 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-700 dark:hover:bg-green-950/30"
          >
            <MessageCircle className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Send Catalog</span>
            <span className="sm:hidden">Send</span>
          </Button>
          {/* Add Product */}
          <Button size="sm" onClick={openAddEditor}>
            <Plus className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Add Product</span>
            <span className="sm:hidden">Add</span>
          </Button>
          {/* Filter toggle */}
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="relative"
          >
            <SlidersHorizontal className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Filters</span>
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
              aria-label="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="icon"
              className="h-8 w-8 rounded-none"
              onClick={() => setViewMode('list')}
              aria-label="List view"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* ---- Filters panel ---- */}
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

      {/* ---- Category quick filters (horizontal scroll) ---- */}
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

      {/* ---- Results count ---- */}
      <div className="flex items-center justify-between text-sm text-muted-foreground flex-wrap gap-2">
        <span>
          {filteredProducts.length} product{filteredProducts.length !== 1 ? 's' : ''} found
          {debouncedSearch && ` for "${debouncedSearch}"`}
        </span>
        {cart.items.length > 0 && (
          <span className="flex items-center gap-1.5 text-primary font-medium">
            <ShoppingCart className="h-3.5 w-3.5" />
            {cart.getItemCount()} item{cart.getItemCount() !== 1 ? 's' : ''} in cart • {formatKES(cart.getTotal())}
          </span>
        )}
      </div>

      <Separator />

      {/* ---- Product grid / list ---- */}
      <div className="flex-1 overflow-y-auto">
        {productsLoading || categoriesLoading ? (
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
              {debouncedSearch || selectedCategory !== 'all' || stockFilter !== 'all'
                ? 'Try adjusting your search or filters to find what you\'re looking for.'
                : 'No products have been added to the catalog yet.'}
            </p>
            <div className="flex gap-2 mt-4">
              {activeFilterCount > 0 && (
                <Button variant="outline" onClick={clearFilters}>
                  Clear All Filters
                </Button>
              )}
              <Button onClick={openAddEditor}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add Product
              </Button>
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredProducts.map(renderProductCard)}
          </div>
        ) : (
          <div className="space-y-3">{filteredProducts.map(renderProductListItem)}</div>
        )}
      </div>

      {/* ---- Product Editor (Add / Edit) — ResponsiveDialog (xl) ---- */}
      <ResponsiveDialog
        open={editorOpen}
        onOpenChange={(open) => { if (!open) closeEditor(); }}
        title={editingProduct ? 'Edit Product' : 'Add New Product'}
        description={editingProduct ? `Update details for ${editingProduct.name}` : 'Add a new product to your catalog'}
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={closeEditor}>Cancel</Button>
            <Button
              onClick={submitEditor}
              disabled={
                createProductMutation.isPending ||
                updateProductMutation.isPending ||
                !form.name.trim() ||
                !form.sku.trim()
              }
            >
              {(createProductMutation.isPending || updateProductMutation.isPending) ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              {editingProduct ? 'Save Changes' : 'Add Product'}
            </Button>
          </>
        }
      >
        <div className="space-y-6">
          {/* Section: Basic Info */}
          <section>
            <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <Package className="h-4 w-4" /> Basic Information
            </h4>
            <Separator className="mb-3" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Product Name <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. 20mm Nails"
                />
              </div>
              <div className="space-y-2">
                <Label>SKU <span className="text-destructive">*</span></Label>
                <Input
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="e.g. NAIL-20"
                />
              </div>
              <div className="space-y-2">
                <Label>Barcode</Label>
                <Input
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  placeholder="e.g. 6001234567890"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Category</Label>
                <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color || '#6B7280' }} />
                          {c.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Description</Label>
                <Textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Detailed product description (size, color, brand, specs)..."
                  rows={3}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <ProductImageUpload
                  value={form.imageUrl}
                  onChange={(url) => setForm({ ...form, imageUrl: url })}
                  productName={form.name}
                />
              </div>
            </div>
          </section>

          {/* Section: Pricing */}
          <section>
            <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" /> Pricing
            </h4>
            <Separator className="mb-3" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Selling Price (KES) <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  value={form.pricePerUnit}
                  onChange={(e) => setForm({ ...form, pricePerUnit: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Cost Price (KES) <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Tax Rate (%)</Label>
                <Input
                  type="number"
                  value={form.taxRate}
                  onChange={(e) => setForm({ ...form, taxRate: e.target.value })}
                  placeholder="16"
                />
              </div>
            </div>
            {editorMargin !== null && (
              <div className="mt-2 rounded-lg border bg-muted/30 p-2 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Profit Margin</span>
                <span className={`text-xs font-semibold ${
                  editorMargin >= 30 ? 'text-green-600' : editorMargin >= 15 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {editorMargin.toFixed(1)}%
                </span>
              </div>
            )}
          </section>

          {/* Section: Stock & Units */}
          <section>
            <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" /> Stock & Units
            </h4>
            <Separator className="mb-3" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Quantity in Stock</Label>
                <Input
                  type="number"
                  value={form.quantityInStock}
                  onChange={(e) => setForm({ ...form, quantityInStock: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Reorder Level</Label>
                <Input
                  type="number"
                  value={form.reorderLevel}
                  onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
                  placeholder="10"
                />
              </div>
              <div className="space-y-2">
                <Label>Unit Type</Label>
                <Select value={form.unitType} onValueChange={(v) => setForm({ ...form, unitType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNIT_TYPES.map((u) => (
                      <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-3 flex items-center gap-6 pt-2">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="rental-cat"
                    checked={form.isRental}
                    onCheckedChange={(v) => setForm({ ...form, isRental: !!v })}
                  />
                  <Label htmlFor="rental-cat" className="text-sm cursor-pointer">Rental Item</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="bundle-cat"
                    checked={form.isBundle}
                    onCheckedChange={(v) => setForm({ ...form, isBundle: !!v })}
                  />
                  <Label htmlFor="bundle-cat" className="text-sm cursor-pointer">Bundle</Label>
                </div>
              </div>
            </div>
          </section>
        </div>
      </ResponsiveDialog>

      {/* ---- Delete confirmation ---- */}
      <ResponsiveDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete Product"
        description={deleteTarget ? `This will permanently remove "${deleteTarget.name}" from your catalog.` : ''}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={deleteProductMutation.isPending}
            >
              {deleteProductMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              Delete
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-lg border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 p-3 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-400">
              This action cannot be undone. The product will be removed from your catalog and any
              existing references (transactions, stock movements) will be preserved for audit history.
            </p>
          </div>
          {deleteTarget && (
            <div className="text-sm text-muted-foreground">
              <strong className="text-foreground">{deleteTarget.name}</strong> · SKU {deleteTarget.sku}
            </div>
          )}
        </div>
      </ResponsiveDialog>

      {/* ---- WhatsApp catalog send ---- */}
      <ResponsiveDialog
        open={waOpen}
        onOpenChange={setWaOpen}
        title="Send Catalog via WhatsApp"
        description="Generate a wa.me link with your current product list (name + price)"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setWaOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSendCatalogWhatsApp}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              <MessageCircle className="h-4 w-4 mr-2" />
              Send
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="space-y-2">
            <Label>WhatsApp Phone Number</Label>
            <Input
              value={waPhone}
              onChange={(e) => setWaPhone(e.target.value)}
              placeholder="e.g. 0712345678 or 254712345678"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              We&apos;ll normalize the number (e.g. 07xx → 2547xx) and open WhatsApp with a pre-filled
              message containing up to 40 of your current products.
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <strong className="text-foreground">{filteredProducts.length}</strong> product(s) will be included
            {debouncedSearch && <> (matching &quot;{debouncedSearch}&quot;)</>}
            {selectedCategory !== 'all' && <> in the selected category</>}.
          </div>
        </div>
      </ResponsiveDialog>
    </div>
  );
}
