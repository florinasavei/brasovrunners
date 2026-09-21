import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { recordAuditEvent } from "@/modules/audit/repository";
import { type CoHost, readCoHosts } from "@/modules/events/domain/co-hosts";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { holdsAPlace, PLACE_HOLDING_STATUSES } from "./domain/state-machine";

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

/**
 * The lowest provisional number free at this event, from the event's own band (§214).
 *
 * **It reuses a released number, and that is the whole difference from `pickBibNumber`.** The
 * final number is never reissued, because a bib printed on Friday has to still be right on
 * Sunday. A provisional number is printed nowhere and emailed to nobody, so the only cost of
 * reuse is none, and the benefit is real: the sequence stays dense, so the number a runner sees
 * before the race closes is usually the number they end up with, and the club can read the list
 * and know how many people it has.
 *
 * "Taken" therefore means *held right now* — by a live, place-holding registration — and also
 * by any final number already given at this event, so the two sequences cannot point at the
 * same runner's chest from two columns.
 */
export async function pickProvisionalBibNumber<T extends Record<string, unknown>>(
  tx: Database<T>,
  eventId: string,
  taken: Set<number> = new Set(),
  startNumber?: number,
): Promise<number> {
  const held = await tx
    .select({ provisional: registrations.provisionalBibNumber, final: registrations.bibNumber })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));
  for (const row of held) {
    // A final number is taken for ever (it may have been printed); a provisional one only
    // while somebody is actually holding it.
    if (row.final !== null) taken.add(row.final);
    if (row.provisional !== null) taken.add(row.provisional);
  }

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

/**
 * Give this registration a provisional number if it should have one and does not (§214).
 *
 * Called from the allocator's own paths, which already hold the event row's lock — the same
 * serialization point capacity uses (§10.6), and the reason two registrations arriving together
 * cannot both draw 12. It is written to be safe to call twice: a row that already has one keeps
 * it, so a restart or a second allocation never renumbers somebody.
 *
 * A `TEST` registration gets none, for the reason it appears in no count the club is given
 * (`AGENTS.md` §12.6): a number is the most physical count there is.
 */
export async function ensureProvisionalBibNumber<T extends Record<string, unknown>>(
  tx: Database<T>,
  input: { eventId: string; registrationId: string; bibStartNumber?: number; now: Date },
): Promise<number | null> {
  const [row] = await tx
    .select({
      status: registrations.status,
      kind: registrations.kind,
      provisional: registrations.provisionalBibNumber,
      final: registrations.bibNumber,
    })
    .from(registrations)
    .where(eq(registrations.id, input.registrationId))
    .limit(1);
  if (!row) return null;
  if (row.kind !== "REAL") return null;
  if (!holdsAPlace(row.status)) return null;
  // Already settled, or already held: never renumber somebody who has a number.
  if (row.final !== null) return row.final;
  if (row.provisional !== null) return row.provisional;

  const number = await pickProvisionalBibNumber(tx, input.eventId, new Set(), input.bibStartNumber);
  await tx
    .update(registrations)
    .set({ provisionalBibNumber: number, updatedAt: input.now })
    .where(eq(registrations.id, input.registrationId));
  return number;
}

/** One runner numbered by the settle, and everything the message to them needs. */
export type SettledBib = {
  registrationId: string;
  participantId: string;
  locale: "ro" | "en";
  recipientEmail: string;
  bibNumber: number;
};

/**
 * Turn the provisional sequence into the final one, once, when registration closes
 * (`DECISIONS.md` §214).
 *
 * ## Why a recompaction and not simply "keep the number you were given"
 *
 * The provisional sequence is dense while it is being handed out and full of holes by the end:
 * people cancel, email confirmations lapse, holds expire, and every one of those releases a
 * number in the middle. Printing that is printing a sheet with gaps — 1, 2, 5, 6, 9 — and a
 * box of bibs a volunteer cannot count off. So at the close every runner still holding a place
 * is renumbered into one unbroken run from the event's own band.
 *
 * **This is the only moment a number moves**, and it is why the provisional one is never
 * emailed. After this the ordinary rule resumes: a final number is never reissued and never
 * renumbered (§173).
 *
 * ## The order
 *
 * By the provisional number itself, which is registration order. Somebody who registered first
 * ends up with a lower number than somebody who registered later, and — because the holes are
 * usually few — most people keep the number they had been looking at.
 *
 * ## What "still holding a place" means
 *
 * Everyone the club has to print a bib for: confirmed, and also those who have not signed yet.
 * A declaration can be signed on paper at the desk on race day (§67), so an unsigned
 * registration is a person who may well run, and a race with no bib for them is the failure
 * this is trying to avoid. A number already given by hand (§105) is kept and reserved, so the
 * sequence closes around it.
 *
 * Idempotent through `events.bibs_settled_at`: the job sees the same closed event every few
 * minutes and must do this exactly once.
 */
