'use client';

// ─────────────────────────────────────────────────────────────────────────────
// Desk report view (v2.69.0) — the desk files its report.
//
// /org/desk-report renders the per-branch desk report the Desk activity
// panel links to: totals, a per-branch roll-up, the day-by-day bar strip,
// the reviewers who did the desk work, and the most-visited requests —
// computed SERVER-SIDE by GET /api/org/desk-report (the client only fetches
// and renders, so a printed copy can never disagree with the screen).
//
// v2.74.0: the drill-downs talk to each other. A request visit row names
// its reviewer — that name is a door now; a reviewer visit row names its
// request — that title is a door too (when the file has a drawer: the
// top-requests section is a capped digest, and a door is promised only
// where one exists). Each jump remembers where it came from: a small
// "via" chip in the opened drawer offers the jump back in one click, and
// any plain toggle or scope change clears the memory. The one-drawer rule
// still governs the whole page — opening either family closes the other,
// so the report never shows two drawers at once.
//
// v2.78.0: the scope speaks the keyboard. The window and branch chips are
// a roving group — arrows move between the chips in a group (wrapping at
// the ends), Enter/Space commits the focused chip, and only the active
// chip holds the group's single tab stop (APG roving tabindex). Every
// re-key is announced through a second sr-only live region: "Window: 14
// days — report re-keyed." The walk (j/k) covers the doors; the arrows
// answer the chips; both speak through the same quiet channel.
//
// Print contract: the "Print" button isolates #desk-report-content through
// the app's print-root pipeline (printReceiptElement clones the node into
// #print-root; @media print shows ONLY that host) — the nav, sidebar and
// toolbar never reach the printer, and colors survive via
// print-color-adjust: exact. The toolbar (window/branch chips + button)
// carries print:hidden.
//
// Scope contract: window chips (7/14/30) and the branch chips re-key the
// WHOLE report on purpose — an explicit report scope, unlike the org-wide
// morning note. The heading names the scope in plain words.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, ArrowUpRight, BadgeCheck, Building2, CalendarRange, ChevronDown, CornerUpLeft,
  FileSpreadsheet, FileText, Printer, RefreshCw, Sunrise, Users,
} from 'lucide-react';
import { authorizedFetchJson } from '@/lib/api';
import { printReceiptElement } from '@/lib/receipt-pdf';
import { num, timeAgo } from '@/components/org/primitives';
import {
  DESK_REPORT_WINDOW_DAYS,
  deskReportAvatarHue,
  deskReportChipStep,
  deskReportDayLabel,
  deskReportHasRequestDoor,
  deskReportRequestLedger,
  deskReportRequestSubject,
  deskReportReviewerLedger,
  deskReportScopeAnnouncement,
  deskReportShortStoreName,
  deskReportVisitTime,
  type DeskReportPayload,
} from '@/lib/hr/desk-report';

const WINDOW_LABELS: Record<number, string> = { 7: '7 days', 14: '14 days', 30: '30 days' };

// Status chips mirror the desk panel's language (same four states).
const REPORT_STATUS_CHIP: Record<string, string> = {
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300',
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300',
  REJECTED: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300',
  CANCELLED: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400',
};

const STATUS_CHIP_FALLBACK = 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400';

