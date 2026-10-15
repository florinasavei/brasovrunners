import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0161_outbox_road_and_failures` (§NNN, amending §149, §676, §772 and §622), proven on real PostgreSQL (PGlite): every
 * outbox row the release before wrote keeps its meaning — no road, no failures, its words never marked deleted — the three new message
 * types can be written, a visitor's message carries its road and its per-road failures, and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0161_outbox_road_and_failures";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const OLD_ROW = "aaaaaaaa-0000-4000-8000-000000000001";
const CONTACT = "aaaaaaaa-0000-4000-8000-000000000002";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), and numbered right after the one it follows.
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);
  expect(journal.entries[position - 1].tag).toBe("0160_volunteer_role_categories");

  folder = mkdtempSync(path.join(tmpdir(), "outbox-road-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // A confirmation as the release before wrote it, sent by Mailgun long ago.
  await client.exec(`
    INSERT INTO email_outbox (id, message_type, locale, recipient_email, payload_json, idempotency_key, status, attempt_count, transport, sent_at)
      VALUES ('${OLD_ROW}', 'REGISTRATION_CONFIRMED', 'ro', 'runner@example.test', '{"eventId":"x"}', 'old:1', 'SENT', 1, 'mailgun', '2026-10-01T08:00:00Z');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0161: the outbox row gains its road, its failures and a body that can be deleted", () => {
  it("leaves a row from before as it was: no road, no failures, words never deleted", async () => {
    const { rows } = await client.query<{ road: string | null; road_failures: unknown; body_deleted_at: string | null; message_type: string; transport: string }>(
      `SELECT road, road_failures, body_deleted_at, message_type, transport FROM email_outbox WHERE id = '${OLD_ROW}'`,
    );
    expect(rows[0]).toMatchObject({ road: null, road_failures: {}, body_deleted_at: null, message_type: "REGISTRATION_CONFIRMED", transport: "mailgun" });
  });

  it("writes a visitor's message with its road and its failures, and the three new types", async () => {
    await client.exec(`
      INSERT INTO email_outbox (id, message_type, locale, recipient_email, payload_json, idempotency_key, road, road_failures)
        VALUES ('${CONTACT}', 'CONTACT_MESSAGE', 'ro', 'club@example.test', '{"subject":"s","text":"t","html":"t","fallbackAllowed":true}', 'relay:1', 'gmail',
                '{"gmail":{"count":2,"ambiguous":false,"lastError":"gmail: smtp EAUTH"}}');
      INSERT INTO email_outbox (message_type, locale, recipient_email, payload_json, idempotency_key, road)
        VALUES ('FEEDBACK_MESSAGE', 'en', 'club@example.test', '{}', 'relay:2', 'mailgun'),
               ('RELAY_NOTICE', 'ro', 'admin@example.test', '{}', 'relay:3', 'gmail');
    `);
    const { rows } = await client.query<{ road: string; road_failures: { gmail: { count: number } } }>(`SELECT road, road_failures FROM email_outbox WHERE id = '${CONTACT}'`);
    expect(rows[0].road).toBe("gmail");
    expect(rows[0].road_failures.gmail.count).toBe(2);
    const { rows: types } = await client.query<{ message_type: string }>(
      `SELECT message_type FROM email_outbox WHERE message_type IN ('CONTACT_MESSAGE', 'FEEDBACK_MESSAGE', 'RELAY_NOTICE') ORDER BY message_type`,
    );
    expect(types.map((row) => row.message_type)).toEqual(["CONTACT_MESSAGE", "FEEDBACK_MESSAGE", "RELAY_NOTICE"]);
  });

  it("marks the deletion of the words with a time, and only expands: no drop, no rename, no tightened column", async () => {
    await client.exec(`UPDATE email_outbox SET payload_json = '{"deleted":true}', body_deleted_at = '2026-10-15T09:00:00Z' WHERE id = '${CONTACT}'`);
    const { rows } = await client.query<{ body_deleted_at: string }>(`SELECT body_deleted_at FROM email_outbox WHERE id = '${CONTACT}'`);
    expect(new Date(rows[0].body_deleted_at).toISOString()).toBe("2026-10-15T09:00:00.000Z");
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
  });
});
