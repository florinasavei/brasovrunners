import { and, asc, count, desc, eq, inArray, max, sql, type SQL } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailActionTokens } from "@/db/schema/email-action-tokens";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import {
  type RegistrationCancelReasonKind,
  type RegistrationKind,
  type RegistrationSex,
  type RegistrationSource,
  type RegistrationStatus,
  type RegistrationTshirtSize,
  registrations,
} from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { alias } from "drizzle-orm/pg-core";
import { awaitingItsFirstEmail, familyEmailQueued, familyReservationHolds, offerAwaitingItsFirstEmail } from "./repository";
import { promoListed } from "./sponsor-list";
import { healthNoteShown } from "./domain/health-note";
import { memberCanonicalEmails } from "./member-ticks";
import { OFFERS_MEMBER_BIB } from "@/modules/events/repository";
import type { QueueOrder } from "./domain/waitlist";
import { isRejectionCause, type RejectionCause } from "@/modules/notifications/domain/rejection-cause";
import type { DeskEmailState, RegistrationEmailState, RegistrationEmailStateDetail } from "./domain/email-state";
import { deskEmailStateSql, hasEmailStateSql, registrationEmailStateDetailSql, registrationEmailStateSql } from "./email-state";
import type { PlaceDeadlineCounts, PlaceDeadlineEvent } from "./domain/place-deadlines";

/**
 * Read queries for the Administrator-only backoffice (AGENTS.md §15.8, §15.10; BR-REQ-060-01,
 * BR-REQ-070-01). Kept apart from `repository.ts`, which is the state-machine's own guarded
 * reads and writes: nothing here ever changes a registration, and every column selected is
 * chosen explicitly — the same `PUBLIC_COLUMNS` discipline `modules/events/repository.ts` uses
 * — so a join can never smuggle a participant's email into a response nobody asked it to carry.
 */

export type RegistrationListRow = {
  id: string;
  /** The address (§389): the family marker names the other rows of it at the event (§543). */
  participantId: string;
  status: RegistrationStatus;
  kind: RegistrationKind;
  /** «În afara locurilor» (§643): seated outside the event's places — the row's chip and the export's column. */
  outsideCapacity: boolean;
  /** PUBLIC when the participant submitted it, STAFF when an organizer entered it for them. */
  source: RegistrationSource;
  registeredName: string;
  firstName: string | null;
  lastName: string | null;
  participantEmail: string;
  eventId: string;
  eventTitle: string | null;
  /** BR-REQ-031-06. What this person said about themselves, never what the club verified. */
  clubMemberDeclared: boolean;
  /**
   * Where the person lives (§510) — the country's ISO code, `RO` by default, and the city as typed — for
   * the list's «Oraș» (`domain/city-label.ts#cityLabel`, §660) and the export's «Country» and «City».
   */
  country: string;
  city: string | null;
  /**
   * The birth date and the event's start on its own clock, for «Vârstă» (§660): the age on the event's
   * day, `domain/age.ts#ageOnRaceDay`, the one the categories and the minors' rules count (§329).
   */
  birthDate: string | null;
  eventStartsAt: Date;
  eventTimezone: string;
  /** «Membru (verificat)» (§662): the participant's canonical address is a member account's; `membershipOf` reads the two. */
  memberVerified: boolean;
  /** «Vreau numărul de membru» (§664) and whether the event offers the members' bib: the export's «Member bib». */
  memberBibWanted: boolean;
  memberBibOffered: boolean;
  /** When the entrant ticked "I am medically fit" (§171); null on a desk or phone entry. */
  fitnessDeclaredAt: Date | null;
  /**
   * The club's terms the form accepted expressly (§421), and when — the export's two columns
   * (§425). Null for a staff or desk entry and for a row sent before the column existed.
   */
  termsVersion: number | null;
  termsAcceptedAt: Date | null;
  /** The runner's own club, as typed (§172): a column the start list is sorted by. */
  clubName: string | null;
  /** The optional socials (§106), as typed; null when not given. */
  stravaUrl: string | null;
  instagramHandle: string | null;
  /** The parent or guardian of a minor (§108); null for an adult. */
  guardianName: string | null;
  /**
   * The registration's language: which translation of the declaration it signs, and so whether
   * a minor's paper carries the minor's signature too (`declarationAsksMinorToSign`, §330).
   */
  locale: Locale;
  /**
   * "Keep my name off the public start list" (BR-REQ-039-01, §186). The club sees who is on
   * the list it published, because "is my name on the site" is a question people ask the
   * club and not the platform.
   */
  listOptOut: boolean;
  /** Whether the socials are printed beside the name on the public list (§500); the export's last column. */
  listSocials: boolean;
  /** «Oferte și beneficii» (§562): the person's own consent and its moment; the export's last column. */
  promoConsent: boolean;
  promoConsentAt: Date | null;
  submittedAt: Date;
  confirmedAt: Date | null;
  /** The race number, drawn at the confirmation (BR-REQ-038-01, §548); shown through `raceNumberOf`. */
  bibNumber: number | null;
  /** When the club last said this bib is on paper (§264); null while it is not. */
  bibPrintedAt: Date | null;
  checkedInAt: Date | null;
  /**
   * The registration's one email state (§NNN, amending §663): the participant's own message that did not
   * reach them — which, when, why, and what came after; null when their mail has no open refusal. Never
   * the provider's words: no list payload carries them.
   */
  emailState: RegistrationEmailState | null;
  /** The latest declaration's declarant's document: the adult's, or the parent's for a minor (§95, §108). */
  idDocument: string | null;
  /** The minor's own document, beside the parent's (§330); `identityDocumentsOf` says whose is whose. */
  minorIdDocument: string | null;
  /**
   * The rest of what the journey column reads (`domain/journey.ts`, §145): the participant's
   * own click, a staff attestation, the hold or the offer, the latest declaration acceptance,
   * and how the row ended. All on the row or on the participant already joined — the
   * acceptance is one index probe, like `idDocument` above, never a query per row.
   * `cycleStartedAt` is `privacy_acknowledged_at`, the one column a restart always rewrites:
   * the derivation reads nothing older than it as this cycle's.
   */
  cycleStartedAt: Date;
  emailVerifiedAt: Date | null;
  emailConfirmedAt: Date | null;
  waitlistedAt: Date | null;
  offerCreatedAt: Date | null;
  holdExpiresAt: Date | null;
  /** When the first email's link lapses (§377): the journey's «linkul expiră …» on a row waiting for it (§635). A column of the row, no join. */
  emailLinkExpiresAt: Date | null;
  /** The offer's `WAITLIST_SPOT_OFFER` still queued (§520): past its stored deadline it has not lapsed (§650, `rowDeadlineOf`). */
  offerEmailQueued?: boolean;
  declarationAcceptedAt: Date | null;
  cancelledAt: Date | null;
  /** The participant's own reason for cancelling (§558): the export's «Cancellation reason». Null on a staff cancellation. */
  cancelReasonKind: RegistrationCancelReasonKind | null;
  cancelReason: string | null;
  expiredAt: Date | null;
  expiryReason: string | null;
};

export type RegistrationListFilters = {
  eventId?: string;
  status?: RegistrationStatus;
  excludeTest?: boolean;
  /** «Doar membrii {club}» (§650, §662): the rows whose person ticked the box or whose address is a member account's. */
  clubMember?: boolean;
  /**
   * The member accounts' canonical addresses (`memberCanonicalEmails`), when the caller has read them
   * already: a page that lists, counts and sums reads them once. Absent, each query reads them itself.
   */
  members?: readonly string[];
  /** A name, or part of one (BR-REQ-041-01 criterion 7). */
  search?: string;
  /** Only the rows whose email the provider refused (§83): who to call. */
  emailBounced?: boolean;
  /**
   * «Doar cu oferte și beneficii» (§581): only the rows `sponsor-list.ts#promoListed` lists — a yes
   * on a real registration that still stands, the one truth of who consented. Narrows only.
   */
  promoConsented?: boolean;
  /** «În afara locurilor» (§643): only the rows seated outside the places — the summary strip's pill. Narrows only. */
  outsideCapacity?: boolean;
  /**
   * The members' race number asked for and not verified (§664): the real rows with a number that want it,
   * at an event that offers it, whose address is no member account's — the bibs page's link, the same set
   * its line counts. Narrows only.
   */
  memberBibAsked?: boolean;
};

/**
 * The columns the list may be ordered by, and the only strings that ever reach an `ORDER BY`.
 *
 * An allowlist rather than a mapping built from the request: `?sort=` arrives from a URL anybody
 * can type, and the one thing that must not be possible is for it to name a column.
 */
export const REGISTRATION_SORT_KEYS = ["name", "status", "event", "submitted", "bib", "untilWhen", "city", "age"] as const;
export type RegistrationSortKey = (typeof REGISTRATION_SORT_KEYS)[number];

