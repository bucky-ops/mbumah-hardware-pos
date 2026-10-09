'use client';

// MBUMAH HARDWARE POS - Updates, Rollback & Backups (admin card, v2.9.0)
// One honest panel for the three architecture-plan components:
//   • Current version + update availability (GitHub Releases, live check).
//   • Data-protection state (last crash/manual backup) + "Back up now"
//     (POST /api/admin/backup → JSON snapshot download).
//   • Rollback: cloud = one-click re-point to a previous Vercel deployment;
//     laptop kits are pointed at Rollback-Mbumah-POS.bat (deploy-kit).
// Everything degrades honestly - nothing is ever shown as available when it
// is not configured.

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowDownToLine,
  CheckCircle2,
  Cloud,
  Download,
  ExternalLink,
  HardDrive,
  History,
  Laptop,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Undo2,
} from 'lucide-react';

import { updatesApi, formatDateTime, type UpdateStatusData } from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const UPDATES_QUERY_KEY = ['admin-updates'] as const;

/** Deployment row label: "02 Feb 14:03 · 10206a2 · READY". */
function deploymentLabel(d: UpdateStatusData['deployments'][number]): string {
  const when = new Date(d.createdAt);
  const date = Number.isNaN(when.getTime())
    ? '—'
    : when.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) +
      ' ' +
      when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${d.sha ?? 'no-sha'} · ${d.state}`;
}

/** POST /api/admin/backup → stream the JSON snapshot to a browser download. */
async function downloadBackupSnapshot(): Promise<string> {
  const token =
    typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const res = await fetch('/api/admin/backup', {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    credentials: 'same-origin',
  });

  if (!res.ok) {
    let message = `Backup failed (HTTP ${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body - keep the HTTP-status message
    }
    throw new Error(message);
  }

  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename =
    match?.[1] ??
    `mbumah-snapshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return filename;
}

export function UpdatesSafetySection() {
  const queryClient = useQueryClient();
  const [selectedDeployment, setSelectedDeployment] = useState<string>('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const statusQuery = useQuery({
    queryKey: UPDATES_QUERY_KEY,
    queryFn: () => updatesApi.getStatus(),
    refetchInterval: 5 * 60 * 1000, // keep the release check fresh, cheaply
  });

  const backupNow = useMutation({
    mutationFn: downloadBackupSnapshot,
    onSuccess: (filename) => {
      toast.success(`Backup downloaded (${filename}) and logged.`);
      void queryClient.invalidateQueries({ queryKey: UPDATES_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rollback = useMutation({
    mutationFn: (deploymentId: string) => updatesApi.rollback(deploymentId),
    onSuccess: (res) => {
      toast.success(res.data?.message ?? 'Rollback initiated.');
      setConfirmOpen(false);
      void queryClient.invalidateQueries({ queryKey: UPDATES_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const data = statusQuery.data;
  const deployments = data?.deployments ?? [];
  const rollbackEnabled = Boolean(
    data?.channel === 'cloud' && data?.vercelConfigured && deployments.length > 0,
  );

  return (
    <Card className="backdrop-blur-sm bg-card/80 border-border/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Updates, Rollback &amp; Backups
        </CardTitle>
        <CardDescription className="text-xs">
          Automatic dormant-hours updates, one-click rollback and crash-safe
          database backups — the safety net behind every release
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ── Version & update availability ─────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Running:</span>
          {statusQuery.isLoading ? (
            <Skeleton className="h-5 w-40" />
          ) : data ? (
            <>
              <Badge variant="outline" className="font-mono text-xs">
                {data.current.buildLabel}
              </Badge>
              {data.channel === 'cloud' ? (
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800 text-xs">
                  <Cloud className="h-3 w-3 mr-1" /> Cloud
                </Badge>
              ) : (
                <Badge className="bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800 text-xs">
                  <Laptop className="h-3 w-3 mr-1" /> Laptop kit
                </Badge>
              )}
              {data.updateAvailable && data.latestRelease ? (
                <Badge className="bg-emerald-600 text-white text-xs">
                  <History className="h-3 w-3 mr-1" />
                  Update available: {data.latestRelease.tag}
                </Badge>
              ) : data.latestRelease ? (
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Up to date with the latest release
                </span>
              ) : null}
              {data.latestRelease?.url ? (
                <a
                  href={data.latestRelease.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 inline-flex items-center gap-1 underline underline-offset-2"
                >
                  Release notes <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              Version unknown (is the server healthy?)
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs ml-auto"
            onClick={() => void statusQuery.refetch()}
            disabled={statusQuery.isFetching}
            aria-label="Refresh update status"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${statusQuery.isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Honest degradation notes (release check / Vercel API failures) */}
        {(data?.releasesNote || data?.vercelNote) && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-900/20 px-3 py-2 space-y-1">
            {data?.releasesNote ? (
              <p className="text-[11px] text-amber-800 dark:text-amber-300">{data.releasesNote}</p>
            ) : null}
            {data?.vercelNote ? (
              <p className="text-[11px] text-amber-800 dark:text-amber-300">{data.vercelNote}</p>
            ) : null}
          </div>
        )}

        {/* ── Backups ───────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between rounded-lg border border-border/60 p-3">
          <div className="min-w-0">
            <p className="text-xs font-medium flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-emerald-600" /> Data protection
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {data?.lastBackup
                ? `Last backup: ${data.lastBackup.action === 'CRASH_BACKUP' ? 'automatic (crash-safe)' : 'manual'} · ${formatDateTime(data.lastBackup.at)}`
                : 'No backup recorded yet on this installation.'}
            </p>
            <p className="text-[10px] text-muted-foreground/80 mt-0.5">
              Laptop kits additionally back up every night at 02:30 to
              Desktop\MbumahBackups; cloud databases use Neon PITR.
            </p>
          </div>
          <Button
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={() => backupNow.mutate()}
            disabled={backupNow.isPending || statusQuery.isLoading}
          >
            {backupNow.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            Back up now
          </Button>
        </div>

        {/* ── Rollback ──────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
          <div>
            <p className="text-xs font-medium flex items-center gap-1.5">
              <Undo2 className="h-3.5 w-3.5 text-emerald-600" /> Roll back production
            </p>
            {!data ? (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Waiting for status…
              </p>
            ) : data.channel === 'laptop' ? (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                This is a laptop installation — run{' '}
                <span className="font-mono text-[10px]">Rollback-Mbumah-POS.bat</span>{' '}
                in the app folder and pick the version to restore. Your data is
                never changed by a rollback.
              </p>
            ) : !data.vercelConfigured ? (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                One-click production rollback needs{' '}
                <span className="font-mono text-[10px]">VERCEL_TOKEN</span> +{' '}
                <span className="font-mono text-[10px]">VERCEL_PROJECT_ID</span> in
                the environment (see .env.example). Until then, roll back from
                the Vercel dashboard → Deployments.
              </p>
            ) : deployments.length === 0 ? (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                No recent Vercel production deployments found to roll back to.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Re-points the live domain at a previous deployment. The current
                deployment stays listed, so you can roll forward again.
              </p>
            )}
          </div>

          {rollbackEnabled ? (
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
              <Select
                value={selectedDeployment}
                onValueChange={setSelectedDeployment}
              >
                <SelectTrigger className="w-full sm:w-72 h-8 text-xs" aria-label="Deployment to roll back to">
                  <SelectValue placeholder="Choose a previous deployment…" />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {deployments.map((d) => (
                    <SelectItem key={d.uid} value={d.uid} className="text-xs">
                      {deploymentLabel(d)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogAction
                  className="h-8 text-xs shrink-0"
                  disabled={!selectedDeployment || rollback.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    setConfirmOpen(true);
                  }}
                >
                  <Undo2 className="h-3.5 w-3.5 mr-1.5" /> Roll back
                </AlertDialogAction>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Roll back production?</AlertDialogTitle>
                    <AlertDialogDescription>
                      The live site will be re-pointed at{' '}
                      <span className="font-mono text-xs">
                        {selectedDeployment
                          ? deploymentLabel(
                              deployments.find((d) => d.uid === selectedDeployment) ?? {
                                uid: selectedDeployment,
                                state: '',
                                createdAt: NaN,
                                url: null,
                                sha: null,
                              },
                            )
                          : ''}
                      </span>
                      . This affects every store until you roll forward again.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-amber-600 hover:bg-amber-700"
                      disabled={rollback.isPending}
                      onClick={(event) => {
                        event.preventDefault();
                        if (selectedDeployment) rollback.mutate(selectedDeployment);
                      }}
                    >
                      {rollback.isPending ? (
                        <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      ) : (
                        <ArrowDownToLine className="h-4 w-4 mr-1.5" />
                      )}
                      Yes, roll back
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
