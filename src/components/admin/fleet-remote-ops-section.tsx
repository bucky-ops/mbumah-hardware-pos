'use client';

// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Fleet & Remote Ops (RAK admin console, v2.11.0)
// ─────────────────────────────────────────────────────────────────────────────
// Remote Access Kit control surface (docs/REMOTE_ACCESS_KIT_PLAN.md §8):
//   • Fleet table — every store agent (version/health/heartbeat/frozen/pending)
//     plus the cloud row, with drift badges vs the latest GitHub release.
//   • Issue command — signed update / rollback / freeze / unfreeze / remote-view
//     commands to one or more stores; every issue lands as a GitHub commit and
//     the dialog shows the commit links ("every action is recorded").
//   • Activity log — the merged per-store ledgers, newest first, with GitHub
//     commit links where the agent reported them.
// Everything degrades honestly when OPS_GITHUB_TOKEN / OPS_SIGNING_KEY are not
// configured on the server — the panel explains exactly what to set.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  GitCommitHorizontal,
  Laptop,
  Loader2,
  Lock,
  RefreshCw,
  Send,
  Snowflake,
  XCircle,
} from 'lucide-react';

import {
  fleetApi,
  updatesApi,
  formatDateTime,
  type FleetAgent,
  type FleetLogRow,
} from '@/lib/api';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

const FLEET_QUERY_KEY = ['admin-fleet'] as const;
const FLEET_LOG_QUERY_KEY = ['admin-fleet-log'] as const;

type CommandType = 'update' | 'rollback' | 'freeze' | 'unfreeze' | 'tunnel';

const COMMAND_LABELS: Record<CommandType, string> = {
  update: 'Update',
  rollback: 'Roll back',
  freeze: 'Freeze updates',
  unfreeze: 'Unfreeze',
  tunnel: 'Remote view',
};

const EVENT_LABELS: Record<string, string> = {
  heartbeat: 'Heartbeat',
  result: 'Result',
};

