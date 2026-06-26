'use client';

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
  ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts';
import {
  Shield, ShieldOff, AlertTriangle, Users,
  Activity, Eye, Ban, RefreshCw, Filter, X,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { toast } from 'sonner';

// ── Types ────────────────────────────────────────────────────────────────────

interface SecurityDashboardData {
  securityScore: number;
  totalEvents24h: number;
  blockedAttempts: number;
  criticalEvents: number;
  activeSessions: number;
  eventsByType: { type: string; count: number }[];
  eventsBySeverity: { severity: string; count: number }[];
  topIPs: { ipAddress: string; eventCount: number }[];
  recentCritical: {
    id: string;
    eventType: string;
    severity: string;
    ipAddress: string | null;
    resource: string | null;
    action: string | null;
    details: string | null;
    createdAt: string;
    blocked: boolean;
  }[];
  timeline: { hour: string; count: number }[];
}

// ── Color mappings ───────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  ERROR: '#f97316',
  WARN: '#eab308',
  INFO: '#3b82f6',
  DEBUG: '#9ca3af',
};

const SEVERITY_BG: Record<string, string> = {
  CRITICAL: 'bg-red-500/10 text-red-500 border-red-500/20',
  ERROR: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
  WARN: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  INFO: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  DEBUG: 'bg-gray-400/10 text-gray-400 border-gray-400/20',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  RATE_LIMITED: 'Rate Limited',
  BRUTE_FORCE: 'Brute Force',
  CSRF_FAILED: 'CSRF Failed',
  INVALID_INPUT: 'Invalid Input',
  SUSPICIOUS_ACTIVITY: 'Suspicious Activity',
  ACCOUNT_LOCKED: 'Account Locked',
  SESSION_HIJACK_ATTEMPT: 'Session Hijack',
  UNAUTHORIZED_ACCESS: 'Unauthorized Access',
};

const EVENT_TYPE_COLORS: Record<string, string> = {
  RATE_LIMITED: '#f97316',
  BRUTE_FORCE: '#ef4444',
  CSRF_FAILED: '#eab308',
  INVALID_INPUT: '#9ca3af',
  SUSPICIOUS_ACTIVITY: '#8b5cf6',
  ACCOUNT_LOCKED: '#dc2626',
  SESSION_HIJACK_ATTEMPT: '#b91c1c',
  UNAUTHORIZED_ACCESS: '#c2410c',
};

// ── API helpers ──────────────────────────────────────────────────────────────

