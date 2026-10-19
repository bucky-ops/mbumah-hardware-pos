'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  actionsForStatus,
  canCloseJob,
  formatOfferKes,
  interviewActions,
  isTerminalCandidate,
  offerChipLabel,
  PIPELINE_STAGES,
  REJECTION_RETENTION_DAYS,
  STAGE_OUTCOMES,
  stageBadgeTone,
  type RecruitmentAction,
  type StageTone,
} from '@/lib/hr/recruitment-policy';
import { Briefcase, Eye, UserPlus } from 'lucide-react';

interface Job {
  id: string;
  title: string;
  description: string | null;
  status: string;
  openings: number;
  openedAt: string | null;
  closedAt: string | null;
  _count?: { applicants: number };
}

interface Applicant {
  id: string;
  fullName: string;
  email: string;
  status: string;
  job?: { title: string };
  stages?: Array<{ stage: string; outcome: string }>;
  offers?: Array<{ id: string; status: string; proposedSalaryCents: number; sentAt: string | null; createdAt: string }>;
}

const TONE_CLASS: Record<StageTone, string> = {
  neutral: '',
  progress: 'border-sky-200 bg-sky-100 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300',
  offer: 'border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300',
  hired: 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300',
  rejected: 'border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300',
  withdrawn: 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-500/30 dark:bg-slate-500/15 dark:text-slate-300',
};