/** "2 mins ago" style relative time for heartbeats/results. */
function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'never';
  if (ms < 0) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function statusBadge(agent: FleetAgent) {
  const map: Record<FleetAgent['status'], { label: string; className: string }> = {
    online: { label: 'Online', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    stale: { label: 'Stale', className: 'bg-amber-100 text-amber-800 border-amber-200' },
    offline: { label: 'Offline', className: 'bg-slate-100 text-slate-600 border-slate-200' },
    unknown: { label: 'Unknown', className: 'bg-slate-100 text-slate-500 border-slate-200' },
  };
  const s = map[agent.status] ?? map.unknown;
  return <Badge variant="outline" className={s.className}>{s.label}</Badge>;
}

function outcomeBadge(event: string, outcome?: unknown) {
  if (event === 'result' && typeof outcome === 'string') {
    const ok = outcome === 'success';
    const neutral = outcome.startsWith('rejected') || outcome === 'not_supported' || outcome === 'duplicate';
    return (
      <Badge
        variant="outline"
        className={
          ok
            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
            : neutral
              ? 'bg-amber-100 text-amber-800 border-amber-200'
              : 'bg-red-100 text-red-800 border-red-200'
        }
      >
        {outcome}
      </Badge>
    );
  }
  return <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200">{EVENT_LABELS[event] ?? event}</Badge>;
}

export function FleetRemoteOpsSection() {
  const queryClient = useQueryClient();

  // ── Fleet snapshot ──
  const fleetQuery = useQuery({
    queryKey: FLEET_QUERY_KEY,
    queryFn: () => fleetApi.getStatus(),
    refetchInterval: 90_000,
  });
  const fleet = fleetQuery.data;

  // ── Latest release tag (prefills the composer) ──
  const updatesQuery = useQuery({
    queryKey: ['admin-updates'],
    queryFn: () => updatesApi.getStatus(),
    staleTime: 5 * 60_000,
  });

  // ── Composer state ──
  const [composerOpen, setComposerOpen] = useState(false);
  const [commandType, setCommandType] = useState<CommandType>('update');
  const [targets, setTargets] = useState<string[]>([]);
  const [version, setVersion] = useState('');
  const [force, setForce] = useState(false);
  const [ttl, setTtl] = useState('60');
  const [reason, setReason] = useState('');
  const [logOpen, setLogOpen] = useState(false);

  const latestTag = fleet?.cloud.latestRelease ?? updatesQuery.data?.latestRelease?.tag ?? '';

  // ── Activity log (lazy — only when the drawer opens) ──
  const logQuery = useQuery({
    queryKey: [...FLEET_LOG_QUERY_KEY, logOpen],
    queryFn: () => fleetApi.getLog({ limit: 40 }),
    enabled: logOpen,
  });

  const issueMutation = useMutation({
    mutationFn: () =>
      fleetApi.issueCommand({
        type: commandType,
        targets,
        ...(commandType === 'update' || commandType === 'rollback' ? { version: version || latestTag } : {}),
        ...(force ? { force: true } : {}),
        ...(commandType === 'tunnel' ? { ttlMinutes: Math.max(5, Math.min(240, Number(ttl) || 60)) } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: (res) => {
      const data = res.data;
      if (!data) {
        toast.error('Command response was empty — check the activity log.');
        return;
      }
      const links = data.issued
        .map((i) => `${i.target}: ${i.commitUrl ?? i.commandId}`)
        .join('  ·  ');
      toast.success(data.message, {
        description: links,
        duration: 10_000,
        action: data.issued[0]?.commitUrl
          ? { label: 'View on GitHub', onClick: () => window.open(String(data.issued[0].commitUrl), '_blank') }
          : undefined,
      });
      setComposerOpen(false);
      setTargets([]);
      setForce(false);
      setReason('');
      queryClient.invalidateQueries({ queryKey: FLEET_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: FLEET_LOG_QUERY_KEY });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Could not issue the command.');
    },
  });

  const agentList = useMemo(() => fleet?.agents ?? [], [fleet]);
  const needsVersion = commandType === 'update' || commandType === 'rollback';
  const reasonRequired = commandType === 'freeze' || commandType === 'unfreeze' || force;
  const canIssue =
    targets.length > 0 &&
    (!needsVersion || Boolean(version || latestTag)) &&
    (!reasonRequired || reason.trim().length > 0) &&
    !issueMutation.isPending;

  const pendingCount = useMemo(
    () => agentList.filter((a) => a.pendingCommand).length,
    [agentList],
  );

  const toggleTarget = (storeId: string) => {
    setTargets((prev) =>
      prev.includes(storeId) ? prev.filter((t) => t !== storeId) : [...prev, storeId],
    );
  };

  const selectAll = () => setTargets(agentList.map((a) => a.storeId));

  return (
    <Card data-testid="fleet-remote-ops">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Laptop className="h-4 w-4 text-primary" aria-hidden />
            Fleet &amp; Remote Ops
            {pendingCount > 0 && (
              <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                {pendingCount} pending
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Push updates, roll back, freeze or view any store from anywhere — signed commands via the{' '}
            <span className="font-mono text-xs">{fleet?.repo ?? 'mbumah-ops-log'}</span> repo; every action is a
            GitHub commit.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fleetQuery.refetch()}
          disabled={fleetQuery.isFetching}
          aria-label="Refresh fleet status"
        >
          {fleetQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {fleetQuery.isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {!fleetQuery.isLoading && fleet && !fleet.configured && (
          <Alert>
            <Lock className="h-4 w-4" aria-hidden />
            <AlertTitle>Remote Ops is not configured yet</AlertTitle>
            <AlertDescription className="text-sm">
              {fleet.note}
              <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                <div>1. Create the device tokens + shared signing key (docs/REMOTE_ACCESS_KIT_PLAN.md §5, §10).</div>
                <div>2. Set <span className="font-mono">OPS_GITHUB_TOKEN</span> and <span className="font-mono">OPS_SIGNING_KEY</span> on this server.</div>
                <div>3. Kits need <span className="font-mono">STORE_ID</span> + <span className="font-mono">OPS_SIGNING_KEY</span> + a read-only device token in their <span className="font-mono">.env</span> (the installer writes the first two automatically since v2.11.0).</div>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {!fleetQuery.isLoading && fleet?.configured && fleet.note && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" aria-hidden />
            <AlertTitle>Fleet read failed</AlertTitle>
            <AlertDescription className="text-sm">{fleet.note}</AlertDescription>
          </Alert>
        )}

        {!fleetQuery.isLoading && fleet && (
          <>
            {/* Cloud row */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="fleet-cloud-row">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-emerald-100 text-emerald-800 border-emerald-200">
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden /> Cloud
                </Badge>
                <span className="text-sm font-medium">
                  v{fleet.cloud.version}
                  {fleet.cloud.buildSha ? ` · ${fleet.cloud.buildSha}` : ''}
                </span>
                {fleet.cloud.updateAvailable ? (
                  <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                    Update available{fleet.cloud.latestRelease ? `: ${fleet.cloud.latestRelease}` : ''}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-100">
                    Up to date
                  </Badge>
                )}
              </div>
              <span className="text-xs text-muted-foreground">This deployment (Vercel) — merges to main deploy automatically</span>
            </div>

            {/* Agent rows */}
            {agentList.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-sm text-muted-foreground">
                No store agents have reported yet. Agents appear here after their first heartbeat
                (every 15 min when configured with a device token).
              </div>
            ) : (
              <ScrollArea className="max-h-72">
                <div className="space-y-2 pr-2">
                  {agentList.map((agent) => (
                    <div
                      key={agent.storeId}
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${
                        agent.frozen ? 'border-sky-200 bg-sky-50' : 'border-slate-200'
                      }`}
                      data-testid={`fleet-agent-${agent.storeId}`}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">{agent.storeId}</span>
                          {statusBadge(agent)}
                          {agent.frozen && (
                            <Badge variant="outline" className="bg-sky-100 text-sky-800 border-sky-200">
                              <Snowflake className="mr-1 h-3 w-3" aria-hidden /> Frozen
                            </Badge>
                          )}
                          {agent.drift === 'behind' && (
                            <Badge variant="outline" className="bg-amber-100 text-amber-800 border-amber-200">
                              Behind{fleet.cloud.latestRelease ? ` (latest ${fleet.cloud.latestRelease})` : ''}
                            </Badge>
                          )}
                          {agent.drift === 'up_to_date' && (
                            <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-100">
                              Up to date
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                          <span>Version: <span className="font-medium text-foreground">{agent.version ?? 'unknown'}</span></span>
                          <span>Health: <span className="font-medium text-foreground">{agent.health ?? 'unknown'}</span></span>
                          <span>Heartbeat: {timeAgo(agent.lastHeartbeatAt)}</span>
                          <span>Last event: {agent.lastEvent ?? '—'} · {timeAgo(agent.lastEventAt)}</span>
                        </div>
                        {agent.pendingCommand && (
                          <div className="text-xs text-amber-700">
                            Pending {agent.pendingCommand.type}
                            {agent.pendingCommand.version ? ` → ${agent.pendingCommand.version}` : ''}
                            {agent.pendingCommand.force ? ' (FORCED)' : ''} — issued by {agent.pendingCommand.issuedBy || 'unknown'} {timeAgo(agent.pendingCommand.issuedAt)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setComposerOpen(true)} disabled={agentList.length === 0} data-testid="issue-command">
                <Send className="mr-2 h-4 w-4" aria-hidden /> Issue command
              </Button>
              <Collapsible open={logOpen} onOpenChange={setLogOpen}>
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="outline">
                    <ChevronDown className={`mr-2 h-4 w-4 transition-transform ${logOpen ? 'rotate-180' : ''}`} aria-hidden />
                    Activity log
                  </Button>
                </CollapsibleTrigger>
              </Collapsible>
              {fleet.cloud.releaseUrl && (
                <Button size="sm" variant="ghost" asChild>
                  <a href={fleet.cloud.releaseUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" aria-hidden /> Latest release
                  </a>
                </Button>
              )}
            </div>

            {/* Activity log drawer */}
            <Collapsible open={logOpen} onOpenChange={setLogOpen}>
              <CollapsibleContent>
                <ScrollArea className="max-h-80 rounded-xl border border-slate-200">
                  <div className="divide-y divide-slate-100">
                    {logQuery.isLoading && (
                      <div className="p-4"><Skeleton className="h-16 w-full" /></div>
                    )}
                    {!logQuery.isLoading && (logQuery.data?.rows.length ?? 0) === 0 && (
                      <div className="p-6 text-center text-sm text-muted-foreground">
                        No fleet activity recorded yet.
                      </div>
                    )}
                    {logQuery.data?.rows.map((row: FleetLogRow, idx: number) => (
                      <div key={`${row.ts}-${idx}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {outcomeBadge(String(row.event), row.outcome)}
                            <span className="font-mono text-xs font-semibold">{row.storeId}</span>
                            {typeof row.detail === 'string' && (
                              <span className="truncate text-xs text-muted-foreground">{row.detail}</span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {formatDateTime(row.ts)}
                            {typeof row.version === 'string' ? ` · v${row.version}` : ''}
                          </div>
                        </div>
                        {typeof row.commitUrl === 'string' && row.commitUrl && (
                          <Button size="sm" variant="ghost" asChild>
                            <a href={row.commitUrl} target="_blank" rel="noreferrer">
                              <GitCommitHorizontal className="mr-1 h-3.5 w-3.5" aria-hidden /> Commit
                            </a>
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </CardContent>

      {/* ── Issue-command dialog ── */}
      <AlertDialog open={composerOpen} onOpenChange={setComposerOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Issue fleet command</AlertDialogTitle>
            <AlertDialogDescription>
              Commands are signed and committed to <span className="font-mono">{fleet?.repo ?? 'mbumah-ops-log'}</span>;
              agents execute on their next 15-minute poll (or the next dormant window unless forced). Every command
              is permanently recorded in GitHub.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="fleet-command-type">Command</Label>
              <Select
                value={commandType}
                onValueChange={(v) => {
                  setCommandType(v as CommandType);
                  if (v === 'freeze' || v === 'unfreeze') setForce(false);
                }}
              >
                <SelectTrigger id="fleet-command-type" data-testid="fleet-command-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(COMMAND_LABELS) as CommandType[]).map((t) => (
                    <SelectItem key={t} value={t} disabled={t === 'tunnel'}>
                      {COMMAND_LABELS[t]}
                      {t === 'tunnel' ? ' (Phase 3 — soon)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Target stores ({targets.length}/{agentList.length})</Label>
                <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={selectAll}>
                  Select all
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5" data-testid="fleet-targets">
                {agentList.map((a) => {
                  const selected = targets.includes(a.storeId);
                  return (
                    <button
                      key={a.storeId}
                      type="button"
                      onClick={() => toggleTarget(a.storeId)}
                      aria-pressed={selected}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                        selected
                          ? 'border-emerald-300 bg-emerald-100 text-emerald-900'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {a.storeId}
                      {a.frozen ? ' (frozen)' : ''}
                    </button>
                  );
                })}
              </div>
            </div>

            {needsVersion && (
              <div className="space-y-1.5">
                <Label htmlFor="fleet-version">Release tag</Label>
                <Input
                  id="fleet-version"
                  placeholder={latestTag || 'v2.11.0'}
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  data-testid="fleet-version"
                />
                {latestTag && !version && (
                  <p className="text-xs text-muted-foreground">
                    Latest published release is <span className="font-mono">{latestTag}</span> — used if left empty.
                  </p>
                )}
              </div>
            )}

            {commandType === 'tunnel' && (
              <div className="space-y-1.5">
                <Label htmlFor="fleet-ttl">Session length (minutes, 5–240)</Label>
                <Input id="fleet-ttl" inputMode="numeric" value={ttl} onChange={(e) => setTtl(e.target.value)} />
              </div>
            )}

            {(commandType === 'update' || commandType === 'rollback') && (
              <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="fleet-force" className="text-sm">Force during trading hours</Label>
                  <p className="text-xs text-muted-foreground">Off (recommended): executes in tonight&apos;s 22:00–06:00 dormant window.</p>
                </div>
                <Switch id="fleet-force" checked={force} onCheckedChange={setForce} data-testid="fleet-force" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="fleet-reason">
                Reason {reasonRequired ? '(required)' : '(optional — goes into the permanent ledger)'}
              </Label>
              <Input
                id="fleet-reason"
                placeholder={commandType === 'freeze' ? 'Peak trading — no updates until January' : 'e.g. v2.11.0 feature rollout'}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="fleet-reason"
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={issueMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!canIssue}
              onClick={(e) => {
                e.preventDefault();
                issueMutation.mutate();
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              data-testid="fleet-issue-confirm"
            >
              {issueMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Send className="mr-2 h-4 w-4" aria-hidden />}
              Issue {targets.length > 0 ? `${targets.length} ` : ''}{COMMAND_LABELS[commandType].toLowerCase()} command{targets.length === 1 ? '' : 's'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