async function fetchDashboard(): Promise<SecurityDashboardData> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch('/api/security/dashboard', { headers, credentials: 'same-origin' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch dashboard (${res.status})`);
  }
  const json = await res.json();
  const data = json.data;

  // Map nested API response to flat structure expected by the component
  return {
    securityScore: data?.overview?.securityScore ?? 0,
    totalEvents24h: data?.overview?.eventsLast24h ?? 0,
    blockedAttempts: data?.overview?.blockedAttempts24h ?? 0,
    criticalEvents: data?.overview?.criticalEvents24h ?? 0,
    activeSessions: data?.overview?.activeSessions ?? 0,
    eventsByType: data?.breakdown?.byType ?? [],
    eventsBySeverity: data?.breakdown?.bySeverity ?? [],
    topIPs: data?.topTargets?.ips ?? [],
    recentCritical: data?.recentCritical ?? [],
    timeline: data?.timeline ?? [],
  };
}

async function fetchEvents(params: Record<string, string>): Promise<unknown> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/security/events?${qs}`, { headers, credentials: 'same-origin' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to fetch events (${res.status})`);
  }
  return res.json();
}

// ── Security Score Gauge ─────────────────────────────────────────────────────

function SecurityScoreGauge({ score }: { score: number }) {
  const radius = 70;
  const strokeWidth = 12;
  const normalizedRadius = radius - strokeWidth / 2;
  const circumference = normalizedRadius * 2 * Math.PI;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  const color = score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
  const colorClass = score >= 80 ? 'text-green-500' : score >= 50 ? 'text-yellow-500' : 'text-red-500';
  const label = score >= 80 ? 'Good' : score >= 50 ? 'Fair' : 'Poor';

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <svg
        height={radius * 2}
        width={radius * 2}
        className="transform -rotate-90"
      >
        {/* Background circle */}
        <circle
          stroke="currentColor"
          className="text-muted-foreground/20"
          fill="transparent"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          stroke={color}
          fill="transparent"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s ease-in-out, stroke 0.3s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center">
        <span className={`text-4xl font-bold ${colorClass}`}>{score}</span>
        <span className={`text-xs font-medium ${colorClass}`}>{label}</span>
      </div>
    </div>
  );
}

// ── Overview Card ────────────────────────────────────────────────────────────

function OverviewCard({
  icon: Icon,
  label,
  value,
  colorClass,
  bgColorClass,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  colorClass: string;
  bgColorClass: string;
}) {
  return (
    <Card className="relative overflow-hidden">
      <CardContent className="p-4 flex items-center gap-4">
        <div className={`flex items-center justify-center w-12 h-12 rounded-xl ${bgColorClass}`}>
          <Icon className={`h-6 w-6 ${colorClass}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Severity Badge ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Badge variant="outline" className={`text-xs font-medium ${SEVERITY_BG[severity] || 'bg-gray-100 text-gray-500'}`}>
      {severity}
    </Badge>
  );
}

// ── Main Security Tab ────────────────────────────────────────────────────────

export default function SecurityTab() {
  // Filter state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [filterEventType, setFilterEventType] = useState('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  // Dashboard data
  const {
    data: dashboard,
    isLoading: dashboardLoading,
    refetch: refetchDashboard,
    isRefetching: dashboardRefetching,
  } = useQuery({
    queryKey: ['security-dashboard'],
    queryFn: fetchDashboard,
    refetchInterval: 30000,
  });

  // Events data
  const eventsParams = useMemo(() => {
    const params: Record<string, string> = { limit: '50' };
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (filterEventType && filterEventType !== 'all') params.eventType = filterEventType;
    if (filterSeverity && filterSeverity !== 'all') params.severity = filterSeverity;
    return params;
  }, [dateFrom, dateTo, filterEventType, filterSeverity]);

  const {
    data: _eventsResponse,
    isLoading: _eventsLoading,
  } = useQuery({
    queryKey: ['security-events', eventsParams],
    queryFn: () => fetchEvents(eventsParams),
    refetchInterval: 30000,
  });

  const handleRefresh = () => {
    refetchDashboard();
    toast.success('Security data refreshed');
  };

  const handleBlockIP = async (ip: string) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('mbt_token') : null;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
      // Get CSRF token from cookie
      const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
      if (csrfMatch) headers['X-CSRF-Token'] = csrfMatch[1];

      const res = await fetch('/api/security/block-ip', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify({ ipAddress: ip, duration: 60, reason: 'Blocked from security dashboard' }),
      });
      if (res.ok) {
        toast.success(`IP ${ip} has been blocked`, {
          description: 'The IP address has been blocked for 1 hour.',
        });
        refetchDashboard();
      } else {
        toast.error('Failed to block IP');
      }
    } catch {
      toast.error('Failed to block IP');
    }
  };

  // Timeline data formatted for chart
  const timelineData = useMemo(() => {
    if (!dashboard?.timeline) return [];
    return dashboard.timeline.map(t => ({
      ...t,
      hourLabel: t.hour.split(' ')[1]?.slice(0, 5) || t.hour,
    }));
  }, [dashboard]);

  // Events by type for chart
  const eventsByTypeData = useMemo(() => {
    if (!dashboard?.eventsByType) return [];
    return dashboard.eventsByType.map(e => ({
      name: EVENT_TYPE_LABELS[e.type] || e.type,
      count: e.count,
      fill: EVENT_TYPE_COLORS[e.type] || '#6b7280',
    }));
  }, [dashboard]);

  // Events by severity for donut
  const eventsBySeverityData = useMemo(() => {
    if (!dashboard?.eventsBySeverity) return [];
    return dashboard.eventsBySeverity.map(e => ({
      name: e.severity,
      value: e.count,
      fill: SEVERITY_COLORS[e.severity] || '#6b7280',
    }));
  }, [dashboard]);

  // Loading skeleton
  if (dashboardLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10">
            <Shield className="h-5 w-5 text-emerald-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Security Dashboard</h1>
            <p className="text-xs text-muted-foreground">Monitor security events and threats</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={showFilters ? 'bg-primary/5 border-primary/30' : ''}
          >
            <Filter className="h-4 w-4 mr-1" />
            Filters
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={dashboardRefetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${dashboardRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter Controls */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date From</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date To</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Event Type</Label>
                <Select value={filterEventType} onValueChange={setFilterEventType}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="RATE_LIMITED">Rate Limited</SelectItem>
                    <SelectItem value="BRUTE_FORCE">Brute Force</SelectItem>
                    <SelectItem value="CSRF_FAILED">CSRF Failed</SelectItem>
                    <SelectItem value="INVALID_INPUT">Invalid Input</SelectItem>
                    <SelectItem value="SUSPICIOUS_ACTIVITY">Suspicious Activity</SelectItem>
                    <SelectItem value="ACCOUNT_LOCKED">Account Locked</SelectItem>
                    <SelectItem value="SESSION_HIJACK_ATTEMPT">Session Hijack</SelectItem>
                    <SelectItem value="UNAUTHORIZED_ACCESS">Unauthorized Access</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Severity</Label>
                <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All Severities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Severities</SelectItem>
                    <SelectItem value="CRITICAL">Critical</SelectItem>
                    <SelectItem value="ERROR">Error</SelectItem>
                    <SelectItem value="WARN">Warning</SelectItem>
                    <SelectItem value="INFO">Info</SelectItem>
                    <SelectItem value="DEBUG">Debug</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(dateFrom || dateTo || filterEventType !== 'all' || filterSeverity !== 'all') && (
              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDateFrom('');
                    setDateTo('');
                    setFilterEventType('all');
                    setFilterSeverity('all');
                  }}
                  className="text-xs h-7"
                >
                  <X className="h-3 w-3 mr-1" />
                  Clear Filters
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Security Score + Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* Security Score Card */}
        <Card className="md:col-span-1">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground">Security Score</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center pb-4 relative">
            <SecurityScoreGauge score={dashboard?.securityScore ?? 0} />
          </CardContent>
        </Card>

        {/* Overview Cards */}
        <div className="md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <OverviewCard
            icon={Shield}
            label="Events (24h)"
            value={dashboard?.totalEvents24h ?? 0}
            colorClass="text-blue-500"
            bgColorClass="bg-blue-500/10"
          />
          <OverviewCard
            icon={ShieldOff}
            label="Blocked Attempts"
            value={dashboard?.blockedAttempts ?? 0}
            colorClass="text-orange-500"
            bgColorClass="bg-orange-500/10"
          />
          <OverviewCard
            icon={AlertTriangle}
            label="Critical Events"
            value={dashboard?.criticalEvents ?? 0}
            colorClass={dashboard?.criticalEvents ? 'text-red-500' : 'text-green-500'}
            bgColorClass={dashboard?.criticalEvents ? 'bg-red-500/10' : 'bg-green-500/10'}
          />
          <OverviewCard
            icon={Users}
            label="Active Sessions"
            value={dashboard?.activeSessions ?? 0}
            colorClass="text-emerald-500"
            bgColorClass="bg-emerald-500/10"
          />
        </div>
      </div>

      {/* Charts Row: Events by Type + Events by Severity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Events by Type - Horizontal Bar Chart */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Events by Type</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            {eventsByTypeData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                <div className="flex flex-col items-center gap-2">
                  <Shield className="h-8 w-8 opacity-30" />
                  <span>No events recorded</span>
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, eventsByTypeData.length * 40)}>
                <BarChart data={eventsByTypeData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={120}
                    tick={{ fontSize: 11 }}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} barSize={20}>
                    {eventsByTypeData.map((entry, index) => (
                      <Cell key={`type-cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Events by Severity - Donut Chart */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Events by Severity</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-4">
            {eventsBySeverityData.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
                <div className="flex flex-col items-center gap-2">
                  <Activity className="h-8 w-8 opacity-30" />
                  <span>No severity data</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="60%" height={200}>
                  <PieChart>
                    <Pie
                      data={eventsBySeverityData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={85}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {eventsBySeverityData.map((entry, index) => (
                        <Cell key={`sev-cell-${index}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {eventsBySeverityData.map((item) => (
                    <div key={item.name} className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: item.fill }}
                      />
                      <span className="text-xs text-muted-foreground flex-1">{item.name}</span>
                      <span className="text-xs font-semibold">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Events Timeline */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-medium">Events Timeline (Last 24h)</CardTitle>
        </CardHeader>
        <CardContent className="px-2 pb-4">
          {timelineData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              <div className="flex flex-col items-center gap-2">
                <Activity className="h-8 w-8 opacity-30" />
                <span>No timeline data</span>
              </div>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={timelineData} margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
                <defs>
                  <linearGradient id="colorEvents" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="hourLabel"
                  tick={{ fontSize: 10 }}
                  interval={2}
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#colorEvents)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Bottom row: Top Targeted IPs + Recent Critical Events */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Top Targeted IPs */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" />
              Top Targeted IPs
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {!dashboard?.topIPs?.length ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                No suspicious IPs detected
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto custom-scrollbar">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs h-9">IP Address</TableHead>
                      <TableHead className="text-xs h-9 text-right">Events</TableHead>
                      <TableHead className="text-xs h-9 text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.topIPs.map((ip) => (
                      <TableRow key={ip.ipAddress}>
                        <TableCell className="text-xs font-mono py-2">{ip.ipAddress}</TableCell>
                        <TableCell className="text-xs text-right py-2">
                          <Badge variant="secondary" className="text-xs">
                            {ip.eventCount}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-right py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10"
                            onClick={() => handleBlockIP(ip.ipAddress)}
                          >
                            <Ban className="h-3 w-3 mr-1" />
                            Block
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Critical Events */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Recent Critical Events
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {!dashboard?.recentCritical?.length ? (
              <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
                <div className="flex flex-col items-center gap-2">
                  <Shield className="h-6 w-6 text-green-500 opacity-50" />
                  <span>No critical events in the last 24h</span>
                </div>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto custom-scrollbar">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs h-9">Time</TableHead>
                      <TableHead className="text-xs h-9">Type</TableHead>
                      <TableHead className="text-xs h-9">Severity</TableHead>
                      <TableHead className="text-xs h-9">IP</TableHead>
                      <TableHead className="text-xs h-9">Resource</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboard.recentCritical.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell className="text-xs py-2 whitespace-nowrap">
                          {new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </TableCell>
                        <TableCell className="text-xs py-2">
                          {EVENT_TYPE_LABELS[event.eventType] || event.eventType}
                        </TableCell>
                        <TableCell className="py-2">
                          <SeverityBadge severity={event.severity} />
                        </TableCell>
                        <TableCell className="text-xs font-mono py-2">
                          {event.ipAddress || '—'}
                        </TableCell>
                        <TableCell className="text-xs py-2 max-w-[120px] truncate">
                          {event.resource || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
