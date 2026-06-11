'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Package, Search, Plus, AlertTriangle, AlertCircle, DollarSign,
  MoreVertical, Edit, Trash2, Loader2, CheckCircle
} from 'lucide-react';

import { useAppStore } from '@/lib/stores';
import {
  productsApi, categoriesApi,
  formatKES,
  type ProductListItem,
  type CategoryItem,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';

export default function InventoryTab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<ProductListItem | null>(null);
  const [stockFilter, setStockFilter] = useState<string>('all');
  const currentStoreId = useAppStore((s) => s.currentStoreId);

  const [newProduct, setNewProduct] = useState({
    name: '', sku: '', pricePerUnit: '', costPrice: '', quantityInStock: '',
    reorderLevel: '10', unitType: 'PIECE', categoryId: '', description: '',
    isRental: false, isBundle: false,
  });

  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products', currentStoreId, searchQuery, selectedCategory, stockFilter],
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

  const createProductMutation = useMutation({
    mutationFn: productsApi.create,
    onSuccess: () => {
      toast.success('Product created successfully');
      setAddProductOpen(false);
      setNewProduct({ name: '', sku: '', pricePerUnit: '', costPrice: '', quantityInStock: '', reorderLevel: '10', unitType: 'PIECE', categoryId: '', description: '', isRental: false, isBundle: false });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ProductListItem> }) => productsApi.update(id, data),
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

  const products = (productsData?.data || []).filter((p) => {
    if (stockFilter === 'low') return p.quantityInStock <= p.reorderLevel && p.quantityInStock > 0;
    if (stockFilter === 'out') return p.quantityInStock <= 0;
    if (stockFilter === 'ok') return p.quantityInStock > p.reorderLevel;
    return true;
  });

  const categories = categoriesData?.data || [];
  const lowStockCount = (productsData?.data || []).filter(p => p.quantityInStock <= p.reorderLevel && p.quantityInStock > 0).length;
  const outOfStockCount = (productsData?.data || []).filter(p => p.quantityInStock <= 0).length;
  const totalInventoryValue = (productsData?.data || []).reduce((sum, p) => sum + (p.costPrice * p.quantityInStock), 0);

  const handleCreateProduct = () => {
    createProductMutation.mutate({
      storeId: currentStoreId,
      name: newProduct.name,
      sku: newProduct.sku,
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

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Package className="h-5 w-5 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Total Products</p>
                <p className="text-xl font-bold">{productsData?.data?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
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
        <Card>
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
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30"><DollarSign className="h-5 w-5 text-green-600" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Inventory Value</p>
                <p className="text-xl font-bold">{formatKES(totalInventoryValue)}</p>
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
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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
        <Dialog open={addProductOpen} onOpenChange={setAddProductOpen}>
          <DialogTrigger asChild>
            <Button className="bg-accent-orange hover:bg-accent-orange/90 text-accent-orange-foreground">
              <Plus className="mr-2 h-4 w-4" /> Add Product
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add New Product</DialogTitle>
              <DialogDescription>Add a product to your inventory</DialogDescription>
            </DialogHeader>
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
                <Label>Category</Label>
                <Select value={newProduct.categoryId} onValueChange={(v) => setNewProduct({ ...newProduct, categoryId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Selling Price (KES)</Label>
                <Input type="number" value={newProduct.pricePerUnit} onChange={(e) => setNewProduct({ ...newProduct, pricePerUnit: e.target.value })} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label>Cost Price (KES)</Label>
                <Input type="number" value={newProduct.costPrice} onChange={(e) => setNewProduct({ ...newProduct, costPrice: e.target.value })} placeholder="0" />
              </div>
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

      {/* Product Table */}
      <Card>
        <CardContent className="p-0">
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
                    <TableHead className="w-[250px]">Product</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        No products found
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded bg-muted flex items-center justify-center shrink-0">
                              <Package className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-sm">{product.name}</p>
                              <div className="flex gap-1 mt-0.5">
                                {product.isRental && <Badge variant="outline" className="text-[9px] h-4 px-1">RENTAL</Badge>}
                                {product.isBundle && <Badge variant="outline" className="text-[9px] h-4 px-1">BUNDLE</Badge>}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-mono">{product.sku}</TableCell>
                        <TableCell className="text-sm">{product.category?.name || '—'}</TableCell>
                        <TableCell className="text-right font-medium">{formatKES(product.pricePerUnit)}</TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">{formatKES(product.costPrice)}</TableCell>
                        <TableCell className="text-right">{product.quantityInStock}</TableCell>
                        <TableCell>
                          {product.quantityInStock <= 0 ? (
                            <Badge variant="destructive" className="text-[10px]">Out</Badge>
                          ) : product.quantityInStock <= product.reorderLevel ? (
                            <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 text-[10px]">Low</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">In Stock</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setEditProduct(product)}>
                                <Edit className="mr-2 h-4 w-4" /> Edit
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
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Product Dialog */}
      <Dialog open={!!editProduct} onOpenChange={(open) => !open && setEditProduct(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>Update product details</DialogDescription>
          </DialogHeader>
          {editProduct && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Product Name</Label>
                <Input value={editProduct.name} onChange={(e) => setEditProduct({ ...editProduct, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Selling Price</Label>
                <Input type="number" value={editProduct.pricePerUnit} onChange={(e) => setEditProduct({ ...editProduct, pricePerUnit: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Cost Price</Label>
                <Input type="number" value={editProduct.costPrice} onChange={(e) => setEditProduct({ ...editProduct, costPrice: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Stock</Label>
                <Input type="number" value={editProduct.quantityInStock} onChange={(e) => setEditProduct({ ...editProduct, quantityInStock: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Reorder Level</Label>
                <Input type="number" value={editProduct.reorderLevel} onChange={(e) => setEditProduct({ ...editProduct, reorderLevel: Number(e.target.value) })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProduct(null)}>Cancel</Button>
            <Button
              onClick={() => editProduct && updateProductMutation.mutate({ id: editProduct.id, data: editProduct })}
              disabled={updateProductMutation.isPending}
            >
              {updateProductMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
