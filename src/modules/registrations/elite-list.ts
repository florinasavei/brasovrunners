import { and, asc, eq, isNull } from "drizzle-orm";
import { ELITE_NAME_MAX, ELITE_NUMBER_MAX, eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventResults } from "@/db/schema/event-results";
import { events } from "@/db/schema/events";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { type AuditAction, recordAuditEvent } from "@/modules/audit/repository";
import { revalidatePublicContent } from "@/modules/public-cache/cache";
import { countEventResults, rerankEventResults } from "@/modules/results/results";
import { canManageRegistrations, canReadRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { bibNumberInUse, pickEliteLineNumber } from "./bibs";
import { isSpareNumber, spareBandOf } from "./domain/spare-bibs";

/**
 * «Elită — doar numele pe BIB» (§895; the owner, 2026-11-03, choosing «Listă separată»): a race's elite runners
 * as a list of names, printed as bibs with the name where the number usually is (`bibs-pdf.ts`, `bib-image.tsx`).
 *
 * **Not registrations.** No participant, no address, no declaration, no place, no queue, no email: nothing here
 * reaches the allocator or any count of registrations — «Locuri», `countKits`, the registrations' summary and export,
 * the sponsors' list, the desk; the results read a line only for its «Apare în clasament», to run it hors concours. The registrations list alone adds the lines, said beside its own figures, never
 * in them (the owner, 2026-11-04: an elite takes a kit and stands at the start): among the kits' runners (`ui/KitCount.tsx`),
 * the people at the start of «Locuri» (`domain/place-outlook.ts#peopleAtStartIfAll`) and the bibs' header beside the
 * registrations' bibs; the «Elite» fold lists them, read-only. That is why the declaration rule stays whole: a registration still needs the
 * person's own signed declaration, and an elite line is a name to print, nothing else. A name and a number are all it
 * stores, and two ticks. The one thing of it the race numbers read is that number, as worn (`addEliteEntry`).
 *
 * **Every line has a number (§NNN; the owner, 2026-11-19, of «Ingrid» drawn grey on «Cronometrare»: «de ce apare Ingrid
 * separat?» — «vreau să apară la fel! și să o pot cronometra»).** The bib prints the label and never the number (§963, §975),
 * so the number is the line's at the finish line, in the results and in «Participant #…» — and the finish line keys every
 * press by a number. A line added with none typed draws one by itself (`bibs.ts#pickEliteLineNumber`: the race's next free
 * number, nobody else's), and so does a line moved from the internal list (`reserve-list.ts#moveReserveEntryToElite`); a
 * line left from before without one gets it in one press (`giveEliteLineNumber` on «Cronometrare», `giveEliteNumbers` on the
 * card); and the Administrator changes a line's number in its own box (`setEliteEntryNumber`) until a result is stored on it.
 *
 * **The two ticks (§910; the owner, 2026-11-04).** «Apare în clasament», ticked by default: unticked, the result the
 * club typed for the line — by its number, or by its name for a line with none (`results/domain/hors-concours.ts`) —
 * runs hors concours, out of the public results and of everybody's positions. «Apare pe site», unticked by default:
 * ticked — only with the person's agreement, which the tick records and the question before it says — the name and
 * the number are on the event page under «Elitele cursei», while its public list is on (`listPublicEliteEntries`).
 *
 * **Who** — the Organizer and above read the list and download its sheet (`canReadRegistrations`, the bibs'
 * own rule, §289); the Administrator adds, deletes, ticks and numbers (`canManageRegistrations`). Asserted in every function
 * below (BR-REQ-060-01). **The trail** names who, when and which line, and a tick's new value — never the name; a number only
 * where the press is about the number: `event_elite.number_given` (`{ entryId, bibNumber }`) for one drawn by itself and
 * `event_elite.number_set` (`{ entryId, from, to }`) for one typed in a line's box.
 */

type Actor = Pick<StaffUser, "id" | "role">;

export type EliteEntryRow = {
  id: string;
  eventId: string;
  name: string;
  bibNumber: number | null;
  /** «Eticheta pe BIB» (§975) as stored: null prints the name's first word (`bib-elite.ts#eliteLineBibName`). */
  bibLabel: string | null;
  /** «Apare în clasament» (§910): false, the line's result runs hors concours. */
  inResults: boolean;
  /** «Apare pe site» (§910): true, the name shows under «Elitele cursei» while the event's public list is on. */
  onSite: boolean;
  createdAt: Date;
};

/** The two ticks of a line (§910), by the names the card's forms post. */
export const ELITE_TICKS = ["inResults", "onSite"] as const;
export type EliteTick = (typeof ELITE_TICKS)[number];

export function isEliteTick(value: unknown): value is EliteTick {
  return typeof value === "string" && (ELITE_TICKS as readonly string[]).includes(value);
}

export type EliteEntryInput = { name: unknown; bibNumber: unknown };

function assertMayRead(actor: Pick<StaffUser, "role">): void {
  if (!canReadRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read an event's elite list`);
  }
}

function assertMayWrite(actor: Pick<StaffUser, "role">): void {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not change an event's elite list`);
  }
}