/**
 * Romanian diacritics folded away on both sides of a name search.
 *
 * `ILIKE` alone answers "no results" when an organizer types `stefan` and the participant wrote
 * `Ștefan`, which on race morning reads as "this person never registered". `translate` is core
 * SQL — no extension, so it behaves identically on Neon and on the PGlite the tests run against,
 * where `unaccent` is not available.
 *
 * Both spellings of the comma-below letters are folded: `ș`/`ț` are correct, `ş`/`ţ` are the
 * cedilla characters older Romanian keyboard layouts still produce, and a person who typed one
 * must be found by somebody typing the other.
 */
const DIACRITICS = "ăâîșțşţĂÂÎȘȚŞŢ";
const PLAIN = "aaiststAAISTST";

/**
 * `translate` before `lower`, and never the other way round.
 *
 * `lower()` is locale-dependent and only folds ASCII under the `C` collation, which is what
 * PGlite runs — so `lower('Ștefan')` is still `Ștefan` there, `translate` then produced the
 * capital `Stefan`, and a search for `stefan` matched nothing. Folding to ASCII first leaves
 * `lower()` with only ASCII to do, which every collation agrees about.
 */
function foldedName(column: SQL | typeof registrations.registeredName): SQL {
  return sql`lower(translate(${column}, ${DIACRITICS}, ${PLAIN}))`;
}

/** The same fold as `foldedName`, for the term, so both sides of the comparison agree. */
function foldTerm(term: string): string {
  const lowered = term.toLowerCase();
  let folded = "";
  for (const character of lowered) {
    const index = DIACRITICS.indexOf(character);
    folded += index === -1 ? character : PLAIN[index].toLowerCase();
  }
  return folded;
}

/**
 * `%`, `_` and `\` made literal before the term becomes a `LIKE` pattern.
 *
 * Binding the parameter stops SQL injection and does nothing about this: `LIKE` reads its
 * metacharacters out of the *value*, so an organizer who types `%` was matching every
 * participant in the club rather than nobody, and `_` was matching any single character. Both
 * are things a person types by accident far more often than on purpose.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Every filter the list and its count must agree on, in one place so they cannot drift apart. */
/**
 * The identity document the latest declaration names (§95): what the desk checks the kit
 * against, and what the export carries for the organiser who hands kits out by ID.
 */
const latestIdDocument = sql<string | null>`(
  SELECT ${declarationAcceptances.idDocument}
  FROM ${declarationAcceptances}
  WHERE ${declarationAcceptances.registrationId} = ${registrations.id}
  ORDER BY ${declarationAcceptances.acceptedAt} DESC
  LIMIT 1
)`;

/**
 * The minor's own document on the same latest declaration (§330): a minor's declaration carries
 * two, the parent's in `id_document` and the child's here. The same probe on the same index, so a
 * desk page of two hundred rows is still two hundred index lookups per column, never a query each.
 */
const latestMinorIdDocument = sql<string | null>`(
  SELECT ${declarationAcceptances.minorIdDocument}
  FROM ${declarationAcceptances}
  WHERE ${declarationAcceptances.registrationId} = ${registrations.id}
  ORDER BY ${declarationAcceptances.acceptedAt} DESC
  LIMIT 1
)`;

/**
 * When the latest declaration was accepted — online, or on paper at the desk — for the
 * journey's fourth step (§145). Same probe as `latestIdDocument`, on the same index;
 * `mapWith` the column, because a raw subquery comes back from the driver as text.
 */
const latestDeclarationAcceptedAt = sql<Date | null>`(
  SELECT ${declarationAcceptances.acceptedAt}
  FROM ${declarationAcceptances}
  WHERE ${declarationAcceptances.registrationId} = ${registrations.id}
  ORDER BY ${declarationAcceptances.acceptedAt} DESC
  LIMIT 1
)`.mapWith(declarationAcceptances.acceptedAt);

/**
 * «Membru (verificat)» (§662): the participant's canonical address (`participants.canonical_email`, the
 * canonicalizer's own output, AGENTS.md §10.4) is among the member accounts' — never a raw address, never
 * a name. With no member account it is plainly false, never an `IN ()`.
 */
function memberVerifiedOf(members: readonly string[]): SQL<boolean> {
  return (members.length > 0 ? sql<boolean>`(${inArray(participants.canonicalEmail, [...members])})` : sql<boolean>`false`).mapWith(Boolean);
}

/**
 * The members' race number asked for and not verified (§664), in the bibs sheet's own scope: a real row
 * with a number (`bibs.ts#bibScopeWhere`), that wants it, at an event that offers it, whose address is no
 * member account's — so the list the bibs page links to counts what its line counts. The event's switch
 * is read through its own `EXISTS`, never through the caller's joins: the summary and the count select
 * no `events`, and a condition naming it there failed the whole page.
 */
function memberBibAskedUnverified(members: readonly string[]): SQL {
  return sql`(${registrations.memberBibWanted} and ${registrations.kind} = 'REAL' and ${registrations.bibNumber} is not null and exists (select 1 from ${events} where ${events.id} = ${registrations.eventId} and ${OFFERS_MEMBER_BIB}) and not ${memberVerifiedOf(members)})`;
}

/** The member accounts' canonical addresses for one query: the caller's, or read now. */
async function membersFor<T extends Record<string, unknown>>(db: Database<T>, filters: RegistrationListFilters): Promise<readonly string[]> {
  return filters.members ?? [...(await memberCanonicalEmails(db))];
}

function registrationConditions(filters: RegistrationListFilters, members: readonly string[] = []): SQL[] {
  const search = filters.search?.trim();

  return [
    filters.eventId ? eq(registrations.eventId, filters.eventId) : undefined,
    filters.status ? eq(registrations.status, filters.status) : undefined,
    filters.excludeTest ? eq(registrations.kind, "REAL") : undefined,
    // Only ever narrows to the members, declared or verified (§662; the row's chip says which).
    // There is no "show me the non-members" filter, because `false` here means "did not tick a
    // box" as often as it means "not a member", and a screen that presented it as the second
    // would be inventing an answer.
    filters.clubMember ? sql`(${registrations.clubMemberDeclared} or ${memberVerifiedOf(members)})` : undefined,
    // «Doar cu un email respins»: the rows that carry the state (§NNN), one EXISTS — never the object built to test it.
    filters.emailBounced ? hasEmailStateSql() : undefined,
    // The same condition as the club's list on «Newsletter» and the sponsor list's candidates (§570, §581).
    filters.promoConsented ? promoListed() : undefined,
    filters.outsideCapacity ? eq(registrations.outsideCapacity, true) : undefined,
    filters.memberBibAsked ? memberBibAskedUnverified(members) : undefined,
    /*
      Name only, and deliberately not the email address. An organizer at a desk is holding a
      person who just said their name out loud; matching addresses as well would turn this box
      into a way to ask "is this address registered", which is the membership question §19.4
      keeps the participant-facing resend from answering. The address is still shown on the row
      once the name has found it.

      `%` on both sides because a Romanian name is as often searched by its second word as its
      first — those two are the pattern; every `%` and `_` inside what was typed is escaped
      first, so they match themselves.
    */
    search
      ? sql`${foldedName(registrations.registeredName)} LIKE ${`%${escapeLike(foldTerm(search))}%`} ESCAPE '\\'`
      : undefined,
  ].filter((condition) => condition !== undefined);
}

/**
 * «Până când» (§650): the deadline the row waits on, as `domain/row-deadline.ts#rowDeadlineOf` reads it —
 * the hold's or the offer's, a family's reservation while it holds, else the first email's link — and
 * null for every other state. The same cases, so the order is the order of the dates on screen.
 */
function rowDeadlineOrder(now: Date): SQL {
  return sql`(case
    when ${registrations.status} in ('PENDING_DECLARATION', 'WAITLIST_OFFERED') then ${registrations.holdExpiresAt}
    when ${registrations.status} = 'PENDING_EMAIL_CONFIRMATION' and ${registrations.holdExpiresAt} > ${now} then ${registrations.holdExpiresAt}
    when ${registrations.status} = 'PENDING_EMAIL_CONFIRMATION' then ${registrations.emailLinkExpiresAt}
  end)`;
}

/** Whether the row is an offer whose `WAITLIST_SPOT_OFFER` is still queued (§520, `offerAwaitingItsFirstEmail`). */
function offerEmailQueuedAt(now: Date): SQL<boolean> {
  return sql<boolean>`(${registrations.status} = 'WAITLIST_OFFERED' and ${offerAwaitingItsFirstEmail(now)})`.mapWith(Boolean);
}

/**
 * When the live link the row's state is waiting on lapses (§654, «Ce îi spui»): the address's
 * confirmation on `PENDING_EMAIL_CONFIRMATION`, the declaration on `PENDING_DECLARATION`, the offer on
 * `WAITLIST_OFFERED` — and nothing on any other state. Chosen by purpose, never by recency across
 * purposes: the «Nu mai pot veni» link (§547) is a fourteen-day `MANAGE_REGISTRATION` token minted in
 * the same send as each of those emails, at the same `now`, and any later message mints a newer one,
 * so "the newest live link" would tell somebody whose offer lapses tomorrow that they have two weeks.
 * Unused, not superseded or revoked, still ahead of `now`; the newest of that purpose, ties broken on
 * `id`. One probe on `email_action_tokens_registration_purpose_expiry_idx`, inside the page's own
 * query, so «Ce îi spui» costs no round trip. Null when no such link is alive.
 */
