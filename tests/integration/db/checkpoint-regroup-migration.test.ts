import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";
import { CHECKPOINT_KINDS } from "@/modules/event-checkpoints/domain/checkpoint";

/**
 * Migration `0174_checkpoint_regroup` (§824), proven on real PostgreSQL (PGlite): «Regrupare» is the sixth value of the
 * `event_checkpoint_kind` enum, after the five; every checkpoint written before it reads back as it was; the value
 * takes its place in an array beside the others; and the file only expands (one `ADD VALUE`, never used in the file
 * that adds it — PostgreSQL refuses that inside the transaction).
 *
 * The chain is checked as well, because a migration generated while a sibling's was still moving was the one thing a
 * batch landing found broken (BR-V3.59): the entry follows the journal's last one by one index with a later `when`, and
 * its snapshot continues the previous snapshot — its `prevId` is that snapshot's `id`, and the two differ in this value
 * alone.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0174_checkpoint_regroup";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };
type Snapshot = { id: string; prevId: string; enums: Record<string, { values: string[] }> };

const EVENT = "11111111-0000-4000-8000-000000000001";
const OLD_POINT = "22222222-0000-4000-8000-000000000001";
const NEW_POINT = "22222222-0000-4000-8000-000000000002";

let client: PGlite;
let folder: string;
let journal: Journal;
let at: number;

beforeAll(async () => {
  journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  at = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(at, "the journal lists the migration").toBeGreaterThan(0);

  folder = mkdtempSync(path.join(tmpdir(), "checkpoint-regroup-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The world as the migration before it left it: a race with a checkpoint that is a water point and a junction.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, timezone, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T07:00:00Z', 'Europe/Bucharest', 'DRAFT');
    INSERT INTO event_checkpoints (id, event_id, position, name_ro, name_en, km, kinds)
      VALUES ('${OLD_POINT}', '${EVENT}', 0, 'Apă', 'Water', 5, ARRAY['WATER', 'DIRECTION']::event_checkpoint_kind[]);
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const labels = async () =>
  (
    await client.query<{ label: string }>(
      `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'event_checkpoint_kind' ORDER BY e.enumsortorder`,
    )
  ).rows.map((row) => row.label);

const kindsOf = async (id: string) => (await client.query<{ kinds: string }>(`SELECT array_to_string(kinds, ',') AS kinds FROM event_checkpoints WHERE id = '${id}'`)).rows[0]?.kinds;

describe("migration 0174_checkpoint_regroup — the sixth kind", () => {
  it("makes REGROUP the last value of the enum, in the order the code lists the kinds", async () => {
    expect(await labels()).toEqual(["WATER", "FOOD", "FIRST_AID", "TIMING", "DIRECTION", "REGROUP"]);
    expect(await labels()).toEqual([...CHECKPOINT_KINDS]);
  });

  it("leaves a checkpoint written before it as it was", async () => {
    expect(await kindsOf(OLD_POINT)).toBe("WATER,DIRECTION");
  });

  it("takes the value in an array, beside the others, and alone", async () => {
    await client.exec(`
      INSERT INTO event_checkpoints (id, event_id, position, name_ro, name_en, km, kinds)
        VALUES ('${NEW_POINT}', '${EVENT}', 1, 'Regrupare', 'Regroup', 9, ARRAY['REGROUP', 'WATER']::event_checkpoint_kind[]);
    `);
    expect(await kindsOf(NEW_POINT)).toBe("REGROUP,WATER");
    await client.exec(`UPDATE event_checkpoints SET kinds = ARRAY['REGROUP']::event_checkpoint_kind[] WHERE id = '${NEW_POINT}'`);
    expect(await kindsOf(NEW_POINT)).toBe("REGROUP");
  });

  it("still refuses a value the enum does not have", async () => {
    await expect(client.exec(`UPDATE event_checkpoints SET kinds = ARRAY['REGATHER']::event_checkpoint_kind[] WHERE id = '${OLD_POINT}'`)).rejects.toThrow();
  });

  it("is an expand: one ADD VALUE, nothing dropped, renamed or used in the same file", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(sql.trim()).toBe(`ALTER TYPE "public"."event_checkpoint_kind" ADD VALUE 'REGROUP';`);
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
  });

  it("is the next entry of the journal, after a later `when`, and its snapshot continues the previous one", () => {
    const entry = journal.entries[at];
    const before = journal.entries[at - 1];
    expect(entry.idx).toBe(before.idx + 1);
    expect(entry.when).toBeGreaterThan(before.when);
    const snapshot = (tag: string) => JSON.parse(readFileSync(`${MIGRATIONS}/meta/${tag.slice(0, 4)}_snapshot.json`, "utf8")) as Snapshot;
    const mine = snapshot(entry.tag);
    const previous = snapshot(before.tag);
    expect(mine.prevId).toBe(previous.id);
    expect(mine.id).not.toBe(previous.id);
    expect(mine.enums["public.event_checkpoint_kind"].values).toEqual([...previous.enums["public.event_checkpoint_kind"].values, "REGROUP"]);
    // Nothing else changed: the two snapshots are the same but for the ids and this one value.
    const strip = (value: Snapshot) => JSON.stringify({ ...value, id: "", prevId: "", enums: { ...value.enums, "public.event_checkpoint_kind": { name: "", schema: "", values: [] } } });
    expect(strip(mine)).toBe(strip(previous));
  });
});
