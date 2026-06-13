// Prisma Client for MBUMAH HARDWARE POS
// Uses Neon serverless driver on Vercel (no native binary needed)
// Falls back to standard Prisma client for local development

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

function createPrismaClient() {
  const url = sanitizeDbUrl(process.env.DATABASE_URL)
  const directUrl = sanitizeDbUrl(process.env.DIRECT_URL)

  if (!url) {
    console.error('❌ DATABASE_URL environment variable is not set!')
  }

  console.log(`🔧 Creating PrismaClient with URL: ${url ? url.substring(0, 30) + '...' : 'NOT SET'}`)

  // Check if we should use the Neon serverless driver (for Vercel)
  const isVercel = !!process.env.VERCEL
  
  if (isVercel) {
    console.log('🚀 Vercel detected - using Neon serverless adapter')
    try {
      // Dynamic import to avoid bundling issues on non-Vercel environments
      const { Pool } = require('@neondatabase/serverless')
      const { PrismaNeon } = require('@prisma/adapter-neon')
      
      const pool = new Pool({ connectionString: directUrl || url })
      const adapter = new PrismaNeon(pool)
      
      return new PrismaClient({
        adapter,
        log: ['error'],
      })
    } catch (err) {
      console.error('⚠️  Failed to create Neon adapter, falling back to standard client:', err)
    }
  }

  // Standard Prisma client (local dev or fallback)
  try {
    return new PrismaClient({
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
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