function liveLinkExpiresAtFor(now: Date): SQL<Date | null> {
  return sql<Date | null>`(
    select ${emailActionTokens.expiresAt}
    from ${emailActionTokens}
    where ${emailActionTokens.registrationId} = ${registrations.id}
      and (
        (${registrations.status} = 'PENDING_EMAIL_CONFIRMATION' and ${emailActionTokens.purpose} = 'VERIFY_REGISTRATION_EMAIL')
        or (${registrations.status} = 'PENDING_DECLARATION' and ${emailActionTokens.purpose} = 'COMPLETE_DECLARATION')
        or (${registrations.status} = 'WAITLIST_OFFERED' and ${emailActionTokens.purpose} = 'WAITLIST_OFFER')
      )
      and ${emailActionTokens.usedAt} is null
      and ${emailActionTokens.invalidatedAt} is null
      and ${emailActionTokens.expiresAt} > ${now}
    order by ${emailActionTokens.createdAt} desc, ${emailActionTokens.id} desc
    limit 1
  )`.mapWith(emailActionTokens.expiresAt);
}

/**
 * Where a waiting row stands in its event's line (§629, §654), in the page's own query: the same
 * numbers as `repository.ts#readWaitlistPosition` — the position in `lockOldestWaitlisted`'s order
 * `(waitlisted_at, id)`, written as the count of the `WAITLISTED` rows at or ahead of this one, and
 * the line's length — null on a row that is not waiting and on a cancelled event, as that reader is.
 * A test holds the two equal (`tests/integration/registrations/what-to-tell.test.ts`).
 */
const waitingNow = sql`(${registrations.status} = 'WAITLISTED' and ${events.eventStatus} <> 'CANCELLED')`;
const waitlistPositionOfRow = sql<number | null>`(case when ${waitingNow} then (
    select count(*)::int from "registrations" as "ahead"
    where "ahead"."event_id" = ${registrations.eventId}
      and "ahead"."status" = 'WAITLISTED'
      and ("ahead"."waitlisted_at", "ahead"."id") <= (${registrations.waitlistedAt}, ${registrations.id})
  ) end)`.mapWith(Number);
const waitlistLengthOfRow = sql<number | null>`(case when ${waitingNow} then (
    select count(*)::int from "registrations" as "line"
    where "line"."event_id" = ${registrations.eventId} and "line"."status" = 'WAITLISTED'
  ) end)`.mapWith(Number);

function registrationOrderBy(sort: RegistrationSortKey, dir: "asc" | "desc", now: Date) {
  const direction = dir === "asc" ? asc : desc;

  switch (sort) {
    case "name":
      return direction(registrations.registeredName);
    case "status":
      return direction(registrations.status);
    case "event":
      return direction(eventTranslations.title);
    case "submitted":
      return direction(registrations.submittedAt);
    // Race morning sorts by this (§173). Nulls last either way: a row with no number yet is
    // not "before 1", it is not in the list the sort is about.
    case "bib":
      return dir === "asc" ? sql`${registrations.bibNumber} asc nulls last` : sql`${registrations.bibNumber} desc nulls last`;
    // The soonest deadline first (§650); a row that waits on none comes after every dated one, either way.
    case "untilWhen":
      return dir === "asc" ? sql`${rowDeadlineOrder(now)} asc nulls last` : sql`${rowDeadlineOrder(now)} desc nulls last`;
    /*
      «Oraș» (§660): the city as typed, by the database's collation as the name sorts; a row with no city
      last either way, as a row with no number is under «BIB». The country's code the cell adds is not
      part of the order: «Bristol (GB)» sorts among the B's.
    */
    case "city":
      return dir === "asc" ? sql`nullif(btrim(${registrations.city}), '') asc nulls last` : sql`nullif(btrim(${registrations.city}), '') desc nulls last`;
    /*
      «Vârstă» (§660): the youngest first is the latest birth date first. Over one event this is exactly
      the order of the ages on screen; over every event it is the order of the birth dates, which two
      rows of different races read the same way within a year. No birth date last, either way.
    */
    case "age":
      return dir === "asc" ? sql`${registrations.birthDate} desc nulls last` : sql`${registrations.birthDate} asc nulls last`;
  }
}

/**
 * `excludeTest` is what the CSV export sets, and the reason it is a filter here rather than a
 * column the caller drops.
 *
 * The decision (`DECISIONS.md` §30): the export **omits** `TEST` rows rather than labelling
 * them. A label survives inside this application, where the chip sits next to the row; an
 * export is a file that leaves it. It is opened in a spreadsheet, sorted, filtered, and printed
 * at a start line by a volunteer who never saw this screen — and a column they filtered away an
 * hour ago is not a warning. Every screen inside the backoffice labels them instead, because
 * there the context travels with the row.
 *
 * `page` is optional because there are two callers with opposite needs: the list screen asks for
 * one page, and the CSV export asks for the whole filtered set on purpose — a spreadsheet of the
 * first 25 people would be a quietly wrong file (§15.10).
 */
export async function listRegistrationsForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  filters: RegistrationListFilters = {},
  page?: { limit: number; offset: number; sort: RegistrationSortKey; dir: "asc" | "desc" },
  /** The clock of «Până când» (§650): a family's reservation against its link in the order, a queued offer's email (§520). */
  now: Date = new Date(),
): Promise<RegistrationListRow[]> {
  const members = await membersFor(db, filters);
  const conditions = registrationConditions(filters, members);

  const query = db
    .select({
      id: registrations.id,
      participantId: registrations.participantId,
      status: registrations.status,
      kind: registrations.kind,
      outsideCapacity: registrations.outsideCapacity,
      source: registrations.source,
      registeredName: registrations.registeredName,
      firstName: registrations.firstName,
      lastName: registrations.lastName,
      participantEmail: participants.deliveryEmail,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      clubMemberDeclared: registrations.clubMemberDeclared,
      // «Oraș» and «Vârstă» (§660): read from the row and its event, no query per row.
      country: registrations.country,
      city: registrations.city,
      birthDate: registrations.birthDate,
      eventStartsAt: events.startsAt,
      eventTimezone: events.timezone,
      memberVerified: memberVerifiedOf(members),
      // The members' race number (§664): the export's «Member bib».
      memberBibWanted: registrations.memberBibWanted,
      memberBibOffered: OFFERS_MEMBER_BIB,
      fitnessDeclaredAt: registrations.fitnessDeclaredAt,
      termsVersion: registrations.termsVersion,
      termsAcceptedAt: registrations.termsAcceptedAt,
      clubName: registrations.clubName,
      listOptOut: registrations.listOptOut,
      listSocials: registrations.listSocials,
      promoConsent: registrations.promoConsent,
      promoConsentAt: registrations.promoConsentAt,
      stravaUrl: registrations.stravaUrl,
      instagramHandle: registrations.instagramHandle,
      guardianName: registrations.guardianName,
      locale: registrations.locale,
      submittedAt: registrations.submittedAt,
      confirmedAt: registrations.confirmedAt,
      bibNumber: registrations.bibNumber,
      bibPrintedAt: registrations.bibPrintedAt,
      checkedInAt: registrations.checkedInAt,
      emailState: registrationEmailStateSql(),
      idDocument: latestIdDocument,
      minorIdDocument: latestMinorIdDocument,
      cycleStartedAt: registrations.privacyAcknowledgedAt,
      emailVerifiedAt: participants.emailVerifiedAt,
      emailConfirmedAt: registrations.emailConfirmedAt,
      waitlistedAt: registrations.waitlistedAt,
      offerCreatedAt: registrations.offerCreatedAt,
      holdExpiresAt: registrations.holdExpiresAt,
      emailLinkExpiresAt: registrations.emailLinkExpiresAt,
      // «Până când» (§650): an offer whose first email is still queued has not lapsed (§520) — one correlated `EXISTS`.
      offerEmailQueued: offerEmailQueuedAt(now),
      declarationAcceptedAt: latestDeclarationAcceptedAt,
      cancelledAt: registrations.cancelledAt,
      cancelReasonKind: registrations.cancelReasonKind,
      cancelReason: registrations.cancelReason,
      expiredAt: registrations.expiredAt,
      expiryReason: registrations.expiryReason,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    // The event's start and clock, for «Vârstă» (§660): one primary-key probe per row.
    .innerJoin(events, eq(events.id, registrations.eventId))
    .leftJoin(
      eventTranslations,
      and(
        eq(eventTranslations.eventId, registrations.eventId),
        eq(eventTranslations.locale, registrations.locale),
      ),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .$dynamic();

  if (!page) return query.orderBy(desc(registrations.submittedAt));

  /*
    `submitted_at` breaks every tie. Sorting by status alone leaves rows in whatever order the
    plan happens to produce, and PostgreSQL is free to return a different one for page 2 than it
    did for page 1 — so a row can appear twice, or never, purely from paging. A total order is
    what makes `LIMIT`/`OFFSET` mean anything.
  */
  return query
    .orderBy(registrationOrderBy(page.sort, page.dir, now), desc(registrations.submittedAt), asc(registrations.id))
    .limit(page.limit)
    .offset(page.offset);
}

/**
 * How many of each state, for the strip above the list (`DECISIONS.md` §246; the owner: "on
 * the registrations tab I should have a counter… but I wanna make sure it's performant and
 * light on the DB").
 *
 * **One query, and it is the cheapest shape there is**: one grouped scan of the rows the
 * filters already narrow to — the same `WHERE` the list and the pager use — rather than one
 * count per state, which is what a strip of five numbers invites. The page therefore costs one
 * round trip more than it did, not five, and the club stops doing the arithmetic by filtering
 * the list five times.
 *
 * Real and test are counted apart, as the email forecast counts them (§12.6): a synthetic
 * runner is never inside a number the club is given, and hiding the test rows entirely would
 * make the strip disagree with the list underneath it, which does show them.
 */
export type RegistrationSummary = {
  /** Real registrations by state; a state nobody is in is absent. */
  byStatus: Partial<Record<RegistrationStatus, number>>;
  /** Real registrations in any state — what the club means by "how many have signed up". */
  real: number;
  /** Test registrations in any state (§12.6): shown apart, and only when there are any. */
  test: number;
  /**
   * Real registrations seated «În afara locurilor» (§643), in any state — counted in `real` and
   * `byStatus` like anybody (they are registrations), and apart here, as the strip's own pill.
   */
  outside: number;
};

export async function summariseRegistrationsForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  filters: RegistrationListFilters = {},
): Promise<RegistrationSummary> {
  const conditions = registrationConditions(filters, filters.clubMember || filters.memberBibAsked ? await membersFor(db, filters) : []);

  const rows = await db
    .select({ status: registrations.status, kind: registrations.kind, outside: registrations.outsideCapacity, total: count() })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .leftJoin(
      eventTranslations,
      and(
        eq(eventTranslations.eventId, registrations.eventId),
        eq(eventTranslations.locale, registrations.locale),
      ),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(registrations.status, registrations.kind, registrations.outsideCapacity);

  const summary: RegistrationSummary = { byStatus: {}, real: 0, test: 0, outside: 0 };
  for (const row of rows) {
    if (row.kind === "TEST") {
      summary.test += row.total;
      continue;
    }
    summary.real += row.total;
    if (row.outside) summary.outside += row.total;
    summary.byStatus[row.status] = (summary.byStatus[row.status] ?? 0) + row.total;
  }
  return summary;
}

/** How many times the form was filled again for one registration, and when last (§312). */
export type ResubmissionMark = { count: number; lastAt: Date };

/**
 * The "Reînscriere ×2" chip for the rows on one page of the list (§312), in **one grouped
 * query** over the audit trail — never a query per row, and never a column on every row of the
 * export, which has no use for it.
 *
 * Keyed on the row ids the page already fetched, so it reads exactly the rows on screen and
 * rides the `(entity_type, entity_id, created_at)` index the registration's own timeline uses.
 * A `TEST` row is marked like any other (§12.6 forbids a difference in behaviour, and a marker
 * is not a count); nothing here feeds the summary strip, which counts people, not attempts.
 */
export async function listResubmissionMarks<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationIds: readonly string[],
): Promise<Map<string, ResubmissionMark>> {
  const marks = new Map<string, ResubmissionMark>();
  if (registrationIds.length === 0) return marks;

  const rows = await db
    .select({
      registrationId: auditLogs.entityId,
      total: count(),
      lastAt: max(auditLogs.createdAt),
    })
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.entityType, "registration"),
        eq(auditLogs.action, "registration.resubmitted"),
        inArray(auditLogs.entityId, [...registrationIds]),
      ),
    )
    .groupBy(auditLogs.entityId);

  for (const row of rows) {
    if (row.registrationId && row.lastAt) marks.set(row.registrationId, { count: row.total, lastAt: row.lastAt });
  }
  return marks;
}

