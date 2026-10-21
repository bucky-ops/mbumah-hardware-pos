'use client';

// MBUMAH HARDWARE POS - Exchange Rates admin section (v2.211.0)
//
// The wire's writer finds its surface. /api/currency/rates has been able to
// PERSIST admin-set rates since v2.210.0, but the only writer was curl — a
// SUPER_ADMIN with a browser had no way to set or reset a rate. This section
// completes the loop on the admin desk:
//
//   • READ: the same GET the switcher uses (one wire, one truth). Every row
//     shows the KES figure, the inverse figure, and the rate's honest
//     source — admin-set / API / built-in, with the SAME measured chip
//     palette the switcher uses (the provenance law: one source, one look).
//   • WRITE: "Set rate" opens a dialog that POSTs one (KES, quote) pair;
//     the dialog CLOSES on success and the toast speaks the outcome (the
//     v2.209 lesson: a confirm surface must never outlive its own click).
//   • UN-WRITE: "Reset to built-in" DELETEs the pair (?base=&quote=) so the
//     row falls back to the static constant; the honest 404 (nothing to
//     reset) is surfaced as a toast, never a pretend success.
//   • THE DOOR LAW: mutations are SUPER_ADMIN-only SERVER-side; the client
//     renders the buttons only for that role and SPEAKS the restriction
//     where they would have been for every other admin-role eye. Read-only
//     surfaces stay for everyone.
//   • HONEST STATES: a failed wire is an error row with a retry — figures
//     are "unavailable", never zero; the voice composes from the SAME wire
//     the table reads (composeRatesProvenanceVoice, the one-writer law).
//
// This is a DISPLAY + CONFIG surface. Accounting currency remains KES; the
// switcher reads KES→quote pairs only, so custom pairs (if any ever exist)
// render in a muted secondary strip and say so.

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Globe, RefreshCw, RotateCcw, Loader2 } from 'lucide-react';

import { useAuthStore } from '@/lib/stores';
import { composeRatesProvenanceVoice } from '@/lib/report-voices';
import { formatDateTime } from '@/lib/api';
import { cn } from '@/lib/utils';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Authenticated fetch helper — same contract as the admin tab's own. */
async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers, credentials: 'same-origin' });
}

/** What one /api/currency/rates `currencies[]` entry teaches the card. */
interface RatesWireEntry {
  code: string;
  name?: string;
  symbol?: string;
  flag?: string;
  /** How many KES one unit of this currency equals (the wire's own figure). */
  rateToKES: number;
  /** How many units of this currency one KES equals. */
  kesToRate: number;
  /** STATIC | MANUAL | API — the wire's own provenance. */
  source: string;
  updatedAt: string | null;
}

/** What the GET's `rawRates[]` carries for pairs outside the KES family. */
interface RawRateEntry {
  base: string;
  quote: string;
  rate: string;
  source: string;
  updatedAt: string;
}

interface RatesWireBody {
  data?: {
    baseCurrency?: string;
    currencies?: RatesWireEntry[];
    rawRates?: RawRateEntry[];
  };
}

