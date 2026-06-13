import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL

  if (!url) {
    console.error('❌ DATABASE_URL environment variable is not set!')
    // In production, this is a critical error
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
  // In serverless, we want to handle connection cleanup
  process.on('beforeExit', async () => {
    await db.$disconnect()
  })
}
