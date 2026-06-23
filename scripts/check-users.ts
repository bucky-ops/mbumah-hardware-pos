import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/custom.db' } } });
async function main() {
  const u = await prisma.user.findMany({ select: { email: true, lockedUntil: true, failedLoginAttempts: true, isActive: true } });
  console.log(JSON.stringify(u, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
