import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { ACTIVE_REGISTRATION_STATUSES, registrations } from "@/db/schema/registrations";
import { eventEliteEntries } from "@/db/schema/event-elite-entries";
import { eventRaffleEntries, type RaffleEntryMethod } from "@/db/schema/event-raffle-entries";
import { eventVolunteers } from "@/db/schema/event-volunteers";
import { events } from "@/db/schema/events";
import type { Database } from "@/db/types";
import { routing, type Locale } from "@/i18n/routing";
import { RACE_NUMBER_FORMAT } from "@/modules/events/repository";
import { isLegalDocumentBody, type LegalDocumentBody } from "@/modules/legal-documents/domain/content-hash";
import { RAFFLE_RULES_KEY } from "@/modules/legal-documents/domain/keys";
import type { MergeValues } from "@/modules/legal-documents/domain/merge-fields";
import { findCurrentApprovedDocument, noticeDescribesRaffle, raffleRulesInForce } from "@/modules/legal-documents/repository";
import type { RaceNumberFormat } from "@/modules/registrations/domain/race-number";
import { eventMergeValues } from "@/modules/registrations/signed-declaration";
import { isUuid } from "@/shared/ids";
import {
  compareRaffleRows,
  type RaffleGateClosed,
  type RaffleGateEvent,
  type RaffleGateFacts,
  type RaffleGuardianWay,
  type RaffleKind,
  type RafflePerson,
  type RaffleReason,
  type RaffleSettings,
  raffleConfirmationOffered,
  raffleConfirmed,
  raffleKindOfRegistration,
  raffleNumberText,
  raffleParticipation,
  raffleSettingsOf,
  raffleSignUpClosedFor,
  type VolunteerRaffleFacts,
  volunteerConfirmedForRaffle,
} from "./domain/raffle";
import { isVolunteerMinor } from "./domain/volunteer";
import { raffleGroupsPhrase } from "./raffle-words";

/*
  The raffle's reads (§984): the event's settings and the gate's facts, the rules a person reads before accepting, one person of any
  of the three tables, and everybody of an event with the one answer (`domain/raffle.ts#raffleParticipation`). No writes and no role
  checks here: every caller asks its own role (BR-REQ-060-01) — the files and the tab through `raffle-list.ts`, the doors through
  `raffle-entries.ts`, the lists, the pages and the desk at their own door. Uncached: a public page asks the public cache's twins
  (`public-cache/reads.ts#cachedRaffleSignUpOpen`), every press asks here again.
*/

/** A person of the raffle, by the table they live in. */
export type RafflePersonRef = { table: "registration"; id: string } | { table: "volunteer"; id: string } | { table: "elite"; id: string };

// ---------------------------------------------------------------------------------------------
// The event and the gate
// ---------------------------------------------------------------------------------------------

/**
 * The event's raffle settings and the facts the gate reads, or null for an event that is not there — and how the event writes a race
 * number (§735), which the raffle's tab and files write a runner's and an elite's number with (`domain/raffle.ts#raffleNumberText`).
 */
export async function readRaffleEvent<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ id: string; settings: RaffleSettings; event: RaffleGateEvent; numberFormat: RaceNumberFormat } | null> {
  if (!isUuid(eventId)) return null;
  const [row] = await db
    .select({
      id: events.id,
      hasRaffle: events.hasRaffle,
      raffleRunners: events.raffleRunners,
      raffleElites: events.raffleElites,
      raffleVolunteers: events.raffleVolunteers,
      raffleSignUp: events.raffleSignUp,
      raffleSignUpOpen: events.raffleSignUpOpen,
      type: events.type,
      eventStatus: events.eventStatus,
      editorialStatus: events.editorialStatus,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      timezone: events.timezone,
      numberFormat: RACE_NUMBER_FORMAT,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    settings: raffleSettingsOf(row),
    event: { type: row.type, eventStatus: row.eventStatus, editorialStatus: row.editorialStatus, startsAt: row.startsAt, endsAt: row.endsAt, timezone: row.timezone },
    numberFormat: row.numberFormat,
  };
}

/**
 * How many raffles ahead ask a sign-up (§984): events that hold a raffle «Cu înscriere separată», not cancelled, whose start is no more
 * than a day behind — race day included. What `/admin/tasks`' rows `raffleRules` and `raffleNotice` wait on.
 */
export async function countRaffleSignUpEvents<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(and(eq(events.hasRaffle, true), eq(events.raffleSignUp, true), ne(events.eventStatus, "CANCELLED"), gte(events.startsAt, new Date(now.getTime() - 24 * 60 * 60_000))));
  return row?.count ?? 0;
}

