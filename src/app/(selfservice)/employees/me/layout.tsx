import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Home, Wallet, CalendarClock, Palmtree, Target, FileText } from 'lucide-react';

export const metadata: Metadata = {
  title: 'My Workspace | Mbumah Hardware',
  description: 'Your payslips, leave, attendance, goals, and documents — private to you.',
};

const TABS = [
  { href: '/employees/me', label: 'Home', icon: Home },
  { href: '/employees/me/payslips', label: 'Payslips', icon: Wallet },
  { href: '/employees/me/attendance', label: 'Attendance', icon: CalendarClock },
  { href: '/employees/me/leave', label: 'Leave', icon: Palmtree },
  { href: '/employees/me/goals', label: 'Goals', icon: Target },
  { href: '/employees/me/documents', label: 'Docs', icon: FileText },
];

export default function EmployeeSelfServiceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-50 via-background to-background dark:from-slate-950">
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <Link href="/employees/me" className="flex items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-xs font-bold text-white shadow-sm">
              M
            </span>
            My Workspace
          </Link>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300">
            Private to you
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-4 sm:pt-6 md:pb-10">{children}</main>

      {/* Mobile bottom tab bar (self-service is mobile-first per spec) */}
      <nav
        aria-label="Self-service navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="grid grid-cols-6">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground transition-colors active:text-foreground"
            >
              <tab.icon className="h-5 w-5" aria-hidden />
              {tab.label}
            </Link>
          ))}
        </div>
      </nav>

      {/* Desktop inline nav (mirrors the mobile tabs) */}
      <nav
        aria-label="Self-service navigation desktop"
        className="sticky bottom-0 z-30 hidden justify-center gap-1 border-t bg-card/95 py-2 backdrop-blur md:flex"
      >
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <tab.icon className="h-4 w-4" aria-hidden />
            {tab.label}
          </Link>
        ))}
      </nav>

      <footer className="hidden border-t py-3 text-center text-xs text-muted-foreground md:block">
        Your data is scoped to your own profile. Payslip figures stay available offline on this device once loaded.
      </footer>
    </div>
  );
}
