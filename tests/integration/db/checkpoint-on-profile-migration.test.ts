import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0164_checkpoint_on_profile` (§802), proven on real PostgreSQL (PGlite): `event_checkpoints.on_profile` is a
 * boolean the elevation profile reads, NOT NULL, true by default — so every checkpoint written before it stays on the chart
 * and a point added without saying is on it — and the file only expands (a column with a default never rewrites a reader).
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0164_checkpoint_on_profile";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "11111111-0000-4000-8000-000000000001";
const OLD = "22222222-0000-4000-8000-000000000001";
const NEW = "22222222-0000-4000-8000-000000000002";
const OFF = "22222222-0000-4000-8000-000000000003";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const at = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(at, "the journal lists the migration").toBeGreaterThan(0);
  // It sorts after every migration before it — drizzle applies by `when` — and is the next number after the last shipped one.
  expect(journal.entries[at].when).toBeGreaterThan(journal.entries[at - 1].when);
  expect(journal.entries[at].idx).toBe(journal.entries[at - 1].idx + 1);
  expect(journal.entries[at - 1].tag.slice(0, 4)).toBe("0163");

  folder = mkdtempSync(path.join(tmpdir(), "checkpoint-on-profile-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The world as 0163 left it: a race with a checkpoint on it.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, timezone, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T07:00:00Z', 'Europe/Bucharest', 'DRAFT');
    INSERT INTO event_checkpoints (id, event_id, position, name_ro, name_en, km, kinds) VALUES ('${OLD}', '${EVENT}', 0, 'Vechi', 'Old', 3, ARRAY['WATER']::event_checkpoint_kind[]);
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const onProfile = async (id: string) => (await client.query<{ on_profile: boolean }>(`SELECT on_profile FROM event_checkpoints WHERE id = '${id}'`)).rows[0]?.on_profile;

describe("migration 0164_checkpoint_on_profile — the tick on each point", () => {
  it("adds the column NOT NULL with a default of true", async () => {
    const { rows } = await client.query<{ data_type: string; is_nullable: string; column_default: string }>(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'event_checkpoints' AND column_name = 'on_profile'`,
    );
    expect(rows).toEqual([{ data_type: "boolean", is_nullable: "NO", column_default: "true" }]);
  });

  it("leaves a point written before it on the chart", async () => {
    expect(await onProfile(OLD)).toBe(true);
  });

  it("puts a point added without the column on the chart, and keeps one the club unticks off it", async () => {
    await client.exec(`
      INSERT INTO event_checkpoints (id, event_id, position, name_ro, name_en, km, kinds) VALUES ('${NEW}', '${EVENT}', 1, 'Nou', 'New', 5, ARRAY['FOOD']::event_checkpoint_kind[]);
      INSERT INTO event_checkpoints (id, event_id, position, name_ro, name_en, km, kinds, on_profile) VALUES ('${OFF}', '${EVENT}', 2, 'Ascuns', 'Hidden', 7, ARRAY[]::event_checkpoint_kind[], false);
    `);
    expect(await onProfile(NEW)).toBe(true);
    expect(await onProfile(OFF)).toBe(false);
  });

  it("refuses a missing value: the column is never null", async () => {
    await expect(client.exec(`UPDATE event_checkpoints SET on_profile = NULL WHERE id = '${OLD}'`)).rejects.toThrow();
  });

  it("is an expand: one column with a default, nothing dropped or rewritten", async () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(sql.trim()).toBe(`ALTER TABLE "event_checkpoints" ADD COLUMN "on_profile" boolean DEFAULT true NOT NULL;`);
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
  });
});
