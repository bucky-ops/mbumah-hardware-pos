'use client';

// v2.83.0: shared client download for the payslip bundle — one zip, every
// payslip in a run. Sits beside downloadRunDigestCsv in the run dialog's
// filing row, so the two filing downloads behave identically (server
// filename honoured, honest size label, structured error message).

import { formatCsvSize } from '@/lib/hr/digest-csv';

export interface PayrollBundleDownload {
  filename: string;
  sizeLabel: string;
}

export async function downloadPayrollBundle(runId: string): Promise<PayrollBundleDownload> {
  const res = await fetch(`/api/payroll/runs/${runId}/payslips-bundle`, { credentials: 'include' });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `Bundle export failed (${res.status}).`);
  }
  const blob = await res.blob();
  const match = (res.headers.get('Content-Disposition') ?? '').match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? res.headers.get('X-Payroll-Bundle-Filename') ?? `mbumah-payslips-${runId}.zip`;
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
  return { filename, sizeLabel: formatCsvSize(blob.size) };
}
