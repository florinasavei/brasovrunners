import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0187_volunteer_has_kit` (§904; the owner, 2026-11-03: «trebuie încă un field de „are kit"»), proven on real PostgreSQL
 * (PGlite): one column on the event's volunteers, `has_kit`, a boolean, not null, false by default — so every row from before reads
 * «no kit» and a row written without it too — and nothing else; the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0187_volunteer_has_kit";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000187";
const ANA = "cccccccc-0000-4000-8000-000000000187";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and numbered right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-has-kit-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // A volunteer as the release before wrote one.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_volunteers (id, event_id, name, state, source) VALUES ('${ANA}', '${EVENT}', 'Ana', 'CONFIRMED', 'STAFF');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0187_volunteer_has_kit", () => {
  it("reads every row from before as «no kit», and a row written without the column too", async () => {
    expect((await client.query(`SELECT id, has_kit FROM event_volunteers`)).rows).toEqual([{ id: ANA, has_kit: false }]);
    await client.exec(`INSERT INTO event_volunteers (event_id, name, state, source) VALUES ('${EVENT}', 'Ion', 'REGISTERED', 'STAFF')`);
    expect((await client.query(`SELECT has_kit FROM event_volunteers WHERE name = 'Ion'`)).rows).toEqual([{ has_kit: false }]);
  });

  it("is a boolean that refuses NULL", async () => {
    const [column] = (
      await client.query<{ data_type: string; is_nullable: string; column_default: string }>(
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'event_volunteers' AND column_name = 'has_kit'`,
      )
    ).rows;
    expect(column).toEqual({ data_type: "boolean", is_nullable: "NO", column_default: "false" });
    await expect(client.exec(`UPDATE event_volunteers SET has_kit = NULL WHERE id = '${ANA}'`)).rejects.toThrow();
  });

  it("is read by the checker as an expansion, adding the one column and nothing else", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    expect(sql.trim()).toBe('ALTER TABLE "event_volunteers" ADD COLUMN "has_kit" boolean DEFAULT false NOT NULL;');
  });
});