/** Whether «Ziua cursei» draws its «Tombolă» tab for the event (§984): it holds a raffle. False for an event that is not there. */
export async function raffleTabShown<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<boolean> {
  return (await readRaffleEvent(db, eventId))?.settings.hasRaffle === true;
}

/** Whether the legal texts are worth reading: a raffle in the sign-up mode with its sign-ups open — else the gate is shut already. */
export function settingsMayOpen(settings: RaffleSettings): boolean {
  return settings.hasRaffle && settings.signUp && settings.signUpOpen;
}

/**
 * The gate's facts for one event, uncached — what every press asks again — with how the event writes a race number beside them, for
 * the roster (no further read). Null for an event that is not there.
 */
export async function readRaffleGateFacts<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  now: Date,
): Promise<(RaffleGateFacts & { numberFormat: RaceNumberFormat }) | null> {
  const found = await readRaffleEvent(db, eventId);
  if (!found) return null;
  // The legal reads cost two queries a language: asked only when the settings alone would open the gate.
  const [rulesInForce, noticeDescribes] = settingsMayOpen(found.settings) ? await Promise.all([raffleRulesInForce(db, now), noticeDescribesRaffle(db, now)]) : [false, false];
  return { settings: found.settings, event: found.event, rulesInForce, noticeDescribesRaffle: noticeDescribes, numberFormat: found.numberFormat };
}

/** Why the gate is shut for `kind` (or for every kind, asked without one), or null while it is open. An event that is not there is shut. */
export async function raffleGateClosed<T extends Record<string, unknown>>(db: Database<T>, eventId: string, now: Date, kind?: RaffleKind | readonly RaffleKind[]): Promise<RaffleGateClosed | null> {
  const facts = await readRaffleGateFacts(db, eventId, now);
  return facts ? raffleSignUpClosedFor(facts, now, kind) : "noRaffle";
}

// ---------------------------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------------------------

/** «Regulamentul tombolei» as one person reads it before accepting: the version in force, its title and body, and its blanks filled. */
export type RaffleRulesText = { documentId: string; version: number; title: string; body: LegalDocumentBody; values: MergeValues };

/** The rules' blanks for one event and language: the event's own facts and the groups it ticks — what the acceptance keeps. */
export async function raffleRulesFacts<T extends Record<string, unknown>>(db: Database<T>, eventId: string, settings: RaffleSettings, locale: Locale): Promise<Record<string, string>> {
  const event = await eventMergeValues(db, eventId, locale);
  return {
    event: event?.values.event ?? "",
    eventDate: event?.values.eventDate ?? "",
    eventLocation: event?.values.eventLocation ?? "",
    raffleGroups: raffleGroupsPhrase(settings.groups, locale),
  };
}

/** The rules in force in `locale`, filled for the event — what a fold shows and an acceptance fingerprints — or null with none in force. */
export async function readRaffleRules<T extends Record<string, unknown>>(db: Database<T>, eventId: string, settings: RaffleSettings, locale: Locale, now: Date): Promise<RaffleRulesText | null> {
  const document = await findCurrentApprovedDocument(db, RAFFLE_RULES_KEY, locale, now);
  if (!document) return null;
  const facts = await raffleRulesFacts(db, eventId, settings, locale);
  return { documentId: document.id, version: document.version, title: document.title, body: isLegalDocumentBody(document.body) ? document.body : { sections: [] }, values: facts };
}

// ---------------------------------------------------------------------------------------------
// One person
// ---------------------------------------------------------------------------------------------

/** One person as the raffle reads them, from whichever table: their event, group, name, number, language and the answer's facts. */
export type RafflePersonFacts = {
  ref: RafflePersonRef;
  eventId: string;
  kind: RaffleKind;
  name: string;
  number: number | null;
  locale: Locale;
  person: Omit<RafflePerson, "signedUp">;
  /** A test registration (§30): never in a raffle — its `confirmed` is false — and given no raffle line or note to read. */
  test?: true;
  /**
   * A volunteer's own facts for «Confirmă pentru tombolă» (§1028): the state, whether a minor, the confirmation for the raffle and the
   * organizers' exclusion — what `raffleConfirmationOffered` reads — and, once confirmed for the raffle, a minor's parent's way.
   */
  volunteer?: VolunteerRaffleFacts & { inRaffle: boolean; guardianWay: RaffleGuardianWay | null };
};

