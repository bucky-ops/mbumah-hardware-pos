# Organization Console — Expert Design Specification (v2.18.2)

> Companion docs: `BRAND.md` (identity), `CURRENT_RELEASE_CHECK_v2.18.x.md` (release state),
> `TEST_AUDIT_REPORT_v2.18.x.json` (25-point E2E verdict).

## 1. Layout system

- **Grid**: Inter font, 16px base, `rounded-2xl` white cards on `bg-slate-100`, `border-slate-200`, `shadow-sm` → `hover:shadow-lg` + `-translate-y-0.5` lift. Responsive: 6→3→2→1 KPI columns (`xl:grid-cols-6 lg:grid-cols-3 sm:grid-cols-2`), content max-width 1600px, sidebar 260px labels ↔ 64px icon rail.
- **Chrome**: header + footer in brand navy `#0f172a`/`#0F1E33`; accent orange `#FF8C00`; semantic emerald/blue/red/amber/slate.
- **Footer rule**: `min-h-screen flex flex-col` root, `mt-auto` footer — sticks on short pages, pushes naturally on overflow (both routes verified).

## 2. Motion inventory

| Animation | Where | Spec |
|---|---|---|
| `pulse-dot` | Revenue dot, unread badges, live dots | 2s ease-in-out infinite |
| `shake` | Debt card header (>400k) | 0.5s infinite, ±2px |
| `pop-in` | CREATE rows, timeline dots, badges | 0.25s scale .8→1 |
| `drop-pulse` | Kenya map branch dots | 0.5s drop + SMIL radius pulse 2.4s |
| `count-glow` | Revenue count-up text | 1s orange glow |
| `slide-fade` | Branch chips, alerts, chat messages | 0.3s rise+fade, staggered 70–100ms |
| `live-pulse` | Connected/Health/Live dots | 2s ring ping |
| count-up | Revenue (1s), all KPI numbers (1s), gauge (1.5s) | rAF cubic ease-out |

## 3. Console regions (top → bottom)

1. **Header** — 48px logo in white `rounded-xl` tile, MBUMAH HARDWARE + tagline, `v2.18.x-dev` badge, Connected pulse, Health circular gauge (0→87/1.5s, green≥80/amber≥60/red), branch selector dropdown (5 + org console), cmd+K button, notifications (4) / chat (3 unread) / cart (7) with red pulse count chips, SUPER_ADMIN user chip + login, live date, Shortcuts, Online/Offline + Queue + Retry. Safe-area padding on iOS.
2. **Branch strip** — 5 brand-colored chips (JUJ/THI/RUI/NAI/NAK) stagger fade-in 100ms, hover lift; click opens `/stores/{code}/dashboard` in new tab; health badge per chip.
3. **KPI Command Row** — Revenue 48,270 (orange left border, pulse dot, 7d sparkline +231,850, +12% variance, count-up 1s, click → 7d/30d/90d trend modal with enlarged sparkline); Transactions 1 (+8%); Low stock 1 (orange pulse, ring when >0); Overdue 1 (red pulse, ring); Debt 437,479 (red, header shake >400k, compact aging chips C 180k / 30d 97.5k / 60d 80k / 90d+ 80k); Pending 0 (slate).
4. **Health + Today at a glance** — Kenya SVG heatmap (drop-pulse dots sized/colored by revenue: orange hot, emerald warm, slate cold) + 6 fact tiles.
5. **Branch Intelligence Matrix** — 13 columns (Branch chip + subdomain, Revenue, Variance, Txns, Stock Health %, Low Stock, Overdue Rentals, Debt Total, Aging 90+, Shift Open/Closed, M-Pesa Matched/Mismatch, eTIMS Pending, Actions). Sticky `bg-slate-50/95` header, per-column drag resizers (`cursor-col-resize`, min-width guarded), Columns dropdown (checkbox visibility), CSV export (`branch_intelligence.csv`), PDF via print stylesheet. Row actions: Open Workspace (modal), View Inventory, View Debt, Start/Close Shift, View Reports.
6. **Domain Expert Modules** — 9 tabs: Inventory (tiles + 7d demand forecast table + low-stock reorder badges), Debt/Mkopo (aging, top-10 debtors w/ utilization + status + risk, plans, reminders, debt CSV), Rentals (fleet ledger — hidden from public, authorized roles), Financials (P&L tiles + trial balance table + VAT 16%/zero/exempt), Suppliers (performance scores, delayed flags, POs), M-Pesa (matched/mismatch/duplicates/timeouts tiles + Daraja ledger w/ masked phones + Retry query — no secrets), eTIMS (queue + retry), Audit (live CREATE pop-in rows), System (health breakdown tiles + env templates).
7. **Decision Support Action Center** — severity-colored alerts (red/amber/blue) each with action chips; queue card (pending expenses, POs, open shifts, step-ups) + manager step-up modal (email/password, "audit-logged" note).
8. **Recent Activity Timeline** — vertical rail, live 15s poll, new rows pop-in + emerald 3s fade, filters (action/role), row click → detail modal (Timestamp/User/Role/Action/Resource/Result/Branch/IP).
9. **Global Chat drawer** (right sheet) — org-wide/branch scope selector, 8s poll, send box (rate-limited POST; guests tagged), unread pulse badge.
10. **Live Feed** — `[LEVEL] HH:MM message · component` mono ticker, level filter chips (ALL/INFO/WARN/ERROR), green 3s highlight on new rows.
11. **Footer** — `v2.18.x-dev · Connected · Shortcuts · Changelog | Health 87/100 · Branches 5 · Last sync · Env · 282 commits · 55 releases · 58 tags · e49f48ec`.

## 4. Interaction & keyboard

- `cmd/ctrl+K` command palette: Actions (nav, chat, shortcuts, changelog, sign-in, refresh), Branch workspaces, Exports (branch intelligence / sales / debt CSV).
- `F2` experts, `F3` inventory expert, `F4` branch CSV export, `F5` live-feed refresh, `F11` native fullscreen; rail autohide after 2s idle with left-edge 20px peek + hamburger pin.
- Login dialog (real `/api/auth/login`, scrypt, rate-limited); user chip reflects session; anonymous visitors get full read-only demo with SUPER_ADMIN-view chip.

## 5. Data contract

Single aggregate `GET /api/dashboard` (public read, masked PII) powers every region; poll 30s. Mutations require session + role (defense layer 2). Seed (`bun scripts/seed.ts`) guarantees the exact acceptance numbers in `TEST_AUDIT_REPORT_v2.18.x.json`.

## 6. Security posture

- Public READ allowlist is explicit and GET-only (`src/proxy.ts`); every mutation falls through to JWT session verification; routes re-verify roles.
- PII: M-Pesa phones masked `254733****111`; customer balances only in authorized modules; no cost prices in public surfaces; no raw internal IDs in UI badges; chat content rendered as text (XSS-inert).
- Engraved admin self-healing cannot be deleted/demoted through the app (403 ENGRAVED_ADMIN_PROTECTED policy documented).
