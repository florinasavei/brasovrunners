import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * The migration of «Notă pentru voluntari» (§NNN; the owner, 2026-11-19, of «Planul voluntarilor»: «si am nevoie de un nou field
 * "noua pentru voluntari"»), proven on real PostgreSQL (PGlite), on a database migrated by the release before: two columns on a
 * route's points — `volunteer_note_ro` and `volunteer_note_en`, absent on every row from before and on a row written without them
 * — and the check that holds them to both languages or neither, each 1 to 500 characters. The file only expands.
 *
 * The migration is found by its name, not its number: a batch numbers its branches' migrations when it lands them, and the
 * number this branch was given may be another by then.
 */
const MIGRATIONS = "src/db/migrations";
const NAME = "_plan_point_volunteer_note";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000221";
const WATER = "bbbbbbbb-0000-4000-8000-000000000221";
const KITS = "bbbbbbbb-0001-4000-8000-000000000221";

let client: PGlite;
let folder: string;
let tag: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag.endsWith(NAME));
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  tag = journal.entries[position].tag;
  // Sorts after every migration before it (drizzle applies by `when`), numbered right after the one it follows.
  const before = journal.entries[position - 1];
  expect(journal.entries[position].when).toBeGreaterThan(before.when);
  expect(journal.entries[position].idx).toBe(before.idx + 1);
  expect(Number(tag.slice(0, 4))).toBe(Number(before.tag.slice(0, 4)) + 1);

  folder = mkdtempSync(path.join(tmpdir(), "plan-point-note-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // An editor's point with everything the editor can say of it, and a start–finish point of the plan's own with coordinates —
  // as the release before wrote them.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_checkpoints (id, event_id, position, name_ro, name_en, km, kinds, cutoff_minutes, note_ro, note_en, on_profile)
      VALUES ('${WATER}', '${EVENT}', 0, 'Apă la cabană', 'Water at the hut', 5.5, '{WATER}', 90, 'Pahare', 'Cups', true);
    INSERT INTO event_checkpoints (id, event_id, name_ro, name_en, km, on_profile, plan_only, start_finish, latitude, longitude)
      VALUES ('${KITS}', '${EVENT}', 'Kituri', 'Kituri', 0, false, true, true, 45.64271, 25.58871);
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

type Note = { volunteer_note_ro: string | null; volunteer_note_en: string | null };
const noteOf = async (where: string) => (await client.query<Note>(`SELECT volunteer_note_ro, volunteer_note_en FROM event_checkpoints WHERE ${where} ORDER BY name_ro`)).rows;
const NONE: Note = { volunteer_note_ro: null, volunteer_note_en: null };

describe("the migration of «Notă pentru voluntari»", () => {
  it("leaves every point from before with no note — and everything else of it as it was", async () => {
    expect(await noteOf(`event_id = '${EVENT}'`)).toEqual([NONE, NONE]);
    const [water] = (await client.query(`SELECT name_ro, km::text AS km, cutoff_minutes, note_ro, note_en, on_profile FROM event_checkpoints WHERE id = '${WATER}'`)).rows;
    expect(water).toEqual({ name_ro: "Apă la cabană", km: "5.50", cutoff_minutes: 90, note_ro: "Pahare", note_en: "Cups", on_profile: true });
    const [kits] = (await client.query(`SELECT plan_only, start_finish, latitude::text AS latitude FROM event_checkpoints WHERE id = '${KITS}'`)).rows;
    expect(kits).toEqual({ plan_only: true, start_finish: true, latitude: "45.642710" });
  });

  it("adds two nullable text columns, and a row written without them — the editor's insert, an import's, a copy's — has none", async () => {
    const columns = (
      await client.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_name = 'event_checkpoints' AND column_name IN ('volunteer_note_ro', 'volunteer_note_en') ORDER BY column_name`,
      )
    ).rows;
    expect(columns).toEqual([
      { column_name: "volunteer_note_en", data_type: "text", is_nullable: "YES", column_default: null },
      { column_name: "volunteer_note_ro", data_type: "text", is_nullable: "YES", column_default: null },
    ]);
    await client.exec(`INSERT INTO event_checkpoints (event_id, name_ro, name_en, km) VALUES ('${EVENT}', 'Sosire', 'Finish', 10)`);
    expect(await noteOf(`name_ro = 'Sosire'`)).toEqual([NONE]);
  });

  it("takes a note in both languages on any point, its line breaks kept, up to 500 characters each — and taken off again", async () => {
    await client.query(`UPDATE event_checkpoints SET volunteer_note_ro = $1, volunteer_note_en = $2 WHERE id = '${WATER}'`, ["Umpleți paharele.\nVesta reflectorizantă.", "Fill the cups.\nThe reflective vest."]);
    await client.query(`UPDATE event_checkpoints SET volunteer_note_ro = $1, volunteer_note_en = $2 WHERE id = '${KITS}'`, ["a".repeat(500), `${"e".repeat(499)}🏃`]);
    expect(await noteOf(`id = '${WATER}'`)).toEqual([{ volunteer_note_ro: "Umpleți paharele.\nVesta reflectorizantă.", volunteer_note_en: "Fill the cups.\nThe reflective vest." }]);
    expect((await noteOf(`id = '${KITS}'`))[0].volunteer_note_ro).toHaveLength(500);
    await client.exec(`UPDATE event_checkpoints SET volunteer_note_ro = NULL, volunteer_note_en = NULL WHERE id = '${KITS}'`);
    expect(await noteOf(`id = '${KITS}'`)).toEqual([NONE]);
  });

  it("refuses a note in one language alone, an empty one and one past 500 characters in either language", async () => {
    for (const [ro, en] of [
      ["'Doar în română'", "NULL"],
      ["NULL", "'Only in English'"],
      ["''", "''"],
      ["'Ceva'", "''"],
      [`'${"a".repeat(501)}'`, "'e'"],
      ["'a'", `'${"e".repeat(501)}'`],
    ]) {
      await expect(client.exec(`UPDATE event_checkpoints SET volunteer_note_ro = ${ro}, volunteer_note_en = ${en} WHERE id = '${KITS}'`), `${ro.slice(0, 12)} / ${en.slice(0, 12)}`).rejects.toThrow(
        /event_checkpoints_volunteer_note_both_languages/,
      );
    }
    expect(await noteOf(`id = '${KITS}'`)).toEqual([NONE]);
  });

  it("is read by the checker as an expansion: two columns and a check, nothing taken away and nothing backfilled", () => {
    const sql = readFileSync(`${MIGRATIONS}/${tag}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual([
      'ALTER TABLE "event_checkpoints" ADD COLUMN "volunteer_note_ro" text;',
      'ALTER TABLE "event_checkpoints" ADD COLUMN "volunteer_note_en" text;',
      'ALTER TABLE "event_checkpoints" ADD CONSTRAINT "event_checkpoints_volunteer_note_both_languages" CHECK (("event_checkpoints"."volunteer_note_ro" IS NULL) = ("event_checkpoints"."volunteer_note_en" IS NULL) AND ("event_checkpoints"."volunteer_note_ro" IS NULL OR (char_length("event_checkpoints"."volunteer_note_ro") BETWEEN 1 AND 500 AND char_length("event_checkpoints"."volunteer_note_en") BETWEEN 1 AND 500)));',
    ]);
    expect(sql).not.toMatch(/\bUPDATE\b|\bDROP\b|\bRENAME\b/i);
  });
});
