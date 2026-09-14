"use client";
// src/components/customers/CustomersDirectory.tsx — customer directory card.
// Fetches GET /api/customers?q=<search> (debounced 300 ms, abortable), renders
// a credit-focused table (limit / balance / utilization / risk / masked KRA PIN)
// and offers MANAGER+: New customer (POST /api/customers), per-row Edit
// (PATCH /api/customers/[id]) and per-row credit Statement (StatementDialog,
// reused with its exact props contract — it fits, so the dialog is emitted).
//
// PII posture: the directory API already returns phoneMasked only; kraPin
// arrives verbatim (needed for eTIMS) so it is masked HERE for display
// (first 2 + last 3, e.g. "P0***67X"). Edit dialog pre-fills only fields the
// client legitimately holds — phone/email stay unchanged unless typed (the
// server re-encrypts with AES-256-GCM on change).
//
// Palette discipline: emerald / amber / rose / slate / stone ONLY — no indigo,
// blue or purple. All fetches use relative URLs; money is string-typed and
// formatted via formatKES. Thin scrollbars come from the global
// `.overflow-y-auto` CSS (globals.css, Task 13-c).

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  FileText,
  Loader2,
  Pencil,
  RotateCw,
  Search,
  TriangleAlert,
  UserPlus,
  Users,
} from "lucide-react";

import type { SessionUser } from "@/lib/types";
import { formatKES } from "@/lib/format";
import { riskBand, utilizationTone } from "@/lib/risk-band";
import { StatementDialog } from "@/components/credit/StatementDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─────────────────────────────────────────────────────────────────────────────
// Contracts (mirror the wire — money arrives as strings, counts as numbers)
// ─────────────────────────────────────────────────────────────────────────────

export interface CustomersDirectoryProps {
  session: SessionUser;
  branches: Array<{ id: string; name: string }>;
}

/** Row shape returned by GET /api/customers (existing endpoint). */
interface CustomerRow {
  id: string;
  name: string;
  phoneMasked: string | null;
  kraPin: string | null;
  creditLimit: string;
  currentBalance: string;
  riskScore: number;
  branchId: string;
}

