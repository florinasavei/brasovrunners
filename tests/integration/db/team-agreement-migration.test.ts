import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0221_staff_team_agreement` (§1006; the owner, 2026-11-19: «Voluntarii trebuie să semneze acordul GDPR când intră în
 * platformă»), proven on real PostgreSQL (PGlite) over a database migrated by the release before (BR-REQ-053-01 for the key,
 * BR-REQ-060-01 for the gate it records):
 *
 * - the legal document key `STAFF_DATA_AGREEMENT`, appended last — nothing in the same file names it, so PostgreSQL's rule
 *   against using an enum value in the transaction that adds it is kept;
 * - the acceptances' table: once per account and version, the name typed 1–200 characters, both hashes a SHA-256, a version
 *   somebody accepted never deleted under them, the row gone with its account;
 * - no legal text and no acceptance written by the migration: nobody is asked anything until the club approves a version;
 * - the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0221_staff_team_agreement";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const STAFF = "aaaaaaaa-0000-4000-8000-000000000221";
const OTHER = "abababab-0000-4000-8000-000000000221";
const DOCUMENT = "bbbbbbbb-0000-4000-8000-000000000221";
const HASH = "a".repeat(64);

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and counted right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "team-agreement-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The release before: two colleagues and the club's texts, no undertaking and no such table.
  await client.exec(`
    INSERT INTO staff_users (id, email, display_name, role) VALUES ('${STAFF}', 'voluntar@example.test', 'Vlad', 'CONTRIBUTOR');
    INSERT INTO staff_users (id, email, display_name, role) VALUES ('${OTHER}', 'organizator@example.test', 'Ioana', 'MODERATOR');
  `);
  await expect(client.query(`SELECT 1 FROM staff_team_agreement_acceptances`)).rejects.toThrow();
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await client.exec(`INSERT INTO legal_documents (id, key, version, effective_at, is_approved, content_sha256) VALUES ('${DOCUMENT}', 'STAFF_DATA_AGREEMENT', 1, '2026-11-19T00:00:00Z', true, '${HASH}')`);
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

/** An acceptance as `/admin/acord` writes it, the columns given replacing the defaults. */
function acceptance(extra: Record<string, string | null> = {}): string {
  const columns: Record<string, string | null> = {
    staff_user_id: STAFF,
    legal_document_id: DOCUMENT,
    document_version: "1",
    content_sha256: HASH,
    locale: "ro",
    typed_name: "Vlad Popescu",
    text_hash: HASH,
    accepted_at: "2026-11-19T10:00:00Z",
    ...extra,
  };
  const values = Object.values(columns).map((value) => (value === null ? "NULL" : `'${value}'`));
  return `INSERT INTO staff_team_agreement_acceptances (${Object.keys(columns).join(", ")}) VALUES (${values.join(", ")})`;
}

describe("migration 0221_staff_team_agreement", () => {
  it("appends the key last and writes no text and no acceptance: nobody is asked until the club approves a version", async () => {
    const values = (await client.query<{ value: string }>(`SELECT unnest(enum_range(NULL::legal_document_key))::text AS value`)).rows.map((row) => row.value);
    expect(values.at(-1)).toBe("STAFF_DATA_AGREEMENT");
    expect(values.at(-2)).toBe("RAFFLE_RULES");
    expect((await client.query(`SELECT count(*)::int AS n FROM legal_documents WHERE id <> '${DOCUMENT}'`)).rows).toEqual([{ n: 0 }]);
    expect((await client.query(`SELECT count(*)::int AS n FROM staff_team_agreement_acceptances`)).rows).toEqual([{ n: 0 }]);
  });

  it("keeps one acceptance per account and version", async () => {
    await client.exec(acceptance());
    await expect(client.exec(acceptance({ typed_name: "Altcineva", accepted_at: "2026-11-19T11:00:00Z" }))).rejects.toThrow(/staff_team_agreement_acceptances_once/);
    // Another colleague accepts the same version: a row of their own.
    await client.exec(acceptance({ staff_user_id: OTHER, typed_name: "Ioana Pop" }));
    expect((await client.query(`SELECT count(*)::int AS n FROM staff_team_agreement_acceptances`)).rows).toEqual([{ n: 2 }]);
  });

  it("refuses an empty or over-long name, a hash that is no SHA-256 and a version number below one", async () => {
    await client.exec(`DELETE FROM staff_team_agreement_acceptances`);
    await expect(client.exec(acceptance({ typed_name: "   " }))).rejects.toThrow(/typed_name/);
    await expect(client.exec(acceptance({ typed_name: "x".repeat(201) }))).rejects.toThrow(/typed_name/);
    await client.exec(acceptance({ typed_name: "x".repeat(200) }));
    await client.exec(`DELETE FROM staff_team_agreement_acceptances`);
    await expect(client.exec(acceptance({ text_hash: "nope" }))).rejects.toThrow(/text_sha256/);
    await expect(client.exec(acceptance({ content_sha256: "A".repeat(64) }))).rejects.toThrow(/content_sha256/);
    await expect(client.exec(acceptance({ document_version: "0" }))).rejects.toThrow(/version_positive/);
    await expect(client.exec(acceptance({ typed_name: null }))).rejects.toThrow();
  });

  it("never deletes a version somebody accepted, and lets the acceptance go with its account", async () => {
    await client.exec(`DELETE FROM staff_team_agreement_acceptances`);
    await client.exec(acceptance());
    await expect(client.exec(`DELETE FROM legal_documents WHERE id = '${DOCUMENT}'`)).rejects.toThrow(/legal_document_id/);
    await client.exec(`DELETE FROM staff_users WHERE id = '${STAFF}'`);
    expect((await client.query(`SELECT count(*)::int AS n FROM staff_team_agreement_acceptances`)).rows).toEqual([{ n: 0 }]);
    await client.exec(`DELETE FROM legal_documents WHERE id = '${DOCUMENT}'`);
  });

  it("is read by the checker as an expansion: the key, the table, its keys and its index, nothing else", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements[0]).toBe(`ALTER TYPE "public"."legal_document_key" ADD VALUE 'STAFF_DATA_AGREEMENT';`);
    expect(statements[1]).toMatch(/^CREATE TABLE "staff_team_agreement_acceptances"/);
    // The value is never named again in the file: PostgreSQL refuses a new enum value used in the transaction that adds it.
    expect(statements.slice(1).join("\n")).not.toContain("STAFF_DATA_AGREEMENT");
    expect(statements).toHaveLength(5);
  });
});
