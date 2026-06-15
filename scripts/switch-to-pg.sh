#!/usr/bin/env bash
# Build script for Vercel deployment
# Schema is already PostgreSQL - this script is kept for backward compatibility
# and ensures the Prisma client is properly generated.

echo "Schema is already PostgreSQL - running prisma generate..."
npx prisma generate

echo "Build preparation complete."
