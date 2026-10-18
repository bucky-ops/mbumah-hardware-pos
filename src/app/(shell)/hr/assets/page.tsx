'use client';

// MBUMAH HARDWARE POS - /hr/assets (v2.19.0, spec Phase 4.7)
// Company asset assignments with authorization-gated recovery: LOST / DAMAGED
// dispositions require a named authorizer (active HR manager or store owner)
// who must be different from the user recording the outcome.

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { AlertTriangle, Boxes, Link2, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiGet, apiSend, ErrorNote, StatusBadge, formatDate } from '@/components/hr/self-service-ui';

interface AssetDto {
  id: string;
  employeeName: string | null;
  storeId: string | null;
  assetName: string;
  assetTag: string | null;
  serialNumber: string | null;
  assignedOn: string;
  dueReturnOn: string | null;
  returnedOn: string | null;
  conditionOut: string | null;
  conditionIn: string | null;
  status: string;
  notes: string | null;
  overdue: boolean;
}
interface PersonDto {
  id: string;
  name: string;
  jobTitle: string | null;
}
interface AuthorizerDto {
  id: string;
  name: string;
  role: string;
}

// v2.114.0: deep-link seeds — the People & Payroll panel's overdue-assets
// door lands here with ?overdue=1&storeId=<id>. Lazy initializers (no
// setState-in-effect); storeId is scope the SERVER decides (passed through
// verbatim; the API honors it only for org-scope roles whose organization
// owns the store — everyone else silently keeps their own store and the
// notice below says so).
function readParam(name: string): string {
  try {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get(name)?.trim() ?? '';
  } catch {
    return '';
  }
}

