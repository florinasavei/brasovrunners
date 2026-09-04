import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/shared/config/env";
import * as declarationAcceptancesSchema from "./schema/declaration-acceptances";
import * as emailActionTokensSchema from "./schema/email-action-tokens";
import * as emailOutboxSchema from "./schema/email-outbox";
import * as eventsSchema from "./schema/events";
import * as jobRunsSchema from "./schema/job-runs";
import * as legalDocumentsSchema from "./schema/legal-documents";
import * as participantsSchema from "./schema/participants";
import * as rateLimitSchema from "./schema/rate-limit";
import * as registrationsSchema from "./schema/registrations";
import * as staffUsersSchema from "./schema/staff-users";

export const schema = {
  ...eventsSchema,
  ...participantsSchema,
  ...emailActionTokensSchema,
  ...emailOutboxSchema,
  ...staffUsersSchema,
  ...legalDocumentsSchema,
  ...registrationsSchema,
  ...declarationAcceptancesSchema,
  ...jobRunsSchema,
  ...rateLimitSchema,
};
type Schema = typeof schema;

/**
 * The application's PostgreSQL connection.
 *
 * `node-postgres` with a real `Pool`, not `drizzle-orm/neon-http`. The HTTP driver cannot
 * express an interactive transaction, and the capacity work (BR-REQ-034-02) needs
 * `BEGIN … SELECT … FOR UPDATE … COMMIT`. Choosing the wrong driver now would only be
 * discovered when that transaction is written.
 *
 * Point DATABASE_URL at Neon's pooled host (the one containing `-pooler`).
 *
 * Connection is established on first use, never at import. Importing this module must stay
 * free: Next evaluates page modules while collecting build data, and an eager pool made
 * `yarn build` fail on any machine without a database — including CI, which has none.
 */
let cached: NodePgDatabase<Schema> | undefined;

// Next's dev server re-evaluates modules on hot reload. Without this the pool is recreated
// each time and connections leak until the database refuses new ones.
const globalForDb = globalThis as unknown as { brDb?: NodePgDatabase<Schema> };

export function getDb(): NodePgDatabase<Schema> {
  const existing = cached ?? globalForDb.brDb;
  if (existing) return existing;

  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in — see docs/DEVELOPMENT.md.",
    );
  }

  const db = drizzle(new Pool({ connectionString: env.DATABASE_URL, max: 10 }), { schema });
  cached = db;
  if (env.APP_ENV === "local") globalForDb.brDb = db;
  return db;
}
