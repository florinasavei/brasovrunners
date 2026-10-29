import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0182_volunteers_name_only` (§864, amending §754), proven on real PostgreSQL (PGlite): a volunteer the club types may
 * have no address, no telephone number, or neither — «doar să fie așa pe listă». The four columns lose their NOT NULL; two CHECKs
 * keep what still holds: an address is the typed one, its canonical form and the canonicalizer's version together or none of
 * them, and only a row the club typed (`STAFF`) may lack an address or a telephone number. The rows from before keep everything;
 * `UNIQUE (event_id, canonical_email)` still refuses one address twice, and compares no two NULLs, so two name-only rows of one
 * name both stand; and the file only expands (dropping a NOT NULL and adding a CHECK take nothing away).
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0182_volunteers_name_only";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000001";
const ANA = "cccccccc-0000-4000-8000-000000000001";
const ION = "cccccccc-0000-4000-8000-000000000002";

let client: PGlite;
let folder: string;

/** A row with only what the table requires besides the columns under test. */
const insert = (values: { source: "STAFF" | "PUBLIC"; name?: string; email?: string | null; canonical?: string | null; version?: number | null; phone?: string | null }) => {
  const literal = (value: string | number | null | undefined) => (value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : `'${value}'`);
  return client.exec(`
    INSERT INTO event_volunteers (event_id, name, email, canonical_email, canonicalization_version, phone, state, source)
    VALUES ('${EVENT}', ${literal(values.name ?? "Doar Nume")}, ${literal(values.email)}, ${literal(values.canonical)}, ${literal(values.version)}, ${literal(values.phone)}, 'REGISTERED', '${values.source}')
  `);
};

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and numbered right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);
  expect(journal.entries[position - 1].tag).toBe("0181_event_translation_location_short");

  folder = mkdtempSync(path.join(tmpdir(), "volunteers-name-only-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The event's volunteers as the release before wrote them: one from the public form, one an organizer typed — each with both.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_volunteers (id, event_id, name, email, canonical_email, canonicalization_version, phone, state, source) VALUES
      ('${ANA}', '${EVENT}', 'Ana', 'Ana@Example.test', 'ana@example.test', 2, '+40712345678', 'CONFIRMED', 'PUBLIC'),
      ('${ION}', '${EVENT}', 'Ion', 'ion@example.test', 'ion@example.test', 2, '+40712345679', 'REGISTERED', 'STAFF');
  `);
  // Before it, an address and a telephone number are required of every row: the table says so (the proof the migration changes something).
  await expect(insert({ source: "STAFF", email: null, canonical: null, version: null, phone: "+40712345670" })).rejects.toThrow();
  await expect(insert({ source: "STAFF", name: "Fără telefon", email: "x@example.test", canonical: "x@example.test", version: 2, phone: null })).rejects.toThrow();
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0182_volunteers_name_only — the rows from before", () => {
  it("keeps every address, its identity, the canonicalizer's version and the telephone number exactly as they were", async () => {
    expect((await client.query(`SELECT id, email, canonical_email, canonicalization_version, phone, source FROM event_volunteers ORDER BY name`)).rows).toEqual([
      { id: ANA, email: "Ana@Example.test", canonical_email: "ana@example.test", canonicalization_version: 2, phone: "+40712345678", source: "PUBLIC" },
      { id: ION, email: "ion@example.test", canonical_email: "ion@example.test", canonicalization_version: 2, phone: "+40712345679", source: "STAFF" },
    ]);
  });

  it("makes the four columns nullable and nothing else", async () => {
    const columns = await client.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'event_volunteers' AND column_name IN ('email', 'canonical_email', 'canonicalization_version', 'phone', 'name', 'source') ORDER BY column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: "canonical_email", is_nullable: "YES" },
      { column_name: "canonicalization_version", is_nullable: "YES" },
      { column_name: "email", is_nullable: "YES" },
      { column_name: "name", is_nullable: "NO" },
      { column_name: "phone", is_nullable: "YES" },
      { column_name: "source", is_nullable: "NO" },
    ]);
  });
});

