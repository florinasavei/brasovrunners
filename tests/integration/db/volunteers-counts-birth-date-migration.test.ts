import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0159_volunteers_counts_birth_date` (§NNN, amending §761, §765 and §768), proven on real PostgreSQL (PGlite): a
 * volunteer listed before it keeps their age and has no date of birth; an event shows no public count of volunteers until the club
 * ticks it; the date is a calendar day, nullable, held beside the age; and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0159_volunteers_counts_birth_date";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000001";
const ANA = "cccccccc-0000-4000-8000-000000000001";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`).
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);
  expect(journal.entries[position - 1].tag).toBe("0158_declaration_signature_trace");
  // Not the last any more: `0160_volunteer_role_categories` follows it (this test replays the journal only up to it).

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-counts-birth-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // An event and a volunteer as the release before wrote them: an age of sixteen and a guardian, no date.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_volunteers (id, event_id, name, email, canonical_email, canonicalization_version, phone, state, source, age, guardian_name)
      VALUES ('${ANA}', '${EVENT}', 'Ana', 'ana@example.test', 'ana@example.test', 2, '+40712345678', 'REGISTERED', 'PUBLIC', 16, 'Maria');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0159_volunteers_counts_birth_date — the public count of volunteers", () => {
  it("gives every event, the ones already there included, no public count until the club ticks it", async () => {
    const { rows } = await client.query(`SELECT volunteers_show_counts FROM events WHERE id = '${EVENT}'`);
    expect(rows).toEqual([{ volunteers_show_counts: false }]);
  });

  it("is a boolean that cannot be null, and a new event starts with it off", async () => {
    await expect(client.exec(`UPDATE events SET volunteers_show_counts = NULL WHERE id = '${EVENT}'`)).rejects.toThrow();
    await client.exec(`INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('aaaaaaaa-0000-4000-8000-000000000002', 'RACE', '2026-12-05T08:00:00Z', 'DRAFT')`);
    const { rows } = await client.query(`SELECT volunteers_show_counts FROM events WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002'`);
    expect(rows).toEqual([{ volunteers_show_counts: false }]);
    await client.exec(`UPDATE events SET volunteers_show_counts = true WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002'`);
    expect((await client.query(`SELECT volunteers_show_counts FROM events WHERE id = 'aaaaaaaa-0000-4000-8000-000000000002'`)).rows).toEqual([{ volunteers_show_counts: true }]);
  });
});

describe("migration 0159_volunteers_counts_birth_date — the date of birth", () => {
  it("leaves a volunteer listed before it with their age and no date — nothing is derived or invented", async () => {
    const { rows } = await client.query(`SELECT age, date_of_birth, guardian_name FROM event_volunteers WHERE id = '${ANA}'`);
    expect(rows).toEqual([{ age: 16, date_of_birth: null, guardian_name: "Maria" }]);
  });

  it("holds a calendar day beside the age, refuses what is no day, and takes null back", async () => {
    const update = (set: string) => client.exec(`UPDATE event_volunteers SET ${set} WHERE id = '${ANA}'`);
    for (const bad of ["date_of_birth = '2009-02-30'", "date_of_birth = 'ieri'", "date_of_birth = '2009-13-01'"]) {
      await expect(update(bad), bad).rejects.toThrow();
    }
    await update("date_of_birth = '2008-02-29', age = 18");
    const { rows } = await client.query<{ date_of_birth: unknown; age: number }>(`SELECT date_of_birth::text AS date_of_birth, age FROM event_volunteers WHERE id = '${ANA}'`);
    expect(rows).toEqual([{ date_of_birth: "2008-02-29", age: 18 }]);
    await update("date_of_birth = NULL");
    expect((await client.query(`SELECT date_of_birth FROM event_volunteers WHERE id = '${ANA}'`)).rows).toEqual([{ date_of_birth: null }]);
  });

  it("keeps the age's own checks: the date is no way round them", async () => {
    await expect(client.exec(`UPDATE event_volunteers SET age = 0, date_of_birth = '2026-01-01' WHERE id = '${ANA}'`)).rejects.toThrow();
    await expect(client.exec(`UPDATE event_volunteers SET age = 121 WHERE id = '${ANA}'`)).rejects.toThrow();
  });

  it("only expands: two columns added, one with a default and one nullable — nothing dropped, renamed or tightened", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    expect(sql).toMatch(/ALTER TABLE "event_volunteers" ADD COLUMN "date_of_birth" date;/);
    expect(sql).toMatch(/ALTER TABLE "events" ADD COLUMN "volunteers_show_counts" boolean DEFAULT false NOT NULL;/);
    expect(sql).not.toMatch(/DROP|RENAME|SET NOT NULL|ALTER COLUMN/);
  });
});
