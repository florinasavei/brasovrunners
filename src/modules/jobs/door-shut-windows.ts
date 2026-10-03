import { desc } from "drizzle-orm";
import { type DoorShutWindow, doorShutWindows } from "@/db/schema/door-shut-windows";
import type { Database } from "@/db/types";

/**
 * The door's windows as `/devs`, «Sarcini» and the deep health read them (§NNN): newest first, the
 * open one among them. A read of a handful of rows by their index; the writes are the maintenance
 * job's alone (`registrations/door-shut.ts`).
 */
export async function readDoorWindows<T extends Record<string, unknown>>(db: Database<T>, limit = 5): Promise<DoorShutWindow[]> {
  return db.select().from(doorShutWindows).orderBy(desc(doorShutWindows.startedAt)).limit(limit);
}
