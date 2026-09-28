import { and, asc, inArray } from "drizzle-orm";
import { ACTIVE_REGISTRATION_STATUSES, registrations } from "@/db/schema/registrations";
import type { Database } from "@/db/types";

/**
 * The family marker (§NNN; the owner, 2026-09-28: «trebuie un marker pentru familie... că nu e clar
 * cum rezervăm și pare că nu se salvează corect»): the other people registered on the same address
 * at the same event, for every surface that shows a registration — the backoffice list and page, the
 * queue panel, the race-day desk, «Înscrierile mele», the QR page and the export.
 *
 * A family is the address (§389): the participant is the canonical address, so "the same address at
 * the same event" is exactly the rows of one participant at one event. Only active registrations are
 * named — a cancelled or lapsed one is nobody's family any more. Staff read it behind their own
 * permission, and a participant reads only their own address's (§39: nothing about another inbox).
 */
export type FamilyMember = { id: string; name: string };

export async function familyOf<T extends Record<string, unknown>>(
  db: Database<T>,
  rows: ReadonlyArray<{ id: string; participantId: string; eventId: string }>,
): Promise<Map<string, FamilyMember[]>> {
  const family = new Map<string, FamilyMember[]>();
  if (rows.length === 0) return family;
  const participants = [...new Set(rows.map((row) => row.participantId))];
  const eventIds = [...new Set(rows.map((row) => row.eventId))];
  const all = await db
    .select({ id: registrations.id, participantId: registrations.participantId, eventId: registrations.eventId, name: registrations.registeredName })
    .from(registrations)
    .where(
      and(
        inArray(registrations.participantId, participants),
        inArray(registrations.eventId, eventIds),
        inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES]),
      ),
    )
    .orderBy(asc(registrations.createdAt), asc(registrations.id));
  const groups = new Map<string, FamilyMember[]>();
  for (const row of all) {
    const key = `${row.participantId}:${row.eventId}`;
    groups.set(key, [...(groups.get(key) ?? []), { id: row.id, name: row.name }]);
  }
  for (const row of rows) {
    const others = (groups.get(`${row.participantId}:${row.eventId}`) ?? []).filter((member) => member.id !== row.id);
    if (others.length > 0) family.set(row.id, others);
  }
  return family;
}

/** The export's `family` column (§NNN): the other people on the address, «; »-joined, or empty. */
export function familyColumn(members: readonly FamilyMember[] | undefined): string {
  return (members ?? []).map((member) => member.name).join("; ");
}
