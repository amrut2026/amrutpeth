// Prisma 7 config file — required by the CLI (migrate, db push, studio, etc).
// This file must live at the project root, next to package.json.
//
// DATABASE_URL is the Supabase transaction pooler (port 6543, pgbouncer=true) —
// used by Prisma Client at runtime via the driver adapter in prisma.js.
// DIRECT_URL is the Supabase session pooler / direct connection (port 5432) —
// Prisma CLI commands (migrate dev, migrate deploy, db push, studio) always
// need a direct connection, so this config points the CLI at DIRECT_URL.
// Note: Prisma 7 removed automatic seeding after `migrate dev`. The `seed`
// entry below only wires up `npx prisma db seed`; your existing `npm run seed`
// script (node src/seed.js) still works exactly as before, run separately.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node src/seed.js',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
});
