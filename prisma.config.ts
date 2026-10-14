// ============================================================================
// MBUMAH HARDWARE POS - Prisma CLI configuration (v2.18.0.2)
// ============================================================================
// The "prisma" block in package.json is deprecated ("The configuration
// property package.json#prisma is deprecated and will be removed in
// Prisma 7"). Prisma 6.16 and newer read this file instead, so the seed
// command now lives here and the package.json block has been removed.
//
// Version policy (docs/prisma-config.md): Prisma stays on the current
// stable 6.x line. It is NEVER upgraded to a prerelease (rc/dev) or across
// a major version by an updater, a script or CI - a major upgrade is its
// own planned feature release. See scripts/verify-prisma-config.mjs.
//
// Env loading: Prisma 6.16+ no longer auto-loads .env files when a config
// file is present. Instead of adding a dotenv dependency this config loads
// <repo>/.env itself, using the same precedence rule as the runtime
// launchers (deploy/nodocker/start-server.mjs, scripts/ensure-schema.mjs):
// a value found in .env WINS over an inherited environment variable, so a
// stray DATABASE_URL from another project can never silently redirect the
// CLI to the wrong database. When no .env exists (Docker, Vercel, CI) the
// inherited environment applies untouched.
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

function resolveConfigDir(): string {
  // The Prisma CLI evaluates this file from the repo root in every supported
  // flow (npm scripts, installers, updaters, Docker entrypoint, CI). Prefer
  // the config file's own location so paths stay correct even when the CLI
  // is invoked from another working directory.
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

const configDir = resolveConfigDir();

function loadRepoEnv(): void {
  const envPath = join(configDir, ".env");
  if (existsSync(envPath)) {
    try {
      const raw = readFileSync(envPath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
        if (!m) continue;
        let value = m[2].trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        // .env wins over the inherited environment (see header).
        process.env[m[1]] = value;
      }
    } catch {
      // An unreadable .env must never break CLI commands; the inherited
      // environment still applies.
    }
  }
  // The schema declares `directUrl = env("DIRECT_URL")` (the unpooled
  // connection used by the production Postgres host). Every real environment
  // sets it (.env.nodocker.example, Docker, CI); when only DATABASE_URL is
  // present, defaulting DIRECT_URL to the same value is the correct semantic
  // for SQLite and for non-pooled Postgres and keeps one-variable setups
  // working. Prisma's config schema (6.x) cannot carry directUrl itself.
  if (!process.env.DIRECT_URL && process.env.DATABASE_URL) {
    process.env.DIRECT_URL = process.env.DATABASE_URL;
  }
}

loadRepoEnv();

export default defineConfig({
  // Absolute paths derived from this file's location: the seed command stays
  // correct no matter which working directory the CLI runs from.
  schema: join(configDir, "prisma", "schema.prisma"),
  migrations: {
    path: join(configDir, "prisma", "migrations"),
    // Same seed command package.json#prisma carried before the migration.
    // bun is present on every path that seeds (installers install it,
    // Docker keeps it in the runner image for exactly this reason).
    // NOTE: no surrounding quotes - the Prisma CLI shell-wraps the command
    // itself, so embedded quotes would become part of the path.
    seed: `bun ${join(configDir, "prisma", "seed.ts")}`,
  },
  // The schema still declares `url = env("DATABASE_URL")` and
  // `directUrl = env("DIRECT_URL")`; the loader above guarantees both.
  // The empty fallback keeps `prisma generate` usable on machines with no
  // DATABASE_URL at all (generate never connects). The 6.x config type only
  // accepts `datasource` together with `engine: "classic"` (the default
  // schema engine) and has no directUrl field - DIRECT_URL is handled via
  // the environment instead.
  engine: "classic",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
