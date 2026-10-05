# MBUMAH HARDWARE POS — No-Docker Laptop Install (Node.js + SQLite)

Run the entire POS & ERP on **one laptop with NO Docker, NO virtualization,
and NO database server**. Ideal for older/low-spec machines where Docker
Desktop will not install or run.

**Stack:** Node.js 20 + Next.js standalone build + one SQLite file.
The whole database is a single file (`~/mbumah-pos-data/pos.db`) — backing up
the entire system means copying that one file to a USB stick.

> Confidence note: the application's own CI test suite (427 tests) runs on
> SQLite, and `scripts/setup-prisma-provider.mjs` automatically switches the
> database provider from PostgreSQL to SQLite when `DATABASE_URL` starts with
> `file:`. SQLite mode is a first-class, tested configuration of this codebase.

---

## ⚡ One-click installer (recommended — the "game installer" experience)

On Windows, open the repo folder and **double-click `Install-Mbumah-POS.bat`**.
It behaves like a game installer:

1. Finds the app source (this folder — or downloads the latest `main` from GitHub)
2. Installs Node.js 20 LTS automatically if it is missing
3. Runs the complete install: dependencies → database schema → seed → production build
4. Creates two Desktop shortcuts with a branded icon:
   - **Mbumah POS** — starts the entire system (app + background jobs + browser)
   - **Backup POS Data** — one-click backup of the database + configuration

For shop-LAN access run it once from a terminal so the LAN IP is baked in:
```bat
Install-Mbumah-POS.bat -UseLan
:: or pin the IP:
Install-Mbumah-POS.bat -LanIp 192.168.1.50
```

Daily use afterwards = double-click **Mbumah POS** on the Desktop. Close the
black windows to close the shop. That is the entire workflow for staff.

---

## 🧹 Go-Live Reset — wipe the demo data before the first real sale

The seeded system comes with **demo transactions, customers, chats, purchase
orders and payroll** so staff can train on realistic data. Before the first
REAL sale, wipe the history while keeping the business setup:

```bat
Wipe-Demo-Data.bat
```

(double-click at the repo root, with the POS windows closed — it asks you to
type `GO-LIVE-WIPE` to confirm, then reports exactly what it deleted and what
it kept. Equivalent command: `node deploy/nodocker/wipe-demo-data.mjs`.)

- **Deleted:** sales transactions, payments, M-Pesa records, receipts,
  KRA/eTIMS invoices, debt ledgers/payments/plans, journal entries, stock
  movements, purchase orders, expenses, chats, notifications, outbox events,
  shifts, cash-drawer logs, banking movements, loyalty activity, invoices,
  delivery notes, store transfers, payroll, customers, suppliers, employees
- **Kept:** users & passwords, stores, products, categories, stock levels,
  chart of accounts, tax rates, loyalty tiers/campaigns, gift-card/voucher
  config, system settings, audit logs

The wipe runs in a **single atomic transaction** — if anything fails, nothing
is changed. It verifies `0 sales transactions` remain before reporting success.

Recommended sequence: install → staff trains on demo data → double-click
**Wipe-Demo-Data.bat** → set `SEED_DATABASE=false` in `.env` → start selling.

---

## Requirements

| Item | Minimum |
|---|---|
| Laptop RAM | 4 GB is enough (no VM overhead) |
| Disk | ~3 GB free (dependencies + build + database) |
| OS | Windows 10/11 64-bit, Ubuntu 20.04+, or macOS |
| Node.js | **20 LTS or newer** (installer offers to install it via winget) |
| Browser on POS terminal | **Chrome or Edge** (thermal printing uses WebUSB) |
| Internet | Needed for the install/build (~10 min) and for M-Pesa / eTIMS / SMS. Daily selling works fully offline. |

---

## Install — command line (equivalent to the one-click installer)

### Windows
```powershell
git clone https://github.com/bucky-ops/mbumah-hardware-pos.git
cd mbumah-hardware-pos
powershell -ExecutionPolicy Bypass -File deploy\nodocker\install-nodocker.ps1
```

For shop-LAN access (phones/other PCs connect to the laptop):
```powershell
powershell -ExecutionPolicy Bypass -File deploy\nodocker\install-nodocker.ps1 -UseLan
# or pin the IP:  ... -LanIp 192.168.1.50
```

### Linux / macOS
```bash
git clone https://github.com/bucky-ops/mbumah-hardware-pos.git
cd mbumah-hardware-pos
bash deploy/nodocker/install-nodocker.sh           # localhost only
bash deploy/nodocker/install-nodocker.sh --lan     # shop-LAN access
```

The installer: checks/installs Node + bun → creates `.env` with **freshly
generated secrets** and a database file in `~/mbumah-pos-data/` → installs
dependencies (npm ci) → creates the schema → seeds → builds → assembles the
standalone server.

