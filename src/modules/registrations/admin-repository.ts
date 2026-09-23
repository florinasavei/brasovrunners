import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { declarationAcceptances } from "@/db/schema/declaration-acceptances";
import { emailOutbox } from "@/db/schema/email-outbox";
import { eventTranslations, events } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import {
  type RegistrationKind,
  type RegistrationSource,
  type RegistrationStatus,
  registrations,
} from "@/db/schema/registrations";
import { staffUsers } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { alias } from "drizzle-orm/pg-core";

/**
 * Read queries for the Administrator-only backoffice (AGENTS.md §15.8, §15.10; BR-REQ-060-01,
 * BR-REQ-070-01). Kept apart from `repository.ts`, which is the state-machine's own guarded
 * reads and writes: nothing here ever changes a registration, and every column selected is
 * chosen explicitly — the same `PUBLIC_COLUMNS` discipline `modules/events/repository.ts` uses
 * — so a join can never smuggle a participant's email into a response nobody asked it to carry.
 */

export type RegistrationListRow = {
  id: string;
  status: RegistrationStatus;
  kind: RegistrationKind;
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
  /** When the entrant ticked "I am medically fit" (§171); null on a desk or phone entry. */
  fitnessDeclaredAt: Date | null;
  /** The runner's own club, as typed (§172): a column the start list is sorted by. */
  clubName: string | null;
  /** The optional socials (§106), as typed; null when not given. */
  stravaUrl: string | null;
  instagramHandle: string | null;
  /** The parent or guardian of a minor (§108); null for an adult. */
  guardianName: string | null;
  /**
   * "Keep my name off the public start list" (BR-REQ-039-01, §186). The club sees who is on
   * the list it published, because "is my name on the site" is a question people ask the
   * club and not the platform.
   */
  listOptOut: boolean;
  submittedAt: Date;
  confirmedAt: Date | null;
  /** The race number, once assigned (BR-REQ-038-01). */
  bibNumber: number | null;
  /** The number held while it can still change (§214); null once a final one is settled. */
  provisionalBibNumber: number | null;
  /** When the club last said this bib is on paper (§264); null while it is not. */
  bibPrintedAt: Date | null;
  checkedInAt: Date | null;
  /** Mailgun's reason when a message bounced or was complained about (§76); null otherwise. */
  emailRejectedReason: string | null;
  idDocument: string | null;
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
  declarationAcceptedAt: Date | null;
  cancelledAt: Date | null;
  expiredAt: Date | null;
  expiryReason: string | null;
};

export type RegistrationListFilters = {
  eventId?: string;
  status?: RegistrationStatus;
  excludeTest?: boolean;
  clubMemberDeclared?: boolean;
  /** A name, or part of one (BR-REQ-041-01 criterion 7). */
  search?: string;
  /** Only the rows whose email the provider refused (§83): who to call. */
  emailBounced?: boolean;
};

/**
 * The columns the list may be ordered by, and the only strings that ever reach an `ORDER BY`.
 *
 * An allowlist rather than a mapping built from the request: `?sort=` arrives from a URL anybody
 * can type, and the one thing that must not be possible is for it to name a column.
 */
export const REGISTRATION_SORT_KEYS = ["name", "status", "event", "submitted", "bib"] as const;
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
 * The provider's last word on this registration's mail, when that word was "no" (BR-REQ-080-04,
 * `DECISIONS.md` §76): the reason Mailgun gave for the newest bounced or complained message —
 * any message type, because a verification that bounced means exactly what a bounced
 * confirmation means: this person never got the email, and somebody should call them. Null
 * when every message went through, or none was sent yet. A short sanitized reason (§16.1),
 * never a body.
 */
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

const emailRejectedReason = sql<string | null>`(
  SELECT coalesce(${emailOutbox.lastError}, ${emailOutbox.status}::text)
  FROM ${emailOutbox}
  WHERE ${emailOutbox.registrationId} = ${registrations.id}
    AND ${emailOutbox.status} IN ('BOUNCED', 'COMPLAINED')
  ORDER BY ${emailOutbox.createdAt} DESC
  LIMIT 1
)`;

