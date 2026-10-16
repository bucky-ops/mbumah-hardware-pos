'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Eye, EyeOff, FilePlus2 } from 'lucide-react';

interface EmployeeDetail {
  id: string;
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  role: string;
  employmentType: string;
  status: string;
  hireDate: string;
  basicSalary?: number;
  houseAllowance?: number;
  transportAllowance?: number;
  medicalAllowance?: number;
  otherAllowances?: number;
  bankName?: string | null;
  nationalId?: string;
  kraPin?: string;
  nssfNumber?: string;
  nhifNumber?: string;
}

interface DocumentDto {
  id: string;
  type: string;
  fileName: string;
  expiryDate?: string | null;
  verificationStatus: string;
}

const fmtKes = (n: number | undefined) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(n)
    : '-';

export default function EmployeeDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [employee, setEmployee] = useState<EmployeeDetail | null>(null);
  const [documents, setDocuments] = useState<DocumentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unmasked, setUnmasked] = useState(false);
  const [loadingUnmask, setLoadingUnmask] = useState(false);

  const load = useCallback(
    async (withUnmask: boolean) => {
      setError(null);
      try {
        const res = await fetch(`/api/hr/employees/${id}${withUnmask ? '?unmask=1' : ''}`, {
          credentials: 'include',
        });
        const body = (await res.json()) as { success: boolean; data?: EmployeeDetail; error?: string };
        if (!res.ok || !body.success || !body.data) {
          setError(body.error || `Load failed (${res.status}).`);
          return;
        }
        setEmployee(body.data);
        setUnmasked(withUnmask);
      } catch {
        setError('Employee detail is unreachable.');
      }
    },
    [id],
  );

  useEffect(() => {
    if (id) void load(false);
  }, [id, load]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/hr/employees/${id}/documents`, { credentials: 'include' });
        const body = (await res.json()) as { success: boolean; data?: DocumentDto[] };
        if (!cancelled && body.success) setDocuments(body.data ?? []);
      } catch {
        if (!cancelled) setDocuments([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function toggleUnmask() {
    setLoadingUnmask(true);
    try {
      await load(!unmasked);
    } finally {
      setLoadingUnmask(false);
    }
  }

  if (error) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (!employee) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    );
  }

  const piiRows: Array<[string, string | undefined]> = [
    ['National ID', employee.nationalId],
    ['KRA PIN', employee.kraPin],
    ['NSSF number', employee.nssfNumber],
    ['NHIF/SHIF number', employee.nhifNumber],
  ];

  const payRows: Array<[string, number | undefined]> = [
    ['Basic salary', employee.basicSalary],
    ['House allowance', employee.houseAllowance],
    ['Transport allowance', employee.transportAllowance],
    ['Medical allowance', employee.medicalAllowance],
    ['Other allowances', employee.otherAllowances],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {employee.firstName} {employee.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            {employee.jobTitle ?? 'No job title'} · {employee.employmentType} · Code {employee.employeeCode ?? '-'} ·
            Hired {new Date(employee.hireDate).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={employee.status === 'ACTIVE' ? 'default' : 'outline'}>{employee.status}</Badge>
          <Button variant={unmasked ? 'secondary' : 'outline'} size="sm" onClick={toggleUnmask} disabled={loadingUnmask}>
            {unmasked ? <EyeOff className="mr-1.5 h-4 w-4" aria-hidden /> : <Eye className="mr-1.5 h-4 w-4" aria-hidden />}
            {loadingUnmask ? 'Working...' : unmasked ? 'Re-mask PII' : 'Unmask PII'}
          </Button>
        </div>
      </div>

      {unmasked ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Statutory identifiers are unmasked for this view. The read was recorded in the audit trail.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Statutory identifiers</CardTitle>
            <CardDescription>Masked by default. Unmasking is permission-gated and audit logged.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {piiRows.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-mono text-xs">
                    {value ? (unmasked ? value : '[REDACTED]') : 'Not on file'}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pay (current record)</CardTitle>
            <CardDescription>Amounts are the live employee record; versioned structures arrive with payroll.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              {payRows.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium tabular-nums">{fmtKes(value)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Documents</CardTitle>
            <CardDescription>Contracts, statutory cards, and certificates with expiry tracking.</CardDescription>
          </div>
          <FilePlus2 className="h-4 w-4 text-muted-foreground" aria-hidden />
        </CardHeader>
        <CardContent>
          {documents === null ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents registered yet.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {d.type}
                      {d.expiryDate ? ` · expires ${new Date(d.expiryDate).toLocaleDateString()}` : ' · no expiry'}
                    </p>
                  </div>
                  <Badge
                    variant={d.verificationStatus === 'VERIFIED' ? 'default' : d.verificationStatus === 'REJECTED' ? 'destructive' : 'secondary'}
                    className="shrink-0 text-[10px]"
                  >
                    {d.verificationStatus}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
