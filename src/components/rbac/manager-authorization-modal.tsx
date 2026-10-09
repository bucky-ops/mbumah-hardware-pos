'use client';

/**
 * ManagerAuthorizationModal - v2.12.5 (PR B phase 2 - RBAC, Task REL-ROADMAP-B2)
 *
 * Step-up authorization at the counter. When the POS (or any surface) hits a
 * permission that needs manager approval - 5-10% discount band, high-risk
 * credit sale, 90+ day debt override - this dialog collects the approving
 * manager's email + password, verifies them against
 * POST /api/auth/manager-authorize, and hands the verified credentials back to
 * the caller so it can resubmit the request with a `managerOverride` object
 * (verified server-side by src/lib/manager-auth.ts - the credentials are
 * re-checked on the API call itself; the modal only pre-screens them so the
 * cashier gets immediate feedback).
 *
 * Error surfaces:
 *   • 429 BRUTE_FORCE_PIN → inline red alert with the lockout message and the
 *     retry-after window (3 failed attempts / 5 min per email+IP).
 *   • 403 INVALID_CREDENTIALS / INSUFFICIENT_ROLE → inline red alert with the
 *     server's generic copy (never reveals which check failed).
 *
 * `confirmOnly` mode: the signed-in user IS manager-level (e.g. a Branch
 * Manager hitting DEBT_BLOCKED_OVERDUE). No credentials are collected - the
 * dialog records intent + reason and the caller resubmits with
 * `managerOverride: true` (which the backend requires for that path).
 *
 * SECURITY: the manager password is wiped from state whenever the dialog
 * closes and after a successful submit - it never lingers.
 */

import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface VerifiedManager {
  id: string;
  name: string;
  role: string;
}

/** The credential object attached to the retried request as `managerOverride`. */
export interface ManagerOverrideInput {
  approverEmail: string;
  approverPassword: string;
  reason?: string;
}

export interface ManagerAuthorizationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Business context shown under the title, e.g. "Discount 7.5% exceeds the cashier limit of 5%". */
  context: string;
  /** Prefill for the optional reason field (e.g. the server's 403 message). */
  reason?: string;
  /** Manager-level session path - collect no credentials, just confirm + reason. */
  confirmOnly?: boolean;
  onSuccess: (
    manager: VerifiedManager | null,
    override: ManagerOverrideInput
  ) => void;
}

interface InlineAlert {
  kind: 'locked' | 'error';
  message: string;
}

export function ManagerAuthorizationModal({
  open,
  onOpenChange,
  context,
  reason,
  confirmOnly = false,
  onSuccess,
}: ManagerAuthorizationModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reasonText, setReasonText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [alert, setAlert] = useState<InlineAlert | null>(null);

  // Fresh state on every open: prefilled reason, no stale credentials.
  useEffect(() => {
    if (open) {
      setReasonText(reason ?? '');
      setAlert(null);
      setPassword('');
    }
  }, [open, reason]);

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      // SECURITY: never keep a manager password in state longer than needed.
      setPassword('');
      setEmail('');
      setAlert(null);
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (confirmOnly) {
      onSuccess(null, { approverEmail: '', approverPassword: '', reason: reasonText || undefined });
      handleClose(false);
      return;
    }

    if (!email.trim() || !password) {
      setAlert({ kind: 'error', message: 'Enter the approving manager\u2019s email and password.' });
      return;
    }

    setSubmitting(true);
    setAlert(null);
    try {
      const res = await fetch('/api/auth/manager-authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: email.trim(),
          password,
          reason: reasonText || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (res.status === 429 && json?.code === 'BRUTE_FORCE_PIN') {
        const minutes = json.retryAfterMinutes ? ` Try again in ${json.retryAfterMinutes} minute${json.retryAfterMinutes === 1 ? '' : 's'}.` : '';
        setAlert({ kind: 'locked', message: `${json.message ?? 'Too many failed attempts.'}${minutes}` });
        return;
      }
      if (res.status === 403) {
        setAlert({
          kind: 'error',
          message: json?.message || 'Authorization failed. Check the manager credentials and role.',
        });
        return;
      }
      if (!res.ok || !json?.success) {
        setAlert({
          kind: 'error',
          message: json?.error || json?.message || `Authorization failed (HTTP ${res.status}).`,
        });
        return;
      }

      // Success - hand the verified credentials to the caller for the retry.
      onSuccess(
        { id: json.manager.id, name: json.manager.name, role: json.manager.role },
        { approverEmail: email.trim(), approverPassword: password, reason: reasonText || undefined }
      );
      setPassword('');
      setEmail('');
      handleClose(false);
    } catch {
      setAlert({ kind: 'error', message: 'Could not reach the authorization service. Check your connection and try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" aria-describedby="manager-auth-context">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </span>
            Manager Authorization Required
          </DialogTitle>
          <DialogDescription id="manager-auth-context" className="text-sm leading-relaxed">
            {context}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          {alert ? (
            <Alert
              variant="destructive"
              role="alert"
              className={alert.kind === 'locked' ? 'border-red-300 bg-red-50 text-red-800' : undefined}
            >
              <ShieldAlert className="h-4 w-4" aria-hidden="true" />
              <AlertDescription className="text-xs font-medium leading-relaxed">
                {alert.message}
              </AlertDescription>
            </Alert>
          ) : null}

          {confirmOnly ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-800">
              You are signed in as a manager. Approving will resubmit this sale with your
              authorization — the action is recorded in the audit trail.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="manager-auth-email">Manager email</Label>
                <Input
                  id="manager-auth-email"
                  type="email"
                  autoComplete="off"
                  placeholder="manager@mbumahhardware.co.ke"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manager-auth-password">Manager password</Label>
                <Input
                  id="manager-auth-password"
                  type="password"
                  autoComplete="off"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="manager-auth-reason">Reason (optional)</Label>
            <Input
              id="manager-auth-reason"
              placeholder="Why is this override needed?"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              maxLength={500}
              disabled={submitting}
            />
          </div>

          <DialogFooter className="gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="min-w-[150px] gap-1.5">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Verifying…
                </>
              ) : confirmOnly ? (
                'Approve & Retry'
              ) : (
                'Authorize'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
