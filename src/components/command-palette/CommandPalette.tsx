"use client";

// src/components/command-palette/CommandPalette.tsx
//
// Global command palette (Ctrl/Cmd + K) — keyboard-first launcher that spans
// every workspace tab:
//   • Navigate      — jump to any of the seven workspace tabs (role-gated).
//   • Quick actions — new product (MANAGER+), hold / clear the cart, drain the
//                     offline order queue, open the shortcuts sheet, refresh
//                     workspace data.
//   • Products      — debounced server search (/api/products?q=…) → Enter adds
//                     the SKU straight into the cart via the zustand store and
//                     flips to the POS tab (works from ANY tab).
//   • Customers     — debounced server search (/api/customers?q=…) → Enter
//                     opens the Customers directory.
//
// Self-contained: the component owns its Ctrl/Cmd+K window listener, so the
// orchestrator only controls `open`/`onOpenChange` (and gets a header button).
// Palette is mounted only for signed-in users (orchestrator gates the mount),
// so every action can assume a live session.
//
// NOTE on the single-input model: cmdk exposes ONE input, so both searches are
// driven by the same query string; each result group keeps its own state copy
// so a slow endpoint can never blank the other group's hits.

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  ArrowRight,
  Barcode,
  Boxes,
  CreditCard,
  FileText,
  History,
  Loader2,
  Moon,
  PackagePlus,
  PlusCircle,
  RefreshCw,
  ScanBarcode,
  Settings,
  Snowflake,
  Sun,
  Trash2,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { clearCartSnapshot } from "@/lib/offline-db";
import { formatKES } from "@/lib/format";
import { roleAtLeast, type Customer, type Product, type SessionUser } from "@/lib/types";
import { useCartStore } from "@/stores/cart";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { cn } from "@/lib/utils";

// ── Public contract ───────────────────────────────────────────────────────────

export type PaletteTab = "pos" | "inventory" | "customers" | "credit" | "documents" | "eod" | "admin";

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: SessionUser;
  /** Currently active workspace tab — marked as "current" in the Navigate group. */
  activeTab: PaletteTab;
  onNavigate: (tab: PaletteTab) => void;
  /** Opens the orchestrator's "new product" dialog (MANAGER+ only). */
  onNewProduct: () => void;
  /** Opens the keyboard-shortcuts sheet. */
  onShowShortcuts: () => void;
  /** Re-runs the orchestrator's workspace data load (products/customers/branches). */
  onRefreshData: () => void;
}

// ── Static navigation + action models ────────────────────────────────────────

interface NavItem {
  tab: PaletteTab;
  label: string;
  icon: LucideIcon;
  managerOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { tab: "pos", label: "Point of Sale", icon: ScanBarcode },
  { tab: "inventory", label: "Inventory", icon: Boxes },
  { tab: "customers", label: "Customers", icon: Users },
  { tab: "credit", label: "Credit & Debts", icon: CreditCard },
  { tab: "documents", label: "Documents", icon: FileText },
  { tab: "eod", label: "EOD Reports", icon: Wallet, managerOnly: true },
  { tab: "admin", label: "Admin", icon: Settings },
];

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 8;

/** /api/products returns { items: Product[]; total } — hits typed defensively. */
interface ProductsResponse {
  items?: Product[];
}

