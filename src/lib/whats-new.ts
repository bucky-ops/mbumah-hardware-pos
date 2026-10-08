/**
 * WHAT'S NEW — release notes shown in the WhatsNewDialog (v2.13.0).
 *
 * The dialog (src/components/whats-new-dialog.tsx) renders on app mount when
 * localStorage 'mbt_seen_version' !== APP_VERSION, newest entry first. Each
 * entry is user-facing shop-floor copy — keep bullets short and benefit-led,
 * not commit-log style. Adding a new release = prepend one entry here; the
 * dialog picks it up automatically (no other edit needed).
 *
 * PURE module — imported by client components, so it must stay free of any
 * server-only imports (same constraint as src/lib/permissions.ts).
 */

export interface WhatsNewEntry {
  /** Semver string WITHOUT the leading 'v' — matches package.json. */
  version: string;
  /** One-line headline for the release. */
  title: string;
  /** Shop-floor bullet list (3–6 items). */
  bullets: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '2.13.1',
    title: 'Receipt-true VAT + strictly yours cashier dashboard',
    bullets: [
      'VAT (incl.) now shows the VAT inside the amount you actually pay — when you apply a discount, the VAT figure on the cart, checkout summary and receipt drops with it.',
      'Cashier dashboard KPIs are now strictly yours: Today\u2019s Sales, Transactions and Avg Order count your own sales only, not the whole branch\u2019s.',
      'Receipts, journal entries and eTIMS payloads all agree: VAT is computed on the discounted total (Kenya VAT Act compliant).',
    ],
  },
  {
    version: '2.13.0',
    title: 'RBAC — 5 roles, manager approvals, audit trail',
    bullets: [
      'Role-filtered sidebar with locks — tabs you can\u2019t open show a \u201cRequires Branch Manager\u201d lock instead of silently vanishing.',
      'Cashier limited dashboard — Today\u2019s Sales, Transactions, Avg Order, Low Stock and My Sales only (no revenue, debt or analytics).',
      'Manager authorization at the counter — discounts over 5% and high-risk credit sales (KES 150k+ debt) need a manager\u2019s approval.',
      'Abuse lockout + Security alerts — 5 denied attempts in 10 minutes locks the account for 15 minutes and alerts the Super Admin.',
      'Audit Trail page with CSV export — every denial, override and manager authorization in one filterable, hash-chained feed.',
      'POS hotfixes carried in: per-unit fix (\u201cper \u201d bug), product-card badge overlap, VAT \u201c(incl.)\u201d labels.',
    ],
  },
  {
    version: '2.12.x',
    title: 'QA & stability pass',
    bullets: [
      'Dashboard rebuild — shift Expected-cash math fixed (Starting + Cash Sales \u2212 Expenses), debt-crisis logic, precise low-stock counts.',
      'Revenue trend outlier detection — a bulk-sale day no longer skews the forecast; peak-hour note flags it instead.',
      'POS hotfix ladder — per-unit fallback, badge overlap, FAB overlap on checkout, category scrollbar, VAT \u201c(incl.)\u201d labels.',
    ],
  },
];