/**
 * How many rows match, which is not the same question as which rows to show.
 *
 * The pager needs the total and the page needs 25 rows; asking one query for both would mean
 * loading the season to count it, which is exactly what server-side pagination exists to avoid.
 */
export async function countRegistrationsForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  filters: RegistrationListFilters = {},
): Promise<number> {
  const conditions = registrationConditions(filters, filters.clubMember || filters.memberBibAsked ? await membersFor(db, filters) : []);

  const [row] = await db
    .select({ total: count() })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .leftJoin(
      eventTranslations,
      and(
        eq(eventTranslations.eventId, registrations.eventId),
        eq(eventTranslations.locale, registrations.locale),
      ),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return row?.total ?? 0;
}

export type RegistrationDetail = {
  id: string;
  status: RegistrationStatus;
  kind: RegistrationKind;
  /** «În afara locurilor» (§643): read by every role that reads the page, changed by the Administrator only. */
  outsideCapacity: boolean;
  /** PUBLIC when the participant submitted it, STAFF when an organizer entered it for them. */
  source: RegistrationSource;
  registeredName: string;
  /** The optional socials (§106), as typed; null when not given. */
  stravaUrl: string | null;
  instagramHandle: string | null;
  /** Whether the public list prints them beside the name (§500): the runner's own tick, as kept. */
  listSocials: boolean;
  /** «Oferte și beneficii» (§562): the person's own consent, and the moment of the tick or the last change. */
  promoConsent: boolean;
  promoConsentAt: Date | null;
  /** The parent or guardian of a minor (§108); null for an adult. */
  guardianName: string | null;
  /** Where the person lives (§510): the country's ISO code (never null, `RO` by default) and the city as typed. */
  country: string | null;
  city: string | null;
  /**
   * The sex as stored (§554): one of the two answers, or none — a staff entry left blank, or the
   * retired `UNSPECIFIED` of a row stored before it went, which the page shows as «—» (`sexShown`).
   */
  sex: RegistrationSex | null;
  /** The T-shirt size as stored, and whether the event gives one (§554): the page shows it only then. */
  tshirtSize: RegistrationTshirtSize | null;
  eventKitShirt: boolean;
  /** Whether the event asks the health note (§557): the emergency section's button names the note only then. */
  eventAsksHealthNote: boolean;
  /** «Folosește lista ascunsă» (§647): the page draws the hidden list's radio only then, or for a row already on it. */
  eventHiddenListEnabled: boolean;
  /** The registration's language, as on the list row: the declaration translation it signs (§330). */
  locale: Locale;
  participantEmail: string;
  /** The address (§389): the family marker names the other rows of it at the event (§543). */
  participantId: string;
  eventId: string;
  eventTitle: string | null;
  clubMemberDeclared: boolean;
  /** «Membru (verificat)» (§662), as on the list row. */
  memberVerified: boolean;
  /** «Vreau numărul de membru» (§664) as stored, and whether the event offers the members' bib now. */
  memberBibWanted: boolean;
  eventOffersMemberBib: boolean;
  submittedAt: Date;
  emailConfirmedAt: Date | null;
  waitlistedAt: Date | null;
  offerCreatedAt: Date | null;
  holdExpiresAt: Date | null;
  /** When the first email's link lapses (§377), for the timeline's «Linkul din email expiră» on a row still waiting for it (§635). */
  emailLinkExpiresAt: Date | null;
  /** The offer's `WAITLIST_SPOT_OFFER` still queued (§520): past its stored deadline it has not lapsed (§650, `rowDeadlineOf`). */
  offerEmailQueued?: boolean;
  /** The event's clock: «Ce îi spui» says an instant as the participant's own page does (§654). */
  eventTimezone: string;
  /** The event is cancelled: «Ce îi spui» says the cancellation rather than a deadline (§654). */
  eventCancelled: boolean;
  /** «Ofertele din lista de așteptare pleacă automat» (§615) and «Arată public câți așteaptă» (§634), for the waiting sentence. */
  waitlistAutoOffer: boolean;
  waitlistCountPublic: boolean;
  /** «Arată public numărătoarea» (§668): «Arată public câți așteaptă» sits under it (§669), so off it keeps the length private too. */
  participantCountPublic: boolean;
  /** Where a waiting row stands and how long the line is (§629): null unless `WAITLISTED` on an event not cancelled. */
  waitlistPosition: number | null;
  waitlistLength: number | null;
  /** When the live link the row's state waits on lapses — address, declaration or offer (§654); null when none is alive. */
  liveLinkExpiresAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationSource: string | null;
  /** Why the participant cancelled (§558): the timeline's line under «Anulată». Null on a staff cancellation. */
  cancelReasonKind: RegistrationCancelReasonKind | null;
  cancelReason: string | null;
  expiredAt: Date | null;
  expiryReason: string | null;
  /** Race day (BR-REQ-037-07, BR-REQ-037-08, BR-REQ-038-01). */
  bibNumber: number | null;
  /** Whether the settled number is on paper (§264): what the cancel confirmation warns about, and what a cancelled row's chip says (§311). */
  bibPrintedAt: Date | null;
  checkinCode: string | null;
  checkedInAt: Date | null;
  /** Null when the participant checked themselves in, or the staff row is gone. */
  checkedInByName: string | null;
  /** Who vouched for the address at the desk, when nobody clicked a link. */
  emailConfirmedByName: string | null;
  /**
   * The registration's one email state (§NNN, amending §663) — with the provider's code and redacted words
   * for the page's small print, which only this page reads; null when the participant's mail has no open refusal.
   */
  emailState: RegistrationEmailStateDetail | null;
  /** For "send the reminder": only while the event is ahead (§81). */
  eventStartsAt: Date;
  /** When the current cycle began (`privacy_acknowledged_at`, rewritten on a restart); §145. */
  cycleStartedAt: Date;
  /**
   * The two legal texts this cycle's form was sent under (§425): the privacy notice every
   * registration acknowledges (its moment is `cycleStartedAt`), and the terms accepted expressly
   * (§421) — null on a staff or desk entry, whose paper carries them, and on a row sent before
   * the column existed.
   */
  privacyNoticeVersion: number;
  termsVersion: number | null;
  termsAcceptedAt: Date | null;
  /** The participant's own click (any event); staff vouching is `emailConfirmedAt`. */
  emailVerifiedAt: Date | null;
  /** The latest declaration acceptance, online or on paper; the journey's fourth step (§145). */
  declarationAcceptedAt: Date | null;
  /**
   * Whether a health note (or its consent) is on the row — a boolean, computed in SQL, so the
   * note itself never rides along with the page's main query (§322). What the withdrawal panel
   * reads to know whether there is anything to withdraw.
   */
  holdsHealthNote: boolean;
  /** The results consent (BR-REQ-072-01), no longer asked (§322) but withdrawable where given. */
  resultsNameConsent: boolean;
  /** For the link to everything held about this person (§322): the identity it is looked up by. */
  participantCanonicalEmail: string;
};

const checkedInBy = alias(staffUsers, "checked_in_by");
const emailConfirmedBy = alias(staffUsers, "email_confirmed_by");



export async function findRegistrationDetailForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
  now: Date = new Date(),
): Promise<RegistrationDetail | undefined> {
  const members = [...(await memberCanonicalEmails(db))];
  const [row] = await db
    .select({
      bibNumber: registrations.bibNumber,
      bibPrintedAt: registrations.bibPrintedAt,
      checkinCode: registrations.checkinCode,
  idDocument: latestIdDocument,
      checkedInAt: registrations.checkedInAt,
      checkedInByName: checkedInBy.displayName,
      emailConfirmedByName: emailConfirmedBy.displayName,
      emailState: registrationEmailStateDetailSql(),
      eventStartsAt: events.startsAt,
      id: registrations.id,
      status: registrations.status,
      kind: registrations.kind,
      outsideCapacity: registrations.outsideCapacity,
      source: registrations.source,
      registeredName: registrations.registeredName,
      participantEmail: participants.deliveryEmail,
      participantId: registrations.participantId,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      clubMemberDeclared: registrations.clubMemberDeclared,
      memberVerified: memberVerifiedOf(members),
      memberBibWanted: registrations.memberBibWanted,
      eventOffersMemberBib: OFFERS_MEMBER_BIB,
      fitnessDeclaredAt: registrations.fitnessDeclaredAt,
      stravaUrl: registrations.stravaUrl,
      instagramHandle: registrations.instagramHandle,
      listSocials: registrations.listSocials,
      promoConsent: registrations.promoConsent,
      promoConsentAt: registrations.promoConsentAt,
      guardianName: registrations.guardianName,
      country: registrations.country,
      city: registrations.city,
      sex: registrations.sex,
      tshirtSize: registrations.tshirtSize,
      eventKitShirt: events.kitShirt,
      eventAsksHealthNote: events.askHealthNote,
      eventHiddenListEnabled: events.hiddenListEnabled,
      locale: registrations.locale,
      submittedAt: registrations.submittedAt,
      emailConfirmedAt: registrations.emailConfirmedAt,
      waitlistedAt: registrations.waitlistedAt,
      offerCreatedAt: registrations.offerCreatedAt,
      holdExpiresAt: registrations.holdExpiresAt,
      emailLinkExpiresAt: registrations.emailLinkExpiresAt,
      // The timeline's deadline (§650): an offer whose first email is still queued has not lapsed (§520).
      offerEmailQueued: offerEmailQueuedAt(now),
      // «Ce îi spui» (§654): the event's clock, whether it is cancelled, the line's two settings and numbers, the live link.
      eventTimezone: events.timezone,
      eventCancelled: sql<boolean>`(${events.eventStatus} = 'CANCELLED')`.mapWith(Boolean),
      waitlistAutoOffer: events.waitlistAutoOffer,
      waitlistCountPublic: events.waitlistCountPublic,
      participantCountPublic: events.participantCountPublic,
      waitlistPosition: waitlistPositionOfRow,
      waitlistLength: waitlistLengthOfRow,
      liveLinkExpiresAt: liveLinkExpiresAtFor(now),
      confirmedAt: registrations.confirmedAt,
      cancelledAt: registrations.cancelledAt,
      cancellationSource: registrations.cancellationSource,
      cancelReasonKind: registrations.cancelReasonKind,
      cancelReason: registrations.cancelReason,
      expiredAt: registrations.expiredAt,
      expiryReason: registrations.expiryReason,
      cycleStartedAt: registrations.privacyAcknowledgedAt,
      privacyNoticeVersion: registrations.privacyNoticeVersion,
      termsVersion: registrations.termsVersion,
      termsAcceptedAt: registrations.termsAcceptedAt,
      emailVerifiedAt: participants.emailVerifiedAt,
      declarationAcceptedAt: latestDeclarationAcceptedAt,
      holdsHealthNote: sql<boolean>`(${registrations.healthNotes} IS NOT NULL OR ${registrations.healthConsentAt} IS NOT NULL)`.mapWith(Boolean),
      resultsNameConsent: registrations.resultsNameConsent,
      participantCanonicalEmail: participants.canonicalEmail,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .innerJoin(events, eq(events.id, registrations.eventId))
    .leftJoin(
      eventTranslations,
      and(
        eq(eventTranslations.eventId, registrations.eventId),
        eq(eventTranslations.locale, registrations.locale),
      ),
    )
    .leftJoin(checkedInBy, eq(checkedInBy.id, registrations.checkedInByStaffUserId))
    .leftJoin(emailConfirmedBy, eq(emailConfirmedBy.id, registrations.emailConfirmedByStaffUserId))
    .where(eq(registrations.id, id))
    .limit(1);

  return row;
}

/**
 * The four things somebody needs when a runner is on the ground (§322): how to reach them,
 * whom to call instead, and what the medical team should know.
 *
 * **Its own query, for its own section, and nowhere else.** The registration's detail query
 * above does not carry these columns, so no other part of that page — and no page that reuses
 * that query — can render them by accident; the desk's `DESK_COLUMNS` below never will
 * (`AGENTS.md` §15.11: a name, a state and a number). The export leaves all four out
 * (`csv.ts`, `workbook.ts`). The one caller asserts the role and writes the audit row first
 * (`admin-service.ts#readEmergencyDetails`).
 */
export type EmergencyDetails = {
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  /** The note, only when the event asks it (§557): null for any other event, whatever the row holds. */
  healthNotes: string | null;
  /** When the health consent was given — shown beside the note, so it reads as consented. */
  healthConsentAt: Date | null;
  /** Whether the event asks the health note (§557, «Informații medicale»): the page shows the line only then. */
  eventAsksHealthNote: boolean;
};

/**
 * The health note as a screen may show it (§557): only for an event that asks it. A note stored
 * before the tick came off stays on the row until the seven-day purge, and no screen reads it.
 */
function gatedHealth<R extends { healthNotes: string | null; healthConsentAt: Date | null; eventAsksHealthNote: boolean }>(row: R): R {
  const healthNotes = healthNoteShown(row.eventAsksHealthNote, row.healthNotes);
  return { ...row, healthNotes, healthConsentAt: healthNotes ? row.healthConsentAt : null };
}

export async function findEmergencyDetails<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<EmergencyDetails | undefined> {
  const [row] = await db
    .select({
      phone: registrations.phone,
      emergencyContactName: registrations.emergencyContactName,
      emergencyContactPhone: registrations.emergencyContactPhone,
      healthNotes: registrations.healthNotes,
      healthConsentAt: registrations.healthConsentAt,
      eventAsksHealthNote: events.askHealthNote,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(eq(registrations.id, registrationId))
    .limit(1);
  return row ? gatedHealth(row) : undefined;
}

/**
 * One event's emergency sheet (§322): everyone confirmed — checked in or not, since a runner
 * who has not reached the desk is still on the course — with the four details and the race
 * number, in number order and then by name, so the sheet reads like the start list.
 *
 * `REAL` rows only, as the export (§30): the sheet is printed and carried, and a synthetic
 * runner on paper is a phone number nobody should ring. The health column is simply empty after
 * the seven-day clearing, which is what `jobs/retention.ts` does to the row.
 */
export type EmergencySheetRow = EmergencyDetails & {
  id: string;
  registeredName: string;
  bibNumber: number | null;
  checkedInAt: Date | null;
};

export async function listEmergencySheet<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<EmergencySheetRow[]> {
  const rows = await db
    .select({
      id: registrations.id,
      registeredName: registrations.registeredName,
      bibNumber: registrations.bibNumber,
      checkedInAt: registrations.checkedInAt,
      phone: registrations.phone,
      emergencyContactName: registrations.emergencyContactName,
      emergencyContactPhone: registrations.emergencyContactPhone,
      healthNotes: registrations.healthNotes,
      healthConsentAt: registrations.healthConsentAt,
      eventAsksHealthNote: events.askHealthNote,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, "CONFIRMED"), eq(registrations.kind, "REAL")))
    .orderBy(
      sql`${registrations.bibNumber} asc nulls last`,
      asc(registrations.registeredName),
      asc(registrations.id),
    );
  return rows.map(gatedHealth);
}

/**
 * The extra columns the spreadsheet carries (§322): sex, the age on race day, where the runner is
 * from, and the t-shirt size — what a category ranking, the club's "where do our runners come
 * from" and the kit order need. The age, the country and the city are also the list's own
 * «Vârstă» and «Oraș» and the CSV's last columns since §660; sex, citizenship and the t-shirt stay
 * the spreadsheet's alone. One query for the exported ids.
 */
export type WorkbookDetails = {
  id: string;
  sex: "FEMALE" | "MALE" | "UNSPECIFIED" | null;
  birthDate: string | null;
  nationality: string | null;
  /** Where the person lives (§510); null on a row written before the form asked it. */
  country: string | null;
  city: string | null;
  tshirtSize: "NONE" | "XS" | "S" | "M" | "L" | "XL" | "XXL" | null;
  /** Whether the event gives a T-shirt (§554): the sheet prints the size only then. */
  eventKitShirt: boolean;
  eventStartsAt: Date;
  /** The event's own zone: race day is the day on the start line's clock (§321). */
  eventTimezone: string;
};

export async function listWorkbookDetails<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationIds: readonly string[],
): Promise<Map<string, WorkbookDetails>> {
  if (registrationIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: registrations.id,
      sex: registrations.sex,
      birthDate: registrations.birthDate,
      nationality: registrations.nationality,
      country: registrations.country,
      city: registrations.city,
      tshirtSize: registrations.tshirtSize,
      eventKitShirt: events.kitShirt,
      eventStartsAt: events.startsAt,
      eventTimezone: events.timezone,
    })
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .where(inArray(registrations.id, [...registrationIds]));
  return new Map(rows.map((row) => [row.id, row]));
}

/** The declaration a registration's latest acceptance was signed against (§499): its version and when. */
export type LatestDeclarationAcceptance = { version: number; acceptedAt: Date };

/**
 * The latest declaration acceptance of each exported registration (§499), for the export's two
 * declaration columns: one query for the lot, newest first, the first per registration kept — the
 * same "latest" the signed PDF is drawn from (`findSignedDeclaration`). A registration with no
 * acceptance is absent from the map, which the file prints as two blank cells.
 */
export async function listLatestDeclarationAcceptances<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationIds: readonly string[],
): Promise<Map<string, LatestDeclarationAcceptance>> {
  if (registrationIds.length === 0) return new Map();
  const rows = await db
    .select({
      registrationId: declarationAcceptances.registrationId,
      version: declarationAcceptances.declarationVersion,
      acceptedAt: declarationAcceptances.acceptedAt,
    })
    .from(declarationAcceptances)
    .where(inArray(declarationAcceptances.registrationId, [...registrationIds]))
    .orderBy(desc(declarationAcceptances.acceptedAt));
  const latest = new Map<string, LatestDeclarationAcceptance>();
  for (const row of rows) if (!latest.has(row.registrationId)) latest.set(row.registrationId, { version: row.version, acceptedAt: row.acceptedAt });
  return latest;
}

