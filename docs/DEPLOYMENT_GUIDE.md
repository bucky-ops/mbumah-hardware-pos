# MBUMAH HARDWARE POS — Vercel + Supabase Deployment Guide

Complete step-by-step guide for deploying MBUMAH HARDWARE POS to Vercel with a Supabase PostgreSQL database.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Create a Supabase Project](#step-1-create-a-supabase-project)
4. [Step 2: Get the PostgreSQL Connection String](#step-2-get-the-postgresql-connection-string)
5. [Step 3: Switch Prisma to PostgreSQL](#step-3-switch-prisma-to-postgresql)
6. [Step 4: Run Prisma Migrations on the Production Database](#step-4-run-prisma-migrations-on-the-production-database)
7. [Step 5: Seed the Production Database](#step-5-seed-the-production-database)
8. [Step 6: Push Code to GitHub](#step-6-push-code-to-github)
9. [Step 7: Deploy to Vercel](#step-7-deploy-to-vercel)
10. [Step 8: Configure Vercel Environment Variables](#step-8-configure-vercel-environment-variables)
11. [Step 9: Verify the Deployment](#step-9-verify-the-deployment)
12. [Post-Deployment: M-Pesa Webhooks](#post-deployment-mpesa-webhooks)
13. [Troubleshooting](#troubleshooting)
14. [Local Development Switchback](#local-development-switchback)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   Production Architecture                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           Vercel (Serverless Functions)               │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │  Next.js App (API Routes + Frontend)           │  │   │
│  │  │  - Serverless functions for each API route      │  │   │
│  │  │  - Static/ISR for frontend pages                │  │   │
│  │  │  - Edge network for global CDN                  │  │   │
│  │  └────────────────────┬───────────────────────────┘  │   │
│  └───────────────────────┼──────────────────────────────┘   │
│                          │ Prisma ORM                         │
│  ┌───────────────────────┴──────────────────────────────┐   │
│  │           Supabase (PostgreSQL 15)                    │   │
│  │  - Managed database with auto-backups                 │   │
│  │  - Connection pooling via PgBouncer                   │   │
│  │  - Row Level Security (optional)                      │   │
│  │  - Real-time subscriptions (optional)                 │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           External Services                           │   │
│  │  - M-Pesa Daraja API (Safaricom)                     │   │
│  │  - Resend (Email notifications)                      │   │
│  │  - Twilio (SMS notifications)                        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

- **GitHub account** — for code repository and Vercel integration
- **Vercel account** — [vercel.com](https://vercel.com) (free tier works)
- **Supabase account** — [supabase.com](https://supabase.com) (free tier works)
- **Bun** runtime installed locally (for running migrations)
- **Git** installed locally

---

## Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in
2. Click **"New Project"**
3. Fill in:
   - **Name**: `mbumah-pos`
   - **Database Password**: Choose a strong password — **save this!**
   - **Region**: Choose the closest region to your users (e.g., `Africa (Cape Town)` or `Europe (Frankfurt)`)
   - **Plan**: Free tier is sufficient for development
4. Click **"Create new project"** and wait ~2 minutes for provisioning

---

## Step 2: Get the PostgreSQL Connection String

1. In your Supabase project dashboard, go to **Settings → Database**
2. Scroll down to **"Connection string"** section
3. Select **"URI"** tab
4. Copy the connection string. It looks like:
   ```
   postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres
   ```
5. **Important**: For Prisma migrations, you need the **direct connection** (not pooled):
   - Select **"Session mode"** or look for the **direct** connection string
   - Direct: `postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`
   - Pooled (for app runtime): `postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres`

> **Tip**: Use the **pooled** connection for `DATABASE_URL` in Vercel (better for serverless), and the **direct** connection for running Prisma migrations locally.

---

## Step 3: Switch Prisma to PostgreSQL

1. Open `prisma/schema.prisma`
2. Change the datasource provider:

   ```prisma
   datasource db {
     provider = "postgresql"  // Changed from "sqlite"
     url      = env("DATABASE_URL")
   }
   ```

3. Update your local `.env` temporarily for migration:

   ```bash
   # Temporarily point to Supabase for migration
   DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"
   ```

---

## Step 4: Run Prisma Migrations on the Production Database

Run these commands locally with the Supabase DATABASE_URL set in your `.env`:

```bash
# Generate Prisma client for PostgreSQL
bunx prisma generate

# Create the initial migration (this creates all tables in Supabase)
bunx prisma migrate dev --name init_postgresql

# If you already have migrations and just want to apply them:
bunx prisma migrate deploy
```

**Verify**: Go to Supabase Dashboard → Table Editor. You should see all your tables (organizations, stores, users, products, etc.).

---

## Step 5: Seed the Production Database

```bash
# Seed with initial data (organization, store, admin user, etc.)
bunx prisma db seed
```

If you have a custom seed script:

```bash
bunx tsx prisma/seed.ts
```

**Verify**: Check Supabase Table Editor for seeded data (default organization, store, admin user).

---

## Step 6: Push Code to GitHub

1. **Revert the provider back to `sqlite`** in your local schema for development (optional — or keep `postgresql` if you want to develop against Supabase):

   > The `schema.prisma` provider should match the database you're using. If you keep it as `postgresql`, your local dev also needs a PostgreSQL connection. For local SQLite development, switch it back.

2. Commit all changes:

   ```bash
   git add .
   git commit -m "feat: add Vercel + Supabase deployment configuration"
   git push origin main
   ```

---

## Step 7: Deploy to Vercel

### Option A: Vercel CLI

```bash
# Install Vercel CLI
bunx npm i -g vercel

# Login
vercel login

# Deploy (follow the prompts)
vercel --prod
```

### Option B: Vercel Dashboard (Recommended)

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **"Add New" → "Project"**
3. Import your GitHub repository
4. Configure:
   - **Framework Preset**: Next.js (auto-detected)
   - **Build Command**: `bun run build`
   - **Install Command**: `bun install`
   - **Output Directory**: `.next` (default)
5. **Do NOT deploy yet** — click **"Environment Variables"** first

---

## Step 8: Configure Vercel Environment Variables

Add these environment variables in the Vercel project settings (**Settings → Environment Variables**):

| Variable | Value | Environment |
|----------|-------|-------------|
| `DATABASE_URL` | `postgresql://postgres.[REF]:[PASS]@aws-0-[REGION].pooler.supabase.com:6543/postgres` | Production |
| `NEXTAUTH_SECRET` | A secure random string (`openssl rand -base64 32`) | Production |
| `NEXTAUTH_URL` | `https://your-app.vercel.app` | Production |
| `JWT_SECRET` | A secure random string (`openssl rand -base64 32`) | Production |
| `NEXT_PUBLIC_APP_URL` | `https://your-app.vercel.app` | Production |
| `NEXT_PUBLIC_CURRENCY` | `KES` | Production |
| `MPESA_CONSUMER_KEY` | Your M-Pesa consumer key | Production |
| `MPESA_CONSUMER_SECRET` | Your M-Pesa consumer secret | Production |
| `MPESA_PASSKEY` | Your M-Pesa passkey | Production |
| `MPESA_SHORTCODE` | `174379` (or your paybill) | Production |
| `MPESA_ENVIRONMENT` | `production` | Production |
| `MPESA_CALLBACK_URL` | `https://your-app.vercel.app/api/mpesa/callback` | Production |

> **Important**: Use the **pooled** connection string (port 6543 via PgBouncer) for `DATABASE_URL` in Vercel. This is critical for serverless functions to avoid connection pool exhaustion.

### Optional Variables

| Variable | Value |
|----------|-------|
| `RESEND_API_KEY` | Resend API key for emails |
| `TWILIO_ACCOUNT_SID` | Twilio SID for SMS |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number |
| `REDIS_URL` | Redis connection URL (for caching) |

---

## Step 9: Verify the Deployment

1. Visit your deployment URL: `https://your-app.vercel.app`
2. Check the health endpoint: `https://your-app.vercel.app/api`
3. Try logging in with the seeded admin credentials
4. Test the POS functionality

### Check Vercel Function Logs

```bash
# View real-time logs
vercel logs --follow
```

Or go to Vercel Dashboard → your project → **Deployments** → click deployment → **Function Logs**

---

## Post-Deployment: M-Pesa Webhooks

For M-Pesa STK Push callbacks to work in production:

1. Ensure `MPESA_CALLBACK_URL` points to your public Vercel URL
2. The callback endpoint is: `https://your-app.vercel.app/api/mpesa/callback`
3. Register this URL with Safaricom Daraja API
4. For sandbox testing, use ngrok or similar tunneling

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|---------|
| `P1001: Can't reach database server` | Check DATABASE_URL format. Use direct connection for migrations, pooled for runtime. |
| `Prisma Client could not be generated` | Ensure `postinstall` script runs `prisma generate`. Check Vercel build logs. |
| `Connection pool exhausted` | Use the Supabase PgBouncer pooled connection (port 6543), not direct (port 5432). |
| `CORS errors` | Ensure `NEXTAUTH_URL` matches your Vercel deployment URL exactly. |
| `Migration failed` | Run migrations locally with direct connection string, then deploy. |
| `Seed fails with unique constraint` | Database already has data; check Supabase Table Editor. |
| `Build fails: Prisma Client not found` | Verify `postinstall: "prisma generate"` is in package.json. |
| `Schema mismatch after deploy` | Re-run `prisma generate` and `prisma migrate deploy` locally. |

### Redeploying After Schema Changes

1. Update `prisma/schema.prisma` locally
2. Run `bunx prisma migrate dev --name your_change_description`
3. Push code to GitHub — Vercel auto-deploys
4. The `postinstall` script regenerates Prisma Client on each deploy

### Emergency: Reset Production Database

```bash
# ⚠️ DESTRUCTIVE — this deletes all data!
DATABASE_URL="postgresql://..." bunx prisma migrate reset

# Then re-seed:
DATABASE_URL="postgresql://..." bunx prisma db seed
```

---

## Local Development Switchback

To switch back to local SQLite development:

1. In `prisma/schema.prisma`, change:
   ```prisma
   datasource db {
     provider = "sqlite"  // Switch back for local dev
     url      = env("DATABASE_URL")
   }
   ```

2. In `.env`, set:
   ```
   DATABASE_URL="file:./db/custom.db"
   ```

3. Run:
   ```bash
   bunx prisma generate
   bunx prisma db push
   bun run dev
   ```

> **Tip**: Consider using a `.env.local` for your SQLite config and `.env.production` for PostgreSQL, or use separate Git branches for dev vs. production schema.

---

## Quick Reference: Vercel CLI Commands

```bash
# Deploy to preview
vercel

# Deploy to production
vercel --prod

# View logs
vercel logs

# Link local project to Vercel
vercel link

# Pull environment variables locally
vercel env pull .env.production

# Add environment variable
vercel env add DATABASE_URL production
```

---

*MBUMAH HARDWARE POS — Vercel + Supabase Deployment Guide*
*Last updated: 2024*
