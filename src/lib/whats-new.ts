/**
 * WHAT'S NEW - release notes shown in the WhatsNewDialog (v2.13.0).
 *
 * The dialog (src/components/whats-new-dialog.tsx) renders on app mount when
 * localStorage 'mbt_seen_version' !== APP_VERSION, newest entry first. Each
 * entry is user-facing shop-floor copy - keep bullets short and benefit-led,
 * not commit-log style. Adding a new release = prepend one entry here; the
 * dialog picks it up automatically (no other edit needed).
 *
 * PURE module - imported by client components, so it must stay free of any
 * server-only imports (same constraint as src/lib/permissions.ts).
 */

export interface WhatsNewEntry {
  /** Semver string WITHOUT the leading 'v' - matches package.json. */
  version: string;
  /** One-line headline for the release. */
  title: string;
  /** Shop-floor bullet list (3-6 items). */
  bullets: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '2.17.7',
    title: 'Online hosting: your own domain, every branch online',
    bullets: [
      'Self-host the POS on your own public domain: the console at app.mbumah.co.ke and every branch on its own subdomain, behind Cloudflare Tunnel or a Caddy reverse proxy.',
      'New online env template (.env.online.example) pre-wires the public domain, secure shared sign-on cookies and the host allowlist - copy, fill the secrets, start.',
      'New online hosting guide with copy-paste Cloudflare Tunnel and Caddy configurations, including the forwarded-host security notes for proxies that rewrite the Host header.',
      'Local testing is unchanged: localhost and LAN IP addresses keep using /stores/branch links automatically, no configuration needed.',
    ],
  },
  {
    version: '2.17.6',
    title: 'LAN mode: schema health at a glance',
    bullets: [
      'New protected endpoint /api/health/schema shows an authenticated operator the complete database drift picture: which columns are missing, row counts, and the exact repair command to run.',
      'New LAN env template (.env.lan.example) for hosting the POS on the shop network with mbumah.lan or the static server IP.',
      'The LAN guide now includes step-by-step Windows Firewall instructions so other tills can reach the server.',
    ],
  },
  {
    version: '2.17.5',
    title: 'Branch workspaces: verified end to end',
    bullets: [
      'The multi-branch workspace matrix (organization console, per-branch sites, branch selector, access denials, global chat) was re-verified end to end on the current release.',
      'Small accessibility polish on the global chat composer.',
    ],
  },
  {
    version: '2.17.4',
    title: 'Offline branch subdomains: one-command setup',
    bullets: [
      'New local offline env template: copy .env.local-offline.example to .env and the shop runs as mbumah.test with every branch on its own subdomain.',
      'New hosts file helper: npm run domains:write-hosts writes (and cleans up) the managed hosts block for all five branches, with an automatic backup and a clear refusal when elevation is needed.',
    ],
  },
  {
    version: '2.17.3',
    title: 'Safer database updates: preflight and one-command repair',
    bullets: [
      'New `npm run db:preflight` answers "will this update apply safely?" by testing the schema change on a throwaway copy of your database - the live data is never touched.',
      'New `npm run db:repair` fixes the "Schema drift detected" state in one command: verified backup first, then the safe additive converge, then verification.',
      'Windows builds are lighter: the standalone server bundle is now produced only where it is used (Docker and the installers), avoiding Windows file-copy errors.',
    ],
  },
  {
    version: '2.17.2',
    title: 'Repository tidy-up: one brand, one database',
    bullets: [
      'The retired flat logo files are gone; receipts, printed documents, the PDF statement, and the offline cache all use the current 3D Mbumah brand mark.',
      'The service worker cache was refreshed so existing installs pick up the updated brand assets on the next load.',
      'Housekeeping: the one-shot Vercel cleanup workflow was removed after completing its purpose, and the gitignore now also excludes local SQLite variants and OS droppings.',
    ],
  },
  {
    version: '2.17.1',
    title: 'Professional polish across the product',
    bullets: [
      'Cleaner, more professional wording everywhere: docs, comments, console output, receipts, emails, and message templates no longer use decorative emojis or AI-style dashes.',
      'Consistent terminology across the app and docs: M-Pesa, Daraja API, STK Push, PostgreSQL, TypeScript.',
      'Receipts and printed documents now carry the current 3D Mbumah brand mark, and PWA shortcuts use the standard icon set.',
      'Demo login credentials are clearly labeled as local-only defaults; change them on first login.',
    ],
  },
  {
    version: '2.17.0',
    title: 'Hosting readiness audit and safer operations',
    bullets: [
      'A full review of the external hosting plan against the app is now part of the docs: what is already built, what was corrected, and what comes next (docs/hosting-readiness-audit.md).',
      'The health endpoint now reports how and where the POS is running: appMode, workspaceMode and databaseProvider - so support and monitoring can tell a Vercel deployment from a laptop install at a glance.',
      'New one-command database backups: npm run db:backup writes a verified, timestamped copy of your data (with automatic cleanup of old backups), and npm run db:verify validates the database configuration.',
      'Safer M-Pesa: starting an STK Push payment now uses the same strict rate limit as sale creation, protecting customers from accidental repeated payment prompts.',
    ],
  },
  {
    version: '2.16.0',
    title: 'Every branch gets its own workspace website',
    bullets: [
      'Branches now open as their own workspace: from the new Organization Console each branch opens in its own tab with its own badge and color - at mbumah.co.ke branch addresses or as /stores/branch links, whichever your setup supports.',
      'Owners and administrators see all branches in one calm console: today\'s revenue, low stock, overdue rentals, debt aging and pending M-Pesa for every branch, side by side.',
      'Warehouse managers pick their assigned branches from a clean selector and can keep several branches open at once; cashiers and branch managers only ever see their own branch.',
      'New Global Chat connects every branch and the organization console in one room, with each message badged by its branch. Chat visibility never exposes branch data.',
      'Local and offline setups get one-command tools: hosts-file entries for branch addresses (npm run domains:print) and a readiness check (npm run domains:verify).',
    ],
  },
  {
    version: '2.15.2',
    title: 'Laptops repair their own database after updates',
    bullets: [
      'Fixed: after an update, some shops saw errors like "column does not exist" on Notifications, Debt and Stock Movements. The database now repairs itself automatically - the update applies any missing schema changes and keeps all your data.',
      'Every start of the POS double-checks the database schema (about 1 second) and heals it if a previous update left it behind.',
      'The health report now names schema problems directly ("Schema drift detected - run the updater") instead of staying silent while some modules error.',
    ],
  },
  {
    version: '2.15.1',
    title: 'Offline selling now truly works at the till',
    bullets: [
      'Fixed: completing a sale while offline now saves it on the spot (amber queue badge + instant paper receipt) - previously the tap could silently do nothing until the internet returned.',
      'Back online, the queued sale syncs itself and shows one clean confirmation; the sale lands in Transactions with its real receipt number.',
    ],
  },
  {
    version: '2.15.0',
    title: 'Offline sales polish + realtime alerts for self-hosted branches',
    bullets: [
      'One clear sync message: when the internet returns, queued sales now show a single "Offline sales synced" confirmation - no more duplicate toasts at the till. If a sale cannot reach the server, the till names exactly which sales will retry.',
      'Offline sales at a glance: the top-bar dot turns amber with a live count while you are offline and opens a queue dialog - sync now or clear the queue safely.',
      'Fullscreen till mode: press the user menu "Toggle Fullscreen" (or F11) and the sidebar tucks itself away, peeking only when you brush the screen edge - more room for the product grid.',
      'Reorder in one tap: at or below reorder level, the product row, detail panel and Adjust Stock dialog offer "Reorder (+N)" that prefills the quantity to restore your stock level.',
      'Self-hosted branches get live notifications: the realtime service now ships inside the standard production install (Docker Compose + nginx), wired, health-checked and never exposed to the internet.',
    ],
  },
  {
    version: '2.13.3',
    title: 'New logo, faster POS & smart Sell More suggestions',
    bullets: [
      'Fresh 3D MBUMAH HARDWARE logo now leads the sidebar, top bar and app icon.',
      'Sell More chips: add cement and the till suggests spades, mixers and nails - tap a chip to add it instantly (best sellers show on an empty cart).',
      'Blue "in cart" pill pops on the product tile the moment you tap +, and toasts now name the item and price.',
      'New branch? Today\u2019s Revenue shows a calm gray trend and a "No sales yet today - start selling!" nudge instead of a misleading green arrow.',
      'Thika branch catalog loaded with the full spec range - from 4-inch nails to the Concrete Mixer rental.',
    ],
  },
  {
    version: '2.13.2',
    title: 'Checkout fix - sales flow restored',
    bullets: [
      'Fixed a checkout failure introduced in v2.13.1 - every sale now completes reliably again.',
      'Cashier dashboard "Today\u2019s Sales" now shows the true net revenue of your own sales (it briefly showed a sale count instead).',
    ],
  },
  {
    version: '2.13.1',
    title: 'Receipt-true VAT + strictly yours cashier dashboard',
    bullets: [
      'VAT (incl.) now shows the VAT inside the amount you actually pay - when you apply a discount, the VAT figure on the cart, checkout summary and receipt drops with it.',
      'Cashier dashboard KPIs are now strictly yours: Today\u2019s Sales, Transactions and Avg Order count your own sales only, not the whole branch\u2019s.',
      'Receipts, journal entries and eTIMS payloads all agree: VAT is computed on the discounted total (Kenya VAT Act compliant).',
    ],
  },
  {
    version: '2.13.0',
    title: 'RBAC - 5 roles, manager approvals, audit trail',
    bullets: [
      'Role-filtered sidebar with locks - tabs you can\u2019t open show a \u201cRequires Branch Manager\u201d lock instead of silently vanishing.',
      'Cashier limited dashboard - Today\u2019s Sales, Transactions, Avg Order, Low Stock and My Sales only (no revenue, debt or analytics).',
      'Manager authorization at the counter - discounts over 5% and high-risk credit sales (KES 150k+ debt) need a manager\u2019s approval.',
      'Abuse lockout + Security alerts - 5 denied attempts in 10 minutes locks the account for 15 minutes and alerts the Super Admin.',
      'Audit Trail page with CSV export - every denial, override and manager authorization in one filterable, hash-chained feed.',
      'POS hotfixes carried in: per-unit fix (\u201cper \u201d bug), product-card badge overlap, VAT \u201c(incl.)\u201d labels.',
    ],
  },
  {
    version: '2.12.x',
    title: 'QA & stability pass',
    bullets: [
      'Dashboard rebuild - shift Expected-cash math fixed (Starting + Cash Sales \u2212 Expenses), debt-crisis logic, precise low-stock counts.',
      'Revenue trend outlier detection - a bulk-sale day no longer skews the forecast; peak-hour note flags it instead.',
      'POS hotfix ladder - per-unit fallback, badge overlap, FAB overlap on checkout, category scrollbar, VAT \u201c(incl.)\u201d labels.',
    ],
  },
];
