// MBUMAH HARDWARE POS - System Health (Power-On Self-Test) admin section, v2.14.0
// One honest card for the boot self-test:
//   - Runs the POST battery (database, core tables, prisma client, env,
//     store, product catalog, engraved admin) on mount and every 60 seconds.
//   - Renders each check as a row (green CheckCircle2 / amber AlertTriangle /
//     red XCircle) plus an overall PASS / DEGRADED / FAIL badge.
//   - "Run Self-Heal" (AlertDialog confirmation) POSTs /api/system/heal to
//     re-ensures the engraved bootstrap admin, then re-renders the fresh
//     report and toasts the outcome.
// Everything degrades honestly - a failed heal is shown, never swallowed.

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  HeartPulse,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

/** Mirrors PostCheck in src/lib/post.ts. */
type PostCheckStatus = 'PASS' | 'FAIL' | 'WARN';
type PostOverallStatus = 'PASS' | 'FAIL' | 'DEGRADED';

interface PostCheck {
  id: string;
  label: string;
  status: PostCheckStatus;
  detail?: string;
  required: boolean;
}

interface PostReport {
  status: PostOverallStatus;
  version: string;
  timestamp: string;
  durationMs: number;
  checks: PostCheck[];
}

interface HealResponse {
  success: boolean;
  healed: boolean;
  admin: { email: string; reason: string; created: boolean };
  post: PostReport;
}

const SYSTEM_POST_QUERY_KEY = ['system-post'] as const;
const SYSTEM_POST_REFRESH_MS = 60_000;

/** Authenticated JSON fetch (mirrors the admin tab's authedFetch helper). */
async function authedJson<T>(input: string, init: RequestInit = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const headers = new Headers(init.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers, credentials: 'same-origin' });
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    throw new Error(body?.error || `Request failed (${res.status}).`);
  }
  return body as T;
}

function statusIcon(status: PostCheckStatus) {
  switch (status) {
    case 'PASS':
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600 dark:text-green-500" aria-hidden="true" />;
    case 'WARN':
      return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden="true" />;
    default:
      return <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-500" aria-hidden="true" />;
  }
}

const STATUS_BADGE_CLASS: Record<PostOverallStatus, string> = {
  PASS: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
  DEGRADED: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  FAIL: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800',
};

const STATUS_TEXT_CLASS: Record<PostCheckStatus, string> = {
  PASS: 'text-green-600 dark:text-green-500',
  WARN: 'text-amber-600 dark:text-amber-500',
  FAIL: 'text-red-600 dark:text-red-500',
};

function statusLabel(status: PostCheckStatus): string {
  switch (status) {
    case 'PASS':
      return 'Pass';
    case 'WARN':
      return 'Warning';
    default:
      return 'Fail';
  }
}

export function SystemHealthSection() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: SYSTEM_POST_QUERY_KEY,
    queryFn: () => authedJson<{ success: boolean; data: PostReport }>('/api/system/post'),
    refetchInterval: SYSTEM_POST_REFRESH_MS,
  });

  const healMutation = useMutation({
    mutationFn: () => authedJson<HealResponse>('/api/system/heal', { method: 'POST' }),
    onSuccess: (res) => {
      queryClient.setQueryData(SYSTEM_POST_QUERY_KEY, { success: true, data: res.post });
      toast.success(`Self-heal complete - ${res.admin.email} (${res.admin.reason}).`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Self-heal failed.');
    },
  });

  const report = data?.data;

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <HeartPulse className="h-4 w-4" /> System Health
          </CardTitle>
          <div className="flex items-center gap-2">
            {report && (
              <Badge variant="outline" className={`text-[10px] ${STATUS_BADGE_CLASS[report.status]}`}>
                {report.status}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => refetch()}
              disabled={isRefetching}
              title="Re-run the self-test"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={healMutation.isPending}
                >
                  <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                  {healMutation.isPending ? 'Healing...' : 'Run Self-Heal'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Run system self-heal?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This re-ensures the engraved bootstrap administrator (admin@mbumahhardware.co.ke), then re-runs the
                    full power-on self-test. Safe to run at any time - the heal is idempotent and audited.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => healMutation.mutate()} disabled={healMutation.isPending}>
                    {healMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
                    Run Self-Heal
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        {report && (
          <CardDescription className="text-xs">
            v{report.version} - {report.checks.length} checks in {report.durationMs}ms - auto-refreshes every 60s.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isError || !report ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <XCircle className="h-4 w-4 text-red-600 dark:text-red-500" />
            Self-test unavailable.
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <ul className="space-y-1.5 max-h-72 overflow-y-auto custom-scrollbar pr-1" aria-label="Power-on self-test checks">
            {report.checks.map((check) => (
              <li
                key={check.id}
                className="flex items-start gap-2.5 rounded-lg border border-transparent px-2 py-1.5 hover:bg-muted/30 transition-colors"
              >
                {statusIcon(check.status)}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium leading-tight">{check.label}</p>
                    <span className={`text-[10px] font-semibold uppercase tracking-wide ${STATUS_TEXT_CLASS[check.status]}`}>
                      {statusLabel(check.status)}
                    </span>
                    {!check.required && (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                        optional
                      </Badge>
                    )}
                  </div>
                  {check.detail && (
                    <p className="text-xs text-muted-foreground mt-0.5 break-words">{check.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
