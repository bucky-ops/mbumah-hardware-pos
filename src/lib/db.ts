import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Strip channel_binding=require from DATABASE_URL - Prisma doesn't support it
// This parameter is sometimes added by Neon's connection string generator
function sanitizeDbUrl(url: string | undefined): string | undefined {
  if (!url) return url
  return url
    .replace(/&channel_binding=require/g, '')
    .replace(/\?channel_binding=require&/g, '?')
    .replace(/\?channel_binding=require$/g, '')
}

function createPrismaClient() {
  const url = sanitizeDbUrl(process.env.DATABASE_URL)

  if (!url) {
    console.error('❌ DATABASE_URL environment variable is not set!')
    if (process.env.NODE_ENV === 'production') {
      throw new Error('DATABASE_URL environment variable is required in production')
    }
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
    datasources: {
      db: {
        url,
      },
    },
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// Graceful shutdown for serverless
if (process.env.NODE_ENV === 'production') {
  process.on('beforeExit', async () => {
    await db.$disconnect()
  })
}
