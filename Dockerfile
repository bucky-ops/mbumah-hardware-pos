# ============================================================================
# MBUMAH HARDWARE POS — Production Dockerfile
# Multi-stage build for minimal image size with standalone Next.js output
# ============================================================================

# ── Stage 1: Base — Install dependencies ──────────────────────────────────────
FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install bun for consistent package management
RUN npm install -g bun@1.2.15

# Copy dependency manifests first for better layer caching
COPY package.json bun.lockb ./

# Install ALL dependencies (including devDependencies for the build stage)
RUN bun install --frozen-lockfile

# ── Stage 2: Builder — Compile the Next.js application ────────────────────────
FROM base AS builder
WORKDIR /app

# Copy application source
COPY . .

# The setup-prisma-provider.mjs script runs in postinstall, but we need to
# ensure it runs again here in case the builder stage has a different context.
# It detects DATABASE_URL scheme and adjusts prisma/schema.prisma accordingly.
# For Docker builds, DATABASE_URL is typically postgresql://, so the provider
# will be set to "postgresql" automatically.
RUN node scripts/setup-prisma-provider.mjs

# Generate Prisma Client for the correct provider
RUN npx prisma generate

# Build the Next.js application.
# SKIP_ENV_VALIDATION=1 prevents Zod env validation from failing during build
# (runtime env vars are injected at container start, not build time).
# output: "standalone" in next.config.ts produces a self-contained output
# in .next/standalone/ that includes only the necessary server code.
ENV SKIP_ENV_VALIDATION=1
RUN bun run build

# ── Stage 3: Runner — Minimal production image ────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Run as non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Set production environment
ENV NODE_ENV=production

# Copy the standalone Next.js server output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./

# Copy static assets that the standalone server references but doesn't include
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Copy public assets (logo, manifest, categories, etc.)
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Copy Prisma schema and migration files (needed for `prisma db push` at startup)
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Copy the Prisma provider setup script (needed at container init)
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts

# Copy package.json for `npx prisma` commands in entrypoint
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# Copy the Docker entrypoint script
COPY --from=builder --chown=nextjs:nodejs /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Copy the Prisma CLI from builder (needed for db push/seed at startup)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

# Switch to non-root user
USER nextjs

# Expose the application port
EXPOSE 3000

# Set the hostname for the standalone server
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

# Health check — verifies the app is responding
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Use the entrypoint script for Prisma migration + seed before starting
ENTRYPOINT ["./docker-entrypoint.sh"]
