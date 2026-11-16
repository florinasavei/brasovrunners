import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0204_volunteer_checkpoint` (§NNN; the owner, 2026-11-16: «e foarte important sa avem planul de voluntari si fiecare in
 * ce punct ramane»), proven on real PostgreSQL (PGlite): one column on the event's volunteers, `checkpoint_id` — nullable, a
 * reference to one of the route's points — so every row from before stands at no point and a row written without it too; a point
 * deleted frees its people; and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0204_volunteer_checkpoint";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000204";
const POINT = "bbbbbbbb-0000-4000-8000-000000000204";
const ANA = "cccccccc-0000-4000-8000-000000000204";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and numbered right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-checkpoint-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // A point of a route and a volunteer, as the release before wrote them.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_checkpoints (id, event_id, name_ro, name_en, km) VALUES ('${POINT}', '${EVENT}', 'Intersecție', 'Junction', 1.2);
    INSERT INTO event_volunteers (id, event_id, name, state, source) VALUES ('${ANA}', '${EVENT}', 'Ana', 'CONFIRMED', 'STAFF');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0204_volunteer_checkpoint", () => {
  it("reads every row from before as standing at no point, and a row written without the column too", async () => {
    expect((await client.query(`SELECT id, checkpoint_id FROM event_volunteers`)).rows).toEqual([{ id: ANA, checkpoint_id: null }]);
    await client.exec(`INSERT INTO event_volunteers (event_id, name, state, source) VALUES ('${EVENT}', 'Ion', 'REGISTERED', 'STAFF')`);
    expect((await client.query(`SELECT checkpoint_id FROM event_volunteers WHERE name = 'Ion'`)).rows).toEqual([{ checkpoint_id: null }]);
  });

  it("is a nullable reference to a point of a route: a point that is not there is refused", async () => {
    const [column] = (
      await client.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'event_volunteers' AND column_name = 'checkpoint_id'`,
      )
    ).rows;
    expect(column).toEqual({ data_type: "uuid", is_nullable: "YES", column_default: null });
    await expect(client.exec(`UPDATE event_volunteers SET checkpoint_id = 'dddddddd-0000-4000-8000-000000000204' WHERE id = '${ANA}'`)).rejects.toThrow();
  });

  it("frees a point's people when the point is deleted, and keeps the people", async () => {
    await client.exec(`UPDATE event_volunteers SET checkpoint_id = '${POINT}' WHERE id = '${ANA}'`);
    expect((await client.query(`SELECT checkpoint_id FROM event_volunteers WHERE id = '${ANA}'`)).rows).toEqual([{ checkpoint_id: POINT }]);
    await client.exec(`DELETE FROM event_checkpoints WHERE id = '${POINT}'`);
    expect((await client.query(`SELECT id, checkpoint_id FROM event_volunteers WHERE id = '${ANA}'`)).rows).toEqual([{ id: ANA, checkpoint_id: null }]);
  });

  it("is read by the checker as an expansion: the column, its foreign key and its index, and nothing taken away", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toHaveLength(3);
    expect(statements[0]).toBe('ALTER TABLE "event_volunteers" ADD COLUMN "checkpoint_id" uuid;');
    expect(statements[1]).toMatch(/ADD CONSTRAINT "event_volunteers_checkpoint_id_event_checkpoints_id_fk" FOREIGN KEY \("checkpoint_id"\) REFERENCES "public"\."event_checkpoints"\("id"\) ON DELETE set null/);
    expect(statements[2]).toMatch(/^CREATE INDEX "event_volunteers_checkpoint_idx" ON "event_volunteers"/);
  });
});