export default function HrRecruitmentPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [applicants, setApplicants] = useState<Applicant[] | null>(null);
  const [canWrite, setCanWrite] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [jobForm, setJobForm] = useState({ title: '', description: '', openings: 1 });
  const [applicantForm, setApplicantForm] = useState({ jobId: '', fullName: '', email: '', consent: false });
  const [busy, setBusy] = useState(false);
  const [rejectArm, setRejectArm] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [withdrawArm, setWithdrawArm] = useState<string | null>(null);
  const [withdrawNote, setWithdrawNote] = useState('');
  const [offerArm, setOfferArm] = useState<string | null>(null);
  const [offerForm, setOfferForm] = useState({ salary: '', startDate: '' });
  const [closeArm, setCloseArm] = useState<string | null>(null);
  const [stageArm, setStageArm] = useState<string | null>(null);
  const [stageForm, setStageForm] = useState<{ stage: string; outcome: string; notes: string }>({ stage: 'SCREENING', outcome: 'PENDING', notes: '' });

  const load = useCallback(async () => {
    try {
      const [jRes, aRes] = await Promise.all([
        fetch('/api/recruitment/jobs', { credentials: 'include' }),
        fetch('/api/recruitment/applicants', { credentials: 'include' }),
      ]);
      const j = (await jRes.json().catch(() => ({}))) as { data?: Job[]; canWrite?: boolean };
      const a = (await aRes.json().catch(() => ({}))) as { data?: Applicant[] };
      if (!jRes.ok || !aRes.ok) {
        setError('Recruitment data requires HR permissions. Sign in with an HR or owner account.');
        setJobs([]);
        setApplicants([]);
        setCanWrite(false);
        return;
      }
      setJobs(j.data ?? []);
      setApplicants(a.data ?? []);
      setCanWrite(j.canWrite === true);
    } catch {
      setError('Recruitment workspace is unreachable.');
      setJobs([]);
      setApplicants([]);
      setCanWrite(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(url: string, body: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST'): Promise<boolean> {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { success: boolean; error?: string; data?: { retentionUntil?: string } };
      if (!res.ok || !json.success) {
        setError(json.error || `Action failed (${res.status}).`);
        return false;
      }
      await load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  function disarmAll() {
    setRejectArm(null);
    setWithdrawArm(null);
    setOfferArm(null);
    setCloseArm(null);
    setStageArm(null);
    setRejectReason('');
    setWithdrawNote('');
    setOfferForm({ salary: '', startDate: '' });
    setStageForm({ stage: 'SCREENING', outcome: 'PENDING', notes: '' });
  }

  const openJobs = (jobs ?? []).filter((j) => j.status === 'OPEN').length;
  const inPipeline = (applicants ?? []).filter((a) => !isTerminalCandidate(a.status)).length;
  const hired = (applicants ?? []).filter((a) => a.status === 'HIRED').length;
  const writer = canWrite === true;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recruitment</h1>
        <p className="text-sm text-muted-foreground">
          Open jobs, applicant pipeline, and offers. Consent is captured before any personal data is stored.
        </p>
        <div data-testid="hr-recruitment-counts" className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>{jobs === null ? <Skeleton className="inline-block h-4 w-16" /> : `${openJobs} open job${openJobs === 1 ? '' : 's'}`}</span>
          <span aria-hidden>·</span>
          <span>{applicants === null ? <Skeleton className="inline-block h-4 w-16" /> : `${inPipeline} in pipeline`}</span>
          <span aria-hidden>·</span>
          <span>{applicants === null ? <Skeleton className="inline-block h-4 w-16" /> : `${hired} hired`}</span>
        </div>
      </div>

      {note ? (
        <p role="status" data-testid="hr-recruitment-note" className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
          {note}
        </p>
      ) : null}

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      {canWrite === false ? (
        <Card data-testid="hr-recruitment-readonly" className="border-sky-200 bg-sky-50/60 dark:border-sky-500/30 dark:bg-sky-500/10">
          <CardContent className="flex items-start gap-2 py-4 text-sm text-sky-800 dark:text-sky-200">
            <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Read access — you can follow the pipeline, but only HR managers and the store owner open
              jobs, move candidates, and hire.
            </span>
          </CardContent>
        </Card>
      ) : null}

      {writer ? (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm">
              <span className="mb-1 block font-medium">New job title</span>
              <Input
                data-testid="hr-recruitment-job-title"
                value={jobForm.title}
                onChange={(e) => setJobForm({ ...jobForm, title: e.target.value })}
                placeholder="e.g. Branch Cashier"
              />
            </label>
            <label className="flex-1 text-sm">
              <span className="mb-1 block font-medium">Description (optional)</span>
              <Input
                data-testid="hr-recruitment-job-description"
                value={jobForm.description}
                onChange={(e) => setJobForm({ ...jobForm, description: e.target.value })}
                placeholder="Duties, shift, pay range — shown to reviewers"
              />
            </label>
            <label className="w-24 text-sm">
              <span className="mb-1 block font-medium">Openings</span>
              <Input
                data-testid="hr-recruitment-job-openings"
                type="number"
                min={1}
                value={jobForm.openings}
                onChange={(e) => setJobForm({ ...jobForm, openings: Number(e.target.value) || 1 })}
              />
            </label>
            <Button
              data-testid="hr-recruitment-job-open-btn"
              disabled={busy || !jobForm.title}
              onClick={async () => {
                if (await post('/api/recruitment/jobs', {
                  title: jobForm.title,
                  openings: jobForm.openings,
                  description: jobForm.description || undefined,
                })) {
                  setJobForm({ title: '', description: '', openings: 1 });
                  setNote('Job opened — it now accepts applicants.');
                }
              }}
            >
              <Briefcase className="mr-1.5 h-4 w-4" aria-hidden /> Open job
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className={writer ? 'grid gap-4 lg:grid-cols-2' : ''}>
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="border-b px-4 py-3 text-sm font-semibold">Open jobs</div>
            {jobs === null ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : jobs.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground" data-testid="hr-recruitment-jobs-empty">
                {writer
                  ? 'No jobs yet — hiring starts with a job. Open one above.'
                  : 'No jobs yet — hiring starts with a job, opened by an HR manager or the owner.'}
              </p>
            ) : (
              <ul className="max-h-64 divide-y overflow-y-auto">
                {jobs.map((j) => (
                  <li key={j.id} data-testid={`hr-recruitment-job-${j.id}`} className="group px-4 py-2.5 text-sm transition-colors hover:bg-accent/40">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{j.title}</p>
                        {j.description ? (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{j.description}</p>
                        ) : null}
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {j.openings} opening{j.openings === 1 ? '' : 's'} · {j._count?.applicants ?? 0} applicant{j._count?.applicants === 1 ? '' : 's'}
                          {j.openedAt ? ` · opened ${j.openedAt.slice(0, 10)}` : ''}
                          {j.status === 'CLOSED' && j.closedAt ? ` · closed ${j.closedAt.slice(0, 10)}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Badge variant={j.status === 'OPEN' ? 'default' : 'secondary'} className="text-[10px]">
                          {j.status}
                        </Badge>
                        {writer && canCloseJob(j.status) ? (
                          closeArm === j.id ? (
                            <span className="flex items-center gap-1" data-testid={`hr-recruitment-close-arm-${j.id}`}>
                              <span className="text-xs text-amber-700 dark:text-amber-300">Close to new applicants?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 px-2 text-xs"
                                disabled={busy}
                                onClick={async () => {
                                  if (await post(`/api/recruitment/jobs/${j.id}/close`, {})) {
                                    disarmAll();
                                    setNote(`"${j.title}" closed — it no longer accepts applicants.`);
                                  }
                                }}
                              >
                                Confirm
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={disarmAll}>
                                Cancel
                              </Button>
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-muted-foreground opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 hover:text-foreground"
                              data-testid={`hr-recruitment-close-${j.id}`}
                              disabled={busy}
                              onClick={() => {
                                disarmAll();
                                setCloseArm(j.id);
                              }}
                            >
                              Close…
                            </Button>
                          )
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {writer ? (
          <Card>
            <CardContent className="pt-6">
              <p className="mb-3 text-sm font-semibold">Register applicant</p>
              <div className="grid gap-3">
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Job</span>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                    value={applicantForm.jobId}
                    onChange={(e) => setApplicantForm({ ...applicantForm, jobId: e.target.value })}
                    aria-label="Job"
                    data-testid="hr-recruitment-app-job"
                  >
                    <option value="">Select a job</option>
                    {(jobs ?? []).filter((j) => j.status === 'OPEN').map((j) => (
                      <option key={j.id} value={j.id}>{j.title}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">
                    <span className="mb-1 block font-medium">Full name</span>
                    <Input data-testid="hr-recruitment-app-name" value={applicantForm.fullName} onChange={(e) => setApplicantForm({ ...applicantForm, fullName: e.target.value })} />
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium">Email</span>
                    <Input data-testid="hr-recruitment-app-email" type="email" value={applicantForm.email} onChange={(e) => setApplicantForm({ ...applicantForm, email: e.target.value })} />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={applicantForm.consent}
                    onChange={(e) => setApplicantForm({ ...applicantForm, consent: e.target.checked })}
                    className="h-4 w-4"
                    aria-label="Applicant consent granted"
                    data-testid="hr-recruitment-app-consent"
                  />
                  Applicant consent captured (required; recorded with policy version and purpose)
                </label>
                <Button
                  data-testid="hr-recruitment-app-register"
                  disabled={busy || !applicantForm.jobId || !applicantForm.fullName || !applicantForm.email || !applicantForm.consent}
                  onClick={async () => {
                    if (await post('/api/recruitment/applicants', { ...applicantForm, consentGranted: applicantForm.consent })) {
                      setApplicantForm({ jobId: '', fullName: '', email: '', consent: false });
                      setNote('Applicant registered with consent — they join the pipeline as NEW.');
                    }
                  }}
                >
                  <UserPlus className="mr-1.5 h-4 w-4" aria-hidden /> Register
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="border-b px-4 py-3 text-sm font-semibold">Applicant pipeline</div>
          {applicants === null ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : applicants.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground" data-testid="hr-recruitment-pipeline-empty">
              {writer
                ? 'No candidates yet. Register an applicant against an open job to start the pipeline.'
                : 'No candidates yet. An HR manager or the owner registers applicants against open jobs.'}
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Applicant</th>
                    <th className="px-4 py-2.5 font-medium">Job</th>
                    <th className="px-4 py-2.5 font-medium">Stage</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {applicants.map((a) => {
                    const actions: readonly RecruitmentAction[] =
                      a.status === 'INTERVIEW' ? interviewActions(a.offers?.[0]?.status === 'DRAFT') : actionsForStatus(a.status);
                    const chip = offerChipLabel(a.offers?.[0]);
                    return (
                      <tr
                        key={a.id}
                        data-testid={`hr-recruitment-row-${a.id}`}
                        className={`transition-colors hover:bg-accent/40 ${a.status === 'WITHDRAWN' ? 'bg-slate-50/60 dark:bg-slate-500/5' : ''}`}
                      >
                        <td className="px-4 py-2.5">
                          <p className={`font-medium ${a.status === 'WITHDRAWN' ? 'text-muted-foreground' : ''}`}>{a.fullName}</p>
                          <p className="text-xs text-muted-foreground">{a.email}</p>
                          {a.status === 'WITHDRAWN' ? (
                            <p className="mt-0.5 text-xs italic text-muted-foreground" data-testid={`hr-recruitment-withdrawn-note-${a.id}`}>
                              Candidate withdrew from the process
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5">{a.job?.title ?? '-'}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className={`text-[10px] ${TONE_CLASS[stageBadgeTone(a.status)]}`}>
                            {a.status}
                          </Badge>
                          {chip ? (
                            <p data-testid={`hr-recruitment-offer-chip-${a.id}`} className="mt-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                              {chip} · {formatOfferKes(a.offers?.[0]?.proposedSalaryCents)}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {writer && actions.includes('interview') ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                data-testid={`hr-recruitment-stage-${a.id}`}
                                onClick={() => {
                                  disarmAll();
                                  setStageArm(a.id);
                                }}
                              >
                                Record stage…
                              </Button>
                            ) : null}
                            {writer && actions.includes('offer') ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                data-testid={`hr-recruitment-offer-${a.id}`}
                                onClick={() => {
                                  disarmAll();
                                  setOfferArm(a.id);
                                }}
                              >
                                Draft offer…
                              </Button>
                            ) : null}
                            {writer && actions.includes('approve') ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busy}
                                className="border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10"
                                data-testid={`hr-recruitment-approve-${a.id}`}
                                onClick={async () => {
                                  const draftId = a.offers?.[0]?.id;
                                  if (!draftId) {
                                    setError('No pending offer to approve — draft one first.');
                                    return;
                                  }
                                  if (await post(`/api/recruitment/applicants/${a.id}/offer?offerId=${draftId}`, {}, 'PATCH')) {
                                    setNote(`Offer approved and sent to ${a.fullName} — the desk can hire when they accept.`);
                                  }
                                }}
                              >
                                Approve &amp; send
                              </Button>
                            ) : null}
                            {writer && actions.includes('hire') ? (
                              <Button
                                size="sm"
                                disabled={busy}
                                data-testid={`hr-recruitment-hire-${a.id}`}
                                onClick={async () => {
                                  if (await post(`/api/recruitment/applicants/${a.id}/convert`, { employmentType: 'PROBATION' })) {
                                    setNote(`${a.fullName} hired — employee record and onboarding plan created.`);
                                  }
                                }}
                              >
                                Hire
                              </Button>
                            ) : null}
                            {writer && actions.includes('reject') ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300"
                                data-testid={`hr-recruitment-reject-${a.id}`}
                                onClick={() => {
                                  disarmAll();
                                  setRejectArm(a.id);
                                }}
                              >
                                Reject…
                              </Button>
                            ) : null}
                            {writer && actions.includes('withdraw') ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                className="text-violet-600 hover:bg-violet-50 hover:text-violet-700 dark:text-violet-400 dark:hover:bg-violet-500/10 dark:hover:text-violet-300"
                                data-testid={`hr-recruitment-withdraw-${a.id}`}
                                onClick={() => {
                                  disarmAll();
                                  setWithdrawArm(a.id);
                                }}
                              >
                                Withdraw…
                              </Button>
                            ) : null}
                            {isTerminalCandidate(a.status) ? (
                              <span className="text-xs text-muted-foreground" aria-hidden>—</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {applicants.map((a) => {
                    if (offerArm !== a.id) return null;
                    return (
                      <tr key={`${a.id}-offer`} className="bg-amber-50/70 dark:bg-amber-500/10">
                        <td colSpan={4} className="px-4 py-3">
                          <div data-testid={`hr-recruitment-offer-arm-${a.id}`} className="flex flex-col gap-2 lg:flex-row lg:items-center">
                            <p className="flex-1 text-sm text-amber-800 dark:text-amber-200">
                              Offer for <strong>{a.fullName}</strong> — set the real terms; the desk never
                              invents them.
                            </p>
                            <label className="text-xs">
                              <span className="mb-1 block font-medium text-amber-800 dark:text-amber-200">Monthly salary (KES)</span>
                              <Input
                                data-testid="hr-recruitment-offer-salary"
                                type="number"
                                min={1}
                                step={1}
                                value={offerForm.salary}
                                onChange={(e) => setOfferForm({ ...offerForm, salary: e.target.value })}
                                className="h-8 w-40"
                                placeholder="e.g. 30000"
                              />
                            </label>
                            <label className="text-xs">
                              <span className="mb-1 block font-medium text-amber-800 dark:text-amber-200">Start date</span>
                              <Input
                                data-testid="hr-recruitment-offer-date"
                                type="date"
                                value={offerForm.startDate}
                                min={new Date().toISOString().slice(0, 10)}
                                onChange={(e) => setOfferForm({ ...offerForm, startDate: e.target.value })}
                                className="h-8 w-40"
                              />
                            </label>
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                disabled={busy || !offerForm.salary || !offerForm.startDate}
                                data-testid="hr-recruitment-offer-confirm"
                                onClick={async () => {
                                  const cents = Math.round(Number(offerForm.salary) * 100);
                                  if (!Number.isFinite(cents) || cents <= 0) {
                                    setError('Offer salary must be a positive amount in KES.');
                                    return;
                                  }
                                  if (await post(`/api/recruitment/applicants/${a.id}/offer`, {
                                    proposedSalaryCents: cents,
                                    startDate: new Date(`${offerForm.startDate}T09:00:00`).toISOString(),
                                  })) {
                                    disarmAll();
                                    setNote(`Offer drafted for ${a.fullName} — approval required before it sends.`);
                                  }
                                }}
                              >
                                Confirm offer
                              </Button>
                              <Button size="sm" variant="ghost" data-testid="hr-recruitment-offer-cancel" onClick={disarmAll}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {applicants.map((a) => {
                    if (stageArm !== a.id) return null;
                    return (
                      <tr key={`${a.id}-stage`} className="bg-sky-50/70 dark:bg-sky-500/10">
                        <td colSpan={4} className="px-4 py-3">
                          <div data-testid={`hr-recruitment-stage-arm-${a.id}`} className="flex flex-col gap-2 lg:flex-row lg:items-end">
                            <p className="flex-1 text-sm text-sky-800 dark:text-sky-200">
                              Record a stage for <strong>{a.fullName}</strong> — the desk writes the step
                              and its outcome, it never skips ahead for you.
                            </p>
                            <label className="text-xs">
                              <span className="mb-1 block font-medium text-sky-800 dark:text-sky-200">Stage</span>
                              <select
                                data-testid="hr-recruitment-stage-select"
                                className="h-8 w-40 rounded-md border border-input bg-transparent px-2 text-xs"
                                value={stageForm.stage}
                                onChange={(e) => setStageForm({ ...stageForm, stage: e.target.value })}
                                aria-label="Stage"
                              >
                                {PIPELINE_STAGES.map((s) => (
                                  <option key={s} value={s}>{s}</option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs">
                              <span className="mb-1 block font-medium text-sky-800 dark:text-sky-200">Outcome</span>
                              <select
                                data-testid="hr-recruitment-outcome-select"
                                className="h-8 w-32 rounded-md border border-input bg-transparent px-2 text-xs"
                                value={stageForm.outcome}
                                onChange={(e) => setStageForm({ ...stageForm, outcome: e.target.value })}
                                aria-label="Outcome"
                              >
                                {STAGE_OUTCOMES.map((o) => (
                                  <option key={o} value={o}>{o}</option>
                                ))}
                              </select>
                            </label>
                            <label className="text-xs">
                              <span className="mb-1 block font-medium text-sky-800 dark:text-sky-200">Notes (optional)</span>
                              <Input
                                data-testid="hr-recruitment-stage-notes"
                                value={stageForm.notes}
                                onChange={(e) => setStageForm({ ...stageForm, notes: e.target.value })}
                                className="h-8 w-full lg:w-56"
                                placeholder="What the step showed"
                              />
                            </label>
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                disabled={busy}
                                data-testid="hr-recruitment-stage-confirm"
                                onClick={async () => {
                                  if (await post(`/api/recruitment/applicants/${a.id}/stage`, {
                                    stage: stageForm.stage,
                                    outcome: stageForm.outcome,
                                    notes: stageForm.notes.trim() || undefined,
                                  })) {
                                    disarmAll();
                                    setNote(`${stageForm.stage} recorded — ${stageForm.outcome} for ${a.fullName}.`);
                                  }
                                }}
                              >
                                Confirm stage
                              </Button>
                              <Button size="sm" variant="ghost" data-testid="hr-recruitment-stage-cancel" onClick={disarmAll}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {applicants.map((a) => {
                    if (rejectArm !== a.id) return null;
                    return (
                      <tr key={`${a.id}-reject`} className="bg-rose-50/70 dark:bg-rose-500/10">
                        <td colSpan={4} className="px-4 py-3">
                          <div data-testid={`hr-recruitment-reject-arm-${a.id}`} className="flex flex-col gap-2 lg:flex-row lg:items-center">
                            <p className="flex-1 text-sm text-rose-700 dark:text-rose-300">
                              Reject <strong>{a.fullName}</strong>? Their data is kept {REJECTION_RETENTION_DAYS} days,
                              then the retention window anonymises it.
                            </p>
                            <Input
                              data-testid="hr-recruitment-reject-reason"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              className="h-8 w-full lg:w-64"
                              placeholder="Reason (rides the audit log)"
                              aria-label="Rejection reason"
                            />
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={busy || !rejectReason.trim()}
                                data-testid="hr-recruitment-reject-confirm"
                                onClick={async () => {
                                  if (await post(`/api/recruitment/applicants/${a.id}/reject`, { reason: rejectReason.trim() })) {
                                    disarmAll();
                                    setNote(`${a.fullName} rejected — data kept ${REJECTION_RETENTION_DAYS} days, then anonymised.`);
                                  }
                                }}
                              >
                                Confirm reject
                              </Button>
                              <Button size="sm" variant="ghost" data-testid="hr-recruitment-reject-cancel" onClick={disarmAll}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {applicants.map((a) => {
                    if (withdrawArm !== a.id) return null;
                    return (
                      <tr key={`${a.id}-withdraw`} className="bg-violet-50/70 dark:bg-violet-500/10">
                        <td colSpan={4} className="px-4 py-3">
                          <div data-testid={`hr-recruitment-withdraw-arm-${a.id}`} className="flex flex-col gap-2 lg:flex-row lg:items-center">
                            <p className="flex-1 text-sm text-violet-800 dark:text-violet-200">
                              Withdraw <strong>{a.fullName}</strong>? This records the candidate&apos;s own exit —
                              their data is kept {REJECTION_RETENTION_DAYS} days, then anonymised, the same
                              clock a rejection starts.
                            </p>
                            <Input
                              data-testid="hr-recruitment-withdraw-note"
                              value={withdrawNote}
                              onChange={(e) => setWithdrawNote(e.target.value)}
                              className="h-8 w-full lg:w-64"
                              placeholder="Note (optional — rides the audit log)"
                              aria-label="Withdrawal note"
                            />
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                disabled={busy}
                                className="bg-violet-600 text-white hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600"
                                data-testid="hr-recruitment-withdraw-confirm"
                                onClick={async () => {
                                  if (await post(`/api/recruitment/applicants/${a.id}/withdraw`, { note: withdrawNote.trim() || undefined })) {
                                    disarmAll();
                                    setNote(`${a.fullName} withdrew from the pipeline — data kept ${REJECTION_RETENTION_DAYS} days, then anonymised.`);
                                  }
                                }}
                              >
                                Confirm withdraw
                              </Button>
                              <Button size="sm" variant="ghost" data-testid="hr-recruitment-withdraw-cancel" onClick={disarmAll}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
