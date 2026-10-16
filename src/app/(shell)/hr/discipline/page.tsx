'use client';

// MBUMAH HARDWARE POS - /hr/discipline (v2.19.0, spec Phase 4.7)
// Disciplinary cases with expiry (open warnings auto-expire past their date)
// and grievance confidentiality: descriptions never appear in the list, and
// RESTRICTED grievances open only for HR/store-owner roles.

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
import { Eye, EyeOff, Gavel, Lock, Plus, RefreshCw } from 'lucide-react';
import { apiGet, apiSend, ErrorNote, StatusBadge, formatDate } from '@/components/hr/self-service-ui';

interface CaseListItemDto {
  id: string;
  employeeName: string | null;
  type: string;
  severity: number | null;
  status: string;
  issuedOn: string;
  expiresOn: string | null;
  confidentiality: string;
}
interface CaseDetailDto extends CaseListItemDto {
  description: string;
  resolutionNotes: string | null;
}
interface PersonDto {
  id: string;
  name: string;
  jobTitle: string | null;
}

export default function DisciplinePage() {
  const [cases, setCases] = useState<CaseListItemDto[] | null>(null);
  const [people, setPeople] = useState<PersonDto[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');

  const [openOpen, setOpenOpen] = useState(false);
  const [detail, setDetail] = useState<CaseDetailDto | null>(null);
  const [resolving, setResolving] = useState<{ item: CaseListItemDto; action: 'RESOLVE' | 'DISMISS' } | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');

  // open form
  const [employeeId, setEmployeeId] = useState('');
  const [type, setType] = useState('WARNING');
  const [severity, setSeverity] = useState('3');
  const [description, setDescription] = useState('');
  const [issuedOn, setIssuedOn] = useState(new Date().toISOString().slice(0, 10));
  const [expiresOn, setExpiresOn] = useState('');
  const [confidentiality, setConfidentiality] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [c, p] = await Promise.all([
        apiGet<CaseListItemDto[]>(statusFilter === 'ALL' ? '/api/hr/discipline' : `/api/hr/discipline?status=${statusFilter}`),
        apiGet<PersonDto[]>('/api/hr/performance/people').catch(() => [] as PersonDto[]),
      ]);
      setCases(c);
      setPeople(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cases.');
      setCases((prev) => prev ?? []);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Gavel className="h-6 w-6 text-rose-500" aria-hidden /> Discipline &amp; Grievances
          </h1>
          <p className="text-sm text-muted-foreground">
            Warnings expire automatically on their date. Grievances default to restricted: descriptions stay out of lists and are readable only by HR.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
              <SelectItem value="DISMISSED">Dismissed</SelectItem>
              <SelectItem value="EXPIRED">Expired</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load()} aria-label="Refresh cases">
            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden /> Refresh
          </Button>
          <Button size="sm" onClick={() => setOpenOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Open case
          </Button>
        </div>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Cases</CardTitle>
          <CardDescription>Listing never shows descriptions — open a case to read the record you are allowed to see.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!cases ? (
            <Skeleton className="h-40 w-full" />
          ) : cases.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No disciplinary cases recorded.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.employeeName ?? '—'}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        {c.confidentiality === 'RESTRICTED' ? (
                          <Lock className="h-3.5 w-3.5 text-violet-500" aria-label="Restricted confidentiality" />
                        ) : null}
                        {c.type}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.severity ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(c.issuedOn)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(c.expiresOn)}</TableCell>
                    <TableCell><StatusBadge status={c.status} /></TableCell>
                    <TableCell className="text-right">
                      {c.status === 'OPEN' ? (
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Open case detail`}
                            onClick={() =>
                              void run(async () => {
                                const d = await apiGet<CaseDetailDto>(`/api/hr/discipline/${c.id}`);
                                setDetail(d);
                              })
                            }
                          >
                            <Eye className="h-4 w-4" aria-hidden /> Open
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => { setResolving({ item: c, action: 'RESOLVE' }); setResolutionNotes(''); }}>
                            Resolve
                          </Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setResolving({ item: c, action: 'DISMISS' }); setResolutionNotes(''); }}>
                            Dismiss
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void run(async () => {
                              const d = await apiGet<CaseDetailDto>(`/api/hr/discipline/${c.id}`);
                              setDetail(d);
                            })
                          }
                        >
                          <EyeOff className="h-4 w-4" aria-hidden /> View
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ── Open case dialog ── */}
      <Dialog open={openOpen} onOpenChange={setOpenOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Open a disciplinary case</DialogTitle>
            <DialogDescription>
              The description is confidential: it never appears in lists or logs, only in the permission-gated detail view.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Employee</Label>
                <Select value={employeeId} onValueChange={setEmployeeId}>
                  <SelectTrigger aria-label="Case employee"><SelectValue placeholder="Choose employee" /></SelectTrigger>
                  <SelectContent>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={type} onValueChange={(v) => { setType(v); setConfidentiality(v === 'GRIEVANCE' ? 'RESTRICTED' : ''); }}>
                  <SelectTrigger aria-label="Case type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WARNING">Warning</SelectItem>
                    <SelectItem value="GRIEVANCE">Grievance</SelectItem>
                    <SelectItem value="INVESTIGATION">Investigation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="case-severity">Severity (1-5)</Label>
                <Input id="case-severity" inputMode="numeric" value={severity} onChange={(e) => setSeverity(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="case-issued">Issued on</Label>
                <Input id="case-issued" type="date" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="case-expires">Expires (warnings)</Label>
                <Input id="case-expires" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="case-description">Description (min 10 characters)</Label>
              <Textarea id="case-description" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            {type === 'GRIEVANCE' ? (
              <p className="flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300">
                <Lock className="h-3.5 w-3.5" aria-hidden /> Grievances are restricted by default — only HR managers and store owners can read them.
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenOpen(false)}>Cancel</Button>
            <Button
              disabled={busy || !employeeId || description.trim().length < 10}
              onClick={() =>
                void run(async () => {
                  await apiSend('/api/hr/discipline', 'POST', {
                    employeeId,
                    type,
                    ...(severity ? { severity: Number(severity) } : {}),
                    description,
                    issuedOn: new Date(issuedOn).toISOString(),
                    ...(expiresOn ? { expiresOn: new Date(expiresOn).toISOString() } : {}),
                    ...(confidentiality ? { confidentiality } : {}),
                  });
                  setOpenOpen(false);
                  setDescription('');
                  setExpiresOn('');
                })
              }
            >
              Open case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail dialog ── */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="sm:max-w-lg">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {detail.type} — {detail.employeeName} <StatusBadge status={detail.status} />
                </DialogTitle>
                <DialogDescription>
                  Issued {formatDate(detail.issuedOn)}
                  {detail.expiresOn ? ` · expires ${formatDate(detail.expiresOn)}` : ''}
                  {detail.confidentiality === 'RESTRICTED' ? ' · restricted record' : ''}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="rounded-lg border p-3">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
                  <p className="whitespace-pre-wrap text-sm">{detail.description}</p>
                </div>
                {detail.resolutionNotes ? (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Resolution</p>
                    <p className="whitespace-pre-wrap text-sm">{detail.resolutionNotes}</p>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* ── Resolve / dismiss dialog ── */}
      <Dialog open={resolving !== null} onOpenChange={(open) => !open && setResolving(null)}>
        <DialogContent className="sm:max-w-md">
          {resolving ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {resolving.action === 'RESOLVE' ? 'Resolve case' : 'Dismiss case'} — {resolving.item.type} · {resolving.item.employeeName}
                </DialogTitle>
                <DialogDescription>
                  {resolving.action === 'RESOLVE'
                    ? 'Record how the case was resolved (required).'
                    : 'Dismissals close the case without a resolution note.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="resolution-notes">Resolution notes {resolving.action === 'RESOLVE' ? '(required)' : '(optional)'}</Label>
                <Textarea id="resolution-notes" rows={3} value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setResolving(null)}>Cancel</Button>
                <Button
                  disabled={busy || (resolving.action === 'RESOLVE' && resolutionNotes.trim().length < 5)}
                  onClick={() =>
                    void run(async () => {
                      await apiSend(`/api/hr/discipline/${resolving.item.id}`, 'PATCH', {
                        action: resolving.action,
                        ...(resolutionNotes.trim() ? { resolutionNotes } : {}),
                      });
                      setResolving(null);
                    })
                  }
                >
                  Confirm {resolving.action.toLowerCase()}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
