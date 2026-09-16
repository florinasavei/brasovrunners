import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../helpers/db";

/**
 * The schema-drift check against a real database (`DECISIONS.md` §31).
 *
 * The unit test covers the comparison; this covers the half that can only be wrong against
 * PostgreSQL — reading Drizzle's own bookkeeping table, and surviving a database that has none.
 *
 * `EXPECTED_MIGRATION` is read from the environment at module load, exactly as
 * `shared/config/build-info.ts` reads its values, so each case re-imports the module with the
 * expectation it wants.
 */
async function checkWith(expectedWhen: string | undefined, db: unknown) {
  if (expectedWhen === undefined) delete process.env.BUILD_MIGRATION_WHEN;
  else process.env.BUILD_MIGRATION_WHEN = expectedWhen;
  process.env.BUILD_MIGRATION_TAG = "0011_event_publication_and_test_registrations";

  vi.resetModules();
  const { checkSchemaVersion } = await import("@/db/schema-version");
  return checkSchemaVersion(db as Parameters<typeof checkSchemaVersion>[0]);
}

/** The head this repository is actually on, read from the journal the migrator writes from. */
async function journalHead(): Promise<{ tag: string; when: string }> {
  const journal = (await import("@/db/migrations/meta/_journal.json")).default as {
    entries: Array<{ tag: string; when: number }>;
  };
  const head = journal.entries.at(-1);
  return { tag: head!.tag, when: String(head!.when) };
}

describe("the schema-drift check", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  const originalWhen = process.env.BUILD_MIGRATION_WHEN;
  const originalTag = process.env.BUILD_MIGRATION_TAG;

  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
  });
  afterAll(async () => close());

  afterEach(() => {
    if (originalWhen === undefined) delete process.env.BUILD_MIGRATION_WHEN;
    else process.env.BUILD_MIGRATION_WHEN = originalWhen;
    if (originalTag === undefined) delete process.env.BUILD_MIGRATION_TAG;
    else process.env.BUILD_MIGRATION_TAG = originalTag;
    vi.resetModules();
  });

  it("reports ok when the database is on the head this build expects", async () => {
    const head = await journalHead();
    const result = await checkWith(head.when, db);

    expect(result.status).toBe("ok");
    expect(result.appliedWhen).toBe(head.when);
    // Every committed migration, applied: the test database is built by the same migrator.
    expect(result.appliedCount).toBeGreaterThan(0);
  });

  it("reports behind when the build expects a migration the database has not applied", async () => {
    // The exact failure that broke QA: code deployed ahead of its migration.
    const head = await journalHead();
    const result = await checkWith(String(BigInt(head.when) + BigInt(1)), db);

    expect(result.status).toBe("behind");
  });

  it("reports ahead when the database is newer than the build, as after a rollback", async () => {
    const head = await journalHead();
    const result = await checkWith(String(BigInt(head.when) - BigInt(1)), db);

    expect(result.status).toBe("ahead");
  });

  it("reports behind on a database that has never been migrated, rather than raising", async () => {
    // No `drizzle.__drizzle_migrations` at all. A bare select would fail at parse time, which
    // is why the query asks `to_regclass` first.
    const client = new PGlite();
    try {
      const empty = drizzle(client);
      const head = await journalHead();
      const result = await checkWith(head.when, empty);

      expect(result.status).toBe("behind");
      expect(result.appliedWhen).toBeNull();
      expect(result.appliedCount).toBeNull();
    } finally {
      await client.close();
    }
  });

  it("reports unknown when the build carries no expectation", async () => {
    const result = await checkWith(undefined, db);
    expect(result.status).toBe("unknown");
  });
});