/**
 * The typed line, ready to store; every refusal names its box. The name trimmed with its inner spaces
 * collapsed to one — it is printed, and a double space would print as a gap — 1 to `ELITE_NAME_MAX`
 * characters; the number empty, or a whole number from 1 to `ELITE_NUMBER_MAX` (the five digits a bib draws).
 */
export function parseEliteEntry(input: EliteEntryInput): { name: string; bibNumber: number | null } {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/gu, " ").trim() : "";
  const rawNumber = typeof input.bibNumber === "number" ? String(input.bibNumber) : typeof input.bibNumber === "string" ? input.bibNumber.trim() : "";
  const nameOk = name !== "" && [...name].length <= ELITE_NAME_MAX;
  const number = rawNumber === "" ? null : /^\d{1,5}$/.test(rawNumber) ? Number(rawNumber) : Number.NaN;
  const numberOk = number === null || (Number.isInteger(number) && number >= 1 && number <= ELITE_NUMBER_MAX);
  const refused = [nameOk ? null : "name", numberOk ? null : "bibNumber"].filter((field): field is string => field !== null);
  if (refused.length > 0) {
    throw new DomainError("VALIDATION_ERROR", `a name of 1 to ${ELITE_NAME_MAX} characters, and no number or one from 1 to ${ELITE_NUMBER_MAX}`, refused);
  }
  return { name, bibNumber: number };
}

/**
 * A line's «Număr» typed in its own box on the card (§NNN): a whole number from 1 to `ELITE_NUMBER_MAX`, spaces round it
 * read, as at the add. Never empty — every line keeps a number, so an empty box is refused, naming it (`bibNumber`).
 */
export function parseEliteLineNumber(raw: unknown): number {
  const typed = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  const number = /^\d{1,5}$/.test(typed) ? Number(typed) : Number.NaN;
  if (!Number.isInteger(number) || number < 1 || number > ELITE_NUMBER_MAX) {
    throw new DomainError("VALIDATION_ERROR", `a whole number from 1 to ${ELITE_NUMBER_MAX}`, ["bibNumber"]);
  }
  return number;
}

/** One event's elite list, in the order the club typed it. */
export async function listEliteEntries<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string): Promise<EliteEntryRow[]> {
  assertMayRead(actor);
  if (!isUuid(eventId)) return [];
  const rows = await db
    .select()
    .from(eventEliteEntries)
    .where(eq(eventEliteEntries.eventId, eventId))
    .orderBy(asc(eventEliteEntries.createdAt), asc(eventEliteEntries.id));
  return rows.map((row) => ({ id: row.id, eventId: row.eventId, name: row.name, bibNumber: row.bibNumber, bibLabel: row.bibLabel, inResults: row.inResults, onSite: row.onSite, createdAt: row.createdAt }));
}

/** One name of «Elitele cursei» (§910): the name and the number, nothing else — no id, no tick, no date. */
export type PublicEliteEntry = { name: string; bibNumber: number | null };

/**
 * «Elitele cursei» on the event page (§910): the lines of the race's elite list the Administrator ticked «Apare pe site», in the
 * order typed — a name and a number, and nothing else (the select names its two columns; `tests/privacy/public-surface.test.ts`).
 * No actor: it is the public page's read, through the cache (`cachedPublicEliteEntries`), and the page asks it only while the
 * event's public list is on (`StartList`). Not a registration: no state, no count, never a cancelled or test row — there is none.
 */
export async function listPublicEliteEntries<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<PublicEliteEntry[]> {
  if (!isUuid(eventId)) return [];
  return db
    .select({ name: eventEliteEntries.name, bibNumber: eventEliteEntries.bibNumber })
    .from(eventEliteEntries)
    .where(and(eq(eventEliteEntries.eventId, eventId), eq(eventEliteEntries.onSite, true)))
    .orderBy(asc(eventEliteEntries.createdAt), asc(eventEliteEntries.id));
}

