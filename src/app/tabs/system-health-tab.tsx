'use client';

/**
 * MBUMAH HARDWARE — System Health & Monitoring Tab
 *
 * Phase 8 — Real-time system health dashboard that aggregates:
 *   • Overall system status
 *   • Database health
 *   • Circuit breaker states
 *   • Dead Letter Queue metrics
 *   • Security events
 *   • Financial integrity
 *   • ISO compliance scores
 *   • Data retention policies
 *   • Audit trail statistics
 *   • Access control metrics
 */

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity, Database, Shield, AlertTriangle, CheckCircle,
  XCircle, AlertOctagon, RefreshCw, Clock, Server,
  Zap, Mail, MessageSquare, Smartphone, Globe,
  Minus,
  ChevronDown, ChevronRight,
  Trash2, RotateCcw, X,
  BarChart3, Heart,
  Cpu,
  FileText, Lock, Unlock, Award,
  CircleDollarSign,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';


// ── Types ──────────────────────────────────────────────────────────────────

interface BreakerMetrics {
  name: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  totalCalls: number;
  totalSuccesses: number;
  totalFailures: number;
  totalTrips: number;
  windowSize: number;
  windowFailures: number;
  failureRate: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  openedAt: string | null;
  msUntilHalfOpen: number;
  halfOpenInFlight: number;
}

interface DLQMetrics {
  pending: number;
  retrying: number;
  completed: number;
  dead: number;
  cancelled: number;
  totalEnqueued: number;
}

interface DLQItem {
  id: string;
  operationType: string;
  targetService: string;
  status: string;
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  createdAt: string;
  nextRetryAt: string | null;
  payload: string;
}

interface SystemStatus {
  overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  nodeEnv: string;
  database: {
    status: 'ok' | 'warning' | 'error';
    detail: string;
    responseTime: number;
    stats?: Record<string, number>;
  };
  circuitBreakers: {
    status: 'ok' | 'warning' | 'error';
    total: number;
    open: number;
    halfOpen: number;
    closed: number;
    breakers: BreakerMetrics[];
  };
  deadLetterQueue: {
    status: 'ok' | 'warning' | 'error';
  } & DLQMetrics;
  security: {
    status: 'ok' | 'warning' | 'error';
    criticalEventsLastHour: number;
    lockedAccounts: number;
  };
  financial: {
    status: 'ok' | 'warning' | 'error';
    detail: string;
  };
  compliance: {
    overallScore: number;
    iso27001Score: number;
    iso9001Score: number;
    resilienceStatus: Record<string, string>;
  };
  retention?: Array<{ name: string; retentionDays: number; isoRef: string; purgeableCount: number }>;
  accessControl?: Record<string, unknown>;
  auditTrail?: Record<string, unknown>;
}

// ── Helper functions ───────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function getBreakerIcon(name: string) {
  if (name.includes('twilio-sms') || name.includes('sms')) return MessageSquare;
  if (name.includes('twilio-whatsapp') || name.includes('whatsapp')) return Smartphone;
  if (name.includes('resend') || name.includes('email')) return Mail;
  if (name.includes('mpesa') || name.includes('daraja')) return CircleDollarSign;
  return Globe;
}

// ── Status Badge Component ─────────────────────────────────────────────────

