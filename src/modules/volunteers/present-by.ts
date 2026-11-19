import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { auditLogs } from "@/db/schema/audit-logs";
import { events } from "@/db/schema/events";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { isUuid } from "@/shared/ids";

/**
 * Who ticked a volunteer «Prezent», and when (§996; the owner, 2026-11-19: «vreau si tracing pentru voluntarim [voluntari] gen cine a
 * scanat, cine a marcat prezent»): what the tick on the «Voluntari» list and on the person's page says while it is ticked —
 * «QR1, 08:20» — from the newest `volunteer.edited` row that set `present: true` (`volunteers.ts`, kind `setPresent`: entity
 * `event`, the event's id, `{ volunteerId, fields: ["present"], present }`). Nothing new is stored: every tick was audited with its
 * actor since §983.
 *
 * **One query for the page's rows**, whatever their number: the ticked rows' events on `audit_logs_entity_idx` (entity `event`, the
 * events' ids), one row per volunteer (`DISTINCT ON`, newest first), the account's name and the event's clock joined. An unticked
 * row is not asked: it says nothing. A tick with no such row — none written before the trail kept it — says nothing either. The
 * name is null for an account deleted since.
 *
 * Whoever reads the list reads this (`canManageVolunteers`, asserted by both pages): the organizers' own mark, never the desk's.
 */
export type PresentBy = { name: string | null; at: Date; timezone: string };

const tickedBy = alias(staffUsers, "present_ticked_by");

export async function readPresentTicks<T extends Record<string, unknown>>(
  db: Database<T>,
  volunteers: readonly { id: string; eventId: string; present: boolean }[],
): Promise<Map<string, PresentBy>> {
  const ticked = volunteers.filter((row) => row.present && isUuid(row.id) && isUuid(row.eventId));
  if (ticked.length === 0) return new Map();
  const volunteerId = sql<string>`(${auditLogs.metadataJson} ->> 'volunteerId')`;
  const rows = await db
    .selectDistinctOn([volunteerId], { volunteerId, at: auditLogs.createdAt, name: tickedBy.displayName, timezone: events.timezone })
    .from(auditLogs)
    .innerJoin(events, eq(events.id, auditLogs.entityId))
    .leftJoin(tickedBy, eq(tickedBy.id, auditLogs.actorStaffUserId))
    .where(
      and(
        eq(auditLogs.entityType, "event"),
        inArray(auditLogs.entityId, [...new Set(ticked.map((row) => row.eventId))]),
        eq(auditLogs.action, "volunteer.edited"),
        sql`(${auditLogs.metadataJson} -> 'fields') @> '["present"]'::jsonb`,
        sql`(${auditLogs.metadataJson} -> 'present') = 'true'::jsonb`,
        inArray(volunteerId, ticked.map((row) => row.id)),
      ),
    )
    .orderBy(volunteerId, desc(auditLogs.createdAt), desc(auditLogs.id));
  return new Map(rows.map((row) => [row.volunteerId, { name: row.name, at: row.at, timezone: row.timezone }]));
}
