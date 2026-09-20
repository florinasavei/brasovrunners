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
 * Race numbers (BR-REQ-038-01, `DECISIONS.md` §65, §173).
 *
 * Two operations, both the Administrator's. **Assigning** gives every confirmed, real
 * registration of one event that has no number yet the next free number counting up from the
 * event's own `bib_start_number`, in order of confirmation, and touches nothing else: a number
 * once given is never renumbered, so a bib printed on Friday is still right on Sunday. Since
 * §87 a registration draws its number the moment it is confirmed, so the batch is for events
 * confirmed before that and for numbers released since. **Listing** is what the printed sheet
 * and the start line read.
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
export const BIB_RANGE = { threeDigits: 999, fourDigits: 9999 } as const;

/** The highest number this event can reach, counting from its own band (§173). */
const ceilingFor = (start: number) => Math.max(start + BIB_RANGE.fourDigits, BIB_RANGE.fourDigits);

/**
 * The next free number at this event, counting up from the event's own start (§173, reversing
 * §94).
 *
 * **In order of registration, from the race's own first number.** §94 drew at random, on the
 * owner's instruction at the time ("the bibs must be generated randomly"); he reversed it
 * (2026-09-20): "cred că ar fi mai ușor să dăm numerele de concurs în ordinea înscrierii, așa
 * se face de obicei, dar există un prefix de cursă — spre exemplu numerele pot începe cu 1
 * acum dar la alte curse sunt de la 100 în funcție de distanță și au altă culoare". He is
 * describing how every race does it, and the reasons are good ones: a sequential list is a
 * list a volunteer can check off, an envelope of pre-printed bibs can be handed out in order,
 * and the band a number falls in says which start line it belongs on.
 *
 * What does **not** change: a number once given is never taken back or reissued, so a bib
 * printed on Friday is still right on Sunday; a cancelled registration keeps its number, which
 * is how two people avoid both wearing 17; and the whole draw happens under the event row's
 * lock, the same serialization point capacity uses (§10.6), so two confirmations cannot reach
 * the same free number.
 *
 * A gap is left where a number was released or typed by hand out of order, and the next
 * registration fills it — "the lowest free number at or above the start" rather than "the last
 * one plus one", because the second would skip a hundred numbers the day somebody enters 900
 * by hand.
 */
export async function pickBibNumber<T extends Record<string, unknown>>(
  tx: Database<T>,
  eventId: string,
  taken: Set<number> = new Set(),
  startNumber?: number,
): Promise<number> {
  const worn = await tx
    .select({ number: registrations.bibNumber })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), isNotNull(registrations.bibNumber)));
  for (const row of worn) taken.add(row.number as number);

  // The caller inside a transaction that already holds the event row usually passes the start;
  // read it when it did not, so nothing has to remember to.
  const start =
    startNumber ??
    (await tx.select({ start: events.bibStartNumber }).from(events).where(eq(events.id, eventId)).limit(1))[0]?.start ??
    1;

  const ceiling = ceilingFor(start);
  for (let candidate = start; candidate <= ceiling; candidate += 1) {
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new DomainError("VALIDATION_ERROR", `every race number from ${start} to ${ceiling} is taken at this event`);
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
    // The band this race counts from (§173), read once under the same lock.
    const [event] = await tx
      .select({ id: events.id, bibStartNumber: events.bibStartNumber })
      .from(events)
      .where(eq(events.id, input.eventId))
      .for("update");
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
      const number = await pickBibNumber(tx, input.eventId, taken, event.bibStartNumber);
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

/**
 * The first free numbers at an event, from `from` upwards (§105): what the backoffice shows
 * beside the "race number" field so a preferential number is picked among the free ones rather
 * than guessed and refused. Cancelled numbers stay taken, as in the batch (§79).
 */
export async function suggestFreeBibNumbers<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  from?: number,
  count = 8,
): Promise<number[]> {
  const rows = await db
    .select({ bibNumber: registrations.bibNumber })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), isNotNull(registrations.bibNumber)));
  const taken = new Set(rows.map((row) => row.bibNumber as number));
  // From the event's own band unless the caller asked from somewhere (§173): suggesting 1, 2, 3
  // at a race whose numbers start at 500 offers numbers nobody would print.
  const start =
    from ??
    (await db.select({ start: events.bibStartNumber }).from(events).where(eq(events.id, eventId)).limit(1))[0]?.start ??
    1;
  const free: number[] = [];
  for (let n = Math.max(1, start); free.length < count && n <= 99_999; n += 1) {
    if (!taken.has(n)) free.push(n);
  }
  return free;
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
