import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/custom.db' } } });
async function main() {
  const r = await prisma.user.updateMany({ data: { lockedUntil: null, failedLoginAttempts: 0 } });
  console.log(`Reset ${r.count} users`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
