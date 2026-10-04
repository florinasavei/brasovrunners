import { and, asc, eq, gt, inArray, isNotNull, isNull, notInArray, type SQL, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { events, eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type BibDesign, readBibDesign } from "./bib-design";
import { memberCanonicalEmails } from "./member-ticks";
import { OFFERS_MEMBER_BIB } from "@/modules/events/repository";
import { recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { type CoHost, readCoHosts } from "@/modules/events/domain/co-hosts";
import { typedStartOrNull } from "@/modules/events/domain/provisional-start";
import { formatDay } from "@/i18n/dates";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import {
  freeSpareNumbers,
  isSpareNumber,
  nextSpareCandidates,
  planSpareReservation,
  SPARE_BIBS_PER_PRINT,
  type SpareBand,
  spareBandOf,
  type SpareState,
  spareStateOf,
  spareStopOf,
} from "./domain/spare-bibs";
import { TERMINAL_STATUSES } from "./domain/state-machine";
import { hiddenListBibStartOf, SPARES_BEFORE_HIDDEN_LIST } from "./domain/hidden-list";

type Actor = Pick<StaffUser, "id" | "role">;

/**
 * The event's band as the draws need it: where its numbers start and which numbers are the desk's
 * spares (§173, §444). One read, by the primary key, on every draw — the spares are the reason it
 * is read even when the caller already knows the start: a draw that forgot them would hand a
 * pre-printed spare to somebody who registered online.
 */
async function bandOf<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  startNumber?: number,
): Promise<{ start: number; spare: SpareBand | null; hiddenStart: number | null }> {
  const [row] = await db
    .select({
      start: events.bibStartNumber,
      walkInBibStart: events.walkInBibStart,
      walkInBibCount: events.walkInBibCount,
      hiddenListEnabled: events.hiddenListEnabled,
      hiddenListBibStart: events.hiddenListBibStart,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  return { start: startNumber ?? row?.start ?? 1, spare: row ? spareBandOf(row) : null, hiddenStart: hiddenListBibStartOf(row) };
}

/** Which of an event's two series a draw is for (§647): the race's, or the hidden list's own. */
export type BibSeries = "race" | "hidden";

/**
 * The numbers one draw may give (§173, amending it §647): from where to where.
 *
 * With no hidden-list series — the switch off, or no start set — the race's series is the whole
 * band, as it always was, and a row on the hidden list draws from it like everybody. With one, two
 * series that never meet: the hidden list's from its own start up to the race's start when it sits
 * below it, or up to the ceiling when above; and the race's from its own start up to the hidden
 * list's when that sits above it. A save that moves them refuses a hidden start inside the race's capped series, at
 * or above an uncapped race's first number, or one whose series would hold the desk's spares
 * (`service.ts#assertHiddenListNumbers`, which reads these bounds); the print keeps new spares below a hidden series above the race's
 * (`spareStopOf`); the spares are skipped by every draw as before.
 */
export function seriesBounds(band: { start: number; hiddenStart: number | null }, series: BibSeries): { from: number; to: number } {
  const { start, hiddenStart } = band;
  if (hiddenStart === null) return { from: start, to: ceilingFor(start) };
  if (series === "hidden") return { from: hiddenStart, to: hiddenStart < start ? start - 1 : ceilingFor(hiddenStart) };
  return { from: start, to: hiddenStart > start ? hiddenStart - 1 : ceilingFor(start) };
}

/**
 * The numbers the rows of this event wear (§173, §548): every `bib_number`, whatever the row's
 * status — a cancelled runner keeps theirs, retired — and any number still left in the old
 * `provisional_bib_number` column. Nothing writes that column since §548: a number exists only
 * once a registration is confirmed. It is read here only until `releaseLegacyHeldNumbers` has run
 * once on this database (the maintenance job), so a number shown before this release is never
 * drawn for somebody else in the minutes between the deploy and that run.
 */
async function wornNumbers<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  exceptRegistrationId?: string,
): Promise<Set<number>> {
  const rows = await db
    .select({ id: registrations.id, number: registrations.bibNumber, legacy: registrations.provisionalBibNumber })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));
  const taken = new Set<number>();
  for (const row of rows) {
    if (row.id === exceptRegistrationId) continue;
    if (row.number !== null) taken.add(row.number);
    if (row.legacy !== null) taken.add(row.legacy);
  }
  return taken;
}

