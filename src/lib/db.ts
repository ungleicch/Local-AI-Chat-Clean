// src/lib/db.ts

import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Only log queries in development — production logs would be too noisy.
// In dev, we still keep it minimal (just errors + warnings) because the
// query log is extremely verbose and makes the dev server hard to read.
export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db