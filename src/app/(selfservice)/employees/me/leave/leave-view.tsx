'use client';

// MBUMAH HARDWARE POS - leave client view (v2.28.0)
//
// Balances and requests are server-rendered and arrive as `initialData`;
// the interactive half is the leave-request dialog, which POSTs through
// /api/self-service/me/leave (employeeId forced to the session-linked
// employee server-side) and then router.refresh() so the SSR render picks
// up the new request + balance without a full reload.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { CalendarOff, CalendarPlus, CheckCheck, Eye, Loader2, MessageSquareWarning, Palmtree, Paperclip, PenLine, RefreshCw, UserCheck } from 'lucide-react';
import { apiSend, EmptyState, ErrorNote, ProgressMeter, StatusBadge, formatDate } from '@/components/hr/self-service-ui';
import { previewWorkingDays } from '@/lib/leave-tab';
import { LeaveAttachmentPicker, LeaveAttachmentChip } from '@/components/hr/leave-attachment-ui';
import { parseLeaveAttachmentMeta } from '@/lib/hr/leave-attachment';
import { needsDeskRecheck } from '@/lib/hr/leave-recheck';

export interface BalanceDto {
  leaveTypeId: string;
  name: string;
  code: string;
  allocatedDays: string;
  usedDays: string;
  pendingDays: string;
  carryForwardDays: string;
  availableDays: string;
}
export interface RequestDto {
  id: string;
  type: string;
  code: string;
  startDate: string;
  endDate: string;
  workingDays: string;
  halfDay: boolean;
  status: string;
  reason: string | null;
  rejectionReason: string | null;
  /** v2.38.0: HR filer display name when the request was entered on behalf
   *  of the employee (null = self-filed) — renders the violet chip. */
  enteredByName?: string | null;
  /** v2.40.0: edit-window provenance (null = never corrected in place) —
   *  renders the amber "Corrected by HR" chip with the optional note. */
  editedAt?: string | null;
  editedByName?: string | null;
  editNote?: string | null;
  /** v2.42.0: supporting document — data URL (governed cap) or http(s) link. */
  attachmentUrl?: string | null;
  /** v2.45.0: deterministic edit provenance — the User.id of whoever
   *  corrected the request (null = pre-v2.45.0 edit or never edited). When
   *  it matches the signed-in user the card renders "Corrected by you". */
  editedByUserId?: string | null;
  /** v2.60.0: the desk-review mirror — when the desk last opened this
   *  request (null = never) and who it was, rendered on the card so a
   *  corrected request never feels ignored. The waiting/seen decision is
   *  computed through the SAME shared rule the desk chip uses. */
  deskReviewedAt?: string | null;
  deskReviewedByName?: string | null;
}
export interface LeaveDto {
  balances: BalanceDto[];
  requests: RequestDto[];
}

