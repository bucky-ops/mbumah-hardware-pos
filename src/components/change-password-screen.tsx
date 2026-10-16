'use client';

// v2.44.0: FIRST SIGN-IN PASSWORD ROTATION — the forced "Set a new password"
// screen.
//
// Rendered INSTEAD of the workspace (POS shell, branch workspace gateway,
// employee portal) while the signed-in user still carries
// `mustChangePassword = true` — i.e. they were just provisioned with a
// temporary password (v2.41.0 create-&-link / admin user form) or an admin
// hit "Force password reset". The server enforces the same rule API-wide
// (403 PASSWORD_CHANGE_REQUIRED on every non-exempt route), so this screen
// is the ONLY door out.
//
// On success POST /api/profile/password clears the flag server-side; we
// re-fetch /api/auth/me so the cached user flips to mustChangePassword:false
// and the gate renders the real app without a reload.

import { useMemo, useRef, useState } from 'react';
import { Check, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, LogOut, ShieldCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/lib/stores';
import { profileApi } from '@/lib/api';
import { evaluatePasswordStrength } from '@/lib/password-strength';

const SEGMENT_STYLES = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-sky-500',
  'bg-emerald-500',
] as const;

const SEGMENT_LABEL_STYLES = [
  'text-rose-600 dark:text-rose-400',
  'text-amber-600 dark:text-amber-400',
  'text-sky-600 dark:text-sky-400',
  'text-emerald-600 dark:text-emerald-400',
] as const;

export function ChangePasswordScreen() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const fetchUser = useAuthStore((s) => s.fetchUser);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [rotating, setRotating] = useState(false);
  const submittedRef = useRef(false);

  const strength = useMemo(() => evaluatePasswordStrength(newPassword), [newPassword]);
  const confirmMatches = confirmPassword.length > 0 && confirmPassword === newPassword;
  const confirmMismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit =
    !submitting &&
    !succeeded &&
    currentPassword.length > 0 &&
    strength.score === 4 &&
    confirmMatches;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await profileApi.changePassword(currentPassword, newPassword);
      if (!res.success) {
        setErrorMessage(res.error || 'Could not update the password. Try again.');
        submittedRef.current = false;
        setSubmitting(false);
        return;
      }
      // Success: the flag is cleared server-side. Refresh the cached user so
      // every gate (page.tsx, workspace-gateway, portal) renders the app.
      setSucceeded(true);
      setSubmitting(false);
      setRotating(true);
      await fetchUser();
      // Brief success beat so the rotation visibly completes, then the gate
      // naturally swaps this screen for the workspace.
      setTimeout(() => setRotating(false), 900);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not update the password. Try again.');
      submittedRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await logout();
    } catch {
      // logout clears local state even if the API call fails.
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Same animated gradient family as the login screen, shifted violet to
          signal "special mode" — this is not a login, it is a checkpoint. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-[oklch(0.22_0.07_290)] via-[oklch(0.295_0.1_290)] to-[oklch(0.22_0.06_290)]"
      />
      <div
        aria-hidden
        className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-violet-500/10 blur-3xl"
      />
      <div
        aria-hidden
        className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-fuchsia-500/10 blur-3xl"
      />

      <div className="relative w-full max-w-md">
        <div className="rounded-2xl border border-white/10 bg-card/95 p-6 sm:p-8 shadow-2xl backdrop-blur">
          {/* Header */}
          <div className="flex flex-col items-center text-center gap-3">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/25">
              <LockKeyhole className="h-7 w-7 text-white" aria-hidden />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              {succeeded ? 'Password updated' : 'Set your new password'}
            </h1>
            <p className="text-sm text-muted-foreground max-w-xs">
              {succeeded ? (
                'Your account is secured. Taking you to your workspace…'
              ) : (
                <>
                  You are signed in with a{' '}
                  <span className="font-medium text-violet-600 dark:text-violet-400">temporary password</span>.
                  Choose a new one to continue
                  {user?.email ? (
                    <> — signed in as <span className="font-medium text-foreground">{user.email}</span></>
                  ) : null}
                  .
                </>
              )}
            </p>
          </div>

          {succeeded ? (
            <div className="mt-6 flex flex-col items-center gap-3" role="status">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/15">
                <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className={`h-3.5 w-3.5 animate-spin ${rotating ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
                {rotating ? 'Opening your workspace…' : 'Ready'}
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" aria-label="Set a new password">
              {errorMessage ? (
                <div
                  role="alert"
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
                >
                  {errorMessage}
                </div>
              ) : null}

              {/* Current (temporary) password */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cp-current">Current (temporary) password</Label>
                <div className="relative">
                  <Input
                    id="cp-current"
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    aria-label={showCurrent ? 'Hide current password' : 'Show current password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>
              </div>

              {/* New password + live strength meter */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cp-new">New password</Label>
                <div className="relative">
                  <Input
                    id="cp-new"
                    type={showNew ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    className="pr-10"
                    aria-describedby="cp-strength"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    aria-label={showNew ? 'Hide new password' : 'Show new password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showNew ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                </div>

                {newPassword.length > 0 ? (
                  <div id="cp-strength" className="mt-1 flex flex-col gap-1.5" aria-live="polite">
                    <div className="flex items-center gap-1.5" aria-hidden>
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                            i < strength.score ? SEGMENT_STYLES[strength.score - 1] : 'bg-muted'
                          }`}
                        />
                      ))}
                      <span
                        className={`ml-1 min-w-14 text-right text-[11px] font-medium ${SEGMENT_LABEL_STYLES[Math.max(0, strength.score - 1)]}`}
                      >
                        {strength.label}
                      </span>
                    </div>
                    <ul className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                      {strength.rules.map((rule) => (
                        <li key={rule.label} className="flex items-center gap-1.5 text-[11px]">
                          {rule.ok ? (
                            <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" aria-hidden />
                          ) : (
                            <X className="h-3 w-3 text-muted-foreground/60" aria-hidden />
                          )}
                          <span className={rule.ok ? 'text-muted-foreground line-through decoration-emerald-500/40' : 'text-muted-foreground'}>
                            {rule.label}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              {/* Confirm */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cp-confirm">Confirm new password</Label>
                <div className="relative">
                  <Input
                    id="cp-confirm"
                    type={showConfirm ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    className={`pr-10 ${confirmMismatch ? 'border-rose-400 focus-visible:ring-rose-300' : confirmMatches ? 'border-emerald-400 focus-visible:ring-emerald-300' : ''}`}
                    aria-invalid={confirmMismatch || undefined}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    {showConfirm ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  </button>
                  {confirmMatches ? (
                    <Check className="absolute right-9 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-500" aria-hidden />
                  ) : null}
                </div>
                {confirmMismatch ? (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400">Passwords do not match yet.</p>
                ) : null}
              </div>

              <Button
                type="submit"
                disabled={!canSubmit}
                className="mt-1 w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-500/20 transition-all hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Updating…
                  </>
                ) : (
                  <>
                    <KeyRound className="h-4 w-4" aria-hidden />
                    Set new password
                  </>
                )}
              </Button>

              <button
                type="button"
                onClick={handleSignOut}
                className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                <LogOut className="h-3 w-3" aria-hidden />
                Use a different account
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-white/50">
          Secured by Mbumah · your other devices are signed out automatically
        </p>
      </div>
    </div>
  );
}