/**
 * Every number this event has on somebody — worn, and retired (erased or replaced by hand, §311,
 * §548) — and every number a print stepped over (§444, `skippedSpareNumbers`), as one set, for the
 * checks that ask "is this one free" rather than "which is the next". The rows first, then the
 * audit rows (`erasedBibNumbers` says why).
 */
async function numbersInUse<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<Set<number>> {
  const taken = await wornNumbers(db, eventId);
  for (const number of await retiredBibNumbers(db, eventId)) taken.add(number);
  for (const number of await skippedSpareNumbers(db, eventId)) taken.add(number);
  return taken;
}

/**
 * The numbers inside the desk's reservation that were never printed blank (§444): an extension
 * reached past them while a runner held them, so the print stepped over them and wrote them in its
 * audit row (`planSpareReservation`, `skipped`). Such a number stays its runner's, and one that was
 * cleared since (a number held before §548, `releaseLegacyHeldNumbers`) is nobody's: inside the
 * band, so no draw gives it, and never a spare, because no blank bib carries it. Read from the audit rows, as the
 * erased numbers are (§311): a fact about a past print, not a column on the event.
 */
async function skippedSpareNumbers<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number[]> {
  const rows = await db
    .select({ metadata: auditLogs.metadataJson })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "registration.bib_spares_reserved"), eq(auditLogs.entityType, "event"), eq(auditLogs.entityId, eventId)));
  const skipped: number[] = [];
  for (const row of rows) {
    const list = (row.metadata as { skipped?: unknown } | null)?.skipped;
    if (!Array.isArray(list)) continue;
    // Whole numbers only: a malformed row is skipped, never turns the desk into an error.
    for (const number of list) if (Number.isInteger(number)) skipped.push(number as number);
  }
  return skipped;
}

/**
 * Race numbers (BR-REQ-038-01, `DECISIONS.md` §65, §173).
 *
 * Two operations, both the Administrator's. **Assigning** gives every confirmed, real
 * registration of one event that has no number yet the next free number counting up from the
 * event's own `bib_start_number`, in order of confirmation, and touches nothing else: a number
 * once given is never renumbered, so a bib printed on Friday is still right on Sunday. A
 * registration draws its number the moment it is confirmed and at no other (§87, §548), so the
 * batch is for a confirmed row that somehow has none. **Listing** is what the printed sheet
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
 * The numbers a staff member **replaced** by hand on a confirmed registration at this event
 * (§105, §548). Since §548 every confirmation draws its number at once and the confirmation email
 * carries it, so the preferential number typed afterwards replaces a number the runner was already
 * told. That old number is retired like a cancelled one — handing it to the next confirmation
 * would make two people who each believe they are 27. It lives in the change's own audit row
 * (`registration.bib_set`, `from`, with the event since §548), read back as the erased ones are.
 * A replacement written before §548 named no event and replaced only a number nobody had been
 * sent as final, so it retires nothing.
 */
async function replacedBibNumbers<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number[]> {
  const rows = await db
    .select({ number: sql<number>`(${auditLogs.metadataJson} ->> 'from')::integer`.mapWith(Number) })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.action, "registration.bib_set"),
        sql`${auditLogs.metadataJson} ->> 'eventId' = ${eventId}`,
        sql`${auditLogs.metadataJson} ->> 'from' ~ '^[0-9]{1,5}$'`,
      ),
    );
  return rows.map((row) => row.number);
}

