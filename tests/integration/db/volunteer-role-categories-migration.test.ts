import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0160_volunteer_role_categories` (§774, amending §754 and §761), proven on real PostgreSQL (PGlite): the roles an event
 * had before it keep no category — they sit under «Alte activități» — and their people and choices are untouched; a role name typed twice
 * on one event (nothing enforced it until now) is told apart by a number so the new per-category uniqueness can never refuse the
 * migration; the same name may then stand in two categories but not twice in one; a category holds a contact person whose every box is
 * optional; and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0160_volunteer_role_categories";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "aaaaaaaa-0000-4000-8000-000000000002";
const CLASH = "aaaaaaaa-0000-4000-8000-000000000003";
const CLASH_IDS = ["bbbbbbbb-0000-4000-8000-0000000000a1", "bbbbbbbb-0000-4000-8000-0000000000a2", "bbbbbbbb-0000-4000-8000-0000000000a3"] as const;
const WATER = "bbbbbbbb-0000-4000-8000-000000000001";
const WATER_AGAIN = "bbbbbbbb-0000-4000-8000-000000000002";
const WATER_THIRD = "bbbbbbbb-0000-4000-8000-000000000003";
const FINISH = "bbbbbbbb-0000-4000-8000-000000000004";
const OTHER_WATER = "bbbbbbbb-0000-4000-8000-000000000005";
const ANA = "cccccccc-0000-4000-8000-000000000001";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and numbered right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);
  expect(journal.entries[position - 1].tag).toBe("0159_volunteers_counts_birth_date");
  // It was the last entry when it shipped; a later migration may follow it (`0162_registration_notes` does), and the run below
  // stops just before this one either way.

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-role-categories-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The event as the release before wrote it: three roles one name — two of them differing in case only, in English too — and a different one,
  // a volunteer given the first, and a role of another event with the same name (a different list, so it is no duplicate).
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES
      ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT'),
      ('${OTHER}', 'RACE', '2026-12-05T08:00:00Z', 'DRAFT'),
      ('${CLASH}', 'RACE', '2027-01-09T08:00:00Z', 'DRAFT');
    INSERT INTO event_volunteer_roles (id, event_id, name_ro, name_en, needed, position, created_at) VALUES
      ('${WATER}', '${EVENT}', 'Punct de apă', 'Water point', 3, 0, '2026-10-01T08:00:00Z'),
      ('${WATER_AGAIN}', '${EVENT}', 'PUNCT DE APĂ', 'Water point', 2, 1, '2026-10-01T09:00:00Z'),
      ('${WATER_THIRD}', '${EVENT}', 'Punct de apă', 'Hydration', 1, 2, '2026-10-01T10:00:00Z'),
      ('${FINISH}', '${EVENT}', 'Sosire', 'Finish', 1, 3, '2026-10-01T11:00:00Z'),
      ('${OTHER_WATER}', '${OTHER}', 'Punct de apă', 'Water point', 1, 0, '2026-10-01T08:00:00Z'),
      -- «A», «a» and «A (2)»: the number given to «a» is a name already there, so it needs telling apart once more.
      ('${CLASH_IDS[0]}', '${CLASH}', 'A', 'A', 1, 0, '2026-10-01T08:00:00Z'),
      ('${CLASH_IDS[1]}', '${CLASH}', 'a', 'a', 1, 1, '2026-10-01T09:00:00Z'),
      ('${CLASH_IDS[2]}', '${CLASH}', 'A (2)', 'A (2)', 1, 2, '2026-10-01T10:00:00Z');
    INSERT INTO event_volunteers (id, event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source)
      VALUES ('${ANA}', '${EVENT}', '${WATER}', 'Ana', 'ana@example.test', 'ana@example.test', 2, '+40712345678', 'CONFIRMED', 'PUBLIC');
    INSERT INTO event_volunteer_role_choices (volunteer_id, role_id) VALUES ('${ANA}', '${WATER}'), ('${ANA}', '${FINISH}');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0160_volunteer_role_categories — the roles from before", () => {
  it("leaves every role without a category — «Alte activități» — with its people and its choices as they were", async () => {
    const roles = await client.query(`SELECT id, category_id FROM event_volunteer_roles ORDER BY id`);
    expect(roles.rows).toHaveLength(8);
    for (const row of roles.rows as Array<{ category_id: unknown }>) expect(row.category_id).toBeNull();
    expect((await client.query(`SELECT role_id, state FROM event_volunteers WHERE id = '${ANA}'`)).rows).toEqual([{ role_id: WATER, state: "CONFIRMED" }]);
    expect((await client.query(`SELECT role_id FROM event_volunteer_role_choices WHERE volunteer_id = '${ANA}' ORDER BY role_id`)).rows).toEqual([{ role_id: WATER }, { role_id: FINISH }]);
  });

  it("never refuses to run on a name its own number collides with: «A», «a» and «A (2)» all end up told apart, the first keeping its name", async () => {
    const { rows } = await client.query<{ id: string; name_ro: string; name_en: string }>(`SELECT id, name_ro, name_en FROM event_volunteer_roles WHERE event_id = '${CLASH}' ORDER BY position`);
    expect(rows[0]).toMatchObject({ name_ro: "A", name_en: "A" });
    for (const language of ["name_ro", "name_en"] as const) {
      const names = rows.map((row) => row[language].toLowerCase());
      expect(new Set(names).size).toBe(3);
    }
  });

  it("tells apart, by a number in the club's own order, a name typed twice on one event — in either language, whatever the case — and touches nothing else", async () => {
    const { rows } = await client.query<{ id: string; name_ro: string; name_en: string }>(`SELECT id, name_ro, name_en FROM event_volunteer_roles ORDER BY id`);
    const byId = new Map(rows.map((row) => [row.id, row]));
    // The first keeps its names; the later ones are numbered (the Romanian pair collided on the second and third, the English on the second).
    expect(byId.get(WATER)).toMatchObject({ name_ro: "Punct de apă", name_en: "Water point" });
    expect(byId.get(WATER_AGAIN)).toMatchObject({ name_ro: "PUNCT DE APĂ (2)", name_en: "Water point (2)" });
    expect(byId.get(WATER_THIRD)).toMatchObject({ name_ro: "Punct de apă (3)", name_en: "Hydration" });
    expect(byId.get(FINISH)).toMatchObject({ name_ro: "Sosire", name_en: "Finish" });
    // Another event's list is its own.
    expect(byId.get(OTHER_WATER)).toMatchObject({ name_ro: "Punct de apă", name_en: "Water point" });
  });
});

describe("migration 0160_volunteer_role_categories — the categories", () => {
  const CATEGORY = "dddddddd-0000-4000-8000-000000000001";
  const ROUTE = "dddddddd-0000-4000-8000-000000000002";

  it("holds a category's two names, its order and a contact person whose every box is optional", async () => {
    await client.exec(`INSERT INTO event_volunteer_categories (id, event_id, name_ro, name_en, sort) VALUES ('${CATEGORY}', '${EVENT}', 'Start / Sosire', 'Start / Finish', 0)`);
    expect((await client.query(`SELECT contact_name, contact_phone, contact_email, sort FROM event_volunteer_categories WHERE id = '${CATEGORY}'`)).rows).toEqual([
      { contact_name: null, contact_phone: null, contact_email: null, sort: 0 },
    ]);
    await client.exec(`UPDATE event_volunteer_categories SET contact_name = 'Ana Popescu', contact_phone = '+40712345678', contact_email = 'ana@example.test' WHERE id = '${CATEGORY}'`);
    for (const bad of ["name_ro = ''", "name_en = ''", `name_ro = '${"x".repeat(81)}'`, `contact_phone = '${"0".repeat(41)}'`, "contact_name = ''", "contact_email = 'a'"]) {
      await expect(client.exec(`UPDATE event_volunteer_categories SET ${bad} WHERE id = '${CATEGORY}'`), bad).rejects.toThrow();
    }
    await client.exec(`UPDATE event_volunteer_categories SET contact_name = NULL, contact_phone = NULL, contact_email = NULL WHERE id = '${CATEGORY}'`);
  });

  it("names a category once per event in each language, whatever the case", async () => {
    await expect(client.exec(`INSERT INTO event_volunteer_categories (event_id, name_ro, name_en, sort) VALUES ('${EVENT}', 'START / SOSIRE', 'Other', 1)`)).rejects.toThrow();
    await expect(client.exec(`INSERT INTO event_volunteer_categories (event_id, name_ro, name_en, sort) VALUES ('${EVENT}', 'Alta', 'start / finish', 1)`)).rejects.toThrow();
    await client.exec(`INSERT INTO event_volunteer_categories (id, event_id, name_ro, name_en, sort) VALUES ('${ROUTE}', '${EVENT}', 'Traseu', 'Route', 1)`);
    await client.exec(`INSERT INTO event_volunteer_categories (event_id, name_ro, name_en, sort) VALUES ('${OTHER}', 'Traseu', 'Route', 0)`);
  });

  it("lets the same role name stand in two categories, once in each, and refuses it twice in one — the roles under none being one group", async () => {
    const insert = (id: string, category: string | null, ro: string, en: string) =>
      client.exec(
        `INSERT INTO event_volunteer_roles (id, event_id, category_id, name_ro, name_en, needed, position) VALUES ('${id}', '${EVENT}', ${category ? `'${category}'` : "NULL"}, '${ro}', '${en}', 1, 9)`,
      );
    await insert("eeeeeeee-0000-4000-8000-000000000001", CATEGORY, "Direcționare", "Guidance");
    await insert("eeeeeeee-0000-4000-8000-000000000002", ROUTE, "Direcționare", "Guidance");
    await expect(insert("eeeeeeee-0000-4000-8000-000000000003", ROUTE, "direcționare", "Marshal")).rejects.toThrow();
    await expect(insert("eeeeeeee-0000-4000-8000-000000000004", ROUTE, "Altceva", "GUIDANCE")).rejects.toThrow();
    await insert("eeeeeeee-0000-4000-8000-000000000005", null, "Direcționare", "Guidance");
    await expect(insert("eeeeeeee-0000-4000-8000-000000000006", null, "Direcționare", "Other")).rejects.toThrow();
  });

  it("refuses a category's delete while a role sits under it, and lets the event's delete take both", async () => {
    await expect(client.exec(`DELETE FROM event_volunteer_categories WHERE id = '${CATEGORY}'`)).rejects.toThrow();
    // The people first (their role is RESTRICT, §754); then the event, whose cascade reaches the categories and the roles in no promised order.
    await client.exec(`DELETE FROM event_volunteers WHERE event_id = '${EVENT}'`);
    await client.exec(`DELETE FROM events WHERE id = '${EVENT}'`);
    expect((await client.query(`SELECT 1 FROM event_volunteer_categories WHERE event_id = '${EVENT}'`)).rows).toHaveLength(0);
    expect((await client.query(`SELECT 1 FROM event_volunteer_roles WHERE event_id = '${EVENT}'`)).rows).toHaveLength(0);
  });

  it("only expands: a table, a nullable column and indexes — numbering what was typed twice is its one data change; nothing dropped, renamed or tightened", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    expect(sql).toMatch(/CREATE TABLE "event_volunteer_categories"/);
    expect(sql).toMatch(/ALTER TABLE "event_volunteer_roles" ADD COLUMN "category_id" uuid;/);
    expect(sql).not.toMatch(/DROP|RENAME|SET NOT NULL|ALTER COLUMN/);
  });
});
