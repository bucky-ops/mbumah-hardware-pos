'use client';

/**
 *
 * MBUMAH HARDWARE POS - Admin Audit Trail section (v2.12.8, PR C)
 *
 *
 * Consolidated denial/override/authorization trail rendered inside the
 * Security tab (second view next to the Security Dashboard). Backed by
 * GET /api/admin/audit-trail, which merges hash-chained AuditLog rows
 * (PERMISSION_DENIED / MANAGER_OVERRIDE / MANAGER_AUTHORIZED) with any
 * SecurityEvent denial rows that lack an AuditLog twin - every denial shows
 * exactly once.
 *
 * Features: role select, user search, date range, denied-only switch, free
 * search, CSV export (mbumah-audit-trail-YYYYMMDD.csv), Prev/Next pagination,
 * skeleton loading, empty state, scroll-confined long table (scrollbar-thin),
 * truncating cells for long emails.
 *
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Download, ChevronLeft, ChevronRight, RefreshCw, ScrollText, ShieldOff, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatDateTime, formatRelativeTime } from '@/lib/api';

// Types

interface AuditTrailRow {
  id: string;
  source: 'AUDIT_LOG' | 'SECURITY_EVENT';
  timestamp: string;
  userName: string;
  userEmail: string;
  role: string;
  action: string;
  actionLabel: string;
  resource: string;
  result: 'DENIED' | 'SUCCESS';
  branchName: string | null;
  ipAddress: string | null;
  details: string;
}

interface AuditTrailResponse {
  success: boolean;
  data: AuditTrailRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/** Roles available in the role filter (5 core roles + INVENTORY_MANAGER, v2.12.2). */
const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'SUPER_ADMIN', label: 'System Administrator' },
  { value: 'STORE_OWNER', label: 'Store Owner' },
  { value: 'BRANCH_MANAGER', label: 'Branch Manager' },
  { value: 'CASHIER', label: 'Cashier' },
  { value: 'ACCOUNTANT', label: 'Accountant' },
  { value: 'INVENTORY_MANAGER', label: 'Inventory Manager' },
];

/** Badge tone per action (red = denial, amber = override, green = authorized). */
function actionBadgeClass(action: string): string {
  switch (action) {
    case 'PERMISSION_DENIED':
    case 'HIGH_RISK_ATTEMPT':
      return 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400';
    case 'MANAGER_OVERRIDE':
      return 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400';
    case 'MANAGER_AUTHORIZED':
      return 'bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

// Data fetch

async function fetchAuditTrail(params: Record<string, string>): Promise<AuditTrailResponse> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/admin/audit-trail?${qs}`, { headers, credentials: 'same-origin' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to load audit trail (${res.status})`);
  }
  return res.json() as Promise<AuditTrailResponse>;
}

