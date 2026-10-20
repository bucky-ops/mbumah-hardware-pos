// E2E session-reaper QA (v2.163.0) — seeds an expired + a fresh session,
// then the route itself is hit via curl (fail-open without CRON_SECRET).
// Usage: node scripts/qa-reaper-v163.cjs <phase: seed|verify> <expectedMinDeleted>
const { PrismaClient } = require('/home/z/ems/node_modules/@prisma/client');
const db = new PrismaClient({
  datasources: { db: { url: 'file:/home/z/ems/prisma/prisma/dev.db' } },
});

async function main() {
  const phase = process.argv[2] || 'seed';
  if (phase === 'seed') {
    const user = await db.user.findFirst({
      where: { email: 'owner@mbumahhardware.co.ke' },
    });
    if (!user) throw new Error('owner user not found');
    const expired = await db.session.create({
      data: {
        userId: user.id,
        token: `qa-reap-expired-${Date.now()}`,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000), // expired 1h ago
        lastActiveAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      },
    });
    const fresh = await db.session.create({
      data: {
        userId: user.id,
        token: `qa-reap-fresh-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // expires in 1h
        lastActiveAt: new Date(),
      },
    });
    console.log(JSON.stringify({ seeded: 2, expiredId: expired.id, freshId: fresh.id }));
  } else if (phase === 'verify') {
    const expiredGone = await db.session.count({
      where: { token: { startsWith: 'qa-reap-expired-' } },
    });
    const freshAlive = await db.session.count({
      where: { token: { startsWith: 'qa-reap-fresh-' } },
    });
    const log = await db.systemLog.findFirst({
      where: { action: 'SESSIONS_REAPED' },
      orderBy: { createdAt: 'desc' },
    });
    console.log(JSON.stringify({
      expiredRemaining: expiredGone,
      freshRemaining: freshAlive,
      lastReaperLog: log ? { message: log.message, deleted: (log.metadata && log.metadata.deleted) } : null,
    }));
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
