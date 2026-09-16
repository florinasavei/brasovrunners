import { sql } from "drizzle-orm";
import type { Database } from "@/db/types";

/**
 * Is the database on the schema this build was compiled against?
 *
 * The failure this exists to make visible: a deployment goes out carrying code that selects a
 * column its migration has not added yet, because nothing applies migrations to a deployed
 * environment automatically (AGENTS.md §7.6 forbids migrating from startup or a build, for good
 * reasons) and a person forgot. What that looks like without this check is a 500 on the landing
 * page and a health endpoint reporting `database: ok`, because `select 1` succeeds perfectly
 * well against a stale schema. It cost an afternoon once; `DECISIONS.md` §31.
 *
 * The comparison is against Drizzle's own bookkeeping table, which the migrator writes and
 * nothing else touches. `created_at` there is the `when` of the journal entry that produced the
 * row — the same number `src/db/migrations/meta/_journal.json` carries — so the newest row
 * identifies the applied head exactly, without counting rows or trusting an ordering.
 */

/** Where `drizzle-kit` records what it has applied. Its schema and name are Drizzle's, not ours. */
const MIGRATIONS_TABLE = "drizzle.__drizzle_migrations";

export type SchemaVersionStatus = "ok" | "behind" | "ahead" | "unknown";

export type SchemaVersion = {
  status: SchemaVersionStatus;
  /** The migration this build expects to be the head, e.g. `0011_event_publication…`. */
  expectedTag: string | null;
  /** Journal timestamps, as strings because they are 64-bit and only ever compared. */
  expectedWhen: string | null;
  appliedWhen: string | null;
  appliedCount: number | null;
};

/**
 * What the build was compiled against, inlined by `next.config.ts` from the journal.
 *
 * Read from the environment rather than by importing the journal, for the same reason
 * `shared/config/build-info.ts` does: a serverless runtime has neither the repository nor a
 * filesystem to read it from, and a page module that touched `fs` would break the build.
 */
export const EXPECTED_MIGRATION = {
  tag: process.env.BUILD_MIGRATION_TAG || null,
  when: process.env.BUILD_MIGRATION_WHEN || null,
} as const;

/**
 * The comparison, as a pure function over two values.
 *
 * Separate from the query so the interesting cases — a database that has never been migrated, a
 * database ahead of the code during a rollback — can be tested without arranging a database in
 * each of those states.
 */
export function compareSchemaVersion(input: {
  expectedWhen: string | null;
  appliedWhen: string | null;
}): SchemaVersionStatus {
  // A build that carries no expectation cannot judge the database. That should not happen — the
  // journal is committed — so it is reported rather than guessed at.
  if (!input.expectedWhen) return "unknown";

  // No bookkeeping table, or an empty one: nothing has ever been applied here.
  if (!input.appliedWhen) return "behind";

  const expected = BigInt(input.expectedWhen);
  const applied = BigInt(input.appliedWhen);

  if (applied === expected) return "ok";
  return applied < expected ? "behind" : "ahead";
}

export async function checkSchemaVersion<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<SchemaVersion> {
  const base = {
    expectedTag: EXPECTED_MIGRATION.tag,
    expectedWhen: EXPECTED_MIGRATION.when,
  };

  /**
   * `to_regclass` answers "does this relation exist" without raising, which a bare select
   * against a missing table would do at parse time — and on a database nobody has migrated yet,
   * that is the ordinary case rather than an error.
   *
   * Both results are typed here rather than inferred: the driver-neutral `PgDatabase` cannot
   * know a raw statement's row shape, because each driver declares its own. The shape is
   * `to_regclass`'s and `count`'s, and it is asserted by the tests against a real database
   * rather than by the compiler.
   */
  const present = (await db.execute(
    sql`select ${sql.raw(`to_regclass('${MIGRATIONS_TABLE}')`)} is not null as present`,
  )) as { rows: Array<{ present: boolean }> };
  if (!present.rows[0]?.present) {
    return {
      ...base,
      status: compareSchemaVersion({ ...base, appliedWhen: null }),
      appliedWhen: null,
      appliedCount: null,
    };
  }

  // `created_at` is a bigint; the driver hands back a string, and it stays one. Turning a
  // 64-bit millisecond timestamp into a JavaScript number is lossless today and is the kind of
  // thing that stops being true quietly.
  const applied = (await db.execute(
    sql`select max(created_at)::text as applied_when, count(*)::text as applied_count
        from ${sql.raw(MIGRATIONS_TABLE)}`,
  )) as { rows: Array<{ applied_when: string | null; applied_count: string }> };

  const row = applied.rows[0];
  const appliedWhen = row?.applied_when ?? null;

  return {
    ...base,
    status: compareSchemaVersion({ expectedWhen: base.expectedWhen, appliedWhen }),
    appliedWhen,
    appliedCount: row ? Number(row.applied_count) : null,
  };
}
