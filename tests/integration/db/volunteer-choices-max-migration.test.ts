import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VOLUNTEER_CHOICES_MAX_HIGHEST, VOLUNTEER_CHOICES_MAX_LOWEST } from "@/modules/volunteers/domain/volunteer";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0206_volunteer_choices_max` (§951, amending §761; the owner, 2026-11-16: «voluntarii primesc prea multe roluri» —
 * «Bifează prea multe pe formular»), proven on real PostgreSQL (PGlite): one column on the events, `volunteer_choices_max` —
 * nullable, no default — so every event from before has no limit and an event written without it has none either; the table
 * itself holds the bounds the service says in words; and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0206_volunteer_choices_max";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000206";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and numbered right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);
  expect(journal.entries[position - 1].tag).toBe("0205_raffle");

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-choices-max-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // An event that takes volunteers, as the release before wrote it.
  await client.exec(`INSERT INTO events (id, type, starts_at, editorial_status, accepts_volunteers) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT', true);`);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0206_volunteer_choices_max", () => {
  it("reads every event from before as having no limit, and an event written without the column too", async () => {
    expect((await client.query(`SELECT id, volunteer_choices_max FROM events`)).rows).toEqual([{ id: EVENT, volunteer_choices_max: null }]);
    await client.exec(`INSERT INTO events (type, starts_at, editorial_status) VALUES ('GROUP_RUN', '2026-11-25T16:00:00Z', 'DRAFT')`);
    expect((await client.query(`SELECT volunteer_choices_max FROM events WHERE type = 'GROUP_RUN'`)).rows).toEqual([{ volunteer_choices_max: null }]);
  });

  it("is a nullable whole number with no default", async () => {
    const [column] = (
      await client.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'volunteer_choices_max'`,
      )
    ).rows;
    expect(column).toEqual({ data_type: "integer", is_nullable: "YES", column_default: null });
  });

  it("holds the bounds in the table itself: one to twenty or nothing — the domain's two numbers", async () => {
    expect([VOLUNTEER_CHOICES_MAX_LOWEST, VOLUNTEER_CHOICES_MAX_HIGHEST]).toEqual([1, 20]);
    const set = (value: string) => client.exec(`UPDATE events SET volunteer_choices_max = ${value} WHERE id = '${EVENT}'`);
    for (const refused of ["0", "-1", "21", "1000"]) await expect(set(refused), refused).rejects.toThrow(/events_volunteer_choices_max_range/);
    for (const taken of ["1", "2", "20", "NULL"]) {
      await set(taken);
      expect((await client.query(`SELECT volunteer_choices_max FROM events WHERE id = '${EVENT}'`)).rows).toEqual([{ volunteer_choices_max: taken === "NULL" ? null : Number(taken) }]);
    }
  });

  it("is read by the checker as an expansion: the column and its CHECK, and nothing taken away", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual([
      'ALTER TABLE "events" ADD COLUMN "volunteer_choices_max" integer;',
      'ALTER TABLE "events" ADD CONSTRAINT "events_volunteer_choices_max_range" CHECK ("events"."volunteer_choices_max" IS NULL OR ("events"."volunteer_choices_max" >= 1 AND "events"."volunteer_choices_max" <= 20));',
    ]);
  });
});