export function localeOr(value: string | null | undefined): Locale {
  return (routing.locales as readonly string[]).includes(value ?? "") ? (value as Locale) : routing.defaultLocale;
}

/**
 * The volunteers' columns every read of the raffle takes (§1023, §1028): the state, the V number, the organizers' exclusion, the age
 * the minor's rule is decided by, and the confirmation for the raffle alone with a minor's parent's agreement.
 */
const VOLUNTEER_RAFFLE_COLUMNS = {
  id: eventVolunteers.id,
  state: eventVolunteers.state,
  volunteerNumber: eventVolunteers.volunteerNumber,
  inRaffle: eventVolunteers.inRaffle,
  age: eventVolunteers.age,
  raffleConfirmedAt: eventVolunteers.raffleConfirmedAt,
  raffleGuardianAgreed: eventVolunteers.raffleGuardianAgreed,
  raffleGuardianWay: eventVolunteers.raffleGuardianWay,
};

type VolunteerRaffleRow = {
  state: "REGISTERED" | "CONFIRMED" | "CANCELLED";
  volunteerNumber: number | null;
  inRaffle: boolean;
  age: number | null;
  raffleConfirmedAt: Date | null;
  raffleGuardianAgreed: boolean | null;
};

/** A volunteer's row as «Confirmă pentru tombolă» reads it (§1028): a minor by the age «Acordul părintelui lipsește» is decided by. */
function volunteerRaffleFactsOf(row: VolunteerRaffleRow): VolunteerRaffleFacts {
  return { state: row.state, minor: isVolunteerMinor(row.age), raffleConfirmedAt: row.raffleConfirmedAt, raffleGuardianAgreed: row.raffleGuardianAgreed };
}

/**
 * A volunteer as the one answer reads them: confirmed by the organizers' «Confirmă» (§984), or confirmed for the raffle alone (§1028,
 * `volunteerConfirmedForRaffle` — never a cancelled one, a minor only with the parent's agreement recorded), with their V number
 * (§1023) and the organizers' exclusion.
 */
export function volunteerRafflePerson(row: VolunteerRaffleRow): Omit<RafflePerson, "signedUp"> {
  return {
    kind: "VOLUNTEER",
    confirmed: row.state === "CONFIRMED",
    confirmedForRaffle: volunteerConfirmedForRaffle(volunteerRaffleFactsOf(row)),
    hasNumber: row.volunteerNumber !== null,
    inRaffle: row.inRaffle,
  };
}

/** One person, read — a registration, a volunteer or a line of the elite list — or null when there is none. */
export async function readRafflePerson<T extends Record<string, unknown>>(db: Database<T>, ref: RafflePersonRef): Promise<RafflePersonFacts | null> {
  if (!isUuid(ref.id)) return null;
  if (ref.table === "registration") {
    const [row] = await db
      .select({ eventId: registrations.eventId, status: registrations.status, kind: registrations.kind, elite: registrations.elite, bibNumber: registrations.bibNumber, name: registrations.registeredName, inRaffle: registrations.inRaffle, locale: registrations.locale })
      .from(registrations)
      .where(eq(registrations.id, ref.id))
      .limit(1);
    if (!row) return null;
    const kind = raffleKindOfRegistration(row);
    return {
      ref,
      eventId: row.eventId,
      kind,
      name: row.name,
      number: row.bibNumber,
      locale: localeOr(row.locale),
      person: { kind, confirmed: row.status === "CONFIRMED" && row.kind === "REAL", hasNumber: row.bibNumber !== null, inRaffle: row.inRaffle },
      ...(row.kind === "TEST" ? { test: true as const } : {}),
    };
  }
  if (ref.table === "volunteer") {
    const [row] = await db
      .select({ ...VOLUNTEER_RAFFLE_COLUMNS, eventId: eventVolunteers.eventId, name: eventVolunteers.name, locale: eventVolunteers.locale })
      .from(eventVolunteers)
      .where(eq(eventVolunteers.id, ref.id))
      .limit(1);
    if (!row) return null;
    // A volunteer takes part with their V number (§1023): drawn by itself at the confirmation — the organizers' «Confirmă», or their
    // «Confirmă pentru tombolă» (§1028) — so every volunteer confirmed either way has one.
    return {
      ref,
      eventId: row.eventId,
      kind: "VOLUNTEER",
      name: row.name,
      number: row.volunteerNumber,
      locale: localeOr(row.locale),
      person: volunteerRafflePerson(row),
      volunteer: { ...volunteerRaffleFactsOf(row), inRaffle: row.inRaffle, guardianWay: row.raffleGuardianWay },
    };
  }
  const [row] = await db
    .select({ eventId: eventEliteEntries.eventId, bibNumber: eventEliteEntries.bibNumber, name: eventEliteEntries.name, inRaffle: eventEliteEntries.inRaffle })
    .from(eventEliteEntries)
    .where(eq(eventEliteEntries.id, ref.id))
    .limit(1);
  if (!row) return null;
  // A line of the elite list has no state and takes part by name, its number or none (§984).
  return {
    ref,
    eventId: row.eventId,
    kind: "ELITE",
    name: row.name,
    number: row.bibNumber,
    locale: routing.defaultLocale,
    person: { kind: "ELITE", confirmed: true, hasNumber: true, inRaffle: row.inRaffle },
  };
}

