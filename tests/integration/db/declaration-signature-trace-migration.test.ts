import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditMigration } from "../../../scripts/migration-check.mjs";

/**
 * Migration `0158_declaration_signature_trace` (§NNN, amending §418, §330, §758, §768 and §769; the owner,
 * 2026-10-14), proven on real PostgreSQL (PGlite): `ip` and `user_agent` — text, nullable — on
 * `declaration_acceptances` and `group_run_declarations`, and `agreement_ip` / `agreement_user_agent` and
 * `guardian_ip` / `guardian_user_agent` on `event_volunteers` (the volunteer's acceptance is columns of the volunteer's own
 * row, not a table of its own). A row written before it reads null for each; the file only expands, and the journal
 * lists it last, later than every migration before it.
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0158_declaration_signature_trace";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

const EVENT = "aaaaaaaa-0000-4000-8000-000000000001";
const ANA = "cccccccc-0000-4000-8000-000000000001";

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);
  // Sorts after every migration before it (drizzle applies by `when`), the group-run minor's `0155` included.
  expect(journal.entries[position].when).toBeGreaterThan(Math.max(...journal.entries.slice(0, position).map((entry) => entry.when)));
  expect(journal.entries.some((entry) => entry.tag === "0155_group_run_declaration_minor" && entry.idx < journal.entries[position].idx)).toBe(true);

  folder = mkdtempSync(path.join(tmpdir(), "declaration-trace-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // A volunteer who accepted the agreement before the trace existed.
  await client.exec(`
    INSERT INTO events (id, type, starts_at, editorial_status) VALUES ('${EVENT}', 'RACE', '2026-11-21T08:00:00Z', 'DRAFT');
    INSERT INTO event_volunteers (id, event_id, name, email, canonical_email, canonicalization_version, phone, state, source) VALUES
      ('${ANA}', '${EVENT}', 'Ana', 'ana@example.test', 'ana@example.test', 2, '+40712345678', 'CONFIRMED', 'PUBLIC');
  `);
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("migration 0158_declaration_signature_trace — the electronic signature's trace", () => {
  it("adds the two nullable text columns to the race declaration's acceptance and to the group run's", async () => {
    for (const table of ["declaration_acceptances", "group_run_declarations"]) {
      const result = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = '${table}' AND column_name IN ('ip', 'user_agent') ORDER BY column_name`,
      );
      expect(result.rows, table).toEqual([
        { column_name: "ip", data_type: "text", is_nullable: "YES" },
        { column_name: "user_agent", data_type: "text", is_nullable: "YES" },
      ]);
    }
  });

  it("adds the volunteer's own and the guardian's pair to the volunteer's row, nullable", async () => {
    const result = await client.query<{ column_name: string; data_type: string; is_nullable: string }>(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'event_volunteers' AND column_name IN ('agreement_ip', 'agreement_user_agent', 'guardian_ip', 'guardian_user_agent') ORDER BY column_name`,
    );
    expect(result.rows).toEqual([
      { column_name: "agreement_ip", data_type: "text", is_nullable: "YES" },
      { column_name: "agreement_user_agent", data_type: "text", is_nullable: "YES" },
      { column_name: "guardian_ip", data_type: "text", is_nullable: "YES" },
      { column_name: "guardian_user_agent", data_type: "text", is_nullable: "YES" },
    ]);
  });

  it("leaves a row written before it with nothing in them — never a made-up address", async () => {
    const result = await client.query<Record<string, string | null>>(
      `SELECT agreement_ip, agreement_user_agent, guardian_ip, guardian_user_agent FROM event_volunteers WHERE id = '${ANA}'`,
    );
    expect(result.rows[0]).toEqual({ agreement_ip: null, agreement_user_agent: null, guardian_ip: null, guardian_user_agent: null });
  });

  it("only expands: columns added, nothing dropped, renamed or tightened", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8");
    expect(auditMigration(sql)).toMatchObject({ expands: true, contracts: false });
    expect(sql).not.toMatch(/DROP |RENAME |NOT NULL/i);
    // Three tables, eight columns.
    expect(sql.match(/ADD COLUMN/g)).toHaveLength(8);
    expect(sql.match(/ALTER TABLE "(declaration_acceptances|event_volunteers|group_run_declarations)"/g)).toHaveLength(8);
  });
});