/** Every number retired at this event without a row wearing it: erased (§311) or replaced by hand (§548). */
export async function retiredBibNumbers<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number[]> {
  return [...(await erasedBibNumbers(db, eventId)), ...(await replacedBibNumbers(db, eventId))];
}

/**
 * The next free number at this event, counting up from the event's own start (§173, reversing
 * §94) — drawn at the moment a registration is confirmed, and at no other (§548).
 *
 * **In order of confirmation, from the race's own first number.** §94 drew at random, on the
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
 * is how two people avoid both wearing 17; an erased or replaced one stays taken through its
 * audit row (`retiredBibNumbers`, §311, §548), because "lowest free" would otherwise go straight
 * back to it; and the whole draw happens under the event row's lock, the same serialization
 * point capacity uses (§10.6), so two confirmations cannot reach the same free number.
 *
 * Since no number is ever released, "the lowest free number" is the next one in confirmation
 * order. The one gap it fills is a number typed by hand out of order — "the lowest free number
 * at or above the start" rather than "the last one plus one", because the second would skip a
 * hundred numbers the day somebody enters 900 by hand.
 */
export async function pickBibNumber<T extends Record<string, unknown>>(
  tx: Database<T>,
  eventId: string,
  taken: Set<number> = new Set(),
  startNumber?: number,
  /**
   * «Lista ascunsă» (§647): a row on the hidden list draws from the hidden list's own series when the
   * event has one, in confirmation order like the race's; otherwise from the race's, as before.
   */
  series: BibSeries = "race",
): Promise<number> {
  for (const number of await wornNumbers(tx, eventId)) taken.add(number);
  // And the retired numbers (§311, §548), after the rows — `erasedBibNumbers` says why.
  for (const number of await retiredBibNumbers(tx, eventId)) taken.add(number);

  // The caller inside a transaction that already holds the event row usually passes the start;
  // it is read when it did not, and the desk's spares always are (§444): never drawn here.
  const band = await bandOf(tx, eventId, startNumber);
  const { from, to } = seriesBounds(band, series);
  const free = (candidate: number) => !taken.has(candidate) && !isSpareNumber(band.spare, candidate);

  for (let candidate = from; candidate <= to; candidate += 1) {
    if (free(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  /*
    The series is full (§647): the race's ran into the hidden list's first number — more confirmed than
    the room between them, or a start set below the room the save asks for. A confirmation is never
    refused for want of a number the band before the hidden list would have given: the next free number
    from the series' own start, as every draw was before there were two.
  */
  const ceiling = ceilingFor(from);
  for (let candidate = to + 1; candidate <= ceiling; candidate += 1) {
    if (free(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
  throw new DomainError("VALIDATION_ERROR", `every race number from ${from} to ${ceiling} is taken at this event`);
}

/** One confirmed runner whose number shown before §548 is kept as their race number, and what the message to them needs. */
export type KeptLegacyNumber = {
  registrationId: string;
  participantId: string;
  eventId: string;
  locale: "ro" | "en";
  recipientEmail: string;
  bibNumber: number;
  /** The race is scheduled and still ahead: only then is the runner told (a past or cancelled one needs no bib). */
  raceAhead: boolean;
};

/**
 * The one data step of §548: what the old `provisional_bib_number` column still holds becomes
 * either a race number or nothing, once.
 *
 * Before §548 a number was drawn at submission and shown as «provizoriu» until the close, when the
 * settle renumbered everybody. Now a number exists only once a registration is confirmed. So, on
 * a database that ran the old code:
 *
 * - a **confirmed** real registration with only an old held number keeps it, as its race number —
 *   it was confirmed, and it was told that number (the confirmation said it, marked «provizoriu»).
 *   Guarded against a number another row of the event already wears, which the old draws made
 *   impossible; such a row is left with no number, for «Alocă numerele» to give it one;
 * - **every other** held number is cleared: an address not confirmed, a declaration not signed, an
 *   offer, the waiting list, a cancelled or expired row. They get a number at their confirmation,
 *   in the order of confirmation, like everybody after this release.
 *
 * Both statements in one transaction, so no reader sees a number both kept and cleared. It needs
 * no event lock: every draw still reads the old column as taken until this has run (`wornNumbers`),
 * so no confirmation can reach a number this step is about to keep. Idempotent — the second run
 * finds nothing, on the partial unique index `registrations_event_provisional_bib_unique`, which
 * holds exactly the rows with a number in the column — so the maintenance job runs it every time.
 * A test registration never had a number and is never given one (§30).
 */
export async function releaseLegacyHeldNumbers<T extends Record<string, unknown>>(
  db: Database<T>,
  now: Date,
): Promise<{ kept: KeptLegacyNumber[]; cleared: number }> {
  return db.transaction(async (tx) => {
    const kept = await tx
      .update(registrations)
      .set({ bibNumber: sql`${registrations.provisionalBibNumber}`, provisionalBibNumber: null, updatedAt: now })
      .where(
        and(
          isNotNull(registrations.provisionalBibNumber),
          isNull(registrations.bibNumber),
          eq(registrations.status, "CONFIRMED"),
          eq(registrations.kind, "REAL"),
          sql`NOT EXISTS (SELECT 1 FROM ${registrations} AS "worn" WHERE "worn"."event_id" = ${registrations.eventId} AND "worn"."bib_number" = ${registrations.provisionalBibNumber})`,
        ),
      )
      .returning({
        registrationId: registrations.id,
        participantId: registrations.participantId,
        eventId: registrations.eventId,
        locale: registrations.locale,
        bibNumber: registrations.bibNumber,
      });
    const cleared = await tx
      .update(registrations)
      .set({ provisionalBibNumber: null, updatedAt: now })
      .where(isNotNull(registrations.provisionalBibNumber))
      .returning({ id: registrations.id });
    if (kept.length === 0) return { kept: [], cleared: cleared.length };
    const addresses = await tx
      .select({ id: participants.id, email: participants.deliveryEmail })
      .from(participants)
      .where(inArray(participants.id, [...new Set(kept.map((row) => row.participantId))]));
    const emailOf = new Map(addresses.map((row) => [row.id, row.email]));
    const ahead = await tx
      .select({ id: events.id })
      .from(events)
      .where(and(inArray(events.id, [...new Set(kept.map((row) => row.eventId))]), eq(events.eventStatus, "SCHEDULED"), gt(events.startsAt, now)));
    const aheadIds = new Set(ahead.map((row) => row.id));
    return {
      kept: kept.map((row) => ({
        registrationId: row.registrationId,
        participantId: row.participantId,
        eventId: row.eventId,
        locale: row.locale,
        recipientEmail: emailOf.get(row.participantId) ?? "",
        bibNumber: row.bibNumber as number,
        raceAhead: aheadIds.has(row.eventId),
      })),
      cleared: cleared.length,
    };
  });
}

export async function assignBibNumbers<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; eventId: string; now?: Date },
): Promise<{ assigned: number; total: number; notConfirmed: number; test: number }> {
  const now = input.now ?? new Date();
  if (!canManageRegistrations(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not assign race numbers`);
  }

  const result = await db.transaction(async (tx) => {
    // The band this race counts from (§173), read once under the same lock.
    const [event] = await tx
      .select({ id: events.id, bibStartNumber: events.bibStartNumber })
      .from(events)
      .where(eq(events.id, input.eventId))
      .for("update");
    if (!event) throw new DomainError("NOT_FOUND", "no such event");

    const waiting = await tx
      .select({ id: registrations.id, outsideCapacity: registrations.outsideCapacity })
      .from(registrations)
      .where(
        and(
          eq(registrations.eventId, input.eventId),
          eq(registrations.status, "CONFIRMED"),
          eq(registrations.kind, "REAL"),
          isNull(registrations.bibNumber),
          // Not a row whose number shown before §548 the data step is about to keep (§286: the
          // number they were told is the number they keep) — never a second number for one runner.
          isNull(registrations.provisionalBibNumber),
        ),
      )
      // Confirmation order, then the id as a stable tie-break for two confirmed in one instant.
      .orderBy(asc(registrations.confirmedAt), asc(registrations.id));

    /*
      Since §548 a confirmation draws its own number, so this finds only a registration confirmed
      before §87 or one whose old held number could not be kept (`releaseLegacyHeldNumbers`) — a
      gap to fill, in confirmation order, never anybody moved. Two sequences when the event has a
      hidden-list series (§647): each row draws from its own list's, both in confirmation order.
    */
    const taken = new Set<number>();
    const given: number[] = [];
    for (const row of waiting) {
      const number = await pickBibNumber(tx, input.eventId, taken, event.bibStartNumber, row.outsideCapacity ? "hidden" : "race");
      taken.add(number);
      given.push(number);
      await tx.update(registrations).set({ bibNumber: number, updatedAt: now }).where(eq(registrations.id, row.id));
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
  // The public list may show these numbers (§613): expire its cached pages, after the commit.
  if (result.assigned > 0) revalidatePublicContent("places");
  return result;
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
  // Cancelled numbers stay taken, as in the batch (§79), and so do erased and replaced ones
  // (§311, §548): offering one would be offering a refusal.
  const taken = await wornNumbers(db, eventId);
  for (const number of await retiredBibNumbers(db, eventId)) taken.add(number);
  // From the event's own band unless the caller asked from somewhere (§173): suggesting 1, 2, 3
  // at a race whose numbers start at 500 offers numbers nobody would print. Never a desk spare
  // (§444): a preferential number is printed with a name, and a spare is printed without one —
  // the desk suggests those itself, from `freeSpareBibNumbers`.
  const { start, spare } = await bandOf(db, eventId, from);
  const free: number[] = [];
  for (let n = Math.max(1, start); free.length < count && n <= 99_999; n += 1) {
    if (!taken.has(n) && !isSpareNumber(spare, n)) free.push(n);
  }
  return free;
}

/**
 * The desk's spares still free at this event, lowest first (§444): what the spares sheet prints
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
 * Where the desk's spares stand at each of these events (§444): none reserved, the next free one
 * to suggest, or every one given — which the desk says in words. One call per event on a page
 * that shows one or two of them; the desk never shows more.
 */
export async function spareStates<T extends Record<string, unknown>>(
  db: Database<T>,
  eventIds: readonly string[],
): Promise<Record<string, SpareState>> {
  const unique = [...new Set(eventIds)];
  const entries = await Promise.all(
    unique.map(async (eventId) => {
      const { band, free } = await freeSpareBibNumbers(db, eventId);
      return [eventId, spareStateOf(band, free)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * What the printing card needs about the spares (§444): the reservation and how many of it are
 * free, and the numbers the next print would reserve — up to `SPARE_BIBS_PER_PRINT`, from the same
 * `nextSpareCandidates` the write uses — so the confirmation names the exact range of whatever
 * count the club types. Read without a lock; the write re-reads under one and refuses when the
 * first number has moved since (`reserveSpareBibs`, `expectFrom`).
 */
export async function spareCardState<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ band: SpareBand | null; free: number; candidates: number[] }> {
  const { start, spare, hiddenStart } = await bandOf(db, eventId);
  const taken = await numbersInUse(db, eventId);
  return {
    band: spare,
    free: freeSpareNumbers(spare, taken).length,
    // Below the hidden list's own series when it sits above the race's (§647): never inside it.
    candidates: nextSpareCandidates({ band: spare, taken, bibStartNumber: start, limit: SPARE_BIBS_PER_PRINT, stop: spareStopOf(start, hiddenStart) }),
  };
}

/**
 * Reserve `count` spares for the desk (§444) — what «Tipărește» does before the sheet is drawn.
 *
 * Under the event row's lock, the lock every draw of a number at this event takes through the
 * allocator's transaction (`service.ts`), so no online runner is handed one of these numbers in
 * the moment between the read and the write. The numbers are `planSpareReservation`'s: after the
 * highest number anybody has on a first print, the next free ones after the reservation on a
 * second — every one free, so no runner's number moves. `expectFrom` is the first number the
 * confirmation named; when somebody registered in between and it has moved, nothing is written
 * and the card is shown again with the new range (`CONFLICT` on `spareFrom`).
 *
 * Administrator-only, like the batch (§289): it changes which numbers online runners can get.
 * Audited with the range, never a name.
 */
export async function reserveSpareBibs<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { actor: Actor; eventId: string; count: number; expectFrom?: number; now?: Date },
): Promise<{ from: number; to: number; count: number; band: SpareBand }> {
  const now = input.now ?? new Date();
  if (!canManageRegistrations(input.actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${input.actor.role} may not reserve spare race numbers`);
  }
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select({
        id: events.id,
        bibStartNumber: events.bibStartNumber,
        walkInBibStart: events.walkInBibStart,
        walkInBibCount: events.walkInBibCount,
        hiddenListEnabled: events.hiddenListEnabled,
        hiddenListBibStart: events.hiddenListBibStart,
      })
      .from(events)
      .where(eq(events.id, input.eventId))
      .for("update");
    if (!event) throw new DomainError("NOT_FOUND", "no such event");
    const band = spareBandOf(event);
    const plan = planSpareReservation({
      band,
      taken: await numbersInUse(tx, input.eventId),
      bibStartNumber: event.bibStartNumber,
      count: input.count,
      // The spares stop before the hidden list's own series when it sits above the race's (§647).
      stop: spareStopOf(event.bibStartNumber, hiddenListBibStartOf(event)),
    });
    if (!plan.ok) {
      throw plan.reason === "count"
        ? new DomainError("VALIDATION_ERROR", `between 1 and ${SPARE_BIBS_PER_PRINT} spares at a time`, ["spareCount"])
        : plan.reason === "hiddenList"
          ? new DomainError("VALIDATION_ERROR", `no room for ${input.count} more spares before the hidden list's numbers`, [SPARES_BEFORE_HIDDEN_LIST])
          : new DomainError("VALIDATION_ERROR", `no room for ${input.count} more spares (${plan.reason})`, [plan.reason === "size" ? "spareTotal" : "spareCeiling"]);
    }
    const from = plan.printed[0];
    const to = plan.printed[plan.printed.length - 1];
    if (input.expectFrom !== undefined && input.expectFrom !== from) {
      throw new DomainError("CONFLICT", `the spares now start at ${from}, not ${input.expectFrom}`, ["spareFrom"]);
    }
    await tx
      .update(events)
      .set({ walkInBibStart: plan.walkInBibStart, walkInBibCount: plan.walkInBibCount })
      .where(eq(events.id, input.eventId));
    await recordAuditEvent(tx, {
      actorStaffUserId: input.actor.id,
      action: "registration.bib_spares_reserved",
      entityType: "event",
      entityId: input.eventId,
      // `skipped`: the numbers inside the range somebody held, never a spare (`skippedSpareNumbers`).
      metadata: { from, to, count: plan.printed.length, reservedFrom: plan.walkInBibStart, reservedCount: plan.walkInBibCount, skipped: plan.skipped },
      now,
    });
    return {
      from,
      to,
      count: plan.printed.length,
      band: { from: plan.walkInBibStart, to: plan.walkInBibStart + plan.walkInBibCount - 1 },
    };
  });
}

/**
 * Whether a number typed at the desk is somebody's already (§444): worn by another registration of
 * this event — a cancelled one's included, retired — or retired by an erasure or a replacement by
 * hand (§311, §548). The unique index catches a worn one only.
 */
export async function bibNumberInUse<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { eventId: string; number: number; exceptRegistrationId?: string },
): Promise<boolean> {
  if ((await wornNumbers(db, input.eventId, input.exceptRegistrationId)).has(input.number)) return true;
  return (await retiredBibNumbers(db, input.eventId)).includes(input.number);
}

/**
 * Whether this number is one of the event's desk spares (§444) — what decides that a number given
 * at the desk is already on paper (`admin-service.ts#setBibNumberByStaff`, the walk-in's box).
 */
export async function isEventSpareNumber<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  number: number,
): Promise<boolean> {
  if (!isSpareNumber((await bandOf(db, eventId)).spare, number)) return false;
  // Inside the band but stepped over by a print (§444): no blank bib carries it.
  return !(await skippedSpareNumbers(db, eventId)).includes(number);
}