/** The entry column that names a person of this table. */
export function entryColumnOf(ref: RafflePersonRef) {
  return ref.table === "registration" ? eventRaffleEntries.registrationId : ref.table === "volunteer" ? eventRaffleEntries.volunteerId : eventRaffleEntries.eliteEntryId;
}

/**
 * Whether the person may sign up at all (the gate aside): confirmed, real, a number — what a sign-up of any door requires. A volunteer
 * the organizers confirmed for the raffle alone (§1028) is confirmed here (`domain/raffle.ts#raffleConfirmed`), with the V number the
 * press drew.
 */
export function raffleEligible(person: Omit<RafflePerson, "signedUp">): boolean {
  return raffleConfirmed(person) && person.hasNumber;
}

/** The person's sign-up, or null. */
export async function findRaffleEntry<T extends Record<string, unknown>>(db: Database<T>, ref: RafflePersonRef) {
  const [row] = await db.select().from(eventRaffleEntries).where(eq(entryColumnOf(ref), ref.id)).limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------------------------
// The roster: everybody of the three groups, with the answer
// ---------------------------------------------------------------------------------------------

/** One person of the event as the «Tombolă» tab, the files and the counts read them. */
export type RaffleRosterRow = {
  ref: RafflePersonRef;
  kind: RaffleKind;
  /** The number: a race number for a runner or an elite, the V number's integer for a volunteer (§1023) — two series; null for none. */
  number: number | null;
  /** The number as the raffle writes it (`raffleNumberText`): «7» or «007» as the event writes a race number, «V007» for a volunteer; null for none. */
  label: string | null;
  name: string;
  reason: RaffleReason;
  /** Whether the person was there: a registration checked in (at the desk or by «Am ajuns»), a volunteer or a line ticked «Prezent». */
  present: boolean;
  inRaffle: boolean;
  /** The sign-up, in the sign-up mode: how and when, and the entry's id for «Șterge înscrierea». */
  signUp: { entryId: string; method: RaffleEntryMethod; at: Date } | null;
  /** Whether «Înscrie» may be offered: the gate open for the group, the person eligible and not signed up. */
  maySignUp: boolean;
  /**
   * Whether the desk's «Înscrie la tombolă» (DESK) may be offered on the tab, to a desk role that is not an organizer (§1014): a
   * registration — the desk's door takes no other —, `maySignUp`, and not taken out by the organizers, as `raffleLineOf` asks at the
   * desk: a sign-up would leave the person «nu participă» while the press said they were in.
   */
  deskMaySignUp: boolean;
  /**
   * A volunteer the organizers confirmed for the raffle alone (§1028) who is not confirmed as a volunteer: when, and a minor's parent's
   * way — what the row says beside «Da», so nobody reads it as a volunteer's confirmation. Null for everybody else, a volunteer
   * confirmed by «Confirmă» included.
   */
  raffleConfirmation: { at: Date; guardianWay: RaffleGuardianWay | null } | null;
  /** Whether «Confirmă pentru tombolă» may be offered on the row (§1028, `raffleConfirmationOffered`): to the organizers, whom the page asks. */
  mayConfirmForRaffle: boolean;
  /** A volunteer under eighteen on the event's day: the press asks the parent's or guardian's agreement and how (§1028). */
  minor: boolean;
};

export type RaffleRoster = {
  settings: RaffleSettings;
  /** How the event writes a race number (§735): what each row's `label` was written with. */
  numberFormat: RaceNumberFormat;
  /** Why the sign-up is shut for every group, or null while it is open for one. */
  gateClosed: RaffleGateClosed | null;
  rows: RaffleRosterRow[];
  counts: { in: Record<RaffleKind, number>; total: number; present: number };
};

/**
 * Everybody of the event's three groups with the answer (§984). Who is listed: every real registration still standing (cancelled,
 * expired and test ones left out — a test registration is in no count the club is given, §30), every volunteer not cancelled, every
 * line of the elite list; who takes part is the one function's answer. A volunteer by their V number (§1023), in the order
 * `compareRaffleRows` gives: the race numbers, then the V numbers, then whoever has none. Four queries, whatever the size of the
 * event. The caller asks the role (`raffle-list.ts#readRaffleRoster`).
 */
export async function readRaffleRosterRows<T extends Record<string, unknown>>(db: Database<T>, eventId: string, now: Date): Promise<RaffleRoster | null> {
  const facts = await readRaffleGateFacts(db, eventId, now);
  if (!facts) return null;
  const { settings } = facts;
  const [people, helpers, lines, entries] = await Promise.all([
    db
      .select({ id: registrations.id, status: registrations.status, elite: registrations.elite, bibNumber: registrations.bibNumber, name: registrations.registeredName, inRaffle: registrations.inRaffle, checkedInAt: registrations.checkedInAt })
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.kind, "REAL"), inArray(registrations.status, [...ACTIVE_REGISTRATION_STATUSES]))),
    db
      .select({ ...VOLUNTEER_RAFFLE_COLUMNS, name: eventVolunteers.name, here: eventVolunteers.present })
      .from(eventVolunteers)
      .where(and(eq(eventVolunteers.eventId, eventId), ne(eventVolunteers.state, "CANCELLED"))),
    db
      .select({ id: eventEliteEntries.id, bibNumber: eventEliteEntries.bibNumber, name: eventEliteEntries.name, inRaffle: eventEliteEntries.inRaffle, here: eventEliteEntries.present })
      .from(eventEliteEntries)
      .where(eq(eventEliteEntries.eventId, eventId)),
    db.select().from(eventRaffleEntries).where(eq(eventRaffleEntries.eventId, eventId)),
  ]);
  const entryOf = new Map<string, (typeof entries)[number]>();
  for (const entry of entries) entryOf.set(entry.registrationId ?? entry.volunteerId ?? entry.eliteEntryId ?? "", entry);

  // «Cu înscriere separată», «Confirmă pentru tombolă» signs the volunteer up too (§1028): offered only while the gate takes volunteers.
  const volunteersGate = raffleSignUpClosedFor(facts, now, "VOLUNTEER");
  /** A volunteer's own facts for «Confirmă pentru tombolă» (§1028); absent for a registration and a line of the elite list. */
  type VolunteerExtras = { facts: VolunteerRaffleFacts; inRaffle: boolean; guardianWay: RaffleGuardianWay | null };
  const row = (ref: RafflePersonRef, number: number | null, name: string, person: Omit<RafflePerson, "signedUp">, present: boolean, volunteer?: VolunteerExtras): RaffleRosterRow => {
    const entry = entryOf.get(ref.id) ?? null;
    const maySignUp = settings.signUp && entry === null && raffleEligible(person) && raffleSignUpClosedFor(facts, now, person.kind) === null;
    return {
      ref,
      kind: person.kind,
      number,
      label: raffleNumberText({ number, kind: person.kind }, facts.numberFormat),
      name,
      reason: raffleParticipation({ ...person, signedUp: entry !== null }, settings),
      present,
      inRaffle: person.inRaffle,
      signUp: settings.signUp && entry ? { entryId: entry.id, method: entry.method, at: entry.createdAt } : null,
      maySignUp,
      deskMaySignUp: ref.table === "registration" && maySignUp && person.inRaffle,
      raffleConfirmation:
        volunteer && !person.confirmed && person.confirmedForRaffle === true && volunteer.facts.raffleConfirmedAt !== null
          ? { at: volunteer.facts.raffleConfirmedAt, guardianWay: volunteer.guardianWay }
          : null,
      mayConfirmForRaffle: volunteer ? raffleConfirmationOffered({ volunteer: { ...volunteer.facts, inRaffle: volunteer.inRaffle }, settings, gateClosed: volunteersGate }) : false,
      minor: volunteer?.facts.minor ?? false,
    };
  };

  const rows: RaffleRosterRow[] = [
    ...people.map((one) => {
      const kind = raffleKindOfRegistration(one);
      return row({ table: "registration", id: one.id }, one.bibNumber, one.name, { kind, confirmed: one.status === "CONFIRMED", hasNumber: one.bibNumber !== null, inRaffle: one.inRaffle }, one.checkedInAt !== null);
    }),
    // A volunteer confirmed by «Confirmă», or confirmed for the raffle alone (§1028), takes part with the V number either drew.
    ...helpers.map((one) =>
      row({ table: "volunteer", id: one.id }, one.volunteerNumber, one.name, volunteerRafflePerson(one), one.here, { facts: volunteerRaffleFactsOf(one), inRaffle: one.inRaffle, guardianWay: one.raffleGuardianWay }),
    ),
    ...lines.map((one) => row({ table: "elite", id: one.id }, one.bibNumber, one.name, { kind: "ELITE", confirmed: true, hasNumber: true, inRaffle: one.inRaffle }, one.here)),
  ].sort(compareRaffleRows);

  const counts = { in: { RUNNER: 0, ELITE: 0, VOLUNTEER: 0 } as Record<RaffleKind, number>, total: 0, present: 0 };
  for (const one of rows) {
    if (one.reason !== "in") continue;
    counts.in[one.kind] += 1;
    counts.total += 1;
    if (one.present) counts.present += 1;
  }
  return { settings, numberFormat: facts.numberFormat, gateClosed: raffleSignUpClosedFor(facts, now), rows, counts };
}