> ⚠ Decide LAN vs localhost **before** running the installer: `NEXT_PUBLIC_APP_URL`
> is baked into the build. Changing it later means re-running `npm run build`.

---

## What gets installed (complete system, nothing else to do)

1. **Full database** — every table (products, transactions, customers,
   employees, payroll, debt ledgers, banking, chat, audit trail…)
2. **Seeded business data** — Super Admin + 11 staff users, 5 Mbumah stores,
   RBAC permissions, categories, product catalog, customers, demo
   transactions/purchase orders (useful for staff training — see the
   Go-Live Reset section above before real trading)
3. **The application** — production build, persistent SQLite storage
4. **Desktop shortcuts** — Start + Backup

---

## Daily use (built for non-technical staff)

**Start the POS:** double-click **Mbumah POS** on the Desktop (or:
```powershell
powershell -ExecutionPolicy Bypass -File deploy\nodocker\start-pos.ps1
```).

This opens two console windows (the **POS server** and **background jobs**)
and the browser. *Closing the POS-server window stops the POS.* Closing the
background-jobs window is not fatal, but keep it open so eTIMS retries, debt
reminders and reconciliation keep running.

**Stop the POS:** close the console window (or Ctrl+C).

**Back up:** double-click **Backup POS Data** on the Desktop after closing
shop — it copies the database into `Desktop\MbumahBackups\` with a timestamp.
Then copy that folder to a USB stick or OneDrive. A backup that only lives on
the same laptop is not a backup.

**Optional — auto-start at login (Windows):**
```powershell
schtasks /create /tn "Mbumah POS" /sc onlogon /tr ^
  "powershell -ExecutionPolicy Bypass -File '<full-path>\deploy\nodocker\start-pos.ps1'"
```

---

## First login & go-live

1. Open the POS → log in as `admin@mbumahhardware.co.ke` / `password123`.
2. **Change the admin password immediately** (Profile → Security).
3. Let staff train on the demo data as long as needed.
4. Before the first real sale: double-click **Wipe-Demo-Data.bat** (see the
   Go-Live Reset section above).
5. Set `SEED_DATABASE=false` in `.env`.
6. M-Pesa: fill Daraja credentials in `.env`, restart. Production callbacks
   need a public HTTPS URL (see SELF_HOSTING_GUIDE.md).
7. Verify: About dialog shows v2.7.x; test sale, receipt print, shift close.

---

## Backups (much simpler than Docker/Postgres)

The entire database is ONE file:

- **Windows:** `%USERPROFILE%\mbumah-pos-data\pos.db`
- **Linux/macOS:** `~/mbumah-pos-data/pos.db`

Backup = double-click **Backup POS Data**, or copy that file manually (while
the POS is closed). Restore = stop the POS, copy the file back, start.

> 💡 Take a backup BEFORE running the Go-Live Reset — if you ever want the
> demo data back for training, it's in `Desktop\MbumahBackups\`.

---

## Updating to a newer release

```bash
git pull origin main
npm ci
npm run db:push        # apply schema changes
npm run build          # rebuild (SKIP_ENV_VALIDATION=1 is set by the installer; re-set it if needed)
# then start with start-pos.ps1 / start-pos.sh (they refresh static assets)
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `node` not recognized after install | Close and reopen PowerShell (PATH refresh) |
| Build fails: Prisma provider errors | `.env` must exist with `DATABASE_URL=file:...` BEFORE `npm ci` (the installer handles this) |
| Login loops on phones | `NEXTAUTH_URL` ≠ browser URL → set both URL vars to `http://<laptop-ip>:3000` and rebuild |
| App restarts / seed errors every boot | `SEED_DATABASE` still `true` → set to `false` in `.env` |
| Port 3000 busy | `APP_PORT=3001` in `.env` |
| Printer won't print | Chrome/Edge only · accept the WebUSB prompt · printer plugged into the POS terminal itself |
| Slow performance | Close heavy apps; 4 GB RAM is fine, 8 GB is comfortable |
| Database locked error during wipe | The POS (or background-jobs window) is still running — close both, then re-run |

---

## Differences vs the Docker/Vercel deployments

| Area | No-Docker laptop |
|---|---|
| Database | SQLite file (vs PostgreSQL) — same Prisma code, CI-tested |
| Store-isolation RLS script | Not applied (Postgres-only feature; irrelevant on a single-device install) |
| Background jobs | `deploy/nodocker/cron-local.mjs` console window (vs Vercel Cron / compose cron container) |
| Backups | Copy one file (vs pg_dump) |
| Demo-data wipe | `Wipe-Demo-Data.bat` — provider-agnostic, works on SQLite and PostgreSQL alike |
| Scaling | Single store/terminal set on one laptop — perfect for one shop; move to Docker/Postgres when multi-server is needed |

Offline capability is unchanged: selling, inventory, printing, shifts and
reports work without internet; M-Pesa, eTIMS/KRA and SMS/email need connectivity.
