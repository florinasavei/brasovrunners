import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eventTranslations, events } from "@/db/schema/events";

const schema = { events, eventTranslations };
export type TestDatabase = PgliteDatabase<typeof schema>;

/**
 * A disposable PostgreSQL for integration tests.
 *
 * PGlite is real PostgreSQL compiled to WebAssembly, running in this process. That matters:
 * AGENTS.md §20.3 requires integration tests against real PostgreSQL, and an emulation such
 * as `pg-mem` silently accepts SQL that real PostgreSQL rejects — `SELECT ... FOR UPDATE`
 * becomes a no-op there, which would make a capacity test pass while the production
 * behaviour is broken. Here, constraints, enums, transactions and MVCC are the genuine
 * article, and the same migrations that run against Neon run here.
 *
 * THE LIMIT, AND IT IS A HARD ONE. PGlite is single-connection, so it cannot express two
 * transactions racing each other. Every concurrency requirement — BR-REQ-034-02 (twenty
 * simultaneous confirmations against one free place), BR-REQ-034-03, parallel waiting-list
 * promotion — MUST run against a real PostgreSQL server, not this. Writing those against
 * PGlite would produce a green suite and an overbooked event.
 *
 * When that work starts, add Docker or Testcontainers alongside this helper rather than
 * replacing it: these tests are fast and need no daemon, which is worth keeping.
 */
export async function createTestDatabase(): Promise<{
  db: TestDatabase;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  const db = drizzle(client, { schema });

  await migrate(db, { migrationsFolder: "./src/db/migrations" });

  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}

/** Truncate every table so one test cannot see another's rows. */
export async function resetTables(db: TestDatabase): Promise<void> {
  await db.delete(eventTranslations);
  await db.delete(events);
}
