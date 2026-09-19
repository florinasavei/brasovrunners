import { sql } from "drizzle-orm";
import type { Database } from "@/db/types";

/**
 * How big the database is, asked of the database itself (`DECISIONS.md` §88): the one figure
 * about Neon's storage ceiling this application can read without a key. The Free plan gives
 * each project half a gigabyte; `pg_database_size` counts every table, index and toast page of
 * this database, which is what that ceiling is measured against.
 */

/** Neon Free: 0.5 GB of storage per project (`docs/PLATFORM.md`). A fact about the plan, not configuration. */
export const NEON_FREE_STORAGE_BYTES = 512 * 1024 * 1024;

export async function readDatabaseSizeBytes<T extends Record<string, unknown>>(db: Database<T>): Promise<number | null> {
  try {
    const rows = await db.execute(sql`SELECT pg_database_size(current_database())::bigint AS bytes`);
    const first = (rows as unknown as { rows?: { bytes: unknown }[] }).rows?.[0] ?? (rows as unknown as { bytes: unknown }[])[0];
    const bytes = Number(first?.bytes);
    return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
  } catch {
    // A database that cannot say (a permission, an odd driver) is "not measured", never zero.
    return null;
  }
}

export function megabytes(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
