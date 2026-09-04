import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { jobRuns } from "@/db/schema/job-runs";
import { legalDocumentTranslations, legalDocuments } from "@/db/schema/legal-documents";
import { participants } from "@/db/schema/participants";
import { rateLimitBuckets } from "@/db/schema/rate-limit";
import { registrations } from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";

const schema = {
  events,
  eventTranslations,
  participants,
  emailActionTokens,
  emailOutbox,
  staffUsers,
  legalDocuments,
  legalDocumentTranslations,
  registrations,
  declarationAcceptances,
  jobRuns,
  rateLimitBuckets,
};
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

/** Truncate every table so one test cannot see another's rows. Children before parents. */
export async function resetTables(db: TestDatabase): Promise<void> {
  await db.delete(declarationAcceptances);
  await db.delete(emailActionTokens);
  await db.delete(emailOutbox);
  await db.delete(eventTranslations);
  // `registrations` references `events`, and `events.declaration_document_id` references
  // `legal_documents`, so registrations must go before events, and events before legal
  // documents — the reverse of the order either child appears in the schema files.
  await db.delete(registrations);
  await db.delete(events);
  await db.delete(legalDocumentTranslations);
  await db.delete(legalDocuments);
  await db.delete(participants);
  await db.delete(jobRuns);
  await db.delete(rateLimitBuckets);
  // Last: events, translations and legal documents reference staff users, and although the
  // foreign keys are ON DELETE SET NULL, deleting the parents first keeps the order honest
  // about what owns what.
  await db.delete(staffUsers);
}
