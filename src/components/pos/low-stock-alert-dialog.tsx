'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '@/lib/api';
import { formatQtyWithUnit } from '@/lib/utils/financialMath';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, PackageX, CheckCircle } from 'lucide-react';

export function LowStockAlertDialog({
  open,
  onOpenChange,
  storeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
}) {
  const { data: productsData, isLoading } = useQuery({
    queryKey: ['products-lowstock', storeId],
    queryFn: () => productsApi.list({ storeId, limit: 200 }),
    enabled: open,
  });

  const products = Array.isArray(productsData?.data) ? productsData.data : [];

  const outOfStockProducts = useMemo(
    () => products.filter((p) => p.quantityInStock <= 0),
    [products]
  );

  const lowStockProducts = useMemo(
    () => products.filter((p) => p.quantityInStock > 0 && p.quantityInStock <= p.reorderLevel),
    [products]
  );

  const totalAffected = outOfStockProducts.length + lowStockProducts.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Low Stock Alert
          </DialogTitle>
          <DialogDescription>
            {totalAffected} product{totalAffected !== 1 ? 's' : ''} need attention
            — {outOfStockProducts.length} out of stock, {lowStockProducts.length} low stock
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : totalAffected === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-3" />
            <p className="text-sm font-medium">All products are well stocked!</p>
            <p className="text-xs text-muted-foreground mt-1">No items require restocking at this time</p>
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0 max-h-[60vh]">
            <div className="space-y-4 p-1">
              {/* Out of Stock Section */}
              {outOfStockProducts.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <PackageX className="h-4 w-4 text-red-500" />
                    <h4 className="text-sm font-semibold text-red-600 dark:text-red-400">
                      Out of Stock ({outOfStockProducts.length})
                    </h4>
                  </div>
                  <div className="space-y-2">
                    {outOfStockProducts.map((product) => (
                      <div
                        key={product.id}
                        className="p-3 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/10"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{product.name}</p>
                            {product.category && (
                              <p className="text-[10px] text-muted-foreground">{product.category.name}</p>
                            )}
                          </div>
                          <Badge variant="destructive" className="text-[10px] shrink-0">
                            0 in stock
                          </Badge>
                        </div>
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                            <span>Reorder level: {product.reorderLevel}</span>
                            <span className="text-red-500 font-medium">Needs immediate restock</span>
                          </div>
                          <div className="h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-red-500 rounded-full" style={{ width: '2%' }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Low Stock Section */}
              {lowStockProducts.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <h4 className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                      Low Stock ({lowStockProducts.length})
                    </h4>
                  </div>
                  <div className="space-y-2">
                    {lowStockProducts.map((product) => {
                      const stockPercent = product.reorderLevel > 0
                        ? Math.min((product.quantityInStock / (product.reorderLevel * 3)) * 100, 100)
                        : product.quantityInStock > 0 ? 50 : 0;
                      const restockQty = Math.max(product.reorderLevel * 2 - product.quantityInStock, product.reorderLevel);
                      return (
                        <div
                          key={product.id}
                          className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/10"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium">{product.name}</p>
                              {product.category && (
                                <p className="text-[10px] text-muted-foreground">{product.category.name}</p>
                              )}
                            </div>
                            <Badge className="text-[10px] shrink-0 bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                              {product.quantityInStock} left
                            </Badge>
                          </div>
                          <div className="mt-2">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                              <span>Current: {product.quantityInStock} / Reorder at: {product.reorderLevel}</span>
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                Restock ~{formatQtyWithUnit(restockQty, product.unitType)}
                              </span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full transition-all"
                                style={{ width: `${stockPercent}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {totalAffected > 0 && (
                <div className="p-3 rounded-lg border bg-muted/30">
                  <p className="text-xs text-muted-foreground">
                    💡 <strong>Tip:</strong> Consider restocking to at least 2× the reorder level to maintain healthy inventory.
                    Use the <strong>Admin → Stock Adjustment</strong> tool to update stock levels.
                  </p>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
