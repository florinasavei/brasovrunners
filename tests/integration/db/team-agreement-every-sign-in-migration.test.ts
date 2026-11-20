import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0225_staff_team_agreement_every_sign_in` (§NNN, amending §1006: the team's undertaking is owed at every sign-in, and
 * every acceptance is kept), proven on real PostgreSQL (PGlite) over a database migrated by the release before (BR-REQ-060-01 for
 * the gate it records, BR-REQ-053-01 for the version it relies on):
 *
 * - expand only (AGENTS.md §7.6): a new table, `staff_team_agreement_sign_in_acceptances`; §1006's table, its unique key and its
 *   rows are left exactly as they were — the acceptances made once per account stay;
 * - one row per account, version and **sign-in it answers** (`signed_in_at`), NULLS NOT DISTINCT, so the sessions signed in before
 *   §NNN — which carry no moment — count as one: a double tap writes nothing, the next sign-in is a row of its own, and
 *   `ON CONFLICT (staff_user_id, legal_document_id, signed_in_at) DO NOTHING` — the service's own — finds the null one too;
 * - the name typed 1–200 characters, both hashes a SHA-256, a version somebody accepted never deleted under them, the rows gone
 *   with their account; nothing written by the migration.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0225_staff_team_agreement_every_sign_in";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const STAFF = "aaaaaaaa-0000-4000-8000-000000000225";
const OTHER = "abababab-0000-4000-8000-000000000225";
const DOCUMENT = "bbbbbbbb-0000-4000-8000-000000000225";
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

  folder = mkdtempSync(path.join(tmpdir(), "team-agreement-sign-in-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The release before: two colleagues, a version of the undertaking in force and one acceptance of it, once per account (§1006).
  await client.exec(`
    INSERT INTO staff_users (id, email, display_name, role) VALUES ('${STAFF}', 'voluntar@example.test', 'Vlad', 'CONTRIBUTOR');
    INSERT INTO staff_users (id, email, display_name, role) VALUES ('${OTHER}', 'organizator@example.test', 'Ioana', 'MODERATOR');
    INSERT INTO legal_documents (id, key, version, effective_at, is_approved, content_sha256) VALUES ('${DOCUMENT}', 'STAFF_DATA_AGREEMENT', 1, '2026-11-19T00:00:00Z', true, '${HASH}');
    INSERT INTO staff_team_agreement_acceptances (staff_user_id, legal_document_id, document_version, content_sha256, locale, typed_name, text_hash, accepted_at)
      VALUES ('${STAFF}', '${DOCUMENT}', 1, '${HASH}', 'ro', 'Vlad Popescu', '${HASH}', '2026-11-19T10:00:00Z');
  `);
  await expect(client.query(`SELECT 1 FROM staff_team_agreement_sign_in_acceptances`)).rejects.toThrow();
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

/** An acceptance at a sign-in as `/admin/acord` writes it, the columns given replacing the defaults. */
function acceptance(extra: Record<string, string | null> = {}): string {
  const columns: Record<string, string | null> = {
    staff_user_id: STAFF,
    legal_document_id: DOCUMENT,
    document_version: "1",
    content_sha256: HASH,
    locale: "ro",
    typed_name: "Vlad Popescu",
    text_hash: HASH,
    signed_in_at: "2026-11-21T07:00:00Z",
    accepted_at: "2026-11-21T07:01:00Z",
    ...extra,
  };
  const values = Object.values(columns).map((value) => (value === null ? "NULL" : `'${value}'`));
  return `INSERT INTO staff_team_agreement_sign_in_acceptances (${Object.keys(columns).join(", ")}) VALUES (${values.join(", ")})`;
}
const count = async (table: string) => (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

describe("migration 0225_staff_team_agreement_every_sign_in", () => {
  it("keeps §1006's acceptances as they were and writes nothing of its own", async () => {
    expect(await count("staff_team_agreement_sign_in_acceptances")).toBe(0);
    const kept = (await client.query(`SELECT staff_user_id, typed_name, accepted_at FROM staff_team_agreement_acceptances`)).rows;
    expect(kept).toEqual([{ staff_user_id: STAFF, typed_name: "Vlad Popescu", accepted_at: new Date("2026-11-19T10:00:00Z") }]);
    // §1006's unique key is untouched: still one row per account and version there.
    await expect(
      client.exec(
        `INSERT INTO staff_team_agreement_acceptances (staff_user_id, legal_document_id, document_version, content_sha256, locale, typed_name, text_hash, accepted_at) VALUES ('${STAFF}', '${DOCUMENT}', 1, '${HASH}', 'ro', 'Altcineva', '${HASH}', now())`,
      ),
    ).rejects.toThrow(/staff_team_agreement_acceptances_once/);
  });

  it("keeps every acceptance: one per account, version and sign-in — the next sign-in is a row of its own", async () => {
    await client.exec(acceptance());
    await expect(client.exec(acceptance({ typed_name: "Altcineva", accepted_at: "2026-11-21T07:02:00Z" }))).rejects.toThrow(/staff_team_agreement_sign_in_acceptances_once/);
    await client.exec(acceptance({ signed_in_at: "2026-11-22T07:00:00Z", accepted_at: "2026-11-22T07:01:00Z" }));
    await client.exec(acceptance({ staff_user_id: OTHER, typed_name: "Ioana Pop" }));
    expect(await count("staff_team_agreement_sign_in_acceptances")).toBe(3);
  });

  it("counts the sessions from before §NNN — no moment — as one, and the service's ON CONFLICT finds that null row too", async () => {
    await client.exec(`DELETE FROM staff_team_agreement_sign_in_acceptances`);
    await client.exec(acceptance({ signed_in_at: null }));
    await expect(client.exec(acceptance({ signed_in_at: null, accepted_at: "2026-11-21T08:00:00Z" }))).rejects.toThrow(/staff_team_agreement_sign_in_acceptances_once/);
    const again = await client.query(`${acceptance({ signed_in_at: null, accepted_at: "2026-11-21T09:00:00Z" })} ON CONFLICT (staff_user_id, legal_document_id, signed_in_at) DO NOTHING RETURNING id`);
    expect(again.rows).toEqual([]);
    const fresh = await client.query(`${acceptance({ signed_in_at: "2026-11-23T07:00:00Z" })} ON CONFLICT (staff_user_id, legal_document_id, signed_in_at) DO NOTHING RETURNING id`);
    expect(fresh.rows).toHaveLength(1);
    expect(await count("staff_team_agreement_sign_in_acceptances")).toBe(2);
  });

  it("refuses an empty or over-long name, a hash that is no SHA-256 and a version number below one", async () => {
    await client.exec(`DELETE FROM staff_team_agreement_sign_in_acceptances`);
    await expect(client.exec(acceptance({ typed_name: "   " }))).rejects.toThrow(/typed_name/);
    await expect(client.exec(acceptance({ typed_name: "x".repeat(201) }))).rejects.toThrow(/typed_name/);
    await client.exec(acceptance({ typed_name: "x".repeat(200) }));
    await client.exec(`DELETE FROM staff_team_agreement_sign_in_acceptances`);
    await expect(client.exec(acceptance({ text_hash: "nope" }))).rejects.toThrow(/text_sha256/);
    await expect(client.exec(acceptance({ content_sha256: "A".repeat(64) }))).rejects.toThrow(/content_sha256/);
    await expect(client.exec(acceptance({ document_version: "0" }))).rejects.toThrow(/version_positive/);
    await expect(client.exec(acceptance({ typed_name: null }))).rejects.toThrow();
    await expect(client.exec(acceptance({ accepted_at: null }))).rejects.toThrow();
  });

  it("never deletes a version somebody accepted, and lets the acceptances go with their account", async () => {
    await client.exec(`DELETE FROM staff_team_agreement_sign_in_acceptances`);
    await client.exec(`DELETE FROM staff_team_agreement_acceptances`);
    await client.exec(acceptance());
    await client.exec(acceptance({ signed_in_at: "2026-11-22T07:00:00Z" }));
    await expect(client.exec(`DELETE FROM legal_documents WHERE id = '${DOCUMENT}'`)).rejects.toThrow(/legal_document_id/);
    await client.exec(`DELETE FROM staff_users WHERE id = '${STAFF}'`);
    expect(await count("staff_team_agreement_sign_in_acceptances")).toBe(0);
    await client.exec(`DELETE FROM legal_documents WHERE id = '${DOCUMENT}'`);
  });

  it("is read by the checker as an expansion: the table, its keys and its index, nothing else", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements[0]).toMatch(/^CREATE TABLE "staff_team_agreement_sign_in_acceptances"/);
    expect(statements[0]).toContain(`UNIQUE NULLS NOT DISTINCT("staff_user_id","legal_document_id","signed_in_at")`);
    expect(statements[0]).toMatch(/"signed_in_at" timestamp with time zone,/);
    // Only the new table, its two foreign keys and its index; §1006's table is named nowhere — not altered, not dropped, its rows
    // not moved.
    expect(statements).toHaveLength(4);
    expect(statements.slice(1, 3).every((statement) => /^ALTER TABLE "staff_team_agreement_sign_in_acceptances" ADD CONSTRAINT "[a-z_]+" FOREIGN KEY/.test(statement))).toBe(true);
    expect(statements[3]).toMatch(/^CREATE INDEX "staff_team_agreement_sign_in_acceptances_document_idx"/);
    expect(sql).not.toMatch(/"staff_team_agreement_acceptances"/);
  });
});
