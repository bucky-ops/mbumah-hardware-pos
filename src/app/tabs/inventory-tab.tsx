'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Package, Search, Plus, AlertTriangle, AlertCircle, DollarSign,
  MoreVertical, Edit, Trash2, Loader2, CheckCircle, Copy, ArrowUpDown,
  Minus, TrendingUp, BarChart3, ChevronUp, ChevronDown, ChevronsUpDown,
  Download, History, ArrowUp, ArrowDown, RotateCcw, X, ImageIcon,
  Filter, ChevronRight, Tag, Palette, Zap, ShoppingCart, Info
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  productsApi, categoriesApi, stockMovementsApi,
  formatKES, formatDate, formatDateTime,
  type ProductListItem,
  type CategoryItem,
  type StockMovementItem,
  type CreateProductPayload,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const CATEGORY_COLORS: Record<string, string> = {
  'Cement & Building': '#6B7280',
  'Iron Sheets & Roofing': '#3B82F6',
  'Paints & Finishes': '#8B5CF6',
  'Steel & Rebar': '#EF4444',
  'Wheelbarrows & Carts': '#F59E0B',
  'Wire & Mesh': '#6366F1',
  'Tools & Equipment': '#10B981',
  'Plumbing & PVC': '#06B6D4',
  'Electrical Supplies': '#F97316',
  'Nails & Fasteners': '#78716C',
};

// Extended palette for custom category colors
const CATEGORY_COLOR_PALETTE = [
  '#6B7280', '#3B82F6', '#8B5CF6', '#EF4444', '#F59E0B',
  '#6366F1', '#10B981', '#06B6D4', '#F97316', '#78716C',
  '#EC4899', '#14B8A6', '#A855F7', '#E11D48', '#84CC16',
  '#0EA5E9', '#D946EF', '#F43F5E', '#22D3EE', '#FBBF24',
];

// Category image mapping (same as page.tsx)
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

function getCategoryColor(name: string): string {
  return CATEGORY_COLORS[name] || '#6B7280';
}

function getProfitMarginColor(margin: number): { text: string; bg: string } {
  if (margin >= 30) return { text: 'text-green-700 dark:text-green-400', bg: 'bg-green-100 dark:bg-green-900/30' };
  if (margin >= 15) return { text: 'text-amber-700 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/30' };
  return { text: 'text-red-700 dark:text-red-400', bg: 'bg-red-100 dark:bg-red-900/30' };
}

