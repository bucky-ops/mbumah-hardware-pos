'use client';

/**
 * eTIMS Tab — KRA electronic Tax Invoice Management System integration.
 *
 * Three sub-sections (tabs):
 *   1. Profile     — configure the store's KRA business profile (PIN, creds,
 *                    sandbox vs production). Manager+ only.
 *   2. Invoices    — list of InvoiceForKRA rows with submission status pipeline
 *                    (PENDING → SUBMITTED → ACCEPTED | REJECTED | FAILED).
 *                    Supports dry-run preview + live submit + status polling.
 *   3. Audit Log   — full KraSubmission history (every KRA API call).
 */

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Building2, KeyRound, ShieldCheck, Loader2, RefreshCw, Plus,
  CheckCircle, Clock, AlertCircle, XCircle, FileText, Search,
  Send, Eye, Database, Activity, AlertTriangle,
  Hash, Calendar, Receipt, Settings2,
} from 'lucide-react';

import { useAppStore, useAuthStore } from '@/lib/stores';
import {
  kraApi,
  type InvoiceForKraItem,
  type KraSubmissionItem,
} from '@/lib/api';
import { handleError } from '@/lib/error-handler';
import { formatDateTime } from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';

// ── Status badge config ──────────────────────────────────────────────────────

const SUBMISSION_STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ElementType }
> = {
  PENDING: {
    label: 'Pending',
    color: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
    icon: Clock,
  },
  SUBMITTED: {
    label: 'Submitted',
    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    icon: Send,
  },
  ACCEPTED: {
    label: 'Accepted',
    color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    icon: CheckCircle,
  },
  REJECTED: {
    label: 'Rejected',
    color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
    icon: XCircle,
  },
  FAILED: {
    label: 'Failed',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    icon: AlertCircle,
  },
};

const ENVIRONMENT_CONFIG: Record<string, { label: string; color: string }> = {
  sandbox: {
    label: 'Sandbox',
    color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  },
  production: {
    label: 'Production',
    color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  },
};

