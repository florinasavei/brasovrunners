import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0225_volunteer_v_numbers` (§NNN, amending §948; the owner, 2026-11-20: «vreau sa le dai numar de voluntar V001 V002 la
 * toti voluntarii automat!»), proven on real PostgreSQL (PGlite): one nullable integer on the event's volunteers, `volunteer_number`,
 * unique per event and positive — and the confirmed volunteers already there numbered by the migration itself, event by event, in
 * the order they were first confirmed (the trail's `volunteer.state_changed` row that made them CONFIRMED), then added, then by id;
 * a row with no such trail row after those that have one; nobody waiting or cancelled; the old series' `bib_number` untouched. The
 * file only expands — a backfill of its own new column is an expansion (AGENTS.md §7.6) — and the backfill run again changes nothing.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0225_volunteer_v_numbers";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const CROSS = "aaaaaaaa-0000-4000-8000-000000000225";
const TRAIL = "bbbbbbbb-0000-4000-8000-000000000225";
const ADMIN = "99999999-0000-4000-8000-000000000225";
// The cross: Ana added first but confirmed last; Dan confirmed first; Eva confirmed with no trail row; Ion confirmed twice (his first
// counts); Vlad waiting; Zoe cancelled — after a confirmation — holding a number of the old series; Mara confirmed with an old number.
const ANA = "a0000000-0000-4000-8000-000000000225";
const DAN = "d0000000-0000-4000-8000-000000000225";
const EVA = "e0000000-0000-4000-8000-000000000225";
const ION = "10000000-0000-4000-8000-000000000225";
const VLAD = "20000000-0000-4000-8000-000000000225";
const ZOE = "30000000-0000-4000-8000-000000000225";
const MARA = "40000000-0000-4000-8000-000000000225";
// The trail run: one confirmed volunteer, its own series.
const OANA = "50000000-0000-4000-8000-000000000225";

let client: PGlite;
let folder: string;

const confirmedAt = (volunteerId: string, event: string, at: string) =>
  `INSERT INTO audit_logs (actor_staff_user_id, action, entity_type, entity_id, metadata_json, created_at) VALUES ('${ADMIN}', 'volunteer.state_changed', 'event', '${event}', '{"volunteerId":"${volunteerId}","from":"REGISTERED","to":"CONFIRMED"}', '${at}');`;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and counted right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-v-numbers-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // Two races and their volunteers as the release before wrote them, with the trail of their confirmations, and no such column.
  await client.exec(`
    INSERT INTO staff_users (id, email, display_name, role) VALUES ('${ADMIN}', 'admin-0225@dev.test', 'Admin', 'ADMIN');
    INSERT INTO events (id, type, starts_at, editorial_status, volunteer_bib_start) VALUES ('${CROSS}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT', 500);
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${TRAIL}', 'RACE', '2026-11-22T08:00:00Z', 'DRAFT');
    INSERT INTO event_volunteers (id, event_id, name, state, source, created_at) VALUES ('${ANA}', '${CROSS}', 'Ana', 'CONFIRMED', 'STAFF', '2026-11-01T08:00:00Z');
    INSERT INTO event_volunteers (id, event_id, name, state, source, created_at) VALUES ('${DAN}', '${CROSS}', 'Dan', 'CONFIRMED', 'STAFF', '2026-11-02T08:00:00Z');
    INSERT INTO event_volunteers (id, event_id, name, state, source, created_at) VALUES ('${EVA}', '${CROSS}', 'Eva', 'CONFIRMED', 'STAFF', '2026-10-01T08:00:00Z');
    INSERT INTO event_volunteers (id, event_id, name, state, source, created_at) VALUES ('${ION}', '${CROSS}', 'Ion', 'CONFIRMED', 'STAFF', '2026-11-03T08:00:00Z');
    INSERT INTO event_volunteers (id, event_id, name, state, source, created_at) VALUES ('${VLAD}', '${CROSS}', 'Vlad', 'REGISTERED', 'STAFF', '2026-11-04T08:00:00Z');
    INSERT INTO event_volunteers (id, event_id, name, state, source, created_at, bib_number) VALUES ('${ZOE}', '${CROSS}', 'Zoe', 'CANCELLED', 'STAFF', '2026-11-05T08:00:00Z', 501);
    INSERT INTO event_volunteers (id, event_id, name, state, source, created_at, bib_number) VALUES ('${MARA}', '${CROSS}', 'Mara', 'CONFIRMED', 'STAFF', '2026-11-06T08:00:00Z', 500);
    INSERT INTO event_volunteers (id, event_id, name, state, source, created_at) VALUES ('${OANA}', '${TRAIL}', 'Oana', 'CONFIRMED', 'STAFF', '2026-11-07T08:00:00Z');
    ${confirmedAt(DAN, CROSS, "2026-11-10T08:00:00Z")}
    ${confirmedAt(ION, CROSS, "2026-11-11T08:00:00Z")}
    ${confirmedAt(MARA, CROSS, "2026-11-12T08:00:00Z")}
    ${confirmedAt(ZOE, CROSS, "2026-11-12T09:00:00Z")}
    ${confirmedAt(ION, CROSS, "2026-11-13T08:00:00Z")}
    ${confirmedAt(ANA, CROSS, "2026-11-14T08:00:00Z")}
    ${confirmedAt(OANA, TRAIL, "2026-11-15T08:00:00Z")}
  `);
  // Another event's trail row naming Ana's id never orders her: the row is read by her own event only.
  await client.exec(confirmedAt(ANA, TRAIL, "2026-11-01T00:00:00Z"));
  await expect(client.query(`SELECT volunteer_number FROM event_volunteers`)).rejects.toThrow();
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const numbers = async () =>
  Object.fromEntries((await client.query<{ name: string; volunteer_number: number | null }>(`SELECT name, volunteer_number FROM event_volunteers ORDER BY name`)).rows.map((row) => [row.name, row.volunteer_number]));

describe("migration 0225_volunteer_v_numbers", () => {
  it("numbers every confirmed volunteer, event by event, in the order they were first confirmed — a row with no trail row last — and nobody waiting or cancelled", async () => {
    expect(await numbers()).toEqual({
      // The cross: Dan (first confirmed), Ion (his first confirmation), Mara, Ana (confirmed last), then Eva, who has no trail row.
      Dan: 1,
      Ion: 2,
      Mara: 3,
      Ana: 4,
      Eva: 5,
      Vlad: null,
      Zoe: null,
      // The trail run's own series.
      Oana: 1,
    });
  });

  it("leaves the old series as it was: the numbers drawn from «Numerele voluntarilor încep de la» and the start itself", async () => {
    expect((await client.query(`SELECT name, bib_number FROM event_volunteers WHERE bib_number IS NOT NULL ORDER BY name`)).rows).toEqual([
      { name: "Mara", bib_number: 500 },
      { name: "Zoe", bib_number: 501 },
    ]);
    expect((await client.query(`SELECT volunteer_bib_start FROM events WHERE id = '${CROSS}'`)).rows).toEqual([{ volunteer_bib_start: 500 }]);
  });

  it("is a nullable integer, one number once per event and never nought — a row written without it has none", async () => {
    const [column] = (
      await client.query<{ data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'event_volunteers' AND column_name = 'volunteer_number'`,
      )
    ).rows;
    expect(column).toEqual({ data_type: "integer", is_nullable: "YES", column_default: null });
    await expect(client.exec(`UPDATE event_volunteers SET volunteer_number = 1 WHERE id = '${ANA}'`)).rejects.toThrow();
    await expect(client.exec(`UPDATE event_volunteers SET volunteer_number = 0 WHERE id = '${VLAD}'`)).rejects.toThrow();
    await expect(client.exec(`UPDATE event_volunteers SET volunteer_number = -3 WHERE id = '${VLAD}'`)).rejects.toThrow();
    // The same number at another event, and none at all, are both fine.
    await client.exec(`UPDATE event_volunteers SET volunteer_number = 2 WHERE id = '${OANA}'`);
    await client.exec(`INSERT INTO event_volunteers (event_id, name, state, source) VALUES ('${CROSS}', 'Ion Nou', 'REGISTERED', 'STAFF')`);
    expect((await client.query(`SELECT volunteer_number FROM event_volunteers WHERE name = 'Ion Nou'`)).rows).toEqual([{ volunteer_number: null }]);
    await client.exec(`UPDATE event_volunteers SET volunteer_number = 1 WHERE id = '${OANA}'`);
  });

  it("is read by the checker as an expansion, its statements the column, the backfill, the index and the check — and the backfill run again changes nothing", async () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toHaveLength(4);
    expect(statements[0]).toBe('ALTER TABLE "event_volunteers" ADD COLUMN "volunteer_number" integer;');
    expect(statements[1]).toMatch(/^WITH "confirmed" AS \(/);
    expect(statements[1]).toMatch(/UPDATE "event_volunteers" SET "volunteer_number" = "numbered"\."number"/);
    expect(statements[2]).toBe(
      'CREATE UNIQUE INDEX "event_volunteers_event_volunteer_number_unique" ON "event_volunteers" USING btree ("event_id","volunteer_number") WHERE "event_volunteers"."volunteer_number" IS NOT NULL;',
    );
    expect(statements[3]).toBe(
      'ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_volunteer_number_positive" CHECK ("event_volunteers"."volunteer_number" IS NULL OR "event_volunteers"."volunteer_number" > 0);',
    );
    // Idempotent: run again, it finds nobody confirmed without a number and writes nothing.
    const before = await numbers();
    await client.exec(statements[1]);
    expect(await numbers()).toEqual(before);
  });
});
