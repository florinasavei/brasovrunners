import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0163_volunteer_role_no_number` (§782, amending §754 and §761), proven on real PostgreSQL (PGlite): a volunteer role's
 * `needed` becomes optional — NULL is «fără număr», any number of people. The roles an event had before keep their number and their
 * people; a role may now be saved with none; the table still refuses zero, a negative number and the roles' other bounds; and the file
 * only expands (dropping a NOT NULL, and replacing a CHECK by a wider one, are no contraction).
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0163_volunteer_role_no_number";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000001";
const WATER = "bbbbbbbb-0000-4000-8000-000000000001";
const FINISH = "bbbbbbbb-0000-4000-8000-000000000002";
const ANA = "cccccccc-0000-4000-8000-000000000001";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and numbered right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);
  expect(journal.entries[position - 1].tag).toBe("0162_outbox_road_and_failures");

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-role-no-number-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The event as the release before wrote it: two roles, each with its number, and a volunteer given the first.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_volunteer_roles (id, event_id, name_ro, name_en, needed, position, created_at) VALUES
      ('${WATER}', '${EVENT}', 'Punct de apă', 'Water point', 3, 0, '2026-10-01T08:00:00Z'),
      ('${FINISH}', '${EVENT}', 'Sosire', 'Finish', 1000, 1, '2026-10-01T09:00:00Z');
    INSERT INTO event_volunteers (id, event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source)
      VALUES ('${ANA}', '${EVENT}', '${WATER}', 'Ana', 'ana@example.test', 'ana@example.test', 2, '+40712345678', 'CONFIRMED', 'PUBLIC');
  `);
  // Before it, the number is required: the table says so (the proof the migration changes something).
  await expect(
    client.exec(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ('${EVENT}', 'Fără', 'None', NULL, 5)`),
  ).rejects.toThrow();
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0163_volunteer_role_no_number — the roles from before", () => {
  it("keeps every role's number and its people exactly as they were", async () => {
    expect((await client.query(`SELECT id, needed FROM event_volunteer_roles ORDER BY position`)).rows).toEqual([
      { id: WATER, needed: 3 },
      { id: FINISH, needed: 1000 },
    ]);
    expect((await client.query(`SELECT role_id, state FROM event_volunteers WHERE id = '${ANA}'`)).rows).toEqual([{ role_id: WATER, state: "CONFIRMED" }]);
  });
});

describe("migration 0163_volunteer_role_no_number — a role without a number", () => {
  const insert = (needed: string, position: number, name = `Rol ${position}`) =>
    client.exec(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ('${EVENT}', '${name}', 'Role ${position}', ${needed}, ${position})`);

  it("accepts NULL, and a number from 1 up, as before", async () => {
    await insert("NULL", 10);
    await insert("1", 11);
    await insert("1000", 12);
    expect((await client.query(`SELECT count(*)::int AS n FROM event_volunteer_roles WHERE needed IS NULL`)).rows).toEqual([{ n: 1 }]);
  });

  it("still refuses zero and a negative number: the CHECK is wider by NULL only", async () => {
    await expect(insert("0", 20)).rejects.toThrow(/event_volunteer_roles_needed_positive/);
    await expect(insert("-1", 21)).rejects.toThrow(/event_volunteer_roles_needed_positive/);
    await expect(client.exec(`UPDATE event_volunteer_roles SET needed = 0 WHERE id = '${WATER}'`)).rejects.toThrow(/event_volunteer_roles_needed_positive/);
  });

  it("turns a role into one without a number and back, its people staying on it", async () => {
    await client.exec(`UPDATE event_volunteer_roles SET needed = NULL WHERE id = '${WATER}'`);
    expect((await client.query(`SELECT needed FROM event_volunteer_roles WHERE id = '${WATER}'`)).rows).toEqual([{ needed: null }]);
    expect((await client.query(`SELECT role_id FROM event_volunteers WHERE id = '${ANA}'`)).rows).toEqual([{ role_id: WATER }]);
    await client.exec(`UPDATE event_volunteer_roles SET needed = 3 WHERE id = '${WATER}'`);
    expect((await client.query(`SELECT needed FROM event_volunteer_roles WHERE id = '${WATER}'`)).rows).toEqual([{ needed: 3 }]);
  });

  it("keeps the roles' other bounds: a name must be there", async () => {
    await expect(client.exec(`INSERT INTO event_volunteer_roles (event_id, name_ro, name_en, needed, position) VALUES ('${EVENT}', '', 'x', NULL, 30)`)).rejects.toThrow();
  });
});

describe("migration 0163_volunteer_role_no_number — only an expansion", () => {
  it("is read by the checker as an expansion: dropping a NOT NULL takes nothing away, and the CHECK is replaced by a wider one under its own name", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    expect(sql).toMatch(/ALTER COLUMN "needed" DROP NOT NULL/);
    expect(sql).toMatch(/ADD CONSTRAINT "event_volunteer_roles_needed_positive" CHECK \("event_volunteer_roles"\."needed" IS NULL OR "event_volunteer_roles"\."needed" >= 1\)/);
    expect(sql).not.toMatch(/DROP COLUMN|DROP TABLE|RENAME|SET NOT NULL|SET DATA TYPE/);
  });
});
