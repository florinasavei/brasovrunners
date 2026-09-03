import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT, PgTransaction } from "drizzle-orm/pg-core";

/**
 * Any Drizzle database over the given tables: the application's `node-postgres` pool in
 * production, PGlite in tests. Queries are written once and both drivers run them.
 *
 * The driver-neutral `PgDatabase` is used rather than a union of the two concrete types
 * because a union cannot be called through — `db.transaction(...)` on a union of two generic
 * classes does not resolve. Both drivers' databases, and a transaction handle, satisfy this.
 */
export type Database<TSchema extends Record<string, unknown>> = PgDatabase<
  PgQueryResultHKT,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>;

/**
 * An open transaction.
 *
 * A `Database` is not assignable to this, and that asymmetry is the point: a function that
 * MUST run inside a transaction — `enqueueEmail`, per BR-REQ-080-02 criterion 1 — takes this
 * type, and passing the pool instead is a compile error rather than a race discovered in
 * production.
 */
export type Transaction<TSchema extends Record<string, unknown>> = PgTransaction<
  PgQueryResultHKT,
  TSchema,
  ExtractTablesWithRelations<TSchema>
>;