// ---------------------------------------------------------------------------------------------
// One answer per person, for the lists, the pages, the manage card and the desk
// ---------------------------------------------------------------------------------------------

/** The answer for each person asked, by id — what the lists' «Tombolă» columns draw beside the organizers' tick. */
export async function raffleReasonsFor<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  ask: { registrationIds?: readonly string[]; volunteerIds?: readonly string[] },
): Promise<Map<string, RaffleReason>> {
  const reasons = new Map<string, RaffleReason>();
  const registrationIds = (ask.registrationIds ?? []).filter(isUuid);
  const volunteerIds = (ask.volunteerIds ?? []).filter(isUuid);
  if (registrationIds.length === 0 && volunteerIds.length === 0) return reasons;
  const found = await readRaffleEvent(db, eventId);
  if (!found) return reasons;
  const { settings } = found;
  const [people, helpers, entries] = await Promise.all([
    registrationIds.length > 0
      ? db
          .select({ id: registrations.id, status: registrations.status, kind: registrations.kind, elite: registrations.elite, bibNumber: registrations.bibNumber, inRaffle: registrations.inRaffle })
          .from(registrations)
          .where(and(eq(registrations.eventId, eventId), inArray(registrations.id, [...registrationIds])))
      : Promise.resolve([]),
    volunteerIds.length > 0
      ? db
          .select(VOLUNTEER_RAFFLE_COLUMNS)
          .from(eventVolunteers)
          .where(and(eq(eventVolunteers.eventId, eventId), inArray(eventVolunteers.id, [...volunteerIds])))
      : Promise.resolve([]),
    settings.signUp ? db.select({ registrationId: eventRaffleEntries.registrationId, volunteerId: eventRaffleEntries.volunteerId }).from(eventRaffleEntries).where(eq(eventRaffleEntries.eventId, eventId)) : Promise.resolve([]),
  ]);
  const signed = new Set(entries.flatMap((entry) => [entry.registrationId, entry.volunteerId].filter((id): id is string => id !== null)));
  for (const one of people) {
    // A test registration (§30) is in no raffle and is told no reason: «Nu · neconfirmat» would be false of a confirmed one.
    if (one.kind === "TEST") continue;
    reasons.set(
      one.id,
      raffleParticipation({ kind: raffleKindOfRegistration(one), confirmed: one.status === "CONFIRMED" && one.kind === "REAL", hasNumber: one.bibNumber !== null, inRaffle: one.inRaffle, signedUp: signed.has(one.id) }, settings),
    );
  }
  for (const one of helpers) {
    // Confirmed by «Confirmă», or for the raffle alone (§1028): the same answer the tab and the files give.
    reasons.set(one.id, raffleParticipation({ ...volunteerRafflePerson(one), signedUp: signed.has(one.id) }, settings));
  }
  return reasons;
}

