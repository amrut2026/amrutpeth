import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7 requires Prisma Client to be constructed with a driver adapter.
// This uses DATABASE_URL — the Supabase transaction pooler (pgbouncer, port
// 6543) — for runtime queries. Migrations/CLI commands use DIRECT_URL instead,
// configured separately in prisma.config.ts.
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

// Prisma's interactive-transaction defaults (maxWait: 2000ms, timeout:
// 5000ms) assume a low-latency connection. Locally that held even for the
// heavier multi-step transactions (e.g. purchases.js PATCH /:id/prices,
// which cascades through several sequential queries inside one
// $transaction) because the DB was on the same machine. Now that runtime
// queries go through Supabase's pooler over a real network hop, the same
// transaction takes meaningfully longer round-trip-for-round-trip and can
// exceed the 5s default under normal load, not just when something's
// actually wrong — hence raising both here rather than per call site.
export const prisma = new PrismaClient({
  adapter,
  transactionOptions: {
    maxWait: 10000, // was: default 2000ms
    timeout: 30000, // was: default 5000ms
  },
});