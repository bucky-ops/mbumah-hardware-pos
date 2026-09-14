"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, PackagePlus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Product, ProductUnit } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// NewProductDialog — MANAGER+ product creation against POST /api/products.
//
//  • Client validation mirrors the server zod (name/sku ≥3 chars, prices > 0,
//    sellingPrice > buyingPrice, non-negative stock/reorder) so obviously
//    invalid submissions never leave the browser — the API re-validates.
//  • Live margin badge ((sell − buy) ÷ sell) warns about mispriced items
//    before they reach the POS.
//  • Opening stock > 0 is journaled server-side as a RESTOCK movement with
//    unitCost = buyingPrice, so the stock ledger reconciles from day one.
//  • branchId: taken from the optional prop; otherwise resolved via
//    /api/auth/me when the dialog opens (HttpOnly cookie session).
//
//  Form state lives in <NewProductForm>, which only mounts while the Radix
//  dialog is open — every reopen starts from a pristine form with no
//  reset-on-open effects.
// ─────────────────────────────────────────────────────────────────────────────

/** Product as returned by POST /api/products (decimals serialized as strings). */
export type CreatedProduct = Product;

export interface NewProductDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Called with the freshly created product after a 201. */
  onCreated: (p: CreatedProduct) => void;
  /** Known category names feeding the category Select. */
  categories: string[];
  /** Optional next-SKU suggestion (e.g. "MBM-HQ-0117") prefilling the editable SKU field. */
  suggestedSku?: string;
  /** Branch to create in; resolved from /api/auth/me when omitted. */
  branchId?: string;
}

const UNITS: ProductUnit[] = ["PCS", "KG", "M", "FT", "BOX", "LTR"];
const NEW_CATEGORY = "__new__"; // sentinel Select value → free-text category entry

type FieldName = "name" | "sku" | "category" | "buyingPrice" | "sellingPrice" | "stockQty" | "reorderLevel";

