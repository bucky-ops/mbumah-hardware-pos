import { PrismaClient } from '@prisma/client';

// AUDIT FIX (Finding 1.2 — hardcoded developer path removed):
// The datasource URL now resolves from the environment (DATABASE_URL), with a
// portable repo-relative fallback for local SQLite use. The previous
// `file:/home/z/my-project/db/custom.db` override only worked on one machine,
// leaked the developer's home directory into source control, and failed in
// CI/Docker. Prisma resolves a relative `file:` URL against the schema
// directory, so `file:./db/custom.db` matches the repo's db/ layout.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || 'file:./db/custom.db' } },
});

async function main() {
  const r = await prisma.user.updateMany({ data: { lockedUntil: null, failedLoginAttempts: 0 } });
  console.log(`Reset ${r.count} users`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
