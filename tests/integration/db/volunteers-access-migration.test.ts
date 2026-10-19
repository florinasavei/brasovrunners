import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0171_volunteers_access` (§NNN, amending §754 and §768), proven on real PostgreSQL (PGlite): an event written before it
 * is «Oricine» (`ANYONE`) — what every event was — and a volunteer listed before it is untouched; the choice is a closed set of
 * three; an invitation to volunteer holds one row per address per event, a link's fingerprint once, a line of at most 500
 * characters, and a sign-up only with its moment; its rows go with the event and, when the volunteer goes, lose only the
 * pointer; the outbox knows the new message type; and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0171_volunteers_access";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "aaaaaaaa-0000-4000-8000-000000000002";
const ANA = "cccccccc-0000-4000-8000-000000000001";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`); a migration stacked on it (the volunteers' public list, 0172) comes after and sorts later still.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  for (const later of journal.entries.slice(position + 1)) expect(later.when).toBeGreaterThan(journal.entries[position].when);
  expect(journal.entries[position].idx).toBe(position);

  folder = mkdtempSync(path.join(tmpdir(), "volunteers-access-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // An event and a volunteer as they were before the choice existed.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status, accepts_volunteers) VALUES
      ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT', true),
      ('${OTHER}', 'RACE', '2026-12-21T08:00:00Z', 'DRAFT', false);
    INSERT INTO event_volunteers (id, event_id, name, email, canonical_email, canonicalization_version, phone, state, source) VALUES
      ('${ANA}', '${EVENT}', 'Ana', 'ana@example.test', 'ana@example.test', 2, '+40712345678', 'CONFIRMED', 'PUBLIC');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const insertInvitation = (event: string, email: string, tokenHash: string | null = null) =>
  client.exec(
    `INSERT INTO event_volunteer_invitations (event_id, delivery_email, canonical_email, canonicalization_version, token_hash, sent_at, expires_at)
     VALUES ('${event}', '${email}', '${email.toLowerCase()}', 2, ${tokenHash ? `'${tokenHash}'` : "NULL"}, now(), now() + interval '1 day')`,
  );

describe("migration 0171_volunteers_access — «Cine se poate oferi»", () => {
  it("gives every event written before it «Oricine», and leaves its volunteers and its tick as they were", async () => {
    const { rows } = await client.query(`SELECT id, volunteers_access, accepts_volunteers FROM events ORDER BY id`);
    expect(rows).toEqual([
      { id: EVENT, volunteers_access: "ANYONE", accepts_volunteers: true },
      { id: OTHER, volunteers_access: "ANYONE", accepts_volunteers: false },
    ]);
    expect((await client.query(`SELECT count(*)::int AS n FROM event_volunteers WHERE id = '${ANA}'`)).rows).toEqual([{ n: 1 }]);
  });

  it("is a closed set of three", async () => {
    await expect(client.exec(`UPDATE events SET volunteers_access = 'EVERYBODY' WHERE id = '${EVENT}'`)).rejects.toThrow();
    for (const choice of ["MEMBERS", "INVITED", "ANYONE"]) await client.exec(`UPDATE events SET volunteers_access = '${choice}' WHERE id = '${EVENT}'`);
  });
});

describe("migration 0171_volunteers_access — the invitations", () => {
  it("keeps one invitation per address per event — the same address may be invited to another event — and a link's fingerprint once", async () => {
    await insertInvitation(EVENT, "ioana@example.test", "fingerprint-1");
    await expect(insertInvitation(EVENT, "Ioana@example.test")).rejects.toThrow();
    await insertInvitation(OTHER, "ioana@example.test", "fingerprint-2");
    await expect(client.exec(`UPDATE event_volunteer_invitations SET token_hash = 'fingerprint-1' WHERE event_id = '${OTHER}'`)).rejects.toThrow();
    // None at all (the email is not rendered yet) is allowed any number of times.
    await insertInvitation(EVENT, "a@example.test");
    await insertInvitation(EVENT, "b@example.test");
  });

  it("keeps the club's line to 500 characters in each language, in both languages or neither, and a sign-up only with its moment, and starts in the email's language Romanian", async () => {
    const set = (assignments: string) => client.exec(`UPDATE event_volunteer_invitations SET ${assignments} WHERE canonical_email = 'a@example.test'`);
    await expect(set(`message_ro = '${"x".repeat(501)}', message_en = 'y'`)).rejects.toThrow();
    await expect(set(`message_ro = 'x', message_en = '${"y".repeat(501)}'`)).rejects.toThrow();
    await expect(set(`message_ro = '', message_en = ''`)).rejects.toThrow();
    // One language alone is a cross-language fallback waiting to happen (§354): the table refuses it, whichever side.
    await expect(set(`message_ro = 'Doar română'`)).rejects.toThrow();
    await expect(set(`message_en = 'English only'`)).rejects.toThrow();
    await set(`message_ro = '${"x".repeat(500)}', message_en = '${"y".repeat(500)}'`);
    await set(`message_ro = NULL, message_en = NULL`);
    await expect(set(`volunteer_id = '${ANA}'`)).rejects.toThrow();
    await set(`volunteer_id = '${ANA}', used_at = now()`);
    expect((await client.query(`SELECT locale FROM event_volunteer_invitations WHERE canonical_email = 'a@example.test'`)).rows).toEqual([{ locale: "ro" }]);
  });

  it("loses only the pointer when the volunteer goes, and goes whole with the event", async () => {
    await client.exec(`DELETE FROM event_volunteers WHERE id = '${ANA}'`);
    expect((await client.query(`SELECT volunteer_id, used_at IS NOT NULL AS used FROM event_volunteer_invitations WHERE canonical_email = 'a@example.test'`)).rows).toEqual([
      { volunteer_id: null, used: true },
    ]);
    await client.exec(`DELETE FROM events WHERE id IN ('${EVENT}', '${OTHER}')`);
    expect((await client.query(`SELECT count(*)::int AS n FROM event_volunteer_invitations`)).rows).toEqual([{ n: 0 }]);
  });

  it("gives the outbox a message type for it", async () => {
    await client.exec(`INSERT INTO email_outbox (message_type, locale, recipient_email, idempotency_key, payload_json) VALUES ('VOLUNTEER_INVITATION', 'ro', 'a@example.test', 'k-0171', '{}'::jsonb)`);
    expect((await client.query(`SELECT message_type FROM email_outbox WHERE idempotency_key = 'k-0171'`)).rows).toEqual([{ message_type: "VOLUNTEER_INVITATION" }]);
  });

  it("only expands: a type, a value, a table and a column with a default — nothing dropped or tightened", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
  });
});
