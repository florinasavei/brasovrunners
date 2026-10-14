import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";
import { clockMinutes } from "@/modules/event-checkpoints/domain/checkpoint";
import { checkpointStart, minutesFromClock } from "@/modules/event-checkpoints/domain/start";
import { toWallTimeInput } from "@/modules/events/domain/zoned-time";

/**
 * Migrations `0156_direction_checkpoint_kind` and `0157_checkpoint_cutoff_minutes` (§NNN), proven on real
 * PostgreSQL (PGlite): the fifth kind is a value of the enum and no row written before it changes; a
 * cut-off written as a time of the day (§757) becomes minutes after the event's start — the gun on a race
 * that has one, else the event's start, on the event's own clock — with a point before and after the gun,
 * a night race that crosses midnight and an event whose start is not known, each answered as the
 * platform's one converter (`domain/start.ts#minutesFromClock`) answers it; the old column is left as it
 * was; the backfill is safe to run twice; the checks hold; and both files only expand.
 */
const MIGRATIONS = "src/db/migrations";
const ENUM_TAG = "0156_direction_checkpoint_kind";
const COLUMN_TAG = "0157_checkpoint_cutoff_minutes";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const id = (kind: number, n: number) => `${String(kind).repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
// The events (Bucharest, winter time: 09:00 on the clock is 07:00Z).
const GUN_RACE = id(1, 1); // start 09:00, gun 10:00, ends 12:30
const NO_GUN = id(1, 2); // start 09:00, no gun, ends 12:00
const NIGHT = id(1, 3); // gun 22:00, ends 06:00 the next day
const NO_HOUR = id(1, 4); // the start's hour is to be announced (§545): noon and one second
const UNDATED = id(1, 5); // the start's date is to be announced (§545)
const NO_END = id(1, 6); // gun 10:00, no end
const SUMMER = id(1, 7); // gun 10:00 summer time (UTC+3)

type Point = { event: string; name: string; km: number; cutoff: string | null };
const POINTS: Point[] = [
  { event: GUN_RACE, name: "before-gun", km: 3, cutoff: "09:30" },
  { event: GUN_RACE, name: "at-gun", km: 4, cutoff: "10:00" },
  { event: GUN_RACE, name: "after-gun", km: 6, cutoff: "10:45" },
  { event: GUN_RACE, name: "at-finish", km: 9, cutoff: "12:30" },
  { event: GUN_RACE, name: "no-limit", km: 10, cutoff: null },
  { event: NO_GUN, name: "from-start", km: 5, cutoff: "11:30" },
  { event: NO_GUN, name: "before-start", km: 6, cutoff: "08:59" },
  { event: NIGHT, name: "same-night", km: 5, cutoff: "23:30" },
  { event: NIGHT, name: "after-midnight", km: 9, cutoff: "02:00" },
  { event: NO_HOUR, name: "unknown-hour", km: 5, cutoff: "11:30" },
  { event: UNDATED, name: "unknown-date", km: 5, cutoff: "11:30" },
  { event: NO_END, name: "no-end", km: 5, cutoff: "12:00" },
  { event: NO_END, name: "no-end-before", km: 6, cutoff: "09:00" },
  { event: SUMMER, name: "summer", km: 5, cutoff: "11:15" },
];
const pointId = (index: number) => id(2, index + 1);

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const enumAt = journal.entries.findIndex((entry) => entry.tag === ENUM_TAG);
  expect(enumAt, "the journal lists the enum's migration").toBeGreaterThan(0);
  expect(journal.entries[enumAt + 1].tag).toBe(COLUMN_TAG);
  // Both sort after every migration before them (drizzle applies by `when`), in this order.
  expect(journal.entries[enumAt].when).toBeGreaterThan(journal.entries[enumAt - 1].when);
  expect(journal.entries[enumAt + 1].when).toBeGreaterThan(journal.entries[enumAt].when);
  expect(journal.entries[enumAt + 1].idx).toBe(journal.entries[enumAt].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "checkpoint-cutoff-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, enumAt) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The world as §757 left it: events of every kind of start, and checkpoints with a time of the day.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, race_starts_at, ends_at, timezone, editorial_status) VALUES
      ('${GUN_RACE}', 'RACE', '2026-11-21T07:00:00Z', '2026-11-21T08:00:00Z', '2026-11-21T10:30:00Z', 'Europe/Bucharest', 'DRAFT'),
      ('${NO_GUN}', 'RACE', '2026-11-21T07:00:00Z', NULL, '2026-11-21T10:00:00Z', 'Europe/Bucharest', 'DRAFT'),
      ('${NIGHT}', 'RACE', '2026-11-21T18:00:00Z', '2026-11-21T20:00:00Z', '2026-11-22T04:00:00Z', 'Europe/Bucharest', 'DRAFT'),
      ('${NO_HOUR}', 'RACE', '2026-11-21T10:00:01Z', NULL, NULL, 'Europe/Bucharest', 'DRAFT'),
      ('${UNDATED}', 'RACE', '9999-01-01T08:00:00Z', NULL, NULL, 'Europe/Bucharest', 'DRAFT'),
      ('${NO_END}', 'RACE', '2026-11-21T07:00:00Z', '2026-11-21T08:00:00Z', NULL, 'Europe/Bucharest', 'DRAFT'),
      ('${SUMMER}', 'RACE', '2026-07-18T06:00:00Z', '2026-07-18T07:00:00Z', '2026-07-18T09:00:00Z', 'Europe/Bucharest', 'DRAFT');
  `);
  for (const [index, point] of POINTS.entries()) {
    await client.query(
      `INSERT INTO event_checkpoints (id, event_id, position, name_ro, name_en, km, kinds, cutoff_time) VALUES ($1, $2, $3, $4, $4, $5, ARRAY['WATER']::event_checkpoint_kind[], $6)`,
      [pointId(index), point.event, index, point.name, point.km, point.cutoff],
    );
  }
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const minutesOf = async () => {
  const { rows } = await client.query<{ name_ro: string; cutoff_minutes: number | null; cutoff_time: string | null }>(
    `SELECT name_ro, cutoff_minutes, cutoff_time FROM event_checkpoints ORDER BY id`,
  );
  return Object.fromEntries(rows.map((row) => [row.name_ro, row]));
};

