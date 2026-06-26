#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────────────
// MBUMAH HARDWARE POS — Nightly Financial Audit Script
// ─────────────────────────────────────────────────────────────────────────────
//
// Run via: `bun run audit:financial` or as a Vercel Cron job.
//
// Executes a full financial integrity audit across all stores and reports
// any CRITICAL issues to the system log + Sentry. Exits with code 1 if any
// CRITICAL issues are found (so cron alerting can trigger on non-zero exit).
//
// ─────────────────────────────────────────────────────────────────────────────

import { runFinancialAudit } from '../src/lib/financial-audit';
import { runWithoutTenant } from '../src/lib/db';
import { db } from '../src/lib/db';
import { systemLog } from '../src/lib/logger';
import { LogSeverity, LogComponent } from '../src/lib/types';

async function main() {
  console.log('━'.repeat(60));
  console.log('MBUMAH HARDWARE POS — Financial Audit');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('━'.repeat(60));

  // Fetch all active stores to audit each one individually.
  const stores = await runWithoutTenant(async () =>
    db.store.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true },
    }),
  );

  console.log(`Found ${stores.length} active store(s) to audit.`);

  let totalCritical = 0;
  let totalIssues = 0;

  for (const store of stores) {
    console.log(`\nAuditing store: ${store.name} (${store.id})`);
    const result = await runFinancialAudit(store.id);

    console.log(
      `  Entries checked: ${result.summary.entriesChecked} | ` +
        `Lines: ${result.summary.linesChecked} | ` +
        `Issues: ${result.summary.issuesFound} | ` +
        `Critical: ${result.summary.criticalIssues} | ` +
        `Duration: ${result.durationMs}ms`,
    );

    if (!result.passed) {
      for (const issue of result.issues) {
        const icon =
          issue.severity === 'CRITICAL'
            ? '✖'
            : issue.severity === 'HIGH'
              ? '⚠'
              : '•';
        console.log(`  ${icon} [${issue.severity}] ${issue.type}: ${issue.message}`);
      }
    }

    totalCritical += result.summary.criticalIssues;
    totalIssues += result.summary.issuesFound;
  }

  // Also run an org-wide audit (all stores combined) to catch cross-store
  // issues like duplicate entry numbers.
  console.log('\nRunning org-wide audit (all stores)...');
  const orgResult = await runFinancialAudit(undefined);
  console.log(
    `  Entries: ${orgResult.summary.entriesChecked} | ` +
      `Issues: ${orgResult.summary.issuesFound} | ` +
      `Critical: ${orgResult.summary.criticalIssues}`,
  );

  totalCritical += orgResult.summary.criticalIssues;
  totalIssues += orgResult.summary.issuesFound;

  console.log('\n' + '━'.repeat(60));
  console.log('AUDIT SUMMARY');
  console.log('━'.repeat(60));
  console.log(`Total issues:     ${totalIssues}`);
  console.log(`Critical issues:  ${totalCritical}`);
  console.log(`Completed:        ${new Date().toISOString()}`);

  if (totalCritical > 0) {
    console.log('\n✖ AUDIT FAILED — CRITICAL issues detected.');
    await systemLog({
      action: 'NIGHTLY_AUDIT_FAILED',
      component: LogComponent.FINANCIAL,
      severity: LogSeverity.CRITICAL,
      message: `Nightly financial audit failed with ${totalCritical} CRITICAL issue(s).`,
      metadata: { totalIssues, totalCritical },
    }).catch(() => {});
    process.exit(1);
  }

  console.log('\n✓ AUDIT PASSED — ledger is balanced and consistent.');
  process.exit(0);
}

main().catch((error) => {
  console.error('Audit script crashed:', error);
  process.exit(2);
});
