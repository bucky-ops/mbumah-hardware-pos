# Prisma configuration

Where the Prisma CLI configuration lives since v2.18.0.2, how it loads environment variables, which commands need which variables, and the version policy the project enforces.

## prisma.config.ts replaces package.json#prisma

Prisma deprecated the `"prisma"` block in `package.json` ("The configuration property package.json#prisma is deprecated and will be removed in Prisma 7"). Since v2.18.0.2 the block is removed from `package.json` and the seed command lives in [prisma.config.ts](../prisma.config.ts):

```ts
migrations: {
  seed: `bun ${join(configDir, "prisma", "seed.ts")}`,
}
```

Prisma 6.16 and newer read this file automatically, so every entry point (`npm run db:seed`, the installers and updaters, the Docker entrypoint's `npx prisma db seed`, CI) uses the same configuration. The config derives the schema and seed paths from its own file location, so the CLI behaves the same no matter which working directory it is invoked from.

## Environment loading

Prisma 6.16+ no longer auto-loads `.env` files when a config file is present. Instead of adding a dotenv dependency, `prisma.config.ts` loads the repo `.env` itself, with the same precedence rule the runtime launchers use ([start-server.mjs](../deploy/nodocker/start-server.mjs), `scripts/ensure-schema.mjs`):

- A value found in `.env` WINS over an inherited environment variable. A stray `DATABASE_URL` left in the shell or system environment (from another project, a manual `set`, a CI harness) can therefore never silently redirect the CLI to the wrong database.
- When no `.env` exists (Docker, Vercel, CI), the inherited environment applies untouched.
- An unreadable `.env` never breaks a CLI command; the inherited environment still applies.
- When `DIRECT_URL` is unset but `DATABASE_URL` is present, `DIRECT_URL` defaults to the same value. The schema declares `directUrl = env("DIRECT_URL")`; defaulting it is the correct semantic for SQLite and for non-pooled Postgres and keeps one-variable setups working. Real environments set `DIRECT_URL` explicitly (`.env.nodocker.example`, Docker, CI).

## Commands and their requirements

| Command | Works since the migration | Needs `DATABASE_URL` |
|---------|---------------------------|----------------------|
| `npx prisma validate` | yes | yes (the URL must parse for the schema's provider; it does not connect) |
| `npx prisma generate` | yes | no (works with no environment at all) |
| `npx prisma db push` | yes | yes (unchanged requirement) |
| `npx prisma db seed` | yes | yes (the seed writes data) |

The npm scripts (`npm run db:push`, `db:generate`, `db:seed`, `prisma:validate`) go through the same CLI and configuration.

## Version policy

Prisma stays on the stable 6.x line. The current pin in `package.json` is `^6.19.2` for both `prisma` (devDependencies) and `@prisma/client` (dependencies).

- NEVER upgrade to a prerelease (`8.0.0-rc.22`, `-beta`, `-dev` or similar), not by an updater, not by a script, not by CI.
- NEVER cross a major version automatically. A major upgrade is its own planned feature release with its own migration and testing work.
- npm notices such as "Update available 6.19.2 -> 8.0.0-rc.22" are informational only. The project does not act on them.

The reason is operational: the POS installs update themselves on shop machines, and a prerelease Prisma arriving through a dependency bump would change the migration engine underneath running stores. Stable 6.x is the tested surface.

## Enforcement

[scripts/verify-prisma-config.mjs](../scripts/verify-prisma-config.mjs) (`npm run verify:prisma-config`) guards the whole arrangement:

1. `prisma.config.ts` exists, uses `defineConfig` from `prisma/config`, and points at the schema.
2. `package.json` no longer contains the deprecated `"prisma"` block.
3. `prisma` and `@prisma/client` are pinned to the stable 6.x line: no prerelease tags, no major drift.
4. `prisma validate` passes for the schema flavor currently checked out (SQLite or PostgreSQL), and the CLI output contains no deprecation warning about `package.json#prisma`.

The `prisma validate` half of this check also runs in the CI "Security & Schema" job on every PR, so a schema or configuration regression turns CI red before merge. Exit 1 from the script means: fix before ship.

## Docker

The Docker entrypoint runs `npx prisma db push` and `npx prisma db seed` at container start. Because the seed command now lives in `prisma.config.ts`, the runner image copies it in explicitly:

```dockerfile
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
```

Bun stays in the runner image for the same reason: the seed command itself is `bun prisma/seed.ts`.

## Related

- [Windows local builds](windows-local-builds.md): the build policy that shares the `.env` precedence rule
- [Updater release channels](updater-release-channels.md): where the updaters run the schema push during updates
- [Deployment](deployment.md): provider switching and database setup