const SENIOR_ROLES = ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatKESLocal(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function parseTaxBreakdown(json: string | null): {
  items: Array<{ name: string; quantity: number; unitPrice: number; vatRate: number; vatAmount: number; total: number }>;
  subtotal: number;
  totalDiscount: number;
  totalVat: number;
  totalAmount: number;
} | null {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ── Profile Sub-Tab ──────────────────────────────────────────────────────────

function ProfileSection({ storeId }: { storeId: string }) {
  const queryClient = useQueryClient();
  const authUser = useAuthStore((s) => s.user);
  const canEdit = authUser ? SENIOR_ROLES.includes(authUser.role) : false;

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [form, setForm] = useState({
    businessPin: '',
    businessName: '',
    registrationDate: '',
    kraUsername: '',
    kraPassword: '',
    environment: 'sandbox' as 'sandbox' | 'production',
    isActive: true,
  });

  const { data: profile, isLoading } = useQuery({
    queryKey: ['kra-profile', storeId],
    queryFn: () => kraApi.getProfile(storeId),
    enabled: !!storeId,
  });

  const upsertMutation = useMutation({
    mutationFn: (data: typeof form) =>
      kraApi.upsertProfile({
        storeId,
        businessPin: data.businessPin.toUpperCase().trim(),
        businessName: data.businessName.trim(),
        registrationDate: data.registrationDate || undefined,
        kraUsername: data.kraUsername.trim(),
        kraPassword: data.kraPassword,
        environment: data.environment,
        isActive: data.isActive,
      }),
    onSuccess: (data) => {
      toast.success(data.message || 'KRA profile saved.');
      queryClient.invalidateQueries({ queryKey: ['kra-profile', storeId] });
      setShowEditDialog(false);
    },
    onError: (err) => {
      handleError(err);
    },
  });

  const openEditDialog = () => {
    if (profile) {
      setForm({
        businessPin: profile.businessPin,
        businessName: profile.businessName,
        registrationDate: profile.registrationDate.split('T')[0],
        kraUsername: profile.kraUsername,
        kraPassword: '', // Always require re-entry
        environment: profile.environment,
        isActive: profile.isActive,
      });
    } else {
      setForm({
        businessPin: '',
        businessName: '',
        registrationDate: new Date().toISOString().split('T')[0],
        kraUsername: '',
        kraPassword: '',
        environment: 'sandbox',
        isActive: true,
      });
    }
    setShowEditDialog(true);
  };

  const handleSave = () => {
    if (!form.businessPin || !form.businessName || !form.kraUsername || !form.kraPassword) {
      toast.error('All fields are required.');
      return;
    }
    // Validate PIN format: P + 9 digits + 1 letter
    const pinRegex = /^[A-Za-z]\d{9}[A-Za-z]$/;
    if (!pinRegex.test(form.businessPin)) {
      toast.error('Invalid KRA PIN format. Expected: P + 9 digits + 1 letter (e.g. P051234567X).');
      return;
    }
    upsertMutation.mutate(form);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Profile summary card */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-emerald-600" />
              KRA Business Profile
            </CardTitle>
            <CardDescription>
              Your store's eTIMS credentials. Used to submit sales invoices to the Kenya Revenue Authority.
            </CardDescription>
          </div>
          {canEdit && (
            <Button onClick={openEditDialog} size="sm">
              <Settings2 className="h-4 w-4 mr-1.5" />
              {profile ? 'Edit Profile' : 'Configure Profile'}
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {profile ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <ProfileField label="Business PIN" value={profile.businessPin} icon={Hash} />
              <ProfileField label="Business Name" value={profile.businessName} icon={Building2} />
              <ProfileField label="KRA Username" value={profile.kraUsername} icon={KeyRound} />
              <ProfileField
                label="Environment"
                value={
                  <Badge className={ENVIRONMENT_CONFIG[profile.environment]?.color || ''}>
                    {ENVIRONMENT_CONFIG[profile.environment]?.label || profile.environment}
                  </Badge>
                }
                icon={ShieldCheck}
              />
              <ProfileField
                label="Registration Date"
                value={formatDateTime(profile.registrationDate)}
                icon={Calendar}
              />
              <ProfileField
                label="Password"
                value={profile.passwordConfigured ? '•••••••• (configured)' : 'Not set'}
                icon={KeyRound}
              />
              <ProfileField
                label="OAuth Token"
                value={
                  profile.tokenConfigured
                    ? `Cached (expires ${profile.tokenExpiresAt ? formatDateTime(profile.tokenExpiresAt) : 'soon'})`
                    : 'Not cached'
                }
                icon={Activity}
              />
              <ProfileField
                label="Status"
                value={
                  <Badge className={profile.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300'}>
                    {profile.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                }
                icon={CheckCircle}
              />
            </div>
          ) : (
            <div className="text-center py-12 space-y-3">
              <div className="mx-auto h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">No KRA profile configured</p>
                <p className="text-xs text-muted-foreground">
                  You won't be able to submit invoices to KRA until you configure your eTIMS credentials.
                </p>
              </div>
              {canEdit && (
                <Button onClick={openEditDialog} variant="default" size="sm">
                  <Plus className="h-4 w-4 mr-1.5" />
                  Configure Now
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info / help card */}
      <Card className="border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/10">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <Database className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="space-y-1.5 text-sm">
              <p className="font-medium text-foreground">About eTIMS integration</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                The Kenya Revenue Authority's electronic Tax Invoice Management System (eTIMS) requires
                all VAT-registered businesses to submit sales invoices in real-time. This integration
                maps each sales transaction to KRA's invoice format (with VAT 16% breakdown) and submits
                it via the eTIMS API. Sandbox mode is for testing; production mode sends real invoices.
              </p>
              <p className="text-muted-foreground text-xs">
                Credentials are stored encrypted. OAuth tokens are cached and auto-refreshed 5 minutes before expiry.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Edit/Create dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[525px]">
          <DialogHeader>
            <DialogTitle>{profile ? 'Edit KRA Profile' : 'Configure KRA Profile'}</DialogTitle>
            <DialogDescription>
              Enter your eTIMS credentials. The password is encrypted before storage and never returned in API responses.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="businessPin">KRA Business PIN *</Label>
              <Input
                id="businessPin"
                placeholder="P051234567X"
                value={form.businessPin}
                onChange={(e) => setForm({ ...form, businessPin: e.target.value.toUpperCase() })}
                maxLength={11}
              />
              <p className="text-xs text-muted-foreground">Format: letter + 9 digits + letter (e.g. P051234567X)</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="businessName">Business Name *</Label>
              <Input
                id="businessName"
                placeholder="MBUMAH HARDWARE"
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="kraUsername">eTIMS Username *</Label>
                <Input
                  id="kraUsername"
                  placeholder="mbumah_admin"
                  value={form.kraUsername}
                  onChange={(e) => setForm({ ...form, kraUsername: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="kraPassword">eTIMS Password *</Label>
                <Input
                  id="kraPassword"
                  type="password"
                  placeholder="••••••••"
                  value={form.kraPassword}
                  onChange={(e) => setForm({ ...form, kraPassword: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="registrationDate">Registration Date</Label>
                <Input
                  id="registrationDate"
                  type="date"
                  value={form.registrationDate}
                  onChange={(e) => setForm({ ...form, registrationDate: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="environment">Environment</Label>
                <Select
                  value={form.environment}
                  onValueChange={(v: 'sandbox' | 'production') => setForm({ ...form, environment: v })}
                >
                  <SelectTrigger id="environment">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">Sandbox (test)</SelectItem>
                    <SelectItem value="production">Production (live)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} disabled={upsertMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={upsertMutation.isPending}>
              {upsertMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Profile'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProfileField({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-card">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="space-y-0.5 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm font-medium text-foreground break-words">{value}</div>
      </div>
    </div>
  );
}

// ── Invoices Sub-Tab ─────────────────────────────────────────────────────────

function InvoicesSection({ storeId }: { storeId: string }) {
  const queryClient = useQueryClient();
  const authUser = useAuthStore((s) => s.user);
  const canSubmit = authUser ? ['SUPER_ADMIN', 'STORE_OWNER', 'BRANCH_MANAGER', 'CASHIER'].includes(authUser.role) : false;

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceForKraItem | null>(null);
  const [submitTransactionId, setSubmitTransactionId] = useState('');
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['kra-invoices', storeId, statusFilter, search, page],
    queryFn: () =>
      kraApi.listInvoices({
        storeId,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search: search || undefined,
        page,
        limit: pageSize,
      }),
    enabled: !!storeId,
  });

  const invoices = data?.data ?? [];
  const pagination = data?.pagination;
  const summary = data?.summary;

  const submitMutation = useMutation({
    mutationFn: (data: { transactionId: string; dryRun?: boolean }) =>
      kraApi.submitInvoice({ ...data, storeId }),
    onSuccess: (data) => {
      if (data.dryRun) {
        toast.success('Dry-run complete. Payload mapped — no KRA call was made.');
      } else {
        toast.success(data.message || 'Invoice submitted to KRA.');
      }
      queryClient.invalidateQueries({ queryKey: ['kra-invoices', storeId] });
      queryClient.invalidateQueries({ queryKey: ['kra-submissions', storeId] });
      setShowSubmitDialog(false);
      setSubmitTransactionId('');
    },
    onError: (err) => handleError(err),
  });

  const pollStatusMutation = useMutation({
    mutationFn: (invoiceForKraId: string) => kraApi.queryStatus(invoiceForKraId),
    onSuccess: (data) => {
      toast.success(data.message || `Status: ${data.submissionStatus}.`);
      queryClient.invalidateQueries({ queryKey: ['kra-invoices', storeId] });
      queryClient.invalidateQueries({ queryKey: ['kra-submissions', storeId] });
    },
    onError: (err) => handleError(err),
  });

  const summaryCards = useMemo(() => {
    const byStatus = summary?.byStatus ?? {};
    return [
      { label: 'Total', value: summary?.total ?? 0, color: 'text-slate-700 dark:text-slate-300', icon: FileText },
      { label: 'Pending', value: byStatus.PENDING ?? 0, color: 'text-slate-600 dark:text-slate-400', icon: Clock },
      { label: 'Submitted', value: byStatus.SUBMITTED ?? 0, color: 'text-blue-600 dark:text-blue-400', icon: Send },
      { label: 'Accepted', value: byStatus.ACCEPTED ?? 0, color: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle },
      { label: 'Rejected', value: byStatus.REJECTED ?? 0, color: 'text-rose-600 dark:text-rose-400', icon: XCircle },
      { label: 'Failed', value: byStatus.FAILED ?? 0, color: 'text-amber-600 dark:text-amber-400', icon: AlertCircle },
    ];
  }, [summary]);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {summaryCards.map((card) => (
          <Card key={card.label} className="py-3">
            <CardContent className="px-3 flex flex-col items-center justify-center text-center space-y-1">
              <card.icon className={`h-4 w-4 ${card.color}`} />
              <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
              <div className="text-xs text-muted-foreground">{card.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters + actions */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                KRA Invoices
              </CardTitle>
              <CardDescription>Submission pipeline for sales invoices</CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search invoice # or receipt #"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-8 w-56"
                />
              </div>
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="SUBMITTED">Submitted</SelectItem>
                  <SelectItem value="ACCEPTED">Accepted</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
              </Button>
              {canSubmit && (
                <Button size="sm" onClick={() => setShowSubmitDialog(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Submit Invoice
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-12 space-y-2">
              <FileText className="h-10 w-10 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">No KRA invoices found.</p>
              <p className="text-xs text-muted-foreground/60">
                Submit a sales transaction to KRA to create your first invoice record.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[180px]">KRA Invoice #</TableHead>
                      <TableHead>Receipt</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoices.map((inv) => {
                      const statusCfg = SUBMISSION_STATUS_CONFIG[inv.submissionStatus] || SUBMISSION_STATUS_CONFIG.PENDING;
                      const StatusIcon = statusCfg.icon;
                      return (
                        <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelectedInvoice(inv)}>
                          <TableCell className="font-mono text-xs">{inv.kraInvoiceNumber}</TableCell>
                          <TableCell>
                            {inv.transaction ? (
                              <span className="text-sm">{inv.transaction.receiptNumber}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm">
                            {inv.transaction?.customer?.name || 'Walk-in Customer'}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {inv.transaction ? formatKESLocal(inv.transaction.totalAmount) : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge className={statusCfg.color}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {statusCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {inv.submittedAt ? formatDateTime(inv.submittedAt) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                              {(inv.submissionStatus === 'SUBMITTED' || inv.submissionStatus === 'PENDING') && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => pollStatusMutation.mutate(inv.id)}
                                  disabled={pollStatusMutation.isPending}
                                >
                                  <RefreshCw className={`h-3 w-3 ${pollStatusMutation.isPending ? 'animate-spin' : ''}`} />
                                  <span className="sr-only">Poll status</span>
                                </Button>
                              )}
                              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setSelectedInvoice(inv)}>
                                <Eye className="h-3 w-3" />
                                <span className="sr-only">View details</span>
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between pt-3">
                  <p className="text-xs text-muted-foreground">
                    Page {pagination.page} of {pagination.totalPages} • {pagination.total} total
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Invoice detail dialog */}
      <InvoiceDetailDialog
        invoice={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        storeId={storeId}
      />

      {/* Submit dialog */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent className="sm:max-w-[475px]">
          <DialogHeader>
            <DialogTitle>Submit Invoice to KRA</DialogTitle>
            <DialogDescription>
              Enter the sales transaction ID to submit. Use dry-run to preview the mapped payload without calling KRA.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="transactionId">Transaction ID</Label>
              <Input
                id="transactionId"
                placeholder="tx_002"
                value={submitTransactionId}
                onChange={(e) => setSubmitTransactionId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The transaction must belong to this store and not already be ACCEPTED by KRA.
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowSubmitDialog(false)} disabled={submitMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              disabled={!submitTransactionId || submitMutation.isPending}
              onClick={() => submitMutation.mutate({ transactionId: submitTransactionId, dryRun: true })}
            >
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Eye className="h-4 w-4 mr-1.5" />}
              Dry Run
            </Button>
            <Button
              disabled={!submitTransactionId || submitMutation.isPending}
              onClick={() => submitMutation.mutate({ transactionId: submitTransactionId })}
            >
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Send className="h-4 w-4 mr-1.5" />}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InvoiceDetailDialog({
  invoice,
  onClose,
  storeId,
}: {
  invoice: InvoiceForKraItem | null;
  onClose: () => void;
  storeId: string;
}) {
  const { data: submissions } = useQuery({
    queryKey: ['kra-submissions', storeId, invoice?.id],
    queryFn: () => kraApi.listSubmissions({ storeId, invoiceForKraId: invoice!.id }),
    enabled: !!invoice,
  });

  if (!invoice) return null;
  const statusCfg = SUBMISSION_STATUS_CONFIG[invoice.submissionStatus] || SUBMISSION_STATUS_CONFIG.PENDING;
  const StatusIcon = statusCfg.icon;
  const breakdown = parseTaxBreakdown(invoice.kraTaxBreakdown);

  return (
    <Dialog open={!!invoice} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Invoice Detail
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">{invoice.kraInvoiceNumber}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Status banner */}
          <div className={`flex items-center gap-3 p-3 rounded-lg border ${statusCfg.color}`}>
            <StatusIcon className="h-5 w-5" />
            <div className="flex-1">
              <p className="text-sm font-medium">{statusCfg.label}</p>
              {invoice.lastError && (
                <p className="text-xs opacity-80 mt-0.5">{invoice.lastError}</p>
              )}
            </div>
            {invoice.retryCount > 0 && (
              <Badge variant="outline" className="text-xs">
                {invoice.retryCount} {invoice.retryCount === 1 ? 'retry' : 'retries'}
              </Badge>
            )}
          </div>

          {/* Transaction info */}
          {invoice.transaction && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Receipt #</p>
                <p className="font-medium">{invoice.transaction.receiptNumber}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Customer</p>
                <p className="font-medium">{invoice.transaction.customer?.name || 'Walk-in'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Amount</p>
                <p className="font-mono font-medium">{formatKESLocal(invoice.transaction.totalAmount)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Payment Method</p>
                <p className="font-medium">{invoice.transaction.paymentMethod}</p>
              </div>
            </div>
          )}

          {/* CU PIN + QR code */}
          {(invoice.cuPin || invoice.qrCode) && (
            <div className="grid grid-cols-2 gap-3">
              {invoice.cuPin && (
                <div className="p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/20">
                  <p className="text-xs text-muted-foreground mb-1">CU PIN (from KRA)</p>
                  <p className="font-mono text-sm font-medium">{invoice.cuPin}</p>
                </div>
              )}
              {invoice.qrCode && (
                <div className="p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/20">
                  <p className="text-xs text-muted-foreground mb-1">QR Code</p>
                  <p className="text-xs font-mono break-all">{invoice.qrCode.slice(0, 60)}...</p>
                </div>
              )}
            </div>
          )}

          {/* Tax breakdown */}
          {breakdown && (
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-muted/50 px-3 py-2 border-b">
                <p className="text-xs font-medium text-muted-foreground">VAT BREAKDOWN</p>
              </div>
              <div className="p-3 space-y-2">
                {breakdown.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="flex-1 truncate">{item.name} × {item.quantity}</span>
                    <span className="text-muted-foreground mx-2">VAT {item.vatRate}%</span>
                    <span className="font-mono">{formatKESLocal(item.vatAmount)}</span>
                  </div>
                ))}
                <Separator className="my-2" />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="font-mono">{formatKESLocal(breakdown.subtotal)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-mono text-rose-600">-{formatKESLocal(breakdown.totalDiscount)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Total VAT (16%)</span>
                  <span className="font-mono">{formatKESLocal(breakdown.totalVat)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold pt-1 border-t">
                  <span>Total</span>
                  <span className="font-mono">{formatKESLocal(breakdown.totalAmount)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Submission history */}
          {submissions && submissions.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-muted/50 px-3 py-2 border-b">
                <p className="text-xs font-medium text-muted-foreground">SUBMISSION HISTORY ({submissions.length})</p>
              </div>
              <ScrollArea className="max-h-48">
                <div className="divide-y">
                  {submissions.map((sub: { id: string; kraReferenceNumber: string | null; status: string; createdAt: string }) => (
                    <SubmissionHistoryRow key={sub.id} submission={sub} />
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Timestamps */}
          <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground pt-2 border-t">
            <div>
              <span>Created: </span>
              <span className="font-medium text-foreground">{formatDateTime(invoice.createdAt)}</span>
            </div>
            <div>
              <span>Submitted: </span>
              <span className="font-medium text-foreground">{invoice.submittedAt ? formatDateTime(invoice.submittedAt) : '—'}</span>
            </div>
            <div>
              <span>Accepted: </span>
              <span className="font-medium text-foreground">{invoice.acceptedAt ? formatDateTime(invoice.acceptedAt) : '—'}</span>
            </div>
            <div>
              <span>KRA Ref: </span>
              <span className="font-mono text-foreground">{invoice.kraSubmissionId || '—'}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SubmissionHistoryRow({ submission }: { submission: KraSubmissionItem }) {
  const statusCfg = SUBMISSION_STATUS_CONFIG[submission.status] || SUBMISSION_STATUS_CONFIG.PENDING;
  const StatusIcon = statusCfg.icon;
  return (
    <div className="px-3 py-2 flex items-center gap-3 text-xs">
      <StatusIcon className={`h-3.5 w-3.5 ${statusCfg.color.split(' ')[1]}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium">{statusCfg.label}</span>
          {submission.httpStatus && (
            <span className="text-muted-foreground">HTTP {submission.httpStatus}</span>
          )}
          {submission.latencyMs != null && (
            <span className="text-muted-foreground">{submission.latencyMs}ms</span>
          )}
        </div>
        {submission.errorMessage && (
          <p className="text-rose-600 dark:text-rose-400 truncate">{submission.errorMessage}</p>
        )}
      </div>
      <span className="text-muted-foreground shrink-0">{formatDateTime(submission.submittedAt)}</span>
    </div>
  );
}

// ── Audit Log Sub-Tab ────────────────────────────────────────────────────────

function AuditLogSection({ storeId }: { storeId: string }) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [limit] = useState(50);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['kra-submissions', storeId, statusFilter, limit],
    queryFn: () =>
      kraApi.listSubmissions({
        storeId,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        limit,
      }),
    enabled: !!storeId,
  });

  const submissions = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              KRA API Audit Log
            </CardTitle>
            <CardDescription>Every KRA API call (submit attempts + status polls)</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="SUBMITTED">Submitted</SelectItem>
                <SelectItem value="ACCEPTED">Accepted</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="FAILED">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : submissions.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <Activity className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No KRA API calls recorded yet.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[600px]">
            <div className="space-y-2">
              {submissions.map((sub: { id: string; kraReferenceNumber: string | null; status: string; createdAt: string }) => {
                const statusCfg = SUBMISSION_STATUS_CONFIG[sub.status] || SUBMISSION_STATUS_CONFIG.PENDING;
                const StatusIcon = statusCfg.icon;
                return (
                  <div key={sub.id} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/30">
                    <StatusIcon className={`h-4 w-4 shrink-0 mt-0.5 ${statusCfg.color.split(' ')[1]}`} />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={statusCfg.color}>{statusCfg.label}</Badge>
                        {sub.invoiceForKra && (
                          <span className="text-xs font-mono text-muted-foreground">
                            {sub.invoiceForKra.kraInvoiceNumber}
                          </span>
                        )}
                        {sub.invoiceForKra?.transaction && (
                          <span className="text-xs text-muted-foreground">
                            ({sub.invoiceForKra.transaction.receiptNumber})
                          </span>
                        )}
                        {sub.httpStatus && (
                          <span className="text-xs text-muted-foreground">HTTP {sub.httpStatus}</span>
                        )}
                        {sub.latencyMs != null && (
                          <span className="text-xs text-muted-foreground">{sub.latencyMs}ms</span>
                        )}
                      </div>
                      {sub.errorMessage && (
                        <p className="text-xs text-rose-600 dark:text-rose-400">{sub.errorMessage}</p>
                      )}
                      {sub.kraReferenceNumber && (
                        <p className="text-xs text-muted-foreground">
                          KRA Ref: <span className="font-mono">{sub.kraReferenceNumber}</span>
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {formatDateTime(sub.submittedAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function EtimsTab() {
  const currentStoreId = useAppStore((s) => s.currentStoreId);
  const [activeTab, setActiveTab] = useState('profile');

  if (!currentStoreId) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <p className="text-sm">Please select a store to manage KRA eTIMS integration.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            KRA eTIMS Integration
          </h2>
          <p className="text-sm text-muted-foreground">
            Submit sales invoices to the Kenya Revenue Authority's electronic Tax Invoice Management System.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="profile" className="gap-1.5">
            <Building2 className="h-4 w-4" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="invoices" className="gap-1.5">
            <Receipt className="h-4 w-4" />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1.5">
            <Activity className="h-4 w-4" />
            Audit Log
          </TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-4">
          <ProfileSection storeId={currentStoreId} />
        </TabsContent>
        <TabsContent value="invoices" className="mt-4">
          <InvoicesSection storeId={currentStoreId} />
        </TabsContent>
        <TabsContent value="audit" className="mt-4">
          <AuditLogSection storeId={currentStoreId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