export function LeaveView({ initialData, selfUserId }: { initialData: LeaveDto; selfUserId: string }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // v2.33.0: self-withdrawal — the portal can finally CANCEL a pending
  // request (the API always allowed the owner; there was just no button).
  // The approvers group is notified with a violet Withdrawn row and the
  // pending days release back to the balance via the aggregate recompute.
  const [withdrawTarget, setWithdrawTarget] = useState<RequestDto | null>(null);
  // v2.34.0: resubmission after rejection — the last unclosed transition on
  // the leave lifecycle. The Declined card showed WHY it was rejected but the
  // employee had to rebuild the request from scratch; "Review & resubmit"
  // re-opens the request dialog pre-filled from the rejected row (type,
  // dates, half-day, original reason) with the manager's note in view.
  const [resubmitOf, setResubmitOf] = useState<RequestDto | null>(null);
  // v2.45.0: self-correction — the employee side of the governed edit
  // window. A typo on a PENDING request no longer costs a withdraw + refile:
  // "Correct" re-opens a pre-filled dialog and PUTs action EDIT to
  // /api/leaves (owner authz added server-side this release). The approver
  // fan-out (v2.43.0) tells the approvals group what changed.
  const [editTarget, setEditTarget] = useState<RequestDto | null>(null);

  const withdraw = async () => {
    if (!withdrawTarget) return;
    setBusy(true);
    setError('');
    try {
      await apiSend('/api/leaves', 'PUT', { action: 'CANCEL', leaveRequestId: withdrawTarget.id });
      setWithdrawTarget(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [halfDay, setHalfDay] = useState('false');
  const [reason, setReason] = useState('');
  // v2.42.0: optional supporting document (e.g. a medical certificate photo)
  // attached from the portal — same governed rules the HR desk enforces.
  const [attachment, setAttachment] = useState<string | null>(null);
  // v2.45.0: correction-dialog fields (own PENDING request).
  const [editTypeId, setEditTypeId] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editHalfDay, setEditHalfDay] = useState('false');
  const [editReason, setEditReason] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editAttachment, setEditAttachment] = useState<string | null>(null);

  /** Pre-fill the request dialog from a rejected request (v2.34.0). Falls
   *  back to an empty type when that balance row no longer exists — the
   *  dialog's own balance-check will refuse a type without entitlement. */
  const openResubmit = (r: RequestDto) => {
    const match = initialData.balances.find((b) => b.code === r.code);
    setResubmitOf(r);
    setLeaveTypeId(match?.leaveTypeId ?? '');
    setStartDate(r.startDate.slice(0, 10));
    setEndDate(r.endDate.slice(0, 10));
    setHalfDay(r.halfDay ? 'true' : 'false');
    setReason(r.reason ?? '');
    setOpen(true);
  };

  const closeRequestDialog = () => {
    setOpen(false);
    setResubmitOf(null);
    setAttachment(null);
  };

  /** Pre-fill the correction dialog from the employee's own PENDING request
   *  (v2.45.0). Falls back to an empty type when that balance row no longer
   *  exists — the server's balance guard will refuse an unentitled type. */
  const openCorrect = (r: RequestDto) => {
    const match = initialData.balances.find((b) => b.code === r.code);
    setEditTarget(r);
    setEditTypeId(match?.leaveTypeId ?? '');
    setEditStartDate(r.startDate.slice(0, 10));
    setEditEndDate(r.endDate.slice(0, 10));
    setEditHalfDay(r.halfDay ? 'true' : 'false');
    setEditReason(r.reason ?? '');
    setEditNote('');
    setEditAttachment(r.attachmentUrl ?? null);
  };

  const closeCorrectDialog = () => {
    setEditTarget(null);
    setEditAttachment(null);
  };

  /** No-op guard — Save stays disabled until something actually changed
   *  (same contract as the HR desk's correction dialog). A note-only
   *  change DOES count: the note is part of the correction. */
  const editDirty = (() => {
    if (!editTarget) return false;
    if (editNote.trim().length > 0) return true;
    if (editTypeId !== (initialData.balances.find((b) => b.code === editTarget.code)?.leaveTypeId ?? '')) return true;
    if (editStartDate !== editTarget.startDate.slice(0, 10)) return true;
    if (editEndDate !== editTarget.endDate.slice(0, 10)) return true;
    if (editHalfDay !== (editTarget.halfDay ? 'true' : 'false')) return true;
    if (editReason !== (editTarget.reason ?? '')) return true;
    if (editAttachment !== (editTarget.attachmentUrl ?? null)) return true;
    return false;
  })();

  // Live balance rail for the corrected range — the exact arithmetic the
  // server's edit guard applies (self-pending headroom on an unchanged
  // type, target-type draw on a type change).
  const editBalanceRow = editTarget ? initialData.balances.find((b) => b.leaveTypeId === editTypeId) : undefined;
  const editSelfHeadroom =
    editTarget && editBalanceRow && editBalanceRow.code === editTarget.code ? Number(editTarget.workingDays) : 0;
  const editPreviewDays = editTarget ? previewWorkingDays(editStartDate, editEndDate, editHalfDay === 'true') : 0;
  const editAvailable = editBalanceRow
    ? Number(editBalanceRow.allocatedDays) +
      Number(editBalanceRow.carryForwardDays) -
      Number(editBalanceRow.usedDays) -
      Number(editBalanceRow.pendingDays) +
      editSelfHeadroom
    : null;
  const editInsufficient = editAvailable !== null && editPreviewDays > editAvailable;
  const editFormReady =
    !!editTarget &&
    editDirty &&
    editPreviewDays > 0 &&
    !!editStartDate &&
    !!editEndDate &&
    editStartDate <= editEndDate &&
    !editInsufficient;

  const correct = async () => {
    if (!editTarget) return;
    setBusy(true);
    setError('');
    try {
      await apiSend('/api/leaves', 'PUT', {
        action: 'EDIT',
        leaveRequestId: editTarget.id,
        startDate: new Date(editStartDate).toISOString(),
        endDate: new Date(editEndDate).toISOString(),
        halfDay: editHalfDay === 'true',
        ...(editTypeId ? { leaveTypeId: editTypeId } : {}),
        ...(editReason.trim() ? { reason: editReason } : { reason: null }),
        ...(editNote.trim() ? { editNote: editNote } : { editNote: null }),
        ...(editAttachment !== (editTarget.attachmentUrl ?? null) ? { attachmentUrl: editAttachment } : {}),
      });
      closeCorrectDialog();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await apiSend('/api/self-service/me/leave', 'POST', {
        leaveTypeId,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        halfDay: halfDay === 'true',
        ...(reason.trim() ? { reason } : {}),
        ...(attachment ? { attachmentUrl: attachment } : {}),
      });
      setOpen(false);
      setResubmitOf(null);
      setStartDate('');
      setEndDate('');
      setReason('');
      setAttachment(null);
      // Re-run the server render - balances + requests come back fresh.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <span className="sr-only">Leave request actions</span>
        <Button size="sm" onClick={() => setOpen(true)} disabled={initialData.balances.length === 0} className="shadow-sm">
          <CalendarPlus className="h-4 w-4" aria-hidden /> Request leave
        </Button>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {/* Balances */}
      {initialData.balances.length === 0 ? (
        <EmptyState icon={<Palmtree className="h-8 w-8" aria-hidden />} title="No leave balances yet" hint="HR sets up your entitlements — they will appear here." />
      ) : (
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Leave balances">
          {initialData.balances.map((b) => {
            const allocated = Number(b.allocatedDays) + Number(b.carryForwardDays);
            const pct = allocated > 0 ? (Number(b.availableDays) / allocated) * 100 : 0;
            return (
              <div key={b.leaveTypeId} className="rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">{b.name}</p>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{b.code}</span>
                </div>
                <ProgressMeter pct={pct} label="Leave balance used" tone={pct <= 15 ? 'bad' : pct <= 40 ? 'warn' : 'good'} />
                <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                  <span>
                    <strong className="text-foreground tabular-nums">{Number(b.availableDays).toLocaleString()}</strong> of{' '}
                    <span className="tabular-nums">{allocated.toLocaleString()}</span> days available
                  </span>
                  {Number(b.pendingDays) > 0 ? <span className="text-amber-600 dark:text-amber-400">{Number(b.pendingDays)} pending</span> : null}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Requests */}
      {initialData.requests.length === 0 ? (
        <EmptyState icon={<CalendarPlus className="h-8 w-8" aria-hidden />} title="No requests yet" hint="Request leave with the button above." />
      ) : (
        <section aria-label="My leave requests" className="space-y-2">
          <h2 className="px-1 text-sm font-semibold">My requests</h2>
          <ul className="space-y-2">
            {initialData.requests.map((r) => (
              <li
                key={r.id}
                className={`rounded-xl border bg-card px-3.5 py-3 shadow-sm transition-shadow hover:shadow-md ${
                  r.status === 'REJECTED'
                    ? 'border-l-[3px] border-l-rose-400 dark:border-l-rose-500'
                    : r.status === 'PENDING'
                      ? 'border-l-[3px] border-l-amber-400 dark:border-l-amber-500'
                      : r.status === 'APPROVED'
                        ? 'border-l-[3px] border-l-emerald-400 dark:border-l-emerald-500'
                        : 'border-l-[3px] border-l-violet-400 dark:border-l-violet-500'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {r.type}
                    {r.halfDay ? ' (half day)' : ''} · {Number(r.workingDays)} day{Number(r.workingDays) === 1 ? '' : 's'}
                  </p>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    {/* v2.33.0: withdraw while the request is still pending —
                        managers no longer need to be asked to "remove it". */}
                    {r.status === 'PENDING' ? (
                      <>
                        {/* v2.45.0: self-correction — fix a typo in place
                            instead of withdraw + refile. */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 border-indigo-300 px-2 text-xs text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                          onClick={() => openCorrect(r)}
                          disabled={busy}
                        >
                          <PenLine className="h-3 w-3" aria-hidden /> Correct
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 border-violet-300 px-2 text-xs text-violet-700 hover:bg-violet-50 hover:text-violet-800 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40"
                          onClick={() => setWithdrawTarget(r)}
                          disabled={busy}
                        >
                          <CalendarOff className="h-3 w-3" aria-hidden /> Withdraw
                        </Button>
                      </>
                    ) : null}
                    {/* v2.34.0: resubmission after rejection — the pre-filled
                        retry that closes the decision loop. */}
                    {r.status === 'REJECTED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 border-amber-300 px-2 text-xs text-amber-700 hover:bg-amber-50 hover:text-amber-800 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
                        onClick={() => openResubmit(r)}
                        disabled={busy}
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden /> Review &amp; resubmit
                      </Button>
                    ) : null}
                  </div>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDate(r.startDate)} → {formatDate(r.endDate)}
                </p>
                {/* v2.38.0: the employee should always be able to tell apart
                    requests they typed from requests HR entered for them. */}
                {r.enteredByName ? (
                  <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900">
                    <UserCheck className="h-3 w-3" aria-hidden /> Filed by HR · {r.enteredByName}
                  </p>
                ) : null}
                {/* v2.40.0: correction provenance on the card — the employee
                    sees who fixed the request (and why) without cross-
                    referencing the bell row. */}
                {r.editedByName ? (
                  <div className="mt-1.5">
                    {r.editedByUserId && r.editedByUserId === selfUserId ? (
                      /* v2.45.0: the employee corrected it themselves —
                          deterministic via editedByUserId, not name matching. */
                      <p className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:ring-indigo-900">
                        <CheckCheck className="h-3 w-3" aria-hidden /> Corrected by you
                      </p>
                    ) : (
                      <p className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
                        <PenLine className="h-3 w-3" aria-hidden /> Corrected by HR · {r.editedByName}
                      </p>
                    )}
                    {r.editNote ? <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-300/90">Note: {r.editNote}</p> : null}
                    {/* v2.60.0: the review mirror — the employee side of the
                        desk's re-check marker, decided by the SAME shared
                        rule (needsDeskRecheck) so the two sides can never
                        disagree. While the correction is unseen the card
                        says so honestly (amber); once a desk visit lands
                        after the edit it names the reviewer (emerald) — a
                        correction answered by a person, not a timer. */}
                    {needsDeskRecheck(r.editedAt, r.deskReviewedAt) ? (
                      <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900">
                        <Eye className="h-3 w-3" aria-hidden /> Waiting for a desk review
                      </p>
                    ) : r.deskReviewedAt ? (
                      <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900">
                        <Eye className="h-3 w-3" aria-hidden />
                        {r.deskReviewedByName ? `Seen by ${r.deskReviewedByName}` : 'Seen by the desk'} · {formatDate(r.deskReviewedAt)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {r.reason ? <p className="mt-1 text-xs text-muted-foreground">“{r.reason}”</p> : null}
                {/* v2.42.0 + v2.43.0: the supporting document, kind-coded —
                    one click opens it in a new tab (data URLs offer a
                    download); image attachments preview inline so the
                    employee can confirm the right file is on the request. */}
                {r.attachmentUrl ? (
                  <div className="mt-1.5">
                    <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <Paperclip className="h-3 w-3" aria-hidden /> Attached document
                    </p>
                    {parseLeaveAttachmentMeta(r.attachmentUrl)?.kind === 'image' &&
                    r.attachmentUrl.startsWith('data:image/') ? (
                      /* eslint-disable-next-line @next/next/no-img-element -- governed 500 KB data URL; next/image adds nothing for an inline evidence preview */
                      <img
                        src={r.attachmentUrl}
                        alt="Attached document preview"
                        className="mb-1.5 max-h-40 w-full rounded-md border bg-white object-contain dark:bg-background"
                      />
                    ) : null}
                    <LeaveAttachmentChip value={r.attachmentUrl} />
                  </div>
                ) : null}
                {r.rejectionReason ? (
                  <div className="mt-1 rounded-lg bg-rose-50 px-2 py-1.5 dark:bg-rose-950/40">
                    <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                      <MessageSquareWarning className="h-3 w-3" aria-hidden /> Manager&apos;s note
                    </p>
                    <p className="mt-0.5 text-xs text-rose-700 dark:text-rose-300">Declined: {r.rejectionReason}</p>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Withdraw-confirm dialog (v2.33.0 self-cancel direction). */}
      <Dialog open={!!withdrawTarget} onOpenChange={(v) => !v && setWithdrawTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarOff className="h-4 w-4 text-violet-600" /> Withdraw leave request
            </DialogTitle>
            <DialogDescription>
              {withdrawTarget
                ? `${withdrawTarget.type} · ${formatDate(withdrawTarget.startDate)} → ${formatDate(withdrawTarget.endDate)} · ${Number(withdrawTarget.workingDays)} day(s)`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/30">
            <p className="text-sm">Your request will be withdrawn without a manager decision.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              The {withdrawTarget ? Number(withdrawTarget.workingDays) : 0} pending day(s) release straight back to your balance, and your approver is told the slot is free again.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWithdrawTarget(null)} disabled={busy}>Keep request</Button>
            <Button
              disabled={busy}
              className="bg-violet-600 text-white hover:bg-violet-700"
              onClick={() => void withdraw()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarOff className="h-4 w-4" aria-hidden />}
              Withdraw request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Correction dialog (v2.45.0 self-correction): pre-filled from the
          employee's own PENDING request, indigo surface matching the
          leave_edited notification rail, with the same live day-count +
          balance rail and no-op guard the HR desk's dialog enforces. */}
      <Dialog open={!!editTarget} onOpenChange={(v) => (v ? setEditTarget(editTarget) : closeCorrectDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PenLine className="h-4 w-4 text-indigo-600" aria-hidden /> Correct your request
            </DialogTitle>
            <DialogDescription>
              Fix the details in place — the request stays pending and your approver is told exactly what changed.
            </DialogDescription>
          </DialogHeader>
          {editTarget ? (
            <>
              {/* Before → after strip */}
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950/30">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700 dark:text-indigo-400">Correcting in place</p>
                <p className="mt-0.5 text-sm text-foreground">
                  {editTarget.type} · {formatDate(editTarget.startDate)} → {formatDate(editTarget.endDate)} · {Number(editTarget.workingDays)} day(s)
                </p>
                {(() => {
                  const newTypeName = initialData.balances.find((b) => b.leaveTypeId === editTypeId)?.name;
                  const changedDates = editStartDate !== editTarget.startDate.slice(0, 10) || editEndDate !== editTarget.endDate.slice(0, 10);
                  if (!changedDates && newTypeName === editTarget.type && editHalfDay === (editTarget.halfDay ? 'true' : 'false')) {
                    return <p className="mt-1 text-xs text-muted-foreground">Adjust the fields below — nothing has changed yet.</p>;
                  }
                  return (
                    <p className="mt-1 text-xs text-indigo-800 dark:text-indigo-300">
                      Now: {newTypeName ?? editTarget.type}
                      {editHalfDay === 'true' ? ' (half day)' : ''} · {formatDate(`${editStartDate}T00:00:00.000Z`)} → {formatDate(`${editEndDate}T00:00:00.000Z`)}
                      {editPreviewDays > 0 ? ` · ${editPreviewDays % 1 === 0 ? editPreviewDays : editPreviewDays.toFixed(1)} day(s)` : ''}
                    </p>
                  );
                })()}
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Leave type</Label>
                  <Select value={editTypeId} onValueChange={setEditTypeId}>
                    <SelectTrigger aria-label="Leave type"><SelectValue placeholder="Choose type" /></SelectTrigger>
                    <SelectContent>
                      {initialData.balances.map((b) => (
                        <SelectItem key={b.leaveTypeId} value={b.leaveTypeId}>
                          {b.name} — {Number(b.availableDays)}d available
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="correct-start">Start</Label>
                    <Input id="correct-start" type="date" value={editStartDate} onChange={(e) => setEditStartDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="correct-end">End</Label>
                    <Input id="correct-end" type="date" value={editEndDate} onChange={(e) => setEditEndDate(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Duration</Label>
                  <Select value={editHalfDay} onValueChange={setEditHalfDay}>
                    <SelectTrigger aria-label="Duration"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="false">Full days</SelectItem>
                      <SelectItem value="true">Half day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {/* Balance rail — mirrors the server's pre-flight guard. */}
                {editBalanceRow && editAvailable !== null ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      editInsufficient
                        ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300'
                        : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                    }`}
                  >
                    {editInsufficient
                      ? `Corrected range needs ${editPreviewDays % 1 === 0 ? editPreviewDays : editPreviewDays.toFixed(1)} d but only ${editAvailable} d are available — the server will reject this correction.`
                      : `${editAvailable} day(s) available on ${editBalanceRow.name} for the corrected range.`}
                  </div>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="correct-reason">Reason (optional)</Label>
                  <Textarea id="correct-reason" rows={2} value={editReason} onChange={(e) => setEditReason(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="correct-note">Note to your approver (optional)</Label>
                  <Textarea
                    id="correct-note"
                    rows={2}
                    placeholder="e.g. shifted a day — the site visit moved to Friday"
                    value={editNote}
                    onChange={(e) => setEditNote(e.target.value)}
                  />
                </div>
                <LeaveAttachmentPicker value={editAttachment} onChange={setEditAttachment} testId="portal-correct-attachment" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeCorrectDialog}>Cancel</Button>
                <Button
                  disabled={busy || !editFormReady}
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                  onClick={() => void correct()}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PenLine className="h-4 w-4" aria-hidden />}
                  Save correction
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Request dialog — doubles as the v2.34.0 resubmission flow when a
          rejected request pre-filled it: the amber context card keeps the
          manager's note and the "creates a NEW request" contract visible
          while every field stays editable. */}
      <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : closeRequestDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {resubmitOf ? (
                <>
                  <RefreshCw className="h-4 w-4 text-amber-600" aria-hidden /> Resubmit leave request
                </>
              ) : (
                'Request leave'
              )}
            </DialogTitle>
            <DialogDescription>
              {resubmitOf
                ? 'Pre-filled from the declined request — adjust anything, then submit. This creates a NEW request; the declined one stays on record.'
                : 'The request goes to your branch approver. Balance checks run immediately.'}
            </DialogDescription>
          </DialogHeader>
          {resubmitOf ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">Rejected request</p>
              <p className="mt-0.5 text-sm text-foreground">
                {resubmitOf.type} · {formatDate(resubmitOf.startDate)} → {formatDate(resubmitOf.endDate)} · {Number(resubmitOf.workingDays)} day(s)
              </p>
              {resubmitOf.rejectionReason ? (
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">Manager&apos;s note: {resubmitOf.rejectionReason}</p>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Leave type</Label>
              <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
                <SelectTrigger aria-label="Leave type"><SelectValue placeholder="Choose type" /></SelectTrigger>
                <SelectContent>
                  {initialData.balances.map((b) => (
                    <SelectItem key={b.leaveTypeId} value={b.leaveTypeId}>
                      {b.name} — {Number(b.availableDays)}d available
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="leave-start">Start</Label>
                <Input id="leave-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="leave-end">End</Label>
                <Input id="leave-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Duration</Label>
              <Select value={halfDay} onValueChange={setHalfDay}>
                <SelectTrigger aria-label="Duration"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">Full days</SelectItem>
                  <SelectItem value="true">Half day</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="leave-reason">Reason (optional)</Label>
              <Textarea id="leave-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {/* v2.42.0: optional supporting document — a photo of the medical
                certificate is the classic case. Same rules as the HR desk. */}
            <LeaveAttachmentPicker value={attachment} onChange={setAttachment} testId="portal-attachment" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeRequestDialog}>Cancel</Button>
            <Button disabled={busy || !leaveTypeId || !startDate || !endDate} onClick={() => void submit()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : resubmitOf ? <RefreshCw className="h-4 w-4" aria-hidden /> : null}
              {resubmitOf ? 'Resubmit request' : 'Submit request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
