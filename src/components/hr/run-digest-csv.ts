'use client';

// v2.53.0: shared client download for the on-demand run digest CSV.
// Used by BOTH the Pay Runs desk row button and the run dialog's filing row,
// so the two entry points behave identically (server filename honoured,
// honest size label, structured error message).

import { formatCsvSize } from '@/lib/hr/digest-csv';

export interface RunDigestDownload {
  filename: string;
  sizeLabel: string;
}

export async function downloadRunDigestCsv(runId: string): Promise<RunDigestDownload> {
  const res = await fetch(`/api/payroll/runs/${runId}/digest-csv`, { credentials: 'include' });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `Export failed (${res.status}).`);
  }
  const blob = await res.blob();
  const match = (res.headers.get('Content-Disposition') ?? '').match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? res.headers.get('X-Digest-Csv-Filename') ?? `mbumah-payroll-run-${runId}.csv`;
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