function NewProductForm({
  categories, suggestedSku, branchId: branchIdProp, onCreated, onOpenChange,
}: Pick<NewProductDialogProps, "categories" | "suggestedSku" | "onCreated" | "onOpenChange"> & { branchId?: string }) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState(suggestedSku ?? "");
  const [category, setCategory] = useState(categories[0] ?? NEW_CATEGORY);
  const [newCategory, setNewCategory] = useState("");
  const [unit, setUnit] = useState<ProductUnit>("PCS");
  const [buyingPrice, setBuyingPrice] = useState("");
  const [sellingPrice, setSellingPrice] = useState("");
  const [stockQty, setStockQty] = useState("0");
  const [reorderLevel, setReorderLevel] = useState("5");
  const [barcode, setBarcode] = useState("");
  const [hsCode, setHsCode] = useState("");
  const [isTaxExempt, setIsTaxExempt] = useState(false);

  const [branchId, setBranchId] = useState<string | null>(branchIdProp ?? null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  // Resolve the session branch when the parent didn't pass one. setState only
  // happens after await (async), so no synchronous set-state-in-effect.
  useEffect(() => {
    if (branchIdProp) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as { user?: { branchId?: string } } | null;
        if (cancelled) return;
        if (!res.ok || !data?.user?.branchId) throw new Error("no session");
        setBranchId(data.user.branchId);
      } catch {
        if (!cancelled) {
          setBranchError("Could not resolve your branch from the session — reopen the dialog or sign in again.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [branchIdProp]);

  const buy = Number.parseFloat(buyingPrice);
  const sell = Number.parseFloat(sellingPrice);
  const stock = Number.parseFloat(stockQty || "0");
  const reorder = Number.parseFloat(reorderLevel || "0");
  const effectiveCategory = category === NEW_CATEGORY ? newCategory.trim() : category.trim();

  // Live mirror of the server-side createProductSchema rules.
  const errors = useMemo(() => {
    const e: Partial<Record<FieldName, string>> = {};
    if (name.trim().length < 3) e.name = "Name must be at least 3 characters";
    if (sku.trim().length < 3) e.sku = "SKU must be at least 3 characters";
    if (!effectiveCategory) e.category = "Category is required";
    if (!Number.isFinite(buy) || buy <= 0) e.buyingPrice = "Buying price must be greater than 0";
    if (!Number.isFinite(sell) || sell <= 0) {
      e.sellingPrice = "Selling price must be greater than 0";
    } else if (Number.isFinite(buy) && sell <= buy) {
      e.sellingPrice = "Selling price must be greater than buying price";
    }
    if (!Number.isFinite(stock) || stock < 0) e.stockQty = "Opening stock must be non-negative";
    if (!Number.isFinite(reorder) || reorder < 0) e.reorderLevel = "Reorder level must be non-negative";
    return e;
  }, [name, sku, effectiveCategory, buy, sell, stock, reorder]);

  const hasErrors = Object.keys(errors).length > 0;

  // Margin hint — only meaningful once both prices parse.
  const margin = Number.isFinite(sell) && sell > 0 && Number.isFinite(buy) && buy > 0
    ? ((sell - buy) / sell) * 100
    : null;

  const fieldError = (f: FieldName) =>
    attempted && errors[f] ? (
      <p className="text-[11px] font-medium text-rose-600" role="alert">{errors[f]}</p>
    ) : null;

  const submit = async () => {
    setAttempted(true);
    if (hasErrors || !branchId || busy) return;
    setBusy(true);
    setServerError(null);
    try {
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: sku.trim(),
          name: name.trim(),
          category: effectiveCategory,
          unit,
          buyingPrice: buy,
          sellingPrice: sell,
          stockQty: Number.isFinite(stock) ? stock : 0,
          reorderLevel: Number.isFinite(reorder) ? reorder : 0,
          barcode: barcode.trim() || null,
          hsCode: hsCode.trim() || null,
          // eTIMS: A=Exempt, B=16% standard — keep the flag and category in sync.
          taxCategory: isTaxExempt ? "A" : "B",
          isTaxExempt,
          branchId,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        product?: CreatedProduct;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.product) {
        const msg = data.error ?? data.message ?? `Product creation failed (${res.status})`;
        setServerError(msg);
        toast.error(msg);
        return;
      }
      toast.success(`Product created — ${data.product.sku}`);
      onCreated(data.product);
      onOpenChange(false);
    } catch {
      setServerError("Network error — product not saved");
      toast.error("Network error — product not saved");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="np-name">
            Product name <span className="text-rose-600">*</span>
          </Label>
          <Input
            id="np-name"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Simba cement 32.5N — 50kg bag"
            aria-required="true"
            aria-invalid={attempted && !!errors.name}
          />
          {fieldError("name")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="np-sku">
            SKU <span className="text-rose-600">*</span>
          </Label>
          <Input
            id="np-sku"
            value={sku}
            maxLength={40}
            onChange={(e) => setSku(e.target.value.toUpperCase())}
            placeholder="e.g. MBM-HQ-0117"
            className="font-mono"
            aria-required="true"
            aria-invalid={attempted && !!errors.sku}
          />
          {fieldError("sku")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="np-category">
            Category <span className="text-rose-600">*</span>
          </Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="np-category" aria-label="Product category" aria-required="true">
              <SelectValue placeholder="Pick a category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
              <SelectItem value={NEW_CATEGORY}>
                <span className="flex items-center gap-2 text-emerald-700">
                  <PackagePlus className="size-3.5" aria-hidden /> Add new category…
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
          {fieldError("category")}
        </div>

        {category === NEW_CATEGORY && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="np-new-category">New category name</Label>
            <Input
              id="np-new-category"
              value={newCategory}
              maxLength={80}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="e.g. Fasteners"
              autoFocus
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="np-unit">
            Unit of measure <span className="text-rose-600">*</span>
          </Label>
          <Select value={unit} onValueChange={(v) => setUnit(v as ProductUnit)}>
            <SelectTrigger id="np-unit" aria-label="Unit of measure" aria-required="true">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="np-buy">
            Buying price (KES) <span className="text-rose-600">*</span>
          </Label>
          <Input
            id="np-buy"
            type="number"
            min={0}
            step="0.01"
            value={buyingPrice}
            onChange={(e) => setBuyingPrice(e.target.value)}
            placeholder="0.00"
            aria-required="true"
            aria-invalid={attempted && !!errors.buyingPrice}
          />
          {fieldError("buyingPrice")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="np-sell" className="flex items-center gap-2">
            Selling price (KES) <span className="text-rose-600">*</span>
            {margin !== null && (
              <Badge
                variant="outline"
                className={cn(
                  "font-normal",
                  margin > 0
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                )}
                title="Gross margin: (selling − buying) ÷ selling"
              >
                Margin {margin.toFixed(1)}%
              </Badge>
            )}
          </Label>
          <Input
            id="np-sell"
            type="number"
            min={0}
            step="0.01"
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
            placeholder="0.00"
            aria-required="true"
            aria-invalid={attempted && !!errors.sellingPrice}
          />
          {fieldError("sellingPrice")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="np-stock">Opening stock</Label>
          <Input
            id="np-stock"
            type="number"
            min={0}
            step="1"
            value={stockQty}
            onChange={(e) => setStockQty(e.target.value)}
            aria-invalid={attempted && !!errors.stockQty}
          />
          {fieldError("stockQty")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="np-reorder">Reorder level</Label>
          <Input
            id="np-reorder"
            type="number"
            min={0}
            step="1"
            value={reorderLevel}
            onChange={(e) => setReorderLevel(e.target.value)}
            aria-invalid={attempted && !!errors.reorderLevel}
          />
          {fieldError("reorderLevel")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="np-barcode">Barcode <span className="text-stone-400">(optional)</span></Label>
          <Input
            id="np-barcode"
            value={barcode}
            maxLength={64}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Scan or type EAN/Code-128"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="np-hs">HS code <span className="text-stone-400">(eTIMS, optional)</span></Label>
          <Input
            id="np-hs"
            value={hsCode}
            maxLength={20}
            onChange={(e) => setHsCode(e.target.value)}
            placeholder="e.g. 2523.29.00"
          />
        </div>

        <label htmlFor="np-tax-exempt" className="flex cursor-pointer items-center gap-2 text-sm text-stone-600 sm:col-span-2">
          <Switch id="np-tax-exempt" checked={isTaxExempt} onCheckedChange={setIsTaxExempt} />
          Tax-exempt item (eTIMS category A — no 16% VAT)
        </label>
      </div>

      {branchError && (
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldAlert className="size-4 text-amber-700" aria-hidden />
          <AlertTitle className="text-xs">Branch unresolved</AlertTitle>
          <AlertDescription className="text-[11px]">{branchError}</AlertDescription>
        </Alert>
      )}
      {serverError && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">{serverError}</AlertDescription>
        </Alert>
      )}

      <DialogFooter className="gap-2">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={submit}
          disabled={busy || !branchId || (attempted && hasErrors)}
          className="bg-emerald-700 text-white hover:bg-emerald-800"
        >
          {busy ? (
            <Loader2 className="mr-1 size-4 animate-spin" aria-hidden />
          ) : (
            <PackagePlus className="mr-1 size-4" aria-hidden />
          )}
          Create product
        </Button>
      </DialogFooter>
    </div>
  );
}

export function NewProductDialog({
  open, onOpenChange, onCreated, categories, suggestedSku, branchId,
}: NewProductDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <PackagePlus className="size-4 text-emerald-700" aria-hidden /> New product
          </DialogTitle>
          <DialogDescription className="text-xs">
            Adds a catalog entry with full eTIMS fields. Opening stock above zero is journaled as a
            RESTOCK movement, so the stock ledger reconciles from day one.
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while open → pristine fields on every reopen. */}
        {open && (
          <NewProductForm
            categories={categories}
            suggestedSku={suggestedSku}
            branchId={branchId}
            onCreated={onCreated}
            onOpenChange={onOpenChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
