import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { events, eventTranslations } from "@/db/schema/events";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";

type Actor = Pick<StaffUser, "id" | "role">;

/**
 * Race numbers (BR-REQ-038-01, `DECISIONS.md` §65).
 *
 * Two operations, both the Administrator's. **Assigning** gives every confirmed, real
 * registration of one event that has no number yet the next free numbers, in order of
 * confirmation — first confirmed, lowest number — and touches nothing else: a number once given
 * is never renumbered, so a bib printed on Friday is still right on Sunday, and a registration
 * confirmed after the first batch gets the next number after the batch. **Listing** is what the
 * printed sheet and the start line read.
 *
 * Test registrations never get a number and never appear on a sheet: they are omitted from
 * every count the club is given (`AGENTS.md` §12.6), and a bib is the most physical count there
 * is. Cancelled and expired registrations keep the number they had, if any, so it is not handed
 * to somebody else — reuse is how two people end up wearing 17.
 *
 * The assignment runs under `FOR UPDATE` on the event row, the same serialization point the
 * capacity transaction uses (§10.6): two organizers pressing "assign" at once would otherwise
 * both read the same maximum and both write 18. The partial unique index on
 * `(event_id, bib_number)` is the guarantee; the lock is what keeps the guarantee from surfacing
 * as an error.
 */
/**
 * The next free race number for an event — one more than the highest ever given there, so a
 * cancelled registration's number is never reused. Called at confirmation (`DECISIONS.md`
 * §87), inside the transaction that already holds the event row locked for capacity: the
 * lock is what makes "max + 1" safe, and the unique constraint on `(event_id, bib_number)`
 * is the backstop.
 */
export async function nextBibNumber<T extends Record<string, unknown>>(
  tx: Database<T>,
  eventId: string,
): Promise<number> {
  const [{ highest }] = await tx
    .select({ highest: sql<number>`coalesce(max(${registrations.bibNumber}), 0)` })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));
  return Number(highest) + 1;
}

export async function assignBibNumbers<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; eventId: string; now?: Date },
): Promise<{ assigned: number; total: number }> {
  const now = input.now ?? new Date();
  if (!canManageRegistrations(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not assign race numbers`);
  }

  return db.transaction(async (tx) => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, input.eventId)).for("update");
    if (!event) throw new DomainError("NOT_FOUND", "no such event");

    const [{ highest }] = await tx
      .select({ highest: sql<number>`coalesce(max(${registrations.bibNumber}), 0)` })
      .from(registrations)
      .where(eq(registrations.eventId, input.eventId));

    const waiting = await tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, input.eventId),
          eq(registrations.status, "CONFIRMED"),
          eq(registrations.kind, "REAL"),
          isNull(registrations.bibNumber),
        ),
      )
      // Confirmation order, then the id as a stable tie-break for two confirmed in one instant.
      .orderBy(asc(registrations.confirmedAt), asc(registrations.id));

    let next = Number(highest);
    for (const row of waiting) {
      next += 1;
      await tx
        .update(registrations)
        .set({ bibNumber: next, updatedAt: now })
        .where(eq(registrations.id, row.id));
    }

    if (waiting.length > 0) {
      await recordAuditEvent(tx, {
        actorStaffUserId: input.actor.id,
        action: "registration.bibs_assigned",
        entityType: "event",
        entityId: input.eventId,
        metadata: { assigned: waiting.length, from: Number(highest) + 1, to: next },
        now,
      });
    }

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)` })
      .from(registrations)
      .where(and(eq(registrations.eventId, input.eventId), isNotNull(registrations.bibNumber)));

    return { assigned: waiting.length, total: Number(total) };
  });
}

export type BibRow = { bibNumber: number; registeredName: string };

/**
 * The numbers to print, lowest first, optionally a range — for a reprint, or for the batch that
 * arrived after the first sheet went to the printer. Real registrations only; a cancelled
 * registration keeps its number but is not printed.
 */
export async function listBibs<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  range: { from?: number; to?: number } = {},
): Promise<BibRow[]> {
  const rows = await db
    .select({ bibNumber: registrations.bibNumber, registeredName: registrations.registeredName })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.status, "CONFIRMED"),
        eq(registrations.kind, "REAL"),
        isNotNull(registrations.bibNumber),
        range.from !== undefined ? sql`${registrations.bibNumber} >= ${range.from}` : undefined,
        range.to !== undefined ? sql`${registrations.bibNumber} <= ${range.to}` : undefined,
      ),
    )
    .orderBy(asc(registrations.bibNumber));
  return rows.map((row) => ({ bibNumber: row.bibNumber as number, registeredName: row.registeredName }));
}

/** What the sheet prints above every number: the event's title in one language, and its date. */
export async function findEventForBibs<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  locale: string,
): Promise<{ title: string; startsAt: Date; timezone: string } | undefined> {
  const [row] = await db
    .select({ title: eventTranslations.title, startsAt: events.startsAt, timezone: events.timezone })
    .from(events)
    .innerJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale as "ro" | "en")))
    .where(eq(events.id, eventId))
    .limit(1);
  return row;
}
