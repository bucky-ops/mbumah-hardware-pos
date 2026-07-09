# MBUMAH HARDWARE POS — Self-Hosting Guide

Complete guide to deploying the Mbumah Hardware POS system on a local server or VPS using Docker, Nginx, and PostgreSQL.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Configuration](#configuration)
4. [SSL / HTTPS Setup](#ssl--https-setup)
5. [M-Pesa Integration](#m-pesa-integration)
6. [Database Management](#database-management)
7. [Backups](#backups)
8. [Updates & Maintenance](#updates--maintenance)
9. [Monitoring & Logs](#monitoring--logs)
10. [Troubleshooting](#troubleshooting)
11. [Architecture Diagram](#architecture-diagram)

---

## Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **OS** | Ubuntu 20.04 / Debian 11 | Ubuntu 22.04 LTS |
| **CPU** | 2 cores | 4 cores |
| **RAM** | 2 GB | 4 GB |
| **Disk** | 20 GB SSD | 50 GB SSD |
| **Docker** | 24.0+ | Latest stable |
| **Docker Compose** | v2.20+ | Latest stable |
| **Domain** | Optional (can use IP) | Recommended for SSL |

### Install Docker & Docker Compose

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group changes to take effect

# Verify installation
docker --version
docker compose version
```

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/bucky-ops/mbumah-hardware-pos.git
cd mbumah-hardware-pos
```

### 2. Configure Environment

```bash
# Copy the example env file
cp .env.example .env

# Edit with your values
nano .env
```

**Required values to change:**

```env
# Set a strong database password
POSTGRES_PASSWORD=your-strong-random-password-here

# Generate auth secrets
# Run: openssl rand -base64 32
NEXTAUTH_SECRET=paste-output-from-openssl-here
JWT_SECRET=paste-output-from-openssl-here

# Set your server URL (use https:// if you'll configure SSL)
NEXTAUTH_URL=https://your-server.com
NEXT_PUBLIC_APP_URL=https://your-server.com
```

### 3. Generate Self-Signed SSL Certificate (for initial testing)

```bash
cd nginx/ssl
./generate-self-signed.sh
cd ../..
```

> ⚠️ Self-signed certificates will cause browser security warnings. For production, use [Let's Encrypt](#ssl--https-setup).

### 4. Start the Stack

```bash
docker compose -f docker-compose.prod.yml up -d
```

### 5. Seed the Database (First Run Only)

```bash
# Set SEED_DATABASE=true in .env, then restart:
# OR run manually:
docker compose -f docker-compose.prod.yml exec app npx prisma db seed
```

### 6. Create Your Admin User

After seeding, the default admin credentials are set in `prisma/seed.ts`. **Change the password immediately after first login.**

### 7. Verify the Deployment

Open your browser and navigate to:
- **HTTP**: `http://your-server-ip`
- **HTTPS**: `https://your-server-ip` (if SSL configured)

You should see the MBUMAH HARDWARE login screen.

---

## Configuration

### Environment Variables

All configuration is done through the `.env` file. See `.env.example` for the full list.

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_USER` | Yes | PostgreSQL username |
| `POSTGRES_PASSWORD` | **Yes** | PostgreSQL password — change from default! |
| `POSTGRES_DB` | No | Database name (default: `mbumah_pos`) |
| `NEXTAUTH_SECRET` | **Yes** | NextAuth.js secret (generate with `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | **Yes** | Full URL of your deployment (e.g., `https://pos.mbumahhardware.co.ke`) |
| `JWT_SECRET` | **Yes** | JWT signing secret (generate with `openssl rand -base64 32`) |
| `SEED_DATABASE` | No | Set to `true` on first run to seed the database |
| `MPESA_ENVIRONMENT` | No | `sandbox` (default) or `production` |
| `MPESA_CONSUMER_KEY` | No | Safaricom Daraja API key |
| `MPESA_CONSUMER_SECRET` | No | Safaricom Daraja API secret |

### Changing the Nginx Ports

If ports 80/443 are already in use on your server, edit `.env`:

```env
HTTP_PORT=8080
HTTPS_PORT=8443
```

Then restart: `docker compose -f docker-compose.prod.yml up -d`

---

## SSL / HTTPS Setup

### Option 1: Let's Encrypt (Recommended)

**Prerequisite**: Your domain must point to this server's public IP.

1. **Start with HTTP only** — temporarily modify `nginx/conf.d/mbumah-pos.conf`:
   - Comment out the entire HTTPS `server` block (the one listening on 443)
   - In the HTTP `server` block, replace the `return 301` with a proxy_pass:

   ```nginx
   location / {
       proxy_pass http://nextjs_app;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

2. **Start the stack**: `docker compose -f docker-compose.prod.yml up -d`

3. **Uncomment the certbot service** in `docker-compose.prod.yml`

4. **Obtain the certificate**:
   ```bash
   docker compose -f docker-compose.prod.yml exec certbot certbot certonly \
     --webroot -w /var/www/certbot \
     -d your-server.com \
     --email your-email@example.com \
     --agree-tos --no-eff-email \
     --non-interactive
   ```

5. **Update SSL paths** in `nginx/conf.d/mbumah-pos.conf`:
   ```nginx
   ssl_certificate     /etc/nginx/ssl/live/your-server.com/fullchain.pem;
   ssl_certificate_key /etc/nginx/ssl/live/your-server.com/privkey.pem;
   ```

6. **Restore the full HTTPS config** (undo the temporary changes from step 1)

7. **Restart Nginx**: `docker compose -f docker-compose.prod.yml restart nginx`

### Option 2: Self-Signed (Testing / Internal Network)

```bash
cd nginx/ssl && ./generate-self-signed.sh && cd ../..
docker compose -f docker-compose.prod.yml up -d
```

### Option 3: Existing Certificates

Copy your certificate files:
```bash
cp /path/to/fullchain.pem nginx/ssl/server.crt
cp /path/to/private.key   nginx/ssl/server.key
docker compose -f docker-compose.prod.yml restart nginx
```

---

## M-Pesa Integration

### Sandbox (Testing)

1. Register at [Safaricom Developer](https://developer.safaricom.co.ke/)
2. Create a Daraja app and get Consumer Key + Secret
3. Set in `.env`:
   ```env
   MPESA_ENVIRONMENT=sandbox
   MPESA_CONSUMER_KEY=your-sandbox-key
   MPESA_CONSUMER_SECRET=your-sandbox-secret
   MPESA_SHORTCODE=174379
   MPESA_PASSKEY=bfb279f9aa9bdbcf158e97dd71a467cd2e0c8937…
   MPESA_CALLBACK_URL=https://your-server.com/api/payments/mpesa/callback
   ```

### Production (Live)

1. Apply for production credentials at Safaricom
2. Update `.env`:
   ```env
   MPESA_ENVIRONMENT=production
   MPESA_CONSUMER_KEY=your-production-key
   MPESA_CONSUMER_SECRET=your-production-secret
   MPESA_SHORTCODE=your-paybill-number
   MPESA_PASSKEY=your-production-passkey
   ```

3. **Ensure SSL is configured** — M-Pesa callbacks require HTTPS
4. **Register the callback URL** in the Daraja portal
5. Restart: `docker compose -f docker-compose.prod.yml restart app`

---

## Database Management

### Access PostgreSQL

```bash
# Interactive session
docker compose -f docker-compose.prod.yml exec postgres psql -U mbumah -d mbumah_pos

# Run a single query
docker compose -f docker-compose.prod.yml exec postgres psql -U mbumah -d mbumah_pos -c "SELECT count(*) FROM \"User\";"
```

### Push Schema Changes

After updating `prisma/schema.prisma`:

```bash
docker compose -f docker-compose.prod.yml exec app npx prisma db push
```

### Re-seed the Database

```bash
docker compose -f docker-compose.prod.yml exec app npx prisma db seed
```

> ⚠️ Seeding is idempotent for most data, but running it on an existing database may create duplicate entries for some seed data. Consider `prisma migrate reset` for a clean slate (this deletes all data).

---

## Backups

### Manual Backup

```bash
# Create a backup directory
mkdir -p ~/backups

# Backup PostgreSQL
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U mbumah mbumah_pos \
  | gzip > ~/backups/mbumah_pos_$(date +%Y%m%d_%H%M%S).sql.gz

# Backup environment file
cp .env ~/backups/.env_$(date +%Y%m%d_%H%M%S)
```

### Automated Daily Backup (Cron)

```bash
# Add to crontab
crontab -e
# Add this line (runs daily at 2 AM):
0 2 * * * docker compose -f /path/to/mbumah-hardware-pos/docker-compose.prod.yml exec -T postgres pg_dump -U mbumah mbumah_pos | gzip > /root/backups/mbumah_pos_$(date +\%Y\%m\%d_\%H\%M\%S).sql.gz

# Keep only last 30 days of backups
0 3 * * * find /root/backups -name "mbumah_pos_*.sql.gz" -mtime +30 -delete
```

### Restore from Backup

```bash
# Stop the app to prevent writes during restore
docker compose -f docker-compose.prod.yml stop app

# Restore the database
gunzip -c ~/backups/mbumah_pos_YYYYMMDD_HHMMSS.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U mbumah -d mbumah_pos

# Restart the app
docker compose -f docker-compose.prod.yml start app
```

---

## Updates & Maintenance

### Update to the Latest Version

```bash
# 1. Pull the latest code
git pull origin main

# 2. Rebuild the Docker image
docker compose -f docker-compose.prod.yml build app

# 3. Push any database schema changes
docker compose -f docker-compose.prod.yml exec app npx prisma db push

# 4. Restart with the new image
docker compose -f docker-compose.prod.yml up -d

# 5. Verify the update
docker compose -f docker-compose.prod.yml logs app --tail=50
```

### Clean Up Old Images

```bash
# Remove unused Docker images (frees disk space)
docker image prune -f

# Remove all unused Docker resources (images, networks, volumes not used by running containers)
docker system prune -f
```

---

## Monitoring & Logs

### View Logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs --tail=100

# Specific service
docker compose -f docker-compose.prod.yml logs app --tail=100
docker compose -f docker-compose.prod.yml logs postgres --tail=100
docker compose -f docker-compose.prod.yml logs nginx --tail=100

# Follow logs in real-time
docker compose -f docker-compose.prod.yml logs app -f

# Nginx access logs (from host)
tail -f nginx/logs/access.log
tail -f nginx/logs/error.log
```

### Health Check

```bash
# Check container status
docker compose -f docker-compose.prod.yml ps

# Application health endpoint
curl http://localhost:3000/api/health

# Quick system resource check
docker stats --no-stream
```

---

## Troubleshooting

### App won't start / "Loading..." hangs

```bash
# Check app logs for errors
docker compose -f docker-compose.prod.yml logs app --tail=200

# Common causes:
# 1. Database not ready → wait and restart
# 2. Missing NEXTAUTH_SECRET → set in .env
# 3. Invalid DATABASE_URL → check postgres is running

# Force rebuild (clears cached layers)
docker compose -f docker-compose.prod.yml build --no-cache app
docker compose -f docker-compose.prod.yml up -d
```

### Database connection refused

```bash
# Check if postgres is healthy
docker compose -f docker-compose.prod.yml ps postgres

# Check postgres logs
docker compose -f docker-compose.prod.yml logs postgres --tail=50

# Test connection from app container
docker compose -f docker-compose.prod.yml exec app wget -q -O- http://postgres:5432 2>&1 || echo "Cannot reach postgres"

# If postgres keeps restarting, check disk space
df -h
```

### Nginx 502 Bad Gateway

```bash
# App is not running or not responding
docker compose -f docker-compose.prod.yml ps app
docker compose -f docker-compose.prod.yml logs app --tail=50

# Restart just the app
docker compose -f docker-compose.prod.yml restart app

# Check if app responds directly (bypass nginx)
docker compose -f docker-compose.prod.yml exec nginx wget -q -O- http://app:3000/api/health
```

### SSL certificate errors

```bash
# Check if certificate files exist
ls -la nginx/ssl/

# Verify certificate validity
openssl x509 -in nginx/ssl/server.crt -text -noout | head -20

# Regenerate self-signed cert
cd nginx/ssl && ./generate-self-signed.sh && cd ../..
docker compose -f docker-compose.prod.yml restart nginx

# Let's Encrypt renewal (manual)
docker compose -f docker-compose.prod.yml exec certbot certbot renew
docker compose -f docker-compose.prod.yml restart nginx
```

### Port already in use

```bash
# Find what's using port 80/443
sudo lsof -i :80
sudo lsof -i :443

# Change ports in .env
HTTP_PORT=8080
HTTPS_PORT=8443

# Restart
docker compose -f docker-compose.prod.yml up -d
```

### Disk space full

```bash
# Check disk usage
df -h

# Docker cleanup
docker system prune -a --volumes  # WARNING: deletes all unused volumes including database!

# Safer: only remove unused images
docker image prune -f

# Check database size
docker compose -f docker-compose.prod.yml exec postgres psql -U mbumah -d mbumah_pos -c \
  "SELECT pg_size_pretty(pg_database_size('mbumah_pos'));"
```

---

## Architecture Diagram

```
                    ┌─────────────────────────────────┐
                    │        Internet / LAN           │
                    └────────────┬────────────────────┘
                                 │
                          Port 80 / 443
                                 │
                    ┌────────────▼────────────────────┐
                    │         Nginx Container         │
                    │  ┌───────────────────────────┐  │
                    │  │  SSL Termination           │  │
                    │  │  Security Headers          │  │
                    │  │  Rate Limiting             │  │
                    │  │  Reverse Proxy → app:3000  │  │
                    │  │  Static Asset Caching      │  │
                    │  └───────────────────────────┘  │
                    └────────────┬────────────────────┘
                                 │
                          Internal :3000
                                 │
                    ┌────────────▼────────────────────┐
                    │      Next.js App Container      │
                    │  ┌───────────────────────────┐  │
                    │  │  Standalone Server         │  │
                    │  │  API Routes               │  │
                    │  │  SSR / RSC Pages           │  │
                    │  │  Prisma Client             │  │
                    │  │  M-Pesa Integration        │  │
                    │  └──────────┬────────────────┘  │
                    └─────────────┼───────────────────┘
                                  │
                           Internal :5432
                                  │
                    ┌─────────────▼───────────────────┐
                    │    PostgreSQL Container          │
                    │  ┌───────────────────────────┐  │
                    │  │  mbumah_pos database       │  │
                    │  │  pg_trgm extension         │  │
                    │  │  Persistent Volume         │  │
                    │  └───────────────────────────┘  │
                    └─────────────────────────────────┘
```

### Docker Network

All containers communicate over the `mbumah-internal` bridge network. Only Nginx exposes ports (80/443) to the host. PostgreSQL and the App are NOT accessible from outside the Docker network, providing defense-in-depth security.

---

## Security Checklist

- [ ] Change `POSTGRES_PASSWORD` from the default
- [ ] Generate unique `NEXTAUTH_SECRET` and `JWT_SECRET`
- [ ] Configure SSL/HTTPS (Let's Encrypt or custom certificate)
- [ ] Set `MPESA_ENVIRONMENT=production` only after testing in sandbox
- [ ] Change the default admin password after first login
- [ ] Set up automated database backups
- [ ] Configure firewall: only allow ports 22 (SSH), 80, 443
- [ ] Disable password-based SSH (use keys only)
- [ ] Review Nginx rate limiting settings for your traffic patterns
- [ ] Keep Docker and the OS updated: `apt update && apt upgrade`

---

*Last updated: July 2025 — MBUMAH HARDWARE POS v3.0.0*
