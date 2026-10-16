// MBUMAH HARDWARE POS - Pending branch assignment page (v2.18.1)
//
// /account/pending-branch is the safe landing point for accounts whose role
// must be bound to a branch (BRANCH_MANAGER, CASHIER) but whose User row has
// no storeId yet. The branch-manager binding spec forbids letting such an
// account reach the organization console or any other branch's workspace,
// so this page explains the situation calmly instead.
//
// Server component, no session required: the message is the same for
// everyone, contains no data, and never reveals whether other branches exist.

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Branch Assignment Pending | Mbumah Hardware POS',
};

export default function PendingBranchPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-6 w-6"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-foreground">Your account is not assigned to a branch yet</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Your account is not assigned to a branch yet. Contact the store owner or system administrator
          to be assigned to a branch, then sign in again.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Branch assignments are stored in the database with your account, so once the assignment is
          made you will land directly in your branch workspace.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
