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
import type { Database } from "@/db/types";

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
  participantEmail: string;
  eventId: string;
  eventTitle: string | null;
  /** BR-REQ-031-06. What this person said about themselves, never what the club verified. */
  clubMemberDeclared: boolean;
  submittedAt: Date;
  confirmedAt: Date | null;
};

export type RegistrationListFilters = {
  eventId?: string;
  status?: RegistrationStatus;
  excludeTest?: boolean;
  clubMemberDeclared?: boolean;
  /** A name, or part of one (BR-REQ-041-01 criterion 7). */
  search?: string;
};

/**
 * The columns the list may be ordered by, and the only strings that ever reach an `ORDER BY`.
 *
 * An allowlist rather than a mapping built from the request: `?sort=` arrives from a URL anybody
 * can type, and the one thing that must not be possible is for it to name a column.
 */
export const REGISTRATION_SORT_KEYS = ["name", "status", "event", "submitted"] as const;
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
      participantEmail: participants.deliveryEmail,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      clubMemberDeclared: registrations.clubMemberDeclared,
      submittedAt: registrations.submittedAt,
      confirmedAt: registrations.confirmedAt,
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
};

export async function findRegistrationDetailForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
): Promise<RegistrationDetail | undefined> {
  const [row] = await db
    .select({
      id: registrations.id,
      status: registrations.status,
      kind: registrations.kind,
      source: registrations.source,
      registeredName: registrations.registeredName,
      participantEmail: participants.deliveryEmail,
      eventId: registrations.eventId,
      eventTitle: eventTranslations.title,
      clubMemberDeclared: registrations.clubMemberDeclared,
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
    .where(eq(registrations.id, id))
    .limit(1);

  return row;
}

export type DeclarationAcceptanceRow = {
  acceptedAt: Date;
  typedName: string;
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
      declarationVersion: declarationAcceptances.declarationVersion,
    })
    .from(declarationAcceptances)
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
): Promise<Array<{ id: string; title: string | null }>> {
  return db
    .selectDistinct({ id: events.id, title: eventTranslations.title })
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
    .where(eq(events.registrationMode, "INTERNAL"))
    .orderBy(asc(events.startsAt));
}
