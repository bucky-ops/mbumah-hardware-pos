'use client';

// MBUMAH HARDWARE POS - /employees/me/documents (v2.19.0)
// Own document metadata (type, verification status, expiry). Notes are
// HR-only and never rendered here; files download only through the
// permission-gated HR document route.

import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, TriangleAlert } from 'lucide-react';
import { apiGet, EmptyState, ErrorNote, StatusBadge, formatDate } from '@/components/hr/self-service-ui';

interface DocumentDto {
  id: string;
  type: string;
  fileName: string;
  verificationStatus: string;
  issueDate: string | null;
  expiryDate: string | null;
  hasFile: boolean;
}

function isExpiringSoon(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso).getTime();
  const ninety = Date.now() + 90 * 24 * 3600 * 1000;
  return d < ninety && d > Date.now() - 24 * 3600 * 1000;
}

export default function MyDocuments() {
  const [docs, setDocs] = useState<DocumentDto[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const d = await apiGet<DocumentDto[]>('/api/self-service/me/documents');
        if (active) setDocs(d);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'Could not load documents.');
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <FileText className="h-5 w-5 text-slate-500" aria-hidden /> My documents
        </h1>
        <p className="text-sm text-muted-foreground">Contracts and certificates HR has filed for you.</p>
      </div>

      {error ? <ErrorNote message={error} /> : null}

      {!docs ? (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : docs.length === 0 ? (
        <EmptyState icon={<FileText className="h-8 w-8" aria-hidden />} title="No documents yet" hint="HR-uploaded documents will appear here." />
      ) : (
        <ul className="space-y-2" aria-label="My documents">
          {docs.map((d) => (
            <li key={d.id} className="rounded-xl border bg-card px-3.5 py-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{d.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.type.replace(/_/g, ' ').toLowerCase()}
                    {d.issueDate ? ` · issued ${formatDate(d.issueDate)}` : ''}
                    {d.expiryDate ? ` · expires ${formatDate(d.expiryDate)}` : ''}
                  </p>
                </div>
                <StatusBadge status={d.verificationStatus} />
              </div>
              {isExpiringSoon(d.expiryDate) ? (
                <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Expires within 90 days — plan a renewal with HR.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
