import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0205_raffle` (§949; the owner, 2026-11-16: «o bifă importantă, și coloană peste tot de „participă la tombolă" și o
 * setare per eveniment cum ar fi „avem tombolă" dar doar în backoffice vizibil»), proven on real PostgreSQL (PGlite) from a
 * database migrated by the release before it (§NNN — the review of 2026-11-16 found the migration with no such test): three
 * booleans, each NOT NULL with its default, so every event from before holds no raffle and every registration and volunteer
 * from before is in one — nobody is taken out of a raffle by the release itself — and a row written without the columns too;
 * and the file only expands. `volunteer-checkpoint-migration.test.ts` is the model.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0205_raffle";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000205";
const PERSON = "bbbbbbbb-0000-4000-8000-000000000205";
const RUNNER = "cccccccc-0000-4000-8000-000000000205";
const ANA = "dddddddd-0000-4000-8000-000000000205";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and numbered right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "raffle-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The release before knows none of the three columns.
  const before = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns WHERE (table_name IN ('registrations', 'event_volunteers') AND column_name = 'in_raffle') OR (table_name = 'events' AND column_name = 'has_raffle')`,
  );
  expect(before.rows).toEqual([]);
  // An event, a confirmed runner with a number and a confirmed volunteer, as the release before wrote them.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO participants (id, delivery_email, normalized_email, canonical_email, canonicalization_version, default_name)
      VALUES ('${PERSON}', 'radu@example.test', 'radu@example.test', 'radu@example.test', 2, 'Radu Munteanu');
    INSERT INTO registrations (id, event_id, participant_id, kind, locale, registered_name, display_name, privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, status, confirmed_at, bib_number)
      VALUES ('${RUNNER}', '${EVENT}', '${PERSON}', 'REAL', 'ro', 'Radu Munteanu', 'Radu M.', 1, '2026-11-01T10:00:00Z', false, 1, 'CONFIRMED', '2026-11-01T10:05:00Z', 12);
    INSERT INTO event_volunteers (id, event_id, name, state, source) VALUES ('${ANA}', '${EVENT}', 'Ana', 'CONFIRMED', 'STAFF');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0205_raffle", () => {
  it("reads every event from before as holding no raffle, and every registration and volunteer from before as in one", async () => {
    expect((await client.query(`SELECT id, has_raffle FROM events`)).rows).toEqual([{ id: EVENT, has_raffle: false }]);
    expect((await client.query(`SELECT id, in_raffle, status, bib_number FROM registrations`)).rows).toEqual([{ id: RUNNER, in_raffle: true, status: "CONFIRMED", bib_number: 12 }]);
    expect((await client.query(`SELECT id, in_raffle, state FROM event_volunteers`)).rows).toEqual([{ id: ANA, in_raffle: true, state: "CONFIRMED" }]);
  });

  it("gives a row written without the columns the same: no raffle on a new event, a new person in", async () => {
    await client.exec(`
      INSERT INTO events (type, starts_at, editorial_status) VALUES ('RACE', '2026-12-05T08:00:00Z', 'DRAFT');
      INSERT INTO event_volunteers (event_id, name, state, source) VALUES ('${EVENT}', 'Ion', 'REGISTERED', 'STAFF');
    `);
    expect((await client.query(`SELECT has_raffle FROM events WHERE id <> '${EVENT}'`)).rows).toEqual([{ has_raffle: false }]);
    expect((await client.query(`SELECT in_raffle FROM event_volunteers WHERE name = 'Ion'`)).rows).toEqual([{ in_raffle: true }]);
  });

  it("makes each of the three a boolean that is never null, with the default the release reads", async () => {
    const columns = (
      await client.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
         WHERE (table_name IN ('registrations', 'event_volunteers') AND column_name = 'in_raffle') OR (table_name = 'events' AND column_name = 'has_raffle')
         ORDER BY table_name`,
      )
    ).rows;
    expect(columns).toEqual([
      { table_name: "event_volunteers", column_name: "in_raffle", data_type: "boolean", is_nullable: "NO", column_default: "true" },
      { table_name: "events", column_name: "has_raffle", data_type: "boolean", is_nullable: "NO", column_default: "false" },
      { table_name: "registrations", column_name: "in_raffle", data_type: "boolean", is_nullable: "NO", column_default: "true" },
    ]);
    // Never null, by hand either: a tick is yes or no.
    await expect(client.exec(`UPDATE registrations SET in_raffle = NULL WHERE id = '${RUNNER}'`)).rejects.toThrow();
    await expect(client.exec(`UPDATE event_volunteers SET in_raffle = NULL WHERE id = '${ANA}'`)).rejects.toThrow();
    await expect(client.exec(`UPDATE events SET has_raffle = NULL WHERE id = '${EVENT}'`)).rejects.toThrow();
  });

  it("lets an organizer take a person out and the event hold a raffle, touching nothing else of the rows", async () => {
    await client.exec(`
      UPDATE events SET has_raffle = true WHERE id = '${EVENT}';
      UPDATE registrations SET in_raffle = false WHERE id = '${RUNNER}';
      UPDATE event_volunteers SET in_raffle = false WHERE id = '${ANA}';
    `);
    expect((await client.query(`SELECT has_raffle FROM events WHERE id = '${EVENT}'`)).rows).toEqual([{ has_raffle: true }]);
    expect((await client.query(`SELECT in_raffle, status, bib_number FROM registrations WHERE id = '${RUNNER}'`)).rows).toEqual([{ in_raffle: false, status: "CONFIRMED", bib_number: 12 }]);
    expect((await client.query(`SELECT in_raffle, state FROM event_volunteers WHERE id = '${ANA}'`)).rows).toEqual([{ in_raffle: false, state: "CONFIRMED" }]);
  });

  it("is read by the checker as an expansion: three columns added, each with its default, and nothing taken away", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual([
      'ALTER TABLE "event_volunteers" ADD COLUMN "in_raffle" boolean DEFAULT true NOT NULL;',
      'ALTER TABLE "events" ADD COLUMN "has_raffle" boolean DEFAULT false NOT NULL;',
      'ALTER TABLE "registrations" ADD COLUMN "in_raffle" boolean DEFAULT true NOT NULL;',
    ]);
  });
});