/** The trail's word for a tick and its new value: `event_elite.out_of_results`, `event_elite.on_site`, … */
function tickAction(tick: EliteTick, on: boolean): AuditAction {
  if (tick === "inResults") return on ? "event_elite.in_results" : "event_elite.out_of_results";
  return on ? "event_elite.on_site" : "event_elite.off_site";
}

/**
 * «Apare în clasament» / «Apare pe site» on one line (§910): the tick posted as it should now stand. The Administrator's
 * (FORBIDDEN otherwise); a line that is gone is NOT_FOUND; a press that finds the tick already as asked (a stale card, a
 * colleague first) writes nothing and no row. Otherwise one statement under the line's lock, one audit row naming the line
 * and the new value (`{ entryId, inResults }` or `{ entryId, onSite }`), and — for «Apare în clasament» — the race's stored
 * results ranked again in the same transaction (`rerankEventResults`), the line's result now in or out. The public pages are
 * told after the commit: the results and «Elitele cursei» read both ticks.
 */
export async function setEliteEntryTick<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  entryId: string,
  tick: EliteTick,
  on: boolean,
  now: Date,
): Promise<{ eventId: string; changed: boolean }> {
  assertMayWrite(actor);
  if (!isEliteTick(tick)) throw new DomainError("VALIDATION_ERROR", "no such tick on an elite line", ["tick"]);
  if (!isUuid(entryId)) throw new DomainError("NOT_FOUND", "the line is not there");
  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: eventEliteEntries.id, eventId: eventEliteEntries.eventId, inResults: eventEliteEntries.inResults, onSite: eventEliteEntries.onSite })
      .from(eventEliteEntries)
      .where(eq(eventEliteEntries.id, entryId))
      .for("update");
    if (!current) throw new DomainError("NOT_FOUND", "the line is not there");
    if (current[tick] === on) return { eventId: current.eventId, changed: false };
    await tx
      .update(eventEliteEntries)
      .set(tick === "inResults" ? { inResults: on } : { onSite: on })
      .where(eq(eventEliteEntries.id, current.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: tickAction(tick, on), entityType: "event", entityId: current.eventId, metadata: { entryId: current.id, [tick]: on }, now });
    if (tick === "inResults") await rankAgainWithTheList(tx, current.eventId);
    return { eventId: current.eventId, changed: true };
  });
  if (outcome.changed) revalidatePublicContent("events", "places");
  return outcome;
}

/**
 * «Adaugă pe lista de elită»: one name, one event — nobody registered, nobody told.
 *
 * **A number is one person's.** A typed number is refused (`CONFLICT` on `bibNumber`, shown on «Număr
 * (opțional)») when the event already has it on somebody — a registration's, a cancelled one's included, an
 * erased or replaced one's (`bibs.ts#bibNumberInUse`), or another elite line's — or when it is one of the desk's
 * reserved spares (§444), printed blank for a walk-in. The other way round, every draw reads the elite numbers
 * as worn (`bibs.ts#wornNumbers`), so a later confirmation, «Alocă numerele», the desk's box and a print of spares
 * never hand one out. Under the event row's lock, the one every draw takes (§10.6), so a confirmation cannot
 * reach the same number between the check and the insert.
 *
 * **No number typed, one is given (§NNN).** The box left empty, the line draws its number by itself in the same transaction
 * and under the same lock (`bibs.ts#pickEliteLineNumber`: the race's next free number, nobody else's — never a spare, never the
 * hidden list's series, never a number a stored result carries), and the trail says which (`event_elite.number_given`,
 * `{ entryId, bibNumber }`), so «Cronometrare» times the line like every other elite. No number left in the race's series is
 * refused in words on the box (`ELITE_NO_FREE_NUMBER`), nothing written: the club types one.
 */