/**
 * What the desk sees (BR-REQ-037-08): one registration as a volunteer needs it to hand over a
 * number — name, status, number, check-in state — and nothing more. No address, no details.
 * Open to every staff role, which is why the selection is this narrow.
 */
export type DeskRegistration = {
  id: string;
  /** The address's row id — never the address itself (§15.11): the family marker groups by it (§543). */
  participantId: string;
  status: RegistrationStatus;
  kind: RegistrationKind;
  registeredName: string;
  /** The parent or guardian of a minor (§108): who the kit goes to; null for an adult. */
  guardianName: string | null;
  /**
   * The registration's language: the declaration translation its paper confirmation binds to,
   * and so whether a minor's paper carries the minor's signature too (§330). A language, never
   * an address (`AGENTS.md` §15.11).
   */
  locale: Locale;
  eventId: string;
  eventTitle: string | null;
  eventStartsAt: Date;
  /** The event's own zone, which the desk reads its date in (§349). */
  eventTimezone: string;
  bibNumber: number | null;
  /**
   * Whether the settled number is on paper (§264), and when the row left the live states
   * (§311). Together they are what the desk says in red about a cancelled or expired runner
   * who turns up anyway: the state, the date, and — when it exists — that a printed bib with
   * this number is in the pile and is not to be handed out. A state and a number, never an
   * address (`AGENTS.md` §15.11).
   */
  bibPrintedAt: Date | null;
  cancelledAt: Date | null;
  expiredAt: Date | null;
  /** Null until confirmed. */
  checkinCode: string | null;
  checkedInAt: Date | null;
  checkedInByName: string | null;
  /**
   * The desk sees whom an email does not reach (`DECISIONS.md` §76, §663, §NNN) — which, when and why: its own
   * projection, never the address and never the provider's words (§67, `AGENTS.md` §15.11).
   */
  emailState: DeskEmailState | null;
  /** When the address was confirmed, so the desk's words say whether the rejection came after it (§663). */
  emailConfirmedAt: Date | null;
  /** The declarant's document, and a minor's own beside it (§95, §330; `identityDocumentsOf`). */
  idDocument: string | null;
  minorIdDocument: string | null;
};

