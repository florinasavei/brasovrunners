import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration `0097_newsletter_discounts_retired` (§NNN), proven on real PostgreSQL (PGlite): the
 * database is built up to the migration before it, subscriptions are written the way §445's pop-up
 * wrote them, and then the rest of the migrations run over them — as `yarn db:migrate:env` runs
 * them over production.
 *
 * - a subscriber who chose discounts and other topics keeps the others;
 * - a subscriber who chose discounts alone is deleted, links and all (an empty list is refused);
 * - a subscriber who never chose discounts is untouched;
 * - the file only changes rows — no drop, no rename (AGENTS.md §7.6).
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0097_newsletter_discounts_retired";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);

  folder = mkdtempSync(path.join(tmpdir(), "newsletter-discounts-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  await client.exec(`
    INSERT INTO newsletter_subscribers (delivery_email, canonical_email, canonicalization_version, locale, topics, privacy_notice_version, confirmed_at) VALUES
      ('mixed@example.org', 'mixed@example.org', 1, 'ro', ARRAY['BIG_EVENTS', 'DISCOUNTS', 'VOLUNTEERING']::newsletter_topic[], 1, now()),
      ('only@example.org', 'only@example.org', 1, 'en', ARRAY['DISCOUNTS']::newsletter_topic[], 1, NULL),
      ('other@example.org', 'other@example.org', 1, 'ro', ARRAY['WEEKLY_RUNS']::newsletter_topic[], 1, now()),
      ('all@example.org', 'all@example.org', 1, 'ro', ARRAY['ALL']::newsletter_topic[], 1, now());
    INSERT INTO newsletter_tokens (subscriber_id, purpose, token_hash, expires_at)
      SELECT id, 'CONFIRM', repeat('a', 64), now() + interval '1 day' FROM newsletter_subscribers WHERE canonical_email = 'only@example.org';
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("§NNN migration 0097_newsletter_discounts_retired — discount codes leave the newsletter", () => {
  it("strips DISCOUNTS from every subscription and keeps every other topic", async () => {
    const { rows } = await client.query<{ canonical_email: string; topics: string }>(
      "SELECT canonical_email, topics::text AS topics FROM newsletter_subscribers ORDER BY canonical_email",
    );
    expect(rows).toEqual([
      { canonical_email: "all@example.org", topics: "{ALL}" },
      { canonical_email: "mixed@example.org", topics: "{BIG_EVENTS,VOLUNTEERING}" },
      { canonical_email: "other@example.org", topics: "{WEEKLY_RUNS}" },
    ]);
  });

  it("deletes a subscriber who chose discounts alone, with its links", async () => {
    const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM newsletter_tokens");
    expect(rows[0].n).toBe(0);
  });

  it("changes rows only: no drop, no rename, no type change (AGENTS.md §7.6)", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/DROP\s|RENAME|ALTER\s/i);
  });
});
