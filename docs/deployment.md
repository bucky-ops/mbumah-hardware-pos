# Deployment

Mbumah Hardware POS supports two deployment paths:

- **Vercel** with a managed serverless PostgreSQL provider (Neon recommended, Supabase supported). Best for multi-branch access over the internet.
- **Docker Compose** on a local server or VPS with Nginx and PostgreSQL. Best when the shop must keep running without internet.

Environment variables are listed in [Configuration](configuration.md). Failure modes after deploying are collected in [Troubleshooting and FAQ](troubleshooting-and-faq.md).

## Vercel

The project is optimized for Vercel deployment:

1. Fork the repository to your GitHub account.
2. Import the project on [Vercel](https://vercel.com/new).
3. Configure environment variables in the Vercel dashboard.
4. Set `DATABASE_URL` to a PostgreSQL connection string (for example [Neon](https://neon.tech/) or [Supabase](https://supabase.com/)).
5. Update `prisma/schema.prisma`: change `provider` from `"sqlite"` to `"postgresql"`.
6. Deploy. Vercel runs the `vercel-build` script from `package.json`, which handles Prisma generation automatically.

### Build settings

In the Vercel project settings, verify:

| Setting | Value |
|---------|-------|
| Framework preset | Next.js |
| Build command | Leave empty to use `vercel.json` / the `vercel-build` script (`prisma generate && next build`) |
| Output directory | `.next` (default) |
| Install command | `npm install` (default) |
| Node.js version | 20.x |

### Environment variable scoping

Vercel boots an API route with `undefined` for a variable that is missing, scoped to the wrong environment, or contains a trailing space. After setting variables, check each one for Production, Preview, and Development, then redeploy (Vercel does not redeploy on env-only changes). Required runtime variables: `DATABASE_URL` (pooled), `DIRECT_DATABASE_URL` (unpooled, for migrations), `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `JWT_SECRET`.

### GitHub Actions secrets (optional)

If you want the GitHub Actions deployment workflow to run, add these secrets in the GitHub repository settings:

| Secret | Source |
|--------|--------|
| `VERCEL_TOKEN` | Create at https://vercel.com/account/tokens (Full Account scope) |
| `VERCEL_ORG_ID` | Shown at https://vercel.com/account under Vercel ID |
| `VERCEL_PROJECT_ID` | Shown in the Vercel project settings |

### Database setup after the first deploy

Vercel runs `prisma generate && next build`; it does not run migrations. After the first successful deploy, push the schema and seed from a machine that has the same `DATABASE_URL` and `DIRECT_DATABASE_URL`:

```bash
bun install
bun run db:push   # creates the tables on Neon (runs scripts/setup-prisma-provider.mjs && prisma db push)
bun run db:seed   # seeds stores, demo users, sample products
```

### Neon and serverless Postgres connection pooling

Neon, Supabase, and similar providers route runtime traffic through PgBouncer in transaction mode. Prisma must be told, or it will fail with `prepared statement "s0" already exists` or connection-pool timeouts.

```bash
# Neon: use the "-pooler" hostname for DATABASE_URL
DATABASE_URL="postgresql://user:pass@ep-cool-name-pooler.region.aws.neon.tech/dbname?sslmode=require&pgbouncer=true&connect_timeout=15"

# Supabase: use the transaction-mode pooler (port 6543)
DATABASE_URL="postgresql://user:pass@db.xxxxx.supabase.co:6543/postgres?pgbouncer=true&connect_timeout=15"

# Neon unpooled hostname for DIRECT_DATABASE_URL (migrations)
DIRECT_DATABASE_URL="postgresql://user:pass@ep-cool-name.region.aws.neon.tech/dbname?sslmode=require"
```

| Parameter | Why |
|-----------|-----|
| `pgbouncer=true` | Disables prepared statements, which break under PgBouncer transaction mode. |
| `connect_timeout=15` | Cold serverless computes can take 8 to 10 seconds to wake; Prisma's default of 5 seconds is too aggressive on Vercel. |

Migrations cannot run through PgBouncer, so the schema uses `directUrl`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")          // pooled, used at runtime by Prisma Client
  directUrl = env("DIRECT_DATABASE_URL")   // unpooled, used by prisma migrate / db push
}
```

### Prisma generation in the build

Keep `prisma generate` (and `SKIP_ENV_VALIDATION=1`) in the `vercel-build` script; otherwise every database call fails after deploy:

```json
{
  "scripts": {
    "vercel-build": "node scripts/setup-prisma-provider.mjs && SKIP_ENV_VALIDATION=1 prisma generate && SKIP_ENV_VALIDATION=1 next build"
  }
}
```

`SKIP_ENV_VALIDATION=1` prevents `next build` from eagerly validating runtime secrets while collecting page data for `/api/*` routes.

### Post-deployment checks

1. Open the deployment URL and confirm the login screen renders.
2. Check the health endpoint (`/api/health`) returns the app version and a healthy status.
3. Sign in with a seeded account and run a sale through the POS.
4. Set `MPESA_CALLBACK_URL` to `https://your-app.vercel.app/api/payments/mpesa/callback` and register it in the Daraja portal (no tunneling needed in production).
5. Inspect Vercel function logs if anything fails: Vercel dashboard, open the deployment, then Function Logs (or `vercel logs --follow`).

## Docker Compose (self-hosted)

For self-hosted production with the standard compose file:

```bash
# Build and start all services
docker-compose up -d

# Run database migrations
docker-compose exec app npx prisma migrate deploy

# Seed the database
docker-compose exec app npx prisma db seed
```

`docker-compose.yml` includes an app service (Next.js production server), a PostgreSQL service, and an M-Pesa mock server for local payment simulation.

## Self-hosting guide (Docker, Nginx, PostgreSQL)

This is the full procedure for a local server or VPS using `docker-compose.prod.yml`.

### Prerequisites

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| OS | Ubuntu 20.04 / Debian 11 | Ubuntu 22.04 LTS |
| CPU | 2 cores | 4 cores |
| RAM | 2 GB | 4 GB |
| Disk | 20 GB SSD | 50 GB SSD |
| Docker | 24.0+ | Latest stable |
| Docker Compose | v2.20+ | Latest stable |
| Domain | Optional (can use IP) | Recommended for SSL |

Install Docker and Docker Compose:

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# Log out and back in for group changes to take effect

# Verify installation
docker --version
docker compose version
```

### Quick start

```bash
# 1. Clone the repository
git clone https://github.com/bucky-ops/mbumah-hardware-pos.git
cd mbumah-hardware-pos

# 2. Configure the environment
cp .env.example .env
nano .env
```

Required values to change in `.env`:

```env
# Set a strong database password
POSTGRES_PASSWORD=your-strong-random-password-here

# Generate auth secrets: openssl rand -base64 32
NEXTAUTH_SECRET=paste-output-from-openssl-here
JWT_SECRET=paste-output-from-openssl-here

# Set your server URL (use https:// if you configure SSL)
NEXTAUTH_URL=https://your-server.com
NEXT_PUBLIC_APP_URL=https://your-server.com
```

```bash
# 3. Generate a self-signed SSL certificate for initial testing
cd nginx/ssl
./generate-self-signed.sh
cd ../..

# 4. Start the stack
docker compose -f docker-compose.prod.yml up -d

# 5. Seed the database (first run only):
#    either set SEED_DATABASE=true in .env and restart,
#    or run it manually:
docker compose -f docker-compose.prod.yml exec app npx prisma db seed

# 6. Change the seeded admin password immediately after first login.

# 7. Verify: open http://your-server-ip (or https:// if SSL is configured)
#    and confirm the MBUMAH HARDWARE login screen appears.
```

Self-signed certificates produce browser security warnings; use Let's Encrypt for production (see SSL below).

### Nginx ports

If ports 80/443 are already in use, set them in `.env` and restart:

```env
HTTP_PORT=8080
HTTPS_PORT=8443
```

```bash
docker compose -f docker-compose.prod.yml up -d
```

### SSL / HTTPS

**Option 1: Let's Encrypt (recommended for production).** The domain must point to the server's public IP.

1. Start with HTTP only: temporarily comment out the HTTPS `server` block in `nginx/conf.d/mbumah-pos.conf` and replace the `return 301` with a proxy pass:

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

2. Start the stack: `docker compose -f docker-compose.prod.yml up -d`.
3. Uncomment the certbot service in `docker-compose.prod.yml`.
4. Obtain the certificate:

   ```bash
   docker compose -f docker-compose.prod.yml exec certbot certbot certonly \
     --webroot -w /var/www/certbot \
     -d your-server.com \
     --email your-email@example.com \
     --agree-tos --no-eff-email \
     --non-interactive
   ```

5. Update the SSL paths in `nginx/conf.d/mbumah-pos.conf`:

   ```nginx
   ssl_certificate     /etc/nginx/ssl/live/your-server.com/fullchain.pem;
   ssl_certificate_key /etc/nginx/ssl/live/your-server.com/privkey.pem;
   ```

6. Restore the full HTTPS configuration (undo the temporary changes from step 1).
7. Restart Nginx: `docker compose -f docker-compose.prod.yml restart nginx`.

**Option 2: self-signed (testing or internal network):**

```bash
cd nginx/ssl && ./generate-self-signed.sh && cd ../..
docker compose -f docker-compose.prod.yml up -d
```

**Option 3: existing certificates:**

```bash
cp /path/to/fullchain.pem nginx/ssl/server.crt
cp /path/to/private.key   nginx/ssl/server.key
docker compose -f docker-compose.prod.yml restart nginx
```

### M-Pesa integration

**Sandbox (testing):**

1. Register at [Safaricom Developer](https://developer.safaricom.co.ke/).
2. Create a Daraja app and get the consumer key and secret.
3. Set in `.env`:

   ```env
   MPESA_ENVIRONMENT=sandbox
   MPESA_CONSUMER_KEY=your-sandbox-key
   MPESA_CONSUMER_SECRET=your-sandbox-secret
   MPESA_SHORTCODE=174379
   MPESA_PASSKEY=your-sandbox-passkey
   MPESA_CALLBACK_URL=https://your-server.com/api/payments/mpesa/callback
   ```

**Production (live):**

1. Apply for production credentials at Safaricom.
2. Update `.env`:

   ```env
   MPESA_ENVIRONMENT=production
   MPESA_CONSUMER_KEY=your-production-key
   MPESA_CONSUMER_SECRET=your-production-secret
   MPESA_SHORTCODE=your-paybill-number
   MPESA_PASSKEY=your-production-passkey
   ```

3. Ensure SSL is configured; M-Pesa callbacks require HTTPS.
4. Register the callback URL in the Daraja portal.
5. Restart: `docker compose -f docker-compose.prod.yml restart app`.

### Database management

```bash
# Interactive PostgreSQL session
docker compose -f docker-compose.prod.yml exec postgres psql -U mbumah -d mbumah_pos

# Run a single query
docker compose -f docker-compose.prod.yml exec postgres psql -U mbumah -d mbumah_pos -c "SELECT count(*) FROM \"User\";"

# Push schema changes after updating prisma/schema.prisma
docker compose -f docker-compose.prod.yml exec app npx prisma db push

# Re-seed the database
docker compose -f docker-compose.prod.yml exec app npx prisma db seed
```

> Seeding is idempotent for most data, but running it on an existing database may create duplicate entries for some seed data. Consider `prisma migrate reset` for a clean slate (this deletes all data).

### Backups

```bash
# Manual backup
mkdir -p ~/backups
docker compose -f docker-compose.prod.yml exec postgres pg_dump -U mbumah mbumah_pos \
  | gzip > ~/backups/mbumah_pos_$(date +%Y%m%d_%H%M%S).sql.gz
cp .env ~/backups/.env_$(date +%Y%m%d_%H%M%S)
```

Automated daily backup via cron (`crontab -e`):

```bash
# Runs daily at 2 AM
0 2 * * * docker compose -f /path/to/mbumah-hardware-pos/docker-compose.prod.yml exec -T postgres pg_dump -U mbumah mbumah_pos | gzip > /root/backups/mbumah_pos_$(date +\%Y\%m\%d_\%H\%M\%S).sql.gz

# Keep only the last 30 days of backups
0 3 * * * find /root/backups -name "mbumah_pos_*.sql.gz" -mtime +30 -delete
```

Restore from a backup:

```bash
# Stop the app to prevent writes during restore
docker compose -f docker-compose.prod.yml stop app

# Restore the database
gunzip -c ~/backups/mbumah_pos_YYYYMMDD_HHMMSS.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U mbumah -d mbumah_pos

# Restart the app
docker compose -f docker-compose.prod.yml start app
```

Always keep an off-server copy of backups (USB stick or cloud storage); a backup that lives only on the same machine is not a backup.

### Updates and maintenance

```bash
# Update to the latest version
git pull origin main
docker compose -f docker-compose.prod.yml build app
docker compose -f docker-compose.prod.yml exec app npx prisma db push
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs app --tail=50

# Clean up old images (frees disk space)
docker image prune -f

# Remove all unused Docker resources (images, networks, volumes not used by running containers)
docker system prune -f
```

### Monitoring and logs

```bash
# All services
docker compose -f docker-compose.prod.yml logs --tail=100

# Specific services
docker compose -f docker-compose.prod.yml logs app --tail=100
docker compose -f docker-compose.prod.yml logs postgres --tail=100
docker compose -f docker-compose.prod.yml logs nginx --tail=100

# Follow logs in real time
docker compose -f docker-compose.prod.yml logs app -f

# Nginx access logs (from host)
tail -f nginx/logs/access.log
tail -f nginx/logs/error.log

# Health checks
docker compose -f docker-compose.prod.yml ps
curl http://localhost:3000/api/health
docker stats --no-stream
```

### Self-hosting troubleshooting

**App will not start or "Loading..." hangs:**

```bash
docker compose -f docker-compose.prod.yml logs app --tail=200
# Common causes:
# 1. Database not ready: wait and restart
# 2. Missing NEXTAUTH_SECRET: set in .env
# 3. Invalid DATABASE_URL: check postgres is running

# Force rebuild (clears cached layers)
docker compose -f docker-compose.prod.yml build --no-cache app
docker compose -f docker-compose.prod.yml up -d
```

**Database connection refused:**

```bash
docker compose -f docker-compose.prod.yml ps postgres
docker compose -f docker-compose.prod.yml logs postgres --tail=50
docker compose -f docker-compose.prod.yml exec app wget -q -O- http://postgres:5432 2>&1 || echo "Cannot reach postgres"
# If postgres keeps restarting, check disk space
df -h
```

**Nginx 502 Bad Gateway:**

```bash
docker compose -f docker-compose.prod.yml ps app
docker compose -f docker-compose.prod.yml logs app --tail=50
docker compose -f docker-compose.prod.yml restart app
# Check whether the app responds directly (bypassing nginx)
docker compose -f docker-compose.prod.yml exec nginx wget -q -O- http://app:3000/api/health
```

**SSL certificate errors:**

```bash
ls -la nginx/ssl/
openssl x509 -in nginx/ssl/server.crt -text -noout | head -20

# Regenerate the self-signed certificate
cd nginx/ssl && ./generate-self-signed.sh && cd ../..
docker compose -f docker-compose.prod.yml restart nginx

# Let's Encrypt renewal (manual)
docker compose -f docker-compose.prod.yml exec certbot certbot renew
docker compose -f docker-compose.prod.yml restart nginx
```

**Port already in use:**

```bash
sudo lsof -i :80
sudo lsof -i :443
# Change ports in .env (HTTP_PORT / HTTPS_PORT) and restart the stack
```

**Disk space full:**

```bash
df -h
docker image prune -f
docker compose -f docker-compose.prod.yml exec postgres psql -U mbumah -d mbumah_pos -c \
  "SELECT pg_size_pretty(pg_database_size('mbumah_pos'));"
# WARNING: docker system prune -a --volumes deletes all unused volumes, including the database.
```

### Self-hosted architecture

```text
                    +---------------------------------+
                    |         Internet / LAN          |
                    +----------------+----------------+
                                     |
                              Port 80 / 443
                                     |
                    +----------------v----------------+
                    |        Nginx Container          |
                    |  SSL termination                |
                    |  Security headers               |
                    |  Rate limiting                  |
                    |  Reverse proxy -> app:3000      |
                    |  Static asset caching           |
                    +----------------+----------------+
                                     |
                               Internal :3000
                                     |
                    +----------------v----------------+
                    |     Next.js App Container       |
                    |  Standalone server              |
                    |  API routes                     |
                    |  SSR / RSC pages                |
                    |  Prisma client                  |
                    |  M-Pesa integration             |
                    +----------------+----------------+
                                     |
                               Internal :5432
                                     |
                    +----------------v----------------+
                    |    PostgreSQL Container         |
                    |  mbumah_pos database            |
                    |  pg_trgm extension              |
                    |  Persistent volume              |
                    +---------------------------------+
```

All containers communicate over the `mbumah-internal` bridge network. Only Nginx exposes ports (80/443) to the host; PostgreSQL and the app are not reachable from outside the Docker network.

### Self-hosting security checklist

- [ ] Change `POSTGRES_PASSWORD` from the default
- [ ] Generate unique `NEXTAUTH_SECRET` and `JWT_SECRET`
- [ ] Configure SSL/HTTPS (Let's Encrypt or a custom certificate)
- [ ] Set `MPESA_ENVIRONMENT=production` only after testing in sandbox
- [ ] Change the default admin password after first login
- [ ] Set up automated database backups
- [ ] Configure the firewall: allow only ports 22 (SSH), 80, 443
- [ ] Disable password-based SSH (use keys only)
- [ ] Review Nginx rate limiting settings for your traffic patterns
- [ ] Keep Docker and the OS updated (`apt update && apt upgrade`)

## Switching between SQLite and PostgreSQL

The schema provider must match the database in use. Local development defaults to SQLite; production uses PostgreSQL.

To move from SQLite to PostgreSQL:

1. In `prisma/schema.prisma`, change `provider = "sqlite"` to `provider = "postgresql"`.
2. Point `DATABASE_URL` at the PostgreSQL connection string (pooled for runtime, unpooled for migrations).
3. Run `bunx prisma generate`, then apply the schema with `bun run db:push` (or `bunx prisma migrate deploy` if using migrations), then `bunx prisma db seed`.

To switch back to local SQLite development:

1. In `prisma/schema.prisma`, set `provider = "sqlite"`.
2. In `.env`, set `DATABASE_URL="file:./db/custom.db"`.
3. Run `bunx prisma generate && bunx prisma db push`, then `bun run dev`.

> Tip: keep a `.env.local` for the SQLite config and a separate env file for PostgreSQL, or use distinct branches for the two schemas. The `scripts/setup-prisma-provider.mjs` helper detects `postgresql://` in `DATABASE_URL` and aligns the schema provider automatically.

## Vercel CLI quick reference

```bash
vercel                 # Deploy to preview
vercel --prod          # Deploy to production
vercel logs            # View logs
vercel link            # Link the local project to Vercel
vercel env pull .env.production   # Pull environment variables locally
vercel env add DATABASE_URL production
```
