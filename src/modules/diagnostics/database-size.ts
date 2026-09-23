import { sql } from "drizzle-orm";
import type { Database } from "@/db/types";
import { NEON_PLANS } from "./domain/neon-plan";

/**
 * How big the database is, asked of the database itself (`DECISIONS.md` §88): the one figure
 * about Neon's storage this application can read without a key. On Free each project has half
 * a gigabyte and this is measured against it; on Launch the same bytes are billed per GB-month
 * (`domain/neon-plan.ts`). `pg_database_size` counts every table, index and toast page of this
 * database, which is what either plan looks at.
 */

/** Neon Free: 0.5 GB of storage per project, from the one catalogue; kept under its old name for the callers that read it. */
export const NEON_FREE_STORAGE_BYTES = NEON_PLANS.FREE.storageBytes as number;

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
