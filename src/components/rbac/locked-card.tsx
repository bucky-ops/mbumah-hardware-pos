'use client';

/**
 * LockedCard — v2.12.5 (PR B phase 2 — RBAC, Task REL-ROADMAP-B2)
 *
 * The premium "you can't open this" card used on the cashier limited dashboard
 * and anywhere a feature is visible but not permitted. Matches the dashboard
 * design language (rounded-2xl, border-slate-200, white, shadow-sm).
 *
 * Renders:
 *   • a Lock glyph in a muted circle
 *   • "Requires {role label}" (from PERMISSION_REQUIRED_ROLE_LABEL)
 *   • a one-line explanation (from PERMISSION_DENIED_MESSAGES)
 *   • a "Request Access" button → POST /api/access-requests
 *     (writes a SecurityEvent + notifies org SUPER_ADMINs / Branch Managers)
 *
 * The button debounces via a `sending` state and stays disabled after a
 * successful send (per-session, persisted in sessionStorage so re-mounts
 * don't re-notify).
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';

import {
  PERMISSION_DENIED_MESSAGES,
  PERMISSION_REQUIRED_ROLE_LABEL,
  type FeaturePermissionKey,
} from '@/lib/permissions';

import { Button } from '@/components/ui/button';

const REQUESTED_KEY_PREFIX = 'mbt_access_requested:';

function hasRequestedThisSession(permission: FeaturePermissionKey): boolean {
  try {
    return typeof window !== 'undefined'
      && window.sessionStorage.getItem(`${REQUESTED_KEY_PREFIX}${permission}`) === '1';
  } catch {
    return false;
  }
}

function markRequestedThisSession(permission: FeaturePermissionKey): void {
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(`${REQUESTED_KEY_PREFIX}${permission}`, '1');
    }
  } catch {
    /* storage unavailable — the in-memory state still debounces this mount */
  }
}

export interface LockedCardProps {
  /** Dotted FEATURE_PERMISSIONS key, e.g. 'dashboard.view.revenue'. */
  permission: FeaturePermissionKey;
  /** Optional short title (defaults to the locked feature's name). */
  title?: string;
  /** Optional custom explanation line (defaults to PERMISSION_DENIED_MESSAGES). */
  description?: string;
  className?: string;
}

export function LockedCard({ permission, title, description, className }: LockedCardProps) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // Respect a prior send in this browser session (e.g. tab switch remount).
  useEffect(() => {
    if (hasRequestedThisSession(permission)) setSent(true);
  }, [permission]);

  const roleLabel = PERMISSION_REQUIRED_ROLE_LABEL[permission] ?? 'a higher role';
  const explanation =
    description ?? PERMISSION_DENIED_MESSAGES[permission] ?? 'This section is locked for your role.';

  const handleRequestAccess = async () => {
    if (sending || sent) return; // debounce — one in-flight request at a time
    setSending(true);
    try {
      const res = await fetch('/api/access-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ permission }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `Request failed (HTTP ${res.status})`);
      }
      markRequestedThisSession(permission);
      setSent(true);
      toast.success('Request sent to your Branch Manager');
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : 'Could not send the access request. Please try again.'
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm sm:p-6 ${className ?? ''}`}
      data-testid={`locked-card-${permission}`}
      aria-label={`${title ?? 'Locked section'} — ${explanation}`}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Lock className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold text-slate-900">
        {title ?? `Requires ${roleLabel}`}
      </p>
      {title ? (
        <p className="-mt-1 text-xs font-medium text-slate-500">Requires {roleLabel}</p>
      ) : null}
      <p className="max-w-xs text-xs leading-relaxed text-slate-500">{explanation}</p>
      <Button
        variant="outline"
        size="sm"
        className="mt-1 gap-1.5 border-slate-200 text-slate-600 hover:bg-slate-50"
        disabled={sending || sent}
        onClick={handleRequestAccess}
        aria-disabled={sending || sent}
        title={sent ? 'Already requested this session' : 'Notifies your Branch Manager and the store owner'}
      >
        <Lock className="h-3 w-3" aria-hidden="true" />
        {sent ? 'Request sent' : sending ? 'Sending…' : 'Request Access'}
      </Button>
    </div>
  );
}
