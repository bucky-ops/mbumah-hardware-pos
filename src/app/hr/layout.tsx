import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'HR Workspace | Mbumah Hardware POS',
  description: 'Employee management workspace: records, documents, and statutory readiness.',
};

const NAV_ITEMS = [
  { href: '/hr', label: 'Overview' },
  { href: '/hr/employees', label: 'Employees' },
  { href: '/hr/recruitment', label: 'Recruitment' },
  { href: '/hr/onboarding', label: 'Onboarding' },
  { href: '/hr/payroll', label: 'Payroll' },
];

export default function HrLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold text-foreground">
            HR Workspace
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              EMS
            </span>
          </Link>
          <nav aria-label="HR navigation" className="ml-auto flex items-center gap-1">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      <footer className="mt-auto border-t py-4 text-center text-xs text-muted-foreground">
        Mbumah Hardware POS HR workspace. PII is masked by default; unmasking is role-gated and audit logged.
      </footer>
    </div>
  );
}
