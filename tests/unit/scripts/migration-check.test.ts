import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { auditMigration, problemsFor } from "../../../scripts/migration-check.mjs";
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

  it("does not read a comment as a statement", () => {
    const sql = `-- This used to DROP COLUMN "kind"; it no longer does.
ALTER TABLE "events" ADD COLUMN "notes" text;`;
    expect(auditMigration(sql).contracts).toBe(false);
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