async function downloadAuditTrailCsv(params: Record<string, string>): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const qs = new URLSearchParams({ ...params, format: 'csv' }).toString();
  const res = await fetch(`/api/admin/audit-trail?${qs}`, { headers, credentials: 'same-origin' });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || `mbumah-audit-trail-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

// Component

export function AuditTrailSection() {
  // Raw input state (debounced into the query params)
  const [role, setRole] = useState('all');
  const [userInput, setUserInput] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [deniedOnly, setDeniedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  // 300 ms debounce for the text inputs so typing doesn't hammer the API.
  const [userFilter, setUserFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setUserFilter(userInput.trim()), 300);
    return () => clearTimeout(t);
  }, [userInput]);
  useEffect(() => {
    const t = setTimeout(() => setSearchFilter(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Any filter change resets pagination.
  useEffect(() => {
    setPage(1);
  }, [role, userFilter, searchFilter, dateFrom, dateTo, deniedOnly]);

  const params = useMemo(() => {
    const p: Record<string, string> = { page: String(page), limit: '50' };
    if (role !== 'all') p.role = role;
    if (userFilter) p.user = userFilter;
    if (searchFilter) p.search = searchFilter;
    if (dateFrom) p.dateFrom = dateFrom;
    if (dateTo) p.dateTo = dateTo;
    if (deniedOnly) p.deniedOnly = 'true';
    return p;
  }, [page, role, userFilter, searchFilter, dateFrom, dateTo, deniedOnly]);

  const hasActiveFilters =
    role !== 'all' || !!userFilter || !!searchFilter || !!dateFrom || !!dateTo || deniedOnly;

  const {
    data, isLoading, isRefetching, refetch, isError, error,
  } = useQuery({
    queryKey: ['admin-audit-trail', params],
    queryFn: () => fetchAuditTrail(params),
    placeholderData: (prev) => prev, // keep the table visible while paging
  });

  const rows = data?.data ?? [];
  const pagination = data?.pagination;

  const handleExport = async () => {
    setExporting(true);
    try {
      await downloadAuditTrailCsv(params);
      toast.success('Audit trail exported', { description: 'CSV download started.' });
    } catch (e) {
      toast.error('Export failed', {
        description: e instanceof Error ? e.message : 'Could not generate the CSV.',
      });
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => {
    setRole('all');
    setUserInput('');
    setSearchInput('');
    setDateFrom('');
    setDateTo('');
    setDeniedOnly(false);
  };

  return (
    <div className="space-y-4">
      {/* ── Filters row ── */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-9 text-sm" aria-label="Filter by role">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">User</Label>
              <Input
                type="search"
                placeholder="Name or email…"
                value={userInput}
                onChange={(e) => setUserInput(e.target.value)}
                className="h-9 text-sm"
                aria-label="Filter by user name or email"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 text-sm"
                aria-label="Date from"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 text-sm"
                aria-label="Date to"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Search</Label>
              <Input
                type="search"
                placeholder="Permission, resource, reason…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="h-9 text-sm"
                aria-label="Search audit events"
              />
            </div>
            <div className="flex items-end gap-4">
              <div className="flex items-center gap-2 pb-1.5">
                <Switch
                  id="audit-denied-only"
                  checked={deniedOnly}
                  onCheckedChange={setDeniedOnly}
                  aria-label="Denied only"
                />
                <Label htmlFor="audit-denied-only" className="text-xs font-medium cursor-pointer">
                  Denied only
                </Label>
              </div>
            </div>
            <div className="sm:col-span-2 flex items-end justify-end gap-2">
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5 mr-1" />
                  Clear
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs"
                onClick={() => refetch()}
                disabled={isRefetching}
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isRefetching ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button size="sm" className="h-9 text-xs" onClick={handleExport} disabled={exporting}>
                <Download className="h-3.5 w-3.5 mr-1" />
                {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Table ── */}
      <Card>
        <CardContent className="p-0">
          {isError ? (
            <div className="p-8 text-center">
              <ShieldOff className="h-10 w-10 mx-auto text-red-400/50 mb-2" />
              <p className="text-sm font-medium text-muted-foreground">
                Failed to load the audit trail
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {error instanceof Error ? error.message : 'Please try again.'}
              </p>
            </div>
          ) : isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center">
              <ScrollText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">
                No audit events match your filters
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Permission denials, manager overrides and authorizations appear here.
              </p>
            </div>
          ) : (
            <div className="max-h-[65vh] overflow-y-auto scrollbar-thin">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-xs h-9">Timestamp</TableHead>
                    <TableHead className="text-xs h-9">User</TableHead>
                    <TableHead className="text-xs h-9">Role</TableHead>
                    <TableHead className="text-xs h-9">Action</TableHead>
                    <TableHead className="text-xs h-9">Resource</TableHead>
                    <TableHead className="text-xs h-9">Result</TableHead>
                    <TableHead className="text-xs h-9">Branch</TableHead>
                    <TableHead className="text-xs h-9">IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.source}-${row.id}`}>
                      <TableCell className="py-2 align-top whitespace-nowrap">
                        <div className="text-xs font-medium">
                          {formatDateTime(row.timestamp)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {formatRelativeTime(row.timestamp)}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 align-top max-w-[160px]">
                        <div className="text-xs font-medium truncate" title={row.userName}>
                          {row.userName}
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate" title={row.userEmail}>
                          {row.userEmail || '-'}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 align-top">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {ROLE_OPTIONS.find((r) => r.value === row.role)?.label ?? row.role}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 align-top">
                        <Badge variant="outline" className={`text-[10px] font-medium whitespace-nowrap ${actionBadgeClass(row.action)}`}>
                          {row.actionLabel}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-2 align-top max-w-[180px]">
                        <div className="text-xs truncate" title={row.resource}>
                          {row.resource}
                        </div>
                        {row.details && (
                          <div className="text-[10px] text-muted-foreground truncate max-w-[180px]" title={row.details}>
                            {row.details}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="py-2 align-top">
                        {row.result === 'DENIED' ? (
                          <Badge variant="outline" className="text-[10px] font-semibold bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400">
                            DENIED
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] font-semibold bg-green-500/10 text-green-600 border-green-500/20 dark:text-green-400">
                            SUCCESS
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-2 align-top">
                        <span className="text-xs whitespace-nowrap">{row.branchName ?? '-'}</span>
                      </TableCell>
                      <TableCell className="py-2 align-top">
                        <span className="text-xs font-mono whitespace-nowrap">{row.ipAddress || '-'}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* ── Pagination ── */}
          {!isLoading && !isError && rows.length > 0 && pagination && (
            <div className="flex items-center justify-between border-t px-4 py-2.5">
              <p className="text-xs text-muted-foreground">
                {pagination.total.toLocaleString()} event{pagination.total !== 1 ? 's' : ''} · page {pagination.page} of {pagination.totalPages}
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={pagination.page <= 1}
                  onClick={() => setPage((p) => Math.max(p - 1, 1))}
                >
                  <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default AuditTrailSection;
