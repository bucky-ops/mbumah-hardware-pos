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

/**
 * Semver-aware ordering for release versions (v2.75.0): positive when `a`
 * is NEWER than `b`, negative when older, zero when equal. Component-wise,
 * missing components read as zero — '2.75' === '2.75.0'. The palette's
 * reading-state markers order releases against the shared seen flag with
 * this, so a numeric-looking string compare can never rank 2.9 over 2.10.
 */
export function compareWhatsNewVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** How the palette (v2.75.0) marks a release against the shared seen flag. */
export type WhatsNewReadState = 'latest' | 'new' | 'seen';

/**
 * The reading state of one release (v2.75.0) against the SHARED
 * mbt_seen_version flag — the same flag the footer pill and the changelog
 * modal write, so every surface tells one truth about what you've read.
 *   'latest' — the newest entry in the feed (always exactly one).
 *   'new'    — strictly NEWER than the flag: it arrived after the user
 *              last read the notes. Only claimed when the flag EXISTS —
 *              with no flag there is no reference point, and calling the
 *              whole backlog "new" would be noise, not honesty.
 *   'seen'   — everything else.
 */
export function whatsNewReadState(version: string, seenVersion: string | null): WhatsNewReadState {
  if (version === WHATS_NEW[0]?.version) return 'latest';
  if (seenVersion && compareWhatsNewVersions(version, seenVersion) > 0) return 'new';
  return 'seen';
}

/**
 * How many releases arrived after the user last read the notes (v2.75.0)
 * — the palette's group-heading counter. Same flag, same honesty rule as
 * whatsNewReadState: without a flag the count is zero (nothing provably
 * unread; the footer pill already nags for the latest).
 */
export function whatsNewUnreadCount(seenVersion: string | null): number {
  return WHATS_NEW.filter((e) => whatsNewReadState(e.version, seenVersion) === 'new').length;
}

/**
 * The version a "mark all read" write should stamp (v2.76.0): the feed's
 * head — the newest release the changelog knows. Stamping it marks the
 * whole feed read, the same one-truth write the changelog's "Got it"
 * performs against the shared mbt_seen_version flag. An empty feed has
 * nothing to stamp → null (and the palette's action simply never renders).
 */
