import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditMigration, constraintKindsIn, problemsFor } from "../../../scripts/migration-check.mjs";
import { compare } from "../../../scripts/wait-for-migration.mjs";

/**
 * AGENTS.md §7.6 — a deployment never runs against the wrong schema (DECISIONS.md §62).
 *
 * Two mechanisms, each with the half of the guarantee it owns. `migration-check` keeps expand
 * and contract in separate files, so a migration never removes what the code still serving
 * reads. `wait-for-migration` holds a build until the database has caught up, so new code never
 * meets an old schema. The tests pin the classification, because the rule is only as good as
 * what the regexes call a drop.
 */
describe("AGENTS.md §7.6 migrations:check — expand and contract never share a file", () => {
  it("passes an expand-only migration", () => {
    const sql = `CREATE TYPE "public"."x" AS ENUM('A');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "x" "x";--> statement-breakpoint
UPDATE "events" SET "x" = 'A';`;
    expect(auditMigration(sql)).toEqual({ expands: true, contracts: false, hasContractNote: false });
    expect(problemsFor("0024_x.sql", sql)).toEqual([]);
  });

  it("passes a contract-only migration that says which release stopped using what it drops", () => {
    const sql = `-- contract: BR-V1.34 stopped reading events.kind
ALTER TABLE "events" DROP COLUMN "kind";--> statement-breakpoint
DROP TYPE "public"."event_kind";`;
    expect(problemsFor("0025_drop.sql", sql)).toEqual([]);
  });

  it("refuses a contract migration without the note", () => {
    const sql = `ALTER TABLE "events" DROP COLUMN "kind";`;
    expect(problemsFor("0025_drop.sql", sql)).toHaveLength(1);
    expect(problemsFor("0025_drop.sql", sql)[0]).toMatch(/-- contract:/);
  });

  it("refuses the shape that took QA down: add, backfill and drop in one file", () => {
    // Migration 0023 is exactly this, and it is the one that taught the rule.
    const sql = readFileSync("src/db/migrations/0023_event_type_and_surface.sql", "utf8");
    const audit = auditMigration(sql);
    expect(audit.expands).toBe(true);
    expect(audit.contracts).toBe(true);
    expect(problemsFor("0023_event_type_and_surface.sql", sql)[0]).toMatch(/expands and contracts/);
  });

  it("counts NOT NULL on an existing column, a rename and a type change as contractions", () => {
    for (const statement of [
      `ALTER TABLE "events" ALTER COLUMN "surface" SET NOT NULL;`,
      `ALTER TABLE "events" RENAME COLUMN "kind" TO "type";`,
      `ALTER TABLE "events" RENAME TO "happenings";`,
      `ALTER TABLE "events" ALTER COLUMN "capacity" SET DATA TYPE bigint;`,
    ]) {
      expect(auditMigration(statement).contracts, statement).toBe(true);
    }
  });

  it("counts DROP INDEX and DROP CONSTRAINT as contractions (§NNN)", () => {
    for (const statement of [
      `ALTER TABLE "registrations" DROP CONSTRAINT "registrations_event_participant_unique";`,
      `ALTER TABLE "registrations" DROP CONSTRAINT IF EXISTS "registrations_event_id_events_id_fk";`,
      `DROP INDEX "events_kind_starts_at_idx";`,
      `DROP INDEX CONCURRENTLY IF EXISTS "public"."events_kind_starts_at_idx";`,
      `drop index events_kind_starts_at_idx;`,
    ]) {
      expect(auditMigration(statement).contracts, statement).toBe(true);
    }
  });

  it("classifies migration 0073 as the contract it is, note and all", () => {
    // It passed as neither expand nor contract before §NNN, and carried its note by hand.
    const sql = readFileSync("src/db/migrations/0073_drop_registration_participant_unique.sql", "utf8");
    expect(auditMigration(sql)).toEqual({ expands: false, contracts: true, hasContractNote: true });
    expect(problemsFor("0073_drop_registration_participant_unique.sql", sql)).toEqual([]);
    // Without its note, the same drop is refused.
    const bare = sql.replace(/^--.*$/gm, "");
    expect(problemsFor("0073_x.sql", bare)[0]).toMatch(/-- contract:/);
  });

  it("refuses a file that drops a unique index and adds a column", () => {
    const sql = `DROP INDEX "registrations_event_participant_unique";--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "name_key" text;`;
    expect(problemsFor("0090_x.sql", sql)[0]).toMatch(/expands and contracts/);
  });

  it("reads an index dropped and created again under its own name as a replacement, not a drop (migration 0080)", () => {
    const sql = readFileSync("src/db/migrations/0080_registration_audit.sql", "utf8");
    expect(auditMigration(sql)).toEqual({ expands: true, contracts: false, hasContractNote: false });
    expect(problemsFor("0080_registration_audit.sql", sql)).toEqual([]);
    const constraint = `ALTER TABLE "t" DROP CONSTRAINT "t_x_unique";--> statement-breakpoint
ALTER TABLE "t" ADD CONSTRAINT "t_x_unique" UNIQUE("x","y");`;
    expect(auditMigration(constraint).contracts).toBe(false);
  });

  it("reads a dropped CHECK constraint an earlier migration created as a loosening (migration 0024)", () => {
    const created = readFileSync("src/db/migrations/0006_registrations_legal_docs_and_job_infra.sql", "utf8");
    const kinds = constraintKindsIn(created);
    expect(kinds.get("registrations_bib_number_not_assigned_in_m1")).toBe("CHECK");
    const checks = new Set([...kinds].filter(([, kind]) => kind === "CHECK").map(([name]) => name));

    const sql = readFileSync("src/db/migrations/0024_registration_bib_numbers.sql", "utf8");
    expect(auditMigration(sql, checks).contracts).toBe(false);
    expect(problemsFor("0024_registration_bib_numbers.sql", sql, checks)).toEqual([]);
    // Without the history, the same drop could be a uniqueness, and is a contract.
    expect(auditMigration(sql).contracts).toBe(true);
  });

  it("names the kind of every constraint a file defines, inline or added", () => {
    const sql = `CREATE TABLE "t" (
	"id" uuid PRIMARY KEY,
	CONSTRAINT "t_positive" CHECK ("t"."n" > 0)
);--> statement-breakpoint
ALTER TABLE "t" ADD CONSTRAINT "t_event_fk" FOREIGN KEY ("event_id") REFERENCES "events"("id");--> statement-breakpoint
ALTER TABLE "t" ADD CONSTRAINT "t_code_unique" UNIQUE("code");`;
    expect(Object.fromEntries(constraintKindsIn(sql))).toEqual({ t_positive: "CHECK", t_event_fk: "FOREIGN", t_code_unique: "UNIQUE" });
  });

  it("does not read a comment as a statement", () => {
    const sql = `-- This used to DROP COLUMN "kind"; it no longer does.
ALTER TABLE "events" ADD COLUMN "notes" text;`;
    expect(auditMigration(sql).contracts).toBe(false);
  });

  it("lets a leading '-- expand:' note declare a drop harmless, overriding the classification", () => {
    // A synthetic case: this drop would otherwise read as a contract (it is a bare DROP INDEX
    // that creates nothing back), but the author states there is nothing left using it.
    const sql = `-- expand: this index was never read by any query; dropping it removes nothing in use
DROP INDEX "unused_idx";`;
    expect(auditMigration(sql)).toEqual({ expands: false, contracts: false, hasContractNote: false });
    expect(problemsFor("0090_x.sql", sql)).toEqual([]);
  });

  it("lets a leading '-- contract:' note stand in for the required one and suppress an expand reading", () => {
    // A synthetic case: an ADD COLUMN paired with a drop in a file that also, incidentally, reads
    // as an expand — the note says the whole file is a contract, and that wins.
    const sql = `-- contract: BR-V2.01 stopped writing to "legacy"
ALTER TABLE "events" DROP COLUMN "legacy";--> statement-breakpoint
CREATE INDEX "events_legacy_idx" ON "events" ("id");`;
    const audit = auditMigration(sql);
    expect(audit.expands).toBe(false);
    expect(audit.contracts).toBe(true);
    expect(problemsFor("0091_x.sql", sql)).toEqual([]);
  });
});

describe("AGENTS.md §7.6 wait-for-migration — the build waits for the database, never the reverse", () => {
  it("is satisfied only when the applied head is at or beyond the build's head", () => {
    expect(compare("1789657704764", "1789657704764")).toBe("ok");
    // A rollback: the database is ahead of the code. The old code still runs — that is what
    // expand/contract buys — so this is not a reason to hold the build.
    expect(compare("1788754816383", "1789657704764")).toBe("ok");
    expect(compare("1789657704764", "1788754816383")).toBe("behind");
    expect(compare("1789657704764", null)).toBe("behind");
  });
});