/**
 * One person's raffle line: the answer, whether the event asks a sign-up and whether they hold one, and whether «Înscrie» may be
 * offered — and, for a volunteer (§1028), whether they are confirmed for the raffle alone (with a minor's parent's way), whether
 * «Confirmă pentru tombolă» may be offered, and whether they are a minor, whose press asks the parent's agreement.
 */
export type RaffleLine = {
  reason: RaffleReason;
  signUpMode: boolean;
  signedUp: boolean;
  maySignUp: boolean;
  volunteer?: { confirmedForRaffle: boolean; guardianWay: RaffleGuardianWay | null; mayConfirmForRaffle: boolean; minor: boolean };
};

/**
 * The line from what was read — the one place it is decided, for one person and for a page of them. «Înscrie la tombolă» is offered
 * only to a person the organizers did not take out (`inRaffle`): a sign-up would leave them «nu participă» while the desk said they
 * were signed up — the «Tombolă» tab keeps its own offer, where the organizers read why.
 */
function raffleLineOf(person: Omit<RafflePerson, "signedUp">, facts: RaffleGateFacts, signedUp: boolean, now: Date): RaffleLine {
  return {
    reason: raffleParticipation({ ...person, signedUp }, facts.settings),
    signUpMode: facts.settings.signUp,
    signedUp,
    maySignUp: facts.settings.signUp && !signedUp && raffleEligible(person) && person.inRaffle && raffleSignUpClosedFor(facts, now, person.kind) === null,
  };
}