export function DeskReportView() {
  const [days, setDays] = useState<number>(7);
  const [branch, setBranch] = useState<string | null>(null);
  const [data, setData] = useState<DeskReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // v2.70.0: the CSV voice — a busy flag keeps the button honest while the
  // file downloads (the fetch carries the session cookie, same as the read).
  const [csvBusy, setCsvBusy] = useState(false);
  // v2.71.0: the reviewer drill-down — the name of the reviewer whose ledger
  // is open, or null. v2.72.0: the request drill-down joins it — the id of
  // the request whose visits are open. ONE drawer across the whole report:
  // opening a reviewer closes the open request and vice versa, so the page
  // stays calm; a scope change closes both (a new window/branch re-keys the
  // whole report, drawers included).
  const [openReviewer, setOpenReviewer] = useState<string | null>(null);
  const [openRequest, setOpenRequest] = useState<string | null>(null);
  // v2.74.0: the cross-links' memory — HOW the open drawer was reached. A
  // jump through a visit row records where it came from (a requestId when a
  // reviewer drawer was opened from a request's rows, a reviewer name for
  // the reverse), and the opened drawer wears a small "via" chip offering
  // the jump back. Any plain toggle or scope change clears it: the chip
  // only ever describes the jump that just happened.
  const [viaRequest, setViaRequest] = useState<string | null>(null);
  const [viaReviewer, setViaReviewer] = useState<string | null>(null);
  // v2.77.0: the walk's announcer — an aria-live region that names each
  // door as j/k lands on it (and the Escape close), mounted unconditionally
  // so the live region exists before the first message arrives.
  const [walkAnnouncement, setWalkAnnouncement] = useState('');
  // v2.78.0: the scope's announcer — the same quiet channel for the other
  // hand on the report: picking a window or branch chip names what the
  // report re-keyed to, so a keyboard user is never left guessing whether
  // the pick landed (the fetch takes a beat; the words arrive first).
  const [scopeAnnouncement, setScopeAnnouncement] = useState('');
  const loadSeq = useRef(0);

  const load = useCallback(async (d: number, b: string | null) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const query = `?days=${d}${b ? `&branch=${encodeURIComponent(b)}` : ''}`;
      const res = await authorizedFetchJson(`/api/org/desk-report${query}`);
      if (seq !== loadSeq.current) return; // a newer window/branch choice won
      if (res.ok && res.json?.success) {
        setData(res.json.data as DeskReportPayload);
        setError(null);
      } else {
        setData(null);
        setError(
          res.status === 401
            ? 'Sign in to file the desk report.'
            : res.status === 403
              ? 'The desk report is limited to org roles (SUPER_ADMIN, STORE_OWNER, BRANCH_MANAGER).'
              : res.json?.error ?? 'Desk report unavailable.',
        );
      }
    } catch {
      if (seq === loadSeq.current) {
        setData(null);
        setError('Desk report unavailable.');
      }
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred initial load keeps the effect body free of synchronous
    // setState (react-hooks/set-state-in-effect).
    const initial = setTimeout(() => void load(days, branch), 0);
    return () => clearTimeout(initial);
  }, [load, days, branch]);

  // v2.78.0 — the picks speak: a real re-key (the guard's no-op stays
  // silent) names its new scope through the live region BEFORE the fetch
  // resolves — the words land first, the numbers follow.
  const pickDays = (d: number) => {
    if (d === days) return;
    setScopeAnnouncement(deskReportScopeAnnouncement('window', WINDOW_LABELS[d] ?? `${d} days`));
    setDays(d);
    clearDrawers();
    void load(d, branch);
  };
  const pickBranch = (id: string | null) => {
    if (id === branch) return;
    const label = id ? data?.branches.find((b) => b.storeId === id)?.storeName ?? null : null;
    setScopeAnnouncement(deskReportScopeAnnouncement('branch', label));
    setBranch(id);
    clearDrawers();
    void load(days, id);
  };

  // v2.78.0 — the chips answer the arrows: a roving keydown handler shared
  // by both chip groups. The arrows (and Home/End) move focus between the
  // group's chips — wrapping at the ends — and leave the rest alone (Tab
  // keeps its native order, Enter/Space keep their native click). Focus
  // moves; the pick is deliberate: committing the re-key is the focused
  // chip's native Enter/Space, so arrowing through never fires a fetch.
  const chipNav = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const group = e.currentTarget.parentElement;
    if (!group) return;
    const chips = Array.from(group.querySelectorAll<HTMLButtonElement>('button'));
    const idx = chips.indexOf(e.currentTarget);
    const next = deskReportChipStep(e.key, idx, chips.length);
    if (next === null) return;
    e.preventDefault();
    chips[next].focus();
  };

  // v2.71.0 — the report opens its ledger: one drawer at a time, toggling
  // the open reviewer closed again. v2.72.0 — the second family joins: a
  // request door closes the reviewer drawer and a reviewer door closes the
  // request drawer — the report holds ONE open drawer, whichever family.
  // v2.74.0 — the shared reset: every plain toggle and scope change also
  // clears the cross-link memory, so a "via" chip can only ever describe
  // the jump that just happened, never a stale one. v2.76.0 — memoized:
  // the keyboard effect subscribes against it, and setters are stable, so
  // the reset (and with it the listener) is created exactly once.
  const clearDrawers = useCallback(() => {
    setOpenReviewer(null);
    setOpenRequest(null);
    setViaRequest(null);
    setViaReviewer(null);
  }, []);
  const toggleReviewer = (name: string) => {
    setOpenRequest(null);
    setViaRequest(null);
    setViaReviewer(null);
    setOpenReviewer((cur) => (cur === name ? null : name));
  };
  // v2.72.0 — the report reads the file: the same one-drawer rule for the
  // request family.
  const toggleRequest = (id: string) => {
    setOpenReviewer(null);
    setViaRequest(null);
    setViaReviewer(null);
    setOpenRequest((cur) => (cur === id ? null : id));
  };
  // v2.74.0 — the cross-links: a visit row inside one family's drawer names
  // the other family, and clicking it jumps there. The one-drawer rule does
  // the closing; the jump records where it came from so the opened drawer
  // can offer the way back in one click.
  const jumpToReviewer = (name: string, fromRequestId: string) => {
    setOpenRequest(null);
    setViaRequest(null);
    setViaReviewer(fromRequestId);
    setOpenReviewer(name);
  };
  const jumpToRequest = (id: string, fromReviewer: string) => {
    setOpenReviewer(null);
    setViaReviewer(null);
    setViaRequest(fromReviewer);
    setOpenRequest(id);
  };
  const jumpBackToReviewer = () => {
    if (!viaRequest) return;
    const name = viaRequest;
    setOpenRequest(null);
    setViaRequest(null);
    setViaReviewer(null);
    setOpenReviewer(name);
  };
  const jumpBackToRequest = () => {
    if (!viaReviewer) return;
    const id = viaReviewer;
    setOpenReviewer(null);
    setViaRequest(null);
    setViaReviewer(null);
    setOpenRequest(id);
  };

  // v2.76.0 — the keyboard walks the report: j focuses the next door, k the
  // previous, both wrapping at the ends; escape closes whatever is open.
  // Every door carries data-desk-door (both families' rows, the cross-link
  // doors inside the drawers, and the via chips), so the walk follows DOM
  // order — what you tab through is exactly what j/k visits, and doors that
  // only exist while a drawer is open join the walk with it. The guards
  // keep the shortcut out of the way: no modifiers, and never inside an
  // input (the palette's search, a form field) — typing stays typing.
  // v2.77.0 — the walk can be FOLLOWED: the focused door glides into view
  // (focus without the jump, then a smooth nearest-edge scroll), a quiet
  // aria-live region announces each move ("Door 4 of 13 — …") so screen
  // readers ride along, and Escape — when a drawer was actually open —
  // returns focus to the row that owned it, the way a dialog returns focus
  // to its trigger. The state reads live in the deps: the handler is
  // re-bound exactly when the drawer it must remember changes.
  useEffect(() => {
    const announce = (message: string) => setWalkAnnouncement(message);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape') {
        const wasReviewer = openReviewer;
        const wasRequest = openRequest;
        if (!wasReviewer && !wasRequest) return; // nothing open: silence is honest
        // The owning row's selector, narrowed per family (the compound
        // guard above cannot tell TypeScript WHICH drawer was open). The
        // row's human label rides a data attribute, so the announcement
        // names the place — not a uuid.
        const closedRow = wasReviewer
          ? { selector: `[data-desk-door][data-reviewer-name="${CSS.escape(wasReviewer)}"]` }
          : wasRequest
            ? { selector: `[data-desk-door][data-request-id="${CSS.escape(wasRequest)}"]` }
            : null;
        if (!closedRow) return;
        clearDrawers();
        // Focus returns to the row that owned the drawer (APG dialog
        // pattern): the walk continues from where the drawer began.
        requestAnimationFrame(() => {
          const row = document.querySelector<HTMLElement>(closedRow.selector);
          if (row) {
            row.focus({ preventScroll: true });
            announce(`Drawer closed — back on ${row.getAttribute('data-desk-row-label') ?? 'its row'}.`);
          }
        });
        return;
      }
      if (e.key !== 'j' && e.key !== 'k') return;
      const doors = Array.from(document.querySelectorAll<HTMLElement>('[data-desk-door]'));
      if (doors.length === 0) return;
      const idx = doors.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      const nextIdx = idx === -1
        ? (e.key === 'j' ? 0 : doors.length - 1)
        : (e.key === 'j' ? (idx + 1) % doors.length : (idx - 1 + doors.length) % doors.length);
      const next = doors[nextIdx];
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const label = next.getAttribute('aria-label') ?? next.textContent?.trim() ?? 'door';
      announce(`Door ${nextIdx + 1} of ${doors.length} — ${label}`);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [clearDrawers, openReviewer, openRequest]);

  // v2.70.0 — the report files itself: ?format=csv returns the SAME derived
  // report through the shared server-side builder (RFC-4180 + OWASP guard);
  // the filename comes from the Content-Disposition the route stamps, so
  // the filed copy always names its window and scope truthfully.
  const downloadCsv = useCallback(async (d: number, b: string | null) => {
    setCsvBusy(true);
    try {
      const query = `?days=${d}${b ? `&branch=${encodeURIComponent(b)}` : ''}&format=csv`;
      const res = await fetch(`/api/org/desk-report${query}`, { credentials: 'include' });
      if (!res.ok) {
        setError(res.status === 401 ? 'Sign in to file the desk report.' : 'Desk report CSV unavailable.');
        return;
      }
      const disposition = res.headers.get('content-disposition') ?? '';
      const filename = /filename="(.+?)"/.exec(disposition)?.[1] ?? 'mbumah-desk-report.csv';
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      setError('Desk report CSV unavailable.');
    } finally {
      setCsvBusy(false);
    }
  }, []);

  const scopeLabel = data?.scope.branchName
    ? `Branch: ${data.scope.branchName}`
    : 'All branches';

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      {/* v2.77.0 — the walk's announcer: mounted unconditionally at the root
          so the live region exists before the first j/k lands. sr-only: it
          is for ears, not eyes; the doors' focus rings are for eyes.
          v2.78.0 — the scope's announcer joins it: the same channel for the
          chips' re-keys ("Window: 14 days — report re-keyed."), mounted the
          same way, for the same reason. */}
      <span data-testid="desk-report-walk-announcer" role="status" aria-live="polite" className="sr-only">
        {walkAnnouncement}
      </span>
      <span data-testid="desk-report-scope-announcer" role="status" aria-live="polite" className="sr-only">
        {scopeAnnouncement}
      </span>
      {/* Toolbar — screen-only chrome (print:hidden) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link
          href="/console"
          data-testid="desk-report-back"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to desk activity
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Report window length" data-testid="desk-report-window-chips" className="flex items-center gap-1">
            {DESK_REPORT_WINDOW_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days === d}
                // v2.78.0 — roving tabindex: the active chip holds the
                // group's single tab stop; arrows walk the rest.
                tabIndex={days === d ? 0 : -1}
                onKeyDown={chipNav}
                onClick={() => pickDays(d)}
                data-testid={`desk-report-window-${d}`}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${days === d
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
              >
                {WINDOW_LABELS[d] ?? `${d} days`}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load(days, branch)}
            data-testid="desk-report-refresh"
            aria-label="Refresh the report"
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void downloadCsv(days, branch)}
            disabled={csvBusy}
            data-testid="desk-report-csv"
            title="Download the report as CSV (RFC-4180, formula-injection guarded)"
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:text-slate-50"
          >
            <FileSpreadsheet className={`h-3.5 w-3.5 ${csvBusy ? 'animate-pulse' : ''}`} aria-hidden /> {csvBusy ? 'Filing…' : 'CSV'}
          </button>
          <button
            type="button"
            onClick={() => printReceiptElement('desk-report-content')}
            data-testid="desk-report-print"
            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden /> Print
          </button>
        </div>
      </div>

      {error ? (
        <p
          data-testid="desk-report-error"
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
        >
          {error}
        </p>
      ) : null}

      {!error && !data ? (
        <p data-testid="desk-report-loading" className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-500">
          Filing the desk report…
        </p>
      ) : null}

      {data ? (
        <div
          id="desk-report-content"
          data-testid="desk-report-content"
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          {/* Report header — the dawn voice carries over from the strip */}
          <header
            data-testid="desk-report-heading"
            className="border-b border-amber-200/80 bg-gradient-to-r from-amber-50/90 via-white to-emerald-50/70 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:border-amber-500/20 dark:from-amber-500/10 dark:via-slate-900 dark:to-emerald-500/10 dark:shadow-none"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h1 className="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-100">
                <Sunrise className="h-5 w-5 text-amber-500" aria-hidden /> Desk report
              </h1>
              <p className="text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
                Generated {new Date(data.generatedAt).toLocaleString('en-GB', { hour12: false })} · EAT
              </p>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span data-testid="desk-report-window-label" className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
                <CalendarRange className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> {data.window.label}
              </span>
              <span data-testid="desk-report-scope" title={data.scope.branchName ?? 'Every branch on the ledger'} className="inline-flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> {scopeLabel}
              </span>
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {data.window.days} EAT calendar days, today included
              </span>
            </p>
          </header>

          {data.totals.visits === 0 ? (
            <div className="p-5">
              <p
                data-testid="desk-report-empty"
                className="flex items-center gap-2 rounded-lg border border-dashed border-amber-300/60 bg-amber-50/40 px-4 py-6 text-sm text-slate-500 dark:border-amber-500/20 dark:bg-amber-500/5 dark:text-slate-400"
              >
                <Sunrise className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                The desk was quiet for this window — no visits on record{data.scope.branchName ? ` for ${data.scope.branchName}` : ''}. The report fills as reviewers open leave requests.
              </p>
            </div>
          ) : (
            <div className="space-y-6 p-5">
              {/* Totals strip */}
              <div data-testid="desk-report-totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {([
                  ['visits', 'Visits', data.totals.visits, 'text-slate-800 dark:text-slate-100'],
                  ['clears', 'Corrections answered', data.totals.clears, 'text-emerald-600 dark:text-emerald-400'],
                  ['reviewers', 'Reviewers', data.totals.reviewers, 'text-slate-800 dark:text-slate-100'],
                  ['requests', 'Requests touched', data.totals.requests, 'text-slate-800 dark:text-slate-100'],
                ] as Array<[string, string, number, string]>).map(([id, label, value, tone]) => (
                  <div
                    key={id}
                    data-testid={`desk-report-tot-${id}`}
                    className="rounded-xl border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <p className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</p>
                    <p className={`mt-0.5 text-xl font-bold leading-none tabular-nums ${tone}`}>{num(value)}</p>
                  </div>
                ))}
              </div>

              {/* Branch chips — the explicit report scope (also re-keys the report) */}
              <div role="group" aria-label="Narrow the report by branch" data-testid="desk-report-branch-chips" className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  aria-pressed={!branch}
                  // v2.78.0 — roving tabindex, same rule as the window chips:
                  // one tab stop per group, on the active chip.
                  tabIndex={!branch ? 0 : -1}
                  onKeyDown={chipNav}
                  onClick={() => pickBranch(null)}
                  data-testid="desk-report-branch-chip-all"
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${!branch
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                >
                  All branches
                </button>
                {data.branches.map((b) => {
                  const active = branch === b.storeId;
                  return (
                    <button
                      key={b.storeId}
                      type="button"
                      aria-pressed={active}
                      title={b.storeName}
                      tabIndex={active ? 0 : -1}
                      onKeyDown={chipNav}
                      onClick={() => pickBranch(active ? null : b.storeId)}
                      data-testid={`desk-report-branch-chip-${b.storeId}`}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${active
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-300'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}`}
                    >
                      {deskReportShortStoreName(b.storeName)}
                      <span className="tabular-nums opacity-70">{num(b.visits)}</span>
                    </button>
                  );
                })}
              </div>

              {/* Day-by-day bar strip — every day of the window, honest zeros */}
              <section aria-label="Visits per day" data-testid="desk-report-series">
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <CalendarRange className="h-3.5 w-3.5" aria-hidden /> Day by day
                </h2>
                <div className="flex items-end gap-1 overflow-x-auto pb-1">
                  {data.series.map((p) => {
                    const maxV = Math.max(...data.series.map((s) => s.visits), 1);
                    const h = p.visits === 0 ? 6 : Math.max(14, Math.round((p.visits / maxV) * 64));
                    return (
                      <div key={p.key} data-testid={`desk-report-day-${p.key}`} className="flex min-w-[34px] flex-1 flex-col items-center gap-1" title={`${p.label} — ${p.visits} visit${p.visits === 1 ? '' : 's'} · ${p.clears} correction${p.clears === 1 ? '' : 's'} answered`}>
                        <span className={`text-[10px] font-semibold tabular-nums ${p.visits > 0 ? 'text-slate-600 dark:text-slate-300' : 'text-slate-300 dark:text-slate-600'}`}>{p.visits}</span>
                        <div
                          className={`w-full max-w-[40px] rounded-t-md ${p.visits > 0 ? 'bg-gradient-to-t from-amber-400 to-emerald-500' : 'bg-slate-100 dark:bg-slate-800'}`}
                          style={{ height: `${h}px` }}
                          aria-hidden
                        />
                        <span className="whitespace-nowrap text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{p.label.split(', ')[1] ?? p.label}</span>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Per-branch roll-up — the heart of the report */}
              <section aria-label="Per-branch desk activity" data-testid="desk-report-branches">
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <Building2 className="h-3.5 w-3.5" aria-hidden /> By branch ({data.branches.length})
                </h2>
                <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50/70 text-left text-[10px] uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-500">
                        <th className="px-3 py-2 font-medium">Branch</th>
                        <th className="px-3 py-2 text-right font-medium">Visits</th>
                        <th className="px-3 py-2 text-right font-medium">Corrections answered</th>
                        <th className="px-3 py-2 text-right font-medium">Reviewers</th>
                        <th className="px-3 py-2 text-right font-medium">Requests</th>
                        <th className="px-3 py-2 text-right font-medium">Last visit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.branches.map((b) => (
                        <tr key={b.storeId} data-testid="desk-report-branch-row" className="border-b border-slate-50 transition-colors last:border-0 hover:bg-emerald-50/40 dark:border-slate-800/60 dark:hover:bg-emerald-500/5">
                          <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-200">{b.storeName}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800 dark:text-slate-100">{num(b.visits)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">{num(b.clears)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{num(b.reviewers)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">{num(b.requests)}</td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-400 dark:text-slate-500">{b.lastVisitAt ? `${timeAgo(b.lastVisitAt)} ago` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Reviewers — who did the desk work. v2.71.0: every row is a
                  door — click it and the reviewer's own visits for this same
                  window open beneath, straight from the same derivation. */}
              <section aria-label="Reviewers in this window" data-testid="desk-report-reviewers">
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <Users className="h-3.5 w-3.5" aria-hidden /> Reviewers ({data.reviewers.length})
                  <span className="hidden font-normal normal-case tracking-normal text-slate-400 sm:inline print:hidden dark:text-slate-500">
                    — click a reviewer to read their visits · file names inside a drawer jump across
                  </span>
                </h2>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 dark:divide-slate-800 dark:border-slate-800">
                  {data.reviewers.map((r) => {
                    const open = openReviewer === r.name;
                    const visits = deskReportReviewerLedger(data.ledger, r.name);
                    // v2.74.0 — the via chip's label: when this drawer was
                    // reached through a request's visit rows, the same ledger
                    // names the file to offer the jump back to.
                    const viaBackSubject = viaReviewer ? deskReportRequestSubject(data.ledger, viaReviewer) : null;
                    return (
                      <li key={r.name} data-testid="desk-report-reviewer-row" className="px-3">
                        <button
                          type="button"
                          onClick={() => toggleReviewer(r.name)}
                          aria-expanded={open}
                          data-testid="desk-report-reviewer-toggle"
                          data-desk-door
                          data-reviewer-name={r.name}
                          data-desk-row-label={r.name}
                          className="-mx-1 flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left transition-colors hover:bg-emerald-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:hover:bg-emerald-500/5"
                        >
                          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${deskReportAvatarHue(r.name)}`} aria-hidden="true">
                            {r.name.trim().charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{r.name}</span>
                          {r.clears > 0 ? (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                              <BadgeCheck className="h-2.5 w-2.5" aria-hidden /> {num(r.clears)} cleared
                            </span>
                          ) : null}
                          <span className="shrink-0 text-xs tabular-nums text-slate-600 dark:text-slate-300">{num(r.visits)} visit{r.visits === 1 ? '' : 's'}</span>
                          <span className="hidden shrink-0 text-xs tabular-nums text-slate-400 dark:text-slate-500 sm:inline">{r.branches} branch{r.branches === 1 ? '' : 'es'}</span>
                          <span className="hidden shrink-0 text-[10px] tabular-nums text-slate-400 dark:text-slate-500 md:inline">last {r.lastVisitAt ? timeAgo(r.lastVisitAt) : '—'}</span>
                          <ChevronDown
                            aria-hidden
                            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 dark:text-slate-500 ${open ? 'rotate-180' : ''}`}
                          />
                        </button>
                        {open ? (
                          <div
                            data-testid="desk-report-reviewer-panel"
                            className="mb-2 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 print:hidden dark:border-emerald-500/20 dark:bg-emerald-500/5"
                          >
                            <p className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">
                              <span>
                                {r.name} · {num(visits.length)} visit{visits.length === 1 ? '' : 's'} in this window
                              </span>
                              {viaReviewer && viaBackSubject ? (
                                <button
                                  type="button"
                                  onClick={jumpBackToRequest}
                                  data-testid="desk-report-reviewer-via"
                                  data-desk-door
                                  aria-label={`Back to ${viaBackSubject.employeeName}'s ${viaBackSubject.leaveTypeName} visits`}
                                  className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-1.5 py-px text-[9px] tracking-wide text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-emerald-500/40 dark:bg-slate-900/60 dark:text-emerald-300 dark:hover:bg-emerald-500/15"
                                >
                                  <CornerUpLeft className="h-2.5 w-2.5" aria-hidden />
                                  via {viaBackSubject.employeeName}&apos;s {viaBackSubject.leaveTypeName}
                                </button>
                              ) : null}
                            </p>
                            {visits.length === 0 ? (
                              <p data-testid="desk-report-reviewer-empty" className="py-1 text-xs text-slate-400 dark:text-slate-500">
                                No visits recorded for this reviewer in this window.
                              </p>
                            ) : (
                              <ul className="space-y-1" data-testid="desk-report-reviewer-visits">
                                {visits.map((v) => (
                                  <li
                                    key={v.id}
                                    data-testid="desk-report-reviewer-visit"
                                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-white/80 px-2 py-1.5 text-xs dark:bg-slate-900/60"
                                  >
                                    <span className="shrink-0 font-medium tabular-nums text-slate-600 dark:text-slate-300">
                                      {deskReportDayLabel(v.dayKey)} · {deskReportVisitTime(v.at)} EAT
                                    </span>
                                    <span className="shrink-0 text-slate-400 dark:text-slate-500" title={v.storeName}>
                                      {deskReportShortStoreName(v.storeName)}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                                      {deskReportHasRequestDoor(data.topRequests, v.requestId) ? (
                                        <button
                                          type="button"
                                          onClick={() => jumpToRequest(v.requestId, r.name)}
                                          data-testid="desk-report-reviewer-visit-request"
                                          data-desk-door
                                          aria-label={`Open ${v.employeeName}'s ${v.leaveTypeName} visits`}
                                          className="group -mx-0.5 inline-flex max-w-full items-center gap-0.5 rounded px-0.5 py-px text-emerald-700 underline decoration-emerald-300 decoration-dotted underline-offset-2 transition-colors hover:text-emerald-800 hover:decoration-emerald-500 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-300 dark:decoration-emerald-500/50 dark:hover:text-emerald-200"
                                        >
                                          <span className="min-w-0 truncate">
                                            <span className="font-semibold">{v.employeeName}</span>&apos;s {v.leaveTypeName}
                                          </span>
                                          <ArrowUpRight className="h-3 w-3 shrink-0 text-emerald-500 transition-transform duration-150 group-hover:-translate-y-px group-hover:translate-x-px dark:text-emerald-400" aria-hidden />
                                        </button>
                                      ) : (
                                        <>{v.employeeName}&apos;s {v.leaveTypeName}</>
                                      )}
                                    </span>
                                    {v.cleared ? (
                                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                                        <BadgeCheck className="h-2.5 w-2.5" aria-hidden /> recheck cleared
                                      </span>
                                    ) : null}
                                    <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium ${REPORT_STATUS_CHIP[v.status] ?? STATUS_CHIP_FALLBACK}`}>
                                      {v.status.toLowerCase()}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>

              {/* Most-visited requests — v2.72.0: every row is a door too.
                  Click it and the request's own visits for this same window
                  open beneath — the ledger answers WHICH days the desk came
                  to this file, WHO came, and what they answered. */}
              <section aria-label="Most visited requests" data-testid="desk-report-top-requests">
                <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <FileText className="h-3.5 w-3.5" aria-hidden /> Most-visited requests
                  <span className="hidden font-normal normal-case tracking-normal text-slate-400 sm:inline print:hidden dark:text-slate-500">
                    — click a request to read its visits · reviewer names inside a drawer jump across
                  </span>
                </h2>
                <ul className="space-y-1.5">
                  {data.topRequests.map((r) => {
                    const open = openRequest === r.requestId;
                    const visits = deskReportRequestLedger(data.ledger, r.requestId);
                    return (
                      <li key={r.requestId} data-testid="desk-report-request-row" className="px-1">
                        <button
                          type="button"
                          onClick={() => toggleRequest(r.requestId)}
                          aria-expanded={open}
                          data-testid="desk-report-request-toggle"
                          data-desk-door
                          data-request-id={r.requestId}
                          data-desk-row-label={`${r.employeeName}'s ${r.leaveTypeName}`}
                          className="-mx-1 flex w-full flex-wrap items-center gap-2 rounded-lg border border-transparent px-1 py-2 text-left transition-colors hover:bg-emerald-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:hover:bg-emerald-500/5"
                        >
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[9px] font-bold text-white dark:bg-emerald-500" aria-hidden="true">
                            {r.visits}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200">
                            <span className="font-semibold">{r.employeeName}</span>&apos;s {r.leaveTypeName}
                            {r.storeName ? <span className="text-slate-400 dark:text-slate-500"> · {r.storeName}</span> : null}
                          </span>
                          <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium ${REPORT_STATUS_CHIP[r.status] ?? STATUS_CHIP_FALLBACK}`}>
                            {r.status.toLowerCase()}
                          </span>
                          <ChevronDown
                            aria-hidden
                            className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 dark:text-slate-500 ${open ? 'rotate-180' : ''}`}
                          />
                        </button>
                        {open ? (
                          <div
                            data-testid="desk-report-request-panel"
                            className="mb-1.5 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2 print:hidden dark:border-emerald-500/20 dark:bg-emerald-500/5"
                          >
                            <p className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700/80 dark:text-emerald-300/80">
                              <span>
                                {r.employeeName}&apos;s {r.leaveTypeName} · {num(visits.length)} visit{visits.length === 1 ? '' : 's'} in this window
                              </span>
                              {viaRequest ? (
                                <button
                                  type="button"
                                  onClick={jumpBackToReviewer}
                                  data-testid="desk-report-request-via"
                                  data-desk-door
                                  aria-label={`Back to ${viaRequest}'s visits`}
                                  className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-white px-1.5 py-px text-[9px] tracking-wide text-emerald-700 transition-colors hover:border-emerald-400 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-emerald-500/40 dark:bg-slate-900/60 dark:text-emerald-300 dark:hover:bg-emerald-500/15"
                                >
                                  <CornerUpLeft className="h-2.5 w-2.5" aria-hidden />
                                  via {viaRequest}
                                </button>
                              ) : null}
                            </p>
                            {visits.length === 0 ? (
                              <p data-testid="desk-report-request-empty" className="py-1 text-xs text-slate-400 dark:text-slate-500">
                                No visits recorded for this request in this window.
                              </p>
                            ) : (
                              <ul className="space-y-1" data-testid="desk-report-request-visits">
                                {visits.map((v) => (
                                  <li
                                    key={v.id}
                                    data-testid="desk-report-request-visit"
                                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-white/80 px-2 py-1.5 text-xs dark:bg-slate-900/60"
                                  >
                                    <span className="shrink-0 font-medium tabular-nums text-slate-600 dark:text-slate-300">
                                      {deskReportDayLabel(v.dayKey)} · {deskReportVisitTime(v.at)} EAT
                                    </span>
                                    <span className="shrink-0 text-slate-400 dark:text-slate-500" title={v.storeName}>
                                      {deskReportShortStoreName(v.storeName)}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                                      visited by{' '}
                                      <button
                                        type="button"
                                        onClick={() => jumpToReviewer(v.reviewer, r.requestId)}
                                        data-testid="desk-report-request-visit-reviewer"
                                        data-desk-door
                                        aria-label={`Open ${v.reviewer}'s visits`}
                                        className="group -mx-0.5 inline-flex max-w-full items-center gap-1 rounded px-0.5 py-px font-semibold text-emerald-700 underline decoration-emerald-300 decoration-dotted underline-offset-2 transition-colors hover:text-emerald-800 hover:decoration-emerald-500 hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:text-emerald-300 dark:decoration-emerald-500/50 dark:hover:text-emerald-200"
                                      >
                                        <span className={`h-2 w-2 shrink-0 rounded-full ${deskReportAvatarHue(v.reviewer)}`} aria-hidden />
                                        <span className="min-w-0 truncate">{v.reviewer}</span>
                                        <ArrowUpRight className="h-3 w-3 shrink-0 text-emerald-500 transition-transform duration-150 group-hover:-translate-y-px group-hover:translate-x-px dark:text-emerald-400" aria-hidden />
                                      </button>
                                    </span>
                                    {v.cleared ? (
                                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[10px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                                        <BadgeCheck className="h-2.5 w-2.5" aria-hidden /> recheck cleared
                                      </span>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>

              <p data-testid="desk-report-footnote" className="text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
                Computed server-side from the leave review ledger over {data.window.label} ({data.scope.branchName ? 'branch scope' : 'org-wide scope'}) — the same ledger the Desk activity panel reads. The report is a read: printing or filing it never rings the bell.
                <span data-testid="desk-report-kbd-hint" className="mt-1.5 hidden items-center gap-1 sm:flex print:hidden">
                  Keyboard:
                  <kbd className="rounded border border-slate-200 bg-white px-1 font-mono text-[9px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">j</kbd>
                  /
                  <kbd className="rounded border border-slate-200 bg-white px-1 font-mono text-[9px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">k</kbd>
                  walk the doors ·
                  <kbd className="rounded border border-slate-200 bg-white px-1 font-mono text-[9px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">esc</kbd>
                  closes a drawer ·
                  <kbd className="rounded border border-slate-200 bg-white px-1 font-mono text-[9px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">←</kbd>
                  <kbd className="rounded border border-slate-200 bg-white px-1 font-mono text-[9px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">→</kbd>
                  move the chips,
                  <kbd className="rounded border border-slate-200 bg-white px-1 font-mono text-[9px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">enter</kbd>
                  re-keys the report
                </span>
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
