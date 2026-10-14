// ─────────────────────────────────────────────────────────────────────────────
// Branch workspace — /stores/[storeCode]/dashboard
//
// STEP 3 multi-branch workspaces: one shared SQLite DB, branch isolation via
// storeId scoping. Reached either by path (this route) or by subdomain
// {storeCode}.mbumah.co.ke which src/proxy.ts rewrites here after
// host-header allowlisting (reserved labels never match; unknown codes get a
// safe not-found). The workspace re-verifies the branch against the DB —
// the proxy only ever sees hostnames, never database state.
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { db } from "@/lib/db";
import { RELEASE, ORG } from "@/lib/release";

const num = (v: number): string => v.toLocaleString("en-KE");
const kes = (v: number): string => `KES ${v.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ storeCode: string }> }) {
  const { storeCode } = await params;
  const branch = await db.branch.findFirst({ where: { OR: [{ code: storeCode }, { slug: storeCode }] } });
  return { title: branch ? `${branch.name} | Mbumah Hardware POS` : "Workspace not found | Mbumah Hardware POS" };
}

export default async function StoreWorkspacePage({ params }: { params: Promise<{ storeCode: string }> }) {
  const { storeCode } = await params;
  const branch = await db.branch.findFirst({
    where: { OR: [{ code: storeCode }, { slug: storeCode }], isActive: true },
  });
  if (!branch) notFound();

  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);

  const [todayAgg, products, unpaid, rentals, openShift, staff] = await Promise.all([
    db.transaction.aggregate({ _sum: { subtotal: true }, _count: true, where: { type: "SALE", branchId: branch.id, createdAt: { gte: startToday } } }),
    db.product.count({ where: { branchId: branch.id, deletedAt: null } }),
    db.invoice.aggregate({ _sum: { total: true }, where: { branchId: branch.id, status: { in: ["UNPAID", "PARTIAL"] } } }),
    db.rental.count({ where: { branchId: branch.id, status: "OVERDUE" } }),
    db.shift.findFirst({ where: { branchId: branch.id, status: "OPEN" } }),
    db.user.findMany({ where: { branchId: branch.id, isActive: true }, select: { name: true, role: true } }),
  ]);
  const lowStock = await db.product.count({
    where: { branchId: branch.id, deletedAt: null, stockQty: { lte: db.product.fields.reorderLevel } },
  });

  const tiles: Array<[string, string, string]> = [
    ["Revenue today", kes(Number(todayAgg._sum.subtotal ?? 0)), `${todayAgg._count} transaction${todayAgg._count === 1 ? "" : "s"}`],
    ["SKUs", num(products), `${lowStock} low stock`],
    ["Debt exposure", kes(Number(unpaid._sum.total ?? 0)), "unpaid invoices"],
    ["Rentals overdue", num(rentals), openShift ? "shift OPEN" : "shift closed"],
  ];

  return (
    <main className="mbumah-console flex min-h-screen flex-col bg-slate-100">
      <header className="border-b border-white/10 bg-[#0f172a]/95 text-white backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <img src="/logo.webp" alt="Mbumah Hardware logo" width={48} height={48} className="h-12 w-12 rounded-xl bg-white p-1 shadow" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-extrabold">
              {branch.name}
              <span className="h-2 w-2 rounded-full" style={{ background: branch.brandColor ?? "#FF8C00" }} />
            </p>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-orange-400">{ORG.tagline}</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[10px] text-slate-400">workspace</p>
            <p className="font-mono text-[11px] text-slate-200">{branch.subdomain ?? branch.code}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-4 py-5">
        <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-orange-600">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Organization Console
        </Link>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map(([label, value, sub]) => (
            <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
              <p className="mt-0.5 text-lg font-bold text-slate-800">{value}</p>
              <p className="text-[10px] text-slate-400">{sub}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Branch team</h2>
          <div className="flex flex-wrap gap-2">
            {staff.map((s) => (
              <span key={s.name} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                {s.name} · <span className="font-semibold text-slate-700">{s.role}</span>
              </span>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-slate-800">Workspace links</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            <Link className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-orange-300 hover:text-orange-600" href="/">Organization console</Link>
            <a className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-orange-300 hover:text-orange-600" href="/api/reports/export?kind=branch_intelligence">Export branch CSV</a>
            <a className="rounded-lg border border-slate-200 px-3 py-1.5 hover:border-orange-300 hover:text-orange-600" href="/api/health">Health endpoint</a>
            <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-400">{RELEASE.label} · {RELEASE.commitShort}</span>
          </div>
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
            Shared database, branch isolation via storeId. Subdomain mode (<span className="font-mono">{branch.subdomain}</span>) and path mode
            (<span className="font-mono">/stores/{branch.code}/dashboard</span>) both resolve here; SSO session cookie applies across the org domain.
            Host-header allowlisting blocks reserved labels (www/app/api/admin/static).
          </p>
        </section>
      </div>

      <footer className="mt-auto border-t border-slate-200 bg-white px-4 py-3 text-[10px] text-slate-400">
        <p className="mx-auto flex max-w-5xl items-center gap-1">
          {RELEASE.label} · Connected · Juja Town · {ORG.phone1} · <ExternalLink className="h-3 w-3" /> {ORG.email}
        </p>
      </footer>
    </main>
  );
}
