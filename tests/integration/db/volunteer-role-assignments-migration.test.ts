import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0177_volunteer_role_assignments` (§837, amending §761), proven on real PostgreSQL (PGlite): a volunteer
 * given a role before it — `role_id` set — gets that role as their one row in `event_volunteer_role_assignments`, with
 * the row's own moment; an offer nobody placed gets none; afterwards a person may hold several roles, never the same
 * twice, the rows go with the volunteer, and an event goes whole (both references CASCADE, as the choices' do and for
 * the same reason). The backfill is safe to run twice, `role_id` itself is untouched, and the file only expands.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0177_volunteer_role_assignments";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000011";
const WATER = "bbbbbbbb-0000-4000-8000-000000000011";
const FINISH = "bbbbbbbb-0000-4000-8000-000000000012";
const ANA = "cccccccc-0000-4000-8000-000000000011";
const ION = "cccccccc-0000-4000-8000-000000000012";
const MARIA = "cccccccc-0000-4000-8000-000000000013";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`).
  expect(journal.entries[position].when).toBeGreaterThan(journal.entries[position - 1].when);

  folder = mkdtempSync(path.join(tmpdir(), "volunteer-assignments-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // Three volunteers as §761 kept them: two given a role (one cancelled), one offer nobody placed.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_volunteer_roles (id, event_id, name_ro, name_en, needed, position) VALUES
      ('${WATER}', '${EVENT}', 'Punct de apă', 'Water point', 2, 0),
      ('${FINISH}', '${EVENT}', 'Sosire', 'Finish', 1, 1);
    INSERT INTO event_volunteers (id, event_id, role_id, name, email, canonical_email, canonicalization_version, phone, state, source, created_at, updated_at) VALUES
      ('${ANA}', '${EVENT}', '${WATER}', 'Ana', 'ana@example.test', 'ana@example.test', 2, '+40712345678', 'CONFIRMED', 'PUBLIC', '2026-10-13T08:00:00Z', '2026-10-14T08:00:00Z'),
      ('${ION}', '${EVENT}', '${FINISH}', 'Ion', 'ion@example.test', 'ion@example.test', 2, '+40712345678', 'CANCELLED', 'STAFF', '2026-10-13T09:00:00Z', '2026-10-13T09:00:00Z'),
      ('${MARIA}', '${EVENT}', NULL, 'Maria', 'maria@example.test', 'maria@example.test', 2, '+40712345678', 'REGISTERED', 'PUBLIC', '2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z');
    INSERT INTO event_volunteer_role_choices (volunteer_id, role_id) VALUES ('${ANA}', '${WATER}'), ('${ION}', '${FINISH}'), ('${MARIA}', '${WATER}'), ('${MARIA}', '${FINISH}');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0177_volunteer_role_assignments — each volunteer's role given becomes their one assignment", () => {
  it("backfills one assignment per volunteer given a role, cancelled or not, with the row's last moment; an offer nobody placed gets none; role_id is untouched", async () => {
    const { rows } = await client.query<{ volunteer_id: string; role_id: string; created_at: Date }>(
      `SELECT volunteer_id, role_id, created_at FROM event_volunteer_role_assignments ORDER BY volunteer_id`,
    );
    expect(rows.map((row) => [row.volunteer_id, row.role_id, new Date(row.created_at).toISOString()])).toEqual([
      [ANA, WATER, "2026-10-14T08:00:00.000Z"],
      [ION, FINISH, "2026-10-13T09:00:00.000Z"],
    ]);
    const given = await client.query<{ id: string; role_id: string | null }>(`SELECT id, role_id FROM event_volunteers ORDER BY id`);
    expect(given.rows).toEqual([
      { id: ANA, role_id: WATER },
      { id: ION, role_id: FINISH },
      { id: MARIA, role_id: null },
    ]);
    // The choices are not touched: Maria's two stand, and nobody's became an assignment.
    const { rows: choices } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM event_volunteer_role_choices`);
    expect(choices[0]?.n).toBe(4);
  });

  it("is idempotent: running the backfill again adds nothing", async () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    const backfill = sql.split("--> statement-breakpoint").pop() ?? "";
    expect(backfill).toMatch(/INSERT INTO "event_volunteer_role_assignments"/);
    await client.exec(backfill);
    const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM event_volunteer_role_assignments`);
    expect(rows[0]?.n).toBe(2);
  });

  it("lets a person hold several roles, never the same twice, and drops the assignments with the volunteer", async () => {
    await client.exec(`INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id) VALUES ('${MARIA}', '${WATER}'), ('${MARIA}', '${FINISH}')`);
    const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM event_volunteer_role_assignments WHERE volunteer_id = '${MARIA}'`);
    expect(rows[0]?.n).toBe(2);
    // The same role twice is one row (the primary key).
    await expect(client.exec(`INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id) VALUES ('${MARIA}', '${WATER}')`)).rejects.toThrow();
    // Ion is gone: his assignment goes with him.
    await client.exec(`DELETE FROM event_volunteers WHERE id = '${ION}'`);
    const left = await client.query<{ volunteer_id: string; role_id: string }>(`SELECT volunteer_id, role_id FROM event_volunteer_role_assignments ORDER BY volunteer_id, role_id`);
    expect(left.rows).toEqual([
      { volunteer_id: ANA, role_id: WATER },
      { volunteer_id: MARIA, role_id: WATER },
      { volunteer_id: MARIA, role_id: FINISH },
    ]);
  });

  it("deletes an event with its roles, its people and their assignments — the two-level cascade never stops on an assignment", async () => {
    await client.exec(`DELETE FROM events WHERE id = '${EVENT}'`);
    for (const table of ["event_volunteer_role_assignments", "event_volunteer_role_choices", "event_volunteers", "event_volunteer_roles"]) {
      const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0]?.n, table).toBe(0);
    }
  });

  it("only expands: a new table and a backfill — nothing dropped, renamed or tightened, role_id included", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    expect(sql).not.toMatch(/DROP COLUMN|ALTER COLUMN "role_id"/);
  });
});
