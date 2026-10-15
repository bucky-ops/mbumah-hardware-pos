'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Briefcase, UserPlus } from 'lucide-react';

interface Job {
  id: string;
  title: string;
  status: string;
  openings: number;
  _count?: { applicants: number };
}

interface Applicant {
  id: string;
  fullName: string;
  email: string;
  status: string;
  job?: { title: string };
  stages?: Array<{ stage: string; outcome: string }>;
}

export default function HrRecruitmentPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [applicants, setApplicants] = useState<Applicant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobForm, setJobForm] = useState({ title: '', openings: 1 });
  const [applicantForm, setApplicantForm] = useState({ jobId: '', fullName: '', email: '', consent: false });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [jRes, aRes] = await Promise.all([
        fetch('/api/recruitment/jobs', { credentials: 'include' }),
        fetch('/api/recruitment/applicants', { credentials: 'include' }),
      ]);
      const j = (await jRes.json().catch(() => ({ data: [] }))) as { data?: Job[] };
      const a = (await aRes.json().catch(() => ({ data: [] }))) as { data?: Applicant[] };
      if (!jRes.ok || !aRes.ok) {
        setError('Recruitment data requires HR permissions. Sign in with an HR or owner account.');
        setJobs([]);
        setApplicants([]);
        return;
      }
      setJobs(j.data ?? []);
      setApplicants(a.data ?? []);
    } catch {
      setError('Recruitment workspace is unreachable.');
      setJobs([]);
      setApplicants([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(url: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { success: boolean; error?: string };
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recruitment</h1>
        <p className="text-sm text-muted-foreground">
          Open jobs, applicant pipeline, and offers. Consent is captured before any personal data is stored.
        </p>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm">
            <span className="mb-1 block font-medium">New job title</span>
            <Input value={jobForm.title} onChange={(e) => setJobForm({ ...jobForm, title: e.target.value })} placeholder="e.g. Branch Cashier" />
          </label>
          <label className="w-24 text-sm">
            <span className="mb-1 block font-medium">Openings</span>
            <Input type="number" min={1} value={jobForm.openings} onChange={(e) => setJobForm({ ...jobForm, openings: Number(e.target.value) || 1 })} />
          </label>
          <Button
            disabled={busy || !jobForm.title}
            onClick={async () => {
              if (await post('/api/recruitment/jobs', jobForm)) setJobForm({ title: '', openings: 1 });
            }}
          >
            <Briefcase className="mr-1.5 h-4 w-4" aria-hidden /> Open job
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="border-b px-4 py-3 text-sm font-semibold">Open jobs</div>
            {jobs === null ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
              </div>
            ) : jobs.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No jobs yet.</p>
            ) : (
              <ul className="max-h-64 divide-y overflow-y-auto">
                {jobs.map((j) => (
                  <li key={j.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div>
                      <p className="font-medium">{j.title}</p>
                      <p className="text-xs text-muted-foreground">{j.openings} opening(s) · {j._count?.applicants ?? 0} applicant(s)</p>
                    </div>
                    <Badge variant={j.status === 'OPEN' ? 'default' : 'secondary'} className="text-[10px]">{j.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

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
                  <Input value={applicantForm.fullName} onChange={(e) => setApplicantForm({ ...applicantForm, fullName: e.target.value })} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block font-medium">Email</span>
                  <Input type="email" value={applicantForm.email} onChange={(e) => setApplicantForm({ ...applicantForm, email: e.target.value })} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={applicantForm.consent}
                  onChange={(e) => setApplicantForm({ ...applicantForm, consent: e.target.checked })}
                  className="h-4 w-4"
                  aria-label="Applicant consent granted"
                />
                Applicant consent captured (required; recorded with policy version and purpose)
              </label>
              <Button
                disabled={busy || !applicantForm.jobId || !applicantForm.fullName || !applicantForm.email || !applicantForm.consent}
                onClick={async () => {
                  if (await post('/api/recruitment/applicants', { ...applicantForm, consentGranted: applicantForm.consent })) {
                    setApplicantForm({ jobId: '', fullName: '', email: '', consent: false });
                  }
                }}
              >
                <UserPlus className="mr-1.5 h-4 w-4" aria-hidden /> Register
              </Button>
            </div>
          </CardContent>
        </Card>
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
            <p className="p-4 text-sm text-muted-foreground">No applicants yet.</p>
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
                  {applicants.map((a) => (
                    <tr key={a.id} className="transition-colors hover:bg-accent/40">
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{a.fullName}</p>
                        <p className="text-xs text-muted-foreground">{a.email}</p>
                      </td>
                      <td className="px-4 py-2.5">{a.job?.title ?? '-'}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={a.status === 'HIRED' ? 'default' : a.status === 'REJECTED' ? 'destructive' : 'outline'} className="text-[10px]">
                          {a.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {a.status === 'NEW' || a.status === 'SCREENING' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => void post(`/api/recruitment/applicants/${a.id}/stage`, { stage: 'INTERVIEW_ONE', outcome: 'PASS' })}
                            >
                              To interview
                            </Button>
                          ) : null}
                          {a.status === 'INTERVIEW' ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void post(`/api/recruitment/applicants/${a.id}/offer`, {
                                  proposedSalaryCents: 3_000_000,
                                  startDate: new Date(Date.now() + 7 * 86400000).toISOString(),
                                })
                              }
                            >
                              Draft offer
                            </Button>
                          ) : null}
                          {a.status === 'OFFER' ? (
                            <Button size="sm" disabled={busy} onClick={() => void post(`/api/recruitment/applicants/${a.id}/convert`, { employmentType: 'PROBATION' })}>
                              Hire
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
