import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0151_volunteer_profile_fields` (§765, amending §754 and §761), proven on real PostgreSQL (PGlite): a role
 * written before it — a one-line `description_ro` / `description_en` — becomes a one-paragraph document with its plain
 * words per language, only where there are words; the old columns stay untouched; a volunteer listed before it has no
 * age, sex, city or size and has not volunteered before nor belongs to the group; an event gives no T-shirts; the
 * checks hold (an age in range, a city of at most 80 characters, a size that is a size, a description's words with
 * their document, at most 2000 characters); the backfill is safe to run twice, and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0151_volunteer_profile_fields";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000001";
const BOTH = "bbbbbbbb-0000-4000-8000-000000000001";
const ONLY_RO = "bbbbbbbb-0000-4000-8000-000000000002";
const NONE = "bbbbbbbb-0000-4000-8000-000000000003";
const BLANK = "bbbbbbbb-0000-4000-8000-000000000004";
const ANA = "cccccccc-0000-4000-8000-000000000001";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and is the last one.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position - 1].tag).toBe("0150_volunteer_badges");

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-profile-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // Roles as §754 kept them: a line in both languages, in Romanian only, none, and a blank one.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_volunteer_roles (id, event_id, name_ro, name_en, needed, position, description_ro, description_en) VALUES
      ('${BOTH}', '${EVENT}', 'Punct de apă', 'Water point', 2, 0, '  Dai apă la km 5  ', 'Hand out water at km 5'),
      ('${ONLY_RO}', '${EVENT}', 'Sosire', 'Finish', 1, 1, 'Aplauze la sosire', NULL),
      ('${NONE}', '${EVENT}', 'Masă', 'Desk', 1, 2, NULL, NULL),
      ('${BLANK}', '${EVENT}', 'Traseu', 'Route', 1, 3, '   ', NULL);
    INSERT INTO event_volunteers (id, event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source) VALUES
      ('${ANA}', '${EVENT}', '${BOTH}', 'Ana', 'ana@example.test', 'ana@example.test', 2, '+40712345678', 'CONFIRMED', 'PUBLIC');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

describe("migration 0151_volunteer_profile_fields — the one-line description becomes a document", () => {
  it("backfills a one-paragraph document and its plain words per language, trimmed, only where there are words", async () => {
    const { rows } = await client.query<{ id: string; ro: unknown; en: unknown; words_ro: string | null; words_en: string | null }>(
      `SELECT id, description_ro_json AS ro, description_en_json AS en, description_words_ro AS words_ro, description_words_en AS words_en FROM event_volunteer_roles ORDER BY position`,
    );
    expect(rows).toEqual([
      { id: BOTH, ro: doc("Dai apă la km 5"), en: doc("Hand out water at km 5"), words_ro: "Dai apă la km 5", words_en: "Hand out water at km 5" },
      { id: ONLY_RO, ro: doc("Aplauze la sosire"), en: null, words_ro: "Aplauze la sosire", words_en: null },
      { id: NONE, ro: null, en: null, words_ro: null, words_en: null },
      { id: BLANK, ro: null, en: null, words_ro: null, words_en: null },
    ]);
  });

  it("leaves the old columns exactly as they were: nothing is dropped or rewritten", async () => {
    const { rows } = await client.query<{ id: string; description_ro: string | null; description_en: string | null }>(
      `SELECT id, description_ro, description_en FROM event_volunteer_roles ORDER BY position`,
    );
    expect(rows).toEqual([
      { id: BOTH, description_ro: "  Dai apă la km 5  ", description_en: "Hand out water at km 5" },
      { id: ONLY_RO, description_ro: "Aplauze la sosire", description_en: null },
      { id: NONE, description_ro: null, description_en: null },
      { id: BLANK, description_ro: "   ", description_en: null },
    ]);
  });

  it("is idempotent: running the backfill again changes nothing", async () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    const statements = sql.split("--> statement-breakpoint").filter((part) => /UPDATE "event_volunteer_roles"/.test(part));
    expect(statements).toHaveLength(2);
    const before = await client.query(`SELECT id, description_ro_json, description_en_json, description_words_ro, description_words_en FROM event_volunteer_roles ORDER BY position`);
    for (const statement of statements) await client.exec(statement);
    const after = await client.query(`SELECT id, description_ro_json, description_en_json, description_words_ro, description_words_en FROM event_volunteer_roles ORDER BY position`);
    expect(after.rows).toEqual(before.rows);
  });

  it("holds a document with its words, and the words to 2000 characters", async () => {
    await expect(
      client.exec(`UPDATE event_volunteer_roles SET description_ro_json = '{"type":"doc"}'::jsonb, description_words_ro = NULL WHERE id = '${NONE}'`),
    ).rejects.toThrow();
    await expect(client.exec(`UPDATE event_volunteer_roles SET description_words_ro = 'x' WHERE id = '${NONE}'`)).rejects.toThrow();
    await expect(
      client.exec(`UPDATE event_volunteer_roles SET description_ro_json = '{"type":"doc"}'::jsonb, description_words_ro = '${"x".repeat(2001)}' WHERE id = '${NONE}'`),
    ).rejects.toThrow();
    await client.exec(`UPDATE event_volunteer_roles SET description_ro_json = '{"type":"doc"}'::jsonb, description_words_ro = '${"x".repeat(2000)}' WHERE id = '${NONE}'`);
    await client.exec(`UPDATE event_volunteer_roles SET description_ro_json = NULL, description_words_ro = NULL WHERE id = '${NONE}'`);
  });
});

describe("migration 0151_volunteer_profile_fields — what a volunteer says about themselves", () => {
  it("leaves a volunteer listed before it with no answer: no age, sex, city or size, not volunteered before, not from the group", async () => {
    const { rows } = await client.query(`SELECT age, sex, city, volunteered_before, club_member, shirt_size FROM event_volunteers WHERE id = '${ANA}'`);
    expect(rows).toEqual([{ age: null, sex: null, city: null, volunteered_before: false, club_member: false, shirt_size: null }]);
  });

  it("gives every event no T-shirts for volunteers until the club says so", async () => {
    const { rows } = await client.query(`SELECT volunteers_shirts FROM events WHERE id = '${EVENT}'`);
    expect(rows).toEqual([{ volunteers_shirts: false }]);
  });

  it("keeps an age in range, a city of at most 80 characters and a size that is a size", async () => {
    const update = (set: string) => client.exec(`UPDATE event_volunteers SET ${set} WHERE id = '${ANA}'`);
    for (const bad of ["age = 0", "age = 121", `city = '${"x".repeat(81)}'`, "city = ''", "shirt_size = 'NONE'", "sex = 'OTHER'"]) {
      await expect(update(bad), bad).rejects.toThrow();
    }
    await update(`age = 34, sex = 'FEMALE', city = '${"x".repeat(80)}', volunteered_before = true, club_member = true, shirt_size = 'XL'`);
    const { rows } = await client.query(`SELECT age, sex, volunteered_before, club_member, shirt_size FROM event_volunteers WHERE id = '${ANA}'`);
    expect(rows).toEqual([{ age: 34, sex: "FEMALE", volunteered_before: true, club_member: true, shirt_size: "XL" }]);
  });

  it("only expands: columns added with defaults or null, checks added, and a backfill — nothing dropped or tightened", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    expect(sql).not.toMatch(/DROP |RENAME /i);
  });
});