function registrationConditions(filters: RegistrationListFilters): SQL[] {
  const search = filters.search?.trim();

  return [
    filters.eventId ? eq(registrations.eventId, filters.eventId) : undefined,
    filters.status ? eq(registrations.status, filters.status) : undefined,
    filters.excludeTest ? eq(registrations.kind, "REAL") : undefined,
    // Only ever narrows to the people who said yes. There is no "show me the non-members"
    // filter, because `false` here means "did not tick a box" as often as it means "not a
    // member", and a screen that presented it as the second would be inventing an answer.
    filters.clubMemberDeclared ? eq(registrations.clubMemberDeclared, true) : undefined,
    filters.emailBounced ? sql`${emailRejectedReason} IS NOT NULL` : undefined,
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

function registrationOrderBy(sort: RegistrationSortKey, dir: "asc" | "desc") {
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
      // Whichever number the runner actually has (§214): sorting by the final column alone
      // would put everybody still provisional in one undifferentiated block at the end.
      return dir === "asc"
        ? sql`coalesce(${registrations.bibNumber}, ${registrations.provisionalBibNumber}) asc nulls last`
        : sql`coalesce(${registrations.bibNumber}, ${registrations.provisionalBibNumber}) desc nulls last`;
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
): Promise<RegistrationListRow[]> {
  const conditions = registrationConditions(filters);

  const query = db
    .select({
      id: registrations.id,
      status: registrations.status,
      kind: registrations.kind,
      source: registrations.source,
      registeredName: registrations.registeredName,
      firstName: registrations.firstName,
      lastName: registrations.lastName,
      participantEmail: participants.deliveryEmail,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      clubMemberDeclared: registrations.clubMemberDeclared,
      fitnessDeclaredAt: registrations.fitnessDeclaredAt,
      clubName: registrations.clubName,
      listOptOut: registrations.listOptOut,
      stravaUrl: registrations.stravaUrl,
      instagramHandle: registrations.instagramHandle,
      guardianName: registrations.guardianName,
      submittedAt: registrations.submittedAt,
      confirmedAt: registrations.confirmedAt,
      bibNumber: registrations.bibNumber,
      provisionalBibNumber: registrations.provisionalBibNumber,
      bibPrintedAt: registrations.bibPrintedAt,
      checkedInAt: registrations.checkedInAt,
      emailRejectedReason,
      idDocument: latestIdDocument,
      cycleStartedAt: registrations.privacyAcknowledgedAt,
      emailVerifiedAt: participants.emailVerifiedAt,
      emailConfirmedAt: registrations.emailConfirmedAt,
      waitlistedAt: registrations.waitlistedAt,
      offerCreatedAt: registrations.offerCreatedAt,
      holdExpiresAt: registrations.holdExpiresAt,
      declarationAcceptedAt: latestDeclarationAcceptedAt,
      cancelledAt: registrations.cancelledAt,
      expiredAt: registrations.expiredAt,
      expiryReason: registrations.expiryReason,
    })
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
    .$dynamic();

  if (!page) return query.orderBy(desc(registrations.submittedAt));

  /*
    `submitted_at` breaks every tie. Sorting by status alone leaves rows in whatever order the
    plan happens to produce, and PostgreSQL is free to return a different one for page 2 than it
    did for page 1 — so a row can appear twice, or never, purely from paging. A total order is
    what makes `LIMIT`/`OFFSET` mean anything.
  */
  return query
    .orderBy(registrationOrderBy(page.sort, page.dir), desc(registrations.submittedAt), asc(registrations.id))
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
};

export async function summariseRegistrationsForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  filters: RegistrationListFilters = {},
): Promise<RegistrationSummary> {
  const conditions = registrationConditions(filters);

  const rows = await db
    .select({ status: registrations.status, kind: registrations.kind, total: count() })
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
    .groupBy(registrations.status, registrations.kind);

  const summary: RegistrationSummary = { byStatus: {}, real: 0, test: 0 };
  for (const row of rows) {
    if (row.kind === "TEST") {
      summary.test += row.total;
      continue;
    }
    summary.real += row.total;
    summary.byStatus[row.status] = (summary.byStatus[row.status] ?? 0) + row.total;
  }
  return summary;
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
  const conditions = registrationConditions(filters);

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
  /** PUBLIC when the participant submitted it, STAFF when an organizer entered it for them. */
  source: RegistrationSource;
  registeredName: string;
  /** The optional socials (§106), as typed; null when not given. */
  stravaUrl: string | null;
  instagramHandle: string | null;
  /** The parent or guardian of a minor (§108); null for an adult. */
  guardianName: string | null;
  participantEmail: string;
  eventId: string;
  eventTitle: string | null;
  clubMemberDeclared: boolean;
  submittedAt: Date;
  emailConfirmedAt: Date | null;
  waitlistedAt: Date | null;
  offerCreatedAt: Date | null;
  holdExpiresAt: Date | null;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancellationSource: string | null;
  expiredAt: Date | null;
  expiryReason: string | null;
  /** Race day (BR-REQ-037-07, BR-REQ-037-08, BR-REQ-038-01). */
  bibNumber: number | null;
  /** The number held while it can still change (§214); null once a final one is settled. */
  provisionalBibNumber: number | null;
  /** Whether the settled number is on paper (§264): what the cancel confirmation warns about, and what a cancelled row's chip says (§308). */
  bibPrintedAt: Date | null;
  checkinCode: string | null;
  checkedInAt: Date | null;
  /** Null when the participant checked themselves in, or the staff row is gone. */
  checkedInByName: string | null;
  /** Who vouched for the address at the desk, when nobody clicked a link. */
  emailConfirmedByName: string | null;
  /** Mailgun's reason when a message to this registration bounced or was complained about; null otherwise. */
  emailRejectedReason: string | null;
  /** For "send the reminder": only while the event is ahead (§81). */
  eventStartsAt: Date;
  /** When the current cycle began (`privacy_acknowledged_at`, rewritten on a restart); §145. */
  cycleStartedAt: Date;
  /** The participant's own click (any event); staff vouching is `emailConfirmedAt`. */
  emailVerifiedAt: Date | null;
  /** The latest declaration acceptance, online or on paper; the journey's fourth step (§145). */
  declarationAcceptedAt: Date | null;
};

const checkedInBy = alias(staffUsers, "checked_in_by");
const emailConfirmedBy = alias(staffUsers, "email_confirmed_by");



export async function findRegistrationDetailForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
): Promise<RegistrationDetail | undefined> {
  const [row] = await db
    .select({
      bibNumber: registrations.bibNumber,
      provisionalBibNumber: registrations.provisionalBibNumber,
      bibPrintedAt: registrations.bibPrintedAt,
      checkinCode: registrations.checkinCode,
  idDocument: latestIdDocument,
      checkedInAt: registrations.checkedInAt,
      checkedInByName: checkedInBy.displayName,
      emailConfirmedByName: emailConfirmedBy.displayName,
      emailRejectedReason,
      eventStartsAt: events.startsAt,
      id: registrations.id,
      status: registrations.status,
      kind: registrations.kind,
      source: registrations.source,
      registeredName: registrations.registeredName,
      participantEmail: participants.deliveryEmail,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      clubMemberDeclared: registrations.clubMemberDeclared,
      fitnessDeclaredAt: registrations.fitnessDeclaredAt,
      stravaUrl: registrations.stravaUrl,
      instagramHandle: registrations.instagramHandle,
      guardianName: registrations.guardianName,
      submittedAt: registrations.submittedAt,
      emailConfirmedAt: registrations.emailConfirmedAt,
      waitlistedAt: registrations.waitlistedAt,
      offerCreatedAt: registrations.offerCreatedAt,
      holdExpiresAt: registrations.holdExpiresAt,
      confirmedAt: registrations.confirmedAt,
      cancelledAt: registrations.cancelledAt,
      cancellationSource: registrations.cancellationSource,
      expiredAt: registrations.expiredAt,
      expiryReason: registrations.expiryReason,
      cycleStartedAt: registrations.privacyAcknowledgedAt,
      emailVerifiedAt: participants.emailVerifiedAt,
      declarationAcceptedAt: latestDeclarationAcceptedAt,
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
 * What the desk sees (BR-REQ-037-08): one registration as a volunteer needs it to hand over a
 * number — name, status, number, check-in state — and nothing more. No address, no details.
 * Open to every staff role, which is why the selection is this narrow.
 */
export type DeskRegistration = {
  id: string;
  status: RegistrationStatus;
  kind: RegistrationKind;
  registeredName: string;
  /** The parent or guardian of a minor (§108): who the kit goes to; null for an adult. */
  guardianName: string | null;
  eventId: string;
  eventTitle: string | null;
  eventStartsAt: Date;
  bibNumber: number | null;
  /** The number held while it can still change (§214); null once a final one is settled. */
  provisionalBibNumber: number | null;
  /**
   * Whether the settled number is on paper (§264), and when the row left the live states
   * (§308). Together they are what the desk says in red about a cancelled or expired runner
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
  /** The desk sees who never got the email (`DECISIONS.md` §76) — the reason, never the address. */
  emailRejectedReason: string | null;
  idDocument: string | null;
};

const DESK_COLUMNS = {
  id: registrations.id,
  status: registrations.status,
  kind: registrations.kind,
  registeredName: registrations.registeredName,
  guardianName: registrations.guardianName,
  eventId: registrations.eventId,
  eventTitle: eventTranslations.title,
  eventStartsAt: events.startsAt,
  bibNumber: registrations.bibNumber,
  provisionalBibNumber: registrations.provisionalBibNumber,
  bibPrintedAt: registrations.bibPrintedAt,
  cancelledAt: registrations.cancelledAt,
  expiredAt: registrations.expiredAt,
  checkinCode: registrations.checkinCode,
  idDocument: latestIdDocument,
  checkedInAt: registrations.checkedInAt,
  checkedInByName: checkedInBy.displayName,
  emailRejectedReason,
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
 * **except by its number**: the one exception BR-REQ-037-08 criterion 4 names (§308). Capped,
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
      Either column: on race morning the desk types the number printed on the sheet, and
      before the settle that number lives in the provisional column (§214).

      A **settled** number in any status, and that is the one place the desk's search reads a
      cancelled or expired row (§308, the exception BR-REQ-037-08 criterion 4 names). A settled
      number is never reused (§173), so "who is 27" has exactly one answer at this event even
      after 27 cancelled — and a volunteer holding the bib that somebody just handed over,
      typing its number and being told "nobody matches", is the surprise this exists to
      prevent. The row they get says, in red, why nothing is to be handed out.

      A provisional number only on a live row. It is printed nowhere and may already be
      somebody else's once the place is gone, so a row that is over never answers to it — and
      that is said here rather than left to the transitions, because one of them does not clear
      the column: the lapsed-declaration sweep (`repository.ts`, `DECLARATION_HOLD_LAPSED`)
      leaves it set, and `coalesce` over any status would have found that row by a number it
      never wore on paper.
    */
    const number = Number(q);
    conditions.push(
      sql`(${registrations.bibNumber} = ${number} OR (${registrations.bibNumber} IS NULL AND ${registrations.provisionalBibNumber} = ${number} AND ${registrations.status} NOT IN ('CANCELLED', 'EXPIRED')))`,
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
      // Nobody to hand a bib to: neither number (§214).
      withoutBib: sql<number>`count(*) FILTER (WHERE ${registrations.status} = 'CONFIRMED' AND ${registrations.bibNumber} IS NULL AND ${registrations.provisionalBibNumber} IS NULL)`.mapWith(Number),
      pending: sql<number>`count(*) FILTER (WHERE ${registrations.status} NOT IN ('CONFIRMED', 'CANCELLED', 'EXPIRED'))`.mapWith(Number),
    })
    .from(registrations)
    .where(eq(registrations.eventId, eventId));
  return row ?? { confirmed: 0, checkedIn: 0, withoutBib: 0, pending: 0 };
}

export type DeclarationAcceptanceRow = {
  /** `PAPER` carries the name of the staff member who recorded it (BR-REQ-037-07). */
  method: "EMAIL_LINK" | "PAPER";
  attestedByName: string | null;
  acceptedAt: Date;
  typedName: string;
  idDocument: string | null;
  declarationVersion: number;
};

export async function listDeclarationAcceptances<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<DeclarationAcceptanceRow[]> {
  return db
    .select({
      acceptedAt: declarationAcceptances.acceptedAt,
      typedName: declarationAcceptances.typedName,
      idDocument: declarationAcceptances.idDocument,
      declarationVersion: declarationAcceptances.declarationVersion,
      method: declarationAcceptances.method,
      attestedByName: staffUsers.displayName,
    })
    .from(declarationAcceptances)
    .leftJoin(staffUsers, eq(staffUsers.id, declarationAcceptances.attestedByStaffUserId))
    .where(eq(declarationAcceptances.registrationId, registrationId))
    .orderBy(desc(declarationAcceptances.acceptedAt));
}

export type OutboxHistoryRow = {
  messageType: string;
  status: string;
  isManualResend: boolean;
  createdAt: Date;
  sentAt: Date | null;
};

export async function listOutboxHistory<T extends Record<string, unknown>>(
  db: Database<T>,
  registrationId: string,
): Promise<OutboxHistoryRow[]> {
  return db
    .select({
      messageType: emailOutbox.messageType,
      status: emailOutbox.status,
      isManualResend: emailOutbox.isManualResend,
      createdAt: emailOutbox.createdAt,
      sentAt: emailOutbox.sentAt,
    })
    .from(emailOutbox)
    .where(eq(emailOutbox.registrationId, registrationId))
    .orderBy(asc(emailOutbox.createdAt));
}

/** Events with at least one registration, for the list page's filter — Admin has no reason to
 * see events nobody has registered for on this screen; the CMS already lists all of them. */
export async function listEventsWithRegistrations<T extends Record<string, unknown>>(
  db: Database<T>,
): Promise<Array<{ id: string; title: string | null; featured: boolean }>> {
  return db
    .selectDistinct({ id: events.id, title: eventTranslations.title, featured: events.featured })
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
): Promise<Array<{ id: string; title: string | null; startsAt: Date; timezone: string }>> {
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
export async function listQueueForEvent<T extends Record<string, unknown>>(db: Database<T>, eventId: string) {
  return db
    .select({
      id: registrations.id,
      status: registrations.status,
      kind: registrations.kind,
      registeredName: registrations.registeredName,
      submittedAt: registrations.submittedAt,
      waitlistedAt: registrations.waitlistedAt,
      holdExpiresAt: registrations.holdExpiresAt,
    })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, eventId),
        sql`${registrations.status} in ('PENDING_DECLARATION', 'WAITLISTED', 'WAITLIST_OFFERED', 'CONFIRMED')`,
      ),
    )
    .orderBy(asc(registrations.waitlistedAt), asc(registrations.id));
}