const DESK_COLUMNS = {
  id: registrations.id,
  participantId: registrations.participantId,
  status: registrations.status,
  kind: registrations.kind,
  registeredName: registrations.registeredName,
  guardianName: registrations.guardianName,
  locale: registrations.locale,
  eventId: registrations.eventId,
  eventTitle: eventTranslations.title,
  eventStartsAt: events.startsAt,
  eventTimezone: events.timezone,
  bibNumber: registrations.bibNumber,
  bibPrintedAt: registrations.bibPrintedAt,
  cancelledAt: registrations.cancelledAt,
  expiredAt: registrations.expiredAt,
  checkinCode: registrations.checkinCode,
  idDocument: latestIdDocument,
  minorIdDocument: latestMinorIdDocument,
  checkedInAt: registrations.checkedInAt,
  checkedInByName: checkedInBy.displayName,
  emailState: deskEmailStateSql(),
  emailConfirmedAt: registrations.emailConfirmedAt,
};

function deskQuery<T extends Record<string, unknown>>(db: Database<T>, locale: Locale) {
  return db
    .select(DESK_COLUMNS)
    .from(registrations)
    .innerJoin(events, eq(events.id, registrations.eventId))
    .leftJoin(
      eventTranslations,
      and(eq(eventTranslations.eventId, registrations.eventId), eq(eventTranslations.locale, locale)),
    )
    .leftJoin(checkedInBy, eq(checkedInBy.id, registrations.checkedInByStaffUserId));
}

/** The QR, scanned or typed: one registration, from any event. */
export async function findRegistrationByCheckinCode<T extends Record<string, unknown>>(
  db: Database<T>,
  code: string,
  locale: Locale,
): Promise<DeskRegistration | undefined> {
  const [row] = await deskQuery(db, locale).where(eq(registrations.checkinCode, code)).limit(1);
  return row;
}

/**
 * The desk's search within one event: a name fragment or a race number. Everything that is
 * not over — a pending registration is shown so it can be confirmed on the spot, which is
 * what "no email arrived" comes down to at a desk — and never a cancelled or expired one,
 * **except by its number**: the one exception BR-REQ-037-08 criterion 4 names (§311). Capped,
 * because a desk reads a screenful and a race has at most a few hundred entries.
 */
export async function listDeskRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { eventId: string; query: string; locale: Locale },
): Promise<DeskRegistration[]> {
  const q = input.query.trim();
  const conditions: SQL[] = [eq(registrations.eventId, input.eventId)];
  if (/^\d{1,5}$/.test(q)) {
    /*
      The number a runner wears — confirmed, and that is the one place the desk's search reads a
      cancelled or expired row too (§311, the exception BR-REQ-037-08 criterion 4 names). A number
      is never reused (§173), so "who is 27" has exactly one answer at this event even after 27
      cancelled — and a volunteer holding the bib that somebody just handed over, typing its number
      and being told "nobody matches", is the surprise this exists to prevent. The row they get
      says, in red, why nothing is to be handed out. A row not confirmed shows no number (§548,
      `raceNumberOf`), so it never answers to one either.
    */
    const number = Number(q);
    conditions.push(
      sql`(${registrations.bibNumber} = ${number} AND ${registrations.status} IN ('CONFIRMED', 'CANCELLED', 'EXPIRED'))`,
    );
  } else {
    conditions.push(sql`${registrations.status} NOT IN ('CANCELLED', 'EXPIRED')`);
    if (q !== "") {
      // The same diacritics-blind contains-match as the list: the desk types what it hears.
      conditions.push(
        sql`${foldedName(registrations.registeredName)} LIKE ${`%${escapeLike(foldTerm(q))}%`} ESCAPE '\\'`,
      );
    }
  }
  return deskQuery(db, input.locale)
    .where(and(...conditions))
    .orderBy(asc(registrations.registeredName), asc(registrations.id))
    .limit(200);
}

