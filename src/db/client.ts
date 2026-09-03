import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/shared/config/env";
import * as eventsSchema from "./schema/events";

export const schema = { ...eventsSchema };

/**
 * The application's PostgreSQL connection.
 *
 * `node-postgres` with a real `Pool`, not `drizzle-orm/neon-http`. The HTTP driver cannot
 * express an interactive transaction, and the capacity work (BR-REQ-034-02) needs
 * `BEGIN … SELECT … FOR UPDATE … COMMIT`. Choosing the wrong driver now would be discovered
 * only when that transaction is written.
 *
 * Point DATABASE_URL at Neon's pooled host (the one containing `-pooler`).
 */
function createPool(): Pool {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in — see docs/DEVELOPMENT.md.",
    );
  }
  return new Pool({ connectionString: env.DATABASE_URL, max: 10 });
}

// Next.js dev server re-evaluates modules on every hot reload. Without this the pool is
// recreated each time and connections leak until the database refuses new ones.
const globalForDb = globalThis as unknown as { brPool?: Pool };
const pool = globalForDb.brPool ?? createPool();
if (env.APP_ENV === "local") globalForDb.brPool = pool;

export const db = drizzle(pool, { schema });