export async function addEliteEntry<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  eventId: string,
  input: EliteEntryInput,
  now: Date,
): Promise<{ id: string; bibNumber: number }> {
  assertMayWrite(actor);
  const values = parseEliteEntry(input);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "no such event");
  const outcome = await db.transaction(async (tx) => {
    const [event] = await tx
      .select({ id: events.id, walkInBibStart: events.walkInBibStart, walkInBibCount: events.walkInBibCount })
      .from(events)
      .where(eq(events.id, eventId))
      .for("update");
    if (!event) throw new DomainError("NOT_FOUND", "no such event");
    if (values.bibNumber !== null && (isSpareNumber(spareBandOf(event), values.bibNumber) || (await bibNumberInUse(tx, { eventId, number: values.bibNumber })))) {
      throw new DomainError("CONFLICT", `number ${values.bibNumber} is already somebody's at this event, or a desk spare`, ["bibNumber"]);
    }
    const bibNumber = values.bibNumber ?? (await pickEliteLineNumber(tx, eventId));
    if (bibNumber === null) throw new DomainError("ELITE_NO_FREE_NUMBER", "the race's own series has no free number left for an elite line", ["bibNumber"]);
    const [row] = await tx
      .insert(eventEliteEntries)
      .values({ eventId, name: values.name, bibNumber, createdByStaffUserId: actor.id, createdAt: now })
      .returning({ id: eventEliteEntries.id });
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_elite.added", entityType: "event", entityId: eventId, metadata: { entryId: row.id }, now });
    if (values.bibNumber === null) {
      await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_elite.number_given", entityType: "event", entityId: eventId, metadata: { entryId: row.id, bibNumber }, now });
    }
    // A new line ranks its result (its tick starts ticked), but a typed number on it claims that number's typed row, which a
    // numberless line out of the ranking may have held by name (§910): the stored results are ranked again. A number the line drew
    // by itself is on no stored result (`pickEliteLineNumber`), so it claims none and ranks nothing again.
    const ranked = values.bibNumber !== null && (await rankAgainWithTheList(tx, eventId));
    return { id: row.id, bibNumber, ranked };
  });
  if (outcome.ranked) revalidatePublicContent("events", "places");
  return { id: outcome.id, bibNumber: outcome.bibNumber };
}

/** One line numbered by a press (§NNN): which, the number it holds, and whether this press gave it (false: it had one already). */
export type GivenEliteNumber = { entryId: string; bibNumber: number; given: boolean };

/**
 * The lines of one event without a number, given each its own — in the order typed — in the caller's transaction, which holds
 * the event row's lock: one draw a line (`pickEliteLineNumber`, the numbers given earlier in the press carried in `taken`),
 * one statement and one audit row (`event_elite.number_given`, `{ entryId, bibNumber }`, never the name). No number left for
 * one of them refuses the whole press (`ELITE_NO_FREE_NUMBER`): the transaction writes none of it.
 */
async function numberTheLines<T extends Record<string, unknown>>(
  tx: Database<T>,
  actor: Actor,
  eventId: string,
  lines: ReadonlyArray<{ id: string }>,
  now: Date,
): Promise<GivenEliteNumber[]> {
  const taken = new Set<number>();
  const given: GivenEliteNumber[] = [];
  for (const line of lines) {
    const bibNumber = await pickEliteLineNumber(tx, eventId, taken);
    if (bibNumber === null) throw new DomainError("ELITE_NO_FREE_NUMBER", "the race's own series has no free number left for an elite line");
    await tx.update(eventEliteEntries).set({ bibNumber }).where(eq(eventEliteEntries.id, line.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_elite.number_given", entityType: "event", entityId: eventId, metadata: { entryId: line.id, bibNumber }, now });
    given.push({ entryId: line.id, bibNumber, given: true });
  }
  return given;
}

/**
 * «Dă număr elitelor fără număr (N)» on the elite card (§NNN): every line of the event that has no number — one left from
 * before a line drew its own — given the race's next free one, each nobody else's (`numberTheLines`). The Administrator's
 * (FORBIDDEN otherwise); an event that is not there is NOT_FOUND. Under the event row's lock, the lines locked after it, the
 * order `addEliteEntry` takes; a press that finds none without a number — a stale card, a colleague first — writes nothing.
 * A numberless line out of the ranking matched its typed result by name (§910, `hors-concours.ts` rule 4), which a number ends,
 * so the race's stored results are ranked again in the same transaction; the public pages are told after the commit when they
 * read it — the results, or a line shown under «Elitele cursei», which says its number.
 */
export async function giveEliteNumbers<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, eventId: string, now: Date): Promise<{ numbered: GivenEliteNumber[] }> {
  assertMayWrite(actor);
  if (!isUuid(eventId)) throw new DomainError("NOT_FOUND", "no such event");
  const outcome = await db.transaction(async (tx) => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).for("update");
    if (!event) throw new DomainError("NOT_FOUND", "no such event");
    const lines = await tx
      .select({ id: eventEliteEntries.id, onSite: eventEliteEntries.onSite })
      .from(eventEliteEntries)
      .where(and(eq(eventEliteEntries.eventId, eventId), isNull(eventEliteEntries.bibNumber)))
      .orderBy(asc(eventEliteEntries.createdAt), asc(eventEliteEntries.id))
      .for("update");
    if (lines.length === 0) return { numbered: [], public: false };
    const numbered = await numberTheLines(tx, actor, eventId, lines, now);
    const ranked = await rankAgainWithTheList(tx, eventId);
    return { numbered, public: ranked || lines.some((line) => line.onSite) };
  });
  if (outcome.public) revalidatePublicContent("events", "places");
  return { numbered: outcome.numbered };
}

