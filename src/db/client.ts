import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/shared/config/env";
import * as auditLogsSchema from "./schema/audit-logs";
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
  ...auditLogsSchema,
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

/**
 * How many connections one *instance* holds. Ten, and it is not a per-deployment number.
 *
 * Vercel's pool is per function instance and every warm instance holds its own, so the
 * deployment's total is ten times however many instances are warm — a number nobody controls.
 * That sounds alarming and is not the binding constraint, which is why this stays as it is:
 * DATABASE_URL points at Neon's *pooled* host, PgBouncer accepts up to 10,000 client
 * connections, and behind it the real serialization point is 93 concurrent transactions at
 * 0.25 CU. Reaching that through this pool needs several hundred warm instances at once,
 * which this club's traffic will not produce. The arithmetic is written out in
 * `docs/PLATFORM.md` § "Connections are not the ceiling" so it is not re-derived.
 *
 * Vercel's own guidance is also explicit that `max: 1` is the wrong correction — it does not
 * reduce total connections and destroys concurrency within an instance.
 */
const MAX_CONNECTIONS_PER_INSTANCE = 10;

/**
 * The guard that matters: no statement may run longer than this.
 *
 * The risk on a serverless host is not the count of connections, it is one query holding one
 * of them. A function may run for 300 seconds, and without this a single unbounded statement —
 * a missing index met by a full table, a lock nobody releases — occupies a connection for all
 * 300 and is billed for all 300, while every other request queues behind it. Ten seconds is
 * more than an order of magnitude above anything this application does: the slowest real
 * statements are the CSV export and the outbox claim, both bounded and indexed.
 *
 * PostgreSQL enforces it server-side and cancels the query, so it holds even if the Node
 * process is frozen or the request was already abandoned. `query_timeout` (client-side) would
 * not: it stops waiting, and the server keeps running the query.
 *
 * It does not apply to opening the connection. Neon Free scales to zero and the first request
 * after an idle period waits for a cold start, which is connection time — deliberately left
 * unbounded, because failing a visitor's first page load to enforce a timeout would be the
 * guard causing the outage.
 */
const STATEMENT_TIMEOUT_MS = 10_000;

/**
 * The sibling guard, for the case `statement_timeout` cannot see.
 *
 * A serverless instance can be frozen or killed between two statements of an open
 * transaction. No statement is running, so no statement times out, and the connection sits
 * `idle in transaction` holding every lock it has taken — which on this schema means a
 * capacity row that no other registration can then claim (§10.6). PostgreSQL rolls that
 * transaction back after this long. Thirty seconds is far above the sub-second transactions
 * this application actually writes, and far below the time a stuck lock would matter.
 */
const IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;
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

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: MAX_CONNECTIONS_PER_INSTANCE,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
  });

  const db = drizzle(pool, { schema });
  cached = db;
  if (env.APP_ENV === "local") globalForDb.brDb = db;
  return db;
}
