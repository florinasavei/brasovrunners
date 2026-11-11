import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0196_event_volunteer_notes` («Note interne» for volunteers, amending §754's single organizers' line), proven on real
 * PostgreSQL (PGlite): one new table, `event_volunteer_notes` — a note's volunteer (`ON DELETE CASCADE`), its author
 * (`ON DELETE SET NULL`), the words (text, at most 2000 characters), a nullable `deleted_at` — and the carry: every volunteer whose
 * `event_volunteers.note` holds words gets that line as one note, the words verbatim. Its author and moment come from the trail where
 * the trail knows them — the latest «Modifică» whose audit row names the field `note` — else from the row's own creator and moment,
 * else no author. The old column and its CHECK stay as they were: the file only expands. The made-up people here are nobody.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0196_event_volunteer_notes";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_EVENT = "aaaaaaaa-0000-4000-8000-000000000002";
const EDITOR_OLD = "dddddddd-0000-4000-8000-000000000001";
const EDITOR_NEW = "dddddddd-0000-4000-8000-000000000002";
const EDITOR_KIT = "dddddddd-0000-4000-8000-000000000003";
const ADDER = "dddddddd-0000-4000-8000-000000000004";
/** Edited twice with the note named, and once more naming another box only: the newer of the two named rows is the author. */
const EDITED = "eeeeeeee-0000-4000-8000-000000000001";
/** Typed by the club with the note at the add, never edited: the row's own creator and moment. */
const ADDED = "eeeeeeee-0000-4000-8000-000000000002";
/** A line with no trail and no creator (a public row whose edit's trail is gone): no author, the row's moment. */
const UNKNOWN = "eeeeeeee-0000-4000-8000-000000000003";
/** No note at all: no note carried. */
const SILENT = "eeeeeeee-0000-4000-8000-000000000004";
/** On another event; a trail row naming her under the first event's id must not count: the trail is matched on the event too. */
const ELSEWHERE = "eeeeeeee-0000-4000-8000-000000000005";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Right after 0195, and sorting after every migration before it (drizzle applies by `when`).
  expect(journal.entries[position - 1].tag).toBe("0195_invitations_per_person");
  expect(journal.entries[position].when).toBeGreaterThan(Math.max(...journal.entries.slice(0, position).map((entry) => entry.when)));
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-notes-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // What the previous release wrote: the people, their single lines, and the trail of their «Modifică».
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES
      ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT'),
      ('${OTHER_EVENT}', 'RACE', '2026-12-05T08:00:00Z', 'DRAFT');
    INSERT INTO staff_users (id, email, display_name, role) VALUES
      ('${EDITOR_OLD}', 'old@example.test', 'Editor Vechi', 'MODERATOR'),
      ('${EDITOR_NEW}', 'new@example.test', 'Editor Nou', 'ADMIN'),
      ('${EDITOR_KIT}', 'kit@example.test', 'Editor Kit', 'MODERATOR'),
      ('${ADDER}', 'adder@example.test', 'Cine A Adăugat', 'MODERATOR');
    INSERT INTO event_volunteers (id, event_id, name, email, canonical_email, canonicalization_version, phone, source, note, created_by_staff_user_id, created_at, updated_at) VALUES
      ('${EDITED}', '${EVENT}', 'Ana Editată', 'ana@example.test', 'ana@example.test', 2, '+40712345678', 'PUBLIC', 'Sună după 18', NULL, '2026-10-01T10:00:00Z', '2026-10-05T10:00:00Z'),
      ('${ADDED}', '${EVENT}', 'Dan Adăugat', NULL, NULL, NULL, NULL, 'STAFF', 'Prietenul lui Ion', '${ADDER}', '2026-10-02T09:30:00Z', '2026-10-02T09:30:00Z'),
      ('${UNKNOWN}', '${EVENT}', 'Ion Fără Urmă', 'ion@example.test', 'ion@example.test', 2, '+40712345679', 'PUBLIC', 'Are mașină', NULL, '2026-10-03T08:00:00Z', '2026-10-03T08:00:00Z'),
      ('${SILENT}', '${EVENT}', 'Maria Fără Notă', 'maria@example.test', 'maria@example.test', 2, '+40712345670', 'PUBLIC', NULL, NULL, '2026-10-04T08:00:00Z', '2026-10-04T08:00:00Z'),
      ('${ELSEWHERE}', '${OTHER_EVENT}', 'Dana Altundeva', NULL, NULL, NULL, NULL, 'STAFF', 'Doar dimineața', NULL, '2026-10-06T08:00:00Z', '2026-10-06T08:00:00Z');
    INSERT INTO audit_logs (actor_staff_user_id, action, entity_type, entity_id, metadata_json, created_at) VALUES
      ('${EDITOR_OLD}', 'volunteer.edited', 'event', '${EVENT}', '{"volunteerId": "${EDITED}", "fields": ["name", "note"], "assignedRoleIds": []}', '2026-10-03T10:00:00Z'),
      ('${EDITOR_NEW}', 'volunteer.edited', 'event', '${EVENT}', '{"volunteerId": "${EDITED}", "fields": ["note"], "assignedRoleIds": []}', '2026-10-04T11:15:00Z'),
      ('${EDITOR_KIT}', 'volunteer.edited', 'event', '${EVENT}', '{"volunteerId": "${EDITED}", "fields": ["hasKit"], "hasKit": true, "assignedRoleIds": []}', '2026-10-05T10:00:00Z'),
      ('${EDITOR_NEW}', 'volunteer.added', 'event', '${EVENT}', '{"volunteerId": "${UNKNOWN}", "fields": ["note"]}', '2026-10-03T08:00:00Z'),
      -- Dana is on the other event: a row under this event's id that names her is no «Modifică» of hers.
      ('${EDITOR_KIT}', 'volunteer.edited', 'event', '${EVENT}', '{"volunteerId": "${ELSEWHERE}", "fields": ["note"]}', '2026-10-07T08:00:00Z');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

type Carried = { volunteer_id: string; author_staff_user_id: string | null; body: string; created_at: Date; updated_at: Date; deleted_at: Date | null };
const carried = async (volunteerId: string) =>
  (await client.query<Carried>(`SELECT volunteer_id, author_staff_user_id, body, created_at, updated_at, deleted_at FROM event_volunteer_notes WHERE volunteer_id = '${volunteerId}'`)).rows;

describe("migration 0196_event_volunteer_notes — internal notes on a volunteer", () => {
  it("adds the table with the words required and the soft-delete stamp nullable", async () => {
    const result = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'event_volunteer_notes' ORDER BY column_name`,
    );
    expect(result.rows).toEqual([
      { column_name: "author_staff_user_id", data_type: "uuid", is_nullable: "YES" },
      { column_name: "body", data_type: "text", is_nullable: "NO" },
      { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "deleted_at", data_type: "timestamp with time zone", is_nullable: "YES" },
      { column_name: "id", data_type: "uuid", is_nullable: "NO" },
      { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO" },
      { column_name: "volunteer_id", data_type: "uuid", is_nullable: "NO" },
    ]);
  });

  it("carries a line edited in «Modifică» with the latest trail row that names `note`: its actor and its moment", async () => {
    expect(await carried(EDITED)).toEqual([
      { volunteer_id: EDITED, author_staff_user_id: EDITOR_NEW, body: "Sună după 18", created_at: new Date("2026-10-04T11:15:00Z"), updated_at: new Date("2026-10-04T11:15:00Z"), deleted_at: null },
    ]);
  });

  it("carries a line typed at the add, with no trail row naming it, as the row's own creator's at the row's own moment", async () => {
    expect(await carried(ADDED)).toEqual([
      { volunteer_id: ADDED, author_staff_user_id: ADDER, body: "Prietenul lui Ion", created_at: new Date("2026-10-02T09:30:00Z"), updated_at: new Date("2026-10-02T09:30:00Z"), deleted_at: null },
    ]);
  });

  it("carries a line nobody can be named for with no author — an `added` row, or another event's trail, is no «Modifică» of it", async () => {
    expect(await carried(UNKNOWN)).toEqual([
      { volunteer_id: UNKNOWN, author_staff_user_id: null, body: "Are mașină", created_at: new Date("2026-10-03T08:00:00Z"), updated_at: new Date("2026-10-03T08:00:00Z"), deleted_at: null },
    ]);
    // A row naming the volunteer under ANOTHER event's id is not that volunteer's «Modifică»: the trail is matched on the event too.
    expect(await carried(ELSEWHERE)).toMatchObject([{ author_staff_user_id: null, body: "Doar dimineața", created_at: new Date("2026-10-06T08:00:00Z") }]);
  });

  it("carries nothing for a volunteer with no note, and one note — never two — for each line", async () => {
    expect(await carried(SILENT)).toEqual([]);
    expect((await client.query<{ total: number }>(`SELECT count(*)::int AS total FROM event_volunteer_notes`)).rows[0].total).toBe(4);
  });

  it("leaves the old column and its CHECK as they were: the words still there, a line past 500 still refused", async () => {
    const lines = await client.query<{ id: string; note: string | null }>(`SELECT id, note FROM event_volunteers ORDER BY created_at`);
    expect(lines.rows.map((row) => row.note)).toEqual(["Sună după 18", "Prietenul lui Ion", "Are mașină", null, "Doar dimineața"]);
    await expect(client.exec(`UPDATE event_volunteers SET note = '${"x".repeat(501)}' WHERE id = '${SILENT}'`)).rejects.toThrow(/event_volunteers_note_length/);
  });

  it("deletes a volunteer's notes with them (CASCADE), and keeps a note whose author goes (SET NULL)", async () => {
    await client.exec(`DELETE FROM staff_users WHERE id = '${ADDER}'`);
    expect(await carried(ADDED)).toMatchObject([{ author_staff_user_id: null, body: "Prietenul lui Ion" }]);
    await client.exec(`DELETE FROM event_volunteers WHERE id = '${EDITED}'`);
    expect(await carried(EDITED)).toEqual([]);
  });

  it("only expands: a table, its keys and an INSERT … SELECT — nothing dropped, renamed or changed", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql.replace(/^--.*$/gm, "");
    expect(statements).not.toMatch(/DROP |RENAME |ALTER COLUMN|SET NOT NULL/i);
    expect(statements.match(/CREATE TABLE/g)).toHaveLength(1);
    expect(statements).toMatch(/event_volunteer_notes_volunteer_id_event_volunteers_id_fk" FOREIGN KEY \("volunteer_id"\) REFERENCES "public"\."event_volunteers"\("id"\) ON DELETE cascade/);
    expect(statements).toMatch(/event_volunteer_notes_author_staff_user_id_staff_users_id_fk" FOREIGN KEY \("author_staff_user_id"\) REFERENCES "public"\."staff_users"\("id"\) ON DELETE set null/);
    // Containment, never the `?` operator (a driver reads `?` as a placeholder).
    expect(statements).toMatch(/@>/);
    expect(statements).not.toMatch(/metadata_json"\s*\?/);
  });
});
