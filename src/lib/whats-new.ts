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
    version: '2.38.0',
    title: 'HR can file leave on behalf of an employee — with the employee notified and the request clearly marked',
    bullets: [
      'The Leave desk gains a "New request" button for walk-up and phone-in leave: pick the employee, type and dates, and the dialog previews the working-day count (weekends skipped) and the live available balance before you file.',
      'The employee is told immediately — a portal bell row and an email explain who filed the request, the days and the reason, and they can withdraw it themselves while it is still pending.',
      'Every surface marks the request "Entered by HR": violet chips on the HR desk rows and detail dialog, a "Filed by HR" badge on the employee\'s portal card, and an "Entered by" line on the approver email — no more guessing which requests the employee actually typed.',
      'Filing is governed: the old open endpoint let any same-store user file leave for any colleague — now non-manager filers are restricted to their own requests, HR filers face the same balance guard as the portal (no overdrafts on behalf), and every entry lands in the audit trail.',
    ],
  },
  {
    version: '2.37.0',
    title: 'Leave balances join the scheduled digest pack — the year-keyed balance sheet can now land in the right inbox on autopilot',
    bullets: [
      'The "Leave balances" report is now schedulable alongside the other report digests: pick it in the Schedule a report digest dialog, choose daily/weekly/monthly, add recipients, and the aggregate digest lands on its own.',
      'It is the only year-keyed digest — every fire re-computes for the current calendar leave year and the email says so ("Leave year 2026"), instead of pretending balances follow the reporting period.',
      'The digest carries the balance-sheet view: tracked rows, liability days, committed %, over-drawn count, pending days and exhausted/low counts as headline stats, plus an entitlement-by-leave-type table — aggregates only, never employee names or ids.',
      'A failed send still surfaces honestly: the schedule row stamps FAILED and the creator gets a HIGH-priority alert (dev/CI without RESEND_API_KEY shows the same path).',
    ],
  },
  {
    version: '2.36.0',
    title: 'Leave balances gain a correction path — click a row for history, then adjust entitlement with a full audit trail',
    bullets: [
      'Every row in the "Leave balances" report is now clickable: a drill-down opens with the employee\'s balance components, governance notes and all leave requests starting in that year — status chips, date ranges, day counts and reasons in one place.',
      'HR managers and store owners can correct entitlements directly from the drill-down: enter signed days (±0.5 steps, ±365 cap), give a reason, preview the resulting balance, and apply — the row updates instantly in the report.',
      'Corrections are governed end to end: the reason is mandatory (8+ characters) and lands in both the hash-chained audit trail and the balance notes, allocated days can never go below zero, and accountants deliberately cannot rewrite entitlements.',
      'The employee is kept in the loop: a bell notification and an email explain what changed, by how much and why — with a link straight to their leave page. The dialog reports exactly what was delivered (in-app and email chips, or an explicit "no portal account" skip) instead of silently swallowing a failed send.',
    ],
  },
  {
    version: '2.35.0',
    title: 'Leave balances become a governed report — liability days, over-draw flags and year-keyed exports',
    bullets: [
      'A new "Leave balances" tab in HR reports shows, for any leave year, every employee entitlement side by side: allocated, carried forward, used, pending and available — with a committed-percent rail per row (emerald under 80%, amber near the ceiling, rose when over-drawn).',
      'Rows flag themselves: OVERDRAWN (balance below zero), EXHAUSTED (nothing left), LOW (80%+ committed) or OPEN, so balance corrections and approvals can be prioritised without opening each employee.',
      'The headline cards answer the compliance question directly — liability days still owed to the team, committed share, over-drawn count and days pending decision — with per-leave-type bars summarising where the entitlement sits.',
      'CSV export and print follow the report pack conventions: employeeCode + job title only (never names or raw ids), a TOTAL row, and the server-side export is audit logged as a data export.',
    ],
  },
  {
    version: '2.34.0',
    title: 'Declined leave can be resubmitted in one tap — and failed M-Pesa payslips can be retried individually',
    bullets: [
      'Rejected leave requests in your portal now show a "Review & resubmit" button: the request dialog opens pre-filled with the type, dates and your original reason, and the manager\'s note stays visible while you adjust and resubmit.',
      'Every request card in the portal now carries a status rail (amber pending, emerald approved, rose declined, violet cancelled) so the state reads at a glance.',
      'In the payroll run dialog, each failed M-Pesa payslip gets its own Retry button — re-send just that one instead of sweeping the whole run; the same backoff and attempt-ceiling gate still protects every send.',
      'Blocked payslips (backoff window open, or at the 5-attempt ceiling) show exactly why on their row — countdown chips for the former, a manual-review flag for the latter.',
    ],
  },
  {
    version: '2.33.0',
    title: 'Leave cancellations are never silent — and failed M-Pesa retries now pace themselves',
    bullets: [
      'Cancelling a leave request is now a first-class action with a confirm dialog: managers get a violet Cancel button on pending and approved requests on the Leave desk, employees can withdraw their own pending requests from the self-service portal — and the other side always hears about it (violet bell row).',
      'Failed M-Pesa disbursement retries now back off (2m, 4m, 8m … capped at 30m) instead of firing at Safaricom back-to-back — each payslip row shows exactly when its retry reopens.',
      'After 5 failed attempts a payslip is flagged "manual review" and the retry button stops counting it, so permanent failures get human eyes instead of endless re-sends.',
      'The email log gains a LEAVE_CANCEL filter (violet chip), making cancellation emails auditable like every other send.',
    ],
  },
  {
    version: '2.32.1',
    title: 'Fixes: manager notifications now fire on portal leave requests, and pending days are always accurate',
    bullets: [
      'Fixed: submitting leave from the self-service portal did not notify managers — the notification only fired on the HR-desk path. All submission paths now notify the approvals group.',
      'Fixed: pending leave days were not reflected in your balance until a manager decided — your available days could look higher than reality. Balances now recompute the moment you submit.',
    ],
  },
  {
    version: '2.32.0',
    title: 'WhatsApp sharing works from every tab — and managers now hear about new leave requests',
    bullets: [
      'Fixed: the "Send via WhatsApp" button was silently dead on Gift Cards, Transactions, Inventory, Catalog, Credits, Invoices and Delivery Notes — the app read the reply from the wrong envelope. Every share now opens WhatsApp with the prepared message.',
      'Invoice and delivery-note WhatsApp previews now show the real message text and a working link instead of generic titles.',
      'New leave requests now notify managers instantly: a bell row with a "New request" chip that jumps straight to the Payroll Leave desk, plus one email to the whole approvals group.',
      'The email log can filter LEAVE_REQUEST sends, so the request-notification cadence is auditable like every other email.',
    ],
  },
  {
    version: '2.31.0',
    title: 'Leave decisions now reach the employee — and the last hidden Decimal traps are gone',
    bullets: [
      'Employees now get notified the moment a manager decides their leave: a bell notification with an Approved/Declined chip, plus an email copy with the full decision (and the reason when declined).',
      'Bell rows deep-link straight to the portal leave page, so reviewing the decision is one tap.',
      'Email log gains a LEAVE_DECISION filter so delivery of decision emails is auditable like receipts and digests.',
      'Hardening: every remaining Decimal read across checkout, gift cards, KRA eTIMS, bundles, reports, WhatsApp and attendance now goes through a decimal-safe conversion — the same string-concatenation trap that once corrupted leave balances can no longer recur anywhere.',
    ],
  },
  {
    version: '2.30.0',
    title: 'The Payroll tab leave desk actually works now — approve, reject with a reason, and see every balance',
    bullets: [
      'Fixed: opening Payroll → Leave (or Attendance) with any data crashed the whole tab. It renders reliably now, with avatars, status rails and type-colored badges.',
      'Fixed: the Approve/Reject buttons never worked — they sent the wrong action codes, and approvals silently failed to deduct used days from the balance (a long-standing data bug, now healed on every decision).',
      'Rejecting a request now asks for a reason — the employee sees it as "Declined: …" in their portal, and rejected rows show it inline.',
      'New Balances panel: every employee\'s entitlement usage per leave type with color-coded progress bars and pending-day counts.',
      'New View dialog on each request: full context (reason, half day, expected return, emergency contact, decision history) before you decide.',
      'Attendance rows now surface overtime hours and late minutes at a glance.',
    ],
  },
  {
    version: '2.29.0',
    title: 'Payslips by year, leave balances for everyone, and a CSV export for the email log',
    bullets: [
      'Payslips now have a year switcher: jump to any year you were paid in, with a running total of what each view adds up to.',
      'Leave balances are provisioned for every employee — you can now actually request leave from the portal.',
      'Admins can export the email delivery log to CSV (with the active filters applied) for offline audits.',
    ],
  },
  {
    version: '2.28.0',
    title: 'The whole self-service portal now opens instantly — and failed digest emails are one tap away',
    bullets: [
      'Payslips, attendance, leave, goals and documents now load server-side: the page arrives with your data already in it, no spinner on any portal tab.',
      'The notification center gains an "Email failed" filter that appears whenever report digests are in your feed — tap it to see exactly which digest emails did not go out.',
      'Requesting leave and acknowledging reviews feel snappier: the page refreshes in place after you submit.',
      'Every portal page now shares the same header design — the workspace finally reads as one product.',
      'Offline payslips still work exactly as before: cached lists and cached breakdowns open even without a connection.',
    ],
  },
  {
    version: '2.27.0',
    title: 'Know exactly who got the digest — and jump from a notification straight to its schedule',
    bullets: [
      'Delivery history rows on the Schedules page now expand: click any attempt to see the individual email addresses it was addressed to, each marked with the send outcome.',
      'Digest notifications now show whether the email actually went out ("Email sent" / "Email failed") and whether it was a manual send — no more identical-looking rows for healthy and broken deliveries.',
      'Digest notifications about a schedule get a "Manage schedule" link that opens the Schedules page and highlights the exact schedule card for you.',
    ],
  },
  {
    version: '2.26.0',
    title: 'Delivery ops console: see every email that left the building, and manage digest recipients in place',
    bullets: [
      'New "Email delivery log" card in the Admin tab: every outbound email attempt — receipts, low-stock alerts, HR digests — with its SENT/FAILED outcome, filters, paging and the exact error when a send failed.',
      'Expand any log row to see the provider messageId, the schedule it belonged to, and who triggered it.',
      'Scheduled digests now have a "Recipients" editor right on the card: add or remove addresses with live validation (invalid ones turn red), dedupe handled for you, and the next scheduled fire picks the list up automatically.',
      'Security hardening: branch managers can no longer edit, delete or re-address schedules outside their own branch — schedule writes now enforce the same fail-closed branch scope as sending and previews do.',
      'Schedule pause/delete audit entries now record who actually performed the action instead of a generic system identity.',
    ],
  },
  {
    version: '2.25.0',
    title: 'Every email is now accountable: delivery history for your digests, and a dry-run preview before you send',
    bullets: [
      'The delivery log behind every outbound email actually records now — receipts, low-stock alerts and HR digests all leave a durable SENT/FAILED trail (previously the log table itself was missing from the database schema, so history was lost).',
      'Each scheduled digest on the Reports → Schedules page has a History button: see the last 10 sends with status, time and the exact error when delivery failed, plus a health-dots strip that shows delivery quality at a glance.',
      'New Preview button on every schedule shows exactly what the next digest email will contain — the same aggregates, period and branch scope as the real send — without emailing anyone or moving the schedule.',
      'The preview also tells you when the next scheduled send will fire, so a manual "Send now" can be timed without disturbing the cadence.',
      'The notification bell now announces its unread count to screen readers ("Notifications (3 unread)"), closing a keyboard-accessibility gap.',
    ],
  },
  {
    version: '2.18.1',
    title: 'Every branch has its own manager account, wired to its own workspace',
    bullets: [
      'Each branch now ships with a dedicated branch manager sign-in (juja.manager@, thika.manager@, ruiru.manager@, nairobi.manager@, nakuru.manager@mbumahhardware.co.ke), and signing in lands directly in that branch\'s workspace.',
      'The branch a manager works in comes from their account record in the database, never from the email address or anything the browser sends.',
      'Accounts that are not assigned to a branch yet now see a clear "not assigned to a branch yet" page instead of an empty console.',
      'New staff accounts of branch-bound roles must be assigned to an active branch when they are created, and every account creation is written to the tamper-evident audit trail.',
      'Older databases pick up the missing branch manager automatically on the next update; the repair and verification scripts are available for a manual check.',
    ],
  },
  {
    version: '2.18.0.2',
    title: 'Safer updates: the right release, a verified build, and honest results',
    bullets: [
      'The updater now picks releases by the project release rules: normal updates take stable releases only, and correction hotfixes install only for the version family your store is already on.',
      'Invalid or incomplete release tags (for example a hotfix whose base release is missing) are ignored and reported instead of being installed.',
      'Windows laptops now run a normal production build started the standard way, which removes the file-copy warnings some machines saw during updates.',
      'Every update verifies the build result and the database before announcing success, and rolls itself back to the previous version if anything does not add up.',
      'UPDATE_DRY_RUN=1 shows exactly what an update would do (current version, available releases, choice, reason) without changing anything.',
    ],
  },
  {
    version: '2.18.0.1',
    title: 'Windows laptops: updates now verify themselves before restarting',
    bullets: [
      'Updates on Windows laptops no longer lose invisible pieces of the build (the "EINVAL / Failed to copy traced files" warnings) - batch operations and the nightly cleanup keep working.',
      'Product photos keep loading even on machines where the image library is broken: the build now checks it and serves pictures without resizing instead of with errors.',
      'An update that did not build completely is rolled back automatically instead of announcing "update complete" and then failing to start.',
      'Closing and reopening the POS no longer repeats the same update forever, and the start window explains calmly what to check when the server exits early.',
    ],
  },
  {
    version: '2.18.0.0',
    title: 'Calmer branch links: the workspace button never opens a dead end',
    bullets: [
      '"Open branch workspace" now builds its link safely: on localhost, 127.0.0.1 and raw IP addresses it always opens the path workspace (/stores/{slug}/dashboard) instead of a subdomain address that could never load.',
      'A branch with no slug configured no longer opens a broken tab; the console shows a calm "Branch workspace unavailable" note instead, and the workspace screen explains that the store slug is not configured.',
      'The workspace screens now say exactly what is wrong: branch not found, branch inactive, no access to this branch, missing store slug, or a database schema update needed - each with the fix in plain language.',
      'Access stays enforced on the server: inactive branches are blocked, other branches stay out of reach without an assignment, and every denied attempt is recorded in the security feed.',
    ],
  },
  {
    version: '2.18.0',
    title: 'Quality audit complete: the 2.17 line, verified end to end',
    bullets: [
      'The whole 2.17 feature line passed a full audit: 507 automated tests green, a 21-check live security and workspace matrix, and a browser walkthrough of the organization console.',
      'Tenant isolation re-verified live: a cashier probing another branch\'s records gets the same quiet "not found" answer as a missing record, and the attempt lands in the security feed.',
      'Workspace routing re-verified in every hosting mode: localhost paths, branch subdomains and the organization console, with forwarded-host spoofing ignored by default.',
      'The staged updater contract re-verified: unauthenticated and malformed requests are refused, a running update blocks double starts, and the public progress endpoint exposes progress only.',
    ],
  },
  {
    version: '2.17.9',
    title: 'Calmer updates: staged installs with live progress',
    bullets: [
      'Updates now run in clear stages - download, safety checks, database backup, install, activation - and each stage is verified before the next one starts.',
      'While an update runs, the login page shows a calm progress bar: your data is safe and the page stays usable.',
      'If any stage fails, the previous version and your database are restored automatically, so the shop is never left half-updated.',
      'UPDATE_ON_START=0 in .env now skips only the internet version check; the local database safety check still runs on every start.',
    ],
  },
  {
    version: '2.17.8',
    title: 'Hardened access control: your branch data stays yours',
    bullets: [
      'Every API route that touches branch data now validates your store server-side, including request bodies and record lookups by ID, so one branch can never read or write another branch\'s data.',
      'Four integration endpoints (supplier performance, eTIMS dashboard, connection test, product registration) that were reachable without a valid session now require a signed-in manager.',
      'Cross-branch probing attempts are recorded in the security feed with the exact record and store targeted, visible to admins in the security dashboard.',
      'The server no longer advertises its framework (X-Powered-By) on any response.',
    ],
  },
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
