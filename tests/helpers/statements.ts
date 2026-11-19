import { vi } from "vitest";
import type { TestDatabase } from "./db";

/**
 * Every SQL statement `operation` sends to the test database, as text, in the order sent — read at PGlite's own `query`, so a
 * statement counts whatever built it (the query builder, a raw `execute`, a transaction's). What a "no query per row" test counts
 * (§NNN): the same operation over a few rows and over many sends the same statements.
 */
export async function statementsOf(db: TestDatabase, operation: () => Promise<unknown>): Promise<string[]> {
  const client = (db as unknown as { $client: { query: (...args: unknown[]) => unknown } }).$client;
  const spy = vi.spyOn(client, "query");
  try {
    await operation();
    return spy.mock.calls.map((call) => String(call[0]));
  } finally {
    spy.mockRestore();
  }
}
