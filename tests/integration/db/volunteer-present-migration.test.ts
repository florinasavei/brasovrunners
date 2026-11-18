import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0215_volunteer_present` (§NNN; the owner, 2026-11-18, three days before the race: «La voluntari trebuie să trec
 * prezent/absent ca să pot face tombola doar pentru cei prezenți»), proven on real PostgreSQL (PGlite): one column on the event's
 * volunteers, `present`, a boolean, not null, false by default — so every volunteer from before reads not present, whatever their
 * state or their other ticks, and a row written without the column too — and nothing else; the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0215_volunteer_present";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000215";
const ANA = "cccccccc-0000-4000-8000-000000000215";
const DAN = "dddddddd-0000-4000-8000-000000000215";
const EVA = "eeeeeeee-0000-4000-8000-000000000215";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and counted right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-present-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // Three volunteers as the release before wrote them — confirmed with a kit and a number, offered, cancelled — and no such column.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status, volunteer_bib_start) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT', 500);
    INSERT INTO event_volunteers (id, event_id, name, state, source, has_kit, bib_number) VALUES ('${ANA}', '${EVENT}', 'Ana', 'CONFIRMED', 'STAFF', true, 500);
    INSERT INTO event_volunteers (id, event_id, name, state, source) VALUES ('${DAN}', '${EVENT}', 'Dan', 'REGISTERED', 'STAFF');
    INSERT INTO event_volunteers (id, event_id, name, state, source, in_raffle) VALUES ('${EVA}', '${EVENT}', 'Eva', 'CANCELLED', 'STAFF', false);
  `);
  await expect(client.query(`SELECT present FROM event_volunteers`)).rejects.toThrow();
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0215_volunteer_present", () => {
  it("reads every volunteer from before as not present — whatever their state and ticks — and a row written without the column too", async () => {
    expect((await client.query(`SELECT id, present FROM event_volunteers ORDER BY name`)).rows).toEqual([
      { id: ANA, present: false },
      { id: DAN, present: false },
      { id: EVA, present: false },
    ]);
    await client.exec(`INSERT INTO event_volunteers (event_id, name, state, source) VALUES ('${EVENT}', 'Ion', 'REGISTERED', 'STAFF')`);
    expect((await client.query(`SELECT present FROM event_volunteers WHERE name = 'Ion'`)).rows).toEqual([{ present: false }]);
  });

  it("is a boolean with no third state: false by default, NULL refused, true kept", async () => {
    const [column] = (
      await client.query<{ data_type: string; is_nullable: string; column_default: string }>(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'event_volunteers' AND column_name = 'present'`,
      )
    ).rows;
    expect(column).toEqual({ data_type: "boolean", is_nullable: "NO", column_default: "false" });
    await expect(client.exec(`UPDATE event_volunteers SET present = NULL WHERE id = '${ANA}'`)).rejects.toThrow();
    await client.exec(`UPDATE event_volunteers SET present = true WHERE id = '${ANA}'`);
    expect((await client.query(`SELECT present, has_kit, bib_number FROM event_volunteers WHERE id = '${ANA}'`)).rows).toEqual([{ present: true, has_kit: true, bib_number: 500 }]);
  });

  it("is read by the checker as an expansion, adding the one column and nothing else", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual(['ALTER TABLE "event_volunteers" ADD COLUMN "present" boolean DEFAULT false NOT NULL;']);
  });
});
