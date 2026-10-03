import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration `0127_answers_written_at` (`DECISIONS.md` §NNN), proven on real PostgreSQL (PGlite): the
 * database is built up to the migration before it, registrations are written the way the previous
 * release wrote them — without the column — and then the rest of the migrations run over them, as
 * `yarn db:migrate:env` runs them over production.
 *
 * - every existing row ends with `answers_written_at = created_at`: what the minors' sweep (§323) and
 *   the correction's guardian and socials rules (§645) read until now, so none is judged differently;
 * - a row inserted without the column afterwards (the previous release's, during a deploy) is dated by
 *   its own insert, never by the migration;
 * - the file adds that one column and backfills it — no drop, no rename (AGENTS.md §7.6).
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0127_answers_written_at";
const CREATED = ["2026-05-01T09:00:00.000Z", "2026-08-14T23:30:00.000Z", "2026-09-30T12:00:00.000Z"];

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

let client: PGlite;
let folder: string;
let columnsBefore: string[];

async function registrationColumns() {
  const { rows } = await client.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'registrations' ORDER BY column_name",
  );
  return rows.map((row) => row.column_name);
}

async function insertRegistration(email: string, createdAt: string | null) {
  const {
    rows: [participant],
  } = await client.query<{ id: string }>(
    "INSERT INTO participants (delivery_email, normalized_email, canonical_email, canonicalization_version, default_name) VALUES ($1, $1, $1, 1, 'Ana Pop') RETURNING id",
    [email],
  );
  const {
    rows: [event],
  } = await client.query<{ id: string }>("SELECT id FROM events LIMIT 1");
  const columns = "event_id, participant_id, status, locale, registered_name, display_name, privacy_notice_version, privacy_acknowledged_at, results_name_consent, results_consent_version";
  const values = "$1, $2, 'PENDING_EMAIL_CONFIRMATION', 'ro', 'Ana Pop', 'Ana P.', 1, now(), false, 1";
  const {
    rows: [row],
  } = await client.query<{ id: string }>(
    createdAt === null
      ? `INSERT INTO registrations (${columns}) VALUES (${values}) RETURNING id`
      : `INSERT INTO registrations (${columns}, created_at) VALUES (${values}, $3) RETURNING id`,
    createdAt === null ? [event.id, participant.id] : [event.id, participant.id, createdAt],
  );
  return row.id;
}

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  expect(journal.entries[position - 1].tag).toBe("0126_hidden_list");

  // Every migration before this one, in a folder of its own.
  folder = mkdtempSync(path.join(tmpdir(), "answers-written-at-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // Registrations the previous release wrote, each on its own creation instant.
  await client.query("INSERT INTO events (type, starts_at) VALUES ('RACE', '2026-11-21T08:00:00Z')");
  for (const [index, createdAt] of CREATED.entries()) await insertRegistration(`runner${index}@example.ro`, createdAt);
  columnsBefore = await registrationColumns();
  // Then the rest, this migration among them, over those rows.
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("§NNN migration 0127_answers_written_at — the day the answers were written", () => {
  it("backfills every existing row from its created_at, so none is judged differently", async () => {
    const { rows } = await client.query<{ created_at: Date; answers_written_at: Date }>(
      "SELECT created_at, answers_written_at FROM registrations ORDER BY created_at",
    );
    expect(rows.map((row) => row.created_at.toISOString())).toEqual(CREATED);
    for (const row of rows) expect(row.answers_written_at.toISOString()).toBe(row.created_at.toISOString());
  });

  it("adds only the column: NOT NULL, its default the insert's own instant", async () => {
    expect((await registrationColumns()).filter((column) => !columnsBefore.includes(column))).toEqual(["answers_written_at"]);
    const { rows: column } = await client.query<{ is_nullable: string; column_default: string | null }>(
      "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'registrations' AND column_name = 'answers_written_at'",
    );
    expect(column[0]).toEqual({ is_nullable: "NO", column_default: "now()" });
    // A row the previous release inserts during the deploy, without the column: dated by its own insert.
    const id = await insertRegistration("late@example.ro", null);
    const { rows } = await client.query<{ same: boolean }>("SELECT answers_written_at = created_at AS same FROM registrations WHERE id = $1", [id]);
    expect(rows[0].same).toBe(true);
  });

  it("is expand-only: it adds and backfills, and drops or renames nothing (AGENTS.md §7.6)", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE|TYPE|NOT NULL)|RENAME/i);
    expect(sql).toMatch(/ADD COLUMN "answers_written_at" timestamp with time zone DEFAULT now\(\) NOT NULL/);
    expect(sql).toMatch(/UPDATE "registrations" SET "answers_written_at" = "created_at"/);
  });
});
