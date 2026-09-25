import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration `0076_night_override` (`DECISIONS.md` §NNN), proven on real PostgreSQL (PGlite): the
 * database is built up to the migration before it, rows are written the way §382's checkbox wrote
 * them, and then the rest of the migrations run over them — as `yarn db:migrate:env` runs them over
 * production.
 *
 * - a ticked row (`true`) keeps the club's word: "Da";
 * - an unticked row (`false`) had said nothing, so it becomes automatic (`NULL`);
 * - the column takes NULL and has no default any more, so a row written without it is automatic;
 * - the file only loosens and backfills — no drop, no rename (AGENTS.md §7.6).
 */
const MIGRATIONS = "src/db/migrations";
const TAG = "0076_night_override";

type Journal = { entries: Array<{ idx: number; tag: string; when: number }> };

let client: PGlite;
let folder: string;

beforeAll(async () => {
  const journal = JSON.parse(readFileSync(`${MIGRATIONS}/meta/_journal.json`, "utf8")) as Journal;
  const position = journal.entries.findIndex((entry) => entry.tag === TAG);
  expect(position, "the journal lists the migration").toBeGreaterThan(0);

  // Every migration before this one, in a folder of its own.
  folder = mkdtempSync(path.join(tmpdir(), "night-override-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  writeFileSync(path.join(folder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, position) }));

  client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: folder });
  // The rows §382 wrote: the Wednesday run ticked in October, a Sunday run never ticked, and one
  // written without the column at all (the default then was false).
  await client.exec(`
    INSERT INTO events (type, starts_at, headlamp_required) VALUES
      ('GROUP_RUN', '2026-10-21T16:00:00Z', true),
      ('GROUP_RUN', '2026-10-25T06:00:00Z', false);
    INSERT INTO events (type, starts_at) VALUES ('RACE', '2026-11-21T08:00:00Z');
  `);
  // Then the rest, this migration among them, over those rows.
  await migrate(db, { migrationsFolder: MIGRATIONS });
});

afterAll(async () => {
  await client?.close();
  if (folder) rmSync(folder, { recursive: true, force: true });
});

describe("§NNN migration 0076_night_override — the checkbox becomes an override", () => {
  it("keeps a ticked row «Da» and turns every unticked one into «Automat»", async () => {
    const { rows } = await client.query<{ type: string; headlamp_required: boolean | null }>(
      "SELECT type, headlamp_required FROM events ORDER BY starts_at",
    );
    expect(rows.map((row) => row.headlamp_required)).toEqual([true, null, null]);
  });

  it("takes NULL, and a row written without it is automatic — no NOT NULL, no default", async () => {
    await client.query("INSERT INTO events (type, starts_at) VALUES ('GROUP_RUN', '2027-06-16T16:00:00Z')");
    const { rows } = await client.query<{ headlamp_required: boolean | null }>(
      "SELECT headlamp_required FROM events WHERE starts_at = '2027-06-16T16:00:00Z'",
    );
    expect(rows[0].headlamp_required).toBeNull();
    const { rows: column } = await client.query<{ is_nullable: string; column_default: string | null }>(
      "SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'events' AND column_name = 'headlamp_required'",
    );
    expect(column[0]).toEqual({ is_nullable: "YES", column_default: null });
  });

  it("is expand-only: it loosens and backfills, and drops or renames nothing (AGENTS.md §7.6)", () => {
    const sql = readFileSync(`${MIGRATIONS}/${TAG}.sql`, "utf8").replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/DROP\s+(COLUMN|TABLE|TYPE)|RENAME|SET\s+NOT\s+NULL/i);
    expect(sql).toMatch(/DROP NOT NULL/);
    expect(sql).toMatch(/UPDATE "events" SET "headlamp_required" = NULL WHERE "headlamp_required" = false/);
  });
});
