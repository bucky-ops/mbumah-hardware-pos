// MBUMAH HARDWARE POS - /employees/me/documents (v2.28.0, SERVER-RENDERED)
// Own document metadata (type, verification status, expiry). Notes are
// HR-only and never rendered here; files download only through the
// permission-gated HR document route.
//
// v2.28.0 SSR COMPLETION: previously a client component that fetched
// /api/self-service/me/documents after paint; now server-renders through the
// SAME listMyDocuments service the API route exposes. Pure read - no client
// island needed. The 90-day expiry warning moves server-side with it.

import { FileText, TriangleAlert } from 'lucide-react';
import { listMyDocuments } from '@/lib/hr/self-service';
import { EmptyState, ErrorNote, StatusBadge } from '@/components/hr/self-service-ui';
import { formatDate } from '@/components/hr/self-service-format';
import { SelfPageHeader, loadSelfPortal } from '../self-portal';

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

export const dynamic = 'force-dynamic';

export default async function MyDocuments() {
  const guard = await loadSelfPortal('hr.documents.read.own');
  if (!guard.ok) return guard.note;

  let docs: DocumentDto[];
  try {
    docs = (await listMyDocuments(guard.employee)) as unknown as DocumentDto[];
  } catch {
    return (
      <div className="space-y-4">
        <SelfPageHeader
          icon={<FileText className="h-5 w-5" />}
          tone="from-slate-500/15 to-zinc-500/15 text-slate-600 dark:text-slate-300"
          title="My documents"
          description="Contracts and certificates HR has filed for you."
        />
        <ErrorNote message="Could not load your documents. Try again in a moment." />
      </div>
    );
  }

  const expiringCount = docs.filter((d) => isExpiringSoon(d.expiryDate)).length;

  return (
    <div className="space-y-4">
      <SelfPageHeader
        icon={<FileText className="h-5 w-5" />}
        tone="from-slate-500/15 to-zinc-500/15 text-slate-600 dark:text-slate-300"
        title="My documents"
        description={
          expiringCount > 0
            ? `Contracts and certificates HR has filed for you — ${expiringCount} expiring soon.`
            : 'Contracts and certificates HR has filed for you.'
        }
      />

      {docs.length === 0 ? (
        <EmptyState icon={<FileText className="h-8 w-8" aria-hidden />} title="No documents yet" hint="HR-uploaded documents will appear here." />
      ) : (
        <ul className="space-y-2" aria-label="My documents">
          {docs.map((d) => (
            <li
              key={d.id}
              className="rounded-xl border bg-card px-3.5 py-3 shadow-sm transition-shadow hover:shadow-md"
            >
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