export async function settleBibNumbers<T extends Record<string, unknown>>(
  tx: Database<T>,
  input: { eventId: string; bibStartNumber: number; bibsSettledAt: Date | null; now: Date },
): Promise<SettledBib[]> {
  if (input.bibsSettledAt !== null) return [];

  const waiting = await tx
    .select({
      id: registrations.id,
      participantId: registrations.participantId,
      locale: registrations.locale,
      recipientEmail: participants.deliveryEmail,
      provisional: registrations.provisionalBibNumber,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .where(
      and(
        eq(registrations.eventId, input.eventId),
        eq(registrations.kind, "REAL"),
        isNull(registrations.bibNumber),
        inArray(registrations.status, [...PLACE_HOLDING_STATUSES]),
      ),
    )
    // Registration order, by the number they were already shown; the id breaks a tie, and a
    // row with no provisional number at all (given a place before this existed) goes last.
    .orderBy(
      sql`${registrations.provisionalBibNumber} asc nulls last`,
      asc(registrations.createdAt),
      asc(registrations.id),
    );

  // Numbers already final at this event — one typed by hand, or a confirmation that happened
  // after a previous close. The sequence closes around them rather than colliding.
  const worn = await tx
    .select({ number: registrations.bibNumber })
    .from(registrations)
    .where(and(eq(registrations.eventId, input.eventId), isNotNull(registrations.bibNumber)));
  const taken = new Set(worn.map((row) => row.number as number));

  const settled: SettledBib[] = [];
  let candidate = input.bibStartNumber;
  for (const row of waiting) {
    while (taken.has(candidate)) candidate += 1;
    taken.add(candidate);
    await tx
      .update(registrations)
      // The provisional number goes with it: one number per runner, and the column that said
      // "this can still change" must not be left behind saying something else.
      .set({ bibNumber: candidate, provisionalBibNumber: null, updatedAt: input.now })
      .where(eq(registrations.id, row.id));
    settled.push({
      registrationId: row.id,
      participantId: row.participantId,
      locale: row.locale,
      recipientEmail: row.recipientEmail,
      bibNumber: candidate,
    });
    candidate += 1;
  }

  await tx.update(events).set({ bibsSettledAt: input.now }).where(eq(events.id, input.eventId));
  return settled;
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
  // Both columns (§214): a provisional number is one somebody is already looking at on their
  // own page, so offering it as free is offering to give two people the same number — the
  // unique index would refuse the second, and the organizer would meet the refusal after
  // typing. Cancelled *final* numbers stay taken, as in the batch (§79); a cancelled
  // provisional one was released when the place was, so it is genuinely free again.
  const rows = await db
    .select({ bibNumber: registrations.bibNumber, provisional: registrations.provisionalBibNumber })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));
  const taken = new Set<number>();
  for (const row of rows) {
    if (row.bibNumber !== null) taken.add(row.bibNumber);
    if (row.provisional !== null) taken.add(row.provisional);
  }
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

/**
 * What a bib carries besides the number: the event's title in one language and its date, the
 * colour of its header band (§173) and the partners it is held with (§168, §180).
 *
 * One query for all four because both renderers draw all four — the sheet and the preview
 * picture are the same card, and a route that had to assemble the header from three places is
 * how the two would come to disagree.
 */
export async function findEventForBibs<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  locale: string,
): Promise<{ title: string; startsAt: Date; timezone: string; bibColour: string | null; coHosts: CoHost[] } | undefined> {
  const [row] = await db
    .select({
      title: eventTranslations.title,
      startsAt: events.startsAt,
      timezone: events.timezone,
      bibColour: events.bibColour,
      coHosts: events.coHosts,
      coHostName: events.coHostName,
      coHostUrl: events.coHostUrl,
    })
    .from(events)
    .innerJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale as "ro" | "en")))
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row) return undefined;
  // Through the one reader that decides what a partner row means (§169), never by reading the
  // column here: the bib has to name the same partners the event page does.
  return {
    title: row.title,
    startsAt: row.startsAt,
    timezone: row.timezone,
    bibColour: row.bibColour,
    coHosts: readCoHosts(row),
  };
}