function StatusBadge({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'text-sm px-3 py-1' : size === 'md' ? 'text-xs px-2.5 py-0.5' : 'text-[10px] px-2 py-0.5';

  switch (status) {
    case 'healthy':
    case 'ok':
    case 'CLOSED':
    case 'PASS':
      return (
        <Badge className={`${sizeClass} bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 font-medium`}>
          <CheckCircle className="h-3 w-3 mr-1" />
          {status === 'healthy' ? 'Healthy' : status === 'CLOSED' ? 'Closed' : status === 'PASS' ? 'Pass' : 'OK'}
        </Badge>
      );
    case 'degraded':
    case 'warning':
    case 'HALF_OPEN':
    case 'WARN':
      return (
        <Badge className={`${sizeClass} bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-800 font-medium`}>
          <AlertTriangle className="h-3 w-3 mr-1" />
          {status === 'degraded' ? 'Degraded' : status === 'HALF_OPEN' ? 'Half-Open' : status === 'WARN' ? 'Warn' : 'Warning'}
        </Badge>
      );
    case 'unhealthy':
    case 'error':
    case 'OPEN':
    case 'FAIL':
    case 'DEAD':
      return (
        <Badge className={`${sizeClass} bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 border-red-200 dark:border-red-800 font-medium`}>
          <XCircle className="h-3 w-3 mr-1" />
          {status === 'unhealthy' ? 'Unhealthy' : status === 'OPEN' ? 'Open' : status === 'FAIL' ? 'Fail' : status}
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className={`${sizeClass} font-medium`}>
          <Minus className="h-3 w-3 mr-1" />
          {status}
        </Badge>
      );
  }
}

// ── Pulse Indicator ────────────────────────────────────────────────────────

function PulseIndicator({ status }: { status: string }) {
  const color =
    status === 'healthy' || status === 'ok' ? 'bg-emerald-500 shadow-emerald-500/50' :
    status === 'degraded' || status === 'warning' ? 'bg-amber-500 shadow-amber-500/50' :
    'bg-red-500 shadow-red-500/50';

  return (
    <span className={`relative flex h-3 w-3`}>
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
      <span className={`relative inline-flex rounded-full h-3 w-3 ${color} shadow-[0_0_6px]`} />
    </span>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

export default function SystemHealthTab() {
  const queryClient = useQueryClient();
  const [selectedBreaker, setSelectedBreaker] = useState<string | null>(null);
  const [dlqFilter, setDlqFilter] = useState<string>('all');
  const [confirmAction, setConfirmAction] = useState<{ type: string; target?: string } | null>(null);

  // ── Fetch system status ─────────────────────────────────────────────
  const {
    data: statusData,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = useQuery({
    queryKey: ['system-status'],
    queryFn: async () => {
      const res = await fetch('/api/health/system-status');
      if (!res.ok) throw new Error('Failed to fetch system status');
      const json = await res.json();
      return json.data as SystemStatus;
    },
    refetchInterval: 30000, // Auto-refresh every 30s
    staleTime: 10000,
  });

  // ── Fetch DLQ items ─────────────────────────────────────────────────
  const {
    data: dlqData,
    isLoading: dlqLoading,
  } = useQuery({
    queryKey: ['dlq-items', dlqFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '100' });
      if (dlqFilter !== 'all') params.set('status', dlqFilter);
      const res = await fetch(`/api/health/dlq?${params}`);
      if (!res.ok) throw new Error('Failed to fetch DLQ items');
      const json = await res.json();
      return json.data as { items: DLQItem[]; total: number; metrics: DLQMetrics & { byOperationType: Record<string, number>; byTargetService: Record<string, number>; oldestPendingAt: string | null } };
    },
    refetchInterval: 30000,
    staleTime: 10000,
  });

  // ── DLQ Admin action mutation ───────────────────────────────────────
  const dlqAction = useMutation({
    mutationFn: async ({ action, id, targetService }: { action: string; id?: string; targetService?: string }) => {
      const res = await fetch('/api/health/dlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id, targetService }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Action failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(data.data?.message || `Action completed (${data.data?.affected} affected)`);
      queryClient.invalidateQueries({ queryKey: ['dlq-items'] });
      queryClient.invalidateQueries({ queryKey: ['system-status'] });
      setConfirmAction(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setConfirmAction(null);
    },
  });

  // ── Circuit breaker admin action mutation ───────────────────────────
  const breakerAction = useMutation({
    mutationFn: async ({ action, name }: { action: string; name?: string }) => {
      const res = await fetch('/api/health/circuit-breaker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, name }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Action failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(`Circuit breaker action completed (${data.data?.affected} affected)`);
      queryClient.invalidateQueries({ queryKey: ['system-status'] });
      setConfirmAction(null);
    },
    onError: (err) => {
      toast.error(err.message);
      setConfirmAction(null);
    },
  });

  const status = statusData;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-4">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Activity className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">System Health</h2>
            <p className="text-sm text-muted-foreground">
              Real-time monitoring & operations dashboard
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <div className="flex items-center gap-2 mr-2">
              <PulseIndicator status={status.overallStatus} />
              <span className="text-sm font-medium">
                {status.overallStatus === 'healthy' ? 'All Systems Operational' :
                 status.overallStatus === 'degraded' ? 'Degraded Performance' :
                 'System Issues Detected'}
              </span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { refetchStatus(); queryClient.invalidateQueries({ queryKey: ['dlq-items'] }); }}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {statusLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardContent className="p-4">
                <div className="h-4 bg-muted rounded w-24 mb-3" />
                <div className="h-8 bg-muted rounded w-16 mb-2" />
                <div className="h-3 bg-muted rounded w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : status ? (
        <>
          {/* ── Quick Stats Row ───────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <QuickStatCard
              title="Overall"
              icon={Heart}
              value={status.overallStatus === 'healthy' ? 'Healthy' : status.overallStatus === 'degraded' ? 'Degraded' : 'Unhealthy'}
              status={status.overallStatus}
              detail={`Uptime: ${formatUptime(status.uptime)}`}
            />
            <QuickStatCard
              title="Database"
              icon={Database}
              value={`${status.database.responseTime}ms`}
              status={status.database.status}
              detail={status.database.detail || ''}
            />
            <QuickStatCard
              title="Circuits"
              icon={Zap}
              value={`${status.circuitBreakers.closed}/${status.circuitBreakers.total}`}
              status={status.circuitBreakers.status}
              detail={`${status.circuitBreakers.open} open, ${status.circuitBreakers.halfOpen} half-open`}
            />
            <QuickStatCard
              title="DLQ"
              icon={AlertOctagon}
              value={`${status.deadLetterQueue.dead} dead`}
              status={status.deadLetterQueue.status}
              detail={`${status.deadLetterQueue.pending} pending, ${status.deadLetterQueue.retrying} retrying`}
            />
            <QuickStatCard
              title="Security"
              icon={Shield}
              value={`${status.security.criticalEventsLastHour} events`}
              status={status.security.status}
              detail={`${status.security.lockedAccounts} locked accounts`}
            />
            <QuickStatCard
              title="Compliance"
              icon={Award}
              value={`${status.compliance.overallScore}%`}
              status={status.compliance.overallScore >= 90 ? 'ok' : status.compliance.overallScore >= 70 ? 'warning' : 'error'}
              detail={`ISO 27001: ${status.compliance.iso27001Score}%, ISO 9001: ${status.compliance.iso9001Score}%`}
            />
          </div>

          {/* ── Detailed Tabs ─────────────────────────────────────────── */}
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="grid grid-cols-2 md:grid-cols-5 lg:w-auto lg:inline-grid lg:grid-cols-5">
              <TabsTrigger value="overview" className="gap-1.5 text-xs">
                <BarChart3 className="h-3.5 w-3.5" />
                Overview
              </TabsTrigger>
              <TabsTrigger value="circuits" className="gap-1.5 text-xs">
                <Zap className="h-3.5 w-3.5" />
                Circuits
              </TabsTrigger>
              <TabsTrigger value="dlq" className="gap-1.5 text-xs">
                <AlertOctagon className="h-3.5 w-3.5" />
                Dead Letter
              </TabsTrigger>
              <TabsTrigger value="compliance" className="gap-1.5 text-xs">
                <Award className="h-3.5 w-3.5" />
                Compliance
              </TabsTrigger>
              <TabsTrigger value="audit" className="gap-1.5 text-xs">
                <FileText className="h-3.5 w-3.5" />
                Audit & Retention
              </TabsTrigger>
            </TabsList>

            {/* ── Overview Tab ───────────────────────────────────────── */}
            <TabsContent value="overview" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Database Detail */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Database className="h-4 w-4 text-blue-500" />
                        <CardTitle className="text-base">Database</CardTitle>
                      </div>
                      <StatusBadge status={status.database.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Response Time</span>
                      <span className="font-mono font-medium">{status.database.responseTime}ms</span>
                    </div>
                    <Progress
                      value={Math.min(100, (status.database.responseTime / 2000) * 100)}
                      className={`h-2 ${status.database.responseTime > 1000 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'}`}
                    />
                    {status.database.stats && (
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        <MiniStat label="Users" value={status.database.stats.users || 0} />
                        <MiniStat label="Products" value={status.database.stats.products || 0} />
                        <MiniStat label="Transactions" value={status.database.stats.transactions || 0} />
                        <MiniStat label="Active Sessions" value={status.database.stats.activeSessions || 0} />
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Security Detail */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-purple-500" />
                        <CardTitle className="text-base">Security</CardTitle>
                      </div>
                      <StatusBadge status={status.security.status} />
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Critical Events (1h)</span>
                      <span className="font-mono font-medium">{status.security.criticalEventsLastHour}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Locked Accounts</span>
                      <span className="font-mono font-medium">{status.security.lockedAccounts}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Financial Integrity</span>
                      <StatusBadge status={status.financial.status} size="sm" />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Financial Detail</span>
                      <span className="text-xs text-muted-foreground">{status.financial.detail}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Resilience Status */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Cpu className="h-4 w-4 text-teal-500" />
                      <CardTitle className="text-base">Resilience Pipeline</CardTitle>
                    </div>
                    <CardDescription className="text-xs">
                      Phases 1–7 system resilience chain
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {Object.entries(status.compliance.resilienceStatus).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground capitalize">
                            {key.replace(/([A-Z])/g, ' $1').trim()}
                          </span>
                          <StatusBadge status={value} size="sm" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Environment */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-slate-500" />
                      <CardTitle className="text-base">Environment</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Node Environment</span>
                      <Badge variant="outline" className="text-xs font-mono">{status.nodeEnv}</Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Uptime</span>
                      <span className="font-mono font-medium">{formatUptime(status.uptime)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Last Updated</span>
                      <span className="text-xs text-muted-foreground">{formatTimeAgo(status.timestamp)}</span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── Circuit Breakers Tab ────────────────────────────────── */}
            <TabsContent value="circuits" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <Card className="border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20">
                  <CardContent className="p-4 flex items-center gap-3">
                    <CheckCircle className="h-8 w-8 text-emerald-500" />
                    <div>
                      <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{status.circuitBreakers.closed}</p>
                      <p className="text-xs text-emerald-600 dark:text-emerald-500">Closed (Healthy)</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20">
                  <CardContent className="p-4 flex items-center gap-3">
                    <AlertTriangle className="h-8 w-8 text-amber-500" />
                    <div>
                      <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{status.circuitBreakers.halfOpen}</p>
                      <p className="text-xs text-amber-600 dark:text-amber-500">Half-Open (Probing)</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20">
                  <CardContent className="p-4 flex items-center gap-3">
                    <XCircle className="h-8 w-8 text-red-500" />
                    <div>
                      <p className="text-2xl font-bold text-red-700 dark:text-red-400">{status.circuitBreakers.open}</p>
                      <p className="text-xs text-red-600 dark:text-red-500">Open (Failing Fast)</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Circuit Breakers</CardTitle>
                    <ConfirmDialog
                      title="Reset All Circuit Breakers"
                      description="This will reset all circuit breakers to CLOSED state and clear their counters. This should only be done when you're certain the downstream services have recovered."
                      onConfirm={() => breakerAction.mutate({ action: 'resetAll' })}
                      loading={breakerAction.isPending}
                    >
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                        <RotateCcw className="h-3 w-3" />
                        Reset All
                      </Button>
                    </ConfirmDialog>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {status.circuitBreakers.breakers.map((breaker) => {
                      const Icon = getBreakerIcon(breaker.name);
                      return (
                        <div
                          key={breaker.name}
                          className={`rounded-lg border p-4 transition-colors cursor-pointer hover:bg-muted/50 ${
                            breaker.state === 'OPEN' ? 'border-red-200 dark:border-red-900/50 bg-red-50/30 dark:bg-red-950/10' :
                            breaker.state === 'HALF_OPEN' ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/30 dark:bg-amber-950/10' :
                            'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/10'
                          }`}
                          onClick={() => setSelectedBreaker(selectedBreaker === breaker.name ? null : breaker.name)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${
                                breaker.state === 'OPEN' ? 'bg-red-100 dark:bg-red-950/50' :
                                breaker.state === 'HALF_OPEN' ? 'bg-amber-100 dark:bg-amber-950/50' :
                                'bg-emerald-100 dark:bg-emerald-950/50'
                              }`}>
                                <Icon className={`h-4 w-4 ${
                                  breaker.state === 'OPEN' ? 'text-red-600 dark:text-red-400' :
                                  breaker.state === 'HALF_OPEN' ? 'text-amber-600 dark:text-amber-400' :
                                  'text-emerald-600 dark:text-emerald-400'
                                }`} />
                              </div>
                              <div>
                                <p className="font-medium text-sm">{breaker.name}</p>
                                <p className="text-xs text-muted-foreground">
                                  {breaker.totalCalls} calls · {breaker.totalTrips} trips
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right mr-2">
                                <p className="text-xs text-muted-foreground">Failure Rate</p>
                                <p className={`font-mono text-sm font-medium ${
                                  breaker.failureRate > 0.5 ? 'text-red-600' :
                                  breaker.failureRate > 0.2 ? 'text-amber-600' :
                                  'text-emerald-600'
                                }`}>
                                  {(breaker.failureRate * 100).toFixed(1)}%
                                </p>
                              </div>
                              <StatusBadge status={breaker.state} size="md" />
                              {selectedBreaker === breaker.name ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          </div>

                          {/* Expanded detail */}
                          {selectedBreaker === breaker.name && (
                            <div className="mt-4 pt-3 border-t space-y-3">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <MiniStat label="Total Calls" value={breaker.totalCalls} />
                                <MiniStat label="Successes" value={breaker.totalSuccesses} />
                                <MiniStat label="Failures" value={breaker.totalFailures} />
                                <MiniStat label="Window Failures" value={breaker.windowFailures} />
                              </div>
                              <div className="grid grid-cols-2 gap-3 text-sm">
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Last Success</span>
                                  <span className="font-mono text-xs">{formatTimeAgo(breaker.lastSuccessAt)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Last Failure</span>
                                  <span className="font-mono text-xs">{formatTimeAgo(breaker.lastFailureAt)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Window Size</span>
                                  <span className="font-mono text-xs">{breaker.windowSize}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                  <span className="text-muted-foreground">Half-Open In-Flight</span>
                                  <span className="font-mono text-xs">{breaker.halfOpenInFlight}</span>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 pt-2">
                                <ConfirmDialog
                                  title={`Reset "${breaker.name}"`}
                                  description="Reset this circuit breaker to CLOSED state and clear counters."
                                  onConfirm={() => breakerAction.mutate({ action: 'reset', name: breaker.name })}
                                  loading={breakerAction.isPending}
                                >
                                  <Button variant="outline" size="sm" className="gap-1 text-xs">
                                    <RotateCcw className="h-3 w-3" /> Reset
                                  </Button>
                                </ConfirmDialog>
                                <ConfirmDialog
                                  title={`Force Open "${breaker.name}"`}
                                  description="Force this circuit breaker OPEN. All calls will fail fast until manually reset. Use during planned maintenance."
                                  onConfirm={() => breakerAction.mutate({ action: 'forceOpen', name: breaker.name })}
                                  loading={breakerAction.isPending}
                                >
                                  <Button variant="outline" size="sm" className="gap-1 text-xs text-red-600 hover:text-red-700">
                                    <Unlock className="h-3 w-3" /> Force Open
                                  </Button>
                                </ConfirmDialog>
                                <ConfirmDialog
                                  title={`Force Close "${breaker.name}"`}
                                  description="Force this circuit breaker CLOSED and allow traffic through. Use only when you're certain the downstream service has recovered."
                                  onConfirm={() => breakerAction.mutate({ action: 'forceClose', name: breaker.name })}
                                  loading={breakerAction.isPending}
                                >
                                  <Button variant="outline" size="sm" className="gap-1 text-xs text-emerald-600 hover:text-emerald-700">
                                    <Lock className="h-3 w-3" /> Force Close
                                  </Button>
                                </ConfirmDialog>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Dead Letter Queue Tab ───────────────────────────────── */}
            <TabsContent value="dlq" className="space-y-4">
              {/* DLQ summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <DLQStatCard label="Pending" value={status.deadLetterQueue.pending} color="amber" icon={Clock} />
                <DLQStatCard label="Retrying" value={status.deadLetterQueue.retrying} color="blue" icon={RefreshCw} />
                <DLQStatCard label="Completed" value={status.deadLetterQueue.completed} color="emerald" icon={CheckCircle} />
                <DLQStatCard label="Dead" value={status.deadLetterQueue.dead} color="red" icon={XCircle} />
                <DLQStatCard label="Cancelled" value={status.deadLetterQueue.cancelled} color="slate" icon={Minus} />
              </div>

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">DLQ Items</CardTitle>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
                        {['all', 'PENDING', 'RETRYING', 'DEAD', 'COMPLETED', 'CANCELLED'].map((filter) => (
                          <Button
                            key={filter}
                            variant={dlqFilter === filter ? 'default' : 'ghost'}
                            size="sm"
                            className="text-[10px] h-7 px-2"
                            onClick={() => setDlqFilter(filter)}
                          >
                            {filter === 'all' ? 'All' : filter.charAt(0) + filter.slice(1).toLowerCase()}
                          </Button>
                        ))}
                      </div>
                      <ConfirmDialog
                        title="Retry All DLQ Items"
                        description="Re-queue all pending and dead items for retry. Only use when you're certain the downstream services have recovered."
                        onConfirm={() => dlqAction.mutate({ action: 'retryAll' })}
                        loading={dlqAction.isPending}
                      >
                        <Button variant="outline" size="sm" className="gap-1 text-xs">
                          <RotateCcw className="h-3 w-3" /> Retry All
                        </Button>
                      </ConfirmDialog>
                      <ConfirmDialog
                        title="Purge Old DLQ Items"
                        description="Remove completed, dead, and cancelled items older than 7 days."
                        onConfirm={() => dlqAction.mutate({ action: 'purge', targetService: undefined })}
                        loading={dlqAction.isPending}
                      >
                        <Button variant="outline" size="sm" className="gap-1 text-xs text-red-600">
                          <Trash2 className="h-3 w-3" /> Purge Old
                        </Button>
                      </ConfirmDialog>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {dlqLoading ? (
                    <div className="space-y-2">
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="h-14 bg-muted rounded animate-pulse" />
                      ))}
                    </div>
                  ) : dlqData && dlqData.items.length > 0 ? (
                    <ScrollArea className="max-h-96">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Type</TableHead>
                            <TableHead className="text-xs">Service</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-xs">Retries</TableHead>
                            <TableHead className="text-xs">Last Error</TableHead>
                            <TableHead className="text-xs">Created</TableHead>
                            <TableHead className="text-xs">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dlqData.items.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="text-xs font-mono">{item.operationType}</TableCell>
                              <TableCell className="text-xs">{item.targetService}</TableCell>
                              <TableCell><StatusBadge status={item.status} size="sm" /></TableCell>
                              <TableCell className="text-xs font-mono">{item.retryCount}/{item.maxRetries}</TableCell>
                              <TableCell className="text-xs max-w-[200px] truncate text-muted-foreground">
                                {item.lastError || '—'}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {formatTimeAgo(item.createdAt)}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  {(item.status === 'DEAD' || item.status === 'PENDING') && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 w-7 p-0"
                                            onClick={() => dlqAction.mutate({ action: 'retry', id: item.id })}
                                          >
                                            <RotateCcw className="h-3 w-3" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Retry item</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                  {item.status !== 'COMPLETED' && item.status !== 'CANCELLED' && (
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 w-7 p-0 text-red-500 hover:text-red-600"
                                            onClick={() => dlqAction.mutate({ action: 'cancel', id: item.id })}
                                          >
                                            <X className="h-3 w-3" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Cancel item</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <CheckCircle className="h-10 w-10 mx-auto mb-2 text-emerald-500" />
                      <p className="text-sm font-medium">No DLQ items found</p>
                      <p className="text-xs">All external service calls are processing normally</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Compliance Tab ──────────────────────────────────────── */}
            <TabsContent value="compliance" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Overall Score */}
                <Card className="md:col-span-1">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Overall Compliance</CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col items-center">
                    <div className="relative h-36 w-36">
                      <svg className="h-36 w-36 transform -rotate-90" viewBox="0 0 120 120">
                        <circle cx="60" cy="60" r="50" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/30" />
                        <circle
                          cx="60" cy="60" r="50" fill="none"
                          stroke={status.compliance.overallScore >= 90 ? '#10b981' : status.compliance.overallScore >= 70 ? '#f59e0b' : '#ef4444'}
                          strokeWidth="8"
                          strokeDasharray={`${(status.compliance.overallScore / 100) * 314} 314`}
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-bold">{status.compliance.overallScore}</span>
                        <span className="text-xs text-muted-foreground">/ 100</span>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground mt-2">Weighted: 60% ISO 27001 + 40% ISO 9001</p>
                  </CardContent>
                </Card>

                {/* ISO 27001 */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-emerald-500" />
                        <CardTitle className="text-base">ISO 27001</CardTitle>
                      </div>
                      <Badge variant="outline" className="text-xs">Information Security</Badge>
                    </div>
                    <CardDescription className="text-xs">Annex A controls implementation</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Score</span>
                      <span className="text-2xl font-bold text-emerald-600">{status.compliance.iso27001Score}%</span>
                    </div>
                    <Progress value={status.compliance.iso27001Score} className="h-2 [&>div]:bg-emerald-500" />
                    <div className="space-y-1.5">
                      {Object.entries(status.compliance.resilienceStatus).slice(0, 4).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <StatusBadge status={value} size="sm" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* ISO 9001 */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Award className="h-4 w-4 text-teal-500" />
                        <CardTitle className="text-base">ISO 9001</CardTitle>
                      </div>
                      <Badge variant="outline" className="text-xs">Quality Management</Badge>
                    </div>
                    <CardDescription className="text-xs">QMS clause implementation</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Score</span>
                      <span className="text-2xl font-bold text-teal-600">{status.compliance.iso9001Score}%</span>
                    </div>
                    <Progress value={status.compliance.iso9001Score} className="h-2 [&>div]:bg-teal-500" />
                    <div className="space-y-1.5">
                      {Object.entries(status.compliance.resilienceStatus).slice(4).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <StatusBadge status={value} size="sm" />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── Audit & Retention Tab ───────────────────────────────── */}
            <TabsContent value="audit" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Retention Policies */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-purple-500" />
                      <CardTitle className="text-base">Data Retention Policies</CardTitle>
                    </div>
                    <CardDescription className="text-xs">ISO 27001 A.12.4 compliance</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {status.retention && status.retention.length > 0 ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Policy</TableHead>
                            <TableHead className="text-xs">Retention</TableHead>
                            <TableHead className="text-xs">ISO Ref</TableHead>
                            <TableHead className="text-xs">Purgeable</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {status.retention.map((policy) => (
                            <TableRow key={policy.name}>
                              <TableCell className="text-xs font-medium">{policy.name}</TableCell>
                              <TableCell className="text-xs font-mono">{policy.retentionDays}d</TableCell>
                              <TableCell className="text-xs text-muted-foreground font-mono">{policy.isoRef}</TableCell>
                              <TableCell className="text-xs">
                                <Badge variant={policy.purgeableCount > 0 ? 'secondary' : 'outline'} className="text-[10px]">
                                  {policy.purgeableCount}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Retention data requires SUPER_ADMIN access
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Audit Trail */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-500" />
                      <CardTitle className="text-base">Audit Trail</CardTitle>
                    </div>
                    <CardDescription className="text-xs">Tamper-evident hash chain (SHA-256)</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {status.auditTrail && Object.keys(status.auditTrail).length > 0 ? (
                      <div className="space-y-3">
                        {Object.entries(status.auditTrail).map(([key, value]) => {
                          if (typeof value === 'object' && value !== null) return null;
                          return (
                            <div key={key} className="flex items-center justify-between text-sm">
                              <span className="text-muted-foreground capitalize">
                                {key.replace(/([A-Z])/g, ' $1').trim()}
                              </span>
                              <span className="font-mono text-xs font-medium">
                                {typeof value === 'number' ? value.toLocaleString() : String(value)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        Audit trail data requires SUPER_ADMIN access
                      </p>
                    )}
                  </CardContent>
                </Card>

                {/* Access Control */}
                {status.accessControl && Object.keys(status.accessControl).length > 0 && (
                  <Card className="md:col-span-2">
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-amber-500" />
                        <CardTitle className="text-base">Access Control Metrics</CardTitle>
                      </div>
                      <CardDescription className="text-xs">ISO 27001 A.9 compliance</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {Object.entries(status.accessControl).map(([key, value]) => {
                          if (typeof value === 'object' && value !== null) return null;
                          return (
                            <MiniStat
                              key={key}
                              label={key.replace(/([A-Z])/g, ' $1').trim()}
                              value={typeof value === 'number' ? value : String(value)}
                            />
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <Card>
          <CardContent className="p-8 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto mb-2 text-amber-500" />
            <p className="text-sm font-medium">Failed to load system status</p>
            <p className="text-xs text-muted-foreground">Check your connection and try again</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetchStatus()}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Confirmation Dialog ──────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(open) => { if (!open) setConfirmAction(null); }}
        title="Confirm Action"
        description="Are you sure you want to proceed?"
        onConfirm={() => {
          if (confirmAction) {
            if (confirmAction.type === 'breaker-reset-all') {
              breakerAction.mutate({ action: 'resetAll' });
            }
          }
        }}
        loading={breakerAction.isPending || dlqAction.isPending}
      />
    </div>
  );
}

// ── Sub-Components ────────────────────────────────────────────────────────

function QuickStatCard({ title, icon: Icon, value, status, detail }: {
  title: string;
  icon: React.ElementType;
  value: string;
  status: string;
  detail: string;
}) {
  return (
    <Card className={`transition-colors ${
      status === 'ok' || status === 'healthy' ? 'border-emerald-200/60 dark:border-emerald-900/40' :
      status === 'warning' || status === 'degraded' ? 'border-amber-200/60 dark:border-amber-900/40' :
      'border-red-200/60 dark:border-red-900/40'
    }`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className={`h-3.5 w-3.5 ${
            status === 'ok' || status === 'healthy' ? 'text-emerald-500' :
            status === 'warning' || status === 'degraded' ? 'text-amber-500' :
            'text-red-500'
          }`} />
          <span className="text-xs text-muted-foreground font-medium">{title}</span>
          <PulseIndicator status={status} />
        </div>
        <p className="text-lg font-bold tracking-tight">{value}</p>
        <p className="text-[10px] text-muted-foreground truncate">{detail}</p>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-mono font-semibold">{value}</p>
    </div>
  );
}

function DLQStatCard({ label, value, color, icon: Icon }: {
  label: string;
  value: number;
  color: string;
  icon: React.ElementType;
}) {
  const colorMap: Record<string, string> = {
    amber: 'border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400',
    blue: 'border-blue-200 dark:border-blue-900/50 bg-blue-50/50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400',
    emerald: 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400',
    red: 'border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20 text-red-700 dark:text-red-400',
    slate: 'border-slate-200 dark:border-slate-800/50 bg-slate-50/50 dark:bg-slate-950/20 text-slate-700 dark:text-slate-400',
  };

  const iconColorMap: Record<string, string> = {
    amber: 'text-amber-500',
    blue: 'text-blue-500',
    emerald: 'text-emerald-500',
    red: 'text-red-500',
    slate: 'text-slate-500',
  };

  return (
    <Card className={colorMap[color]}>
      <CardContent className="p-3 flex items-center gap-3">
        <Icon className={`h-5 w-5 ${iconColorMap[color]}`} />
        <div>
          <p className="text-xl font-bold">{value}</p>
          <p className="text-xs opacity-80">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function ConfirmDialog({
  children,
  title,
  description,
  onConfirm,
  loading,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  children: React.ReactNode;
  title: string;
  description: string;
  onConfirm: () => void;
  loading?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange || setInternalOpen;

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={onConfirm}
            disabled={loading}
            className="gap-1.5"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Loader2(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