describe("migration 0156_direction_checkpoint_kind — the fifth kind", () => {
  it("makes DIRECTION a kind of the enum, after the four, and leaves every row written before it as it was", async () => {
    const { rows } = await client.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'event_checkpoint_kind' ORDER BY e.enumsortorder`,
    );
    expect(rows.map((row) => row.label)).toEqual(["WATER", "FOOD", "FIRST_AID", "TIMING", "DIRECTION"]);
    const { rows: kinds } = await client.query<{ kinds: string }>(`SELECT DISTINCT array_to_string(kinds, ',') AS kinds FROM event_checkpoints`);
    expect(kinds).toEqual([{ kinds: "WATER" }]);
  });

  it("takes the value in an array, beside the others, once the migration has run", async () => {
    await client.exec(
      `INSERT INTO event_checkpoints (id, event_id, position, name_ro, name_en, km, kinds) VALUES ('${id(3, 1)}', '${GUN_RACE}', 99, 'direction', 'direction', 11, ARRAY['WATER', 'DIRECTION']::event_checkpoint_kind[])`,
    );
    const { rows } = await client.query<{ kinds: string }>(`SELECT array_to_string(kinds, ',') AS kinds FROM event_checkpoints WHERE id = '${id(3, 1)}'`);
    expect(rows).toEqual([{ kinds: "WATER,DIRECTION" }]);
    await client.exec(`DELETE FROM event_checkpoints WHERE id = '${id(3, 1)}'`);
  });
});

describe("migration 0157_checkpoint_cutoff_minutes — the time of the day becomes minutes from the start", () => {
  it("counts a point after the gun from the gun, and leaves one before it, or at it, with no limit", async () => {
    const rows = await minutesOf();
    // The gun is at 10:00 on the event's clock.
    expect(rows["after-gun"].cutoff_minutes).toBe(45);
    expect(rows["at-finish"].cutoff_minutes).toBe(150);
    expect(rows["before-gun"].cutoff_minutes).toBeNull();
    expect(rows["at-gun"].cutoff_minutes).toBeNull();
    expect(rows["no-limit"].cutoff_minutes).toBeNull();
  });

  it("counts from the event's own start when the event has no gun, in its own zone", async () => {
    const rows = await minutesOf();
    expect(rows["from-start"].cutoff_minutes).toBe(150);
    expect(rows["before-start"].cutoff_minutes).toBeNull();
    // Summer time (UTC+3): the gun at 07:00Z is 10:00 on the clock, so 11:15 is 75 minutes after it.
    expect(rows.summer.cutoff_minutes).toBe(75);
  });

  it("counts across midnight for an event that runs past it, and only then", async () => {
    const rows = await minutesOf();
    // The gun at 22:00, the end at 06:00: 23:30 is an hour and a half in, 02:00 is four hours.
    expect(rows["same-night"].cutoff_minutes).toBe(90);
    expect(rows["after-midnight"].cutoff_minutes).toBe(240);
  });

  it("leaves a limit empty where the event's start has no hour or no date to count it from, and where the end is not known the next day is not assumed", async () => {
    const rows = await minutesOf();
    expect(rows["unknown-hour"].cutoff_minutes).toBeNull();
    expect(rows["unknown-date"].cutoff_minutes).toBeNull();
    // No end: the race is taken to end the day it starts, so 12:00 is two hours after the gun and 09:00 is before it.
    expect(rows["no-end"].cutoff_minutes).toBe(120);
    expect(rows["no-end-before"].cutoff_minutes).toBeNull();
  });

  it("answers every case as the platform's one converter does", async () => {
    const rows = await minutesOf();
    const { rows: events } = await client.query<{ id: string; type: string; starts_at: Date; race_starts_at: Date | null; ends_at: Date | null; timezone: string }>(
      `SELECT id, type, starts_at, race_starts_at, ends_at, timezone FROM events`,
    );
    const byId = new Map(events.map((event) => [event.id, event]));
    for (const point of POINTS) {
      if (point.cutoff === null) continue;
      const event = byId.get(point.event)!;
      const start = checkpointStart({ startsAt: event.starts_at, raceStartsAt: event.race_starts_at, timezone: event.timezone });
      const expected =
        start === null
          ? null
          : minutesFromClock(
              point.cutoff,
              clockMinutes(toWallTimeInput(start, event.timezone).slice(11, 16)),
              event.ends_at ? Math.round((event.ends_at.getTime() - start.getTime()) / 60_000) : null,
            );
      expect(rows[point.name].cutoff_minutes, point.name).toBe(expected);
    }
  });

  it("leaves the old column exactly as it was: nothing is dropped, rewritten or cleared", async () => {
    const rows = await minutesOf();
    for (const point of POINTS) expect(rows[point.name].cutoff_time, point.name).toBe(point.cutoff === null ? null : `${point.cutoff}:00`);
  });

  it("is idempotent: running the backfill again changes nothing, and fills only an empty value", async () => {
    const sql = readFileSync(`${MIGRATIONS}/${COLUMN_TAG}.sql`, "utf8");
    const statements = sql.split("--> statement-breakpoint").filter((part) => /UPDATE "event_checkpoints"/.test(part));
    expect(statements).toHaveLength(1);
    const before = await minutesOf();
    await client.exec(statements[0]);
    expect(await minutesOf()).toEqual(before);
    // A value the club has set since is never overwritten.
    await client.exec(`UPDATE event_checkpoints SET cutoff_minutes = 7 WHERE id = '${pointId(0)}'`);
    await client.exec(statements[0]);
    expect((await minutesOf())["before-gun"].cutoff_minutes).toBe(7);
    await client.exec(`UPDATE event_checkpoints SET cutoff_minutes = NULL WHERE id = '${pointId(0)}'`);
  });

  it("holds the check: a positive time of at most a week, or none", async () => {
    const update = (value: string) => client.exec(`UPDATE event_checkpoints SET cutoff_minutes = ${value} WHERE id = '${pointId(0)}'`);
    for (const bad of ["0", "-1", "10081"]) await expect(update(bad), bad).rejects.toThrow(/event_checkpoints_cutoff_minutes_range/);
    await update("10080");
    await update("1");
    await update("NULL");
  });

  it("only expands: a column added, a check added, a value added to an enum, and a backfill — nothing dropped or tightened", () => {
    for (const tag of [ENUM_TAG, COLUMN_TAG]) {
      const sql = readFileSync(`${MIGRATIONS}/${tag}.sql`, "utf8");
      expect(auditMigration(sql), tag).toMatchObject({ expands: true, contracts: false });
      expect(sql, tag).not.toMatch(/DROP |RENAME /i);
    }
    // The value is added in a file of its own and never used in it: PostgreSQL refuses a new enum value inside the transaction that adds it.
    expect(readFileSync(`${MIGRATIONS}/${ENUM_TAG}.sql`, "utf8")).toMatch(/^ALTER TYPE "public"\."event_checkpoint_kind" ADD VALUE 'DIRECTION';?\s*$/);
  });
});
