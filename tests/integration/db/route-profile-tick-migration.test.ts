import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0165_route_profile_tick` (§802, §NNN), proven on real PostgreSQL (PGlite): `events.show_route_profile` is the
 * event's own «Arată profilul traseului pe pagină», a boolean NOT NULL that is true by default — so every event that had a GPX
 * before it keeps its chart and a new one starts with the chart on — and the file only expands (a column with a default never
 * rewrites a reader).
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0165_route_profile_tick";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const OLD = "11111111-0000-4000-8000-000000000001";
const NEW = "11111111-0000-4000-8000-000000000002";
const OFF = "11111111-0000-4000-8000-000000000003";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const at = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(at, "the journal lists the migration").toBeGreaterThan(0);
  // It sorts after every migration before it — drizzle applies by `when` — and is the next number after the last shipped one.
  expect(journal.entries[at].when).toBeGreaterThan(journal.entries[at - 1].when);
  expect(journal.entries[at].idx).toBe(journal.entries[at - 1].idx + 1);
  expect(journal.entries[at - 1].tag.slice(0, 4)).toBe("0164");

  folder = mkdtempSync(path.join(tmpdir(), "route-profile-tick-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The world as 0164 left it: a race with a GPX on it.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, timezone, editorial_status, route_gpx)
    VALUES ('${OLD}', 'RACE', '2026-11-21T07:00:00Z', 'Europe/Bucharest', 'DRAFT', '{"key":"test/route-gpx/0123abcd-0123-4abc-8def-0123456789ab/t.gpx","name":"t.gpx","size":1,"uploadedAt":"2026-10-01T00:00:00.000Z"}'::jsonb);
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const shown = async (id: string) => (await client.query<{ show_route_profile: boolean }>(`SELECT show_route_profile FROM events WHERE id = '${id}'`)).rows[0]?.show_route_profile;

describe("migration 0165_route_profile_tick — the event's tick for the profile", () => {
  it("adds the column NOT NULL with a default of true", async () => {
    const { rows } = await client.query<{ data_type: string; is_nullable: string; column_default: string }>(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'show_route_profile'`,
    );
    expect(rows).toEqual([{ data_type: "boolean", is_nullable: "NO", column_default: "true" }]);
  });

  it("leaves an event written before it with its chart on", async () => {
    expect(await shown(OLD)).toBe(true);
  });

  it("starts an event added without the column on, and keeps one the club unticks off", async () => {
    await client.exec(`
      INSERT INTO events (id, type, starts_at, timezone, editorial_status) VALUES ('${NEW}', 'RACE', '2026-12-05T07:00:00Z', 'Europe/Bucharest', 'DRAFT');
      INSERT INTO events (id, type, starts_at, timezone, editorial_status, show_route_profile) VALUES ('${OFF}', 'RACE', '2026-12-12T07:00:00Z', 'Europe/Bucharest', 'DRAFT', false);
    `);
    expect(await shown(NEW)).toBe(true);
    expect(await shown(OFF)).toBe(false);
  });

  it("refuses a missing value: the column is never null", async () => {
    await expect(client.exec(`UPDATE events SET show_route_profile = NULL WHERE id = '${OLD}'`)).rejects.toThrow();
  });

  it("is an expand: one column with a default, nothing dropped or rewritten", async () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(sql.trim()).toBe(`ALTER TABLE "events" ADD COLUMN "show_route_profile" boolean DEFAULT true NOT NULL;`);
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
  });
});