interface CustomersResponse {
  items: CustomerRow[];
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

/** KRA PIN display mask — first 2 + last 3 (P012345678X → "P0***78X"). */
function maskKraPin(pin: string | null): string | null {
  if (!pin) return null;
  if (pin.length < 7) return "***"; // mask would overlap on short values
  return `${pin.slice(0, 2)}***${pin.slice(-3)}`;
}

/**
 * Credit utilization % (mirrors /api/v1/credit/aging): balance / limit,
 * divide-by-zero guarded — open debt with no limit is 100% utilised.
 */
function utilizationOf(creditLimit: string, currentBalance: string): number {
  const limit = Number(creditLimit);
  const balance = Number(currentBalance);
  if (limit > 0) return Math.min(100, (balance / limit) * 100);
  return balance > 0 ? 100 : 0;
}

/**
 * Risk badge + utilization tone come from the SHARED helper (src/lib/risk-band.ts)
 * — identical banding to the aging report (DebtAgingReport.tsx) by construction.
 * riskBand(score) → { label, badgeClass }; utilizationTone(util) → { bar, text }.
 */

const PHONE_RE = /^\+?[0-9]{9,15}$/;
const KRA_PIN_RE = /^[A-Z][0-9]{9}[A-Z]$/;
const EMAIL_RE = /.+@.+\..+/;

// ─────────────────────────────────────────────────────────────────────────────
// CustomersDirectory
// ─────────────────────────────────────────────────────────────────────────────

export function CustomersDirectory({ session, branches }: CustomersDirectoryProps) {
  // MANAGER+ owns customer records (POST/PATCH are MANAGER+ server-side; the
  // statement endpoint is MANAGER+ too, so its entry point is gated likewise —
  // a cashier clicking it would only ever receive a 403).
  const isManager = session.role === "OWNER" || session.role === "MANAGER";
  const showBranch = session.role === "OWNER" && branches.length > 1;

  // ── Directory state ──
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(""); // debounced, trimmed query
  const [items, setItems] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounce the search box: apply the trimmed value 300 ms after typing stops.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      const qs = params.size > 0 ? `?${params.toString()}` : "";
      const res = await fetch(`/api/customers${qs}`, { cache: "no-store", signal: ctrl.signal });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { error?: string }).error ?? `Failed to load customers (${res.status})`);
      }
      if (ctrl.signal.aborted) return; // superseded by a newer request
      const data = json as CustomersResponse;
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // aborted / unmounted
      if (!ctrl.signal.aborted) {
        setItems([]);
        setTotal(0);
        setError(err instanceof Error ? err.message : "Failed to load customers");
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [search]);

  // Fetch on mount + refetch when the debounced search changes; abort on unmount.
  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  // ── Statement dialog (reused component, exact props contract) ──
  const [statementCustomer, setStatementCustomer] = useState<{ id: string; name: string } | null>(null);

  // ── Edit dialog state ──
  const [editTarget, setEditTarget] = useState<CustomerRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState(""); // blank = keep current (masked on server)
  const [editEmail, setEditEmail] = useState(""); // blank = keep current
  const [editKraPin, setEditKraPin] = useState(""); // blank = keep current (masked on server)
  const [clearKraPin, setClearKraPin] = useState(false); // explicit "remove PIN" intent
  const [editLimit, setEditLimit] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  function openEdit(row: CustomerRow) {
    setEditTarget(row);
    setEditName(row.name);
    setEditPhone("");
    setEditEmail("");
    // The API only exposes a MASKED PIN (e.g. "P0***76Q") — pre-filling it here
    // would risk saving the mask. Blank means "keep current"; removing the PIN
    // is an explicit checkbox below.
    setEditKraPin("");
    setClearKraPin(false);
    setEditLimit(row.creditLimit);
    setEditError(null);
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget || editSaving) return;

    const name = editName.trim();
    if (name.length < 2) {
      setEditError("Full name must be at least 2 characters.");
      return;
    }
    const limitNum = Number(editLimit || "0");
    if (!Number.isFinite(limitNum) || limitNum < 0 || limitNum > 10_000_000) {
      setEditError("Credit limit must be between 0 and 10,000,000.");
      return;
    }
    const phone = editPhone.trim();
    if (phone && !PHONE_RE.test(phone)) {
      setEditError("Phone must be 9–15 digits with an optional leading +.");
      return;
    }
    const email = editEmail.trim();
    if (email && !EMAIL_RE.test(email)) {
      setEditError("Enter a valid email address.");
      return;
    }
    const pin = editKraPin.trim().toUpperCase();
    if (pin && !KRA_PIN_RE.test(pin)) {
      setEditError("KRA PIN must look like P012345678X.");
      return;
    }

    // Partial PATCH: name/creditLimit always (pre-filled), phone/email only
    // when typed (they are PII-masked, so "blank" must mean "unchanged").
    // kraPin: explicit checkbox → null (clear); typed value → replace; blank →
    // untouched (the API never sends the raw PIN back to the browser).
    const body: Record<string, unknown> = { name, creditLimit: limitNum };
    if (phone) body.phone = phone;
    if (email) body.email = email;
    if (clearKraPin) body.kraPin = null;
    else if (pin) body.kraPin = pin;

    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/customers/${encodeURIComponent(editTarget.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError((json as { error?: string }).error ?? `Update failed (${res.status})`);
        return;
      }
      toast.success(`${name} updated`);
      setEditTarget(null);
      void load();
    } catch {
      setEditError("Network error — could not save changes.");
    } finally {
      setEditSaving(false);
    }
  }

  // ── New-customer dialog state ──
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createPhone, setCreatePhone] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createKraPin, setCreateKraPin] = useState("");
  const [createLimit, setCreateLimit] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSaving, setCreateSaving] = useState(false);

  function openCreate() {
    setCreateName("");
    setCreatePhone("");
    setCreateEmail("");
    setCreateKraPin("");
    setCreateLimit("");
    setCreateError(null);
    setCreateOpen(true);
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    if (createSaving) return;

    const name = createName.trim();
    if (name.length < 2) {
      setCreateError("Full name must be at least 2 characters.");
      return;
    }
    const phone = createPhone.trim();
    if (!PHONE_RE.test(phone)) {
      setCreateError("Phone is required — 9–15 digits with an optional leading + (e.g. +254712345678).");
      return;
    }
    const email = createEmail.trim();
    if (email && !EMAIL_RE.test(email)) {
      setCreateError("Enter a valid email address.");
      return;
    }
    const pin = createKraPin.trim().toUpperCase();
    if (pin && !KRA_PIN_RE.test(pin)) {
      setCreateError("KRA PIN must look like P012345678X.");
      return;
    }
    const limitNum = Number(createLimit || "0");
    if (!Number.isFinite(limitNum) || limitNum < 0 || limitNum > 10_000_000) {
      setCreateError("Credit limit must be between 0 and 10,000,000.");
      return;
    }

    // Body mirrors the existing POST /api/customers schema exactly:
    // { name, phone, email?, kraPin?, creditLimit } — no invented fields.
    const body: Record<string, unknown> = { name, phone, creditLimit: limitNum };
    if (email) body.email = email;
    if (pin) body.kraPin = pin;

    setCreateSaving(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError((json as { error?: string }).error ?? `Create failed (${res.status})`);
        return;
      }
      toast.success(`${name} added to customers`);
      setCreateOpen(false);
      void load();
    } catch {
      setCreateError("Network error — could not create the customer.");
    } finally {
      setCreateSaving(false);
    }
  }

  const searchActive = search.length > 0;

  return (
    <>
      <Card className="border-stone-200 shadow-sm dark:border-stone-800">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <Users className="size-5 text-emerald-700" aria-hidden />
                Customers
              </CardTitle>
              <CardDescription>
                Directory of credit customers · PII stored encrypted, shown masked
              </CardDescription>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-64">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400 dark:text-stone-500"
                  aria-hidden
                />
                <Input
                  id="customer-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name…"
                  aria-label="Search customers by name"
                  className="h-11 pl-9"
                />
              </div>
              {isManager && (
                <Button
                  onClick={openCreate}
                  className="h-11 bg-emerald-700 text-white hover:bg-emerald-800 dark:hover:bg-emerald-500"
                >
                  <UserPlus className="mr-1.5 size-4" aria-hidden />
                  New customer
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6" aria-busy={loading}>
          {error ? (
            <Alert variant="destructive" className="border-rose-200 bg-rose-50">
              <TriangleAlert className="size-4 text-rose-700" aria-hidden />
              <AlertTitle>Could not load customers</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                {error}
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  <RotateCw className="mr-1.5 size-3.5" /> Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : loading && items.length === 0 ? (
            <div className="space-y-2" aria-hidden>
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800"
                >
                  <Skeleton className="size-8 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-36" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-3.5 w-20 shrink-0" />
                  <Skeleton className="hidden h-1.5 w-20 shrink-0 rounded-full sm:block" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* Long-list handling: max height + Y scroll (X scroll on the
                  min-width table below); thin scrollbars via globals.css. */}
              <div className="max-h-[560px] overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-800">
                <Table className="min-w-[720px]">
                  <TableHeader className="sticky top-0 z-10 bg-stone-50 shadow-[0_1px_0_0_#e7e5e4] dark:bg-stone-900 dark:shadow-[0_1px_0_0_#3f3f46]">
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Credit limit</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                      <TableHead>Utilization</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>KRA PIN</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((c) => {
                      const util = utilizationOf(c.creditLimit, c.currentBalance);
                      const tone = utilizationTone(util);
                      const risk = riskBand(c.riskScore);
                      const branchName = branches.find((b) => b.id === c.branchId)?.name;
                      return (
                        <TableRow key={c.id}>
                          <TableCell>
                            <div className="min-w-0">
                              <p className="font-medium text-stone-900 dark:text-stone-100">{c.name}</p>
                              <p className="text-xs text-stone-500 dark:text-stone-400">
                                {c.phoneMasked ?? "no phone on file"}
                              </p>
                              {showBranch && branchName && (
                                <p
                                  className="text-[10px] uppercase tracking-wide text-stone-400 dark:text-stone-500"
                                  title={`Branch: ${branchName}`}
                                >
                                  {branchName}
                                </p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatKES(c.creditLimit)}
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums ${
                              Number(c.currentBalance) > 0
                                ? "text-amber-700 dark:text-amber-400"
                                : "text-stone-700 dark:text-stone-300"
                            }`}
                          >
                            {formatKES(c.currentBalance)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress
                                value={util}
                                className={`h-1.5 w-20 ${tone.bar}`}
                                aria-label={`Credit utilization for ${c.name}`}
                              />
                              <span className={`text-xs tabular-nums ${tone.text}`}>
                                {util.toFixed(0)}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={risk.badgeClass}>
                              {risk.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-stone-600 dark:text-stone-300">
                            {maskKraPin(c.kraPin) ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {isManager && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEdit(c)}
                                  aria-label={`Edit ${c.name}`}
                                  title={`Edit ${c.name}`}
                                >
                                  <Pencil className="size-4" aria-hidden />
                                  <span className="ml-1.5">Edit</span>
                                </Button>
                              )}
                              {isManager && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setStatementCustomer({ id: c.id, name: c.name })}
                                  aria-label={`View statement for ${c.name}`}
                                  title={`View statement for ${c.name}`}
                                >
                                  <FileText className="size-4" aria-hidden />
                                </Button>
                              )}
                              {!isManager && <span className="text-xs text-stone-400 dark:text-stone-500">—</span>}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {items.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <div className="flex flex-col items-center gap-1.5 py-10 text-center">
                            <Users className="size-8 text-stone-300 dark:text-stone-600" aria-hidden />
                            <p className="text-sm font-medium text-stone-600 dark:text-stone-300">
                              {searchActive ? "No customers match this search" : "No customers yet"}
                            </p>
                            <p className="text-xs text-stone-500 dark:text-stone-400">
                              {searchActive
                                ? "Try a different name or clear the search box."
                                : isManager
                                  ? "Add your first credit customer with the “New customer” button."
                                  : "Credit customers will appear here once they are added."}
                            </p>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
              <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
                {items.length} of {total} customer{total === 1 ? "" : "s"} shown
                {searchActive ? ` · filtered by “${search}”` : ""}
                {loading ? " · refreshing…" : ""}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Edit dialog (MANAGER+) ── */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit customer</DialogTitle>
            <DialogDescription>
              {editTarget?.name} · phone/email stay unchanged unless you type a new value —
              both are re-encrypted on change. KRA PIN changes apply to future invoices.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitEdit} className="grid gap-4" noValidate>
            {editError && (
              <Alert variant="destructive" className="border-rose-200 bg-rose-50">
                <TriangleAlert className="size-4 text-rose-700" aria-hidden />
                <AlertDescription>{editError}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="cust-edit-name">Full name *</Label>
              <Input
                id="cust-edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                minLength={2}
                maxLength={120}
                required
                aria-label="Full name"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-edit-phone">Phone</Label>
              <Input
                id="cust-edit-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder={`Leave blank to keep ${editTarget?.phoneMasked ?? "current number"}`}
                aria-label="Phone (leave blank to keep the current number)"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-edit-email">Email</Label>
              <Input
                id="cust-edit-email"
                type="email"
                autoComplete="off"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="Leave blank to keep current email"
                aria-label="Email (leave blank to keep the current email)"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-edit-kra">KRA PIN</Label>
              <Input
                id="cust-edit-kra"
                value={editKraPin}
                onChange={(e) => setEditKraPin(e.target.value)}
                maxLength={11}
                placeholder={editTarget?.kraPin ? `${editTarget.kraPin} (stored — leave blank to keep)` : "P012345678X"}
                className="font-mono uppercase"
                aria-label="KRA PIN (leave blank to keep the current PIN)"
                disabled={clearKraPin}
              />
              {editTarget?.kraPin ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearKraPin}
                    onChange={(e) => setClearKraPin(e.target.checked)}
                    className="accent-rose-600"
                    aria-label="Remove the stored KRA PIN"
                  />
                  Remove stored KRA PIN
                </label>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-edit-limit">Credit limit (KES)</Label>
              <Input
                id="cust-edit-limit"
                type="number"
                inputMode="decimal"
                min={0}
                max={10_000_000}
                step="0.01"
                value={editLimit}
                onChange={(e) => setEditLimit(e.target.value)}
                required
                aria-label="Credit limit in Kenyan shillings"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-1.5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditTarget(null)}
                disabled={editSaving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={editSaving}
                className="bg-emerald-700 text-white hover:bg-emerald-800 dark:hover:bg-emerald-500"
              >
                {editSaving && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── New customer dialog (MANAGER+) — POST /api/customers ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New customer</DialogTitle>
            <DialogDescription>
              Phone and email are encrypted at rest and only ever shown masked. A credit
              limit above zero provisions a store-credit account.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCreate} className="grid gap-4" noValidate>
            {createError && (
              <Alert variant="destructive" className="border-rose-200 bg-rose-50">
                <TriangleAlert className="size-4 text-rose-700" aria-hidden />
                <AlertDescription>{createError}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="cust-new-name">Full name *</Label>
              <Input
                id="cust-new-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                minLength={2}
                maxLength={120}
                required
                aria-label="Full name"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-new-phone">Phone *</Label>
              <Input
                id="cust-new-phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={createPhone}
                onChange={(e) => setCreatePhone(e.target.value)}
                placeholder="+254712345678"
                required
                aria-label="Phone number, for example +254712345678"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-new-email">Email</Label>
              <Input
                id="cust-new-email"
                type="email"
                autoComplete="off"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                placeholder="name@example.com"
                aria-label="Email address"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-new-kra">KRA PIN</Label>
              <Input
                id="cust-new-kra"
                value={createKraPin}
                onChange={(e) => setCreateKraPin(e.target.value)}
                maxLength={11}
                placeholder="P012345678X"
                className="font-mono uppercase"
                aria-label="KRA PIN"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cust-new-limit">Credit limit (KES)</Label>
              <Input
                id="cust-new-limit"
                type="number"
                inputMode="decimal"
                min={0}
                max={10_000_000}
                step="0.01"
                value={createLimit}
                onChange={(e) => setCreateLimit(e.target.value)}
                placeholder="0"
                aria-label="Credit limit in Kenyan shillings"
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-1.5">
              <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)} disabled={createSaving}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createSaving}
                className="bg-emerald-700 text-white hover:bg-emerald-800 dark:hover:bg-emerald-500"
              >
                {createSaving && <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />}
                Create customer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Statement dialog (reused with its exact props contract) ── */}
      <StatementDialog
        customerId={statementCustomer?.id ?? null}
        customerName={statementCustomer?.name ?? ""}
        open={!!statementCustomer}
        onOpenChange={(o) => !o && setStatementCustomer(null)}
        session={session}
      />
    </>
  );
}
