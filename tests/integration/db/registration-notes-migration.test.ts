import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0162_registration_notes` (§NNN; the owner, 2026-10-15), proven on real PostgreSQL (PGlite): one new
 * table, `registration_notes`, that expands and nothing else — a note's registration (`ON DELETE CASCADE`), its
 * author (`ON DELETE SET NULL`), the words (text, at most 2000 characters), and a nullable `deleted_at`. A
 * registration written before it simply has no notes; the file only expands, and the journal lists it last,
 * later than every migration before it.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0162_registration_notes";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000001";
const PERSON = "bbbbbbbb-0000-4000-8000-000000000001";
const REGISTRATION = "cccccccc-0000-4000-8000-000000000001";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`).
  expect(journal.entries[position].when).toBeGreaterThan(Math.max(...journal.entries.slice(0, position).map((entry) => entry.when)));
  expect(journal.entries[position].idx).toBeGreaterThan(Math.max(...journal.entries.slice(0, position).map((entry) => entry.idx)));

  folder = mkdtempSync(path.join(tmpdir(), "registration-notes-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // A registration that exists before the table does.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO participants (id, delivery_email, normalized_email, canonical_email, canonicalization_version, default_name, preferred_locale)
      VALUES ('${PERSON}', 'ana@example.test', 'ana@example.test', 'ana@example.test', 2, 'Ana', 'ro');
    INSERT INTO registrations (id, event_id, participant_id, kind, locale, registered_name, display_name, privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, status)
      VALUES ('${REGISTRATION}', '${EVENT}', '${PERSON}', 'REAL', 'ro', 'Ana', 'Ana', 1, now(), false, 1, 'CONFIRMED');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0162_registration_notes — internal notes on a registration", () => {
  it("adds the table with the words required and the soft-delete stamp nullable", async () => {
    const result = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'registration_notes' ORDER BY column_name`,
    );
    expect(result.rows).toEqual([
      { column_name: "author_staff_user_id", data_type: "uuid", is_nullable: "YES" },
      { column_name: "body", data_type: "text", is_nullable: "NO" },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "deleted_at", data_type: "timestamp with time zone", is_nullable: "YES" },
      { column_name: "id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "registration_id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO" },
    ]);
  });

  it("leaves a registration written before it with no notes", async () => {
    const result = await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM registration_notes WHERE registration_id = '${REGISTRATION}'`);
    expect(result.rows[0].total).toBe(0);
  });

  it("deletes a registration's notes with it, soft-deleted ones too", async () => {
    await client.exec(`
      INSERT INTO registration_notes (registration_id, body) VALUES ('${REGISTRATION}', 'una');
      INSERT INTO registration_notes (registration_id, body, deleted_at) VALUES ('${REGISTRATION}', '', now());
    `);
    expect((await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM registration_notes`)).rows[0].total).toBe(2);
    await client.exec(`DELETE FROM registrations WHERE id = '${REGISTRATION}'`);
    expect((await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM registration_notes`)).rows[0].total).toBe(0);
  });

  it("only expands: a table and its keys, nothing dropped, renamed or changed", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    expect(sql).not.toMatch(/DROP |RENAME /i);
    expect(sql.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(sql).toMatch(/"registration_id_registrations_id_fk"|registration_notes_registration_id_registrations_id_fk/);
    expect(sql).toMatch(/ON DELETE cascade/);
    expect(sql).toMatch(/ON DELETE set null/);
  });
});
