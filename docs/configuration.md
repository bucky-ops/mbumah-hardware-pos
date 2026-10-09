# Configuration

All configuration is managed through environment variables. Copy `.env.example` to `.env` and fill in the values for your environment:

```bash
cp .env.example .env
```

## Core variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | `file:./db/custom.db` | Prisma connection string (SQLite or PostgreSQL) |
| `NEXTAUTH_SECRET` | Yes | None | NextAuth.js secret (generate with `openssl rand -base64 32`) |
| `NEXTAUTH_URL` | Yes | `http://localhost:3000` | Full URL of your deployed app |
| `JWT_SECRET` | Yes | None | Legacy JWT secret |
| `NEXT_PUBLIC_APP_URL` | Yes | `http://localhost:3000` | Public app URL |
| `NEXT_PUBLIC_CURRENCY` | No | `KES` | Currency code for display |

For serverless PostgreSQL providers, also set `DIRECT_DATABASE_URL` (or `DIRECT_URL`) to the unpooled connection string used by migrations. See [Deployment](deployment.md).

## M-Pesa Daraja API

| Variable | Required | Description |
|----------|----------|-------------|
| `MPESA_CONSUMER_KEY` | Yes | Daraja app consumer key |
| `MPESA_CONSUMER_SECRET` | Yes | Daraja app consumer secret |
| `MPESA_PASSKEY` | Yes | Lipa Na M-Pesa passkey |
| `MPESA_SHORTCODE` | No | Business shortcode (default: `174379`) |
| `MPESA_ENVIRONMENT` | No | `sandbox` or `production` |
| `MPESA_CALLBACK_URL` | Yes | Public callback URL for STK Push |

Sandbox and production credentials are isolated by `MPESA_ENVIRONMENT`; production credentials are rejected against the sandbox endpoint and vice versa. For local development and callback testing, see [Troubleshooting and FAQ](troubleshooting-and-faq.md).

## Optional services

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend email API key |
| `TWILIO_ACCOUNT_SID` | Twilio SMS account SID |
| `TWILIO_AUTH_TOKEN` | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Twilio phone number |
| `REDIS_URL` | Redis URL for production caching |

## Self-hosting extras

These variables apply to the Docker Compose deployment described in [Deployment](deployment.md):

| Variable | Required | Description |
|----------|----------|-------------|
| `POSTGRES_USER` | Yes | PostgreSQL username |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password; always change from the default |
| `POSTGRES_DB` | No | Database name (default: `mbumah_pos`) |
| `SEED_DATABASE` | No | Set to `true` on first run to seed the database |
| `HTTP_PORT` / `HTTPS_PORT` | No | Nginx listen ports when 80/443 are already in use (for example `8080` / `8443`) |

## Validation behavior

`src/lib/env.ts` runs Zod validation at boot (runtime, not build time). A misconfigured secret (for example `NEXTAUTH_SECRET` too short or a malformed `DATABASE_URL`) throws a descriptive `EnvValidationError` listing every gap. The `SKIP_ENV_VALIDATION=1` flag is used only inside the `vercel-build` script so `next build` can collect page data without runtime secrets; it is never set at runtime.
