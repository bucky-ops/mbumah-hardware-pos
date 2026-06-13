// Prisma Client for MBUMAH HARDWARE POS
// Uses standard Prisma client with PostgreSQL

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Strip channel_binding=require from DATABASE_URL - Prisma doesn't support it
function sanitizeDbUrl(url: string | undefined): string | undefined {
  if (!url) return url
  return url
    .replace(/&channel_binding=require/g, '')
    .replace(/\?channel_binding=require&/g, '?')
    .replace(/\?channel_binding=require$/g, '')
}

// Get the correct database URL, preferring PostgreSQL over SQLite
function getDatabaseUrl(): string | undefined {
  let url = sanitizeDbUrl(process.env.DATABASE_URL)

  // If the URL is a SQLite file:// URL, check for .env.local PostgreSQL URL
  // This handles the case where system env overrides .env with a SQLite URL
  if (url && url.startsWith('file:')) {
    // Prefer PostgreSQL - check for the Neon URL pattern
    const directUrl = sanitizeDbUrl(process.env.DIRECT_URL)
    if (directUrl && directUrl.startsWith('postgresql://')) {
      console.log('🔧 DATABASE_URL is SQLite, using DIRECT_URL (PostgreSQL) instead')
      return directUrl
    }
    // Log warning but continue with SQLite
    console.warn('⚠️ DATABASE_URL points to SQLite. For production, use PostgreSQL.')
  }

  return url
}

function createPrismaClient() {
  const url = getDatabaseUrl()

  if (!url) {
    console.error('❌ DATABASE_URL environment variable is not set!')
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
