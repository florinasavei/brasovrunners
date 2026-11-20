import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0227_volunteer_raffle_confirmation` (§NNN, amending §984 and §1023; the owner, 2026-11-20: «vreau să pot să o confirm și
 * pe [ea] pentru tombolă, chiar și fără acordul părinților»), proven on real PostgreSQL (PGlite): four nullable columns on the
 * event's volunteers — when the organizers confirmed the person for the raffle alone, by which staff account (`ON DELETE SET NULL`),
 * and for a minor that the parent or guardian agreed and how — with the account's foreign key and two CHECKs: nothing of a
 * confirmation without its moment, and the parent's agreement as its tick and one of the three ways together, or neither. Every
 * volunteer from before reads not confirmed for the raffle, whatever their state; nothing is backfilled; the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0227_volunteer_raffle_confirmation";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000227";
const ORGANIZER = "99999999-0000-4000-8000-000000000227";
const MARIA = "a0000000-0000-4000-8000-000000000227";
const DAN = "d0000000-0000-4000-8000-000000000227";
const EVA = "e0000000-0000-4000-8000-000000000227";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // After qa's 0226: sorts after every migration before it (drizzle applies by `when`), and counted right after the one it follows.
  expect(journal.entries[position - 1].tag).toBe("0226_staff_team_agreement_every_sign_in");
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);
  expect(journal.entries[position].idx).toBe(journal.entries[position - 1].idx + 1);

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-raffle-confirmation-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // Three volunteers as the release before wrote them — a minor offered, a volunteer confirmed with a V number, one cancelled — and no such columns.
  await client.exec(`
    INSERT INTO staff_users (id, email, display_name, role) VALUES ('${ORGANIZER}', 'organizer-0227@dev.test', 'Org1', 'MODERATOR');
    INSERT INTO events (id, type, starts_at, editorial_status, has_raffle) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT', true);
    INSERT INTO event_volunteers (id, event_id, name, state, source, age, guardian_name) VALUES ('${MARIA}', '${EVENT}', 'Maria', 'REGISTERED', 'STAFF', 17, 'Elena');
    INSERT INTO event_volunteers (id, event_id, name, state, source, volunteer_number) VALUES ('${DAN}', '${EVENT}', 'Dan', 'CONFIRMED', 'STAFF', 1);
    INSERT INTO event_volunteers (id, event_id, name, state, source, in_raffle) VALUES ('${EVA}', '${EVENT}', 'Eva', 'CANCELLED', 'STAFF', false);
  `);
  await expect(client.query(`SELECT raffle_confirmed_at FROM event_volunteers`)).rejects.toThrow();
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

const COLUMNS = ["raffle_confirmed_at", "raffle_confirmed_by_staff_user_id", "raffle_guardian_agreed", "raffle_guardian_way"] as const;

describe("migration 0227_volunteer_raffle_confirmation", () => {
  it("reads every volunteer from before as not confirmed for the raffle — whatever their state — and a row written without the columns too", async () => {
    const rows = (await client.query<Record<string, unknown>>(`SELECT id, ${COLUMNS.join(", ")}, state, volunteer_number FROM event_volunteers ORDER BY name`)).rows;
    expect(rows).toEqual([
      { id: DAN, raffle_confirmed_at: null, raffle_confirmed_by_staff_user_id: null, raffle_guardian_agreed: null, raffle_guardian_way: null, state: "CONFIRMED", volunteer_number: 1 },
      { id: EVA, raffle_confirmed_at: null, raffle_confirmed_by_staff_user_id: null, raffle_guardian_agreed: null, raffle_guardian_way: null, state: "CANCELLED", volunteer_number: null },
      { id: MARIA, raffle_confirmed_at: null, raffle_confirmed_by_staff_user_id: null, raffle_guardian_agreed: null, raffle_guardian_way: null, state: "REGISTERED", volunteer_number: null },
    ]);
    await client.exec(`INSERT INTO event_volunteers (event_id, name, state, source) VALUES ('${EVENT}', 'Ion', 'REGISTERED', 'STAFF')`);
    expect((await client.query(`SELECT raffle_confirmed_at, raffle_guardian_way FROM event_volunteers WHERE name = 'Ion'`)).rows).toEqual([{ raffle_confirmed_at: null, raffle_guardian_way: null }]);
  });

  it("are four nullable columns of the types the code writes", async () => {
    const columns = (
      await client.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'event_volunteers' AND column_name LIKE 'raffle_%' ORDER BY column_name`,
      )
    ).rows;
    expect(columns).toEqual([
      { column_name: "raffle_confirmed_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
      { column_name: "raffle_confirmed_by_staff_user_id", data_type: "uuid", is_nullable: "YES", column_default: null },
      { column_name: "raffle_guardian_agreed", data_type: "boolean", is_nullable: "YES", column_default: null },
      { column_name: "raffle_guardian_way", data_type: "text", is_nullable: "YES", column_default: null },
    ]);
  });

  it("refuses anything of a confirmation without its moment, and the parent's agreement other than its tick and one of the three ways", async () => {
    const set = (assignments: string) => client.exec(`UPDATE event_volunteers SET ${assignments} WHERE id = '${MARIA}'`);
    for (const refused of [
      `raffle_confirmed_by_staff_user_id = '${ORGANIZER}'`,
      `raffle_guardian_agreed = true, raffle_guardian_way = 'PHONE'`,
      `raffle_confirmed_at = now(), raffle_guardian_agreed = true`,
      `raffle_confirmed_at = now(), raffle_guardian_way = 'PHONE'`,
      `raffle_confirmed_at = now(), raffle_guardian_agreed = false, raffle_guardian_way = 'PHONE'`,
      `raffle_confirmed_at = now(), raffle_guardian_agreed = true, raffle_guardian_way = 'EMAIL'`,
      `raffle_confirmed_at = now(), raffle_guardian_agreed = true, raffle_guardian_way = 'phone'`,
    ]) {
      await expect(set(refused), refused).rejects.toThrow();
    }
    // A minor's whole record, each of the three ways; an adult's, with no parent at all.
    for (const way of ["PHONE", "IN_PERSON", "WRITING"]) {
      await set(`raffle_confirmed_at = '2026-11-21T06:30:00Z', raffle_confirmed_by_staff_user_id = '${ORGANIZER}', raffle_guardian_agreed = true, raffle_guardian_way = '${way}'`);
    }
    await client.exec(`UPDATE event_volunteers SET raffle_confirmed_at = '2026-11-21T06:31:00Z', raffle_confirmed_by_staff_user_id = '${ORGANIZER}' WHERE id = '${DAN}'`);
    expect((await client.query(`SELECT raffle_guardian_agreed, raffle_guardian_way, state FROM event_volunteers WHERE id IN ('${MARIA}', '${DAN}') ORDER BY name`)).rows).toEqual([
      { raffle_guardian_agreed: null, raffle_guardian_way: null, state: "CONFIRMED" },
      { raffle_guardian_agreed: true, raffle_guardian_way: "WRITING", state: "REGISTERED" },
    ]);
  });

  it("keeps the confirmation when the staff account that pressed it is deleted: who becomes nobody (SET NULL), the moment stays", async () => {
    await client.exec(`DELETE FROM staff_users WHERE id = '${ORGANIZER}'`);
    expect((await client.query(`SELECT raffle_confirmed_at IS NOT NULL AS kept, raffle_confirmed_by_staff_user_id FROM event_volunteers WHERE id = '${MARIA}'`)).rows).toEqual([
      { kept: true, raffle_confirmed_by_staff_user_id: null },
    ]);
  });

  it("is read by the checker as an expansion: the four columns, the foreign key and the two CHECKs, nothing else", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.replace(/^--.*$/gm, "").trim())
      .filter((statement) => statement !== "");
    expect(statements).toEqual([
      'ALTER TABLE "event_volunteers" ADD COLUMN "raffle_confirmed_at" timestamp with time zone;',
      'ALTER TABLE "event_volunteers" ADD COLUMN "raffle_confirmed_by_staff_user_id" uuid;',
      'ALTER TABLE "event_volunteers" ADD COLUMN "raffle_guardian_agreed" boolean;',
      'ALTER TABLE "event_volunteers" ADD COLUMN "raffle_guardian_way" text;',
      'ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_raffle_confirmed_by_staff_user_id_staff_users_id_fk" FOREIGN KEY ("raffle_confirmed_by_staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;',
      'ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_raffle_confirmation_whole" CHECK ("event_volunteers"."raffle_confirmed_at" IS NOT NULL OR ("event_volunteers"."raffle_confirmed_by_staff_user_id" IS NULL AND "event_volunteers"."raffle_guardian_agreed" IS NULL AND "event_volunteers"."raffle_guardian_way" IS NULL));',
      `ALTER TABLE "event_volunteers" ADD CONSTRAINT "event_volunteers_raffle_guardian_whole" CHECK (("event_volunteers"."raffle_guardian_agreed" IS NULL AND "event_volunteers"."raffle_guardian_way" IS NULL) OR ("event_volunteers"."raffle_guardian_agreed" IS TRUE AND "event_volunteers"."raffle_guardian_way" IS NOT NULL AND "event_volunteers"."raffle_guardian_way" IN ('PHONE', 'IN_PERSON', 'WRITING')));`,
    ]);
  });
});
