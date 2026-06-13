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
    // Create client anyway - it will fail on actual queries with a clear error
    // but won't crash the entire server on module load
  }

  console.log(`🔧 Creating PrismaClient with URL: ${url ? url.substring(0, 30) + '...' : 'NOT SET'}`)

  try {
    return new PrismaClient({
      log: ['error'],
      datasources: {
        db: {
          url,
        },
      },
    })
  } catch (error) {
    console.error('❌ Failed to create PrismaClient:', error)
    throw error
  }
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
