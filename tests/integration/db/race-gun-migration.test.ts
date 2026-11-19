import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `…_race_gun` (§986 «Start» on «Cronometrare»), proven on real PostgreSQL (PGlite): two nullable columns on `events` —
 * the gun as pressed and who pressed it, the account's key `ON DELETE SET NULL` — and a CHECK that names nobody without a moment; on
 * a database migrated by the release before, every event reads no gun pressed, so every race counts from its planned start; and the
 * file only expands. **Found by its name, not its number**: a branch merged beside it may take the number first, and the landing
 * renumbers the file — this test follows it.
 */
const MIGRATIONS = "src/db/migrations";
const SUFFIX = "_race_gun";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const RACE = "aaaaaaaa-0000-4000-8000-00000000a215";
const STAFF = "bbbbbbbb-0000-4000-8000-00000000a215";

let client: PGlite;
let folder: string;
let tag: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag.endsWith(SUFFIX));
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  tag = journal.entries[position].tag;
  // Sorts after every migration before it (drizzle applies by `when`), and numbered right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "race-gun-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // A race and a staff account as the release before wrote them.
  await client.exec(`
    INSERT INTO staff_users (id, email, display_name, role) VALUES ('${STAFF}', 'start@example.test', 'Oana Organizator', 'MODERATOR');
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${RACE}', 'RACE', '2026-11-21T07:00:00Z', 'DRAFT');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration …_race_gun", () => {
  it("leaves every event that exists with no gun pressed: the race counts from its planned start", async () => {
    expect((await client.query(`SELECT race_gun_at, race_gun_by_staff_user_id FROM events WHERE id = '${RACE}'`)).rows).toEqual([{ race_gun_at: null, race_gun_by_staff_user_id: null }]);
  });

  it("holds a gun with who pressed it, a gun alone, never a presser without a gun, and lets a removed account leave the moment", async () => {
    await client.exec(`UPDATE events SET race_gun_at = '2026-11-21T07:00:03Z', race_gun_by_staff_user_id = '${STAFF}' WHERE id = '${RACE}'`);
    await expect(client.exec(`UPDATE events SET race_gun_at = NULL WHERE id = '${RACE}'`)).rejects.toThrow();
    await expect(client.exec(`UPDATE events SET race_gun_by_staff_user_id = 'cccccccc-0000-4000-8000-00000000a215' WHERE id = '${RACE}'`)).rejects.toThrow();
    await client.exec(`DELETE FROM staff_users WHERE id = '${STAFF}'`);
    const [row] = (await client.query<{ race_gun_at: Date; race_gun_by_staff_user_id: string | null }>(`SELECT race_gun_at, race_gun_by_staff_user_id FROM events WHERE id = '${RACE}'`)).rows;
    expect(row.race_gun_by_staff_user_id).toBeNull();
    expect(new Date(row.race_gun_at).toISOString()).toBe("2026-11-21T07:00:03.000Z");
  });

  it("is read by the checker as an expansion: two columns, a key and a CHECK, nothing taken away", () => {
    const sql = readFileSync(`${MIGRATIONS}/${tag}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual([
      'ALTER TABLE "events" ADD COLUMN "race_gun_at" timestamp with time zone;',
      'ALTER TABLE "events" ADD COLUMN "race_gun_by_staff_user_id" uuid;',
      'ALTER TABLE "events" ADD CONSTRAINT "events_race_gun_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("race_gun_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;',
      'ALTER TABLE "events" ADD CONSTRAINT "events_race_gun_actor" CHECK ("events"."race_gun_by_staff_user_id" IS NULL OR "events"."race_gun_at" IS NOT NULL);',
    ]);
    expect(sql).not.toMatch(/\bDROP\b|\bRENAME\b|DELETE FROM|UPDATE "events"/i);
  });
});
