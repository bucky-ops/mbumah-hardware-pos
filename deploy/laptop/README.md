# MBUMAH HARDWARE POS — Laptop / Standalone Install

Run the entire POS & ERP on **one laptop** — no Vercel, no cloud database, no
external dependencies. The laptop itself is the server; other devices on the
shop Wi-Fi (phones, tablets, other PCs) connect to it over the LAN.

Stack (all local, via `docker-compose.laptop.yml`):

| Service | What it does |
|---|---|
| `postgres` | PostgreSQL 15 with a persistent local volume — all data stays on the laptop |
| `app` | Next.js POS (standalone build), exposed on port `3000` |
| `cron` | In-stack scheduler replacing Vercel Cron — fires `/api/cron/hourly` every hour and `/api/cron/nightly` daily at 02:00 local time (outbox pump, M-Pesa payments sweeper, eTIMS retry, debt reminders, reconciliation, retention) |

---

## Requirements

| Item | Minimum |
|---|---|
| Laptop RAM | 8 GB recommended (Docker + Postgres + Next.js) |
| Disk | 20 GB free |
| OS | Windows 10/11 (Docker Desktop + WSL2), Ubuntu 20.04+, or macOS |
| Docker | Desktop/Engine 24+ with Compose v2 |
| Browser on POS terminals | **Chrome or Edge** (thermal receipt printing uses WebUSB — Firefox/Safari do not work) |
| Internet | Needed **only** during the first build (~10–15 min) and for M-Pesa / eTIMS(KRA) / SMS-email features. Selling, inventory, printing and reporting work fully offline. |

---

## Quick Start (one command)

### Windows (PowerShell)
```powershell
git clone https://github.com/bucky-ops/mbumah-hardware-pos.git
cd mbumah-hardware-pos
powershell -ExecutionPolicy Bypass -File deploy\laptop\install-laptop.ps1
```

For shop-LAN access (cashiers' devices connect to the laptop):
```powershell
powershell -ExecutionPolicy Bypass -File deploy\laptop\install-laptop.ps1 -UseLan
# or force a specific IP:
#   ... -LanIp 192.168.1.50
```

### Linux / macOS / WSL
```bash
git clone https://github.com/bucky-ops/mbumah-hardware-pos.git
cd mbumah-hardware-pos
bash deploy/laptop/install-laptop.sh          # localhost only
bash deploy/laptop/install-laptop.sh --lan    # shop-LAN access
```

The installer: checks Docker → creates `.env` with **freshly generated
secrets** → builds → starts the stack → waits for `/api/health` → prints the
login credentials.

---

## Manual install (if you prefer)

```bash
cp deploy/laptop/.env.laptop.example .env
# edit .env: set POSTGRES_PASSWORD, NEXTAUTH_SECRET, JWT_SECRET, CRON_SECRET
#            (openssl rand -base64 32) and NEXTAUTH_URL / NEXT_PUBLIC_APP_URL
docker compose -f docker-compose.laptop.yml up -d --build
```

---

## First login & go-live

1. Open `http://localhost:3000` (or `http://<laptop-ip>:3000` in LAN mode).
2. Log in with the seeded Super Admin — `admin@mbumahhardware.co.ke` / `password123`.
3. **Change the admin password immediately** (Profile → Security).
4. Set `SEED_DATABASE=false` in `.env`, then
   `docker compose -f docker-compose.laptop.yml up -d`.
   (The seed re-creates its demo users on every run — don't leave it on.)
5. Configure M-Pesa in `.env` if the client will take mobile payments
   (`MPESA_ENVIRONMENT=production` + real Daraja credentials; production
   callbacks additionally need a publicly reachable HTTPS URL — see the main
   docs/deployment.md (self-hosting).
6. Verify: About dialog (in-app) must show **v2.7.x**; run a test sale,
   print a receipt, open/close a shift.

---

## LAN access for other devices

Set **both** `NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL` in `.env` to
`http://<laptop-ip>:3000` and restart the stack. NextAuth rejects logins if
the browser URL doesn't match `NEXTAUTH_URL` — this is the #1 cause of
"login loops" on LAN installs. Find the laptop IP:

- Windows: `ipconfig` → IPv4 Address
- Linux/macOS: `hostname -I | awk '{print $1}'`

Give the laptop a **static/reserved DHCP address** on the shop router so the
URL never changes.

---

## Daily operations

```bash
# status
docker compose -f docker-compose.laptop.yml ps

# logs
docker compose -f docker-compose.laptop.yml logs app --tail=100

# restart after .env change
docker compose -f docker-compose.laptop.yml up -d

# stop / start (end of day / next morning)
docker compose -f docker-compose.laptop.yml down
docker compose -f docker-compose.laptop.yml up -d

# backup (run before closing shop — copy the file somewhere safe)
docker compose -f docker-compose.laptop.yml exec -T postgres \
  pg_dump -U mbumah mbumah_pos | gzip > "mbumah_pos_$(date +%Y%m%d_%H%M%S).sql.gz"

# update to a newer release
git pull origin main
docker compose -f docker-compose.laptop.yml up -d --build
```

Windows note: the backup pipe works in PowerShell as
`docker compose -f docker-compose.laptop.yml exec -T postgres pg_dump -U mbumah mbumah_pos | Set-Content -Encoding Byte backup.sql` — or simply run it from Git Bash.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Build fails at `COPY package.json bun.lockb` | You're on an old checkout — `git pull` (fixed in this branch: `bun.lock` text lockfile) |
| Login loops / instant logout on other devices | `NEXTAUTH_URL` doesn't match the browser URL — set it to `http://<laptop-ip>:3000` and `up -d` |
| `app` container restart-looping after restart | `SEED_DATABASE` still `true` — set it to `false` in `.env`, then `up -d` |
| Port 3000 already in use | Set `APP_PORT=3001` in `.env` and restart |
| Thermal printer not printing | Use Chrome/Edge; allow the WebUSB device permission prompt; printer must be plugged into the POS terminal itself |
| App slow after long uptime | Check `docker stats --no-stream`; close other heavy apps; 8 GB+ RAM recommended |
| Data lost after recreate | The database lives in the `laptop_postgres_data` volume — never run `docker system prune --volumes` |

---

## What works offline vs. needs internet

| Works offline (fully local) | Needs internet |
|---|---|
| POS sales, cart, checkout | M-Pesa STK Push (Safaricom Daraja) |
| Inventory & stock movements | eTIMS / KRA invoice submission |
| Receipt printing (WebUSB thermal) | SMS / email notifications (Twilio / Resend) |
| Shifts, cash drawer, reports | GitHub updates (`git pull`) |
| Customers, debt ledgers, payroll | Sentry error reporting (if DSN configured) |

---

## Security notes for shop deployments

- Change `POSTGRES_PASSWORD` (the installer generates one) and the admin password.
- The database port is **not** exposed to the host or LAN — only the app is.
- Don't port-forward port 3000 to the internet without adding SSL (see docs/deployment.md for the Nginx/Let's Encrypt path).
- Back up daily and keep a copy off the laptop (USB / cloud drive).
- Windows: enable BitLocker; Linux: full-disk encryption — the laptop holds all business data.
