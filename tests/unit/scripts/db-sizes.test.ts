import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { readDatabaseSizesFrom } from "@/modules/diagnostics/db-sizes";
import { describeTarget, ENVIRONMENTS, formatSizes, parseEnvironment, resolveUrl } from "../../../scripts/db-sizes.mjs";
import { createTestDatabase, type TestDatabase } from "../../helpers/db";

/**
 * §803 — `yarn db:sizes`: the same queries as `/devs` → «Baza de date», printed as a table. The
 * report is checked on PGlite's real PostgreSQL (the local database is not needed); the target
 * resolution is `db:migrate:env`'s, and the script never prints a connection string.
 */
const NOW = new Date("2026-10-16T12:00:00.000Z");

describe("yarn db:sizes", () => {
  let db: TestDatabase;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDatabase());
    await db.insert(auditLogs).values([
      { action: "registration.created", entityType: "registration", createdAt: new Date(NOW.getTime() - 86_400_000) },
      { action: "registration.created", entityType: "registration", createdAt: new Date(NOW.getTime() - 40 * 86_400_000) },
    ]);
    await db.insert(events).values({ type: "GROUP_RUN", startsAt: new Date("2025-01-01T09:00:00.000Z"), registrationMode: "INTERNAL" });
  });
  afterAll(async () => close());

  it("prints the size, the largest tables with their split, the growth and the registrations, one table of text", async () => {
    const lines = formatSizes(await readDatabaseSizesFrom(db, NOW));
    const text = lines.join("\n");

    expect(lines[0]).toMatch(/^ {2}size {8}\d+\.\d MB$/);
    expect(text).toContain("The largest tables");
    expect(text).toMatch(/table\s+total MB\s+data MB\s+index MB\s+rows\s+\+30 days/);
    // The audit log has two rows, one of them inside the window: the table line and the growth line agree.
    expect(text).toMatch(/audit_logs\s+\d+\.\d\s+\d+\.\d\s+\d+\.\d\s+2\s+1\b/);
    expect(text).toMatch(/audit_logs\s+2\s+1\s*$/m);
    expect(text).toContain("Growth in the last 30 days");
    expect(text).toContain("Registrations by state (test rows included)");
    expect(text).toContain("(none)");
    expect(text).toContain("'settled'");
    // A line never runs past a terminal's width.
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(100);
  });

  it("resolves the target as db:migrate:env does, local by default, and refuses what is not an environment", () => {
    expect(ENVIRONMENTS).toEqual(["local", "qa", "production"]);
    expect(parseEnvironment([])).toBe("local");
    expect(parseEnvironment(["--env", "qa"])).toBe("qa");
    expect(parseEnvironment(["--env=production"])).toBe("production");
    expect(parseEnvironment(["--env", "staging"])).toBeNull();
    expect(parseEnvironment(["--env"])).toBeNull();

    const env = { DATABASE_URL: "postgres://a/b", DATABASE_URL_QA: "postgres://qa/db" };
    expect(resolveUrl("local", env)).toBe("postgres://a/b");
    expect(resolveUrl("qa", env)).toBe("postgres://qa/db");
    // Production never falls back to the local URL: no variable, no target.
    expect(resolveUrl("production", env)).toBeNull();
    expect(resolveUrl("local", { DATABASE_URL_LOCAL: "postgres://l/x", DATABASE_URL: "postgres://a/b" })).toBe("postgres://l/x");
  });

  it("never prints a connection string's password", () => {
    expect(describeTarget("postgres://user:hunter2@ep-example-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require")).toBe("ep-example-pooler.eu-central-1.aws.neon.tech/neondb");
    expect(describeTarget("not a url")).toBe("an unparseable connection string");
  });

  it("stops with a plain sentence, not a stack, when the target has no connection string", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/db-sizes.mjs", "--env", "production"], {
      cwd: path.resolve(__dirname, "../../.."),
      env: { ...process.env, DATABASE_URL: "", DATABASE_URL_PRODUCTION: "" },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No connection string for "production"');
    expect(result.stderr).toContain("DATABASE_URL_PRODUCTION");
    expect(result.stderr).not.toContain("    at ");
  });

  it("opens every query inside one read-only transaction", () => {
    const source = readFileSync(path.resolve(__dirname, "../../../scripts/db-sizes.mjs"), "utf8");
    expect(source).toContain('client.query("BEGIN READ ONLY")');
    expect(source).toContain('client.query("ROLLBACK")');
    expect(source).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/);
  });
});
