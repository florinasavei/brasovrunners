import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0224_list_consent_recorded_email` (§NNN; the owner, 2026-11-20: «dacă cineva are semnul ăsta de „Anonim” trebuie să
 * îl pot schimba în „Cu nume” la click, dar cu acordul lor»), proven on real PostgreSQL (PGlite): `LIST_CONSENT_RECORDED` becomes a
 * message type — after every value before it, each where it was — so the outbox takes the email the desk's eye queues, and a row
 * queued by the release before reads as it did. Nothing else: the wish is the registration's own `list_opt_out` and who recorded
 * it is the audit row's actor, so no table and no column; and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0224_list_consent_recorded_email";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const labels = async (client: PGlite) =>
  (
    await client.query<{ enumlabel: string }>(
      `SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'email_message_type' ORDER BY e.enumsortorder`,
    )
  ).rows.map((row) => row.enumlabel);

const queue = (client: PGlite, type: string, key: string) =>
  client.exec(`INSERT INTO email_outbox (message_type, locale, recipient_email, payload_json, idempotency_key) VALUES ('${type}', 'ro', 'ana@example.test', '{}', '${key}')`);

let client: PGlite;
let folder: string;
let before: string[];
let position: number;
let journal: Journal;

beforeAll(async () => {
  journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), numbered right after the one before it.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "list-consent-recorded-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The world as the release before left it: a participant's message queued, and no such type as the desk's.
  before = await labels(client);
  await queue(client, "BIB_ASSIGNED", "registration:before-0224:bib");
  await expect(queue(client, "LIST_CONSENT_RECORDED", "registration:too-early:list-consent-recorded")).rejects.toThrow(/invalid input value for enum/i);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0224_list_consent_recorded_email", () => {
  it("adds LIST_CONSENT_RECORDED after every value before it, and moves none", async () => {
    expect(before).not.toContain("LIST_CONSENT_RECORDED");
    const after = await labels(client);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after[before.length]).toBe("LIST_CONSENT_RECORDED");
  });

  it("leaves a message queued before it as it was, and takes the desk's message once a key", async () => {
    await queue(client, "LIST_CONSENT_RECORDED", "registration:r:list-consent-recorded:a");
    await expect(queue(client, "LIST_CONSENT_RECORDED", "registration:r:list-consent-recorded:a")).rejects.toThrow(/unique|duplicate/i);
    const rows = (await client.query<{ message_type: string }>(`SELECT message_type FROM email_outbox ORDER BY message_type`)).rows;
    expect(rows.map((row) => row.message_type)).toEqual(["BIB_ASSIGNED", "LIST_CONSENT_RECORDED"]);
  });

  it("adds no table and no column", async () => {
    const through = mkdtempSync(path.join(tmpdir(), "list-consent-recorded-through-"));
    cpSync(MIGRATIONS, through, { recursive: true });
    writeFileSync(path.join(through, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position + 1) }));
    const earlier = new PGlite();
    const after = new PGlite();
    const columns = async (database: PGlite) =>
      (await database.query<{ name: string }>(`SELECT table_name || '.' || column_name AS name FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1`)).rows.map((row) => row.name);
    try {
      await migrate(drizzle(earlier), { migrationsFolder: folder });
      await migrate(drizzle(after), { migrationsFolder: through });
      expect(await columns(after)).toEqual(await columns(earlier));
    } finally {
      await earlier.close();
      await after.close();
      rmSync(through, { recursive: true, force: true });
    }
  });

  it("is read by the checker as an expansion: the one value", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual([`ALTER TYPE "public"."email_message_type" ADD VALUE 'LIST_CONSENT_RECORDED';`]);
  });
});
