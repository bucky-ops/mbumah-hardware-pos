'use client';

// MBUMAH HARDWARE POS - shared self-service UI primitives (v2.19.0)
// Fetch helper + status badge + progress meter used by /employees/me pages.

import type { ReactNode } from 'react';

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string; code?: string };
  if (!res.ok || !json.success) {
    const err = new Error(json.error || `Request failed (${res.status})`) as Error & { code?: string; status?: number };
    err.code = json.code;
    err.status = res.status;
    throw err;
  }
  return json.data as T;
}

export async function apiSend<T>(url: string, method: 'POST' | 'PATCH', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean; data?: T; error?: string; code?: string };
  if (!res.ok || !json.success) {
    const err = new Error(json.error || `Request failed (${res.status})`) as Error & { code?: string; status?: number };
    err.code = json.code;
    err.status = res.status;
    throw err;
  }
  return json.data as T;
}

const TONE_CLASSES: Record<string, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  good: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900',
  info: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-900',
  warn: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900',
  bad: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900',
  accent: 'bg-violet-50 text-violet-800 border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-900',
};

export type Tone = keyof typeof TONE_CLASSES;

export function toneForStatus(status: string): Tone {
  switch (status) {
    case 'APPROVED':
    case 'ACHIEVED':
    case 'POSTED':
    case 'CALIBRATED':
    case 'VERIFIED':
    case 'RESOLVED':
    case 'RETURNED':
    case 'COMPLETED':
    case 'PAID':
      return 'good';
    case 'PENDING':
    case 'PENDING_APPROVAL':
    case 'SUBMITTED':
    case 'PROCESSING':
    case 'ASSIGNED':
      return 'warn';
    case 'ACKNOWLEDGED':
    case 'ACTIVE':
    case 'TAKEN':
    case 'HALF_DAY':
    case 'REMOTE':
      return 'info';
    case 'REJECTED':
    case 'LOST':
    case 'DAMAGED':
    case 'ABSENT':
    case 'MISSED':
      return 'bad';
    case 'CLOSED':
    case 'DISMISSED':
    case 'CANCELLED':
      return 'neutral';
    case 'EXPIRED':
      return 'accent';
    default:
      return 'neutral';
  }
}

export function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[toneForStatus(status)]} ${className}`}
    >
      {status.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}

export function ProgressMeter({
  pct,
  tone = 'info',
  className = '',
}: {
  pct: number;
  tone?: Tone;
  className?: string;
}) {
  const fill: Record<Tone, string> = {
    neutral: 'bg-slate-400 dark:bg-slate-500',
    good: 'bg-emerald-500',
    info: 'bg-sky-500',
    warn: 'bg-amber-500',
    bad: 'bg-rose-500',
    accent: 'bg-violet-500',
  };
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 ${className}`}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${fill[tone]}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-center">
      <div className="text-muted-foreground/60">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-xs text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
    >
      {message}
    </div>
  );
}

export function formatKes(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return 'KSh 0';
  return `KSh ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}
