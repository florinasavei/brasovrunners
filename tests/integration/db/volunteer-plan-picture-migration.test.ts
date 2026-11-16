import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0207_volunteer_plan_picture` (§NNN; the owner, 2026-11-16, with a picture of the route and its volunteers' points
 * numbered on it: «trebui sa pot incarca si planul voluntarilor pe traseu in genul [pozei]»), proven on real PostgreSQL (PGlite):
 * one column on the events, `volunteer_plan_media_asset_id` — a nullable uuid — so every event from before has no picture and
 * an event written without it has none; it holds a stored picture's id; it carries no foreign key, like the cover's column
 * beside it (the reference check and the plan's read are its guards); and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0207_volunteer_plan_picture";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000207";
const PICTURE = "bbbbbbbb-0000-4000-8000-000000000207";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and numbered right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-plan-picture-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // An event and a stored picture, as the release before wrote them.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO media_assets (id, key_prefix, original_filename, width, height, byte_size) VALUES ('${PICTURE}', '${PICTURE}', 'plan.png', 2400, 1600, 1000);
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0207_volunteer_plan_picture", () => {
  it("reads every event from before as having no picture, and an event written without the column too", async () => {
    expect((await client.query(`SELECT id, volunteer_plan_media_asset_id FROM events`)).rows).toEqual([{ id: EVENT, volunteer_plan_media_asset_id: null }]);
    await client.exec(`INSERT INTO events (type, starts_at, editorial_status) VALUES ('GROUP_RUN', '2026-12-02T17:00:00Z', 'DRAFT')`);
    expect((await client.query(`SELECT volunteer_plan_media_asset_id FROM events WHERE type = 'GROUP_RUN'`)).rows).toEqual([{ volunteer_plan_media_asset_id: null }]);
  });

  it("is a nullable uuid with no default, and holds a stored picture's id", async () => {
    const [column] = (
      await client.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'volunteer_plan_media_asset_id'`,
      )
    ).rows;
    expect(column).toEqual({ data_type: "uuid", is_nullable: "YES", column_default: null });
    await client.exec(`UPDATE events SET volunteer_plan_media_asset_id = '${PICTURE}' WHERE id = '${EVENT}'`);
    expect((await client.query(`SELECT volunteer_plan_media_asset_id FROM events WHERE id = '${EVENT}'`)).rows).toEqual([{ volunteer_plan_media_asset_id: PICTURE }]);
    // A value that is no id is the database's own refusal.
    await expect(client.exec(`UPDATE events SET volunteer_plan_media_asset_id = 'the map' WHERE id = '${EVENT}'`)).rejects.toThrow();
  });

  it("carries no foreign key, as the cover's column beside it carries none: the reference check keeps the picture", async () => {
    const keys = (
      await client.query<{ column_name: string }>(
        `SELECT kcu.column_name FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
          WHERE tc.table_name = 'events' AND tc.constraint_type = 'FOREIGN KEY'`,
      )
    ).rows.map((row) => row.column_name);
    expect(keys).not.toContain("volunteer_plan_media_asset_id");
    expect(keys).not.toContain("cover_media_asset_id");
  });

  it("is read by the checker as an expansion: the one column, and nothing taken away", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual(['ALTER TABLE "events" ADD COLUMN "volunteer_plan_media_asset_id" uuid;']);
  });
});