const SOURCE_CHIP: Record<string, { label: string; className: string }> = {
  MANUAL: {
    label: 'admin-set',
    // Measured against the white card ground BEFORE the literal was written
    // (scripts/contrast-math-rates-card-v2211.mjs): emerald-700 on
    // emerald-50 = 5.09, blue-700 on blue-50 = 6.26, muted-foreground on
    // card = 6.00 — all clear the 4.5:1 text bar; the dark variants ride
    // the same /15 translucency the switcher chips use.
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  API: {
    label: 'API',
    className: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  },
  STATIC: {
    label: 'built-in',
    className: 'text-muted-foreground',
  },
};

export function CurrencyRatesSection() {
  const queryClient = useQueryClient();
  // THE DOOR (same law as the system-health desk): the server answers
  // POST/DELETE only for SUPER_ADMIN; the client opens the door only for
  // that role and speaks the restriction for every other admin-role eye.
  const canManageRates = useAuthStore((s) => s.user?.role) === 'SUPER_ADMIN';

  const [dialogPair, setDialogPair] = useState<{ base: string; quote: string; label: string } | null>(null);
  const [rateInput, setRateInput] = useState('');
  const [resetPair, setResetPair] = useState<{ base: string; quote: string; label: string } | null>(null);

  // The rates wire: same GET the switcher lazily calls. Config data changes
  // rarely — no timer; a manual refresh + focus refetch cover it.
  const ratesQuery = useQuery({
    queryKey: ['admin-currency-rates'],
    queryFn: async (): Promise<RatesWireBody> => {
      const res = await authedFetch('/api/currency/rates');
      if (!res.ok) throw new Error(`The rates wire answered ${res.status}`);
      return (await res.json()) as RatesWireBody;
    },
    staleTime: 30_000,
  });

  // Stable identities for the useMemo deps below (the lint law: a logical
  // expression re-created every render must not feed a Hook's deps).
  const currencies = useMemo(() => ratesQuery.data?.data?.currencies ?? [], [ratesQuery.data]);
  const rawRates = useMemo(() => ratesQuery.data?.data?.rawRates ?? [], [ratesQuery.data]);
  // Custom pairs: rows the switcher never reads (it reads KES→quote only).
  // Honest scope: they render muted and say they are stored but unused by
  // the switcher until a consumer exists.
  const customPairs = useMemo(
    () => rawRates.filter((r) => r.base !== 'KES'),
    [rawRates],
  );

  // The one-writer voice: composed from the SAME entries the table renders.
  const provenanceVoice = useMemo(
    () => composeRatesProvenanceVoice(currencies.length > 0 ? currencies : null),
    [currencies],
  );

  const invalidateRates = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-currency-rates'] });
  };

  // WRITE: one (base, quote, rate) upsert. The dialog CLOSES on success
  // (it must never outlive its own click) and the toast speaks the result.
  const setRateMutation = useMutation({
    mutationFn: async ({ base, quote, rate }: { base: string; quote: string; rate: string }) => {
      const res = await authedFetch('/api/currency/rates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates: [{ base, quote, rate, source: 'MANUAL' }] }),
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) {
        throw new Error(body.error || `The wire refused the write (${res.status})`);
      }
      return body;
    },
    onSuccess: (_body, vars) => {
      setDialogPair(null);
      setRateInput('');
      invalidateRates();
      toast.success(`Rate saved — 1 ${vars.quote} = ${vars.rate} KES is now admin-set.`);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'The rate could not be saved.');
    },
  });

  // UN-WRITE: reset one pair to its built-in constant (DELETE). The honest
  // 404 (nothing to reset) surfaces as a toast, never a pretend success.
  const resetRateMutation = useMutation({
    mutationFn: async ({ base, quote }: { base: string; quote: string }) => {
      const res = await authedFetch(`/api/currency/rates?base=${encodeURIComponent(base)}&quote=${encodeURIComponent(quote)}`, {
        method: 'DELETE',
      });
      const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
      if (!res.ok || !body.success) {
        throw new Error(body.error || `The wire refused the reset (${res.status})`);
      }
      return body;
    },
    onSuccess: () => {
      setResetPair(null);
      invalidateRates();
      toast.success('Rate reset — the pair reads its built-in figure again.');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'The rate could not be reset.');
    },
  });

  // The dialog's live preview: the figure the switcher would show, computed
  // from the SAME input the POST would persist (no invented math). The route
  // stores KES-per-quote-unit (the pair rate = how many KES one unit of the
  // quote equals — the v2.210 E2E's "pair semantics"), so the switcher's
  // displayed figure is the INVERSE of the stored one.
  const parsedRate = Number(rateInput);
  const inversePreview =
    rateInput.trim() !== '' && Number.isFinite(parsedRate) && parsedRate > 0
      ? (1 / parsedRate).toPrecision(6).replace(/\.?0+$/, '')
      : null;

  const handleOpenDialog = (entry: RatesWireEntry) => {
    setRateInput('');
    setDialogPair({ base: 'KES', quote: entry.code, label: entry.name || entry.code });
  };

  const handleSubmit = () => {
    if (!dialogPair) return;
    const trimmed = rateInput.trim();
    const n = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(n) || n <= 0) {
      toast.error('Enter a positive number — a rate of zero or less is not a rate.');
      return;
    }
    setRateMutation.mutate({ base: dialogPair.base, quote: dialogPair.quote, rate: trimmed });
  };

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50" aria-label="Exchange rates configuration">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4" /> Exchange Rates
            </CardTitle>
            <CardDescription className="text-xs">
              {ratesQuery.isError
                ? 'The rates wire is unavailable — the figures below are unavailable, not zero.'
                : provenanceVoice}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0"
            onClick={() => void ratesQuery.refetch()}
            disabled={ratesQuery.isFetching}
            aria-label="Refresh exchange rates"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${ratesQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* The honest failed-wire state: an error row with a retry — never
            invented zeros, never the empty sentence (that one belongs to a
            loaded-and-empty wire only). */}
        {ratesQuery.isError ? (
          <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10 p-3 text-xs text-red-700 dark:text-red-300">
            The rates wire failed to answer — the exchange figures are unavailable, not zero.
          </div>
        ) : ratesQuery.isLoading ? (
          <div className="space-y-2" aria-label="Loading exchange rates">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Currency</TableHead>
                <TableHead className="text-right">1 KES equals</TableHead>
                <TableHead className="text-right">1 unit equals</TableHead>
                <TableHead>Source</TableHead>
                {canManageRates && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {currencies.map((entry) => {
                const chip = SOURCE_CHIP[entry.source] ?? SOURCE_CHIP.STATIC;
                const updatedAt = entry.updatedAt ? formatDateTime(entry.updatedAt) : null;
                return (
                  <TableRow key={entry.code}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-base leading-none" aria-hidden>{entry.flag ?? '💱'}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold leading-tight">
                            {entry.code}
                            {entry.code === 'KES' && (
                              <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">base</span>
                            )}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">{entry.name ?? ''}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {entry.code === 'KES' ? '—' : entry.kesToRate}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">
                      {entry.code === 'KES' ? '—' : `${entry.rateToKES} KES`}
                    </TableCell>
                    <TableCell>
                      <span
                        title={updatedAt ? `Rate updated ${updatedAt}` : undefined}
                        className={cn(
                          'inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium leading-tight',
                          chip.className,
                        )}
                      >
                        {chip.label}
                      </span>
                    </TableCell>
                    {canManageRates && (
                      <TableCell className="text-right">
                        {entry.code === 'KES' ? (
                          <span className="text-[10px] text-muted-foreground">the pivot never moves</span>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => handleOpenDialog(entry)}
                              aria-label={`Set the ${entry.name ?? entry.code} (${entry.code}) exchange rate`}
                            >
                              Set rate
                            </Button>
                            {entry.source !== 'STATIC' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                                onClick={() => setResetPair({ base: 'KES', quote: entry.code, label: entry.name || entry.code })}
                                aria-label={`Reset the ${entry.name ?? entry.code} (${entry.code}) rate to its built-in figure`}
                              >
                                <RotateCcw className="h-3 w-3 mr-1" aria-hidden />
                                Reset
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Custom pairs (base ≠ KES): stored on the wire but read by no
            consumer yet — the honest scope, spoken where the rows are. */}
        {!ratesQuery.isError && customPairs.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/50">
            <span className="text-[10px] text-muted-foreground">
              Custom pairs stored (the switcher reads KES pairs only):
            </span>
            {customPairs.map((pair) => (
              <Badge key={`${pair.base}_${pair.quote}`} variant="outline" className="text-[10px] tabular-nums">
                {pair.base}→{pair.quote} {pair.rate}
              </Badge>
            ))}
          </div>
        )}

        {/* THE DOOR LAW: the restriction is spoken where the buttons would
            have been, for every admin-role eye that is not SUPER_ADMIN. */}
        {!canManageRates && (
          <p className="text-[10px] text-muted-foreground">
            Exchange rate management is restricted to the system administrator.
          </p>
        )}
        {canManageRates && (
          <p className="text-[10px] text-muted-foreground">
            Rates are display-only configuration — the accounting currency remains KES.
            Resetting a rate deletes the stored override so the pair reads its built-in figure again.
          </p>
        )}
      </CardContent>

      {/* The set-rate dialog: closes on success, keeps its own input's
          truth (the preview computes from the same number the POST sends). */}
      <Dialog open={dialogPair !== null} onOpenChange={(open) => { if (!open) setDialogPair(null); }}>
        <DialogContent className="sm:max-w-sm" aria-label={`Set the ${dialogPair?.quote ?? ''} exchange rate`}>
          <DialogHeader>
            <DialogTitle className="text-sm">
              Set the {dialogPair?.label ?? ''} ({dialogPair?.quote ?? ''}) rate
            </DialogTitle>
            <DialogDescription className="text-xs">
              How many KES one {dialogPair?.quote ?? ''} equals — the pair direction the
              rates wire stores. Saving marks the rate admin-set; the switcher shows
              the inverse (1 KES in {dialogPair?.quote ?? ''}) on its next read.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rate-input" className="text-xs">Rate (KES per 1 {dialogPair?.quote ?? ''})</Label>
            <Input
              id="rate-input"
              inputMode="decimal"
              autoComplete="off"
              placeholder="e.g. 129.5"
              value={rateInput}
              onChange={(e) => setRateInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              className="tabular-nums"
              aria-describedby="rate-preview"
            />
            <p id="rate-preview" className="text-[10px] text-muted-foreground tabular-nums min-h-[14px]">
              {inversePreview
                ? `1 KES = ${inversePreview} ${dialogPair?.quote ?? ''} (the figure the switcher will show)`
                : 'Enter a positive number to see the switcher\u2019s figure.'}
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialogPair(null)}>Cancel</Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={setRateMutation.isPending}
              aria-label={`Save the ${dialogPair?.quote ?? ''} exchange rate`}
            >
              {setRateMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" aria-hidden />}
              Save rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* The reset confirm: an AlertDialog (destructive), closed by its own
          action — the v2.209 lesson that a confirm must never outlive the
          click that answered it. */}
      <AlertDialog open={resetPair !== null} onOpenChange={(open) => { if (!open) setResetPair(null); }}>
        <AlertDialogContent aria-label={`Reset the ${resetPair?.quote ?? ''} rate to built-in`}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">Reset the {resetPair?.label ?? ''} ({resetPair?.quote ?? ''}) rate?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              This deletes the stored override for {resetPair?.base ?? 'KES'}→{resetPair?.quote ?? ''}.
              The pair falls back to its built-in constant and the switcher&apos;s chip
              flips back to built-in. The switcher and every display conversion pick
              the built-in figure immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the override</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (resetPair) resetRateMutation.mutate({ base: resetPair.base, quote: resetPair.quote });
              }}
              className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600"
              aria-label={`Confirm resetting the ${resetPair?.quote ?? ''} rate`}
            >
              {resetRateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" aria-hidden />
              ) : null}
              Reset to built-in
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default CurrencyRatesSection;
