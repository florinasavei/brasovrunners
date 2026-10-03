import { desc, isNotNull } from "drizzle-orm";
import { type UnreachableWindow, unreachableWindows } from "@/db/schema/unreachable-windows";
import type { Database } from "@/db/types";

/**
 * The windows the platform could not be reached, as `/devs`, «Sarcini» and the deep health read them
 * (§NNN): newest first, the open one among them, never a `dns` suspicion (one probe so far is no
 * window). A read of a handful of rows by their index; the writes are the maintenance job's alone
 * (`registrations/outage-grace.ts`).
 */
export async function readUnreachableWindows<T extends Record<string, unknown>>(db: Database<T>, limit = 5): Promise<UnreachableWindow[]> {
  return db
    .select()
    .from(unreachableWindows)
    .where(isNotNull(unreachableWindows.confirmedAt))
    .orderBy(desc(unreachableWindows.startedAt))
    .limit(limit);
}