/**
 * One bib of the sheet. `member` is whether it prints the members' design (§NNN): the event offers
 * it, the person asked («Vreau numărul de membru»), and the address is a member account's (§662) —
 * all three, never the tick alone. The number is the same number either way.
 */
export type BibRow = { id: string; bibNumber: number; registeredName: string; member: boolean };

/**
 * Whether a row prints the members' bib, as one SQL condition over a registration joined to its
 * event and participant (§NNN): asked, offered, and the canonical address among the member
 * accounts' (`memberCanonicalEmails`, read once per sheet by the caller) — a plain `false` with no
 * member account, never an `IN ()`.
 */
function memberBibPrinted(members: readonly string[]): SQL<boolean> {
  if (members.length === 0) return sql<boolean>`false`.mapWith(Boolean);
  return sql<boolean>`(${registrations.memberBibWanted} and ${OFFERS_MEMBER_BIB} and ${inArray(participants.canonicalEmail, [...members])})`.mapWith(Boolean);
}

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
  // The member accounts, once per sheet (§662): the same set the list's «Membru (verificat)» reads.
  const members = [...(await memberCanonicalEmails(db))];
  const rows = await db
    .select({
      id: registrations.id,
      bibNumber: registrations.bibNumber,
      registeredName: registrations.registeredName,
      member: memberBibPrinted(members),
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .where(bibScopeWhere(eventId, scope))
    .orderBy(asc(registrations.bibNumber));
  return rows.map((row) => ({ id: row.id, bibNumber: row.bibNumber as number, registeredName: row.registeredName, member: row.member === true }));
}

/**
 * The bibs that asked for the members' design and will print the ordinary one (§NNN): confirmed
 * real rows with a number whose address is no member account's — the bibs page's one line before
 * printing, so an Administrator adds them on «Echipa» first if they are members. Zero while the
 * event does not offer the members' bib.
 */
export async function countUnverifiedMemberBibs<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<number> {
  const members = [...(await memberCanonicalEmails(db))];
  const [row] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .where(
      and(
        bibScopeWhere(eventId, {}),
        eq(registrations.memberBibWanted, true),
        OFFERS_MEMBER_BIB,
        members.length > 0 ? notInArray(participants.canonicalEmail, members) : undefined,
      ),
    );
  return row?.count ?? 0;
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
 * The same rule as the batch: the row must have a number, be confirmed and be real.
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
/**
 * The date line a bib prints (§349, §317), in the language it is drawn for and the event's zone — or
 * nothing while the date is left blank to be announced later (§545): the sample in the editor's
 * «Înscriere» card, the sheet and the desk's picture never print the provisional day stored for it.
 */
export function bibEventDate(event: { startsAt: Date; timezone: string }, locale: string): string {
  const at = typedStartOrNull(event);
  return at ? formatDay(at, { locale, timeZone: event.timezone, style: "long" }) : "";
}

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
