import { sql } from "drizzle-orm";
import type { Database } from "@/db/types";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { type DatabaseSizes, readDatabaseSizes, type SqlRow } from "./domain/db-sizes";

/**
 * The database's size and growth for `/devs` (§NNN), through the application's own connection.
 *
 * The SQL and the reading are `domain/db-sizes.ts`'s, shared with `yarn db:sizes`; this file only
 * says how a statement is run here: `db.execute`, whose result is `{ rows }` on `node-postgres`
 * and an array-like on PGlite. It is read straight through, never through the public cache — this
 * is the backoffice, and the figure is wanted fresh.
 */
function rowsOf(result: unknown): SqlRow[] {
  const rows = (result as { rows?: SqlRow[] }).rows;
  return Array.isArray(rows) ? rows : (result as SqlRow[]);
}

export async function readDatabaseSizesFrom<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<DatabaseSizes> {
  return readDatabaseSizes(async (text) => rowsOf(await db.execute(sql.raw(text))), now);
}

/**
 * What the page shows: the reading, or null when it could not be had — the database away (an
 * outage, Neon's quota refusal: `readOrWhileAway`, §447) or any other failure. A diagnostics card
 * says "not read" in a sentence and never takes the page with it.
 */
export async function readDatabaseSizesForPage<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<DatabaseSizes | null> {
  try {
    return await readOrWhileAway(() => readDatabaseSizesFrom(db, now), null);
  } catch {
    return null;
  }
}
