import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 requires Prisma Client to be constructed with a driver adapter.
// This uses DATABASE_URL — the Supabase transaction pooler (pgbouncer, port
// 6543) — for runtime queries. Migrations/CLI commands use DIRECT_URL instead,
// configured separately in prisma.config.ts.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