/**
 * «Dă-i un număr» on «Cronometrare» (§NNN), in the place of a line's grey button: that one line given the race's next free
 * number, as `giveEliteNumbers` gives it, so the line's button is pressed like every other elite's. The Administrator's
 * (FORBIDDEN otherwise — the desk's other roles keep the line's note); a line that is gone is NOT_FOUND. Under the event row's
 * lock, then the line's; a line that has a number already — a page drawn before a colleague's press — is answered with it,
 * nothing written (`given: false`).
 */
export async function giveEliteLineNumber<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, entryId: string, now: Date): Promise<GivenEliteNumber & { eventId: string }> {
  assertMayWrite(actor);
  if (!isUuid(entryId)) throw new DomainError("NOT_FOUND", "the line is not there");
  const outcome = await db.transaction(async (tx) => {
    const current = await lockedLine(tx, entryId);
    if (current.bibNumber !== null) return { eventId: current.eventId, entryId: current.id, bibNumber: current.bibNumber, given: false, public: false };
    const [numbered] = await numberTheLines(tx, actor, current.eventId, [current], now);
    const ranked = await rankAgainWithTheList(tx, current.eventId);
    return { eventId: current.eventId, ...numbered, public: ranked || current.onSite };
  });
  if (outcome.public) revalidatePublicContent("events", "places");
  return { eventId: outcome.eventId, entryId: outcome.entryId, bibNumber: outcome.bibNumber, given: outcome.given };
}

/**
 * «Număr» on one line of the elite card (§NNN): the number the Administrator types for the line — a first one, or another in
 * the place of the one it holds. The same checks as a number typed at the add (`addEliteEntry`): refused (`CONFLICT` on
 * `bibNumber`) when somebody at the event has it, had it or another line carries it (`bibs.ts#bibNumberInUse`), or it is one of
 * the desk's spares. And refused while a result is stored on the line's present number (`ELITE_NUMBER_HAS_RESULT`): the
 * finish line and «Clasament» keep a result by its number, so the time would lose its runner — «Clasament» corrects it first.
 * The same number as it holds writes nothing. Under the event row's lock — the one every draw and every finish press takes —
 * then the line's; one audit row `event_elite.number_set` with `{ entryId, from, to }`, never the name; the stored results
 * ranked again (the number decides which typed row is the line's, `hors-concours.ts`), and the public pages told when they read
 * it.
 */
export async function setEliteEntryNumber<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Actor,
  entryId: string,
  raw: unknown,
  now: Date,
): Promise<{ eventId: string; changed: boolean }> {
  assertMayWrite(actor);
  const number = parseEliteLineNumber(raw);
  if (!isUuid(entryId)) throw new DomainError("NOT_FOUND", "the line is not there");
  const outcome = await db.transaction(async (tx) => {
    const current = await lockedLine(tx, entryId);
    if (current.bibNumber === number) return { eventId: current.eventId, changed: false, public: false };
    if (current.bibNumber !== null && (await resultStoredOn(tx, current.eventId, current.bibNumber))) {
      throw new DomainError("ELITE_NUMBER_HAS_RESULT", `a result is stored on number ${current.bibNumber}`, ["bibNumber"]);
    }
    if (isSpareNumber(spareBandOf(current.event), number) || (await bibNumberInUse(tx, { eventId: current.eventId, number }))) {
      throw new DomainError("CONFLICT", `number ${number} is already somebody's at this event, or a desk spare`, ["bibNumber"]);
    }
    await tx.update(eventEliteEntries).set({ bibNumber: number }).where(eq(eventEliteEntries.id, current.id));
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "event_elite.number_set",
      entityType: "event",
      entityId: current.eventId,
      metadata: { entryId: current.id, from: current.bibNumber, to: number },
      now,
    });
    const ranked = await rankAgainWithTheList(tx, current.eventId);
    return { eventId: current.eventId, changed: true, public: ranked || current.onSite };
  });
  if (outcome.public) revalidatePublicContent("events", "places");
  return { eventId: outcome.eventId, changed: outcome.changed };
}

