import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type BibDesign, readBibDesign } from "./bib-design";
import { recordAuditEvent } from "@/modules/audit/repository";
import { type CoHost, readCoHosts } from "@/modules/events/domain/co-hosts";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { freeSpareNumbers, isSpareNumber, type SpareBand, spareBandOf } from "./domain/spare-bibs";
import { holdsAPlace, TERMINAL_STATUSES } from "./domain/state-machine";

type Actor = Pick<StaffUser, "id" | "role">;

/**
 * The event's band as the draws need it: where its numbers start and which numbers are the desk's
 * spares (§173, §NNN). One read, by the primary key, on every draw — the spares are the reason it
 * is read even when the caller already knows the start: a draw that forgot them would hand a
 * pre-printed spare to somebody who registered online.
 */
async function bandOf<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  startNumber?: number,
): Promise<{ start: number; spare: SpareBand | null }> {
  const [row] = await db
    .select({ start: events.bibStartNumber, bibSpareFrom: events.bibSpareFrom, bibSpareTo: events.bibSpareTo })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  return { start: startNumber ?? row?.start ?? 1, spare: row ? spareBandOf(row) : null };
}

/**
 * Every number this event has on somebody — settled, provisional, and erased (§214, §311) — as one
 * set, for the checks that ask "is this one free" rather than "which is the next".
 */
async function numbersInUse<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<Set<number>> {
  const rows = await db
    .select({ number: registrations.bibNumber, provisional: registrations.provisionalBibNumber })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));
  const taken = new Set<number>();
  for (const row of rows) {
    if (row.number !== null) taken.add(row.number);
    if (row.provisional !== null) taken.add(row.provisional);
  }
  for (const number of await erasedBibNumbers(db, eventId)) taken.add(number);
  return taken;
}

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
 * The settled numbers of registrations that were **erased** at this event (`DECISIONS.md` §311).
 *
 * A number is never reissued (§173), and every draw in this file learns which numbers are taken
 * by reading the ones rows wear. Erasing a registration (BR-REQ-037-06) deletes its row, and with
 * it the only place its number was written — so an erased 27 was the lowest free number again,
 * and the next confirmation drew it while the bib printed for the erased entry was still in the
 * club's pile and the email saying "27" was still in somebody's inbox.
 *
 * The number survives in the erasure's own audit row: `admin-service.ts#eraseRegistration`
 * writes the event, the number and whether it was printed — never who — into a table that is
 * insert-only and outlives the deletion by design. This reads it back, and every draw adds it to
 * what is taken. Every erased settled number, printed or not: the runner was emailed it either
 * way, which is the same reason a cancelled number stays taken whether or not it reached a
 * printer. No migration: the fact already had a home that no deletion reaches.
 *
 * **Read after the rows, never before**, by every caller. The erasure commits its audit row
 * before the transaction that deletes the row begins, so a reader whose snapshot no longer sees
 * the row necessarily sees the audit row; the other order leaves a window in which the number is
 * in neither place. No index serves this and none is needed at a club's scale: the filter on
 * `action` discards nearly every row of a table that holds the staff's own presses. The number is
 * retired for as long as its audit row is kept (three years, `jobs/retention.ts`), which is far
 * longer than any event's draws last after an erasure made before it.
 */
