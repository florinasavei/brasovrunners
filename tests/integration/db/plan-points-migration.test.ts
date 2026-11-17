import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0211_plan_points` (§NNN; the owner, 2026-11-17: «vreau să pot defini punctele de mână, să pun nume punct și la ce
 * km e și coordonate punct» — «Practic voluntarii sunt de 2 tipuri: start-finish și pe traseu»), proven on real PostgreSQL
 * (PGlite), on a database migrated by the release before: four columns on a route's points — `plan_only` and `start_finish`,
 * false for every row from before and for a row written without them, and `latitude` and `longitude`, absent until somebody
 * types them — and the three checks: a start–finish point is a plan-only one, the coordinates are both there or both absent,
 * and each is within what a latitude and a longitude can be. The file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0211_plan_points";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000211";
const WATER = "bbbbbbbb-0000-4000-8000-000000000211";
const BRIDGE = "bbbbbbbb-0001-4000-8000-000000000211";
const ANA = "cccccccc-0000-4000-8000-000000000211";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), numbered right after the one it follows — `0210`.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);
  expect(journal.entries[position - 1].tag).toMatch(/^0210_/);

  folder = mkdtempSync(path.join(tmpdir(), "plan-points-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // Two points of a route, one with everything the editor can say of it, and a volunteer standing at one — as the release before wrote them.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_checkpoints (id, event_id, position, name_ro, name_en, km, kinds, cutoff_minutes, note_ro, note_en, on_profile)
      VALUES ('${WATER}', '${EVENT}', 0, 'Apă la cabană', 'Water at the hut', 5.5, '{WATER,FOOD}', 90, 'Pahare', 'Cups', false);
    INSERT INTO event_checkpoints (id, event_id, name_ro, name_en, km) VALUES ('${BRIDGE}', '${EVENT}', 'Podul de lemn', 'The wooden bridge', 7.25);
    INSERT INTO event_volunteers (id, event_id, name, state, source, checkpoint_id) VALUES ('${ANA}', '${EVENT}', 'Ana', 'CONFIRMED', 'STAFF', '${WATER}');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

type Flags = { plan_only: boolean; start_finish: boolean; latitude: string | null; longitude: string | null };
const flagsOf = async (where: string) => (await client.query<Flags>(`SELECT plan_only, start_finish, latitude, longitude FROM event_checkpoints WHERE ${where}`)).rows;
const EDITORS: Flags = { plan_only: false, start_finish: false, latitude: null, longitude: null };

describe("migration 0211_plan_points", () => {
  it("reads every point from before as the editor's own, on the route, with no coordinates — and keeps everything else of it", async () => {
    expect(await flagsOf(`event_id = '${EVENT}'`)).toEqual([EDITORS, EDITORS]);
    const [water] = (
      await client.query(
        `SELECT name_ro, name_en, km::text AS km, kinds::text AS kinds, cutoff_minutes, note_ro, note_en, on_profile, position FROM event_checkpoints WHERE id = '${WATER}'`,
      )
    ).rows;
    expect(water).toEqual({ name_ro: "Apă la cabană", name_en: "Water at the hut", km: "5.50", kinds: "{WATER,FOOD}", cutoff_minutes: 90, note_ro: "Pahare", note_en: "Cups", on_profile: false, position: 0 });
    // The volunteer who stood there still does.
    expect((await client.query(`SELECT checkpoint_id FROM event_volunteers WHERE id = '${ANA}'`)).rows).toEqual([{ checkpoint_id: WATER }]);
  });

  it("gives a row written without the columns — the editor's insert, an import's, a copy's — the same", async () => {
    await client.exec(`INSERT INTO event_checkpoints (event_id, name_ro, name_en, km) VALUES ('${EVENT}', 'Sosire', 'Finish', 10)`);
    expect(await flagsOf(`name_ro = 'Sosire'`)).toEqual([EDITORS]);
  });

  it("adds two flags that are never null and default to false, and two nullable coordinates of six decimals", async () => {
    const columns = (
      await client.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null; numeric_precision: number | null; numeric_scale: number | null }>(
        `SELECT column_name, data_type, is_nullable, column_default, numeric_precision, numeric_scale FROM information_schema.columns
         WHERE table_name = 'event_checkpoints' AND column_name IN ('plan_only', 'start_finish', 'latitude', 'longitude') ORDER BY column_name`,
      )
    ).rows;
    expect(columns).toEqual([
      { column_name: "latitude", data_type: "numeric", is_nullable: "YES", column_default: null, numeric_precision: 8, numeric_scale: 6 },
      { column_name: "longitude", data_type: "numeric", is_nullable: "YES", column_default: null, numeric_precision: 9, numeric_scale: 6 },
      { column_name: "plan_only", data_type: "boolean", is_nullable: "NO", column_default: "false", numeric_precision: null, numeric_scale: null },
      { column_name: "start_finish", data_type: "boolean", is_nullable: "NO", column_default: "false", numeric_precision: null, numeric_scale: null },
    ]);
  });

  it("takes a plan-only point of each kind, and coordinates on any point — kept to six decimals", async () => {
    await client.exec(`
      INSERT INTO event_checkpoints (event_id, name_ro, name_en, km, on_profile, plan_only) VALUES ('${EVENT}', 'Intersecția de la izvor', 'Intersecția de la izvor', 3.2, false, true);
      INSERT INTO event_checkpoints (event_id, name_ro, name_en, km, on_profile, plan_only, start_finish, latitude, longitude)
        VALUES ('${EVENT}', 'Kituri', 'Kituri', 0, false, true, true, 45.64271, 25.58871);
      UPDATE event_checkpoints SET latitude = -45.1234567, longitude = 179.9999994 WHERE id = '${BRIDGE}';
    `);
    expect(await flagsOf(`name_ro = 'Intersecția de la izvor'`)).toEqual([{ plan_only: true, start_finish: false, latitude: null, longitude: null }]);
    expect(await flagsOf(`name_ro = 'Kituri'`)).toEqual([{ plan_only: true, start_finish: true, latitude: "45.642710", longitude: "25.588710" }]);
    // An editor's point may have them too; the seventh decimal is rounded away.
    expect(await flagsOf(`id = '${BRIDGE}'`)).toEqual([{ plan_only: false, start_finish: false, latitude: "-45.123457", longitude: "179.999999" }]);
    // The ends of both ranges are places.
    await client.exec(`UPDATE event_checkpoints SET latitude = 90, longitude = -180 WHERE id = '${BRIDGE}'`);
    await client.exec(`UPDATE event_checkpoints SET latitude = -90, longitude = 180 WHERE id = '${BRIDGE}'`);
    await client.exec(`UPDATE event_checkpoints SET latitude = NULL, longitude = NULL WHERE id = '${BRIDGE}'`);
  });

  it("refuses a start–finish point that is not plan-only: an insert, and an editor's point turned into one", async () => {
    await expect(
      client.exec(`INSERT INTO event_checkpoints (event_id, name_ro, name_en, km, start_finish) VALUES ('${EVENT}', 'Start', 'Start', 0, true)`),
    ).rejects.toThrow(/event_checkpoints_start_finish_plan_only/);
    await expect(client.exec(`UPDATE event_checkpoints SET start_finish = true WHERE id = '${WATER}'`)).rejects.toThrow(/event_checkpoints_start_finish_plan_only/);
    // …and a start–finish point made public again without its kind.
    await expect(client.exec(`UPDATE event_checkpoints SET plan_only = false WHERE name_ro = 'Kituri'`)).rejects.toThrow(/event_checkpoints_start_finish_plan_only/);
    expect(await flagsOf(`id = '${WATER}'`)).toEqual([EDITORS]);
  });

  it("refuses half a pair of coordinates, whichever half", async () => {
    await expect(client.exec(`UPDATE event_checkpoints SET latitude = 45.64271 WHERE id = '${WATER}'`)).rejects.toThrow(/event_checkpoints_coordinates_pair/);
    await expect(client.exec(`UPDATE event_checkpoints SET longitude = 25.58871 WHERE id = '${WATER}'`)).rejects.toThrow(/event_checkpoints_coordinates_pair/);
    await expect(
      client.exec(`INSERT INTO event_checkpoints (event_id, name_ro, name_en, km, plan_only, latitude) VALUES ('${EVENT}', 'Jumătate', 'Jumătate', 1, true, 45.64271)`),
    ).rejects.toThrow(/event_checkpoints_coordinates_pair/);
    expect(await flagsOf(`id = '${WATER}'`)).toEqual([EDITORS]);
  });

  it("refuses a latitude past ±90 and a longitude past ±180", async () => {
    for (const [latitude, longitude] of [
      ["90.000001", "25.58871"],
      ["-90.5", "25.58871"],
      ["45.64271", "180.000001"],
      ["45.64271", "-180.5"],
    ]) {
      await expect(client.exec(`UPDATE event_checkpoints SET latitude = ${latitude}, longitude = ${longitude} WHERE id = '${WATER}'`), `${latitude}, ${longitude}`).rejects.toThrow(
        /event_checkpoints_coordinates_range/,
      );
    }
    // A number the column cannot even hold is refused before the check is asked.
    await expect(client.exec(`UPDATE event_checkpoints SET latitude = 145.64271, longitude = 25.58871 WHERE id = '${WATER}'`)).rejects.toThrow();
    expect(await flagsOf(`id = '${WATER}'`)).toEqual([EDITORS]);
  });

  it("is read by the checker as an expansion: four columns and three checks, nothing taken away and nothing backfilled", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual([
      'ALTER TABLE "event_checkpoints" ADD COLUMN "plan_only" boolean DEFAULT false NOT NULL;',
      'ALTER TABLE "event_checkpoints" ADD COLUMN "start_finish" boolean DEFAULT false NOT NULL;',
      'ALTER TABLE "event_checkpoints" ADD COLUMN "latitude" numeric(8, 6);',
      'ALTER TABLE "event_checkpoints" ADD COLUMN "longitude" numeric(9, 6);',
      'ALTER TABLE "event_checkpoints" ADD CONSTRAINT "event_checkpoints_start_finish_plan_only" CHECK (NOT "event_checkpoints"."start_finish" OR "event_checkpoints"."plan_only");',
      'ALTER TABLE "event_checkpoints" ADD CONSTRAINT "event_checkpoints_coordinates_pair" CHECK (("event_checkpoints"."latitude" IS NULL) = ("event_checkpoints"."longitude" IS NULL));',
      'ALTER TABLE "event_checkpoints" ADD CONSTRAINT "event_checkpoints_coordinates_range" CHECK (("event_checkpoints"."latitude" IS NULL OR "event_checkpoints"."latitude" BETWEEN -90 AND 90) AND ("event_checkpoints"."longitude" IS NULL OR "event_checkpoints"."longitude" BETWEEN -180 AND 180));',
    ]);
    expect(sql).not.toMatch(/\bUPDATE\b|\bDROP\b|\bRENAME\b/i);
  });
});
