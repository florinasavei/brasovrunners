import { randomInt } from "node:crypto";
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
 * registration of one event that has no number yet a number drawn at random from those never
 * worn there (§94), in order of confirmation, and touches nothing else: a number once given
 * is never renumbered, so a bib printed on Friday is still right on Sunday. Since §87 a
 * registration draws its number the moment it is confirmed, so the batch is for events
 * confirmed before that. **Listing** is what the printed sheet and the start line read.
 *
 * Test registrations never get a number and never appear on a sheet: they are omitted from
 * every count the club is given (`AGENTS.md` §12.6), and a bib is the most physical count there
 * is. Cancelled and expired registrations keep the number they had, if any, so it is not handed
 * to somebody else — reuse is how two people end up wearing 17.
 *
 * The assignment runs under `FOR UPDATE` on the event row, the same serialization point the
 * capacity transaction uses (§10.6): two organizers pressing "assign" at once would otherwise
 * both draw from the same free set and could both write 18. The partial unique index on
 * `(event_id, bib_number)` is the guarantee; the lock is what keeps the guarantee from surfacing
 * as an error.
 */
/**
 * A race number for an event, drawn at random from the numbers never worn there (the owner,
 * 2026-09-18: "the bibs must be generated randomly"; `DECISIONS.md` §94). Three digits while
 * they last, four once most of the three-digit ones are gone, so a number stays readable on a
 * shirt; a cancelled registration's number is still taken, because reuse is how two people end
 * up wearing 17. Called at confirmation, inside the transaction that already holds the event
 * row locked for capacity (§87) — the lock is what keeps two confirmations from drawing the
 * same number, and the unique constraint on `(event_id, bib_number)` is the backstop.
 */
export const BIB_RANGE = { threeDigits: 999, fourDigits: 9999 } as const;

export async function pickBibNumber<T extends Record<string, unknown>>(
  tx: Database<T>,
  eventId: string,
  taken: Set<number> = new Set(),
): Promise<number> {
  const worn = await tx
    .select({ number: registrations.bibNumber })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), isNotNull(registrations.bibNumber)));
  for (const row of worn) taken.add(row.number as number);
  const ceiling = taken.size < BIB_RANGE.threeDigits * 0.8 ? BIB_RANGE.threeDigits : BIB_RANGE.fourDigits;
  if (taken.size >= ceiling) throw new DomainError("VALIDATION_ERROR", `every race number up to ${ceiling} is taken at this event`);
  // Draw from the free numbers, not "draw until unused": the second is slow exactly when the
  // range is nearly full, which is the one time it matters.
  const free: number[] = [];
  for (let n = 1; n <= ceiling; n += 1) if (!taken.has(n)) free.push(n);
  const number = free[randomInt(free.length)];
  taken.add(number);
  return number;
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

    const taken = new Set<number>();
    const given: number[] = [];
    for (const row of waiting) {
      const number = await pickBibNumber(tx, input.eventId, taken);
      given.push(number);
      await tx
        .update(registrations)
        .set({ bibNumber: number, updatedAt: now })
        .where(eq(registrations.id, row.id));
    }

    if (waiting.length > 0) {
      await recordAuditEvent(tx, {
        actorStaffUserId: input.actor.id,
        action: "registration.bibs_assigned",
        entityType: "event",
        entityId: input.eventId,
        metadata: { assigned: waiting.length, numbers: [...given].sort((x, y) => x - y) },
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

export type BibRow = { id: string; bibNumber: number; registeredName: string };

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
    .select({ id: registrations.id, bibNumber: registrations.bibNumber, registeredName: registrations.registeredName })
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
  return rows.map((row) => ({ id: row.id, bibNumber: row.bibNumber as number, registeredName: row.registeredName }));
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
