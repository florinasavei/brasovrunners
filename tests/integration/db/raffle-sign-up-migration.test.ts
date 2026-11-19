import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migrations `0216_raffle_rules_key` and `0217_raffle_sign_up` (§984; the owner, 2026-11-18: «Vreau să pot bifa asta: tombolă din
 * oficiu vs tombolă cu înscriere separată»), proven on real PostgreSQL (PGlite) over a database migrated by the release before
 * (BR-REQ-053-01 for the legal document's key):
 *
 * - `0216` adds the enum value `RAFFLE_RULES` alone, in a file of its own — PostgreSQL refuses a new enum value used in the
 *   transaction that adds it, so nothing else is in that file;
 * - `0217` gives every event from before the three groups ticked, «Din oficiu» and the sign-ups shut — no raffle changes by itself —,
 *   every line of the elite list in the raffle and not present, and a table of sign-ups: exactly one person per row, each person
 *   once, the typed name the public form's alone, the trace the electronic doors' alone, the recorder the staff's alone, the rules'
 *   fingerprint a SHA-256, a version somebody accepted never deleted under it, and the row gone with its person or its event;
 * - both only expand.
 */
const MIGRATIONS = "src/db/migrations";
const KEY_TAG = "0216_raffle_rules_key";
const TAG = "0217_raffle_sign_up";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000217";
const OTHER_EVENT = "abababab-0000-4000-8000-000000000217";
const LINE = "bbbbbbbb-0000-4000-8000-000000000217";
const ANA = "cccccccc-0000-4000-8000-000000000217";
const ION = "dddddddd-0000-4000-8000-000000000217";
const RULES = "eeeeeeee-0000-4000-8000-000000000217";
const PARTICIPANT = "ffffffff-0000-4000-8000-000000000217";
const STAFF = "f0f0f0f0-0000-4000-8000-000000000217";
const HASH = "a".repeat(64);

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const keyAt = journal.entries.findIndex((entry) => entry.tag === KEY_TAG);
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(keyAt, "the journal lists the enum's own migration").toBeGreaterThan(0);
  // The enum's value first, in its own migration, and the table right after it.
  expect(position).toBe(keyAt + 1);
  for (const at of [keyAt, position]) {
    expect(journal.entries[at].when).toBeGreaterThan(journal.entries[at - 1].when);
    expect(journal.entries[at].idx).toBe(journal.entries[at - 1].idx + 1);
  }

  folder = mkdtempSync(path.join(tmpdir(), "raffle-sign-up-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, keyAt) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The release before: a race holding a raffle, another without one, a line of its elite list, a runner and a volunteer.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status, published_at, has_raffle) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'PUBLISHED', '2026-11-01T08:00:00Z', true);
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${OTHER_EVENT}', 'RACE', '2026-12-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_elite_entries (id, event_id, name, bib_number) VALUES ('${LINE}', '${EVENT}', 'Eliud K.', 777);
    INSERT INTO participants (id, delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ('${PARTICIPANT}', 'ana@example.test', 'ana@example.test', 'ana@example.test', 2, 'Ana');
    INSERT INTO registrations (id, event_id, participant_id, status, locale, registered_name, display_name, privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version, bib_number, confirmed_at)
      VALUES ('${ANA}', '${EVENT}', '${PARTICIPANT}', 'CONFIRMED', 'ro', 'Ana Pop', 'Ana Pop', 1, '2026-11-01T08:00:00Z', false, 1, 1, '2026-11-01T08:00:00Z');
    INSERT INTO event_volunteers (id, event_id, name, state, source, bib_number) VALUES ('${ION}', '${EVENT}', 'Ion', 'CONFIRMED', 'STAFF', 500);
    INSERT INTO staff_users (id, email, display_name, role) VALUES ('${STAFF}', 'desk@example.test', 'Desk', 'CONTRIBUTOR');
  `);
  await expect(client.query(`SELECT raffle_sign_up FROM events`)).rejects.toThrow();
  await migrate(db, { migrationsFolder: MIGRATIONS });
  await client.exec(`INSERT INTO legal_documents (id, key, version, effective_at, is_approved, content_sha256) VALUES ('${RULES}', 'RAFFLE_RULES', 1, '2026-11-01T00:00:00Z', true, '${HASH}')`);
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

/** A sign-up as a door writes it, the person and the door's columns given. */
function entry(person: string, method: string, extra: Record<string, string | null> = {}): string {
  const columns = { event_id: `'${EVENT}'`, method: `'${method}'`, rules_document_id: `'${RULES}'`, rules_accepted_at: "now()", rules_locale: "'ro'", rules_text_hash: `'${HASH}'`, rules_facts: `'{}'`, privacy_notice_version: "1" };
  const all = { ...columns, ...Object.fromEntries(Object.entries({ ...personOf(person), ...extra }).map(([key, value]) => [key, value === null ? "NULL" : `'${value}'`])) };
  return `INSERT INTO event_raffle_entries (${Object.keys(all).join(", ")}) VALUES (${Object.values(all).join(", ")})`;
}
const personOf = (person: string): Record<string, string> => (person === ANA ? { registration_id: ANA } : person === ION ? { volunteer_id: ION } : { elite_entry_id: LINE });

describe("migration 0216_raffle_rules_key", () => {
  it("adds the one enum value, alone in its file, as an expansion", async () => {
    const sql = readFileSync(`${MIGRATIONS}/${KEY_TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    expect(sql.trim()).toBe(`ALTER TYPE "public"."legal_document_key" ADD VALUE 'RAFFLE_RULES';`);
    const values = (await client.query<{ value: string }>(`SELECT unnest(enum_range(NULL::legal_document_key))::text AS value`)).rows.map((row) => row.value);
    // Right after the volunteer agreement; a later migration appends the team's undertaking after it (`0221`, §1006).
    expect(values.indexOf("RAFFLE_RULES")).toBe(values.indexOf("VOLUNTEER_AGREEMENT") + 1);
    expect(values).toContain("VOLUNTEER_AGREEMENT");
  });
});

describe("migration 0217_raffle_sign_up", () => {
  it("changes no event's raffle by itself: the three groups ticked, «Din oficiu», the sign-ups shut", async () => {
    expect((await client.query(`SELECT id, has_raffle, raffle_runners, raffle_elites, raffle_volunteers, raffle_sign_up, raffle_sign_up_open FROM events ORDER BY id`)).rows).toEqual([
      { id: EVENT, has_raffle: true, raffle_runners: true, raffle_elites: true, raffle_volunteers: true, raffle_sign_up: false, raffle_sign_up_open: false },
      { id: OTHER_EVENT, has_raffle: false, raffle_runners: true, raffle_elites: true, raffle_volunteers: true, raffle_sign_up: false, raffle_sign_up_open: false },
    ]);
  });

  it("puts every line of the elite list in the raffle, not present — the organizers' two ticks", async () => {
    expect((await client.query(`SELECT in_raffle, present FROM event_elite_entries WHERE id = '${LINE}'`)).rows).toEqual([{ in_raffle: true, present: false }]);
    await expect(client.exec(`UPDATE event_elite_entries SET in_raffle = NULL WHERE id = '${LINE}'`)).rejects.toThrow();
    await expect(client.exec(`UPDATE event_elite_entries SET present = NULL WHERE id = '${LINE}'`)).rejects.toThrow();
  });

  it("keeps a sign-up of exactly one person, each person once", async () => {
    await client.exec(entry(ANA, "FORM", { typed_name: "Ana Pop", ip: "203.0.113.9", user_agent: "Mozilla/5.0" }));
    await client.exec(entry(ION, "STAFF", { recorded_by_staff_user_id: STAFF }));
    await client.exec(entry(LINE, "DESK", { recorded_by_staff_user_id: STAFF }));
    // Nobody, or two people in one row.
    await expect(client.exec(entry(ANA, "LINK").replace(`'${ANA}'`, "NULL"))).rejects.toThrow();
    await expect(client.exec(entry(ANA, "LINK", { volunteer_id: ION }))).rejects.toThrow();
    // The same person twice.
    await expect(client.exec(entry(ANA, "LINK"))).rejects.toThrow();
    await expect(client.exec(entry(ION, "STAFF"))).rejects.toThrow();
    expect((await client.query(`SELECT count(*)::int AS n FROM event_raffle_entries`)).rows).toEqual([{ n: 3 }]);
  });

  it("holds each door to its own columns: the typed name the form's, the trace the electronic doors', the recorder the staff's", async () => {
    await client.exec(`DELETE FROM event_raffle_entries`);
    await expect(client.exec(entry(ANA, "LINK", { typed_name: "Ana Pop" }))).rejects.toThrow();
    await expect(client.exec(entry(ANA, "FORM", { typed_name: "" }))).rejects.toThrow();
    await expect(client.exec(entry(ANA, "DESK", { ip: "203.0.113.9" }))).rejects.toThrow();
    await expect(client.exec(entry(ANA, "STAFF", { user_agent: "Mozilla/5.0" }))).rejects.toThrow();
    await expect(client.exec(entry(ANA, "LINK", { recorded_by_staff_user_id: STAFF }))).rejects.toThrow();
    await expect(client.exec(entry(ANA, "FORM", { rules_text_hash: "not-a-hash" }))).rejects.toThrow();
    await expect(client.exec(entry(ANA, "FORM", { privacy_notice_version: "0" }))).rejects.toThrow();
    await expect(client.exec(entry(ANA, "POST"))).rejects.toThrow();
    await client.exec(entry(ANA, "LINK", { ip: "203.0.113.9", user_agent: "Mozilla/5.0" }));
    expect((await client.query(`SELECT method, typed_name, ip, recorded_by_staff_user_id FROM event_raffle_entries`)).rows).toEqual([{ method: "LINK", typed_name: null, ip: "203.0.113.9", recorded_by_staff_user_id: null }]);
  });

  it("never deletes a version of the rules somebody accepted, and goes with its person, its event or its recorder's account", async () => {
    await expect(client.exec(`DELETE FROM legal_documents WHERE id = '${RULES}'`)).rejects.toThrow(/event_raffle_entries/);
    await client.exec(`DELETE FROM event_raffle_entries`);
    await client.exec(entry(ANA, "FORM", { typed_name: "Ana Pop" }));
    await client.exec(entry(ION, "STAFF", { recorded_by_staff_user_id: STAFF }));
    await client.exec(entry(LINE, "STAFF", { recorded_by_staff_user_id: STAFF }));
    // The recorder's account goes: the sign-up stays, its recorder unknown.
    await client.exec(`DELETE FROM staff_users WHERE id = '${STAFF}'`);
    expect((await client.query(`SELECT count(*)::int AS n FROM event_raffle_entries WHERE recorded_by_staff_user_id IS NULL`)).rows).toEqual([{ n: 3 }]);
    await client.exec(`DELETE FROM registrations WHERE id = '${ANA}'`);
    await client.exec(`DELETE FROM event_volunteers WHERE id = '${ION}'`);
    expect((await client.query(`SELECT elite_entry_id FROM event_raffle_entries`)).rows).toEqual([{ elite_entry_id: LINE }]);
    await client.exec(`DELETE FROM events WHERE id = '${EVENT}'`);
    expect((await client.query(`SELECT count(*)::int AS n FROM event_raffle_entries`)).rows).toEqual([{ n: 0 }]);
  });

  it("is read by the checker as an expansion", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    expect(sql).not.toMatch(/\bDROP\b|\bRENAME\b|ALTER COLUMN/i);
  });
});
