# Vercel Deployment Guide - MBUMAH HARDWARE POS & ERP

## Current Status

The code is ready for Vercel deployment. All local builds pass and the Neon PostgreSQL database is seeded and working.

### What Was Fixed
1. ✅ Prisma schema changed from SQLite to PostgreSQL
2. ✅ Added `directUrl` for Neon database connections
3. ✅ Removed `.env` from git tracking (was overriding Vercel env vars)
4. ✅ Simplified build script (no more `switch-to-pg.sh`)
5. ✅ Added `package-lock.json` for Vercel npm install
6. ✅ Cleaned up GitHub Actions workflows
7. ✅ Local build passes: `npm run vercel-build`

### What Needs Your Attention

The Vercel GitHub Integration deployments are failing. You need to check the build logs in the Vercel dashboard to identify the exact error.

## Steps to Fix the Deployment

### Step 1: Check Vercel Build Logs

1. Go to https://vercel.com/dashboard
2. Click on the "mbumah-hardware-pos-ltcm" project
3. Go to the "Deployments" tab
4. Click on the latest failed deployment
5. Check the build logs for the error message

### Step 2: Verify Environment Variables

In the Vercel project settings, ensure these environment variables are set for **Production**:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgresql://neondb_owner:npg_qZeVcUp6EB0K@ep-winter-waterfall-a25wj37w-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require` |
| `DIRECT_URL` | `postgresql://neondb_owner:npg_qZeVcUp6EB0K@ep-winter-waterfall-a25wj37w.eu-central-1.aws.neon.tech/neondb?sslmode=require` |
| `NEXTAUTH_SECRET` | `Gt5mW8xK2pR7vN4bQ9fL6jY1cZ3aH0dS` |
| `NEXTAUTH_URL` | `https://mbumah-hardware-pos-ltcm.vercel.app` |
| `JWT_SECRET` | `Fn3kP8rU5wX2yB7vM0tA4qC9jE6gH1dL` |
| `NEXT_PUBLIC_APP_URL` | `https://mbumah-hardware-pos-ltcm.vercel.app` |
| `NEXT_PUBLIC_CURRENCY` | `KES` |

### Step 3: Verify Build Settings

In the Vercel project settings, verify:

- **Framework Preset**: Next.js
- **Build Command**: Should be `npx prisma generate && next build` (or leave empty to use vercel.json)
- **Output Directory**: `.next` (default)
- **Install Command**: `npm install` (default)
- **Node.js Version**: 20.x

### Step 4: Redeploy

After verifying the settings, trigger a redeploy:
1. Go to the Deployments tab
2. Click on the "..." menu on the latest deployment
3. Select "Redeploy"

### Step 5: Set Up GitHub Secrets (Optional)

If you want the GitHub Actions workflow to work, set these secrets in the GitHub repository:

1. Go to https://github.com/bucky-ops/mbumah-hardware-pos/settings/secrets/actions
2. Add these secrets:
   - `VERCEL_TOKEN`: Create at https://vercel.com/account/tokens (use "Full Account" scope)
   - `VERCEL_ORG_ID`: Found at https://vercel.com/account (under "Vercel ID")
   - `VERCEL_PROJECT_ID`: Found in Vercel project settings

## Live URLs

- **Working URL**: https://mbumah-hardware-pos-ltcm.vercel.app
- **Broken URL**: https://mbumah-hardware-pos.vercel.app (returns 404)

## Login Credentials

After the deployment is fixed, use these credentials to log in:

| Email | Password | Role |
|-------|----------|------|
| admin@mbumahhardware.co.ke | admin123 | SUPER_ADMIN |
| manager@mbumahhardware.co.ke | manager123 | BRANCH_MANAGER |
| cashier@mbumahhardware.co.ke | cashier123 | CASHIER |
| accountant@mbumahhardware.co.ke | accountant123 | ACCOUNTANT |

## Troubleshooting

### Build Fails with "Prisma Client could not be generated"
- Ensure `DATABASE_URL` and `DIRECT_URL` are set in Vercel environment variables
- The Prisma schema is now PostgreSQL - no switching needed

### Runtime 500 Errors on API Routes
- Check that `DATABASE_URL` points to Neon PostgreSQL (not SQLite)
- Verify the Neon database is accessible (not paused)
- Check Vercel function logs for the exact error

### "Deployment Not Found" Error
- The correct URL is `mbumah-hardware-pos-ltcm.vercel.app`
- The `mbumah-hardware-pos.vercel.app` project may not be properly configured