/**
 * One line, locked for a change of its number: its event read first, then the event row locked as every draw locks it (§10.6),
 * then the line — the order an add and the event's delete take them in. NOT_FOUND when the line is gone, or goes meanwhile.
 */
async function lockedLine<T extends Record<string, unknown>>(
  tx: Database<T>,
  entryId: string,
): Promise<{ id: string; eventId: string; bibNumber: number | null; onSite: boolean; event: { walkInBibStart: number | null; walkInBibCount: number | null } }> {
  const [line] = await tx.select({ eventId: eventEliteEntries.eventId }).from(eventEliteEntries).where(eq(eventEliteEntries.id, entryId)).limit(1);
  if (!line) throw new DomainError("NOT_FOUND", "the line is not there");
  const [event] = await tx
    .select({ walkInBibStart: events.walkInBibStart, walkInBibCount: events.walkInBibCount })
    .from(events)
    .where(eq(events.id, line.eventId))
    .for("update");
  const [current] = await tx
    .select({ id: eventEliteEntries.id, eventId: eventEliteEntries.eventId, bibNumber: eventEliteEntries.bibNumber, onSite: eventEliteEntries.onSite })
    .from(eventEliteEntries)
    .where(eq(eventEliteEntries.id, entryId))
    .for("update");
  if (!event || !current) throw new DomainError("NOT_FOUND", "the line is not there");
  return { ...current, event };
}

/** Whether the race keeps a result — «Sosit» or a decision of «Clasament» — on this number: on a line's number, the line's own. */
async function resultStoredOn<T extends Record<string, unknown>>(tx: Database<T>, eventId: string, bibNumber: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: eventResults.id })
    .from(eventResults)
    .where(and(eq(eventResults.eventId, eventId), eq(eventResults.bibNumber, bibNumber)))
    .limit(1);
  return row !== undefined;
}

/**
 * «Șterge» on one line: the name and its number are gone. A second press finds it gone (NOT_FOUND). A line that ran hors
 * concours (§910) takes its tick with it, so the race's stored results are ranked again in the same transaction — the typed
 * result is an ordinary one again — and a line shown on the site leaves «Elitele cursei»: the public pages are told.
 */
export async function deleteEliteEntry<T extends Record<string, unknown>>(db: Database<T>, actor: Actor, entryId: string, now: Date): Promise<{ eventId: string }> {
  assertMayWrite(actor);
  if (!isUuid(entryId)) throw new DomainError("NOT_FOUND", "the line is not there");
  const outcome = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: eventEliteEntries.id, eventId: eventEliteEntries.eventId, inResults: eventEliteEntries.inResults, onSite: eventEliteEntries.onSite })
      .from(eventEliteEntries)
      .where(eq(eventEliteEntries.id, entryId))
      .for("update");
    if (!current) throw new DomainError("NOT_FOUND", "the line is not there");
    await tx.delete(eventEliteEntries).where(eq(eventEliteEntries.id, current.id));
    await recordAuditEvent(tx, { actorStaffUserId: actor.id, action: "event_elite.deleted", entityType: "event", entityId: current.eventId, metadata: { entryId: current.id }, now });
    const ranked = await rankAgainWithTheList(tx, current.eventId);
    return { eventId: current.eventId, public: ranked || current.onSite };
  });
  if (outcome.public) revalidatePublicContent("events", "places");
  return { eventId: outcome.eventId };
}

/**
 * The race's stored results ranked again after the list changed (§910), in the caller's transaction: a line's tick, its number or
 * the line itself decides which typed result runs hors concours (`hors-concours.ts`) — a numbered line also keeps its number's row
 * from being taken for a numberless line by name. True when the race has results, so the caller tells the public pages; a race with
 * none costs one count.
 */
async function rankAgainWithTheList<T extends Record<string, unknown>>(tx: Database<T>, eventId: string): Promise<boolean> {
  if ((await countEventResults(tx, eventId)) === 0) return false;
  await rerankEventResults(tx, eventId);
  return true;
}
