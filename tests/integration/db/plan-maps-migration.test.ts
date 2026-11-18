import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0213_plan_maps` (§978 «Poze și hărți», amending §952; the owner, 2026-11-18: «sa pot pune mai multe poze, si
 * link-uri»), proven on real PostgreSQL (PGlite): two new tables — the plan's pictures and its links —, each cascading from
 * its event, with their checks; each event's one picture of the release before copied in at position 1 when it names a
 * stored picture that is no film's poster, so no plan loses its picture; the old column left where it was; and the file only
 * expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0213_plan_maps";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const WITH_PICTURE = "aaaaaaaa-0000-4000-8000-000000000213";
const WITH_POSTER = "aaaaaaaa-0001-4000-8000-000000000213";
const WITH_NOTHING_THERE = "aaaaaaaa-0002-4000-8000-000000000213";
const WITHOUT = "aaaaaaaa-0003-4000-8000-000000000213";
const PICTURE = "bbbbbbbb-0000-4000-8000-000000000213";
const POSTER = "bbbbbbbb-0001-4000-8000-000000000213";
const GONE = "bbbbbbbb-0002-4000-8000-000000000213";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and numbered right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "plan-maps-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // Four events as the release before wrote them: one plan with a stored picture, one whose id names a film's poster, one
  // whose id names a picture deleted by hand since (the column has no foreign key), and one with no picture.
  await client.exec(`
    INSERT INTO media_assets (id, key_prefix, original_filename, width, height, byte_size) VALUES
      ('${PICTURE}', 'v8-${PICTURE}', 'plan.png', 2400, 1600, 1000),
      ('${POSTER}', 'yt-dQw4w9WgXcQ', 'poster.jpg', 1280, 720, 1000);
    INSERT INTO events (id, type, starts_at, editorial_status, volunteer_plan_media_asset_id) VALUES
      ('${WITH_PICTURE}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT', '${PICTURE}'),
      ('${WITH_POSTER}', 'RACE', '2026-11-22T08:00:00Z', 'DRAFT', '${POSTER}'),
      ('${WITH_NOTHING_THERE}', 'RACE', '2026-11-23T08:00:00Z', 'DRAFT', '${GONE}'),
      ('${WITHOUT}', 'RACE', '2026-11-24T08:00:00Z', 'DRAFT', NULL);
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0213_plan_maps", () => {
  it("copies each plan's stored picture in at position 1 — never a film's poster or an id that names nothing — and leaves the column", async () => {
    expect((await client.query(`SELECT event_id, media_asset_id, position FROM event_volunteer_plan_pictures ORDER BY event_id`)).rows).toEqual([
      { event_id: WITH_PICTURE, media_asset_id: PICTURE, position: 1 },
    ]);
    expect((await client.query(`SELECT count(*)::int AS n FROM event_volunteer_plan_links`)).rows).toEqual([{ n: 0 }]);
    // Expand only: the column is still there, as it was.
    expect((await client.query(`SELECT id, volunteer_plan_media_asset_id FROM events ORDER BY id`)).rows).toEqual([
      { id: WITH_PICTURE, volunteer_plan_media_asset_id: PICTURE },
      { id: WITH_POSTER, volunteer_plan_media_asset_id: POSTER },
      { id: WITH_NOTHING_THERE, volunteer_plan_media_asset_id: GONE },
      { id: WITHOUT, volunteer_plan_media_asset_id: null },
    ]);
  });

  it("holds a picture once a plan, a position from 1, and a picture that is in the store", async () => {
    await expect(client.exec(`INSERT INTO event_volunteer_plan_pictures (event_id, media_asset_id, position) VALUES ('${WITH_PICTURE}', '${PICTURE}', 2)`)).rejects.toThrow();
    await expect(client.exec(`INSERT INTO event_volunteer_plan_pictures (event_id, media_asset_id, position) VALUES ('${WITHOUT}', '${PICTURE}', 0)`)).rejects.toThrow();
    await expect(client.exec(`INSERT INTO event_volunteer_plan_pictures (event_id, media_asset_id, position) VALUES ('${WITHOUT}', '${GONE}', 1)`)).rejects.toThrow();
    // Another plan may carry the same picture.
    await client.exec(`INSERT INTO event_volunteer_plan_pictures (event_id, media_asset_id, position) VALUES ('${WITHOUT}', '${PICTURE}', 1)`);
  });

  it("holds a link's address up to 2 000 characters and its label up to 120, or none", async () => {
    const url = `https://maps.example.test/${"a".repeat(2000 - 26)}`;
    expect(url).toHaveLength(2000);
    await client.exec(`INSERT INTO event_volunteer_plan_links (event_id, url, label, position) VALUES ('${WITHOUT}', '${url}', NULL, 1)`);
    await client.exec(`INSERT INTO event_volunteer_plan_links (event_id, url, label, position) VALUES ('${WITHOUT}', 'https://maps.example.test/x', '${"h".repeat(120)}', 2)`);
    await expect(client.exec(`INSERT INTO event_volunteer_plan_links (event_id, url, position) VALUES ('${WITHOUT}', '${url}b', 3)`)).rejects.toThrow();
    await expect(client.exec(`INSERT INTO event_volunteer_plan_links (event_id, url, label, position) VALUES ('${WITHOUT}', 'https://maps.example.test/y', '${"h".repeat(121)}', 3)`)).rejects.toThrow();
    await expect(client.exec(`INSERT INTO event_volunteer_plan_links (event_id, url, position) VALUES ('${WITHOUT}', 'https://maps.example.test/z', 0)`)).rejects.toThrow();
  });

  it("deletes an event's pictures and links with the event, and a picture's rows with the stored picture", async () => {
    await client.exec(`DELETE FROM events WHERE id = '${WITHOUT}'`);
    expect((await client.query(`SELECT count(*)::int AS n FROM event_volunteer_plan_links WHERE event_id = '${WITHOUT}'`)).rows).toEqual([{ n: 0 }]);
    expect((await client.query(`SELECT count(*)::int AS n FROM event_volunteer_plan_pictures WHERE event_id = '${WITHOUT}'`)).rows).toEqual([{ n: 0 }]);
    await client.exec(`DELETE FROM media_assets WHERE id = '${PICTURE}'`);
    expect((await client.query(`SELECT count(*)::int AS n FROM event_volunteer_plan_pictures`)).rows).toEqual([{ n: 0 }]);
  });

  it("is read by the checker as an expansion: two tables, their keys, their indexes and one copy, nothing taken away", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements.map((statement) => statement.split(/\s+/).slice(0, 3).join(" "))).toEqual([
      'CREATE TABLE "event_volunteer_plan_links"',
      'CREATE TABLE "event_volunteer_plan_pictures"',
      'ALTER TABLE "event_volunteer_plan_links"',
      'ALTER TABLE "event_volunteer_plan_pictures"',
      'ALTER TABLE "event_volunteer_plan_pictures"',
      "CREATE INDEX \"event_volunteer_plan_links_event_position_idx\"",
      "CREATE INDEX \"event_volunteer_plan_pictures_event_position_idx\"",
      'INSERT INTO "event_volunteer_plan_pictures"',
    ]);
    expect(sql).not.toMatch(/\bDROP\b|\bRENAME\b|DELETE FROM|UPDATE "events"/i);
  });
});