export async function erasedBibNumbers<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<number[]> {
  const rows = await db
    .select({ number: sql<number>`(${auditLogs.metadataJson} ->> 'bibNumber')::integer`.mapWith(Number) })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, "registration.deleted_by_staff"),
        sql`${auditLogs.metadataJson} ->> 'eventId' = ${eventId}`,
        // Digits only before the cast: this sits on every allocation's path, and a row that was
        // somehow written otherwise must be skipped, never turn every registration into an error.
        sql`${auditLogs.metadataJson} ->> 'bibNumber' ~ '^[0-9]{1,5}$'`,
      ),
    );
  return rows.map((row) => row.number);
}

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
 * is how two people avoid both wearing 17; an erased one's stays taken through its audit row
 * (`erasedBibNumbers`, §311), because "lowest free" would otherwise go straight back to it; and
 * the whole draw happens under the event row's lock, the same serialization point capacity uses
 * (§10.6), so two confirmations cannot reach the same free number.
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
  /*
    Both columns, and the second one is not decoration (§220).

    A final number must not collide with a provisional one somebody is currently holding. It
    can happen after the settle: registration has closed, two people are entered at the desk
    and each is given a provisional number, and the first of them to be confirmed goes through
    here — which, reading `bib_number` alone, would hand them the number the *other* one is
    looking at. The partial unique index would not catch it, because the two live in different
    columns, and the first anybody would know is two runners at the start line with one number.
  */
  const worn = await tx
    .select({ number: registrations.bibNumber, provisional: registrations.provisionalBibNumber })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));
  for (const row of worn) {
    if (row.number !== null) taken.add(row.number);
    if (row.provisional !== null) taken.add(row.provisional);
  }
  // And the numbers erased rows wore (§311), after the rows — `erasedBibNumbers` says why.
  for (const number of await erasedBibNumbers(tx, eventId)) taken.add(number);

  // The caller inside a transaction that already holds the event row usually passes the start;
  // it is read when it did not, and the desk's spares always are (§NNN): never drawn here.
  const { start, spare } = await bandOf(tx, eventId, startNumber);

  const ceiling = ceilingFor(start);
  for (let candidate = start; candidate <= ceiling; candidate += 1) {
    if (!taken.has(candidate) && !isSpareNumber(spare, candidate)) {
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
  // An erased row's final number is taken for ever too (§311): a provisional 27 handed out
  // after the erasure would be promoted to a final 27 the moment its holder confirmed.
  for (const number of await erasedBibNumbers(tx, eventId)) taken.add(number);

  // Nor a spare (§NNN): a provisional number becomes the final one at the close or at the
  // confirmation after it, so a spare drawn here would be a spare on an online runner's bib.
  const { start, spare } = await bandOf(tx, eventId, startNumber);

  const ceiling = ceilingFor(start);
  for (let candidate = start; candidate <= ceiling; candidate += 1) {
    if (!taken.has(candidate) && !isSpareNumber(spare, candidate)) {
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
 * The statuses a close numbers (§420): the ones the capacity formula counts as a place
 * (`domain/capacity.ts#computeOccupied` — confirmed, a declaration hold, an offer). Not
 * `PLACE_HOLDING_STATUSES`, which adds `PENDING_EMAIL_CONFIRMATION` so a provisional number can be
 * drawn at submission (§214): an address nobody has proved takes no place (AGENTS.md §10.5
 * invariant 3, §10.6 rule 6), so on a full race it can confirm onto the waiting list — and a final
 * number, which is never taken back (§173), would then be worn by somebody with no place, and
 * emailed to an unproved address as "you are in".
 */
const NUMBERED_AT_SETTLE = ["PENDING_DECLARATION", "WAITLIST_OFFERED", "CONFIRMED"] as const;

/**
 * Who a close numbers — and so who is sent "here is your race number" — at one event: a real
 * registration occupying a place with no final number. The settle and the forecast on
 * `/admin/emails` (§383) read the same condition.
 */
export function awaitingSettledNumber() {
  return and(
    eq(registrations.kind, "REAL"),
    isNull(registrations.bibNumber),
    inArray(registrations.status, [...NUMBERED_AT_SETTLE]),
  );
}

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
 * sequence closes around it. An address not yet confirmed at the close is not "still holding a
 * place" in this sense (§420): it is not numbered here, and gives its provisional number back —
 * nobody can print a bib for an address that has not agreed to come.
 * Only `NUMBERED_AT_SETTLE` — `PENDING_DECLARATION`, `WAITLIST_OFFERED`, `CONFIRMED` — is settled;
 * `PENDING_EMAIL_CONFIRMATION` is released first, in the same transaction, below.
 *
 * Idempotent through `events.bibs_settled_at`: the job sees the same closed event every few
 * minutes and must do this exactly once.
 */
export async function settleBibNumbers<T extends Record<string, unknown>>(
  tx: Database<T>,
  input: { eventId: string; bibStartNumber: number; bibsSettledAt: Date | null; now: Date },
): Promise<SettledBib[]> {
  if (input.bibsSettledAt !== null) return [];

  /*
    An address still unconfirmed at the close is not numbered (§420), and gives back the
    provisional number it drew at submission, in the same transaction. The recompaction below
    reads only final numbers as taken, so it may hand that number to somebody else as theirs — and
    a later confirmation of this row would adopt its own provisional number (§220) and collide on
    the unique index. Released, a late confirmation that does get a place draws a fresh number the
    way any post-close confirmation does (`ensureProvisionalBibNumber`, `pickBibNumber`).
  */
  await tx
    .update(registrations)
    .set({ provisionalBibNumber: null, updatedAt: input.now })
    .where(
      and(
        eq(registrations.eventId, input.eventId),
        eq(registrations.status, "PENDING_EMAIL_CONFIRMATION"),
        isNotNull(registrations.provisionalBibNumber),
      ),
    );

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
    .where(and(eq(registrations.eventId, input.eventId), awaitingSettledNumber()))
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
  // Erased registrations' numbers too (§311): the recompaction runs from the band's start, so
  // it is the one pass certain to reach an erased 27 if nothing said it was taken.
  const taken = new Set([...worn.map((row) => row.number as number), ...(await erasedBibNumbers(tx, input.eventId))]);
  // And the desk's spares (§NNN): the run closes around them, as around a number typed by hand —
  // a spare is printed blank for a walk-in, and the settled sequence is printed with names.
  const { spare } = await bandOf(tx, input.eventId, input.bibStartNumber);

  const settled: SettledBib[] = [];
  let candidate = input.bibStartNumber;
  for (const row of waiting) {
    while (taken.has(candidate) || isSpareNumber(spare, candidate)) candidate += 1;
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
): Promise<{ assigned: number; total: number; notConfirmed: number; test: number }> {
  const now = input.now ?? new Date();
  if (!canManageRegistrations(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not assign race numbers`);
  }

  return db.transaction(async (tx) => {
    // The band this race counts from (§173), read once under the same lock.
    const [event] = await tx
      .select({ id: events.id, bibStartNumber: events.bibStartNumber, bibSpareFrom: events.bibSpareFrom, bibSpareTo: events.bibSpareTo })
      .from(events)
      .where(eq(events.id, input.eventId))
      .for("update");
    if (!event) throw new DomainError("NOT_FOUND", "no such event");

    const waiting = await tx
      .select({ id: registrations.id, provisional: registrations.provisionalBibNumber })
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
      /*
        A provisional number is **kept**, not replaced (§286; the owner, looking at a row:
        "cum pot avea prezenta marcata dar numar cu steluta?").

        The desk hands somebody a number on race morning and writes it in
        `provisional_bib_number`; the list draws it lighter, with an asterisk, precisely because
        it is not settled yet. Confirming one registration already promotes it (`service.ts`) —
        the batch did not, and looked only for rows with no *final* number. So a runner who had
        been told "you are 5", and had walked away with 5 written on their hand, was quietly
        given 100 by the button, while the screen still showed `5*` beside them.

        Two numbers for one person, one of them on the start line and neither of them wrong
        anywhere the club could see it. The promotion is the fix: the number they were told is
        the number they keep.
      */
      // Except a provisional number inside the desk's spares (§NNN) — one drawn before the club
      // set the band — which is not kept: it would put a spare on an online runner's bib.
      const keep = row.provisional !== null && !isSpareNumber(spareBandOf(event), row.provisional);
      const number = keep ? (row.provisional as number) : await pickBibNumber(tx, input.eventId, taken, event.bibStartNumber);
      taken.add(number);
      given.push(number);
      await tx
        .update(registrations)
        .set({ bibNumber: number, provisionalBibNumber: null, updatedAt: now })
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

    /*
      Why nothing happened, when nothing happened (§286; the owner: "anumerarea in batch nu
      merge!").

      It was working: a number is given to a **confirmed, real** registration that has none, and
      pressing the button on an event whose entrants are still at the declaration — or are test
      rows — assigned nought and reported "0 numere alocate", which reads exactly like a broken
      button. The two reasons are counted here so the screen can name them; they cost one query
      on a path somebody presses a handful of times per race.
    */
    const [skipped] = await tx
      .select({
        notConfirmed: sql<number>`count(*) filter (where ${registrations.kind} = 'REAL' and ${registrations.status} <> 'CONFIRMED' and ${registrations.status} <> 'CANCELLED')`,
        test: sql<number>`count(*) filter (where ${registrations.kind} = 'TEST')`,
      })
      .from(registrations)
      .where(eq(registrations.eventId, input.eventId));

    return {
      assigned: waiting.length,
      total: Number(total),
      /** Real entrants who are not confirmed yet: a number follows the declaration, never precedes it. */
      notConfirmed: Number(skipped?.notConfirmed ?? 0),
      /** Test rows, which never wear a number (§30). */
      test: Number(skipped?.test ?? 0),
    };
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
  // Nor an erased registration's number (§311): offering it would be offering a refusal.
  for (const number of await erasedBibNumbers(db, eventId)) taken.add(number);
  // From the event's own band unless the caller asked from somewhere (§173): suggesting 1, 2, 3
  // at a race whose numbers start at 500 offers numbers nobody would print. Never a desk spare
  // (§NNN): a preferential number is printed with a name, and a spare is printed without one —
  // the desk suggests those itself, from `freeSpareBibNumbers`.
  const { start, spare } = await bandOf(db, eventId, from);
  const free: number[] = [];
  for (let n = Math.max(1, start); free.length < count && n <= 99_999; n += 1) {
    if (!taken.has(n) && !isSpareNumber(spare, n)) free.push(n);
  }
  return free;
}

/**
 * The desk's spares still free at this event, lowest first (§NNN): what the spares sheet prints
 * blank and what the desk offers a walk-in — the band's numbers nobody wears, holds or wore.
 * `band` is null when the club set none, and then there is nothing to suggest.
 */
export async function freeSpareBibNumbers<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ band: SpareBand | null; free: number[] }> {
  const { spare } = await bandOf(db, eventId);
  if (!spare) return { band: null, free: [] };
  // The rows first, then the erased numbers (§311), as every draw here reads them.
  return { band: spare, free: freeSpareNumbers(spare, await numbersInUse(db, eventId)) };
}

/**
 * The spare the desk suggests next at each of these events (§NNN): the lowest free one, or null
 * where the club set no band or every spare is out. One call per event on a page that shows one or
 * two of them; the desk never shows more.
 */
export async function nextSpareBibNumbers<T extends Record<string, unknown>>(
  db: Database<T>,
  eventIds: readonly string[],
): Promise<Record<string, number | null>> {
  const unique = [...new Set(eventIds)];
  const entries = await Promise.all(
    unique.map(async (eventId) => [eventId, (await freeSpareBibNumbers(db, eventId)).free[0] ?? null] as const),
  );
  return Object.fromEntries(entries);
}

/**
 * Whether a number typed at the desk is somebody's already (§NNN): settled or provisional on
 * another registration of this event, or worn by one that was erased (§311). The unique index
 * catches only the settled column; a provisional number somebody is looking at would otherwise be
 * given away by hand and collide when its holder is confirmed and adopts it (§220).
 */
export async function bibNumberInUse<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { eventId: string; number: number; exceptRegistrationId?: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, input.eventId),
        sql`(${registrations.bibNumber} = ${input.number} OR ${registrations.provisionalBibNumber} = ${input.number})`,
        input.exceptRegistrationId ? sql`${registrations.id} <> ${input.exceptRegistrationId}` : undefined,
      ),
    )
    .limit(1);
  if (row) return true;
  return (await erasedBibNumbers(db, input.eventId)).includes(input.number);
}

/**
 * Whether this number is one of the event's desk spares (§NNN) — what decides that a number given
 * at the desk is already on paper (`admin-service.ts#setBibNumberByStaff`, the walk-in's box).
 */
export async function isEventSpareNumber<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  number: number,
): Promise<boolean> {
  return isSpareNumber((await bandOf(db, eventId)).spare, number);
}

export type BibRow = { id: string; bibNumber: number; registeredName: string };

/**
 * Which bibs a sheet is being asked for (`DECISIONS.md` §264).
 *
 * A range is for a reprint — "numbers 1 to 50 again" — and `only: "unprinted"` is the club's
 * actual weekly job: people registered after the last sheet went to the printer, and those are
 * the bibs to print now. Both together are allowed and mean what they say.
 */
export type BibScope = { from?: number; to?: number; only?: "unprinted" };

/**
 * The scope as one `WHERE`, so the list, the count and the marking cannot drift apart.
 *
 * `CONFIRMED` is load-bearing and not a default: a cancelled registration keeps its settled
 * number (§173) and may keep a printed mark, and neither a range reprint nor the unprinted batch
 * may ever put that number on paper again — the paper that exists is void (`voidBibsFor`), and
 * a second copy of it would be two bibs with one number in one pile.
 * `void-bibs.test.ts` asks for 1–50 around a cancelled, printed 27 and expects 49.
 */
const bibScopeWhere = (eventId: string, scope: BibScope) =>
  and(
    eq(registrations.eventId, eventId),
    eq(registrations.status, "CONFIRMED"),
    eq(registrations.kind, "REAL"),
    isNotNull(registrations.bibNumber),
    scope.from !== undefined ? sql`${registrations.bibNumber} >= ${scope.from}` : undefined,
    scope.to !== undefined ? sql`${registrations.bibNumber} <= ${scope.to}` : undefined,
    scope.only === "unprinted" ? isNull(registrations.bibPrintedAt) : undefined,
  );

/**
 * The numbers to print, lowest first — for a reprint, or for the batch that arrived after the
 * first sheet went to the printer. Real registrations only; a cancelled registration keeps its
 * number but is not printed.
 */
export async function listBibs<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  scope: BibScope = {},
): Promise<BibRow[]> {
  const rows = await db
    .select({ id: registrations.id, bibNumber: registrations.bibNumber, registeredName: registrations.registeredName })
    .from(registrations)
    .where(bibScopeWhere(eventId, scope))
    .orderBy(asc(registrations.bibNumber));
  return rows.map((row) => ({ id: row.id, bibNumber: row.bibNumber as number, registeredName: row.registeredName }));
}

/**
 * How many bibs there are and how many are still unprinted (§264).
 *
 * One grouped query, because this is read on every load of the registrations list and the club's
 * database bills compute time (§68) — the same discipline as the counter in §255.
 */
export async function countBibs<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ total: number; unprinted: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`.mapWith(Number),
      unprinted: sql<number>`count(*) FILTER (WHERE ${registrations.bibPrintedAt} IS NULL)`.mapWith(Number),
    })
    .from(registrations)
    .where(bibScopeWhere(eventId, {}));
  return { total: row?.total ?? 0, unprinted: row?.unprinted ?? 0 };
}

/** One printed bib nobody is entitled to wear any more (`DECISIONS.md` §311). */
export type VoidBib = {
  id: string;
  bibNumber: number;
  registeredName: string;
  status: "CANCELLED" | "EXPIRED";
  /** When the registration left the live states: `cancelled_at` or `expired_at`, whichever the status names. */
  voidedAt: Date;
};

/**
 * The printed bibs of this event that belong to nobody any more (`DECISIONS.md` §311; the
 * owner: "trebuie sa avem mare grija cu cele anulate, mai ales daca BID-ul a fost deja
 * printat!").
 *
 * A settled number is never reused (§173) and is never renumbered, so a registration that is
 * cancelled — by the participant's link, by an Administrator, or by a restart that lapses — after
 * its bib was printed leaves the number retired, which is right, and a piece of paper in the
 * club's pile with a valid-looking number on it, which is the problem. The person may still turn
 * up with the email. This is the one reader of that fact, and everything that shows it — the
 * registrations list's bibs panel, the desk's red line, the registration's own chip — reads the
 * same columns it does: a **real** registration, a **settled** number, a **printed** mark, and a
 * **terminal** status.
 *
 * Terminal, not merely "not CONFIRMED": a cancelled entry that restarts keeps its number and its
 * printed mark (`submitRegistration` carries neither away), and while it is pending again the bib
 * is a bib that will be right the moment they sign — not paper to pull. Once they lapse it is
 * void again, which is why `EXPIRED` is here although nothing goes from `CONFIRMED` to it
 * directly.
 *
 * The date is the row's own: `cancelled_at` for a cancellation and `expired_at` for a lapse.
 * Each is written together with its status and never apart — `CANCELLED` only by
 * `service.ts#unregister` through the one guarded transition, `EXPIRED` only by the four sweeps
 * in `repository.ts`, and `registrations.ts` CHECKs each pair together — so the date the status
 * names is never null here, and nothing falls back to `updated_at`. Pure SQL on
 * `registrations_event_status_idx`, lowest number first — the order somebody pulling bibs out of
 * a numbered pile reads in. A test registration never wears a number and is excluded here as
 * everywhere the club counts (`AGENTS.md` §12.6).
 */
export async function voidBibsFor<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<VoidBib[]> {
  const rows = await db
    .select({
      id: registrations.id,
      bibNumber: registrations.bibNumber,
      registeredName: registrations.registeredName,
      status: registrations.status,
      cancelledAt: registrations.cancelledAt,
      expiredAt: registrations.expiredAt,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        eq(registrations.kind, "REAL"),
        inArray(registrations.status, [...TERMINAL_STATUSES]),
        isNotNull(registrations.bibNumber),
        isNotNull(registrations.bibPrintedAt),
      ),
    )
    .orderBy(asc(registrations.bibNumber));

  return rows.map((row) => ({
    id: row.id,
    bibNumber: row.bibNumber as number,
    registeredName: row.registeredName,
    status: row.status as "CANCELLED" | "EXPIRED",
    // The pair the status names, and nothing else: non-null by construction (the docblock says
    // where each is written), so the type states what the row is rather than inventing a fallback.
    voidedAt: (row.status === "CANCELLED" ? row.cancelledAt : row.expiredAt) as Date,
  }));
}

/**
 * "These are on paper now" (§264; the owner: "să pot marca 'BID printat'").
 *
 * **A separate press from the download, and that is deliberate.** The sheet is a `GET` so it can
 * be opened in a tab, saved, mailed to whoever has the printer and opened again — and a GET must
 * not mutate (`AGENTS.md` §12.8). It is also honest: a PDF that downloaded is not a bib that
 * printed, and the club is the only one who knows whether the printer had paper.
 *
 * Idempotent over the scope: rows already marked keep the timestamp they had, so marking twice
 * does not rewrite when the first batch was printed. One audit row for the batch, naming the
 * scope and the count — never the people, for the same reason an erasure's row does not (§67).
 */
export async function markBibsPrinted<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; eventId: string; scope?: BibScope; printed?: boolean; now?: Date },
): Promise<{ marked: number }> {
  const now = input.now ?? new Date();
  if (!canManageRegistrations(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not mark bibs printed`);
  }
  const printed = input.printed ?? true;
  const scope = input.scope ?? {};

  return db.transaction(async (tx) => {
    const marked = await tx
      .update(registrations)
      .set({ bibPrintedAt: printed ? now : null, updatedAt: now })
      .where(
        and(
          bibScopeWhere(input.eventId, printed ? { ...scope, only: "unprinted" } : scope),
          printed ? undefined : isNotNull(registrations.bibPrintedAt),
        ),
      )
      .returning({ id: registrations.id });

    if (marked.length > 0) {
      await recordAuditEvent(tx, {
        actorStaffUserId: input.actor.id,
        action: printed ? "registration.bibs_printed" : "registration.bibs_unprinted",
        entityType: "event",
        entityId: input.eventId,
        metadata: { count: marked.length, from: scope.from ?? null, to: scope.to ?? null },
        now,
      });
    }

    return { marked: marked.length };
  });
}

/**
 * One registration's bib, marked printed or not (§264) — the reprint of a single bib, which is
 * what happens when one comes out of the printer creased.
 *
 * The same rule as the batch: the row must have a settled number, be confirmed and be real. A
 * registration with only a provisional number has nothing to print (§214).
 */
export async function setBibPrinted<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; registrationId: string; printed: boolean; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  if (!canManageRegistrations(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not mark bibs printed`);
  }

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(registrations)
      .set({ bibPrintedAt: input.printed ? now : null, updatedAt: now })
      .where(
        and(
          eq(registrations.id, input.registrationId),
          eq(registrations.status, "CONFIRMED"),
          eq(registrations.kind, "REAL"),
          isNotNull(registrations.bibNumber),
        ),
      )
      .returning({ id: registrations.id, eventId: registrations.eventId });
    if (!row) throw new DomainError("NOT_FOUND", "no printable bib on that registration");

    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: input.printed ? "registration.bibs_printed" : "registration.bibs_unprinted",
      entityType: "registration",
      entityId: row.id,
      metadata: { count: 1 },
      now,
    });
  });
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
): Promise<
  | {
      title: string;
      startsAt: Date;
      timezone: string;
      bibColour: string | null;
      /** Where the event's numbers start (§173): the number a sample bib is drawn with. */
      bibStartNumber: number;
      coHosts: CoHost[];
      design: BibDesign;
    }
  | undefined
> {
  const [row] = await db
    .select({
      title: eventTranslations.title,
      startsAt: events.startsAt,
      timezone: events.timezone,
      bibColour: events.bibColour,
      bibStartNumber: events.bibStartNumber,
      bibDesign: events.bibDesign,
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
    bibStartNumber: row.bibStartNumber,
    coHosts: readCoHosts(row),
    // What the club decided this bib shows (§249); anything unreadable is the platform's own.
    design: readBibDesign(row.bibDesign),
  };
}
