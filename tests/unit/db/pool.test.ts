import { describe, expect, it, vi } from "vitest";

/**
 * AGENTS.md §7, §19 — the connection pool is bounded in time, not only in count.
 *
 * There is no assertion here about *behaviour*: PostgreSQL enforces `statement_timeout` and
 * `idle_in_transaction_session_timeout` itself, and proving PostgreSQL implements its own
 * parameters is not this repository's job. What is worth a test is that the application still
 * asks for them. Both are one line in `db/client.ts`, both are invisible until the day they
 * would have mattered, and a refactor that dropped them would break nothing any other test
 * runs — the failure they prevent is a query holding a serverless function open for its full
 * 300 seconds under load, which no suite reproduces.
 *
 * `pg` is mocked rather than connected to: what is under test is the configuration handed to
 * the driver, and a real pool would need a database this suite deliberately does not have.
 */
const constructed: Array<Record<string, unknown>> = [];

vi.mock("pg", () => ({
  Pool: class {
    constructor(config: Record<string, unknown>) {
      constructed.push(config);
    }
  },
}));
vi.mock("@/shared/config/env", () => ({
  env: { DATABASE_URL: "postgres://user@example.test:5432/db", APP_ENV: "qa" },
}));

const { getDb } = await import("@/db/client");

describe("the application's connection pool", () => {
  it("bounds every statement and every idle transaction", () => {
    getDb();

    expect(constructed).toHaveLength(1);
    const config = constructed[0];

    // Ten seconds: more than an order of magnitude above the slowest statement this
    // application writes, and far below Vercel's 300s function ceiling.
    expect(config?.statement_timeout).toBe(10_000);
    // The case `statement_timeout` cannot see — an instance frozen between two statements of
    // an open transaction, holding a capacity lock nothing else can take (§10.6).
    expect(config?.idle_in_transaction_session_timeout).toBe(30_000);
  });

  it("keeps the per-instance pool size, which is not per deployment", () => {
    // Vercel's pool is per function instance. `1` is explicitly the wrong correction — it
    // does not lower the total and removes concurrency within the instance. The reasoning,
    // and why ten is safe against Neon's pooler, is in `docs/PLATFORM.md`.
    expect(constructed[0]?.max).toBe(10);
  });
});
