import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0209_volunteer_race_day_decision` (§954; the owner, 2026-11-16: «si la voluntar trebuie sa am si decizie pt ziua
 * cursei»), proven on real PostgreSQL (PGlite): one column on the event's volunteers, `race_day_decision` — nullable text, no
 * default — so every row from before has no decision and a row written without it too; the CHECK holds it to one to three
 * hundred characters, counted as characters and never as bytes, and refuses an empty line; and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0209_volunteer_race_day_decision";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000209";
const ANA = "cccccccc-0000-4000-8000-000000000209";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and counted right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-race-day-decision-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // A volunteer as the release before wrote one: the table has no such column yet.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_volunteers (id, event_id, name, state, source) VALUES ('${ANA}', '${EVENT}', 'Ana', 'CONFIRMED', 'STAFF');
  `);
  await expect(client.query(`SELECT race_day_decision FROM event_volunteers`)).rejects.toThrow();
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const decisionOf = async (name: string) => (await client.query<{ race_day_decision: string | null }>(`SELECT race_day_decision FROM event_volunteers WHERE name = '${name}'`)).rows;

describe("migration 0209_volunteer_race_day_decision", () => {
  it("reads every row from before as having no decision, and a row written without the column too", async () => {
    expect((await client.query(`SELECT id, race_day_decision FROM event_volunteers`)).rows).toEqual([{ id: ANA, race_day_decision: null }]);
    await client.exec(`INSERT INTO event_volunteers (event_id, name, state, source) VALUES ('${EVENT}', 'Ion', 'REGISTERED', 'STAFF')`);
    expect(await decisionOf("Ion")).toEqual([{ race_day_decision: null }]);
  });

  it("is a nullable text column with no default", async () => {
    const [column] = (
      await client.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'event_volunteers' AND column_name = 'race_day_decision'`,
      )
    ).rows;
    expect(column).toEqual({ data_type: "text", is_nullable: "YES", column_default: null });
  });

  it("holds a decision to one to three hundred characters — characters, not bytes — and refuses an empty one", async () => {
    await client.exec(`UPDATE event_volunteers SET race_day_decision = 'vine la 8:00 la start' WHERE id = '${ANA}'`);
    expect(await decisionOf("Ana")).toEqual([{ race_day_decision: "vine la 8:00 la start" }]);
    // Three hundred letters with diacritics are three hundred characters, though six hundred bytes.
    await client.exec(`UPDATE event_volunteers SET race_day_decision = repeat('ș', 300) WHERE id = '${ANA}'`);
    expect((await decisionOf("Ana"))[0].race_day_decision).toHaveLength(300);
    await expect(client.exec(`UPDATE event_volunteers SET race_day_decision = repeat('a', 301) WHERE id = '${ANA}'`)).rejects.toThrow(/event_volunteers_race_day_decision_length/);
    await expect(client.exec(`UPDATE event_volunteers SET race_day_decision = '' WHERE id = '${ANA}'`)).rejects.toThrow(/event_volunteers_race_day_decision_length/);
    // Neither refusal wrote anything, and no decision is NULL again.
    expect((await decisionOf("Ana"))[0].race_day_decision).toHaveLength(300);
    await client.exec(`UPDATE event_volunteers SET race_day_decision = NULL WHERE id = '${ANA}'`);
    expect(await decisionOf("Ana")).toEqual([{ race_day_decision: null }]);
  });

  it("is read by the checker as an expansion: the column and its CHECK, and nothing taken away", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual([
      'ALTER TABLE "event_volunteers" ADD COLUMN "race_day_decision" text;',
      'ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_race_day_decision_length" CHECK ("event_volunteers"."race_day_decision" IS NULL OR char_length("event_volunteers"."race_day_decision") BETWEEN 1 AND 300);',
    ]);
  });
});