export function CommandPalette({
  open,
  onOpenChange,
  session,
  activeTab,
  onNavigate,
  onNewProduct,
  onShowShortcuts,
  onRefreshData,
}: CommandPaletteProps) {
  const isManager = roleAtLeast(session.role, "MANAGER");
  const { syncing, syncNow } = useOfflineSync();
  const { resolvedTheme, setTheme } = useTheme();

  // ── Appearance toggle (light ⇄ dark; system counts as its resolved value) ─
  const toggleTheme = () => {
    const next = resolvedTheme === "dark" ? "light" : "dark";
    setTheme(next);
    toast.success(`Switched to ${next} appearance`);
  };

  // ── Global Ctrl/Cmd+K listener (owned here so every mount behaves alike) ──
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  // ── Debounced product + customer search (stale-response guarded) ──────────
  const [query, setQuery] = useState("");
  const [productHits, setProductHits] = useState<Product[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [customerHits, setCustomerHits] = useState<Customer[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const runRef = useRef(0);

  useEffect(() => {
    if (!open) {
      setQuery(""); // reset on close so the next open starts clean
      setProductHits([]);
      setCustomerHits([]);
      setProductLoading(false);
      setCustomerLoading(false);
      return;
    }
    const q = query.trim();
    if (!q) {
      setProductHits([]);
      setCustomerHits([]);
      setProductLoading(false);
      setCustomerLoading(false);
      return;
    }
    const run = ++runRef.current;
    setProductLoading(true);
    setCustomerLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const [prodRes, custRes] = await Promise.all([
          fetch(`/api/products?q=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}`, { cache: "no-store" }),
          fetch(`/api/customers?q=${encodeURIComponent(q)}`, { cache: "no-store" }),
        ]);
        if (runRef.current !== run) return; // a newer keystroke superseded us
        setProductHits(prodRes.ok ? ((await prodRes.json()) as ProductsResponse).items ?? [] : []);
        setCustomerHits(custRes.ok ? ((await custRes.json()) as { items?: Customer[] }).items ?? [] : []);
      } catch {
        if (runRef.current === run) {
          setProductHits([]);
          setCustomerHits([]);
        }
      } finally {
        if (runRef.current === run) {
          setProductLoading(false);
          setCustomerLoading(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  // ── Action helpers (close first, then act) ─────────────────────────────────
  const runAction = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  const addToCart = (p: Product) =>
    runAction(() => {
      onNavigate("pos");
      useCartStore.getState().addProduct(p);
      toast.success(`${p.name} ×1 added to cart`, { description: `${formatKES(Number(p.sellingPrice))} · ${p.sku}` });
    });

  const holdOrder = () =>
    runAction(() => {
      if (useCartStore.getState().lines.length === 0) {
        toast.warning("Cart is empty — nothing to hold");
        return;
      }
      useCartStore.getState().holdOrder();
      toast.success("Order parked — resume it from the held strip");
    });

  const clearCart = () =>
    runAction(() => {
      if (useCartStore.getState().lines.length === 0) {
        toast.warning("Cart is already empty");
        return;
      }
      useCartStore.getState().clearCart();
      void clearCartSnapshot();
      toast.info("Cart cleared");
    });

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command, product or customer…" value={query} onValueChange={setQuery} />
      <CommandList className="max-h-[380px] overflow-y-auto">
        <CommandEmpty>
          <span className="text-sm text-stone-500 dark:text-stone-400">
            {query.trim() ? "No matches found." : "Type to search products and customers…"}
          </span>
        </CommandEmpty>

        {/* ── Navigate ─────────────────────────────────────────────────────── */}
        <CommandGroup heading="Navigate">
          {NAV_ITEMS.filter((n) => !n.managerOnly || isManager).map((n) => {
            const Icon = n.icon;
            const current = activeTab === n.tab;
            return (
              <CommandItem
                key={n.tab}
                value={`go ${n.label}`}
                onSelect={() => runAction(() => onNavigate(n.tab))}
                className="gap-2"
              >
                <Icon className={cn("size-4", current ? "text-emerald-700 dark:text-emerald-400" : "text-stone-400 dark:text-stone-500")} aria-hidden />
                <span className={cn(current && "font-medium text-emerald-800 dark:text-emerald-300")}>{n.label}</span>
                {current && (
                  <span className="ml-auto text-[10px] font-medium tracking-wide text-emerald-700 uppercase dark:text-emerald-400">
                    current
                  </span>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {/* ── Quick actions ────────────────────────────────────────────────── */}
        <CommandSeparator />
        <CommandGroup heading="Quick actions">
          {isManager && (
            <CommandItem value="new product" onSelect={() => runAction(onNewProduct)} className="gap-2">
              <PackagePlus className="size-4 text-emerald-600" aria-hidden />
              New product
            </CommandItem>
          )}
          <CommandItem value="hold order" onSelect={holdOrder} className="gap-2">
            <Snowflake className="size-4 text-slate-500" aria-hidden />
            Hold order
            <CommandShortcut>F4</CommandShortcut>
          </CommandItem>
          <CommandItem value="clear cart" onSelect={clearCart} className="gap-2">
            <Trash2 className="size-4 text-rose-500" aria-hidden />
            Clear cart
            <CommandShortcut>ESC</CommandShortcut>
          </CommandItem>
          <CommandItem
            value="sync offline orders"
            disabled={syncing}
            onSelect={() => runAction(() => void syncNow())}
            className="gap-2"
          >
            {syncing ? (
              <Loader2 className="size-4 animate-spin text-emerald-600" aria-hidden />
            ) : (
              <RefreshCw className="size-4 text-emerald-600" aria-hidden />
            )}
            {syncing ? "Syncing…" : "Sync offline orders"}
          </CommandItem>
          <CommandItem value="refresh workspace data" onSelect={() => runAction(onRefreshData)} className="gap-2">
            <History className="size-4 text-slate-500" aria-hidden />
            Refresh workspace data
          </CommandItem>
          <CommandItem value="keyboard shortcuts" onSelect={() => runAction(onShowShortcuts)} className="gap-2">
            <Settings className="size-4 text-slate-500" aria-hidden />
            Keyboard shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
          <CommandItem value="toggle dark mode appearance theme" onSelect={() => runAction(toggleTheme)} className="gap-2">
            {resolvedTheme === "dark" ? (
              <Sun className="size-4 text-amber-500" aria-hidden />
            ) : (
              <Moon className="size-4 text-slate-600" aria-hidden />
            )}
            {resolvedTheme === "dark" ? "Switch to light appearance" : "Switch to dark appearance"}
          </CommandItem>
        </CommandGroup>

        {/* ── Products ─────────────────────────────────────────────────────── */}
        {query.trim() && (
          <>
            <CommandSeparator />
            <CommandGroup
              heading={
                productLoading ? "Products — searching…" : productHits.length ? "Products — Enter adds to cart" : "Products"
              }
            >
              {productHits.length === 0 && !productLoading ? (
                <div className="px-2 py-1.5 text-xs text-stone-400 dark:text-stone-500">No SKUs match “{query.trim()}”.</div>
              ) : (
                productHits.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`product ${p.name} ${p.sku}`}
                    onSelect={() => addToCart(p)}
                    className="gap-2"
                  >
                    <Barcode className="size-4 shrink-0 text-stone-400 dark:text-stone-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">
                      {p.name}
                      <span className="ml-1.5 font-mono text-[11px] text-stone-400 dark:text-stone-500">{p.sku}</span>
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-stone-500 dark:text-stone-400">
                      {Number(p.stockQty)} {p.unit} · {formatKES(Number(p.sellingPrice))}
                    </span>
                    <PlusCircle className="size-4 shrink-0 text-emerald-600" aria-hidden />
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          </>
        )}

        {/* ── Customers ────────────────────────────────────────────────────── */}
        {query.trim() && (
          <>
            <CommandSeparator />
            <CommandGroup heading={customerLoading ? "Customers — searching…" : "Customers"}>
              {customerHits.length === 0 && !customerLoading ? (
                <div className="px-2 py-1.5 text-xs text-stone-400 dark:text-stone-500">No customers match “{query.trim()}”.</div>
              ) : (
                customerHits.slice(0, SEARCH_LIMIT).map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`customer ${c.name}`}
                    onSelect={() => runAction(() => onNavigate("customers"))}
                    className="gap-2"
                  >
                    <Users className="size-4 shrink-0 text-stone-400 dark:text-stone-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <ArrowRight className="size-4 shrink-0 text-stone-300 dark:text-stone-600" aria-hidden />
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
