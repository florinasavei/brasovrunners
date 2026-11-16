import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0210_volunteer_point_email` (§NNN; the owner, 2026-11-16: «…si sa ii pot distribui din aplicatie, sa stie exact
 * unde si cum» — «Email din site, la apăsarea ta»), proven on real PostgreSQL (PGlite): `VOLUNTEER_POINT` becomes a message
 * type — the last value of the enum, every earlier one where it was — so the outbox takes the message «Trimite fiecăruia
 * punctul lui» queues, and a row queued by the release before reads as it did. Nothing else: no table and no column — which
 * point a person was already told is read from the outbox's own rows, held one a key by the unique key that was already
 * there — and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0210_volunteer_point_email";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const labels = async (client: PGlite) =>
  (
    await client.query<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'email_message_type' ORDER BY e.enumsortorder`,
    )
  ).rows.map((row) => row.enumlabel);

/** One outbox row as a press writes it: no participant, no registration, the ids in the payload. */
const queue = (client: PGlite, type: string, key: string) =>
  client.exec(
    `INSERT INTO email_outbox (message_type, locale, recipient_email, payload_json, idempotency_key)
     VALUES ('${type}', 'ro', 'ana@example.test', '{"volunteerId":"aaaaaaaa-0000-4000-8000-000000000210"}', '${key}')`,
  );

let client: PGlite;
let folder: string;
let before: string[];

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), numbered right after the newest one shipped before it, the race-day decision (0209); this one was 0208 on its own branch and was renumbered at the merge, because production had already run 0209.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);
  expect(journal.entries[position - 1].tag).toBe("0209_volunteer_race_day_decision");

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-point-email-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The world as the release before left it: the role's message queued, and no such type as the point's.
  before = await labels(client);
  await queue(client, "VOLUNTEER_ROLE_ASSIGNED", "volunteer-role-assigned:before-0210");
  await expect(queue(client, "VOLUNTEER_POINT", "volunteer-point:too-early")).rejects.toThrow(/invalid input value for enum/i);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0210_volunteer_point_email", () => {
  it("adds VOLUNTEER_POINT as the enum's last value, and moves no value that was there", async () => {
    expect(before).not.toContain("VOLUNTEER_POINT");
    const after = await labels(client);
    // Every later migration that adds a type appends after it, so only what stands before it is pinned.
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after[before.length]).toBe("VOLUNTEER_POINT");
  });

  it("leaves a message queued before it as it was, and takes the point's message", async () => {
    const rows = async () => (await client.query<{ message_type: string; idempotency_key: string; status: string }>(`SELECT message_type, idempotency_key, status FROM email_outbox ORDER BY created_at, idempotency_key`)).rows;
    expect(await rows()).toEqual([{ message_type: "VOLUNTEER_ROLE_ASSIGNED", idempotency_key: "volunteer-role-assigned:before-0210", status: "PENDING" }]);
    await queue(client, "VOLUNTEER_POINT", "volunteer-point:v:p:1");
    expect((await rows()).map((row) => row.message_type).sort()).toEqual(["VOLUNTEER_POINT", "VOLUNTEER_ROLE_ASSIGNED"]);
  });

  it("keeps one row a key — the unique key the «not twice» memory stands on was there already, and still is", async () => {
    await queue(client, "VOLUNTEER_POINT", "volunteer-point:v:p:2");
    await expect(queue(client, "VOLUNTEER_POINT", "volunteer-point:v:p:2")).rejects.toThrow(/unique|duplicate/i);
    // Another telling of the same person and point is another key, and another row.
    await queue(client, "VOLUNTEER_POINT", "volunteer-point:v:p:3");
    expect((await client.query(`SELECT 1 FROM email_outbox WHERE idempotency_key LIKE 'volunteer-point:v:p:%'`)).rows.length).toBeGreaterThanOrEqual(2);
  });

  it("adds no table and no column: the outbox and the volunteers' rows are shaped as the migration before left them", async () => {
    const columnsOf = async (database: PGlite, table: string) =>
      (await database.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`)).rows.map((row) => row.column_name);
    const tablesOf = async (database: PGlite) =>
      (await database.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`)).rows.map((row) => row.table_name);
    // The same world stopped one migration short.
    const earlier = new PGlite();
    try {
      await migrate(drizzle(earlier), { migrationsFolder: folder });
      expect(await tablesOf(client)).toEqual(await tablesOf(earlier));
      for (const table of ["email_outbox", "event_volunteers", "events"]) expect(await columnsOf(client, table), table).toEqual(await columnsOf(earlier, table));
    } finally {
      await earlier.close();
    }
  });

  it("is read by the checker as an expansion: the one value, exactly as every message type before it was added", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual([`ALTER TYPE "public"."email_message_type" ADD VALUE 'VOLUNTEER_POINT';`]);
  });
});