/**
 * One person's raffle line, for their page or the desk (§984): null for an event that holds no raffle; else the answer, and whether a
 * staff «Înscrie la tombolă» may be offered — the gate open for their group, the person eligible, not taken out and not in yet.
 */
export async function readRaffleLine<T extends Record<string, unknown>>(db: Database<T>, ref: RafflePersonRef, now: Date): Promise<RaffleLine | null> {
  const person = await readRafflePerson(db, ref);
  // A test registration (§30) has no raffle line on its page or at the desk: it takes part in none.
  if (!person || person.test) return null;
  const facts = await readRaffleGateFacts(db, person.eventId, now);
  if (!facts || !facts.settings.hasRaffle) return null;
  const entry = facts.settings.signUp ? await findRaffleEntry(db, ref) : null;
  const line = raffleLineOf(person.person, facts, entry !== null, now);
  if (!person.volunteer) return line;
  // A volunteer's page (§1028): confirmed for the raffle alone, or «Confirmă pentru tombolă» to offer — by the tab's own rule.
  const confirmedForRaffle = !person.person.confirmed && person.person.confirmedForRaffle === true;
  return {
    ...line,
    volunteer: {
      confirmedForRaffle,
      guardianWay: confirmedForRaffle ? person.volunteer.guardianWay : null,
      mayConfirmForRaffle: raffleConfirmationOffered({ volunteer: person.volunteer, settings: facts.settings, gateClosed: raffleSignUpClosedFor(facts, now, "VOLUNTEER") }),
      minor: person.volunteer.minor,
    },
  };
}

/**
 * The desk list's lines (§984), one read for the rows it shows — a search by name or number, or a typed code, lands there and not on
 * the scanned person's view, so every row says the raffle too. Per event on the page (one, or two when a code found a runner of
 * another event): the gate's facts once, the rows and their sign-ups in one query each. A row of an event without a raffle has none.
 */
