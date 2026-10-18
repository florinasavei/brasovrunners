import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0169_member_tiers` (§811; the owner, 2026-10-18: «Also for the member zone I want member Tiers»),
 * proven on real PostgreSQL (PGlite): one new table, `member_tiers`, and two nullable columns that expand and
 * nothing else — `staff_users.member_tier_id` (a member's level, `ON DELETE SET NULL`) and
 * `member_discount_codes.tier_ids` (a code's limit to some levels, null being every member). A member and a
 * code written before it simply have no level and no limit; the file only expands, and the journal lists it
 * last, later than every migration before it.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0169_member_tiers";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const MEMBER = "aaaaaaaa-0000-4000-8000-000000000001";
const CODE = "bbbbbbbb-0000-4000-8000-000000000001";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`).
  expect(journal.entries[position].when).toBeGreaterThan(Math.max(...journal.entries.slice(0, position).map((entry) => entry.when)));
  expect(journal.entries[position].idx).toBeGreaterThan(Math.max(...journal.entries.slice(0, position).map((entry) => entry.idx)));

  folder = mkdtempSync(path.join(tmpdir(), "member-tiers-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // A member and a discount code that exist before the table does.
  await client.exec(`
    INSERT INTO staff_users (id, email, display_name, role) VALUES ('${MEMBER}', 'ana@example.test', 'Ana', 'MEMBER');
    INSERT INTO member_discount_codes (id, partner_name, code, position) VALUES ('${CODE}', 'Magazinul', 'BVR15', 1);
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0169_member_tiers — the club's member levels", () => {
  it("adds the table with both names required, the descriptions and the author nullable, the glyph a star by default", async () => {
    const result = await client.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'member_tiers' ORDER BY column_name`,
    );
    expect(result.rows.map((row) => [row.column_name, row.data_type, row.is_nullable])).toEqual([
      ["created_at", "timestamp with time zone", "NO"],
      ["description_en", "text", "YES"],
      ["description_ro", "text", "YES"],
      ["glyph", "text", "NO"],
      ["hidden", "boolean", "NO"],
      ["id", "uuid", "NO"],
      ["name_en", "text", "NO"],
      ["name_ro", "text", "NO"],
      ["position", "integer", "NO"],
      ["updated_at", "timestamp with time zone", "NO"],
      ["updated_by_staff_user_id", "uuid", "YES"],
    ]);
    expect(result.rows.find((row) => row.column_name === "glyph")?.column_default).toContain("star");
    expect(result.rows.find((row) => row.column_name === "hidden")?.column_default).toBe("false");
  });

  it("leaves a member written before it with no level and a code with no limit", async () => {
    const member = await client.query<{ member_tier_id: string | null }>(`SELECT member_tier_id FROM staff_users WHERE id = '${MEMBER}'`);
    expect(member.rows[0].member_tier_id).toBeNull();
    const code = await client.query<{ tier_ids: string[] | null }>(`SELECT tier_ids FROM member_discount_codes WHERE id = '${CODE}'`);
    expect(code.rows[0].tier_ids).toBeNull();
    const columns = await client.query<{ data_type: string; udt_name: string; is_nullable: string }>(
      `SELECT data_type, udt_name, is_nullable FROM information_schema.columns WHERE table_name = 'member_discount_codes' AND column_name = 'tier_ids'`,
    );
    expect(columns.rows[0]).toEqual({ data_type: "ARRAY", udt_name: "_uuid", is_nullable: "YES" });
  });

  it("refuses a nameless level, a name past forty characters, a description past four hundred and a place below one", async () => {
    const insert = (columns: string, values: string) => client.exec(`INSERT INTO member_tiers (${columns}) VALUES (${values})`);
    await expect(insert("name_ro, name_en, position", `'', 'Member', 1`)).rejects.toThrow(/member_tiers_name_ro_present/);
    await expect(insert("name_ro, name_en, position", `'Membru', ' ', 1`)).rejects.toThrow(/member_tiers_name_en_present/);
    await expect(insert("name_ro, name_en, position", `'${"a".repeat(41)}', 'Member', 1`)).rejects.toThrow(/member_tiers_name_ro_short/);
    await expect(insert("name_ro, name_en, description_en, position", `'Membru', 'Member', '${"a".repeat(401)}', 1`)).rejects.toThrow(/member_tiers_description_en_short/);
    await expect(insert("name_ro, name_en, position", `'Membru', 'Member', 0`)).rejects.toThrow(/member_tiers_position_positive/);
    await insert("name_ro, name_en, description_ro, position", `'${"a".repeat(40)}', 'Member', '${"a".repeat(400)}', 1`);
    await client.exec(`DELETE FROM member_tiers`);
  });

  it("frees a member of the level when the level is deleted, and keeps the member", async () => {
    const [tier] = (await client.query<{ id: string }>(`INSERT INTO member_tiers (name_ro, name_en, position) VALUES ('Fondator', 'Founder', 1) RETURNING id`)).rows;
    await client.exec(`UPDATE staff_users SET member_tier_id = '${tier.id}' WHERE id = '${MEMBER}'`);
    await client.exec(`DELETE FROM member_tiers WHERE id = '${tier.id}'`);
    const member = await client.query<{ member_tier_id: string | null }>(`SELECT member_tier_id FROM staff_users WHERE id = '${MEMBER}'`);
    expect(member.rows).toEqual([{ member_tier_id: null }]);
  });

  it("only expands: a table, two nullable columns and their keys, nothing dropped, renamed or changed", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    expect(sql).not.toMatch(/DROP |RENAME /i);
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(sql).toMatch(/ALTER TABLE "staff_users" ADD COLUMN "member_tier_id" uuid;/);
    expect(sql).toMatch(/ALTER TABLE "member_discount_codes" ADD COLUMN "tier_ids" uuid\[\];/);
    expect(sql).toMatch(/ON DELETE set null/);
    // A column added with no default and no NOT NULL is the cheap kind: no rewrite, no lock held on the member table.
    expect(sql).not.toMatch(/ADD COLUMN "(member_tier_id|tier_ids)"[^;]*(NOT NULL|DEFAULT)/);
  });
});