describe("migration 0182_volunteers_name_only — a row the club types", () => {
  it("takes no address, no telephone number, or neither", async () => {
    await insert({ source: "STAFF", name: "Fără adresă", email: null, canonical: null, version: null, phone: "+40712345671" });
    await insert({ source: "STAFF", name: "Fără telefon", email: "fara.telefon@example.test", canonical: "fara.telefon@example.test", version: 2, phone: null });
    await insert({ source: "STAFF", name: "Doar Nume", email: null, canonical: null, version: null, phone: null });
    expect((await client.query(`SELECT count(*)::int AS n FROM event_volunteers WHERE source = 'STAFF'`)).rows).toEqual([{ n: 4 }]);
  });

  it("lets two name-only rows of one name both stand, and still refuses one address twice on an event", async () => {
    await insert({ source: "STAFF", name: "Maria Pop", email: null, canonical: null, version: null, phone: null });
    await insert({ source: "STAFF", name: "Maria Pop", email: null, canonical: null, version: null, phone: null });
    expect((await client.query(`SELECT count(*)::int AS n FROM event_volunteers WHERE name = 'Maria Pop'`)).rows).toEqual([{ n: 2 }]);
    await expect(insert({ source: "STAFF", name: "Altă Ana", email: "ana@example.test", canonical: "ana@example.test", version: 2, phone: null })).rejects.toThrow(
      /event_volunteers_event_canonical_email_unique/,
    );
  });

  it("refuses an address without its canonical form or its version, and either of those without an address", async () => {
    for (const values of [
      { email: "a@example.test", canonical: null, version: 2 },
      { email: "a@example.test", canonical: "a@example.test", version: null },
      { email: null, canonical: "a@example.test", version: 2 },
      { email: null, canonical: null, version: 2 },
    ]) {
      await expect(insert({ source: "STAFF", phone: null, ...values }), JSON.stringify(values)).rejects.toThrow(/event_volunteers_address_whole/);
    }
    // Clearing one of the three on a row that has them is refused the same way.
    await expect(client.exec(`UPDATE event_volunteers SET canonical_email = NULL WHERE id = '${ION}'`)).rejects.toThrow(/event_volunteers_address_whole/);
    // Clearing all three of a row the club typed is no refusal: the row is on the list only.
    await client.exec(`UPDATE event_volunteers SET email = NULL, canonical_email = NULL, canonicalization_version = NULL, phone = NULL WHERE id = '${ION}'`);
    expect((await client.query(`SELECT email, phone FROM event_volunteers WHERE id = '${ION}'`)).rows).toEqual([{ email: null, phone: null }]);
  });
});

describe("migration 0182_volunteers_name_only — a row from the public form", () => {
  it("refuses one without an address, and one without a telephone number", async () => {
    await expect(insert({ source: "PUBLIC", name: "Public fără adresă", email: null, canonical: null, version: null, phone: "+40712345672" })).rejects.toThrow(
      /event_volunteers_public_contact/,
    );
    await expect(insert({ source: "PUBLIC", name: "Public fără telefon", email: "pub@example.test", canonical: "pub@example.test", version: 2, phone: null })).rejects.toThrow(
      /event_volunteers_public_contact/,
    );
    await expect(client.exec(`UPDATE event_volunteers SET email = NULL, canonical_email = NULL, canonicalization_version = NULL WHERE id = '${ANA}'`)).rejects.toThrow(
      /event_volunteers_public_contact/,
    );
    await expect(client.exec(`UPDATE event_volunteers SET phone = NULL WHERE id = '${ANA}'`)).rejects.toThrow(/event_volunteers_public_contact/);
  });
});

describe("migration 0182_volunteers_name_only — only an expansion", () => {
  it("is read by the checker as an expansion: dropping a NOT NULL takes nothing away, and the two CHECKs are new", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    for (const column of ["email", "canonical_email", "canonicalization_version", "phone"]) expect(sql).toContain(`ALTER COLUMN "${column}" DROP NOT NULL`);
    expect(sql).toMatch(/ADD CONSTRAINT "event_volunteers_address_whole" CHECK/);
    expect(sql).toMatch(/ADD CONSTRAINT "event_volunteers_public_contact" CHECK/);
    expect(sql).not.toMatch(/DROP COLUMN|DROP TABLE|DROP CONSTRAINT|RENAME|SET NOT NULL|SET DATA TYPE/);
  });
});
