import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * The migration of the moment a point's «Notă pentru voluntari» last changed (§NNN, amending §1009: a changed note is told again to
 * whoever was told the point before it), proven on real PostgreSQL (PGlite), on a database migrated by the release before: one
 * nullable column, `event_checkpoints.volunteer_note_changed_at`, absent on every row from before — a note written before this
 * release included: nobody is told again for it — and on a row written without it. The file only expands.
 *
 * The migration is found by its name, not its number: a batch numbers its branches' migrations when it lands them, and the
 * number this branch was given may be another by then.
 */
const MIGRATIONS = "src/db/migrations";
const NAME = "_plan_point_volunteer_note_changed";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000223";
const WATER = "bbbbbbbb-0000-4000-8000-000000000223";
const KITS = "bbbbbbbb-0001-4000-8000-000000000223";

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

  folder = mkdtempSync(path.join(tmpdir(), "plan-point-note-changed-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // An editor's point whose note the organizers wrote under the release before, and a start–finish point of the plan's own with none.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_checkpoints (id, event_id, position, name_ro, name_en, km, kinds, volunteer_note_ro, volunteer_note_en)
      VALUES ('${WATER}', '${EVENT}', 0, 'Apă la cabană', 'Water at the hut', 5.5, '{WATER}', 'Umpleți paharele.', 'Fill the cups.');
    INSERT INTO event_checkpoints (id, event_id, name_ro, name_en, km, on_profile, plan_only, start_finish)
      VALUES ('${KITS}', '${EVENT}', 'Kituri', 'Kituri', 0, false, true, true);
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const changedAt = async (where: string) =>
  (await client.query<{ name_ro: string; volunteer_note_changed_at: Date | null }>(`SELECT name_ro, volunteer_note_changed_at FROM event_checkpoints WHERE ${where} ORDER BY name_ro`)).rows;

describe("the migration of the moment a point's note last changed", () => {
  it("leaves every point from before with no moment — a note written before it included — and everything else as it was", async () => {
    expect(await changedAt(`event_id = '${EVENT}'`)).toEqual([
      { name_ro: "Apă la cabană", volunteer_note_changed_at: null },
      { name_ro: "Kituri", volunteer_note_changed_at: null },
    ]);
    const [water] = (await client.query(`SELECT volunteer_note_ro, volunteer_note_en, km::text AS km FROM event_checkpoints WHERE id = '${WATER}'`)).rows;
    expect(water).toEqual({ volunteer_note_ro: "Umpleți paharele.", volunteer_note_en: "Fill the cups.", km: "5.50" });
  });

  it("adds one nullable timestamp with its time zone and no default, and a row written without it — the editor's insert, an import's, a copy's — has none", async () => {
    const columns = (
      await client.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_name = 'event_checkpoints' AND column_name = 'volunteer_note_changed_at'`,
      )
    ).rows;
    expect(columns).toEqual([{ column_name: "volunteer_note_changed_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null }]);
    await client.exec(`INSERT INTO event_checkpoints (event_id, name_ro, name_en, km) VALUES ('${EVENT}', 'Sosire', 'Finish', 10)`);
    expect(await changedAt(`name_ro = 'Sosire'`)).toEqual([{ name_ro: "Sosire", volunteer_note_changed_at: null }]);
  });

  it("takes the moment of a save, and loses it again with nothing else", async () => {
    await client.exec(`UPDATE event_checkpoints SET volunteer_note_changed_at = '2026-11-20T09:30:00Z' WHERE id = '${WATER}'`);
    expect((await changedAt(`id = '${WATER}'`))[0].volunteer_note_changed_at).toEqual(new Date("2026-11-20T09:30:00Z"));
    await client.exec(`UPDATE event_checkpoints SET volunteer_note_changed_at = NULL WHERE id = '${WATER}'`);
    expect((await changedAt(`id = '${WATER}'`))[0].volunteer_note_changed_at).toBeNull();
  });

  it("is read by the checker as an expansion: one column, nothing taken away and nothing backfilled", () => {
    const sql = readFileSync(`${MIGRATIONS}/${tag}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual(['ALTER TABLE "event_checkpoints" ADD COLUMN "volunteer_note_changed_at" timestamp with time zone;']);
    expect(sql).not.toMatch(/\bUPDATE\b|\bDROP\b|\bRENAME\b|\bDEFAULT\b/i);
  });
});
