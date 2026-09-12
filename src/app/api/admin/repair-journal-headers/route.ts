// POST /api/admin/repair-journal-headers
//
// R12 DATA REPAIR (v2.5.1): the rental return refund branch used to write
// `totalCredit: totalCharges` on the journal-entry HEADER while the LINES
// credited (refund + charges) = the full deposit. Result: unbalanced JE
// headers on every refund-type rental settlement (8 found on production,
// e.g. Caroline Ochieng JE-20260912-70F63: D 6,670 / C 1,334).
//
// This maintenance endpoint re-derives header totals from the ACTUAL line
// sums for entries where:
//   • referenceType = 'RENTAL'           (narrow scope — the R12 bug class)
//   • |totalDebit − totalCredit| > 0.009 (header unbalanced)
//   • Σ(line debits) ≈ Σ(line credits)   (lines themselves ARE balanced)
//
// It NEVER touches journal lines. Guard rails:
//   • SUPER_ADMIN only
//   • dryRun by default — pass { "dryRun": false } to actually repair
//   • max 50 entries per call (idempotent; re-run until "remaining" = 0)
//   • full before/after audit via systemLog

import { type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { systemLog, withErrorBoundary } from '@/lib/logger';
import { LogSeverity, LogComponent } from '@/lib/types';
import { requireAuth } from '@/lib/auth';
import { round2 } from '@/lib/utils/financialMath';

export const dynamic = 'force-dynamic';

const BALANCE_EPSILON = 0.009;
const MAX_REPAIRS_PER_CALL = 50;

async function repairJournalHeadersHandler(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => ({}));
  const dryRun = body?.dryRun !== false; // default true — must opt in to repair

  // Candidates: unbalanced RENTAL headers. Aggregate line sums per entry.
  const entries = await db.journalEntry.findMany({
    where: { referenceType: 'RENTAL' },
    include: { lines: { select: { debit: true, credit: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const candidates = entries
    .filter((e) => {
      const headerDrift = Math.abs(
        round2(Number(e.totalDebit) - Number(e.totalCredit))
      );
      if (headerDrift <= BALANCE_EPSILON) return false;
      const lineDebits = e.lines.reduce((acc, l) => acc + Number(l.debit), 0);
      const lineCredits = e.lines.reduce((acc, l) => acc + Number(l.credit), 0);
      // Only repair when the LINES balance — otherwise the entry needs a
      // human accountant, not a mechanical fix.
      return Math.abs(round2(lineDebits - lineCredits)) <= BALANCE_EPSILON;
    })
    .slice(0, MAX_REPAIRS_PER_CALL);

  if (dryRun) {
    return Response.json({
      success: true,
      data: {
        dryRun,
        candidates: candidates.map((e) => ({
          id: e.id,
          entryNumber: e.entryNumber,
          description: e.description,
          currentDebit: Number(e.totalDebit),
          currentCredit: Number(e.totalCredit),
          lineDebitTotal: round2(e.lines.reduce((acc, l) => acc + Number(l.debit), 0)),
          lineCreditTotal: round2(e.lines.reduce((acc, l) => acc + Number(l.credit), 0)),
        })),
        note: 'Pass { "dryRun": false } to apply the repair.',
      },
    });
  }

  const repaired: {
    id: string; entryNumber: string;
    oldDebit: number; oldCredit: number; newTotal: number;
  }[] = [];

  for (const e of candidates) {
    const lineDebitTotal = round2(e.lines.reduce((acc, l) => acc + Number(l.debit), 0));
    const lineCreditTotal = round2(e.lines.reduce((acc, l) => acc + Number(l.credit), 0));
    const updated = await db.journalEntry.update({
      where: { id: e.id },
      data: { totalDebit: lineDebitTotal, totalCredit: lineCreditTotal },
      select: { id: true, entryNumber: true },
    });
    repaired.push({
      id: updated.id,
      entryNumber: updated.entryNumber,
      oldDebit: Number(e.totalDebit),
      oldCredit: Number(e.totalCredit),
      newTotal: lineDebitTotal,
    });
  }

  await systemLog({
    action: 'JOURNAL_HEADERS_REPAIRED',
    component: LogComponent.FINANCIAL,
    severity: repaired.length > 0 ? LogSeverity.WARN : LogSeverity.INFO,
    message: `R12 repair: ${repaired.length} unbalanced RENTAL journal header(s) re-derived from line sums`,
    metadata: { repaired, dryRun },
  });

  return Response.json({
    success: true,
    data: {
      dryRun,
      repairedCount: repaired.length,
      repaired,
      note: 'Re-run until the candidates list is empty.',
    },
  });
}

export const POST = withErrorBoundary(
  requireAuth(repairJournalHeadersHandler, { roles: ['SUPER_ADMIN'] }),
  'ADMIN_REPAIR_JOURNAL_HEADERS',
);