function mirrorFiltersToUrl(statusFilter: string, overdueOnly: boolean) {
  try {
    const sp = new URLSearchParams(window.location.search);
    if (overdueOnly) sp.set('overdue', '1');
    else sp.delete('overdue');
    if (!overdueOnly && statusFilter !== 'ALL') sp.set('status', statusFilter);
    else sp.delete('status');
    const qs = sp.toString();
    window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
  } catch {
    // no URL surface — the filters still work, they just cannot be shared
  }
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<AssetDto[] | null>(null);
  const [people, setPeople] = useState<PersonDto[]>([]);
  const [authorizers, setAuthorizers] = useState<AuthorizerDto[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  // v2.114.0: link seeds (lazy initializers) + the honest "(from link)" chip
  // that retires on the user's first filter touch.
  const [linkStoreId] = useState(() => readParam('storeId'));
  const [linkOverdue] = useState(() => readParam('overdue') === '1');
  const [overdueOnly, setOverdueOnly] = useState(linkOverdue);
  const [userTouched, setUserTouched] = useState(false);

  const [assignOpen, setAssignOpen] = useState(false);
  const [outcome, setOutcome] = useState<{ asset: AssetDto; kind: 'RETURNED' | 'LOST' | 'DAMAGED' } | null>(null);

  // assign form
  const [employeeId, setEmployeeId] = useState('');
  const [assetName, setAssetName] = useState('');
  const [assetTag, setAssetTag] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [dueReturnOn, setDueReturnOn] = useState('');
  const [conditionOut, setConditionOut] = useState('');

  // outcome form
  const [conditionIn, setConditionIn] = useState('');
  const [authorizerId, setAuthorizerId] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const params = new URLSearchParams();
      if (linkStoreId) params.set('storeId', linkStoreId);
      if (overdueOnly) params.set('overdue', '1');
      else if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const qs = params.toString();
      const [a, p, au] = await Promise.all([
        apiGet<AssetDto[]>(`/api/hr/assets${qs ? `?${qs}` : ''}`),
        apiGet<PersonDto[]>('/api/hr/performance/people').catch(() => [] as PersonDto[]),
        apiGet<AuthorizerDto[]>('/api/hr/performance/authorizers').catch(() => [] as AuthorizerDto[]),
      ]);
      setAssets(a);
      setPeople(p);
      setAuthorizers(au);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load assets.');
      setAssets((prev) => prev ?? []);
    }
  }, [linkStoreId, overdueOnly, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    mirrorFiltersToUrl(statusFilter, overdueOnly);
  }, [statusFilter, overdueOnly]);

  // The mismatch honesty mirrors the employees list: only claim the answer
  // came from another store when a row actually names one.
  const storeMismatch =
    assets != null && assets.length > 0 && !!linkStoreId &&
    assets.some((a) => a.storeId != null && a.storeId !== linkStoreId);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const overdueCount = (assets ?? []).filter((a) => a.overdue).length;

  return (
    <div className="space-y-6" data-testid="hr-assets-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Boxes className="h-6 w-6 text-sky-500" aria-hidden /> Assets
          </h1>
          <p className="text-sm text-muted-foreground">
            Company property issued to staff. Lost or damaged recovery requires a second authorizer — no self-approval.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setUserTouched(true);
              setOverdueOnly((v) => !v);
            }}
            aria-pressed={overdueOnly}
            data-testid="hr-assets-overdue-toggle"
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
              overdueOnly
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
            title="Show only assigned assets past their expected return date"
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Overdue only
            {overdueOnly && linkOverdue && !userTouched && (
              <span className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                from link
              </span>
            )}
          </button>
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setUserTouched(true);
              setStatusFilter(v);
            }}
            disabled={overdueOnly}
          >
            <SelectTrigger className="w-36" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="ASSIGNED">Assigned</SelectItem>
              <SelectItem value="RETURNED">Returned</SelectItem>
              <SelectItem value="LOST">Lost</SelectItem>
              <SelectItem value="DAMAGED">Damaged</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Refresh assets">
            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden /> Refresh
          </Button>
          <Button size="sm" onClick={() => setAssignOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Assign asset
          </Button>
        </div>
      </div>

      {overdueCount > 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {overdueCount} asset{overdueCount > 1 ? 's are' : ' is'} past the expected return date.
        </div>
      ) : null}
      {storeMismatch && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300" role="status" data-testid="hr-assets-store-notice">
          <span className="inline-flex items-center gap-1.5">
            <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            You asked for a specific branch&rsquo;s assets; this session&rsquo;s scope resolved to a different store —
            the server never widens scope on request alone. Switch your active branch to see the requested one.
          </span>
        </div>
      )}
      {error ? <ErrorNote message={error} /> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Assignments</CardTitle>
          <CardDescription>Condition is recorded on the way out and on the way back.</CardDescription>
          {assets && (
            <span className="text-xs text-slate-400 dark:text-slate-500" data-testid="hr-assets-count">
              {assets.length} {assets.length === 1 ? 'assignment' : 'assignments'}
              {overdueOnly ? ' · overdue only' : ''}
            </span>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!assets ? (
            <Skeleton className="h-40 w-full" />
          ) : assets.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No asset assignments recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asset</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead>Due back</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assets.map((a) => (
                  <TableRow key={a.id} className={a.overdue ? 'bg-amber-50/40 dark:bg-amber-950/20' : undefined}>
                    <TableCell>
                      <div className="font-medium">{a.assetName}</div>
                      <div className="text-xs text-muted-foreground">
                        {a.assetTag ? `Tag ${a.assetTag}` : ''}{a.serialNumber ? ` · S/N ${a.serialNumber}` : ''}
                      </div>
                    </TableCell>
                    <TableCell>{a.employeeName ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(a.assignedOn)}</TableCell>
                    <TableCell className={a.overdue ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>
                      {a.overdue ? 'Overdue · ' : ''}
                      {formatDate(a.dueReturnOn)}
                    </TableCell>
                    <TableCell><StatusBadge status={a.status} /></TableCell>
                    <TableCell className="text-right">
                      {a.status === 'ASSIGNED' ? (
                        <div className="flex justify-end gap-1.5">
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => { setOutcome({ asset: a, kind: 'RETURNED' }); setConditionIn(''); setAuthorizerId(''); setNotes(''); }}>
                            Return
                          </Button>
                          <Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700 dark:text-rose-400" disabled={busy} onClick={() => { setOutcome({ asset: a, kind: 'LOST' }); setConditionIn(''); setAuthorizerId(''); setNotes(''); }}>
                            Lost
                          </Button>
                          <Button size="sm" variant="ghost" className="text-amber-600 hover:text-amber-700 dark:text-amber-400" disabled={busy} onClick={() => { setOutcome({ asset: a, kind: 'DAMAGED' }); setConditionIn(''); setAuthorizerId(''); setNotes(''); }}>
                            Damaged
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {a.conditionIn ? `In: ${a.conditionIn}` : '—'}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Assign dialog ── */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign an asset</DialogTitle>
            <DialogDescription>Record what was issued, to whom, and the expected return date.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger aria-label="Asset employee"><SelectValue placeholder="Choose employee" /></SelectTrigger>
                <SelectContent>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="asset-name">Asset name</Label>
                <Input id="asset-name" value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="e.g. Barcode scanner" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asset-tag">Asset tag</Label>
                <Input id="asset-tag" value={assetTag} onChange={(e) => setAssetTag(e.target.value)} placeholder="e.g. MBM-AST-014" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="asset-serial">Serial number</Label>
                <Input id="asset-serial" value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asset-due">Expected return</Label>
                <Input id="asset-due" type="date" value={dueReturnOn} onChange={(e) => setDueReturnOn(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asset-condition-out">Condition on issue</Label>
              <Input id="asset-condition-out" value={conditionOut} onChange={(e) => setConditionOut(e.target.value)} placeholder="e.g. New, boxed" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !employeeId || !assetName}
              onClick={() =>
                void run(async () => {
                  await apiSend('/api/hr/assets', 'POST', {
                    employeeId,
                    assetName,
                    ...(assetTag ? { assetTag } : {}),
                    ...(serialNumber ? { serialNumber } : {}),
                    ...(dueReturnOn ? { dueReturnOn: new Date(dueReturnOn).toISOString() } : {}),
                    ...(conditionOut ? { conditionOut } : {}),
                  });
                  setAssignOpen(false);
                  setAssetName('');
                  setAssetTag('');
                  setSerialNumber('');
                  setConditionOut('');
                })
              }
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Outcome dialog ── */}
      <Dialog open={outcome !== null} onOpenChange={(open) => !open && setOutcome(null)}>
        <DialogContent className="sm:max-w-md">
          {outcome ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {outcome.kind === 'RETURNED' ? (
                    <>Record return — {outcome.asset.assetName}</>
                  ) : (
                    <><AlertTriangle className="h-5 w-5 text-rose-500" aria-hidden /> Record {outcome.kind.toLowerCase()} — {outcome.asset.assetName}</>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {outcome.kind === 'RETURNED'
                    ? 'Record the condition the asset came back in.'
                    : 'Recovery requires authorization from another HR manager or store owner. They cannot be you.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="condition-in">Condition back {outcome.kind === 'RETURNED' ? '(required)' : '(optional)'}</Label>
                  <Input id="condition-in" value={conditionIn} onChange={(e) => setConditionIn(e.target.value)} placeholder="e.g. Scratched screen" />
                </div>
                {outcome.kind !== 'RETURNED' ? (
                  <>
                    <div className="space-y-1.5">
                      <Label className="flex items-center gap-1.5">
                        <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden /> Recovery authorizer (required)
                      </Label>
                      <Select value={authorizerId} onValueChange={setAuthorizerId}>
                        <SelectTrigger aria-label="Recovery authorizer"><SelectValue placeholder="Choose HR manager / store owner" /></SelectTrigger>
                        <SelectContent>
                          {authorizers.map((u) => (
                            <SelectItem key={u.id} value={u.id}>{u.name} — {u.role.replace(/_/g, ' ').toLowerCase()}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Only active HR managers and store owners can authorize. The authorizer must differ from you.
                      </p>
                    </div>
                  </>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="outcome-notes">Notes {outcome.kind !== 'RETURNED' ? '(required)' : '(optional)'}</Label>
                  <Textarea id="outcome-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What happened?" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOutcome(null)}>Cancel</Button>
                <Button
                  disabled={
                    busy ||
                    (outcome.kind === 'RETURNED' && !conditionIn.trim()) ||
                    (outcome.kind !== 'RETURNED' && (!authorizerId || !notes.trim()))
                  }
                  onClick={() =>
                    void run(async () => {
                      await apiSend(`/api/hr/assets/${outcome.asset.id}`, 'PATCH', {
                        status: outcome.kind,
                        ...(conditionIn.trim() ? { conditionIn } : {}),
                        ...(outcome.kind !== 'RETURNED' ? { recoveryAuthorizedByUserId: authorizerId } : {}),
                        ...(notes.trim() ? { notes } : {}),
                      });
                      setOutcome(null);
                    })
                  }
                >
                  Confirm {outcome.kind.toLowerCase()}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
