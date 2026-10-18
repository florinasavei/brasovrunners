import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0168_rsvp_core` («Vin!» part 1, §811), proven on real PostgreSQL (PGlite): `events.rsvp_enabled` is the club's tick, a boolean
 * NOT NULL false by default — so every event that exists, and every one created without it, takes no answers; `event_rsvps` is one row
 * per event and canonical identity; `event_rsvp_tokens` keeps only a SHA-256; `person_sessions` keeps only a SHA-256 too; `RSVP_CONFIRM`
 * is a message type; and the file only expands — nothing dropped, nothing rewritten.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0168_rsvp_core";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const OLD = "22222222-0000-4000-8000-000000000001";
const NEW = "22222222-0000-4000-8000-000000000002";
const ON = "22222222-0000-4000-8000-000000000003";
const HASH = "a".repeat(64);

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const at = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(at, "the journal lists the migration").toBeGreaterThan(0);
  // It sorts after every migration before it — drizzle applies by `when` — and is the next number after the last shipped one.
  expect(journal.entries[at].when).toBeGreaterThan(journal.entries[at - 1].when);
  expect(journal.entries[at].idx).toBe(journal.entries[at - 1].idx + 1);
  expect(journal.entries[at - 1].tag.slice(0, 4)).toBe("0167");

  folder = mkdtempSync(path.join(tmpdir(), "rsvp-core-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The world as 0167 left it: a group run.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, timezone, editorial_status) VALUES ('${OLD}', 'GROUP_RUN', '2026-11-21T07:00:00Z', 'Europe/Bucharest', 'DRAFT');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const ticked = async (id: string) => (await client.query<{ rsvp_enabled: boolean }>(`SELECT rsvp_enabled FROM events WHERE id = '${id}'`)).rows[0]?.rsvp_enabled;
const answer = (eventId: string, canonical: string, extra = "") =>
  client.exec(
    `INSERT INTO event_rsvps (event_id, delivery_email, canonical_email, canonicalization_version, locale, privacy_notice_version ${extra ? `, ${extra.split("=")[0]}` : ""})
     VALUES ('${eventId}', '${canonical}', '${canonical}', 2, 'ro', 1 ${extra ? `, ${extra.split("=")[1]}` : ""})`,
  );

describe("migration 0168_rsvp_core — the data for «Vin!»", () => {
  it("adds the club's tick NOT NULL with a default of false, and leaves an event written before it off", async () => {
    const { rows } = await client.query<{ data_type: string; is_nullable: string; column_default: string }>(
      `SELECT data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'rsvp_enabled'`,
    );
    expect(rows).toEqual([{ data_type: "boolean", is_nullable: "NO", column_default: "false" }]);
    expect(await ticked(OLD)).toBe(false);
    await client.exec(`
      INSERT INTO events (id, type, starts_at, timezone, editorial_status) VALUES ('${NEW}', 'GROUP_RUN', '2026-12-05T07:00:00Z', 'Europe/Bucharest', 'DRAFT');
      INSERT INTO events (id, type, starts_at, timezone, editorial_status, rsvp_enabled) VALUES ('${ON}', 'GROUP_RUN', '2026-12-12T07:00:00Z', 'Europe/Bucharest', 'DRAFT', true);
    `);
    expect(await ticked(NEW)).toBe(false);
    expect(await ticked(ON)).toBe(true);
    await expect(client.exec(`UPDATE events SET rsvp_enabled = NULL WHERE id = '${OLD}'`)).rejects.toThrow();
  });

  it("keeps one answer per event and canonical identity, not confirmed and not named until the person says so", async () => {
    await answer(ON, "ana@example.test");
    await expect(answer(ON, "ana@example.test")).rejects.toThrow(/unique|duplicate/i);
    // Another event is another list.
    await answer(NEW, "ana@example.test");
    const { rows } = await client.query<{ show_name: boolean; confirmed_at: string | null; display_name: string | null }>(
      `SELECT show_name, confirmed_at, display_name FROM event_rsvps WHERE event_id = '${ON}'`,
    );
    expect(rows).toEqual([{ show_name: false, confirmed_at: null, display_name: null }]);
  });

  it("bounds a shown name to eighty characters, in the answer and in the remembered browser", async () => {
    await expect(answer(ON, "long@example.test", `display_name='${"x".repeat(81)}'`)).rejects.toThrow(/check|violates/i);
    await answer(ON, "ok@example.test", `display_name='${"x".repeat(80)}'`);
    await expect(
      client.exec(`INSERT INTO person_sessions (canonical_email, delivery_email, canonicalization_version, display_name, secret_hash, expires_at) VALUES ('a@b.test','a@b.test',2,'${"x".repeat(81)}','${HASH}', now())`),
    ).rejects.toThrow(/check|violates/i);
  });

  it("goes with its event: deleting the event deletes its answers and their links", async () => {
    await client.exec(`INSERT INTO events (id, type, starts_at, timezone, editorial_status) VALUES ('22222222-0000-4000-8000-000000000009', 'GROUP_RUN', '2026-12-19T07:00:00Z', 'Europe/Bucharest', 'DRAFT')`);
    await answer("22222222-0000-4000-8000-000000000009", "gone@example.test");
    await client.exec(
      `INSERT INTO event_rsvp_tokens (rsvp_id, purpose, token_hash, expires_at) SELECT id, 'RSVP_WITHDRAW', '${"b".repeat(64)}', now() + interval '1 day' FROM event_rsvps WHERE canonical_email = 'gone@example.test'`,
    );
    await client.exec(`DELETE FROM events WHERE id = '22222222-0000-4000-8000-000000000009'`);
    expect((await client.query(`SELECT 1 FROM event_rsvps WHERE canonical_email = 'gone@example.test'`)).rows).toHaveLength(0);
    expect((await client.query(`SELECT 1 FROM event_rsvp_tokens WHERE token_hash = '${"b".repeat(64)}'`)).rows).toHaveLength(0);
  });

  it("stores only a SHA-256 in a link and in a remembered browser — the database refuses a raw secret — and one live link per answer and purpose", async () => {
    const secret = "A".repeat(43);
    await expect(
      client.exec(`INSERT INTO event_rsvp_tokens (rsvp_id, purpose, token_hash, expires_at) SELECT id, 'RSVP_CONFIRM', '${secret}', now() + interval '1 day' FROM event_rsvps LIMIT 1`),
    ).rejects.toThrow(/check|violates/i);
    await expect(
      client.exec(`INSERT INTO person_sessions (canonical_email, delivery_email, canonicalization_version, secret_hash, expires_at) VALUES ('a@b.test','a@b.test',2,'${secret}', now())`),
    ).rejects.toThrow(/check|violates/i);

    const insert = (hash: string, purpose = "RSVP_CONFIRM") =>
      client.exec(`INSERT INTO event_rsvp_tokens (rsvp_id, purpose, token_hash, expires_at) SELECT id, '${purpose}', '${hash}', now() + interval '1 day' FROM event_rsvps WHERE event_id = '${ON}' AND canonical_email = 'ana@example.test'`);
    await insert("c".repeat(64));
    await expect(insert("d".repeat(64))).rejects.toThrow(/unique|duplicate/i);
    await insert("e".repeat(64), "RSVP_WITHDRAW");
    // A spent or superseded link frees the slot for the next one.
    await client.exec(`UPDATE event_rsvp_tokens SET used_at = now() WHERE token_hash = '${"c".repeat(64)}'`);
    await insert("f".repeat(64));
    // A link that expires before it was made is a clock bug, refused.
    await expect(
      client.exec(`INSERT INTO event_rsvp_tokens (rsvp_id, purpose, token_hash, expires_at, created_at) SELECT id, 'RSVP_CONFIRM', '${"9".repeat(64)}', now() - interval '1 day', now() FROM event_rsvps LIMIT 1`),
    ).rejects.toThrow(/check|violates/i);
  });

  it("knows RSVP_CONFIRM as a message type, and nothing else new in the enum", async () => {
    const { rows } = await client.query<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'email_message_type' ORDER BY e.enumsortorder DESC LIMIT 2`,
    );
    expect(rows.map((row) => row.enumlabel)).toEqual(["RSVP_CONFIRM", "RELAY_NOTICE"]);
  });

  it("is an expand: tables, a column with a default and one enum value — nothing dropped, narrowed or rewritten", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(sql).toContain(`ALTER TABLE "events" ADD COLUMN "rsvp_enabled" boolean DEFAULT false NOT NULL;`);
    // `ON DELETE cascade` is a foreign key's rule, not a statement that deletes.
    expect(sql).not.toMatch(/\bDROP\b|ALTER COLUMN|\bRENAME\b|^DELETE |^UPDATE /im);
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
  });
});