/** The numbers the organizer watches during pickup. */
export async function countDesk<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<{ confirmed: number; checkedIn: number; withoutBib: number; pending: number }> {
  const [row] = await db
    .select({
      confirmed: sql<number>`count(*) FILTER (WHERE ${registrations.status} = 'CONFIRMED')`.mapWith(Number),
      checkedIn: sql<number>`count(*) FILTER (WHERE ${registrations.checkedInAt} IS NOT NULL)`.mapWith(Number),
      // Confirmed and wearing no number: a gap «Alocă numerele» fills (§548).
      withoutBib: sql<number>`count(*) FILTER (WHERE ${registrations.status} = 'CONFIRMED' AND ${registrations.bibNumber} IS NULL)`.mapWith(Number),
      pending: sql<number>`count(*) FILTER (WHERE ${registrations.status} NOT IN ('CONFIRMED', 'CANCELLED', 'EXPIRED'))`.mapWith(Number),
    })
    .from(registrations)
    // Real rows only (§30, AGENTS.md §12.6; §420): a test registration is omitted from every count
    // the club is given. The desk list still shows it, labelled; its counters do not add it.
    .where(and(eq(registrations.eventId, eventId), eq(registrations.kind, "REAL")));
  return row ?? { confirmed: 0, checkedIn: 0, withoutBib: 0, pending: 0 };
}

export type DeclarationAcceptanceRow = {
  /** `PAPER` carries the name of the staff member who recorded it (BR-REQ-037-07). */
  method: "EMAIL_LINK" | "PAPER";
  attestedByName: string | null;
  acceptedAt: Date;
  /** The declarant's signature and document: the adult's, or the parent's for a minor. */
  typedName: string;
  idDocument: string | null;
  /** The minor's own, beside the parent's (§330); null for an adult and for older acceptances. */
  minorTypedName: string | null;
  minorIdDocument: string | null;
  declarationVersion: number;
  /** The row's id: what the hold's form names (§556). */
  id: string;
  /** The SHA-256 of the exact text signed (§556); null on a row from before it. */
  textHash: string | null;
  /** «Păstrează: reclamație / litigiu în curs» (§556): whether, why, when and by whom. */
  retentionHold: boolean;
  retentionHoldReason: string | null;
  retentionHoldAt: Date | null;
  retentionHoldByName: string | null;
};

const holdBy = alias(staffUsers, "retention_hold_by");

export async function listDeclarationAcceptances<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<DeclarationAcceptanceRow[]> {
  return db
    .select({
      id: declarationAcceptances.id,
      textHash: declarationAcceptances.textHash,
      retentionHold: declarationAcceptances.retentionHold,
      retentionHoldReason: declarationAcceptances.retentionHoldReason,
      retentionHoldAt: declarationAcceptances.retentionHoldAt,
      retentionHoldByName: holdBy.displayName,
      acceptedAt: declarationAcceptances.acceptedAt,
      typedName: declarationAcceptances.typedName,
      idDocument: declarationAcceptances.idDocument,
      minorTypedName: declarationAcceptances.minorTypedName,
      minorIdDocument: declarationAcceptances.minorIdDocument,
      declarationVersion: declarationAcceptances.declarationVersion,
      method: declarationAcceptances.method,
      attestedByName: staffUsers.displayName,
    })
    .from(declarationAcceptances)
    .leftJoin(staffUsers, eq(staffUsers.id, declarationAcceptances.attestedByStaffUserId))
    .leftJoin(holdBy, eq(holdBy.id, declarationAcceptances.retentionHoldByStaffUserId))
    .where(eq(declarationAcceptances.registrationId, registrationId))
    .orderBy(desc(declarationAcceptances.acceptedAt));
}

export type OutboxHistoryRow = {
  messageType: string;
  status: string;
  isManualResend: boolean;
  /** The club's copy of the participant's message (§320), labelled so it does not read as a second send to them. */
  clubCopy: boolean;
  /**
   * Whom the row's message was for, by role and never by address (§NNN): the participant, the club's
   * archive copy (§99, §393), the club's confirmation notice (§245), or a club copy (§320).
   */
  recipientRole: "participant" | "archive" | "notice" | "copy";
  createdAt: Date;
  sentAt: Date | null;
  /** Which road it left by (§443): Gmail reports no delivery. */
  transport: "mailgun" | "gmail" | null;
  /** The provider's facts after it left (§NNN): delivered, refused and when, why. */
  deliveredAt: Date | null;
  rejectedAt: Date | null;
  rejectionCause: RejectionCause | null;
  /** The receiving server's code and its redacted words — on a refused row only; for a refusal at the send, the stored answer. */
  providerCode: string | null;
  providerDetail: string | null;
  /** What came after a refusal (`notifications/delivery-facts.ts`). */
  laterDeliveredAt: Date | null;
  resolvedAt: Date | null;
  retriedAt: Date | null;
};

function recipientRoleOf(messageType: string, clubCopy: boolean): OutboxHistoryRow["recipientRole"] {
  if (clubCopy) return "copy";
  if (messageType === "DECLARATION_ARCHIVE" || messageType === "GROUP_RUN_DECLARATION_ARCHIVE") return "archive";
  if (messageType === "CLUB_CONFIRMATION_NOTICE") return "notice";
  return "participant";
}

export async function listOutboxHistory<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<OutboxHistoryRow[]> {
  const refused = sql`${emailOutbox.status} in ('BOUNCED', 'COMPLAINED')`;
  const rows = await db
    .select({
      messageType: emailOutbox.messageType,
      status: emailOutbox.status,
      isManualResend: emailOutbox.isManualResend,
      clubCopy: sql<boolean>`(${emailOutbox.payloadJson} ->> 'clubCopy') IS NOT DISTINCT FROM 'true'`.mapWith(Boolean),
      createdAt: emailOutbox.createdAt,
      sentAt: emailOutbox.sentAt,
      transport: emailOutbox.transport,
      deliveredAt: emailOutbox.deliveredAt,
      rejectedAt: emailOutbox.rejectedAt,
      rejectionCause: emailOutbox.rejectionCause,
      providerCode: emailOutbox.providerCode,
      providerDetail: sql<string | null>`case when ${refused} then coalesce(${emailOutbox.providerDetail}, ${emailOutbox.lastError}) end`,
      laterDeliveredAt: emailOutbox.laterDeliveredAt,
      resolvedAt: emailOutbox.resolvedAt,
      retriedAt: emailOutbox.retriedAt,
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.registrationId, registrationId))
    .orderBy(asc(emailOutbox.createdAt));
  return rows.map((row) => ({
    ...row,
    recipientRole: recipientRoleOf(row.messageType, row.clubCopy),
    rejectionCause: isRejectionCause(row.rejectionCause) ? row.rejectionCause : null,
  }));
}

/** Events with at least one registration, for the list page's filter — Admin has no reason to
 * see events nobody has registered for on this screen; the CMS already lists all of them. */
export async function listEventsWithRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<Array<{ id: string; title: string | null; featured: boolean; membersOnly: boolean }>> {
  return db
    // `membersOnly` (§552): the list's «Membri» chip on an event for the members alone.
    .selectDistinct({ id: events.id, title: eventTranslations.title, featured: events.featured, membersOnly: events.membersOnly })
    .from(events)
    .innerJoin(registrations, eq(registrations.eventId, events.id))
    .leftJoin(
      eventTranslations,
      and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, registrations.locale)),
    )
    .orderBy(asc(eventTranslations.title));
}

/**
 * The events an Administrator can enter a registration against (BR-REQ-037-05).
 *
 * `registration_mode = INTERNAL` is the whole filter: an event registered elsewhere or not at
 * all has no queue here to put anybody in, and offering it in the list would produce a form
 * whose only possible outcome is the allocator refusing it. Ordered soonest first, because the
 * one somebody is asking about at a desk is almost always the next one.
 */
export async function listEventsAcceptingRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: "ro" | "en",
): Promise<Array<{ id: string; title: string | null; startsAt: Date; timezone: string; minAge: number; offersMemberBib: boolean }>> {
  return db
    .select({
      id: events.id,
      title: eventTranslations.title,
      startsAt: events.startsAt,
      timezone: events.timezone,
      // Beside each name on the staff form ("14+"), so the volunteer knows which minimum the
      // birth date is counted against before pressing (§329).
      minAge: events.minAge,
      // Whether the staff form asks «Vreau numărul de membru» (§664), read as `readBibDesign` reads it.
      offersMemberBib: OFFERS_MEMBER_BIB,
    })
    .from(events)
    .leftJoin(
      eventTranslations,
      and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)),
    )
    .where(and(eq(events.registrationMode, "INTERNAL"), eq(events.eventStatus, "SCHEDULED")))
    .orderBy(asc(events.startsAt));
}

