// Shared formatting helpers for the HR self-service UI (v2.24.0).
//
// These used to live in self-service-ui.tsx, which carries the 'use client'
// directive - and a server component may RENDER client components but may
// NOT CALL client-module functions (the v2.24.0 SSR home page hit exactly
// that: "Attempted to call formatKes() from the server"). The formatters are
// pure, so they live here with NO directive - importable from both server
// and client graphs. self-service-ui.tsx re-exports them for the existing
// client callers, so client-side imports are unchanged.

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