export function whatsNewMarkAllTarget(): string | null {
  return WHATS_NEW[0]?.version ?? null;
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '2.145.0',
    title: 'The desk lens learns weekdays',
    bullets: [
      'The timesheets desk’s Weekends-only toggle completes the pair — Weekdays only shows just the working-week days, so a Monday triage reads the normal case without the weekend noise.',
      'The lens is a true day-kind filter: unreadable days stay in All days, never claimed by either side — garbage is honestly neither weekend nor weekday.',
      'Each lens member dresses as the chips it keeps — All neutral, Weekends sky, Weekdays amber — in the same joined segmented control the gate card wears.',
      'Your saved choice survives the upgrade: an old Weekends-only preference still reads as Weekends; All days clears the stored setting exactly as before.',
      'The count chip keeps speaking every pending day — the lens is a view, never a rewrite of the desk.',
    ],
  },
  {
    version: '2.144.0',
    title: 'The lens learns the other outcome',
    bullets: [
      'The Gate activity card’s Blocked-only toggle grows a third way — Passed only shows the times the gate said YES, so a clean streak is one click, not an eyeball scan.',
      'The lens is a true outcome filter: unreadable attempts stay in All, never claimed by either side — garbage is honestly neither passed nor blocked.',
      'The period picker now wears each period’s last outcome as a colour dot — green, amber, or grey — straight from the same clock-based “last” the card already speaks.',
      'The lens joins the export for free: a Passed-only CSV is the audit artifact, filtered by the same rules the card shows.',
      'The summary chip keeps speaking every attempt — the lens is a view, never a rewrite of the story.',
    ],
  },
  {
    version: '2.143.0',
    title: 'The story scopes itself',
    bullets: [
      'The Gate activity card gains a period picker — “what did the gate do in October?” is now one pick away, built from the read the card already holds, no extra fetch.',
      'The scope is a view, not a rewrite: the summary chip still speaks every attempt, and the scoped counts wear their own line — attempts, runs, and the last outcome.',
      'Any row’s period label scopes the card on click — the story narrows itself from the row you are reading.',
      'Export CSV follows the scope and the lens, and the filename says it — a scoped export never looks like the full-window export in your downloads folder.',
      'A period with no labeled runs renders no picker at all: the card never wears a dead control.',
    ],
  },
  {
    version: '2.142.0',
    title: 'The activity answers back',
    bullets: [
      'The Gate activity card gains a “Blocked only” lens — one toggle filters every attempt down to the stops, so “when did payroll last get held up?” is one glance, not a scan.',
      'The lens is a view, not a rewrite: the summary chip still speaks every attempt, and “Show all” counts what the lens shows.',
      'The card can now print itself — Export CSV downloads the whole window the read returned (counts and verdicts only, never pay data), with the lens applied.',
      'The New-run picker wears the selected period’s last-run chip — “Last run: 3 attempts · last PASSED” — built from the runs the page already holds, no extra fetch.',
      'A period with no runs, or one prepared before the trail existed, renders nothing guessed: the chip appears only when attempts actually exist.',
    ],
  },
  {
    version: '2.141.0',
    title: 'The gate tells its story across runs',
    bullets: [
      'Payroll gains a “Gate activity” card — every prepare attempt across every run, newest first, so “how has the gate behaved?” no longer means opening run after run.',
      'Movement is still marked honestly: the sky “moved” pill lands where the verdict changed from the attempt before it — chronologically, whatever run each belonged to.',
      'The read is bounded and says so: when the trail outgrows the newest 120 attempts, the card names its window instead of pretending it saw everything.',
      'The desk’s “Weekends only” lens now keeps its setting in this browser — an anomaly hunt survives navigation, and a dead storage just reads OFF, never a crash.',
      'Every attempt speaks the frozen strip’s exact words; a run with no attempts, a failed read, and an empty trail each get their own honest line.',
    ],
  },
  {
    version: '2.140.0',
    title: 'The desk finds its weekends',
    bullets: [
      'The timesheet desk gains a “Weekends only” lens — one toggle filters every day strip to its Saturday and Sunday chips, so “who worked the weekend?” no longer needs counting amber bits by eye.',
      'The lens is a view, not a data change: the count chip still speaks every pending day, and a row with no weekend days says so instead of vanishing.',
      'The run dialog’s frozen verdict now wears the same attempts chip the runs table has — “3 attempts · last PASSED” — built from the trail the dialog already holds.',
      'A run with no gate trail still renders nothing guessed: the chip appears only when attempts actually exist.',
      'The payroll lifecycle doc now names all six gate contracts in one place — frozen verdict, trail, attempt chip, desk, batch receipt, and the lens.',
    ],
  },
  {
    version: '2.139.0',
    title: 'The table counts the attempts',
    bullets: [
      'Runs table rows now wear an attempts chip beside the frozen verdict — “2 attempts · last PASSED” — so “how did this run get here” needs no dialog.',
      'The chip’s tone follows the last attempt: emerald passed, amber blocked, muted unknown — and a run with no trail stays silent, never a guessed count.',
      'The timesheet desk gains “Approve all”: every pending row cleared through the same audited per-employee approval, walked one at a time — never a bulk write.',
      'The batch keeps an honest count (“Approving 2/6…”) and ends with a receipt that names every failure, so a partial batch is never mistaken for a clean one.',
      'The full per-attempt story still lives in the run dialog’s Gate trail — the chip points there; the table just answers first.',
    ],
  },
  {
    version: '2.138.0',
    title: 'The verdict keeps its every attempt',
    bullets: [
      'The run dialog now carries a Gate trail: every prepare attempt appends one row \u2014 what the gate said, whether it passed or blocked, who ran it, and when.',
      'When the verdict moves between attempts (a consent granted, a timesheet approved), the row wears a \u201cmoved\u201d marker \u2014 the story is history now, not folklore.',
      'Blocked attempts join the trail too: a stopped prepare leaves its row, so the record shows the stop and the recovery, not just the success.',
      'The run gate\u2019s snapshot and its trail row freeze the same moment, in the same transaction \u2014 parity by construction, never a re-read.',
      'On the timesheet desk, weekend chips wear a sky tint \u2014 a Saturday punch stands out from the working week at a glance.',
    ],
  },
  {
    version: '2.137.0',
    title: 'The picker sees the gate',
    bullets: [
      'The \u201cStart a payroll run\u201d dialog no longer lists periods blind: each period now wears the gate\u2019s pending counts as chips \u2014 \u201c3 unapproved days\u201d, \u201c1 missing consent\u201d \u2014 before you create anything.',
      'The selected period speaks a compact preview line under the picker, and when days are pending it carries the amber door straight to the timesheet desk.',
      'The timesheet desk\u2019s pending list now exports: one CSV, one row per employee, the exact days \u2014 same RFC 4180 discipline as the case list and access ledger exports.',
      'The export carries codes, names, and days only \u2014 no pay column exists in the file format, so it can never become a payslip preview or an approval by spreadsheet.',
      'A failed preview read says \u201cunavailable\u201d instead of guessing, and never takes the periods list down with it.',
    ],
  },
  {
    version: '2.136.0',
    title: 'The second door finds its desk',
    bullets: [
      'Timesheet blocks finally have a fix you can click: a new Timesheets desk (/hr/timesheets) lists every employee with unapproved days, grouped the same way the run gate groups them.',
      'The gate\u2019s amber TIMESHEET_NOT_APPROVED row now carries its own door \u2014 it opens the desk straight onto that employee\u2019s row, same as the consent door has done since v2.135.0.',
      'Each row shows the exact pending days as chips (\u201cMon 05\u201d, \u201cTue 06\u201d\u2026) so you approve what you can see; overflow reads \u201c+N more\u201d rather than hiding days.',
      'Approve stamps that employee\u2019s whole pending range through the same audited service payroll re-checks on prepare \u2014 one button, no double-stamp while it runs.',
      'Scope the desk to any payroll period (newest open period by default) or read all pending days across every period.',
    ],
  },
  {
    version: '2.135.0',
    title: 'The verdict leaves a paper trail',
    bullets: [
      'The run gate\u2019s verdict now freezes onto the run at prepare time \u2014 what the gate said when THIS run went through (or was stopped) becomes auditable history, not folklore.',
      'Every run row on the payroll desk wears its verdict: \u201c5 clear \u00b7 19 Oct 12:30 EAT\u201d in emerald, block counts in amber \u2014 stamped from prepare\u2019s own gate loop, parity by construction.',
      'The run detail dialog speaks the same frozen strip, and says plainly when a run predates the paper trail (v2.135.0) instead of guessing a verdict.',
      'A missing-consent verdict now carries its own fix: the blocked row links straight to the Privacy tab\u2019s consent ledger, in its own tab, so diagnosis joins its repair.',
      'Honest absences stay silent: runs prepared before v2.135.0 render no verdict anywhere \u2014 the desk never invents history.',
    ],
  },
  {
    version: '2.134.0',
    title: 'The gate opens onto empty months',
    bullets: [
      'A period with no runs yet now renders on the payroll desk as a pre-flight row — it used to render nowhere, so the run gate\u2019s front door was locked exactly before the first run of the month.',
      'Each pre-flight row carries the SAME Gate door the period headers carry: who would be blocked, before anyone tries \u2014 read-only, no run created.',
      'The row speaks the month\u2019s own words: its lifecycle chip (OPEN emerald, VOIDED amber), its date range, and an honest \u201cpay date not set\u201d when no pay date exists.',
      'Newest month leads; the verdict is the same mirror-of-prepare report v2.133.0 pinned \u2014 one gate, two doors.',
      'Read-only by construction: the read never prepares, posts, or computes \u2014 it only asks who the gate would stop.',
    ],
  },
  {
    version: '2.133.0',
    title: 'The gate speaks first',
    bullets: [
      'The payroll desk can now ask the run gate who it would block BEFORE anyone tries — a pre-flight read per period, on the period header beside the Ledger door.',
      'The verdict mirrors the run\u2019s own guardrails line for line: same consent gate, same timesheet gate, same order \u2014 pinned by tests so the gate can never drift from the run it protects.',
      'Counts speak first (clear / missing consent / timesheet pending), blocked employees speak in prepare\u2019s own words, and an employee failing both gates says which one prepare would report first.',
      'A voided period says runs are closed instead of pretending to check; a failed read renders an honest rose strip with a Retry.',
      'Read-only by construction: no run is created, no payslip computed \u2014 seeing the gate is part of reading the desk.',
    ],
  },
  {
    version: '2.132.0',
    title: 'The columns bend, the branch files itself',
    bullets: [
      'The consent ledger grew a branch-level export: every in-scope employee\u2019s consent cycles in ONE flat CSV \u2014 the export-honesty theme\u2019s fourth beat (case list \u2192 access ledger \u2192 one timeline \u2192 the whole branch).',
      'The file is the drawer\u2019s own serializer and columns \u2014 who, when, what purpose, which policy, how long stood; never content, and a standing consent still files with empty withdrawn/stood cells.',
      'Report tables learned to bend: drag a column\u2019s right edge to resize it \u2014 the EMS spec\u2019s last unsatisfied table affordance \u2014 and double-click the edge to reset.',
      'Widths persist per browser under their column key: two tables sharing a \u201cPeriod\u201d column share their width on purpose, and the desk remembers after a reload.',
      'A failed export speaks too: a rose \u201cnothing was downloaded\u201d line replaces the button\u2019s silence.',
    ],
  },
  {
    version: '2.131.0',
    title: 'The reports speak their failures',
    bullets: [
      'Every report desk learned what the Privacy tab knew last release: a failed load shows a rose error strip with a Retry \u2014 never an eternal skeleton.',
      'One strip family across the whole reports surface: the privacy desks and the eight report tabs share the same honest frame, warning glyph included.',
      'Refresh and Retry buttons spin while the fetch runs \u2014 a slow or dead API can never read as a dead button.',
      'Every loaded report stamps WHEN its numbers were fetched (Updated HH:MM) \u2014 no stamp means not fetched yet.',
    ],
  },
  {
    version: '2.130.0',
    title: 'The timeline files its copy',
    bullets: [
      'The consent timeline drawer grew an Export CSV door \u2014 the ledger\u2019s own columns (who, when, what purpose, which policy, how long it stood), never more.',
      'A standing consent files as STANDING with empty withdrawn/stood cells \u2014 an open consent has no honest day count to write down.',
      'The Privacy tab speaks its failures: a card whose ledger fails to load now shows a rose error strip with a Retry button \u2014 never an eternal \u201cLoading\u2026\u201d spin.',
      'Exports stay content-free by construction: the row type has no field for anything the card does not already show.',
    ],
  },
  {
    version: '2.129.0',
    title: 'The ledger shows its timeline',
    bullets: [
      'Consent history is now readable: a History button on every Privacy-tab consent row opens that employee\u2019s full consent timeline.',
      'The timeline reads like a ledger \u2014 cycle by cycle, oldest first: what was granted, when it was withdrawn, how many days it stood, and whether it still stands.',
      'Re-grants wear their own indigo marker on the timeline, so the \u201cre-granted \u00d7N\u201d chip now has a door behind it.',
      'History is a read, not a decision: every viewer of the ledger can open it, and the drawer never alters the record \u2014 append-only, nothing edited or deleted.',
    ],
  },
  {
    version: '2.128.0',
    title: 'The record stands corrected',
    bullets: [
      'The audit-coverage inventory\u2019s one named gap was a false finding \u2014 portal-account linking has been audit-logged since v2.39.0; the doc now says so with evidence you can re-run.',
      'The consent ledger shows its history: a consent that was withdrawn and re-granted wears an indigo \u201cre-granted \u00d7N\u201d marker on the Privacy tab.',
      'Earlier consent records stay on file (append-only) \u2014 the marker\u2019s tooltip counts exactly how many.',
      'Audit coverage now claims 98 audited call sites across 30 files with zero gaps \u2014 and the method that let a false gap claim slip through is written down.',
    ],
  },
  {
    version: '2.127.0',
    title: 'The desk says goodbye',
    bullets: [
      'Withdraw… joins the desk: when a candidate pulls out, the pipeline records their exit as WITHDRAWN instead of leaving them movable forever.',
      'Withdrawal is honoured as the candidate\u2019s own decision — the note is optional and rides the audit log, and their data starts the same 90-day retention clock a rejection does.',
      'Withdrawn candidates read as history: a slate badge, a muted row, and an italic \u201cwithdrew from the process\u201d line — no buttons that would 403.',
      'The audit trail now has a published coverage inventory (docs/EMS_AUDIT_COVERAGE.md): every mutation accounted for — audited, deliberately silent, or named as a gap.',
      'Security headers and rate-limit tiers are documented in the RBAC matrix, so the defences a reviewer can probe are written down, not tribal knowledge.',
    ],
  },
  {
    version: '2.126.0',
    title: 'The pipeline shows its steps',
    bullets: [
      'Record stage… replaces the old one-click jump: pick the real stage (screening through offer), its outcome, and optional notes — the desk writes what it observed, never what it skipped to.',
      'One live offer per candidate: the API refuses a second draft while one is pending approval, so no offer gets silently orphaned.',
      'Sent offers stay visible — the pipeline row now shows the terms ("Offer sent 2026-10-19 · KES 32,000") instead of letting them vanish.',
      'Closed jobs print when they closed, right in the job list.',
      'Stage lists and rejection retention are single-sourced in the policy module — the desk, the API, and the tests read one truth.',
    ],
  },
  {
    version: '2.125.0',
    title: 'The desk starts hiring',
    bullets: [
      'Recruitment is now fully operable — a permission drift had quietly locked every role out of the desk. Open a job, register a candidate with consent, walk the pipeline, and hire; every step is audited.',
      'Candidates that go nowhere can finally leave the pipeline: Reject… asks for a reason (it rides the audit log) and keeps their data 90 days before anonymisation.',
      'Jobs no longer live forever — Close… stops intake on open jobs while keeping their history visible.',
      'Offer terms are never invented: drafting an offer demands the real monthly salary and start date, with empty inputs.',
      'Readers see an honest read strip and live counts (open jobs, in pipeline, hired) instead of buttons that would refuse them.',
    ],
  },
  {
    version: '2.124.0',
    title: 'The broom answers the desk',
    bullets: [
      'The retention desk grows a Sweep now door — a settings manager can run the nightly sweep early instead of waiting for the cron, using the exact same audited function.',
      'Anonymising now is destructive, so it asks twice: the confirm row quotes the live backlog ("N rows would be anonymised immediately") before Confirm sweep.',
      'The outcome reports in the card\u2019s own note, per scope — "Sweep ran — 2 rows anonymised (2 applicant records)", with held scopes named as skipped.',
      'After the run the desk refetches, so the dry-run counts drop to the honest zero the sweep just made true.',
      'The door only appears for settings managers — everyone else sees the desk exactly as before, never a button that would refuse them.',
    ],
  },
  {
    version: '2.123.0',
    title: 'The sweep shows its hand',
    bullets: [
      'The retention desk grows a Next sweep column — a dry run that counts what the next nightly run would anonymise per scope, changing nothing.',
      'One source of truth: the preview counts with the exact same criteria the sweeper executes, so the desk and the sweep can never disagree about what is in scope.',
      'A second counts strip line answers the backlog plainly — "N rows would be anonymised on the next nightly run", with an honest "nothing to sweep tonight" when every scope sits inside its window.',
      'Rows waiting behind a legal hold stay visible ("N waiting behind the hold", amber) — the hold freezes the sweep, not the truth about what releasing would unblock.',
      'Backlogs over 500 say so: the sweep takes up to 500 rows per night, and the strip admits the pacing instead of letting a big number imply a one-night finish.',
    ],
  },
  {
    version: '2.122.0',
    title: 'The hold takes the desk',
    bullets: [
      'The Privacy tab grows its third posture card: Retention & legal holds — the reviewable windows the nightly sweep works through (applicant rejections, closed discipline, attendance), each with its legal basis in plain sight.',
      'A legal hold pauses one scope with one click; the nightly sweep skips it until a settings manager releases it. Setting and releasing are both audit-logged on the exact setting row the sweeper reads.',
      'Releasing asks twice — the sweep resuming is the destructive direction, so the confirm row says exactly what happens next: the scope\u2019s expired records are swept again on the next nightly run.',
      'The counts strip answers \u201cN of 3 scopes on hold\u201d at a glance, amber-tinted when any scope is paused; idle scopes wear an honest \u201cSweeping nightly\u201d chip instead of silence.',
      'Decisions stay with settings managers \u2014 everyone else reads the desk and sees the muted \u201csettings managers decide\u201d truth, the same gate that decides erasures and consent records.',
    ],
  },
  {
    version: '2.121.0',
    title: 'The roster reads the room',
    bullets: [
      'The Employees page now answers the payroll run\u2019s consent question at a glance: every roster row wears its consent chip \u2014 Active, Withdrawn, or None on file \u2014 without a detour to the Privacy tab.',
      'The chips speak the Privacy tab\u2019s exact vocabulary (emerald / amber / slate), so a color never means two things \u2014 and every chip\u2019s tooltip says its MISSING_CONSENT truth aloud.',
      'A counts strip joins the filter bar: \u201cN active \u00b7 W withdrawn \u00b7 M without consent\u201d, with the without-consent phrase rose-tinted when nonzero \u2014 those are the next run\u2019s blockers.',
      'The overlay degrades honestly: if your role can\u2019t read the consent ledger, the column and counts hide entirely \u2014 absence of the view is never rendered as absence of consent.',
      'Refresh the list and the consent view refreshes with it \u2014 one source of truth, read in two places.',
    ],
  },
  {
    version: '2.120.0',
    title: 'The roster captures its consent',
    bullets: [
      'The Employees page can finally onboard: a guided form creates the record — name, job title, employment type, hire date, pay — no raw API calls required.',
      'One honest checkbox files the new hire\u2019s payroll-processing consent (hr-policy-2026-01) through the same audited path the Privacy tab uses, so their first run never blocks on MISSING_CONSENT.',
      'The outcome speaks plainly: \u201cConsent captured\u201d in emerald with the policy and date, or \u201cNo consent on file\u201d in amber \u2014 with the truth that the next run will flag MISSING_CONSENT until it\u2019s granted.',
      'A consent glitch never loses the hire: the employee stays created, the outcome turns rose with the reason, and the pointer lands on the Privacy tab.',
      'The onboard door only appears for roles the server has actually cleared to hire \u2014 the same permission key decides both the button and the API.',
    ],
  },
  {
    version: '2.119.0',
    title: 'Consent works',
    bullets: [
      'The Privacy tab grows a Consent records ledger: every in-scope employee\u2019s data-processing consent state \u2014 Active, Withdrawn, or None on file \u2014 with the policy version and the dates, in one batched read.',
      'Consent finally has decisions: Grant writes a NEW record (append-only \u2014 a withdrawn consent keeps its row and its dates) and Withdraw stamps withdrawnAt on the active ones; both are reserved to settings managers and both are audit-logged.',
      'The payroll gate is finally served by the product: the run check reads an active consent per employee and reports MISSING_CONSENT when none stands \u2014 the counts line tints the \u201cN without consent\u201d rose so the next run\u2019s blockers are visible before you run payroll.',
      'Status folds ALL consent records, not just payroll\u2019s: any active record passes the gate, so the chip you see is the answer the run check will compute.',
      'Grant after withdraw is honest history: the superseded record stays put, the new grant carries the current policy version \u2014 consent is a trail, not a toggle.',
    ],
  },
  {
    version: '2.118.0',
    title: 'The ledger files its copy',
    bullets: [
      'The Restricted access ledger exports: a CSV door on the ledger card writes the filtered window to access-ledger-YYYY-MM-DD.csv \u2014 the same columns the screen shows (when, event, who, which case), in the same RFC 4180 file the case list has used since v2.115.0.',
      'The export stays content-free by construction: case descriptions and resolution notes have no column and the row type has no field for one \u2014 an export can never carry more than the screen it came from.',
      'The event column speaks the chips\u2019 language: OPEN for granted reads, DENIED for refused attempts \u2014 derived from the same boolean the chips wear, never from a free-text action string.',
      'The counts line now emphasizes refused attempts: when a window holds denials, the \u201cN denied\u201d phrase wears a rose tint with its own tooltip \u2014 refusals are the part a reviewer scans for.',
      'Export what you filtered: the CSV maps the FILTERED rows (event filter and window included), so the file always matches the counts line it was exported from.',
    ],
  },
  {
    version: '2.117.0',
    title: 'The ledger reads the room',
    bullets: [
      'The discipline desk grows a Restricted access ledger: every open of a restricted record \u2014 and every refused attempt \u2014 across ALL your cases in one read-only view, newest first.',
      'Ask narrower: the window selector (last 7 / 30 / 90 days) is server-clamped, and an event filter splits opens from denied attempts \u2014 the counts line always says exactly what you are looking at.',
      'Rows are doors: opening a case from the ledger is itself a logged restricted read \u2014 the trail proves it, and the ledger shows it on refresh.',
      'The ledger is content-free like the trail: who, when, and which case\u2019s employee \u2014 never the description; names that cannot resolve say \u201can unknown user\u201d instead of guessing.',
      'Times read like a desk, not a server log: rows say \u201cjust now\u201d, \u201c4h ago\u201d or \u201c2d ago\u201d (calendar-day honest) with the exact date on hover.',
    ],
  },
  {
    version: '2.116.0',
    title: 'The trail reads back',
    bullets: [
      'Opening a restricted grievance now shows its access trail: who last opened the record before you, when, and how many prior opens the audit trail holds \u2014 the loop v2.115.0 started (writing the trail) closes where the decision happens.',
      'Denied attempts read back too: if anyone outside the confidentiality allow-list ever reached for the record, the trail counts the refusals beside the granted reads \u2014 visible to the reader the audit concerns.',
      'The case list wears its history: restricted rows carry a compact \u201cN opens\u201d chip (honest at zero), so a record that has been quietly opened many times is visible before you click it.',
      'The trail stays clean by construction: it names who and when, never the description \u2014 the summary is folded from the same audit events the security log already holds, with no new place for sensitive text to live.',
      'First view says so: a restricted record with no prior trail honestly reports \u201cthis is the first logged view\u201d instead of pretending history exists.',
    ],
  },
  {
    version: '2.115.0',
    title: 'The restricted read leaves a trace',
    bullets: [
      'Grievance confidentiality grows teeth you can see: opening a RESTRICTED record now writes an audit event naming who viewed which case and when \u2014 the trail proves the access happened without ever copying the description into the log.',
      'A denied attempt is traceable too: if a role outside the confidentiality allow-list ever reaches for a restricted record, the refusal is logged beside the granted reads \u2014 defence in depth that records, not just blocks.',
      'The discipline desk matures: search cases by employee, filter by type (warning, grievance, investigation), and a live counts line \u2014 \u201cN of M cases shown \u00b7 R restricted\u201d \u2014 so the surface summarizes itself before you scroll.',
      'Expiring warnings wear their countdown: an OPEN warning inside 14 days shows an amber \u201cin Nd\u201d chip beside its date (past-due never shows \u2014 the sweep retires those before the list is built).',
      'The case list exports honestly: the CSV door carries exactly the list\u2019s columns \u2014 id, employee, type, severity, status, confidentiality, dates \u2014 descriptions have no column and can never ride along.',
    ],
  },
  {
    version: '2.114.0',
    title: 'The assets half of the alert opens its door',
    bullets: [
      'The People & Payroll panel\u2019s expiry count is now two doors: the documents half opens the branch\u2019s employees list (2.113.0), and the overdue-assets half opens the branch\u2019s Assets page pre-filtered to returns past due \u2014 /hr/assets?overdue=1&storeId=<id>, one click from the alert to the follow-up.',
      'The door lands on the number the alert promised: the assets list\u2019s overdue window mirrors the panel\u2019s own definition exactly (assigned with the return date in the past), so the count you clicked is the count you see \u2014 one definition, two homes.',
      'Scope stays fail-closed: the assets list honors an explicit branch only for org-scope roles whose organization owns it (or whose session store matches); everyone else keeps their own store and an honest notice says when the answer came from somewhere else.',
      'The Assets page grows an \u201cOverdue only\u201d toggle with the same amber manners as the employees list\u2019s expiring-documents toggle \u2014 link-seeded \u201c(from link)\u201d until first touch, filters mirrored into the URL so the view stays shareable, and a live assignment count.',
      'Every door is gated on exactly the roles the list answers: accountants keep the honest text (payroll + reports is their grant), owners and HR managers get the door \u2014 never a link that 403s.',
    ],
  },
  {
    version: '2.113.0',
    title: 'The dead columns open their doors; the HR roster finally exists',
    bullets: [
      'The People & Payroll panel\u2019s last two dead columns learned to move: the latest-run cell opens that run\u2019s detail dialog on /hr/payroll (?run=<id>), and the expiry-alerts count opens the branch\u2019s employees list pre-filtered to expiring documents. One glance, one click, one audit trail \u2014 no hunting.',
      'The expiry count splits honestly: documents are the door; overdue assets stay text (the assets list is session-scoped \u2014 the panel never promises a cross-branch view it cannot open). Zero halves never render as links, and stale summaries without a run id degrade to the same text as before.',
      'The HR workspace\u2019s Employees page now EXISTS \u2014 QA found the nav\u2019s oldest link landing on a 404; this release builds the list: search, status filter, an expiring-documents toggle, mobile cards, and rows that open the employee record.',
      'Scope stays fail-closed: the list honors an explicit branch only for org-scope roles whose organization owns it; everyone else keeps their own store and an honest notice says when the answer came from somewhere else. Expiring counts ride the same window the panel counts \u2014 one definition, two homes.',
      'The payroll page consumes ?run= as a lazy seed and strips it once on mount \u2014 a refresh never re-opens a stale dialog, and the dialog\u2019s own fetch fail-closes when a run is not yours to see.',
    ],
  },
  {
    version: '2.112.0',
    title: 'The branch picker hands you the payroll ledger',
    bullets: [
      'Branch listings grow a People & payroll affordance — on the Branch Selector\u2019s cards AND the Organization Console\u2019s Branches table: one click opens the home workspace on the People & Payroll tab, already narrowed to that branch. The deep link finally has its natural front doors, where branches are actually browsed.',
      'The affordance is honest by construction: it renders only for the roles the People & Payroll tab itself honors (owner, admin, accountant), so it can never promise a view the role would be refused.',
      'Each link opens in its own tab, exactly like Open workspace \u2014 the selector stays available, and the spec\u2019s one-tab-per-view pattern holds.',
      'The cards learned some manners: a quiet hover lift, the branch\u2019s own color ringing its dot, and a visible focus path for keyboard users \u2014 the same respect in light and dark.',
      'October\u2019s BONUS run completed the last leg of the lifecycle this release: disbursed by hand, every payslip marked PAID, the payroll group notified \u2014 prepare, approve, post, disburse, all walked in the open.',
    ],
  },
  {
    version: '2.111.0',
    title: 'The app speaks deep links; every settled run opens its door',
    bullets: [
      'Share a view, not a story: /?tab=people-payroll&branch=<id> opens the app on the People & Payroll tab already narrowed to that branch \u2014 the tab param is consumed once at boot, the branch filter mirrors into the URL as you change it, and leaving the tab strips it so nothing stale haunts the next visit.',
      'The (from link) hint is honest: it shows only while the filter still holds the link\u2019s value \u2014 your first manual change retires it for good.',
      'The ledger drawer\u2019s settled-run chips are now doors: a zero-run chip or a missing-journal chip opens that run\u2019s full detail dialog \u2014 one drawer closes, one opens, never two stacked \u2014 so an audit starts from the line, not from a hunt.',
      'The missing-journal alarm\u2019s chips wear rose and open the same way: investigating \u201cthis must never happen\u201d is now one click from the alarm itself.',
      'October\u2019s BONUS run walked the whole maker-checker path this release: approved by a different actor than its preparer, posted with its journal, and the period drawer now carries three entries plus the quiet zero run \u2014 the lifecycle proven end to end.',
    ],
  },
  {
    version: '2.110.0',
    title: 'The drawer knows a zero when it sees one',
    bullets: [
      'The payroll ledger drawer stops crying wolf: a settled run with nothing payable (KES 0.00) rides its own quiet block \u2014 \u201cnothing was payable, so no journal posts\u201d \u2014 instead of firing the red missing-journal alarm every open.',
      'The alarm keeps its teeth: a settled run that owed MONEY without an entry is still flagged \u201cthis must never happen\u201d \u2014 the split is value-aware at 2dp precision, so float dust can never fake a zero or fake a debt.',
      'The People & Payroll panel grows a branch filter: pick one branch from the select, see \u201cshowing 1 of 5\u201d, hit Reset for the whole org \u2014 it lives inside the shared panel, so the Finance & Insights tab and the Expert Console both get it.',
      'Filtering narrows, never reorders: the desktop table and the mobile cards render exactly the same filtered truth, with an honest empty state when nothing matches.',
      'The period-journal API now carries each run\u2019s payable truth (totalNet) \u2014 the drawer\u2019s classification reads the server\u2019s numbers, never a guess.',
    ],
  },
  {
    version: '2.109.0',
    title: 'People & payroll joins Finance & Insights',
    bullets: [
      'The People & payroll by branch panel now lives in the main app\u2019s Finance & Insights group: per-branch headcount, employment cost, absence, latest run and expiry alerts, without leaving the POS shell.',
      'One shared panel serves both homes (the new tab and the Expert Console) from the same /api/org/summary truth \u2014 and when the server answers without the HR block, the tab says exactly why instead of going blank.',
      'The Expert Console grows a Home button: one click returns to the POS workspace, through one internal navigation helper \u2014 no open redirects, no lost context.',
      'Branch Selector, Organization Console, Expert Console and Global Chat now follow the Admin module, in that order, each wearing its own icon (Building2, Network, Gauge, MessagesSquare).',
      'Both consoles now render through one shared shell with one Home helper and one panel \u2014 the parity matrix in docs/ records where every feature lives.',
    ],
  },
  {
    version: '2.108.0',
    title: 'The chart files its year',
    bullets: [
      'The bundle exit grows a second door: File the year \u2014 one zip files EVERY account that posted in the calendar year as its own movement CSV, and year-end stops being twelve downloads.',
      'The year door shows no count on purpose: the client only knows the month\u2019s badges, and a guessed number could disagree with the archive \u2014 the MANIFEST inside says exactly how many were filed and how many were quiet.',
      'Every member CSV says its own word: \u2018starts the year at zero\u2019, \u2018Year totals\u2019, a filename carrying the year \u2014 the same loop-closing honesty the month files serve.',
      'The remembered accounts can now be let go: a quiet Clear button on the Recent row forgets this browser\u2019s chips \u2014 the chart itself is never touched.',
      'Same read roles as the ledger itself (HR, branch managers, owners, accountants) \u2014 filing a year of what you may read widens nothing.',
    ],
  },
  {
    version: '2.107.0',
    title: 'The chart files its month',
    bullets: [
      'The browse door gains a governed exit: one zip files EVERY account that posted this month as its own movement CSV \u2014 month-end stops being thirty-seven downloads.',
      'MANIFEST.txt rides first: what was filed, how many lines each account posted, and how many quiet accounts were left out and why \u2014 the archive says what it did, without the console.',
      'Quiet is a fact, not a file: an account with no posted lines produces no CSV (the single route already says no), and the manifest carries the count instead of pretending.',
      'The zip is written in-house, store-only and byte-auditable: CRC-32 per entry, UTF-8 names, and each CSV still closes its own loop \u2014 its Closing line equals its last replay row.',
      'Same read roles as the ledger itself (HR, branch managers, owners, accountants) \u2014 filing what you may read, all at once, widens nothing.',
    ],
  },
  {
    version: '2.106.0',
    title: 'The picker remembers and browses',
    bullets: [
      'The account picker now opens on focus, not only on typing: the accounts you asked for last time come back as violet chips \u2014 remembered in this browser only, one click from the drill.',
      'Browse the whole chart: one door lists every account in the organization, grouped by type, each wearing its truth \u2014 in this month with the posted-line count, or quiet.',
      'Memory follows the chart: only codes the index knows are remembered, a chart that fails to load stays honest by absence, and typing a code still asks the ledger.',
      'Keyboard first, layered Esc: \u2191\u2193 to move, Enter to open, and Esc steps back \u2014 browse, then box, then drawer.',
      'Same read roles as the ledger itself (HR, branch managers, owners, accountants) \u2014 remembering what you may read widens nothing.',
    ],
  },
  {
    version: '2.105.0',
    title: 'The ledger answers for any account',
    bullets: [
      'The ledger drawer grows an account picker: type any code or name \u2014 not just the lines this period posted \u2014 and the same movement drill opens, month first, year one click away.',
      'The chart rides the picker: every account in the organization lists as you type, ranked exact code first, then prefix, then name \u2014 and each suggestion wears its badge: in this month with the posted-line count, or quiet.',
      'Quiet is a fact, not an error: an account with no lines in the period is still askable, and the drill will say what it finds \u2014 starting at zero, honestly.',
      'Keyboard first: \u2191\u2193 to move, Enter to open, Esc to dismiss \u2014 and an unknown code pushed into Enter still asks the ledger and gets an honest no.',
      'Same read roles as the ledger itself (HR, branch managers, owners, accountants) \u2014 listing who may be asked widens nothing.',
    ],
  },
  {
    version: '2.104.0',
    title: 'The account opens its year',
    bullets: [
      'The account movement dialog grows a window switch: This month or Full year — one click and the account\u2019s whole year replays, opening honest over every posted line before January, any source.',
      'The year at a glance: twelve calendar cells above the replay, each carrying the running balance at the month\u2019s end — quiet months leave the balance carried forward and say so, active months wear the violet ring.',
      'A balance on the other side of the T-account keeps the amber eyebrow everywhere — the one state you should never scroll past, now impossible to miss even in a twelve-cell strip.',
      'The Movement CSV files either window through the same governed format: a year filing says "starts the year at zero" and "Year totals", and its Closing line still equals the last replay row.',
      'Same read roles as the ledger itself (HR, branch managers, owners, accountants) — reading the year of what you may read widens nothing.',
    ],
  },
  {
    version: '2.103.0',
    title: 'The account files its month',
    bullets: [
      'The account movement dialog grows the governed Movement CSV exit: the month\u2019s replay files through the same format every HR report, the desk report and the period ledger file through \u2014 one click in the footer, no screenshot bookkeeping.',
      'One row per replay line \u2014 posted day, entry number, source, debit, credit \u2014 and an Opening / Month totals / Closing footer whose Closing line equals the last replay row: the file closes its own loop.',
      'Balances file the accountant\u2019s way \u2014 258000.00 Dr, 70414.80 Cr, never a bare negative \u2014 and an assumed normal side is filed as assumed, never silently picked.',
      'The file names its account and period (mbumah-account-movement-5200-salaries-expense-october-2026.csv) and lands an audit row that says what was filed, never who is in it.',
      'Nothing posted inside the window means nothing to file \u2014 and a balance that sits on the other side of the T-account now wears the amber eyebrow on screen, the one state you should never scroll past.',
      'Same read roles as the ledger itself (HR, branch managers, owners, accountants) \u2014 filing what you may read widens nothing.',
    ],
  },
  {
    version: '2.102.0',
    title: 'The account opens its month',
    bullets: [
      'Every ledger line is a door now: click an account and its month movement opens beside the drawer \u2014 opening balance, each posted line in chronological replay, and a running balance that tells the story forward.',
      'The opening is honest: it sums every posted line the account carries before the window \u2014 sales, payments, payroll, every source \u2014 or says plainly that the account starts the month at zero.',
      'Balances read the way an accountant reads a T-account: Dr for debit-normal accounts, Cr for credit-normal, the side letter instead of a bare negative.',
      'Voided entries stay closed doors and in-motion entries do not exist yet \u2014 the replay counts only what actually posted, the same honesty the ledger drawer taught.',
      'Same read roles as the ledger itself (HR, branch managers, owners, accountants) \u2014 reading what an account posted widens nothing.',
    ],
  },
  {
    version: '2.101.0',
    title: 'The ledger files itself',
    bullets: [
      'The period ledger drawer grows the governed CSV exit: the month\u2019s journal entries file through the same format every HR report, the desk report and the performance lists file through \u2014 one click in the footer, no screenshot bookkeeping.',
      'One row per journal line \u2014 entry number, posted day, run type, account code, account name, account type, debit, credit \u2014 and a Totals line that proves the file balances by itself.',
      'The file names its period (mbumah-period-ledger-october-2026.csv) and lands an audit row that says what was filed, never who is in it.',
      'Nothing posted means nothing to file: the button rests with that reason, the same honesty the bench taught the performance family.',
      'Same read roles as the ledger itself (HR, branch managers, owners, accountants) \u2014 filing what you may read widens nothing.',
    ],
  },
  {
    version: '2.100.0',
    title: 'The period opens its ledger',
    bullets: [
      'Every payroll period header carries a Ledger button now — the month\u2019s journal entries open right beside the runs, no navigation to the accounting module, no losing your place.',
      'Each entry shows its lines: account code, account name, debit, credit — and a Balanced chip proves the arithmetic at money precision before you trust it.',
      'Runs still in motion stay honest in the drawer: counted as waiting, never priced — the entry posts when the run posts.',
      'Same read roles as the runs table itself (HR, branch managers, owners, accountants) — reading what a period posted widens nothing.',
      'Light and dark, printable: the drawer never joins a printed page, the way every panel in the console already behaves.',
    ],
  },
  {
    version: '2.99.0',
    title: 'The bench files itself',
    bullets: [
      'The filing family completes: the Recently deleted bench grows the same CSV button the reviews, cycles and goals lists carry — every performance surface a manager can look at now files too.',
      'The file tells the whole exit story: goal, employee, cycle, source, values, progress — and the Deleted day stamp, so reconciling the bench against a cycle or an audit never means guessing when a goal left.',
      'Honest window: the bench shows the 50 most recent deletions, and when that cap bites, the file\u2019s header says \u201cmost recent 50 deletions\u201d instead of silently posing as the whole bench.',
      'The button rests with a reason: an empty bench disables the export (\u201cNothing to file — the bench is clear\u201d), and every download lands an audit row that says what was filed, never who is in it.',
    ],
  },
  {
    version: '2.98.0',
    title: 'Payroll runs read as periods',
    bullets: [
      'The runs table regroups itself: every payroll period is one header row with its runs folded underneath — “October 2026” says its name once, and four runs read as one month’s story instead of four repeated lines.',
      'The header does the arithmetic: settled net, payslips issued, and a status rollup (settled · waiting · need attention · voided) land where the eye does — no mental math across rows.',
      'Honest money: only posted and locked runs count toward the header’s totals — a draft or a pending approval is an estimate and never sneaks into the settled number.',
      'Periods fold: collapse the months you are not working on, expand the one you are — collapsed headers keep their counts, so a folded month never goes silent.',
      'One click anywhere on the header row opens or closes the month, and a Collapse all / Expand all affordance tidies the whole ledger at once.',
    ],
  },
  {
    version: '2.97.0',
    title: 'Every performance list files itself',
    bullets: [
      'The family completes: the Cycles and Goals tabs grow the same CSV button the Reviews tab got \u2014 the exact rows on screen download as the governed filing file, header block and injection guard included.',
      'The cycles file keeps the manager\u2019s calibration notes out: the file carries the meter\u2019s counts, never the private notes \u2014 the same construction-level privacy the reviews file gives ratings.',
      'The goals file rides your filters: employee, source and status chips steer the download, and the file always matches what the board shows \u2014 never more, never less.',
      'One button, one story: every CSV downloads with an honest name (mbumah-performance-\u2026csv) and lands an audit row that says what was filed, never who is in it.',
    ],
  },
  {
    version: '2.96.0',
    title: 'The performance page files itself',
    bullets: [
      'The Reviews tab grows a CSV button: the exact filtered rows on screen download as the governed filing file \u2014 header block, formula-injection guard, honest filename \u2014 the same format every HR report files through.',
      'The file only ever carries what a list may say: names, cycle, status, dates. Ratings and narratives stay behind the gated dialog, in the file too.',
      'The bench remembers the cycle: recently deleted goals now show which review cycle they were filed under, so reconciling the bench against a cycle never means guessing.',
      'Exports are audited with field names only \u2014 the audit row says a file was built and how big it is, never who is in it.',
    ],
  },
  {
    version: '2.95.0',
    title: 'The drawer takes the wheel \u2014 lifecycle rides inside',
    bullets: [
      'The cycle drawer now drives the lifecycle: Activate and Close live right beside the calibration meter \u2014 no hunting for the table row.',
      'The empty-cycle guard explains itself before it can fire: a draft with no reviews shows the reason inline (the server\u2019s own arithmetic, not a guess) and the Activate button rests until a review exists.',
      'Close asks twice: a closed cycle cannot reopen, so the drawer arms a confirmation first \u2014 calibration ends, the meter freezes, and the notes stop taking ink.',
      'A closed cycle wears its history honestly inside the drawer, and lifecycle errors report in the drawer where you can actually read them.',
    ],
  },
  {
    version: '2.94.0',
    title: 'The cycle opens up \u2014 and calibration takes notes',
    bullets: [
      'A review cycle is no longer just a row: click its name and it opens into a detail drawer \u2014 period, status, the calibration meter, every review in the cycle, and its calibration notes, in one place.',
      'Calibration notes finally take ink: managers write the cycle\u2019s working record inline (up to 4,000 characters, an honest counter, audited with field names only \u2014 the text itself never enters the audit log).',
      'The drawer crosses links honestly: each review opens straight into the gated review dialog (where ratings live), and "View in the Reviews tab" lands pre-filtered to the cycle.',
      'A closed cycle is history \u2014 its notes stay readable but frozen (CYCLE_FROZEN), and reviewers get a read-only drawer by design.',
    ],
  },
  {
    version: '2.93.0',
    title: 'The bench remembers \u2014 deleted goals come home',
    bullets: [
      'Deleted goals are no longer a one-way door: the Goals tab grows a "Recently deleted" bench (with a live count) where every soft-deleted goal waits, stamped with when it left and the progress it kept.',
      'One Restore click undoes the removal \u2014 the goal rejoins the board, the portal, and the counts exactly as it left: same target, same progress, same status. POS-sourced progress recomputes from sales like any live goal.',
      'The bench speaks the same honesty as the delete: nothing is ever hard-deleted, every restore is audited (who restored, which goal), and an empty bench says so plainly.',
      'Managers only, by design \u2014 the bench is manage-gated like the delete itself; reviewers keep reading the live board.',
    ],
  },
  {
    version: '2.92.0',
    title: 'The goals can leave \u2014 and the custom metric has a name',
    bullets: [
      'Draft mistakes no longer live forever: every goal card grows a manage-gated Delete with a confirm dialog that says exactly what a removal means \u2014 the board and the portal lose the goal at once, while the record and its audit history stay (a soft delete, never a hard one).',
      'The confirm shows what you are removing: employee, source, status, and the progress recorded \u2014 no blind deletions.',
      'Custom metrics go end-to-end: the New goal dialog offers "Custom metric" and asks what the metric counts (2-120 characters \u2014 the service refuses an anonymous custom goal), and the name shows on the card, the portal, and the details panel.',
      'Signed-out visitors get the same honest door as the wrong-role ones: a sign-in panel instead of tabs rendering fake empty states over lists that never loaded.',
    ],
  },
  {
    version: '2.91.0',
    title: 'The HR door is honest \u2014 and the goals take edits',
    bullets: [
      'The performance workspace now checks your role at the door: if your role holds no hr.performance.review permission you see a clear lock panel naming the role and the key it lacks \u2014 not a shell of tabs whose every click would be denied.',
      'The lock panel points you home: your own goals and reviews live in the self-service portal, one link away.',
      'Goals finally take edits: every goal card grows an "Edit goal" action \u2014 title, target, due date, current value (manual goals), and a park-or-reopen status switch, all backed by the audited update path the service always had.',
      'The metric source never moves: the edit dialog shows employee and source as read-only facts, and POS-sourced goals honestly refuse a typed value \u2014 recompute stays the only writer of sales progress.',
      'The portal\u2019s My goals cards unfold a Details panel \u2014 metric source, review cycle, due date, and when the goal was last touched \u2014 the same expand-in-place pattern your reviews already use.',
    ],
  },
  {
    version: '2.90.0',
    title: 'The goals meet their cycles \u2014 and the portal reads the same shape',
    bullets: [
      'New goals can be filed under a review cycle: the New goal dialog gains an optional cycle picker (open or draft cycles \u2014 closed ones are history), and linked goal cards wear an amber cycle chip so calibration context travels with the goal.',
      'Goal lists fold in the cycle\u2019s name through one query \u2014 a goal whose cycle was deleted reads uncycled, never a dangling id.',
      'The self-service portal\u2019s My goals half finally speaks the same shape: a visible "My goals" heading, status chips with live counts (all / open / achieved / missed / closed), and an honest "Showing X of Y goals" line.',
      'Filtering your own goals is one tap, and an empty filter result says so with a "Show all goals" way back \u2014 no silent hiding.',
      'Same families everywhere: sky open, emerald achieved, rose missed, slate closed, amber cycles \u2014 console and portal, light and dark.',
    ],
  },
  {
    version: '2.89.0',
    title: 'The goals speak the same shape \u2014 filters, live counts, and one recompute for all',
    bullets: [
      'The Goals tab grows real handles: filter by employee, by metric source (manual / sales value / sales count / custom), and by status chips (open / achieved / missed / closed) \u2014 each chip carrying its live count so you know what a click will show.',
      'A "Showing X of Y goals" line and a one-tap "Clear filters" keep the picture honest \u2014 an empty filter result says so instead of silently hiding the grid.',
      'One button refreshes every sales-sourced goal at once: "Recompute all POS goals" appears whenever at least one POS-sourced goal exists \u2014 no more tapping each card in turn.',
      'The recompute stays honest per goal: values fold from POS sales only (never typed), statuses flip by the same rule (achieved at target, missed past due), and closed goals keep their status.',
      'Same families, light and dark: sky for open and sales-sourced, emerald for achieved, rose for missed, slate for closed \u2014 chips, source badges, and recompute buttons speak one language.',
    ],
  },
  {
    version: '2.88.0',
    title: 'The cycle shows its shape \u2014 a calibration meter and reviews you can filter',
    bullets: [
      'Every review cycle row now wears a calibration meter: a progress bar plus "X of N calibrated" and the honest remainder (drafts, submitted, acknowledged) \u2014 you can see how far a cycle has walked without opening anything.',
      'The meter is a door: "View reviews" on a cycle row jumps straight into the Reviews tab filtered to that cycle \u2014 the shape and its reviews are one click apart.',
      'The Reviews tab grows real filters: a cycle picker and status chips (all / draft / submitted / acknowledged / calibrated), each chip carrying its live count so you know what a click will show before you make it.',
      'A "Showing X of Y reviews" line and a one-tap "Clear filters" keep the picture honest \u2014 filtering never silently hides the rest of the list.',
      'Counts stay honest and private: the meter counts statuses only \u2014 ratings and narratives never appear in any list, exactly as before.',
    ],
  },
  {
    version: '2.87.0',
    title: 'The review gets written \u2014 and its subject reads it',
    bullets: [
      'Reviews can finally be written: a DRAFT or SUBMITTED review opens with a "Write review" / "Edit review" form \u2014 tap a 1\u20135 star rating, type the strengths and improvements, save. A fresh draft is no longer a dead end.',
      'The save is honest about its limits: the rating is required before "Save draft" lights up, the narratives cap at 4000 characters with a live counter, and submitting still waits until the rating exists.',
      'No more blind acknowledgements: in My goals & reviews, every review row gains a "Read review" panel \u2014 the stars, the strengths and the improvements load on demand before you acknowledge.',
      'The read is scoped to you: only the reviewed employee reads a review through self-service \u2014 managers read through the HR console, and the lists still never show a rating.',
      'Same families, light and dark: amber stars, emerald strengths, amber improvements \u2014 the write form and the read panel speak the review dialog\u2019s language.',
    ],
  },
  {
    version: '2.86.0',
    title: 'The handover names its waiter \u2014 a waiting run is somebody\u2019s move',
    bullets: [
      'A run sitting in PENDING_APPROVAL now says whose move it is: the run dialog wears a "who\u2019s next" strip right under the actions \u2014 an eligible checker reads "Waiting on you", the maker who handed it over reads the honest maker-checker boundary, everyone else reads that the run waits on an approver.',
      'The strip carries the handover\u2019s facts: WHO submitted the run and the EAT moment they did it ("handed over by Jane Maker at 05:32 EAT") \u2014 read from the same history the timeline shows, never invented.',
      'The runs table joins in: every waiting row wears "waiting since {EAT}" under its status badge, so a run parked in approval is visible at a glance \u2014 no opening required.',
      'The three seats are styled apart: indigo for "waiting on you", amber for the maker-checker boundary, muted grey for spectators \u2014 light and dark.',
      'Nothing appears without a fact: a stale response with no handover in the history hides the strip entirely \u2014 the wait is never faked.',
    ],
  },
  {
    version: '2.85.0',
    title: 'The walk gains its missing step \u2014 the handover gets its own stamp',
    bullets: [
      'The run history now tells the whole story: "Submitted for approval" sits between Prepared and Approved \u2014 the indigo step that names WHO handed the run to the checker, and the EAT moment they did it.',
      'Submit-for-approval was the one lifecycle transition with no timestamp of its own (its stamp rode inside "Prepared"); now Prepared marks when the payslips were computed and Submitted marks the handover \u2014 the two moments finally read apart.',
      'Older runs are not left behind: the migration copies the old stamp into its properly-named column, and any run the state machine proves was submitted still shows the step \u2014 with an honest "no timestamp recorded" if no stamp survived.',
      'Maker-checker tightens with the boundary: whoever PREPARED or SUBMITTED the run cannot be the one who approves it \u2014 the server enforces it, and the dialog\u2019s approve button now stands down for both.',
      'The Run history header counts the steps the run has lived ("7 steps"), so the walk\u2019s length is visible at a glance \u2014 a fresh draft shows 1, a locked-and-paid run shows the whole story.',
    ],
  },
  {
    version: '2.84.0',
    title: 'The run remembers its own steps \u2014 who did what, and when (EAT)',
    bullets: [
      'The run dialog grows a "Run history" strip: initiated, prepared, approved, posted, locked, paid \u2014 each step with the NAME of the person who did it and the EAT wall clock it happened at, in lifecycle order.',
      'It reads only facts the row already carried (no new visibility, no second guess): a step the run never took simply never appears \u2014 a fresh draft shows one event, a locked run shows the whole walk.',
      'The bounce-back is not hidden: a rejected run shows WHO rejected it and the reason they gave \u2014 with an honest "no timestamp recorded", because the ledger stamps who and why, never when.',
      'The posted step names its journal entry, and every stamp is EAT \u2014 the shop\u2019s filing clock \u2014 so the timeline reads like the payslips and the digest CSVs do.',
      'Actor names resolve through the same ladder the digest emails use (name \u2192 email), fetched in one query; a name that cannot be resolved says "Unknown user" instead of vanishing.',
    ],
  },
  {
    version: '2.83.0',
    title: 'The run hands every slip over \u2014 one zip, every payslip, a manifest inside',
    bullets: [
      'The run dialog\u2019s filing row grows a second door: "Payslip bundle (N)" zips EVERY payslip in the run \u2014 the same masked slips the PDF column serves \u2014 into one download, ready to hand out or archive.',
      'No more N clicks for N people: from the first prepared slip to a locked run, the bundle appears the moment payslips exist, and the digest CSV door keeps its own approval gate beside it.',
      'A manifest rides inside: _MANIFEST.csv names the run, the generation time (EAT), and one row per slip \u2014 payslip no., employee, file, net \u2014 in the same RFC-4180 filing voice with the same formula-injection guard as every other file the shop files.',
      'Privacy travels with the slips: each PDF is built through the identical view-shaping pipeline as the per-row column \u2014 statutory identifiers stay [REDACTED] unless your role may unmask them \u2014 and the export is audit-logged like every other filing download.',
      'The archive is written by the house\u2019s own zero-dependency zip writer (same spirit as the PDF writer): deterministic bytes, flat ASCII names, no new libraries on the receipt-printer\u2019s conveyor belt.',
    ],
  },
  {
    version: '2.82.0',
    title: 'The report files everything \u2014 one button files the whole ledger, every visit the report read',
    bullets: [
      'The toolbar grows "File all N visits" beside the report\u2019s own CSV: one click files EVERY visit this window and scope read \u2014 the whole ledger, newest first \u2014 not just the summary.',
      'It is the drawers\u2019 filing grown to the full read: the same slice builder, the same column voice (EAT date, day and time, branch, reviewer, employee, leave type, status, recheck cleared), the same RFC-4180 and formula-injection guard.',
      'It cannot disagree with the screen: the file is built client-side from the same one-pass ledger the report renders \u2014 no second fetch, no round-trip, the download lands instantly.',
      'Filenames never collide: mbumah-desk-all-\u2026 stamps the window bounds and scope (mbumah-desk-all-7d-2026-10-11_2026-10-17-all-branches.csv) \u2014 one stamp now names all three filings: the report, a drawer\u2019s slice, and the whole ledger.',
      'The button waits for the read (the ledger it files IS the read) and stays an action, not a walk door \u2014 Tab reaches it, j/k does not \u2014 and the footnote says exactly what it files.',
    ],
  },
  {
    version: '2.81.0',
    title: 'The link carries the whole scope \u2014 ?days= and ?branch= ride beside the drawer, and the report re-keys on arrival',
    bullets: [
      'A drawer address alone opened the DEFAULT window \u2014 a link to a 14-day, Juja-Main-narrowed report lost everything but the drawer. Now the window and the branch ride the link too: ?days=14&branch=store-juja&reviewer=X lands the report in exactly the scope it names.',
      'The arrival is an honest two-beat: the default window renders first, the link\u2019s scope lands and is announced, then the drawer resolves against the RE-KEYED read \u2014 a reviewer with no visits in the default window still opens when the link widened the window.',
      'The address bar mirrors the whole state from then on: window, branch and drawer compose into one URL, defaults leave no ink (7 days and no branch = the bare path), and any pick or close rewrites it \u2014 the URL always names exactly what is on screen.',
      'The desk panel\u2019s "Their file in the report" door hands its branch filter over with the reviewer\u2019s name: narrow the desk to a person on a branch, and the report arrives narrowed the same way, drawer already open.',
      'A drawer opened by a link wears a small "from the link" chip \u2014 the way a jumped drawer wears its "via" chip \u2014 so the page always says how it got here.',
    ],
  },
  {
    version: '2.80.0',
    title: 'The report is addressable \u2014 an open drawer rides the URL, and the desk hands the report a name',
    bullets: [
      'Every drawer in the desk report has an address now: open a reviewer or a request and the URL carries it (?reviewer=\u2026 / ?request=\u2026) \u2014 copy the address and the same file opens for whoever follows.',
      'The address tells the truth both ways: close the drawer \u2014 by click, Escape, a cross-jump or a scope re-key \u2014 and the URL forgets it; the bar never claims a drawer the page is not showing.',
      'The desk activity panel flows into the report: narrow the ledger to one reviewer and the drill-down bar grows a "Their file in the report" door that opens the report with that drawer already read.',
      'A deep link answers honestly: it resolves against the same read the report renders, and a link whose subject is outside the window says so out loud \u2014 no silent nothing, no half-opened drawer.',
      'Refusals are named, not swallowed: a file that drew visits but sits outside the five most-visited says exactly that \u2014 the cap is by design, and now it speaks.',
    ],
  },
  {
    version: '2.79.0',
    title: 'The drawers file themselves \u2014 file a reviewer\u2019s or a request\u2019s visits straight from the desk report',
    bullets: [
      'Every drawer in the desk report carries its own CSV button now: open a reviewer or a request and file exactly the slice you are reading \u2014 that reviewer\u2019s visits or that request\u2019s history, nothing more.',
      'The filed copy is filing-grade: RFC-4180 with the same formula-injection guard as the report\u2019s own CSV, one column voice for both families \u2014 EAT date, day and time, branch, reviewer, employee, leave type, status and the recheck-cleared flag.',
      'It cannot disagree with the drawer: the file is built from the same one-pass ledger the drawer reads \u2014 no second fetch, no round-trip, the download lands instantly.',
      'Filenames never collide: mbumah-desk-reviewer-\u2026 / mbumah-desk-request-\u2026 stamp the subject, window bounds and scope into every filed copy.',
      'The paper names its scope too: the report footer now says "Branch: Juja Main" or "All branches" in plain words \u2014 one voice on screen, on paper and in every CSV.',
    ],
  },
  {
    version: '2.78.0',
    title: 'The scope speaks the keyboard \u2014 the window and branch chips answer the arrows, and every re-key is announced',
    bullets: [
      'The window chips (7 / 14 / 30 days) and the branch chips are keyboard groups now: \u2190/\u2192 (and \u2191/\u2193) move between the chips \u2014 wrapping at the ends \u2014 Home/End jump, and only the active chip holds the group\u2019s tab stop, the APG roving pattern.',
      'The pick stays deliberate: arrows move focus, Enter/Space commit \u2014 so walking the chips never fires a fetch you didn\u2019t ask for.',
      'Every re-key is announced \u2014 a quiet aria-live region says "Window: 14 days \u2014 report re-keyed." or "Branch: Juja Main \u2014 report re-keyed." before the numbers arrive, so a screen-reader user is never left guessing whether the pick landed.',
      'Clearing the branch scope gets its own honest sentence: "All branches \u2014 report re-keyed." \u2014 not a branch with an empty name.',
      'The footnote\u2019s screen-only keyboard hint grew the new keys (\u2190/\u2192 move the chips, enter re-keys the report) \u2014 and the print contract stays untouched: the paper never learns about keyboards.',
    ],
  },
  {
    version: '2.77.0',
    title: 'The shortcut sheet tells the whole story \u2014 the desk report\u2019s keys are discoverable, and the walk can be followed',
    bullets: [
      'The console\u2019s keyboard-shortcuts modal now has an "On the desk report" section: j walks the doors, k walks back, esc closes the drawer \u2014 labeled with where they work.',
      'The j/k walk glides: the focused door scrolls smoothly to the nearest edge instead of jumping, so walking a long report reads like reading.',
      'The walk is announced \u2014 a quiet aria-live region names each door ("Door 4 of 13 \u2014 Open \u2026\u2019s visits") so screen readers ride along.',
      'Escape now returns you to the row that owned the drawer, the way a dialog returns focus to its trigger \u2014 and says so.',
      'Silence stays honest: Escape with nothing open announces nothing, and the announcer is sr-only \u2014 ears get the walk, eyes keep the focus rings.',
    ],
  },
  {
    version: '2.76.0',
    title: 'The shortcuts arrive — mark all releases read from the palette, and walk the report doors with j / k',
    bullets: [
      'The release inbox clears in place: with unread releases on the board, cmd+K now offers "Mark all releases read" — it writes the same seen flag the changelog\u2019s "Got it" writes, and the palette stays open so you watch the counter and the NEW chips clear.',
      'The action only exists when there is something to clear — no unread, no button, exactly the honesty rule the inbox already follows.',
      'The desk report answers the keyboard: j walks the doors in reading order, k walks back, and both wrap — reviewer rows, request rows, every cross-link inside a drawer, and the via chips.',
      'Escape closes the open drawer and its "via" memory — one key returns the report to its quiet state.',
      'The keyboard hint lives on screen only (j / k · esc), and the print contract is untouched — the paper never learns about keyboards.',
    ],
  },
  {
    version: '2.75.0',
    title: 'The palette knows what you\u2019ve read — release items wear latest/new/seen, and the group counts the unread',
    bullets: [
      'cmd+K\u2019s "Jump to release" group is a release inbox now: every item shows whether it is the latest, arrived after you last read the notes, or is already read.',
      'A small counter on the group heading — "2 unread" — tells you how many releases arrived since you last acknowledged the notes.',
      'The markers read the SAME seen flag the footer pill and the changelog\u2019s "Got it" write, so every surface tells one truth about what you\u2019ve read.',
      'The flag is re-read on every palette open — acknowledge a release in the modal and the very next cmd+K already knows.',
      'With nothing read yet, the palette stays calm: no unread claims without a reference point, and the latest release still wears its badge.',
    ],
  },
  {
    version: '2.74.0',
    title: 'The drawers talk to each other — every visit row names the other ledger, and the name is a door',
    bullets: [
      'Inside a request\'s drawer, "visited by Grace W." is a door now: click it and Grace\'s own visit ledger opens — no scrolling back up to the reviewers section.',
      'The mirror holds: inside a reviewer\'s drawer, every row names the file it was visiting, and when that file has a drawer of its own, its name opens it.',
      'A jump remembers where it came from — the opened drawer wears a small "via …" chip, and one click on it takes you straight back.',
      'The one-drawer rule still governs the page: opening either family closes the other, so the report never splits your attention between two ledgers.',
      'A door is only promised where one exists — the most-visited section is a capped digest, and rows naming files outside it stay honest text.',
    ],
  },
  {
    version: '2.73.0',
    title: 'The palette knows the releases — cmd+K jumps straight to any release\'s notes',
    bullets: [
      'The command palette (cmd+K) grew a "Jump to release" group: one item per release, newest first, built from the same source as the changelog — the palette and the archive can never disagree.',
      'Type a title keyword ("CSV", "payslip", "desk report") and the release that shipped it surfaces — 70+ entries deep — then Enter opens its notes directly.',
      'A jump opens the changelog with its backlog expanded, scrolls the chosen release into view, and rings it with an orange "via cmd+K" badge so you always know which notes you came for.',
      'A plain open of the changelog is untouched: latest release highlighted, the older backlog still waiting behind one expand button.',
      'Closing the modal clears the jump — the next open starts clean at the top of the story.',
    ],
  },
  {
    version: '2.72.0',
    title: 'The report reads the file — click a request to read its visits',
    bullets: [
      'The most-visited requests on the desk report are doors now too: click one and the report lists every visit that request drew in the same window — the day and EAT time the desk came, which branch it came to, who did the visit, and whether the visit answered a correction.',
      'Same one-read rule as the reviewer drill-down: the drawer filters the ledger the report was already built from, so what it lists can never disagree with the visit count on the door.',
      'One drawer at a time across the whole report — opening a request closes the reviewer drawer and vice versa, so the page stays calm while the screen investigates.',
      'Changing the window or branch chips closes any open drawer — a new scope re-keys the whole report, drill-downs included.',
      'Screen-only like its sibling: the drawer never reaches paper, so printed and filed copies keep the deterministic roll-up shape.',
    ],
  },
  {
    version: '2.71.0',
    title: 'The report opens its ledger — click a reviewer to read their visits',
    bullets: [
      'Every reviewer row on the desk report is a door now: click it and the report lists that reviewer\'s own visits for the same window — day and EAT time, branch, the request that drew the visit, its status, and whether a recheck was cleared.',
      'The drill-down reads straight from the same server-side derivation (one read, no second fetch), so the ledger under a reviewer can never disagree with the roll-up above it.',
      'Rows stay honest: visits appear newest first, an expanded reviewer shows a count line ("3 visits in this window"), and an empty ledger says so instead of pretending.',
      'Changing the window or branch chips closes the drawer — a new scope re-keys the whole report, drill-down included.',
      'Screen-only by design: the drawer never reaches paper, so a printed or filed report keeps its deterministic roll-up shape while the screen investigates.',
    ],
  },
  {
    version: '2.70.0',
    title: 'The report files itself — the desk report downloads as CSV now',
    bullets: [
      'The desk report grew a "CSV" button beside Print: the same figures the page shows — totals, day-by-day rhythm, per-branch roll-up, reviewers, most-visited requests — land in one RFC-4180 file, built server-side so a downloaded copy can never disagree with the screen.',
      'The file follows the house filing shape: an header block (report, organization, scope, window, generated-at), a Summary block, then one section per table — ready for reconciliation, not retyping.',
      'Honest to the last row: every window day appears even when empty, a quiet window still files with its header + zero series, and the window/scope you chose is what gets serialized.',
      'Formula-injection guarded: every cell passes the shared CSV escaper (the OWASP guard the digest attachments have used since v2.46.0), so a tampered name can never arrive as a spreadsheet formula.',
      'Filenames tell the truth — mbumah-desk-report-7d-<start>_<end>-all-branches.csv (or the branch slug when narrowed) — so filed copies never overwrite each other.',
    ],
  },
  {
    version: '2.69.0',
    title: 'The desk files its report — a printable per-branch ledger roll-up',
    bullets: [
      'The Desk activity panel grows a "Report" door: a printable per-branch desk report covering the last 7, 14 or 30 days — today included — on the desk\'s own Nairobi calendar (EAT).',
      'One page answers the filing questions: totals (visits, corrections answered, reviewers, requests), a per-branch roll-up table, the day-by-day rhythm as a bar strip, and the reviewers who did the desk work.',
      'The most-visited requests in the window are called out — a thrice-reviewed request is a different story from a once-glanced one.',
      'Narrow the whole report to one branch with the chips — an explicit report scope, named in the header, unlike the org-wide morning note.',
      'The "Print" button isolates the report on paper through the app\'s print pipeline — nav, sidebar and toolbar never reach the printer, and a printed copy can never disagree with the screen because both come from the same server-side read.',
    ],
  },
  {
    version: '2.68.0',
    title: 'The morning note rings the bell — yesterday at the desk travels to every org inbox',
    bullets: [
      'The desk\'s morning note grew a second voice: when yesterday had visits, the bell now rings every org role with "Yesterday at the desk — {day}" and the same figures the console strip shows.',
      'The copy stays honest — "1 visit · 1 correction answered" in exact singular/plural, with the busiest branch and most active reviewer called by name.',
      'Once per day, guaranteed: the note is deduped on the summarized Nairobi-calendar day, so opening the console twice in a morning rings the bell once.',
      'Quiet days stay quiet — the bell says nothing when the desk was empty; the strip\'s honest silence is the only notice a quiet desk gets.',
      'Each row wears the dawn-orange sunrise chip "Morning note" and deep-links straight to the org dashboard\'s Desk activity panel.',
    ],
  },
  {
    version: '2.67.0',
    title: 'The desk writes its own morning note — yesterday\'s desk activity greets the console',
    bullets: [
      'The Desk activity panel now opens with a dawn-tinted digest of yesterday: visits taken, corrections answered, reviewers on the desk, requests touched — computed on the desk\'s own Nairobi calendar (EAT), not a vague trailing 24 hours.',
      'The busiest branch and the most active reviewer wear chips in the strip — the morning question "where did the desk happen?" answers itself before you scroll.',
      'The note is org-wide on purpose: drill into a reviewer or narrow to a branch and the timeline follows you, but the morning note stays the same shared yesterday for everyone.',
      'A quiet day says so honestly — "The desk was quiet yesterday" — instead of dressing zeros up as numbers.',
      'Multi-branch days get per-branch mini chips; the strip is dark-mode complete, with the amber-to-emerald dawn gradient carrying the morning metaphor into the dark.',
    ],
  },
  {
    version: '2.66.0',
    title: 'The console catches up on the news — the changelog tells the whole release story now',
    bullets: [
      'The console\'s Changelog modal no longer shows a frozen v2.18.3-era list — it renders the same release feed as the POS app, newest first, all 66 entries and counting.',
      'The latest release wears an emerald "latest" highlight at the top; the backlog waits behind a "Show older releases" expand so the modal never drowns.',
      'A small emerald "new" pill sits on the footer\'s Changelog button whenever release notes you haven\'t read are waiting — it clears the moment you hit Got it.',
      '"Got it" shares the same seen-flag as the POS app\'s What\'s-New dialog — read a release on either surface and both stay quiet.',
      'The footer, modal and every entry are dark-mode complete, matching the console\'s new dark pass from v2.65.0.',
    ],
  },
  {
    version: '2.65.0',
    title: 'The console answers who and where — desk activity drills down per reviewer and filters by branch',
    bullets: [
      'Click any row on the console\'s Desk activity panel to review that person\'s desk visits — the panel switches to their ledger with a back button, no page leave.',
      'The drill-down header answers "how much desk does this reviewer pull": visits on record, corrections cleared, and when they last looked — org-wide figures.',
      'Branch chips under the stat tiles narrow the trail to one store; counts stay org-wide so the chips never shift under you. Composes with the reviewer drill-down.',
      'Every reviewer wears their own colour — a deterministic hue per name makes the same person read as the same person across visits, in light and dark.',
      'The whole panel is now dark-mode complete — card, tiles, chips, timeline and empty states all keep their contrast when the app goes dark.',
    ],
  },
  {
    version: '2.64.0',
    title: 'The ledger steps into the light — visit counts on the desk rows, and the org console sees the trail',
    bullets: [
      'Every reviewed row on the HR desk now wears a slate visit chip ("2 visits") — you can tell a once-glanced request from a thrice-reviewed one without opening the dialog.',
      'Hover the chip for the short version: how many desk visits are on record and who looked last. The full trail still lives in the request dialog.',
      'Rows reviewed before the ledger kept history show a count-less "visited" chip — the receipt stays honest about what was and was not counted.',
      'The org console grows a "Desk activity" audit panel: who opened whose request, on which branch, when — live, across every store.',
      'The panel\'s stat tiles answer the management questions at a glance: visits this week, corrections answered, distinct reviewers active, total on record.',
    ],
  },
  {
    version: '2.63.0',
    title: 'The desk keeps its own ledger — every visit is on the record, and the dialog shows the trail',
    bullets: [
      'The desk receipt only ever carried the LATEST review — every re-open overwrote it. Now every desk visit is recorded: who looked, when, and how many times.',
      'Open a request\'s detail dialog and the receipt grows a "Visit history" trail — each line names the reviewer with their avatar and the visit time.',
      'Visits that cleared a re-check marker wear an emerald dot and a "Cleared a re-check" chip, so "three people looked at this" finally reads differently from "nobody has".',
      'The count chip keeps the total honest ("12 visits") even when only the five most recent visits are listed — earlier visits stay on file.',
      'The trail rides the same visit-stamp the desk already fires on open — no extra taps, the history is fresh the moment the dialog opens.',
    ],
  },
  {
    version: '2.62.0',
    title: 'The correction answers to the room — the approvals group hears when their re-check is done',
    bullets: [
      'The amber "Corrected - re-review" bell row raised a question; now it gets an answer: when a desk visit clears the re-check marker, every approver who was told about the correction gets an emerald "Correction answered" row.',
      'The row names the reviewer and the employee — "{reviewer} reviewed {name}\'s corrected request — safe to decide on the corrected details" — and routes straight to the Leave desk.',
      'The desk dialog joins in: an answered correction upgrades the receipt from "Last reviewed by" to an emerald "Correction answered — Seen by {reviewer}" with the badge-check and the reviewer avatar.',
      'It rings only once per correction, alongside the employee\'s own "your correction was seen" row — one desk visit, every listener told exactly once.',
      'Receipt rows stay bell-only: good news that keeps is not inbox-worthy.',
    ],
  },
  {
    version: '2.61.0',
    title: 'The bell answers the correction — when the desk reads your fix, you hear about it',
    bullets: [
      'A corrected leave request no longer waits silently for you to check the portal: the moment a desk visit clears the re-check marker, your bell rings with "Your corrected leave request was seen".',
      'The row names the reviewer and the corrected dates — the same person the desk receipt and the portal badge carry, so all three surfaces tell one story.',
      'It rings only once per correction: the first desk visit after an edit carries the news; re-opening the dialog never re-rings the bell.',
      'The receipt surface is cyan in the bell ("Correction seen" chip), the honest counterpart of the amber "Corrected - re-review" row the approvals group gets.',
      'The portal waiting badge now pulses while your correction is unseen, and a named review earns the scan-eye icon — waiting and seen look different at a glance.',
    ],
  },
  {
    version: '2.60.0',
    title: 'The receipt is personal and shared — the desk records who reviewed, and the employee sees it',
    bullets: [
      'A desk review is a person reading, not a timer firing: the re-check receipt now says "Last reviewed by Grace" instead of an anonymous timestamp, on the dialog and in the audit log.',
      'The employee\u2019s portal card mirrors the same receipt: once a desk visit lands after a correction, the card shows an emerald "Seen by {reviewer}" badge — a corrected request is answered by a person.',
      'While that visit hasn\u2019t happened yet, the portal card says so honestly with an amber "Waiting for a desk review" badge — no more silent limbo after you fix your own dates.',
      'Both sides are decided by the SAME shared rule as the desk\u2019s re-check chip, so the portal badge and the desk marker can never disagree about whether a correction has been seen.',
      'The reviewer\u2019s name travels with the stamp (Users.name, falling back to email), so the record survives even if a display name changes later.',
    ],
  },
  {
    version: '2.59.0',
    title: 'The desk never decides on a stale correction — corrected leave requests carry their own re-check marker',
    bullets: [
      'A corrected leave request now wears an amber "re-check" chip until somebody actually looks at it: the chip means the last correction landed AFTER the desk\u2019s most recent visit, so the dates on screen may not be the dates you remember.',
      'The Pending card says the number out loud — "2 need re-check" — and a new "Needs re-check" filter isolates the queue in one click, so unseen corrections can\u2019t hide inside a long list.',
      'Opening a request stamps the desk review: the receipt appears on the dialog ("Last reviewed …"), the chip clears for every approver, and the stamp is audit-logged with whether a correction was waiting.',
      'The marker is decided by ONE shared rule on the server, not by whichever screen you\u2019re on — a review only counts when it happens after the edit, so re-opening an old dialog never masks a fresh correction.',
      'The stamp is a read-receipt, not a decision: nothing about the request changes when you look — approve, reject, cancel and correct keep their own guards.',
    ],
  },
  {
    version: '2.58.0',
    title: 'One builder to file them all — every per-table CSV is now the governed digest file, and the org console can never shrink to one branch',
    bullets: [
      'The per-table CSV buttons on the HR reports tabs now download the SAME governed file a digest email carries — header block, honest filename, OWASP formula-injection guard — with just the table section instead of a bare grid.',
      'The old client-side CSV builder is gone: an ad-hoc download can no longer disagree with the email, and a tampered cell can no longer reach a spreadsheet as a formula.',
      'Every table export is audit-logged with its section (table vs digest), so the paperwork trail knows exactly which file was filed.',
      'Fixed the same silent-narrowing bug class in the org console: for a store-scoped viewer the org totals (revenue, debt, stock, headcount) could quietly shrink to their own branch — the org-wide reads now bypass store scoping by construction.',
      'A permanent audit test now pins the whole bypass-read surface: any new bypass that could be silently narrowed fails the build until a human gives it a written reason.',
    ],
  },
  {
    version: '2.57.0',
    title: 'The bell closes the loop — a failed digest notification carries its own Retry delivery action',
    bullets: [
      'A failed digest copy in your bell no longer just reports the bad news: rows that name their schedule now carry an amber "Retry delivery" button right on the row.',
      'One tap re-sends to exactly who missed it — the same server-governed re-send the schedule card uses: the missed set is derived on the server, everyone who already got the digest is never spammed, and the cadence never moves.',
      'The outcome answers honestly, inline on the row: delivered (emerald), partial or failed (amber, pointing at the per-recipient rows), nothing to re-send (amber note, not an error), or refused when the schedule sits outside your desk.',
      'Every retry writes a fresh manual copy into the bell, so the feed itself keeps the before-and-after — the failed attempt and the retry each keep their own row.',
      'The "Email failed" filter tab now explains itself: a short amber note tells you the rows below carry the fix, so a broken send is one tap from discovery to repair.',
      'Fixed a silent feed bug: organisation-wide digest copies (and security alerts) could vanish from the bell entirely — the feed now reads its user-addressed sections without store scoping, so every row addressed to you actually reaches you.',
    ],
  },
  {
    version: '2.56.0',
    title: 'The sweep self-heals — a failed digest delivery gets one automatic retry before you ever hear about it',
    bullets: [
      'When a scheduled digest comes up short (PARTIAL or FAILED), the nightly sweep now retries ONCE on its own — straight after the stumble — to exactly the addresses the first attempt missed.',
      'A transient provider blip heals itself: if the retry delivers everyone, the schedule quietly shows SENT and the creator\u2019s copy tells the recovery story instead of shouting a red alert.',
      'If the retry also falls short, the alert is honest about it: "an automatic retry was attempted and also failed" — so nobody re-runs the same thing by hand twice.',
      'Every retry envelope is labelled in the delivery history with its own amber "auto-retry" chip, its own SENT/FAILED status and the provider\u2019s own error text — retries read as retries, never as fresh sends.',
      'The cadence never moves: a retry is still not a schedule fire, and the next scheduled delivery lands exactly where it always was.',
    ],
  },
  {
    version: '2.55.0',
    title: 'The failed get another chance — one tap re-sends a digest to exactly the recipients who missed it',
    bullets: [
      'When a digest delivery comes up short (PARTIAL or FAILED), the schedule card now shows exactly which addresses missed it — with an amber "Re-send to N failed" action right beside them.',
      'The re-send goes ONLY to the recipients the last batch missed: everyone who already received the digest is never spammed with a second copy, and an address you have since removed stays removed.',
      'The digest is recomputed fresh at re-send time through the same governed rules (aggregates only, fail-closed scope), so the re-sent copy is the current truth, not a replayed stale email.',
      'Every re-sent envelope lands in the delivery history with its own amber "re-send" chip, its own SENT/FAILED status and the provider\u2019s own error text — a retry always reads as a retry.',
      'Nothing to re-send? The action says so honestly instead of pretending — and the cadence never moves: the next scheduled fire stays exactly where it was.',
    ],
  },
  {
    version: '2.54.0',
    title: 'Every recipient stands alone — digest emails go one-per-person, and the delivery history says who got what',
    bullets: [
      'Scheduled and manual digest emails now send one envelope per recipient: nobody\u2019s email address is exposed to everyone else on a shared To: line anymore.',
      'Each recipient earns their own delivery row — SENT or FAILED per address, with the provider\u2019s own error text — so "which recipient actually broke" is a lookup, not a guess.',
      'A mixed delivery is called what it is: the schedule shows an amber PARTIAL chip ("Delivered to 2 of 3") instead of pretending everything went out or nothing did.',
      'The CSV attachment still rides every envelope — the same ready-to-file digest file, built once, attached to each person\u2019s own email.',
      'Old delivery rows keep their per-recipient chips, so history written before this change stays readable right next to the new per-person rows.',
    ],
  },
  {
    version: '2.53.0',
    title: 'The run\u2019s filing file, on demand — download a payroll run\u2019s digest CSV straight from the Pay Runs desk',
    bullets: [
      'Every payroll run that has been approved now carries a violet "Digest CSV" action: one click downloads the ready-to-file per-employee summary for that exact run — no opening emails, no waiting for a schedule.',
      'It is the SAME file the approval and posting emails attach — header block, summary, per-employee rows, formula-injection guard and honest filename — built by one shared server builder, so the download can never disagree with the inbox.',
      'Approved runs file the approval summary; posted and locked runs file the posting summary with the payslip-number range — the label always tells the truth about how far the run has actually travelled.',
      'A run that has not been approved yet refuses honestly ("the run digest exists from approval onward") instead of handing you a file with "Approved by Approver" on it.',
      'Every download is audit logged (who, which run, which variant, how many bytes) with field names only — the paperwork trail grows without exposing anyone\u2019s data.',
    ],
  },
  {
    version: '2.52.0',
    title: 'Digest CSV, on demand — the filing file downloads from the report you are looking at',
    bullets: [
      'Every HR report tab now has a violet "Digest CSV" button: one click downloads the ready-to-file CSV for the report you are viewing and the period you applied — no more waiting for the scheduled email to arrive.',
      'It is the SAME file the digest email carries — header block, summary, table, formula-injection guard and honest filename — built by one shared server builder, so the numbers in your download can never drift from the numbers in the inbox.',
      'The leave-balances export honours the leave year selected on screen, so an export of 2025 is exactly the 2025 file even in 2026.',
      'Empty period? The button says "No report data for this period" instead of handing you a blank spreadsheet — an honest nothing beats a confusing something.',
      'Every export is audit logged (who, which report, which period, which scope) with field names only — compliance sees the paperwork trail without seeing anyone\u2019s data.',
    ],
  },
  {
    version: '2.51.0',
    title: 'You\u2019ve been paid — employees now hear the moment their money settles, receipt in hand',
    bullets: [
      'The pay story is complete: a payslip that actually goes PAID — by M-Pesa B2C, a simulated batch, or a manual bank-run confirmation — now tells the EMPLOYEE personally: "You\u2019ve been paid", with their own net, their own receipt, and a one-tap link to their Payslips page.',
      'Honesty is the contract: a live M-Pesa payment that is still in flight never claims to be paid — the employee\u2019s notice arrives from the Daraja receipt webhook the moment the real receipt exists, and a simulated batch always says so.',
      'The self-service home strip now tells both moments of the story side by side — teal "payslip issued" rows and emerald "Paid" rows, newest first — so the good news is the first thing an employee sees when they sign in.',
      'The run dialog\u2019s disbursement banner gained an emerald "Employee paid notices" line: how many employees were told, how many emails left, and the reminder that in-flight payments stay quiet until the receipt lands.',
      'Personal by design: each notice carries only that employee\u2019s own numbers — no group CSV, no colleagues\u2019 figures — and unlinked employees stay exactly as before, with paper payslips as their channel.',
    ],
  },
  {
    version: '2.50.0',
    title: 'The money now announces its exit — disbursement batches land in the payroll group\u2019s bell and inbox',
    bullets: [
      'The moment an M-Pesa B2C batch (or a manual bank-run confirmation) settles a payroll run, everyone who co-owns the payroll decision gets a "Payroll disbursed" notification with the per-batch outcome: payments sent, settled, failed, skipped and the net total.',
      'The disbursement email carries a ready-to-file per-payslip payment CSV (employee, staff number, net, status, M-Pesa receipt) — reconcile it against the M-Pesa statement or the bank run without retyping a line.',
      'The channel is always named honestly: live M-Pesa B2C, simulated B2C, or manual confirmation — a simulated batch never reads like real money moved.',
      'The run dialog now shows a "Disbursement digest" banner right after you disburse: who was told, whether the email left, and the exact CSV that travelled with it — mirroring the approval and posting banners.',
      'Disbursing stays instant no matter what: the digest is best-effort, a mail hiccup is logged and flagged amber in the bell, and retries or stuck-refreshes never re-spam the group — only the full batch announces itself.',
    ],
  },
  {
    version: '2.49.0',
    title: 'Your payslip now introduces itself — employees hear the moment their pay is official',
    bullets: [
      'The moment a payroll run is posted, every portal-linked employee in the run gets a personal "Payslip issued" notification carrying only their own facts — payslip number, net pay, payment status — with a one-tap link straight to their Payslips page.',
      'The self-service home now leads with the good news: a teal notice strip shows your latest payslip notices above your stats, so "your October payslip is ready" is the first thing you see when you sign in.',
      'Employees with an email address on file also receive a personalized "Your payslip is ready" email with the same own-numbers-only summary — no group spreadsheets, no colleagues\' figures, ever.',
      'The run dialog\'s posting banner gained an honest "Employee notices" line: how many portal-linked employees were told, and how many of the personal emails left the building — right under the payroll group\'s digest.',
      'Unlinked employees (no portal account) stay exactly as before — their payslip reaches them the offline way — and the whole fan-out is best-effort: it can never delay or undo the posting itself.',
    ],
  },
  {
    version: '2.48.0',
    title: 'Posting a payroll run now closes the loop — the ledger story lands in the same bell and inbox',
    bullets: [
      'The moment a run is posted — journal entry in the books, payslip numbers issued — the maker and the payroll group get the closing numbers (employees, payslips issued, gross, deductions, net) in their bell and inbox, exactly like the approval digest before it.',
      'The posting email carries its own ready-to-file CSV with a "Payroll posting summary" header and the issued payslip-number range, so the file in your inbox says POSTED, not just approved.',
      'The run dialog now shows a "Posting digest" banner right after you post: who was told, whether the email left, and the exact CSV that travelled with it — mirroring the approval banner.',
      'Bell rows now speak clearly for both payroll events: an emerald Approved chip for approvals, a sky Posted chip for postings, and an honest "Email sent / Email failed" chip on both — plus approval rows finally render their icon.',
      'Posting stays instant no matter what: the digest is best-effort, a mail hiccup is logged and flagged amber in the bell, and re-posting an already-posted run never re-notifies anyone.',
    ],
  },
  {
    version: '2.47.0',
    title: 'A payroll approval now tells everyone who needs to know — with the numbers attached',
    bullets: [
      'The moment a payroll run is approved, the person who prepared it and the payroll approvers all get the headline numbers — employees, gross, deductions, net — in their notification bell and their inbox, without reopening the workspace.',
      'The approval email carries a ready-to-file per-employee CSV (name, staff number, gross, deductions, net) built with the same clean-escaping machinery as the HR report digests — reconcile it in Excel or Google Sheets before you post.',
      'The run dialog shows an honest "Approval digest" banner right after you approve: how many people were notified, whether the email was sent, and the exact CSV file that travelled with it.',
      'The digest is strictly need-to-know: it goes only to the run\'s maker and the payroll approvers, and it never contains national IDs, bank details or payslip line items.',
      'Approving stays instant no matter what: the digest is best-effort, so a mail hiccup is logged and flagged amber in the bell — it can never block or undo the approval itself.',
    ],
  },
  {
    version: '2.46.0',
    title: 'Digest emails now arrive with the spreadsheet — plus no more silent admin resets',
    bullets: [
      'Every HR report digest email (scheduled or "Send now") now carries a ready-to-file CSV attachment with the same aggregate numbers as the email body — file it, forward it, or drop it into your month-end workbook without retyping a figure.',
      'The CSV opens cleanly in Excel and Google Sheets: proper escaping, one summary block plus the report table, and a filename that says what it is (mbumah-absence-2026-10-01_2026-10-31.csv).',
      'Delivery history now shows a violet "CSV · 1.2 KB" chip on every send that carried the file, and the in-app copy confirms the attachment — so you always know what a recipient received.',
      'Admin password resets are no longer silent: the account owner now receives an "An administrator changed your password" security notice telling them who reset it, that their sessions are locked at the set-a-new-password screen, and what to do next.',
      'Both security notices (self-service change and admin reset) remain best-effort and are logged to the notification log with names and sizes only — attachment contents are never persisted.',
    ],
  },
  {
    version: '2.45.0',
    title: 'You can now fix your own pending leave request — no withdraw, no refile',
    bullets: [
      'A typo on a pending leave request no longer costs a withdrawal: every pending card in the portal now has a Correct action that fixes the dates, type, duration, reason or document in place — the request keeps its place in the approval queue.',
      'Your approver is automatically told what changed: the correction posts an amber "re-check before deciding" row to everyone who was notified of the original request, carrying the before → after summary and your optional note.',
      'The correction dialog shows a live day count and balance rail with the same guard the server applies, and Save stays disabled until something actually changed — no accidental no-op pings.',
      'Corrections are labelled honestly: your own fixes show an indigo "Corrected by you" chip, HR fixes keep the amber "Corrected by HR" chip, and the HR desk now marks employee-fixed rows as self-corrected.',
      'Every password change now sends a "your password was changed" security notice to the account owner — with the number of devices signed out — so a stolen-password rotation is never silent.',
    ],
  },
  {
    version: '2.44.0',
    title: 'Temporary passwords now expire at first sign-in — every account picks its own password',
    bullets: [
      'Accounts provisioned by an admin (Settings → Users or the HR desk\u2019s create-&-link dialog) must set their own password before they can use the app — the temporary password alone no longer opens the workspace, so a shared or overheard credential is useless the moment it is written down.',
      'The forced "Set a new password" screen shows a live strength meter with plain-language rules (length, mixed case, number, symbol) and signs out your other devices automatically once the new password is saved.',
      'Admins gained a "Force password reset" action on every user row — a violet "Rotation due" badge shows who still owes a password, which is also the one-click migration path for accounts provisioned before this release.',
      'An admin-set password reset (or a user created while "Require password change at first sign-in" is on) always demands a rotation; untick the option only when deliberately sharing a permanent credential.',
      'Leave desk polish: the amber "corrected" row marker is now a proper chip — hover it to see who corrected the request, when, and their note, without opening the dialog.',
    ],
  },
  {
    version: '2.43.0',
    title: 'Approvers now hear about corrections — no more deciding on stale dates',
    bullets: [
      'When a pending leave request is corrected on the HR desk, everyone who was notified of the ORIGINAL request now receives an amber "Corrected - re-review" bell row carrying the full before → after summary — until now only the employee was told, so an approver could approve dates that had already changed.',
      'The correction bell deep-links straight to the Leave desk, and the actor plus the employee are excluded from the fan-out (nobody is notified about their own action, and the employee already has their own "Corrected by HR" row — no duplicates).',
      'A grouped email rides along with the bell row, amber-accented and stating plainly: the request keeps its pending status, review the corrected details before deciding.',
      'Attachments got sharper too: desk-row paperclips now say what is attached and how big ("PDF · 12 KB", "Image · 179 B"), kind-coded to match the chip colors, and image attachments preview inline on the detail dialog and the employee portal card.',
    ],
  },
  {
    version: '2.42.0',
    title: 'Leave attachments — the medical certificate travels with the request',
    bullets: [
      'Leave requests now carry supporting documents: employees attach a file from the portal (a photo of the medical certificate is the classic case) and HR can attach one when filing on behalf or correcting a pending request.',
      'Attachments are governed, not a free-for-all: PDF, PNG, JPEG and WebP only, hard-capped at 500 KB, validated on the client before upload and re-validated server-side on every filing and correction path.',
      'The document is visible everywhere the request is — a kind-coded chip (PDF / image / link) on the Leave desk detail dialog, an "attachment" marker on desk rows, and an "Attached document" chip on the employee\'s portal card — one click opens it, with a download option.',
      'The correction window treats the attachment as first-class: replace or remove it and the Save button lights up exactly like any other change, with the same before → after notification to the employee.',
    ],
  },
  {
    version: '2.41.0',
    title: 'Provision a portal account without leaving the desk — create & link in one step',
    bullets: [
      'The portal-account dialog gains a "Create new account" tab next to "Link existing": when an employee has no login at all, the admin can now provision one right there instead of walking over to Settings → Users and back.',
      'The form pre-fills itself from the employee record — full name and an email suggested from the name (editable, with a re-suggest button) — and generates a readable temporary password you can regenerate or copy with one click.',
      'The role picker offers the least-privilege store roles (Cashier, Inventory Manager, Branch Manager, Store Owner) with plain-English hints; privileged roles stay in Settings → Users where the segregation-of-duties gate lives, and the create leg is SUPER_ADMIN-only exactly like the users API.',
      'One click creates the account in the employee\'s store, links it immediately, and lands both steps in the audit trail — the employee starts receiving personal leave and payroll notifications right away, and portal coverage on the directory updates instantly.',
    ],
  },
  {
    version: '2.40.0',
    title: 'Correct pending leave requests in place — no more cancel-and-refile',
    bullets: [
      'Pending leave requests gain an amber "Correct request" action on the Leave desk: fix the dates, half-day, leave type, reason or emergency contact directly — the request keeps its place in the approval flow instead of being cancelled and refiled.',
      'The correction dialog shows what changes before you save: the working-day count recomputes live (weekends skipped), the available balance rail turns red when the corrected range would not fit, and Save stays disabled until something actually changed.',
      'The employee is always told: a portal bell row and an email carry the full before → after summary (dates, days and type as they were vs now), who corrected it and an optional note explaining why.',
      'Every corrected request is traceable: the desk row and detail dialog show a "Corrected by HR" chip with the note, the employee\'s portal card does the same, and the hash-chained audit trail records the before and after values.',
      'Guardrails match the filing path: only pending requests can be corrected, only managers and HR roles can correct, and a leave-type change draws on the new type\'s balance without borrowing the old request\'s pending days.',
    ],
  },
  {
    version: '2.39.0',
    title: 'Link portal accounts to employees — the governed switch that turns on personal notifications',
    bullets: [
      'The Employee directory gains a "Portal" column and a UserCog action: bind a login to any employee and they start receiving personal in-app notifications — leave filed for them, decisions, cancellations and payroll runs — which previously required a direct database edit.',
      'Linking is governed and validated: only store owners, HR managers and super admins can manage links; the account must be active and from the employee\'s own store; one account can only be linked to one employee (a friendly conflict message names the other employee); terminated employees cannot be linked.',
      'The link dialog shows the live binding with role badges, a searchable picker of active store users with already-linked accounts filtered out, an amber warning when the employee would otherwise stay silent, and a confirm step before unlinking.',
      'Filing leave on behalf now sets expectations up front: the roster marks portal-linked employees and the dialog warns when the chosen employee has no linked account (email-only delivery). The HR desk also tracks coverage with a "Portal Linked" stat card and an "N of M portal" badge.',
    ],
  },
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