/** Whether the chosen event is over (§82): the desk then shows the rows and no buttons. */
export async function isEventCompleted<T extends Record<string, unknown>>(db: Database<T>, eventId: string): Promise<boolean> {
  const [row] = await db.select({ eventStatus: events.eventStatus }).from(events).where(eq(events.id, eventId)).limit(1);
  return row?.eventStatus === "COMPLETED";
}

/**
 * The events a desk can be working (BR-REQ-037-08): local registration, not cancelled, and
 * happening between yesterday and a month from now — the ones somebody could be picking up a
 * number for. The most recent past one first, because on race morning that is today's.
 */
export async function listEventsForDesk<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
  now: Date,
): Promise<Array<{ id: string; title: string | null; startsAt: Date; timezone: string }>> {
  const from = new Date(now.getTime() - 2 * 24 * 60 * 60_000);
  const to = new Date(now.getTime() + 31 * 24 * 60 * 60_000);
  return db
    .select({
      id: events.id,
      title: eventTranslations.title,
      startsAt: events.startsAt,
      timezone: events.timezone,
    })
    .from(events)
    .leftJoin(
      eventTranslations,
      and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)),
    )
    .where(
      and(
        eq(events.registrationMode, "INTERNAL"),
        eq(events.eventStatus, "SCHEDULED"),
        sql`${events.startsAt} BETWEEN ${from} AND ${to}`,
      ),
    )
    .orderBy(asc(events.startsAt));
}

/**
 * One event's active registrations for the queue panel (`DECISIONS.md` §92): confirmed and
 * holds first, then the waiting list in exactly the order `lockOldestWaitlisted` serves it —
 * oldest `waitlisted_at` first, `id` breaking a tie — so the panel's numbering is a promise.
 */
/**
 * Which of the three terms lines the registration's page shows (§425): the version accepted
 * expressly on the form, the paper note for a staff or desk entry, or "no version recorded" for
 * a row sent before the column existed. Pulled out of the page's JSX so a unit test can pick
 * each branch without a browser.
 */
export type TermsLineKind =
  | { readonly kind: "accepted"; readonly version: number; readonly acceptedAt: Date | null }
  | { readonly kind: "onPaper" }
  | { readonly kind: "notRecorded" };

export function termsLineKindFor(registration: {
  termsVersion: number | null;
  termsAcceptedAt: Date | null;
  source: RegistrationSource;
}): TermsLineKind {
  if (registration.termsVersion !== null) {
    return { kind: "accepted", version: registration.termsVersion, acceptedAt: registration.termsAcceptedAt };
  }
  return registration.source === "STAFF" ? { kind: "onPaper" } : { kind: "notRecorded" };
}

/**
 * The queue panel's rows (§92). `offerEmailQueued` is the allocator's own guard (§520,
 * `repository.ts#offerAwaitingItsFirstEmail`): an offer whose email has not left yet still holds
 * its place past its stored deadline, so the panel lists it as `countOccupied` counts it.
 */
/**
 * The places families reserved at their forms (§543), for the queue panel: each registration still
 * waiting for its address whose reservation holds (`familyReservationHolds`), its deadline — the
 * sitting's, fixed by its first form — and whether the family's one email is still queued, which moves
 * nothing.
 * In the order the forms were sent.
 */
export async function listFamilyReservationsForEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string, now: Date) {
  return db
    .select({
      id: registrations.id,
      participantId: registrations.participantId,
      eventId: registrations.eventId,
      kind: registrations.kind,
      registeredName: registrations.registeredName,
      holdExpiresAt: registrations.holdExpiresAt,
      emailQueued: sql<boolean>`${familyEmailQueued()}`,
    })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), familyReservationHolds(now)))
    .orderBy(asc(registrations.submittedAt), asc(registrations.id));
}

/**
 * The line the queue panel draws (§92), in the order it was asked to show (§627, `queueOrderFor`):
 * `SUBMITTED` — when this cycle's form was sent, for an event whose places are handed out by hand —
 * or `LINE` — `waitlisted_at`, the allocator's own. `id` breaks a tie either way. Display only: no
 * offer is made from this order, and the allocator reads its own (`lockOldestWaitlisted`).
 *
 * `formSentAt` is `greatest(submitted_at, privacy_acknowledged_at)`, the journey's own rule
 * (`domain/journey.ts`, `formSentAt`): a restart rewrites `privacy_acknowledged_at` and never
 * `submitted_at`, so a person who sent the form again after their link lapsed is dated by the
 * second form, not the first, and does not jump to the head of a line the organizers hand out by the form's time.
 */
export async function listQueueForEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string, now: Date, order: QueueOrder) {
  const formSentAt = sql<Date>`greatest(${registrations.submittedAt}, ${registrations.privacyAcknowledgedAt})`.mapWith(registrations.submittedAt);
  return db
    .select({
      id: registrations.id,
      status: registrations.status,
      kind: registrations.kind,
      registeredName: registrations.registeredName,
      formSentAt,
      waitlistedAt: registrations.waitlistedAt,
      holdExpiresAt: registrations.holdExpiresAt,
      offerEmailQueued: offerEmailQueuedAt(now),
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        sql`${registrations.status} in ('PENDING_DECLARATION', 'WAITLISTED', 'WAITLIST_OFFERED', 'CONFIRMED')`,
      ),
    )
    .orderBy(asc(order === "SUBMITTED" ? formSentAt : registrations.waitlistedAt), asc(registrations.id));
}


/**
 * What «Când se pierde un loc» needs about one event (§635; the owner, 2026-10-02: «Când pierde lumea
 * locul? Trebuie să apară asta in back-office»): the event's window, limits, setting and close, and how
 * many real registrations wait on each deadline — `domain/place-deadlines.ts` turns them into words.
 *
 * **One query**, the event's row with its registrations grouped by filtered counts, read once per page
 * that shows the sentences: the list scoped to an event, the event's «Înscrierile primite», which hands
 * it to the queue panel. Never per row. Real rows only: a test registration is in no number the club is
 * given (§12.6) — this is a display count, never the allocator's (`countOccupied`, where `kind` is in
 * no condition). The held places count by status, deadline or none, as `countOccupied` does (§160); a
 * hold counts as past its deadline as the sweep reads it — not while its first declaration email is
 * still queued, since the send re-bases the deadline (§513, `lapsedDeclarationHoldsToRelease`); an
 * offer counts while its deadline is ahead or its email is still queued (§520), as the queue lists it.
 * A row «În afara locurilor» (§643) is in no place's count — it holds none to lose, and no sweep
 * releases its hold for anybody — though its address link still lapses like anyone's (`awaitingEmail`).
 * Null when the event does not exist.
 */
export async function readPlaceDeadlines<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
  now: Date,
): Promise<{ event: PlaceDeadlineEvent; counts: PlaceDeadlineCounts } | null> {
  const [row] = await db
    .select({
      startsAt: events.startsAt,
      eventStatus: events.eventStatus,
      registrationClosesAt: events.registrationClosesAt,
      confirmationOpensDaysBefore: events.confirmationOpensDaysBefore,
      confirmationDeadlineDaysBefore: events.confirmationDeadlineDaysBefore,
      capacity: events.capacity,
      waitlistCapacity: events.waitlistCapacity,
      waitlistAutoOffer: events.waitlistAutoOffer,
      held: sql<number>`count(${registrations.id}) filter (where ${registrations.status} = 'PENDING_DECLARATION' and not ${registrations.outsideCapacity})::int`,
      heldPast: sql<number>`count(${registrations.id}) filter (where ${registrations.status} = 'PENDING_DECLARATION' and not ${registrations.outsideCapacity} and ${registrations.holdExpiresAt} <= ${now} and not ${awaitingItsFirstEmail()})::int`,
      awaitingEmail: sql<number>`count(${registrations.id}) filter (where ${registrations.status} = 'PENDING_EMAIL_CONFIRMATION')::int`,
      familyReserved: sql<number>`count(${registrations.id}) filter (where ${familyReservationHolds(now)} and not ${registrations.outsideCapacity})::int`,
      offered: sql<number>`count(${registrations.id}) filter (where ${registrations.status} = 'WAITLIST_OFFERED' and not ${registrations.outsideCapacity} and (${registrations.holdExpiresAt} > ${now} or ${offerAwaitingItsFirstEmail(now)}))::int`,
    })
    .from(events)
    .leftJoin(registrations, and(eq(registrations.eventId, events.id), eq(registrations.kind, "REAL")))
    .where(eq(events.id, eventId))
    .groupBy(events.id);
  if (!row) return null;
  const { held, heldPast, awaitingEmail, familyReserved, offered, ...event } = row;
  return { event, counts: { held, heldPast, awaitingEmail, familyReserved, offered } };
}