// Movement type badge config
function getMovementBadge(type: string): { label: string; className: string } {
  switch (type) {
    case 'PURCHASE':
      return { label: 'PURCHASE', className: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
    case 'SALE':
      return { label: 'SALE', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    case 'ADJUSTMENT':
      return { label: 'ADJUSTMENT', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
    case 'TRANSFER':
      return { label: 'TRANSFER', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' };
    case 'RETURN':
    case 'RENTAL_RETURN':
      return { label: 'RETURN', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' };
    case 'RENTAL_OUT':
      return { label: 'RENTAL', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' };
    default:
      return { label: type.slice(0, 3), className: 'bg-muted text-muted-foreground' };
  }
}

// Movement type options for filter
const MOVEMENT_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: 'PURCHASE', label: 'Purchase' },
  { value: 'SALE', label: 'Sale' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'RETURN', label: 'Return' },
];

type SortField = 'name' | 'sku' | 'pricePerUnit' | 'costPrice' | 'quantityInStock' | 'profitMargin';
type SortDirection = 'asc' | 'desc';

// Sort indicator component
function SortIndicator({ field, sortField, sortDirection }: { field: SortField; sortField: SortField; sortDirection: SortDirection }) {
  if (sortField !== field) return <ChevronsUpDown className="h-3 w-3 text-muted-foreground/40" />;
  return sortDirection === 'asc'
    ? <ChevronUp className="h-3 w-3 text-primary" />
    : <ChevronDown className="h-3 w-3 text-primary" />;
}

// Stock level progress bar with color coding
function StockLevelBar({ product }: { product: ProductListItem }) {
  const ratio = product.reorderLevel > 0 ? product.quantityInStock / (product.reorderLevel * 3) : 1;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const barColor = product.quantityInStock <= 0
    ? 'bg-red-500'
    : product.quantityInStock <= product.reorderLevel
      ? 'bg-amber-500'
      : 'bg-green-500';
  return (
    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Mini stock bar for table rows
function MiniStockBar({ product }: { product: ProductListItem }) {
  const ratio = product.reorderLevel > 0 ? product.quantityInStock / (product.reorderLevel * 3) : 1;
  const pct = Math.min(100, Math.max(0, ratio * 100));
  const barColor = product.quantityInStock <= 0
    ? 'bg-red-500'
    : product.quantityInStock <= product.reorderLevel
      ? 'bg-amber-500'
      : 'bg-green-500';
  return (
    <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Stock status badge
function StockStatusBadge({ product }: { product: ProductListItem }) {
  if (product.quantityInStock <= 0) {
    return (
      <Badge variant="destructive" className="text-[10px] font-semibold px-2 gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-red-300 animate-pulse" /> Out of Stock
      </Badge>
    );
  }
  if (product.quantityInStock <= product.reorderLevel) {
    return (
      <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] font-semibold px-2 gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Low Stock
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-[10px] font-semibold px-2 bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> In Stock
    </Badge>
  );
}

export default function InventoryTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<ProductListItem | null>(null);
  const [stockFilter, setStockFilter] = useState<string>('all');
  const [adjustStockProduct, setAdjustStockProduct] = useState<ProductListItem | null>(null);
  const [stockAdjustAmount, setStockAdjustAmount] = useState(0);
  const [stockAdjustReason, setStockAdjustReason] = useState('');
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const queryClient = useQueryClient();

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAdjustOpen, setBulkAdjustOpen] = useState(false);
  const [bulkAdjustAmount, setBulkAdjustAmount] = useState(0);
  const [bulkAdjustReason, setBulkAdjustReason] = useState('');

  // Inline quick adjust state
  const [quickAdjustId, setQuickAdjustId] = useState<string | null>(null);
  const [quickAdjustValue, setQuickAdjustValue] = useState('');

  // Product detail modal
  const [detailProduct, setDetailProduct] = useState<ProductListItem | null>(null);

  // Stock movement filters
  const [movementTypeFilter, setMovementTypeFilter] = useState<string>('all');
  const [movementDateFrom, setMovementDateFrom] = useState('');
  const [movementDateTo, setMovementDateTo] = useState('');
  const [expandedMovement, setExpandedMovement] = useState<string | null>(null);
  const [showMovementFilters, setShowMovementFilters] = useState(false);

  // Category management
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('#6B7280');
  const [newCategoryDesc, setNewCategoryDesc] = useState('');

  const [newProduct, setNewProduct] = useState({
    name: '', sku: '', barcode: '', pricePerUnit: '', costPrice: '', quantityInStock: '',
    reorderLevel: '10', unitType: 'PIECE', categoryId: '', description: '',
    isRental: false, isBundle: false,
  });

  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', currentStoreId],
    queryFn: () => productsApi.list({
      storeId: currentStoreId,
      search: searchQuery || undefined,
      limit: 200,
      ...(selectedCategory !== 'all' ? { categoryId: selectedCategory } : {}),
    }),
  });

  const { data: categoriesData } = useQuery({
    queryKey: ['categories', currentStoreId],
    queryFn: () => categoriesApi.list(currentStoreId),
  });

  // Stock movements query for history section with filters
  const { data: stockMovementsData } = useQuery({
    queryKey: ['stock-movements', currentStoreId, movementTypeFilter, movementDateFrom, movementDateTo],
    queryFn: () => stockMovementsApi.list({
      storeId: currentStoreId,
      limit: 50,
      ...(movementTypeFilter !== 'all' ? { movementType: movementTypeFilter } : {}),
    }),
  });

  // Product detail: recent movements for specific product
  const { data: productMovementsData } = useQuery({
    queryKey: ['product-movements', currentStoreId, detailProduct?.id],
    queryFn: () => stockMovementsApi.list({ storeId: currentStoreId, productId: detailProduct?.id, limit: 10 }),
    enabled: !!detailProduct,
  });

  const createProductMutation = useMutation({
    mutationFn: productsApi.create,
    onSuccess: () => {
      toast.success('Product created successfully');
      setAddProductOpen(false);
      setNewProduct({ name: '', sku: '', barcode: '', pricePerUnit: '', costPrice: '', quantityInStock: '', reorderLevel: '10', unitType: 'PIECE', categoryId: '', description: '', isRental: false, isBundle: false });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateProductPayload> }) => productsApi.update(id, data),
    onSuccess: () => {
      toast.success('Product updated');
      setEditProduct(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteProductMutation = useMutation({
    mutationFn: productsApi.delete,
    onSuccess: () => toast.success('Product deleted'),
    onError: (err: Error) => toast.error(err.message),
  });

  const stockAdjustMutation = useMutation({
    mutationFn: stockMovementsApi.createAdjustment,
    onSuccess: () => {
      toast.success('Stock adjusted successfully');
      setAdjustStockProduct(null);
      setStockAdjustAmount(0);
      setStockAdjustReason('');
      queryClient.invalidateQueries({ queryKey: ['products', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Category create mutation
  const createCategoryMutation = useMutation({
    mutationFn: categoriesApi.create,
    onSuccess: () => {
      toast.success('Category created');
      setAddCategoryOpen(false);
      setNewCategoryName('');
      setNewCategoryColor('#6B7280');
      setNewCategoryDesc('');
      queryClient.invalidateQueries({ queryKey: ['categories', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Bulk adjust mutation
  const bulkAdjustMutation = useMutation({
    mutationFn: async ({ productIds, amount, reason }: { productIds: string[]; amount: number; reason: string }) => {
      const results = await Promise.all(
        productIds.map(productId =>
          stockMovementsApi.createAdjustment({
            storeId: currentStoreId,
            productId,
            quantity: amount,
            notes: reason || undefined,
          })
        )
      );
      return results;
    },
    onSuccess: () => {
      toast.success('Bulk stock adjustment applied');
      setSelectedIds(new Set());
      setBulkAdjustOpen(false);
      setBulkAdjustAmount(0);
      setBulkAdjustReason('');
      queryClient.invalidateQueries({ queryKey: ['products', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Quick inline adjust mutation
  const quickAdjustMutation = useMutation({
    mutationFn: ({ productId, amount }: { productId: string; amount: number }) =>
      stockMovementsApi.createAdjustment({
        storeId: currentStoreId,
        productId,
        quantity: amount,
        notes: 'Quick adjustment',
      }),
    onSuccess: () => {
      toast.success('Stock adjusted');
      setQuickAdjustId(null);
      setQuickAdjustValue('');
      queryClient.invalidateQueries({ queryKey: ['products', currentStoreId] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements', currentStoreId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Filtered and sorted products
  const allProducts = productsData?.data || [];
  const filteredProducts = useMemo(() => {
    let result = allProducts.filter((p) => {
      if (stockFilter === 'low') return p.quantityInStock <= p.reorderLevel && p.quantityInStock > 0;
      if (stockFilter === 'out') return p.quantityInStock <= 0;
      if (stockFilter === 'ok') return p.quantityInStock > p.reorderLevel;
      return true;
    });

    // Apply sorting
    result = [...result].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      switch (sortField) {
        case 'name': aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase(); break;
        case 'sku': aVal = a.sku.toLowerCase(); bVal = b.sku.toLowerCase(); break;
        case 'pricePerUnit': aVal = a.pricePerUnit; bVal = b.pricePerUnit; break;
        case 'costPrice': aVal = a.costPrice; bVal = b.costPrice; break;
        case 'quantityInStock': aVal = a.quantityInStock; bVal = b.quantityInStock; break;
        case 'profitMargin':
          aVal = a.pricePerUnit > 0 ? (a.pricePerUnit - a.costPrice) / a.pricePerUnit : 0;
          bVal = b.pricePerUnit > 0 ? (b.pricePerUnit - b.costPrice) / b.pricePerUnit : 0;
          break;
        default: aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase();
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [allProducts, stockFilter, sortField, sortDirection]);

  const categories = categoriesData?.data || [];
  const stockMovements = stockMovementsData?.data || [];
  const productMovements = productMovementsData?.data || [];

  // Filter stock movements by date range
  const filteredStockMovements = useMemo(() => {
    let result = stockMovements;
    if (movementDateFrom) {
      const from = new Date(movementDateFrom);
      result = result.filter((m) => new Date(m.createdAt) >= from);
    }
    if (movementDateTo) {
      const to = new Date(movementDateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter((m) => new Date(m.createdAt) <= to);
    }
    return result;
  }, [stockMovements, movementDateFrom, movementDateTo]);

  // Category product count
  const categoryProductCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    allProducts.forEach((p) => {
      if (p.categoryId) {
        counts[p.categoryId] = (counts[p.categoryId] || 0) + 1;
      }
    });
    return counts;
  }, [allProducts]);

  const lowStockCount = allProducts.filter(p => p.quantityInStock <= p.reorderLevel && p.quantityInStock > 0).length;
  const outOfStockCount = allProducts.filter(p => p.quantityInStock <= 0).length;
  const totalInventoryValue = allProducts.reduce((sum, p) => sum + (p.costPrice * p.quantityInStock), 0);
  const avgProfitMargin = (() => {
    if (allProducts.length === 0) return 0;
    const total = allProducts.reduce((sum, p) => {
      if (p.pricePerUnit > 0) return sum + ((p.pricePerUnit - p.costPrice) / p.pricePerUnit * 100);
      return sum;
    }, 0);
    return total / allProducts.length;
  })();

  // Selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredProducts.length && filteredProducts.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProducts.map(p => p.id)));
    }
  };

  const isAllSelected = filteredProducts.length > 0 && selectedIds.size === filteredProducts.length;

  // Sort handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Export selected products as CSV
  const handleExportSelected = () => {
    const selectedProducts = filteredProducts.filter(p => selectedIds.has(p.id));
    if (selectedProducts.length === 0) {
      toast.error('No products selected');
      return;
    }
    const headers = ['Name', 'SKU', 'Category', 'Price', 'Cost', 'Margin', 'Stock', 'Status'];
    const csvRows = [
      headers.join(','),
      ...selectedProducts.map(p => {
        const margin = p.pricePerUnit > 0 ? ((p.pricePerUnit - p.costPrice) / p.pricePerUnit * 100).toFixed(1) : '0';
        const status = p.quantityInStock <= 0 ? 'Out of Stock' : p.quantityInStock <= p.reorderLevel ? 'Low Stock' : 'In Stock';
        return [p.name, p.sku, p.category?.name || '', p.pricePerUnit, p.costPrice, margin, p.quantityInStock, status]
          .map(v => String(v).includes(',') ? `"${v}"` : v)
          .join(',');
      }),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventory_export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${selectedProducts.length} products`);
  };

  // Bulk delete
  const handleBulkDelete = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    selectedIds.forEach(id => deleteProductMutation.mutate(id));
    setSelectedIds(new Set());
    toast.success(`Deleted ${count} products`);
  };

  const handleCreateProduct = () => {
    createProductMutation.mutate({
      storeId: currentStoreId,
      name: newProduct.name,
      sku: newProduct.sku,
      barcode: newProduct.barcode || undefined,
      pricePerUnit: Number(newProduct.pricePerUnit),
      costPrice: Number(newProduct.costPrice),
      quantityInStock: Number(newProduct.quantityInStock),
      reorderLevel: Number(newProduct.reorderLevel),
      unitType: newProduct.unitType,
      categoryId: newProduct.categoryId || undefined,
      description: newProduct.description || undefined,
      isRental: newProduct.isRental,
      isBundle: newProduct.isBundle,
    });
  };

  const handleDuplicateProduct = (product: ProductListItem) => {
    const dupSku = product.sku + '-COPY';
    createProductMutation.mutate({
      storeId: currentStoreId,
      name: product.name + ' (Copy)',
      sku: dupSku,
      barcode: product.barcode || undefined,
      pricePerUnit: product.pricePerUnit,
      costPrice: product.costPrice,
      quantityInStock: 0,
      reorderLevel: product.reorderLevel,
      unitType: product.unitType,
      categoryId: product.categoryId || undefined,
      description: product.description || undefined,
      isRental: product.isRental,
      isBundle: product.isBundle,
    });
  };

  const handleStockAdjust = () => {
    if (!adjustStockProduct || stockAdjustAmount === 0) return;
    stockAdjustMutation.mutate({
      storeId: currentStoreId,
      productId: adjustStockProduct.id,
      quantity: stockAdjustAmount,
      notes: stockAdjustReason || undefined,
    });
  };

  const handleCreateCategory = () => {
    if (!newCategoryName.trim()) {
      toast.error('Category name is required');
      return;
    }
    createCategoryMutation.mutate({
      storeId: currentStoreId,
      name: newCategoryName.trim(),
      description: newCategoryDesc || undefined,
      color: newCategoryColor,
    });
  };

  // Compute sales velocity (approximate from stock movements)
  const getProductSalesVelocity = (productId: string): number => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const saleMovements = productMovements.filter(
      m => m.movementType === 'SALE' && new Date(m.createdAt) >= thirtyDaysAgo
    );
    return Math.abs(saleMovements.reduce((sum, m) => sum + m.quantity, 0));
  };

  // Get related products (same category)
  const getRelatedProducts = (product: ProductListItem): ProductListItem[] => {
    if (!product.categoryId) return [];
    return allProducts.filter(p => p.categoryId === product.categoryId && p.id !== product.id).slice(0, 5);
  };

  return (
    <div className="space-y-4">
      {/* Low Stock Alert Banner */}
      {(lowStockCount > 0 || outOfStockCount > 0) && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 p-3 flex items-center gap-3 backdrop-blur-sm">
          <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/50">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
          </div>
          <div className="flex-1 text-sm">
            <span className="font-semibold text-amber-800 dark:text-amber-300">
              {outOfStockCount > 0 && `${outOfStockCount} out of stock`}
              {outOfStockCount > 0 && lowStockCount > 0 && ' · '}
              {lowStockCount > 0 && `${lowStockCount} low stock`}
            </span>
            <span className="text-amber-700 dark:text-amber-400"> — items need attention</span>
          </div>
          <div className="flex gap-2">
            {outOfStockCount > 0 && (
              <Button variant="outline" size="sm" className="h-7 text-xs border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => setStockFilter('out')}>
                View Out of Stock
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-7 text-xs border-amber-300 dark:border-amber-700" onClick={() => setStockFilter(lowStockCount > 0 ? 'low' : 'out')}>
              View Issues
            </Button>
          </div>
        </div>
      )}

      {/* Stats Cards with glass-morphism */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-card/80 to-muted/10 border-l-4 border-l-primary hover:-translate-y-0.5 transition-all cursor-default backdrop-blur-sm shadow-sm hover:shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Package className="h-5 w-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Total Products</p>
                <p className="text-xl font-bold">{allProducts.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card/80 to-muted/10 border-l-4 border-l-yellow-500 hover:-translate-y-0.5 transition-all cursor-default backdrop-blur-sm shadow-sm hover:shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30"><AlertTriangle className="h-5 w-5 text-yellow-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Low Stock</p>
                <p className="text-xl font-bold">{lowStockCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card/80 to-muted/10 border-l-4 border-l-red-500 hover:-translate-y-0.5 transition-all cursor-default backdrop-blur-sm shadow-sm hover:shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30"><AlertCircle className="h-5 w-5 text-red-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Out of Stock</p>
                <p className="text-xl font-bold">{outOfStockCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-card/80 to-muted/10 border-l-4 border-l-green-500 hover:-translate-y-0.5 transition-all cursor-default backdrop-blur-sm shadow-sm hover:shadow-md">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30"><DollarSign className="h-5 w-5 text-green-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Inventory Value</p>
                <p className="text-xl font-bold whitespace-nowrap">{formatKES(totalInventoryValue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search products..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-10" />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All Categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color || getCategoryColor(c.name) }} />
                  {c.name}
                  <span className="text-muted-foreground text-xs">({categoryProductCounts[c.id] || 0})</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={stockFilter} onValueChange={setStockFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Stock Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stock</SelectItem>
            <SelectItem value="ok">In Stock</SelectItem>
            <SelectItem value="low">Low Stock</SelectItem>
            <SelectItem value="out">Out of Stock</SelectItem>
          </SelectContent>
        </Select>

        {/* Category management button */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => setAddCategoryOpen(true)}>
                <Tag className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add Category</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Dialog open={addProductOpen} onOpenChange={setAddProductOpen}>
          <DialogTrigger asChild>
            <Button className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground">
              <Plus className="mr-2 h-4 w-4" /> Add Product
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add New Product</DialogTitle>
              <DialogDescription>Add a product to your inventory</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* Section: Basic Info */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" /> Basic Information
                </h4>
                <Separator className="mb-3" />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label>Product Name</Label>
                    <Input value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} placeholder="e.g. 20mm Nails" />
                  </div>
                  <div className="space-y-2">
                    <Label>SKU</Label>
                    <Input value={newProduct.sku} onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })} placeholder="e.g. NAIL-20" />
                  </div>
                  <div className="space-y-2">
                    <Label>Barcode</Label>
                    <Input value={newProduct.barcode} onChange={(e) => setNewProduct({ ...newProduct, barcode: e.target.value })} placeholder="e.g. 6001234567890" />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Category</Label>
                    <Select value={newProduct.categoryId} onValueChange={(v) => setNewProduct({ ...newProduct, categoryId: v })}>
                      <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: c.color || getCategoryColor(c.name) }} />
                              {c.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Description</Label>
                    <Textarea value={newProduct.description} onChange={(e) => setNewProduct({ ...newProduct, description: e.target.value })} placeholder="Product description..." rows={2} />
                  </div>
                </div>
              </div>

              {/* Section: Pricing */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> Pricing
                </h4>
                <Separator className="mb-3" />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Selling Price (KES)</Label>
                    <Input type="number" value={newProduct.pricePerUnit} onChange={(e) => setNewProduct({ ...newProduct, pricePerUnit: e.target.value })} placeholder="0" />
                  </div>
                  <div className="space-y-2">
                    <Label>Cost Price (KES)</Label>
                    <Input type="number" value={newProduct.costPrice} onChange={(e) => setNewProduct({ ...newProduct, costPrice: e.target.value })} placeholder="0" />
                  </div>
                </div>
                {Number(newProduct.pricePerUnit) > 0 && Number(newProduct.costPrice) > 0 && (
                  <div className="mt-2 rounded-lg border bg-muted/30 p-2 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Profit Margin</span>
                    <span className={`text-xs font-semibold ${
                      ((Number(newProduct.pricePerUnit) - Number(newProduct.costPrice)) / Number(newProduct.pricePerUnit) * 100) >= 30
                        ? 'text-green-600' : ((Number(newProduct.pricePerUnit) - Number(newProduct.costPrice)) / Number(newProduct.pricePerUnit) * 100) >= 15
                        ? 'text-amber-600' : 'text-red-600'
                    }`}>
                      {((Number(newProduct.pricePerUnit) - Number(newProduct.costPrice)) / Number(newProduct.pricePerUnit) * 100).toFixed(1)}%
                    </span>
                  </div>
                )}
              </div>

              {/* Section: Stock & Units */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Stock & Units
                </h4>
                <Separator className="mb-3" />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Quantity in Stock</Label>
                    <Input type="number" value={newProduct.quantityInStock} onChange={(e) => setNewProduct({ ...newProduct, quantityInStock: e.target.value })} placeholder="0" />
                  </div>
                  <div className="space-y-2">
                    <Label>Reorder Level</Label>
                    <Input type="number" value={newProduct.reorderLevel} onChange={(e) => setNewProduct({ ...newProduct, reorderLevel: e.target.value })} placeholder="10" />
                  </div>
                  <div className="space-y-2">
                    <Label>Unit Type</Label>
                    <Select value={newProduct.unitType} onValueChange={(v) => setNewProduct({ ...newProduct, unitType: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PIECE">Piece</SelectItem>
                        <SelectItem value="KILOGRAM">Kilogram</SelectItem>
                        <SelectItem value="METER">Meter</SelectItem>
                        <SelectItem value="LITER">Liter</SelectItem>
                        <SelectItem value="BAG">Bag</SelectItem>
                        <SelectItem value="BOX">Box</SelectItem>
                        <SelectItem value="SET">Set</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-4 pt-6">
                    <div className="flex items-center gap-2">
                      <Checkbox id="rental" checked={newProduct.isRental} onCheckedChange={(v) => setNewProduct({ ...newProduct, isRental: !!v })} />
                      <Label htmlFor="rental" className="text-sm">Rental</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox id="bundle" checked={newProduct.isBundle} onCheckedChange={(v) => setNewProduct({ ...newProduct, isBundle: !!v })} />
                      <Label htmlFor="bundle" className="text-sm">Bundle</Label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddProductOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateProduct} disabled={createProductMutation.isPending || !newProduct.name || !newProduct.sku} className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground">
                {createProductMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Add Product
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Category Tags Row */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105 ${
              selectedCategory === 'all'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            All
            <span className="ml-0.5 bg-white/20 dark:bg-black/20 rounded-full px-1.5 py-0.5 text-[10px]">{allProducts.length}</span>
          </button>
          {categories.map((c) => {
            const count = categoryProductCounts[c.id] || 0;
            const color = c.color || getCategoryColor(c.name);
            return (
              <button
                key={c.id}
                onClick={() => setSelectedCategory(c.id === selectedCategory ? 'all' : c.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-105 ${
                  selectedCategory === c.id
                    ? 'text-white shadow-sm'
                    : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                }`}
                style={selectedCategory === c.id ? { backgroundColor: color } : {}}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                {c.name}
                <span className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                  selectedCategory === c.id ? 'bg-white/20' : 'bg-muted'
                }`}>{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Bulk Actions Toolbar */}
      {selectedIds.size > 0 && (
        <div className="rounded-lg border bg-muted/50 p-3 flex items-center gap-3 flex-wrap backdrop-blur-sm">
          <Badge variant="secondary" className="text-xs font-medium">
            {selectedIds.size} selected
          </Badge>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBulkAdjustOpen(true)}>
            <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" /> Adjust Stock
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleExportSelected}>
            <Download className="mr-1.5 h-3.5 w-3.5" /> Export Selected
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs text-destructive hover:text-destructive" onClick={handleBulkDelete}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete Selected
          </Button>
          <div className="ml-auto">
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelectedIds(new Set())}>
              <X className="mr-1 h-3.5 w-3.5" /> Clear Selection
            </Button>
          </div>
        </div>
      )}

      {/* Product Table */}
      <Card className="backdrop-blur-sm shadow-sm">
        <CardContent className="p-0">
          {/* Product count summary */}
          <div className="px-4 py-2 border-b bg-muted/20">
            <p className="text-xs text-muted-foreground">
              Showing <span className="font-medium">{filteredProducts.length}</span> of <span className="font-medium">{allProducts.length}</span> products
              {searchQuery && <span> matching &quot;{searchQuery}&quot;</span>}
              {stockFilter !== 'all' && <span> · {stockFilter === 'ok' ? 'In Stock' : stockFilter === 'low' ? 'Low Stock' : 'Out of Stock'}</span>}
              {selectedCategory !== 'all' && categories.find(c => c.id === selectedCategory) && (
                <span> · {categories.find(c => c.id === selectedCategory)?.name}</span>
              )}
            </p>
          </div>

          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-4"><Skeleton className="h-10 flex-1" /></div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={isAllSelected}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead className="w-[40px]">Img</TableHead>
                    <TableHead className="w-[220px]">
                      <button type="button" className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => handleSort('name')}>
                        Product <SortIndicator field="name" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button type="button" className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => handleSort('sku')}>
                        SKU <SortIndicator field="sku" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">
                      <button type="button" className="flex items-center gap-1 ml-auto hover:text-foreground transition-colors" onClick={() => handleSort('pricePerUnit')}>
                        Price <SortIndicator field="pricePerUnit" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button type="button" className="flex items-center gap-1 ml-auto hover:text-foreground transition-colors" onClick={() => handleSort('costPrice')}>
                        Cost <SortIndicator field="costPrice" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">
                      <button type="button" className="flex items-center gap-1 ml-auto hover:text-foreground transition-colors" onClick={() => handleSort('profitMargin')}>
                        Margin <SortIndicator field="profitMargin" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead className="w-[140px]">
                      <button type="button" className="flex items-center gap-1 hover:text-foreground transition-colors" onClick={() => handleSort('quantityInStock')}>
                        Stock <SortIndicator field="quantityInStock" sortField={sortField} sortDirection={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-16">
                        <div className="flex flex-col items-center gap-4">
                          <div className="p-6 rounded-full bg-gradient-to-br from-muted/50 to-muted/20 backdrop-blur-sm">
                            <Package className="h-12 w-12 text-muted-foreground/30" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-muted-foreground">No products found</p>
                            <p className="text-xs text-muted-foreground/70 mt-1">
                              {searchQuery || stockFilter !== 'all' || selectedCategory !== 'all'
                                ? 'Try adjusting your filters'
                                : 'Add your first product to get started'}
                            </p>
                          </div>
                          {(searchQuery || stockFilter !== 'all' || selectedCategory !== 'all') ? (
                            <Button variant="outline" size="sm" className="text-xs mt-1" onClick={() => { setSearchQuery(''); setStockFilter('all'); setSelectedCategory('all'); }}>
                              Clear Filters
                            </Button>
                          ) : (
                            <Button size="sm" className="text-xs bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground" onClick={() => setAddProductOpen(true)}>
                              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Your First Product
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredProducts.map((product, idx) => {
                      const profitMargin = product.pricePerUnit > 0
                        ? ((product.pricePerUnit - product.costPrice) / product.pricePerUnit * 100)
                        : 0;
                      const marginColor = getProfitMarginColor(profitMargin);
                      const catColor = product.category?.name ? getCategoryColor(product.category.name) : '#6B7280';
                      const catImage = getCategoryImage(product.categoryId);
                      const isQuickAdjusting = quickAdjustId === product.id;

                      return (
                        <TableRow
                          key={product.id}
                          className={`${idx % 2 === 1 ? 'bg-muted/20' : ''} ${selectedIds.has(product.id) ? 'bg-primary/5' : ''} hover:bg-primary/5 transition-colors group`}
                        >
                          <TableCell>
                            <Checkbox
                              checked={selectedIds.has(product.id)}
                              onCheckedChange={() => toggleSelect(product.id)}
                              aria-label={`Select ${product.name}`}
                            />
                          </TableCell>
                          <TableCell>
                            {catImage ? (
                              <div className="w-8 h-8 rounded overflow-hidden bg-muted shrink-0 group-hover:scale-110 transition-transform cursor-pointer" onClick={() => setDetailProduct(product)}>
                                <img src={catImage} alt={product.category?.name || 'Product category'} className="h-full w-full object-cover" />
                              </div>
                            ) : (
                              <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform cursor-pointer" onClick={() => setDetailProduct(product)}>
                                <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <div>
                                <p className="font-medium text-sm group-hover:text-primary transition-colors cursor-pointer" onClick={() => setDetailProduct(product)}>{product.name}</p>
                                <div className="flex gap-1 mt-0.5">
                                  {product.isRental && <Badge variant="outline" className="text-[9px] h-4 px-1">RENTAL</Badge>}
                                  {product.isBundle && <Badge variant="outline" className="text-[9px] h-4 px-1">BUNDLE</Badge>}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm font-mono">{product.sku}</TableCell>
                          <TableCell className="text-sm">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: catColor }} />
                              <span className="truncate max-w-[100px]">{product.category?.name || '—'}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatKES(product.pricePerUnit)}</TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground">{formatKES(product.costPrice)}</TableCell>
                          <TableCell className="text-right">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${marginColor.bg} ${marginColor.text}`}>
                              {profitMargin.toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell>
                            {isQuickAdjusting ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  type="number"
                                  value={quickAdjustValue}
                                  onChange={(e) => setQuickAdjustValue(e.target.value)}
                                  className="h-7 w-16 text-xs text-center"
                                  placeholder="+/-"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      const val = Number(quickAdjustValue);
                                      if (val !== 0) {
                                        quickAdjustMutation.mutate({ productId: product.id, amount: val });
                                      }
                                    } else if (e.key === 'Escape') {
                                      setQuickAdjustId(null);
                                      setQuickAdjustValue('');
                                    }
                                  }}
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => {
                                    const val = Number(quickAdjustValue);
                                    if (val !== 0) {
                                      quickAdjustMutation.mutate({ productId: product.id, amount: val });
                                    }
                                  }}
                                  disabled={quickAdjustMutation.isPending}
                                >
                                  <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => { setQuickAdjustId(null); setQuickAdjustValue(''); }}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ) : (
                              <div className="space-y-1 flex items-center gap-2">
                                <div className="flex-1">
                                  <span className="text-sm font-medium">{product.quantityInStock}</span>
                                  <MiniStockBar product={product} />
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                  onClick={() => {
                                    setQuickAdjustId(product.id);
                                    setQuickAdjustValue('');
                                  }}
                                  title="Quick stock adjust (+/-)"
                                >
                                  <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <StockStatusBadge product={product} />
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setDetailProduct(product)}>
                                  <Info className="mr-2 h-4 w-4" /> View Details
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setEditProduct(product)}>
                                  <Edit className="mr-2 h-4 w-4" /> Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDuplicateProduct(product)}>
                                  <Copy className="mr-2 h-4 w-4" /> Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => {
                                  setAdjustStockProduct(product);
                                  setStockAdjustAmount(0);
                                  setStockAdjustReason('');
                                }}>
                                  <ArrowUpDown className="mr-2 h-4 w-4" /> Adjust Stock
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => deleteProductMutation.mutate(product.id)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stock Movement History with Filters */}
      <Card className="backdrop-blur-sm shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" /> Recent Stock Movements
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{filteredStockMovements.length} records</Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setShowMovementFilters(!showMovementFilters)}
              >
                <Filter className="mr-1.5 h-3 w-3" />
                {showMovementFilters ? 'Hide Filters' : 'Show Filters'}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {/* Movement Filters */}
          {showMovementFilters && (
            <div className="mb-4 p-3 rounded-lg border bg-muted/20 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Movement Type</Label>
                  <Select value={movementTypeFilter} onValueChange={setMovementTypeFilter}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MOVEMENT_TYPE_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Date From</Label>
                  <Input type="date" value={movementDateFrom} onChange={(e) => setMovementDateFrom(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Date To</Label>
                  <Input type="date" value={movementDateTo} onChange={(e) => setMovementDateTo(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              {(movementTypeFilter !== 'all' || movementDateFrom || movementDateTo) && (
                <div className="flex justify-end">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setMovementTypeFilter('all'); setMovementDateFrom(''); setMovementDateTo(''); }}>
                    <RotateCcw className="mr-1 h-3 w-3" /> Reset Filters
                  </Button>
                </div>
              )}
            </div>
          )}

          {filteredStockMovements.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-3">
              <div className="p-5 rounded-full bg-gradient-to-br from-muted/50 to-muted/20 backdrop-blur-sm">
                <RotateCcw className="h-10 w-10 text-muted-foreground/20" />
              </div>
              <p className="text-sm text-muted-foreground">No stock movements recorded yet</p>
              <p className="text-xs text-muted-foreground/70">Movements will appear when you adjust stock or make sales</p>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[30px]"></TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Qty Change</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStockMovements.map((movement: StockMovementItem) => {
                    const badge = getMovementBadge(movement.movementType);
                    const isExpanded = expandedMovement === movement.id;
                    return (
                      <React.Fragment key={movement.id}>
                        <TableRow
                          className={`hover:bg-primary/5 transition-colors cursor-pointer ${isExpanded ? 'bg-primary/5' : ''}`}
                          onClick={() => setExpandedMovement(isExpanded ? null : movement.id)}
                        >
                          <TableCell>
                            <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {new Date(movement.createdAt).toLocaleDateString('en-KE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </TableCell>
                          <TableCell className="text-sm">
                            {movement.product?.name || 'Unknown'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] font-semibold px-2 ${badge.className}`}>
                              {badge.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={`text-sm font-mono font-medium ${movement.quantity > 0 ? 'text-green-600' : movement.quantity < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                              {movement.quantity > 0 ? '+' : ''}{movement.quantity}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                            {movement.notes || '—'}
                          </TableCell>
                        </TableRow>
                        {isExpanded && (
                          <TableRow className="bg-muted/10">
                            <TableCell colSpan={6} className="p-3">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                <div>
                                  <span className="text-muted-foreground">Movement ID</span>
                                  <p className="font-mono mt-0.5">{movement.id.slice(0, 8)}...</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Full Date</span>
                                  <p className="mt-0.5">{formatDateTime(movement.createdAt)}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Performed By</span>
                                  <p className="mt-0.5">{movement.performedBy || 'System'}</p>
                                </div>
                                <div>
                                  <span className="text-muted-foreground">Reference</span>
                                  <p className="font-mono mt-0.5">{movement.referenceId || '—'}</p>
                                </div>
                                {movement.notes && (
                                  <div className="col-span-2 sm:col-span-4">
                                    <span className="text-muted-foreground">Notes</span>
                                    <p className="mt-0.5">{movement.notes}</p>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Product Detail Modal */}
      <Dialog open={!!detailProduct} onOpenChange={(open) => !open && setDetailProduct(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {detailProduct && (
                <>
                  {(() => {
                    const img = getCategoryImage(detailProduct.categoryId);
                    return img ? (
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted shrink-0">
                        <img src={img} alt={detailProduct.category?.name || ''} className="h-full w-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <Package className="h-5 w-5 text-muted-foreground" />
                      </div>
                    );
                  })()}
                  <div>
                    <span>{detailProduct.name}</span>
                    <p className="text-xs font-normal text-muted-foreground mt-0.5">{detailProduct.sku}</p>
                  </div>
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          {detailProduct && (() => {
            const profitMargin = detailProduct.pricePerUnit > 0
              ? ((detailProduct.pricePerUnit - detailProduct.costPrice) / detailProduct.pricePerUnit * 100)
              : 0;
            const marginColor = getProfitMarginColor(profitMargin);
            const relatedProducts = getRelatedProducts(detailProduct);
            const salesVelocity = getProductSalesVelocity(detailProduct.id);
            const stockRatio = detailProduct.reorderLevel > 0
              ? detailProduct.quantityInStock / (detailProduct.reorderLevel * 3)
              : 1;
            const stockPct = Math.min(100, Math.max(0, stockRatio * 100));

            return (
              <div className="space-y-5">
                {/* Price & Margin Section */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Selling Price</p>
                    <p className="text-lg font-bold text-green-600">{formatKES(detailProduct.pricePerUnit)}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Cost Price</p>
                    <p className="text-lg font-bold text-muted-foreground">{formatKES(detailProduct.costPrice)}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Profit Margin</p>
                    <p className={`text-lg font-bold ${marginColor.text}`}>{profitMargin.toFixed(1)}%</p>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Profit/Unit</p>
                    <p className="text-lg font-bold">{formatKES(detailProduct.pricePerUnit - detailProduct.costPrice)}</p>
                  </div>
                </div>

                {/* Stock Level with Visual Bar */}
                <div className="rounded-lg border bg-gradient-to-r from-muted/30 to-muted/10 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" /> Stock Level
                    </h4>
                    <StockStatusBadge product={detailProduct} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Current: <span className="font-medium text-foreground">{detailProduct.quantityInStock}</span> {detailProduct.unitType.toLowerCase()}s</span>
                      <span className="text-muted-foreground">Reorder Level: <span className="font-medium text-foreground">{detailProduct.reorderLevel}</span></span>
                    </div>
                    <div className="relative">
                      <StockLevelBar product={detailProduct} />
                      {detailProduct.reorderLevel > 0 && (
                        <div
                          className="absolute top-0 h-2 border-l-2 border-dashed border-amber-500"
                          style={{ left: `${Math.min(100, (detailProduct.reorderLevel / (detailProduct.reorderLevel * 3)) * 100)}%` }}
                        />
                      )}
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0</span>
                      <span className="text-amber-500">Reorder: {detailProduct.reorderLevel}</span>
                      <span>{detailProduct.reorderLevel * 3}+</span>
                    </div>
                  </div>
                </div>

                {/* Sales Velocity */}
                <div className="rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-500" /> Sales Velocity
                    </h4>
                    <span className="text-lg font-bold">{salesVelocity} <span className="text-xs font-normal text-muted-foreground">units/30d</span></span>
                  </div>
                  {salesVelocity > 0 && detailProduct.quantityInStock > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Est. {Math.round(detailProduct.quantityInStock / salesVelocity * 30)} days of stock remaining
                    </p>
                  )}
                  {salesVelocity === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">No sales in the last 30 days</p>
                  )}
                </div>

                {/* Category & Details */}
                <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Info className="h-4 w-4" /> Product Details
                  </h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Category:</span>{' '}
                      {detailProduct.category ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: detailProduct.category.color || getCategoryColor(detailProduct.category.name) }} />
                          {detailProduct.category.name}
                        </span>
                      ) : '—'}
                    </div>
                    <div><span className="text-muted-foreground">Unit Type:</span> {detailProduct.unitType}</div>
                    <div><span className="text-muted-foreground">Barcode:</span> {detailProduct.barcode || '—'}</div>
                    <div><span className="text-muted-foreground">Rental:</span> {detailProduct.isRental ? 'Yes' : 'No'}</div>
                    <div><span className="text-muted-foreground">Bundle:</span> {detailProduct.isBundle ? 'Yes' : 'No'}</div>
                    <div><span className="text-muted-foreground">Created:</span> {formatDate(detailProduct.createdAt)}</div>
                  </div>
                  {detailProduct.description && (
                    <div className="mt-2 pt-2 border-t">
                      <p className="text-xs text-muted-foreground">{detailProduct.description}</p>
                    </div>
                  )}
                </div>

                {/* Recent Movements for this product */}
                {productMovements.length > 0 && (
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
                      <History className="h-4 w-4" /> Recent Movements
                    </h4>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                      {productMovements.slice(0, 5).map((m) => {
                        const badge = getMovementBadge(m.movementType);
                        return (
                          <div key={m.id} className="flex items-center justify-between p-2 rounded border bg-card text-xs">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${badge.className}`}>{badge.label}</Badge>
                              <span className="text-muted-foreground">{formatDate(m.createdAt)}</span>
                            </div>
                            <span className={`font-mono font-medium ${m.quantity > 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {m.quantity > 0 ? '+' : ''}{m.quantity}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Related Products */}
                {relatedProducts.length > 0 && (
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <h4 className="text-sm font-semibold flex items-center gap-2 mb-3">
                      <ShoppingCart className="h-4 w-4" /> Related Products
                    </h4>
                    <div className="space-y-2">
                      {relatedProducts.map((rp) => (
                        <div
                          key={rp.id}
                          className="flex items-center justify-between p-2 rounded border bg-card hover:bg-muted/50 transition-colors cursor-pointer"
                          onClick={() => setDetailProduct(rp)}
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded bg-muted flex items-center justify-center">
                              <Package className="h-3.5 w-3.5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="text-xs font-medium">{rp.name}</p>
                              <p className="text-[10px] text-muted-foreground">{rp.sku}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium">{formatKES(rp.pricePerUnit)}</p>
                            <p className="text-[10px] text-muted-foreground">Stock: {rp.quantityInStock}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => {
                      setDetailProduct(null);
                      setEditProduct(detailProduct);
                    }}
                  >
                    <Edit className="mr-2 h-4 w-4" /> Edit Product
                  </Button>
                  <Button
                    className="flex-1 bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
                    onClick={() => {
                      setDetailProduct(null);
                      setAdjustStockProduct(detailProduct);
                      setStockAdjustAmount(0);
                      setStockAdjustReason('');
                    }}
                  >
                    <ArrowUpDown className="mr-2 h-4 w-4" /> Adjust Stock
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Edit Product Dialog */}
      <Dialog open={!!editProduct} onOpenChange={(open) => !open && setEditProduct(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>Update product details</DialogDescription>
          </DialogHeader>
          {editProduct && (
            <div className="space-y-4">
              {/* Section: Basic Info */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" /> Basic Information
                </h4>
                <Separator className="mb-3" />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <Label>Product Name</Label>
                    <Input value={editProduct.name} onChange={(e) => setEditProduct({ ...editProduct, name: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>SKU</Label>
                    <Input value={editProduct.sku} onChange={(e) => setEditProduct({ ...editProduct, sku: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Barcode</Label>
                    <Input value={editProduct.barcode || ''} onChange={(e) => setEditProduct({ ...editProduct, barcode: e.target.value })} />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <Label>Description</Label>
                    <Textarea value={editProduct.description || ''} onChange={(e) => setEditProduct({ ...editProduct, description: e.target.value })} rows={2} />
                  </div>
                </div>
              </div>

              {/* Section: Pricing */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> Pricing
                </h4>
                <Separator className="mb-3" />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Selling Price</Label>
                    <Input type="number" value={editProduct.pricePerUnit} onChange={(e) => setEditProduct({ ...editProduct, pricePerUnit: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Cost Price</Label>
                    <Input type="number" value={editProduct.costPrice} onChange={(e) => setEditProduct({ ...editProduct, costPrice: Number(e.target.value) })} />
                  </div>
                </div>
              </div>

              {/* Section: Stock & Units */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Stock & Units
                </h4>
                <Separator className="mb-3" />
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Stock</Label>
                    <Input type="number" value={editProduct.quantityInStock} onChange={(e) => setEditProduct({ ...editProduct, quantityInStock: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Reorder Level</Label>
                    <Input type="number" value={editProduct.reorderLevel} onChange={(e) => setEditProduct({ ...editProduct, reorderLevel: Number(e.target.value) })} />
                  </div>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProduct(null)}>Cancel</Button>
            <Button
              onClick={() => editProduct && updateProductMutation.mutate({ id: editProduct.id, data: editProduct as unknown as Partial<CreateProductPayload> })}
              disabled={updateProductMutation.isPending}
            >
              {updateProductMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Adjust Stock Dialog */}
      <Dialog open={!!adjustStockProduct} onOpenChange={(open) => !open && setAdjustStockProduct(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpDown className="h-5 w-5 text-accent-orange" />
              Adjust Stock
            </DialogTitle>
            <DialogDescription>
              Adjust stock for {adjustStockProduct?.name}
            </DialogDescription>
          </DialogHeader>
          {adjustStockProduct && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-gradient-to-r from-muted/30 to-muted/10 p-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Current Stock</span>
                  <span className="text-sm font-bold">{adjustStockProduct.quantityInStock} {adjustStockProduct.unitType.toLowerCase()}s</span>
                </div>
                <StockLevelBar product={adjustStockProduct} />
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Reorder Level</span>
                  <span className="text-sm">{adjustStockProduct.reorderLevel}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Adjustment Amount</Label>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    onClick={() => setStockAdjustAmount(Math.max(stockAdjustAmount - 1, -adjustStockProduct.quantityInStock))}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input
                    type="number"
                    value={stockAdjustAmount}
                    onChange={(e) => setStockAdjustAmount(Number(e.target.value))}
                    className="text-center text-lg font-bold"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-10 w-10 shrink-0"
                    onClick={() => setStockAdjustAmount(stockAdjustAmount + 1)}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setStockAdjustAmount(-5)}>-5</Button>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setStockAdjustAmount(-1)}>-1</Button>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setStockAdjustAmount(1)}>+1</Button>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setStockAdjustAmount(5)}>+5</Button>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setStockAdjustAmount(10)}>+10</Button>
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setStockAdjustAmount(50)}>+50</Button>
                </div>
              </div>

              {stockAdjustAmount !== 0 && (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">New Stock</span>
                    <span className={`text-sm font-bold ${adjustStockProduct.quantityInStock + stockAdjustAmount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {adjustStockProduct.quantityInStock + stockAdjustAmount} {adjustStockProduct.unitType.toLowerCase()}s
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Reason <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  value={stockAdjustReason}
                  onChange={(e) => setStockAdjustReason(e.target.value)}
                  placeholder="e.g. Stock count correction, damaged goods..."
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustStockProduct(null)}>Cancel</Button>
            <Button
              className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
              disabled={stockAdjustMutation.isPending || stockAdjustAmount === 0}
              onClick={handleStockAdjust}
            >
              {stockAdjustMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowUpDown className="mr-2 h-4 w-4" />}
              Apply Adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Adjust Stock Dialog */}
      <Dialog open={bulkAdjustOpen} onOpenChange={setBulkAdjustOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpDown className="h-5 w-5 text-accent-orange" />
              Bulk Stock Adjustment
            </DialogTitle>
            <DialogDescription>
              Adjust stock for {selectedIds.size} selected products
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-sm text-muted-foreground">
                This will apply the same quantity adjustment to <span className="font-medium">{selectedIds.size}</span> products.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Adjustment Amount (positive to add, negative to subtract)</Label>
              <Input
                type="number"
                value={bulkAdjustAmount}
                onChange={(e) => setBulkAdjustAmount(Number(e.target.value))}
                className="text-center text-lg font-bold"
              />
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setBulkAdjustAmount(-10)}>-10</Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setBulkAdjustAmount(-5)}>-5</Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setBulkAdjustAmount(5)}>+5</Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setBulkAdjustAmount(10)}>+10</Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={() => setBulkAdjustAmount(50)}>+50</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={bulkAdjustReason}
                onChange={(e) => setBulkAdjustReason(e.target.value)}
                placeholder="e.g. Stock count correction..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAdjustOpen(false)}>Cancel</Button>
            <Button
              className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
              disabled={bulkAdjustMutation.isPending || bulkAdjustAmount === 0}
              onClick={() => bulkAdjustMutation.mutate({
                productIds: Array.from(selectedIds),
                amount: bulkAdjustAmount,
                reason: bulkAdjustReason,
              })}
            >
              {bulkAdjustMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowUpDown className="mr-2 h-4 w-4" />}
              Apply to {selectedIds.size} Products
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Category Dialog */}
      <Dialog open={addCategoryOpen} onOpenChange={setAddCategoryOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-accent-orange" />
              Add New Category
            </DialogTitle>
            <DialogDescription>Create a new product category</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Category Name</Label>
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="e.g. Safety Equipment"
              />
            </div>
            <div className="space-y-2">
              <Label>Description <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={newCategoryDesc}
                onChange={(e) => setNewCategoryDesc(e.target.value)}
                placeholder="Category description..."
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Palette className="h-4 w-4" /> Color
              </Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_COLOR_PALETTE.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`w-7 h-7 rounded-full transition-all hover:scale-110 ${
                      newCategoryColor === color ? 'ring-2 ring-offset-2 ring-primary scale-110' : ''
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewCategoryColor(color)}
                  />
                ))}
              </div>
            </div>
            {/* Preview */}
            {newCategoryName && (
              <div className="rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground mb-1">Preview</p>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: newCategoryColor }} />
                  <span className="text-sm font-medium">{newCategoryName}</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddCategoryOpen(false)}>Cancel</Button>
            <Button
              className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground"
              disabled={createCategoryMutation.isPending || !newCategoryName.trim()}
              onClick={handleCreateCategory}
            >
              {createCategoryMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