export async function readRaffleDeskLines<T extends Record<string, unknown>>(db: Database<T>, rows: ReadonlyArray<{ id: string; eventId: string }>, now: Date): Promise<Map<string, RaffleLine>> {
  const lines = new Map<string, RaffleLine>();
  const byEvent = new Map<string, string[]>();
  for (const row of rows) {
    if (isUuid(row.id) && isUuid(row.eventId)) byEvent.set(row.eventId, [...(byEvent.get(row.eventId) ?? []), row.id]);
  }
  for (const [eventId, ids] of byEvent) {
    const facts = await readRaffleGateFacts(db, eventId, now);
    if (!facts || !facts.settings.hasRaffle) continue;
    const [people, entries] = await Promise.all([
      db
        .select({ id: registrations.id, status: registrations.status, kind: registrations.kind, elite: registrations.elite, bibNumber: registrations.bibNumber, inRaffle: registrations.inRaffle })
        .from(registrations)
        .where(and(eq(registrations.eventId, eventId), inArray(registrations.id, ids))),
      facts.settings.signUp ? db.select({ registrationId: eventRaffleEntries.registrationId }).from(eventRaffleEntries).where(inArray(eventRaffleEntries.registrationId, ids)) : Promise.resolve([]),
    ]);
    const signed = new Set(entries.map((entry) => entry.registrationId));
    for (const one of people) {
      // A test registration (§30) gets no raffle line at the desk: it takes part in no raffle, and «neconfirmat» would be false.
      if (one.kind === "TEST") continue;
      const person = { kind: raffleKindOfRegistration(one), confirmed: one.status === "CONFIRMED" && one.kind === "REAL", hasNumber: one.bibNumber !== null, inRaffle: one.inRaffle };
      lines.set(one.id, raffleLineOf(person, facts, signed.has(one.id), now));
    }
  }
  return lines;
}

/**
 * The manage page's raffle (§984): each person's card (`readRaffleManageCards`) and, when some card is drawn, the rules in force in the
 * page's language, filled for the event — read once for the page. Empty cards and no rules while the gate is shut.
 */
export async function readRaffleManageView<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  people: ReadonlyArray<{ id: string; anotherAdult: boolean }>,
  locale: Locale,
  now: Date,
): Promise<{ cards: Map<string, RaffleManageCard>; rules: RaffleRulesText | null }> {
  const cards = await readRaffleManageCards(db, eventId, people, now);
  if (cards.size === 0) return { cards, rules: null };
  const found = await readRaffleEvent(db, eventId);
  return { cards, rules: found ? await readRaffleRules(db, eventId, found.settings, locale, now) : null };
}

/** What the manage page draws for each person: whether they are in, and whether this link may sign them up. */
export type RaffleManageCard = { signedUp: boolean; maySignUp: boolean };

/**
 * The «Tombolă» card of the manage page, per person (§984): drawn only while the gate is open for the person's group and the person
 * is a confirmed real registration with a number — the door's own condition, so a card never leads to a refusal. `maySignUp` is
 * false for another adult on the address (§421), who is offered the way out alone. One read of the gate for the page.
 */
export async function readRaffleManageCards<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  people: ReadonlyArray<{ id: string; anotherAdult: boolean }>,
  now: Date,
): Promise<Map<string, RaffleManageCard>> {
  const cards = new Map<string, RaffleManageCard>();
  if (people.length === 0) return cards;
  const facts = await readRaffleGateFacts(db, eventId, now);
  if (!facts || raffleSignUpClosedFor(facts, now) !== null) return cards;
  const ids = people.map((one) => one.id).filter(isUuid);
  if (ids.length === 0) return cards;
  const rows = await db
    .select({ id: registrations.id, status: registrations.status, kind: registrations.kind, elite: registrations.elite, bibNumber: registrations.bibNumber })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), inArray(registrations.id, ids)));
  const entries = rows.length > 0 ? await db.select({ registrationId: eventRaffleEntries.registrationId }).from(eventRaffleEntries).where(inArray(eventRaffleEntries.registrationId, rows.map((row) => row.id))) : [];
  const signed = new Set(entries.map((entry) => entry.registrationId));
  for (const row of rows) {
    if (raffleSignUpClosedFor(facts, now, raffleKindOfRegistration(row)) !== null) continue;
    if (row.status !== "CONFIRMED" || row.kind !== "REAL" || row.bibNumber === null) continue;
    const anotherAdult = people.find((one) => one.id === row.id)?.anotherAdult === true;
    cards.set(row.id, { signedUp: signed.has(row.id), maySignUp: !anotherAdult });
  }
  return cards;
}
