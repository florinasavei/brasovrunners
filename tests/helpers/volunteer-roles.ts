import { sql } from "drizzle-orm";
import type { Database } from "@/db/types";

/**
 * What migration `0177` did for the rows written before it (§837): every volunteer's `role_id` becomes their one row in
 * `event_volunteer_role_assignments`. A test that inserts a volunteer straight into the table with a `role_id`, as the
 * earlier releases wrote it, calls this once afterwards so the service — which reads the roles given from the
 * assignments alone — sees the role; a row already there is left alone, like the migration's `ON CONFLICT DO NOTHING`.
 */
export async function mirrorRolesGiven<T extends Record<string, unknown>>(db: Database<T>): Promise<void> {
  await db.execute(sql`
    INSERT INTO event_volunteer_role_assignments (volunteer_id, role_id, created_at)
    SELECT id, role_id, updated_at FROM event_volunteers WHERE role_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
}
