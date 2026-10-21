import { and, asc, count, desc, eq, exists, gt, inArray, isNull, notExists, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { nameMatches } from "@/db/name-search";
import { eventVolunteerRoleAssignments, eventVolunteerRoles, eventVolunteers } from "@/db/schema/event-volunteers";
import { eventTranslations, events } from "@/db/schema/events";
import { legalDocuments } from "@/db/schema/legal-documents";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { VOLUNTEER_STATES, type VolunteerState } from "./domain/volunteer";
import { type VolunteerItem, volunteerItemsOf } from "./volunteers";

/**
 * The «Voluntari» screen's reads (§839; the owner, 2026-10-21: «a nicer volunteers screen, similar to the participants area»):
 * the people across events as one sorted, searched, server-paginated list, the way the registrations list reads its rows
 * (`admin-repository.ts`), and one person by id for their own page. The card on the event's editor keeps the roles, the
 * categories and the event's switches; this is where the people are worked.
 *
 * Every read here is for whoever may manage volunteers (`canManageVolunteers`), asserted by the pages and again by every
 * verb's service: a row carries an address and a telephone number.
 */

/** The columns a `?sort=` may name; each one's SQL is `orderOf`. */
export const VOLUNTEER_SORT_KEYS = ["name", "state", "since", "event"] as const;
export type VolunteerSortKey = (typeof VOLUNTEER_SORT_KEYS)[number];

/** `?role=none` is the people nobody has given a role yet («De repartizat», §761). */
export const UNASSIGNED = "none";

export type VolunteerAdminFilters = {
  /** One event, or every event. */
  eventId?: string;
  state?: VolunteerState;
  /** A role's id — the people given it —, or `UNASSIGNED` for the people given none. */
  role?: string;
  /** «Caută după nume»: the folded `LIKE` of `name-search.ts`. */
  search?: string;
};

/** A row of the list: the card's item, with the event it belongs to named in the reader's language. */
export type VolunteerAdminRow = VolunteerItem & {
  eventTitle: string | null;
  eventStartsAt: Date | null;
  eventDateToBeAnnounced: boolean;
};

/** The events the list's select offers: those that take volunteers or have any — the featured one first, then by start, newest first. */
export async function listEventsWithVolunteers<T extends Record<string, unknown>>(
  db: Database<T>,
  locale: Locale,
): Promise<Array<{ id: string; title: string | null; featured: boolean; startsAt: Date | null; acceptsVolunteers: boolean }>> {
  const rows = await db
    .select({ id: events.id, title: eventTranslations.title, featured: events.featured, startsAt: events.startsAt, acceptsVolunteers: events.acceptsVolunteers })
    .from(events)
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
    .where(or(eq(events.acceptsVolunteers, true), exists(db.select({ one: sql`1` }).from(eventVolunteers).where(eq(eventVolunteers.eventId, events.id)))))
    .orderBy(desc(events.featured), sql`${events.startsAt} DESC NULLS LAST`);
  return rows;
}

/** The `WHERE` the list, its count and its summary share. */
function whereOf(filters: VolunteerAdminFilters): SQL | undefined {
  const parts: SQL[] = [];
  if (filters.eventId) parts.push(eq(eventVolunteers.eventId, filters.eventId));
  if (filters.state) parts.push(eq(eventVolunteers.state, filters.state));
  if (filters.role === UNASSIGNED) parts.push(noRoleGiven());
  else if (filters.role) {
    parts.push(
      exists(
        sql`(SELECT 1 FROM ${eventVolunteerRoleAssignments} WHERE ${eventVolunteerRoleAssignments.volunteerId} = ${eventVolunteers.id} AND ${eventVolunteerRoleAssignments.roleId} = ${filters.role})`,
      ),
    );
  }
  const term = filters.search?.trim();
  if (term) parts.push(nameMatches(eventVolunteers.name, term));
  return parts.length > 0 ? and(...parts) : undefined;
}

/** Nobody has given the person a role (§761): no row in the assignments. */
function noRoleGiven(): SQL {
  return notExists(sql`(SELECT 1 FROM ${eventVolunteerRoleAssignments} WHERE ${eventVolunteerRoleAssignments.volunteerId} = ${eventVolunteers.id})`);
}

/** The order of one sort key: a name A to Z folded like the search, the states in the card's order, the moment, the event's start. */
function orderOf(sort: VolunteerSortKey, dir: "asc" | "desc"): SQL[] {
  const direction = (column: SQL) => (dir === "asc" ? asc(column) : desc(column));
  const tie = asc(eventVolunteers.createdAt);
  switch (sort) {
    case "name":
      return [direction(sql`lower(${eventVolunteers.name})`), tie];
    case "state":
      // «Înscris» first, then «Confirmat», then «Anulat»: the order the card lists the states in, not the alphabet's.
      return [direction(sql`CASE ${eventVolunteers.state} WHEN 'REGISTERED' THEN 0 WHEN 'CONFIRMED' THEN 1 ELSE 2 END`), tie];
    case "event":
      return [direction(sql`${events.startsAt}`), tie];
    case "since":
    default:
      return [direction(sql`${eventVolunteers.createdAt}`), asc(eventVolunteers.id)];
  }
}

/**
 * One page of the list: the rows the filters leave, in the order asked, with each one's roles chosen and given and the event's
 * title in the reader's language. The rows read like the card's (`volunteerItemsOf`), so the two never disagree about a person.
 */
export async function listVolunteersForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  filters: VolunteerAdminFilters,
  page: { limit: number; offset: number; sort: VolunteerSortKey; dir: "asc" | "desc" },
  locale: Locale,
): Promise<VolunteerAdminRow[]> {
  const guardianDocument = alias(legalDocuments, "guardian_document");
  const rows = await db
    .select({
      row: eventVolunteers,
      agreementVersion: legalDocuments.version,
      guardianVersion: guardianDocument.version,
      eventTitle: eventTranslations.title,
      eventStartsAt: events.startsAt,
      eventDateToBeAnnounced: events.dateToBeAnnounced,
    })
    .from(eventVolunteers)
    .innerJoin(events, eq(events.id, eventVolunteers.eventId))
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
    .leftJoin(legalDocuments, eq(legalDocuments.id, eventVolunteers.agreementDocumentId))
    .leftJoin(guardianDocument, eq(guardianDocument.id, eventVolunteers.guardianDocumentId))
    .where(whereOf(filters))
    .orderBy(...orderOf(page.sort, page.dir))
    .limit(page.limit)
    .offset(page.offset);
  const items = await volunteerItemsOf(
    db,
    rows.map(({ row, agreementVersion, guardianVersion }) => ({ row, agreementVersion, guardianVersion })),
  );
  return items.map((item, index) => ({
    ...item,
    eventTitle: rows[index].eventTitle,
    eventStartsAt: rows[index].eventStartsAt,
    eventDateToBeAnnounced: rows[index].eventDateToBeAnnounced,
  }));
}

/** How many rows the filters leave: the pager's total. */
export async function countVolunteersForAdmin<T extends Record<string, unknown>>(db: Database<T>, filters: VolunteerAdminFilters): Promise<number> {
  const [row] = await db.select({ n: count() }).from(eventVolunteers).innerJoin(events, eq(events.id, eventVolunteers.eventId)).where(whereOf(filters));
  return row?.n ?? 0;
}

export type VolunteerAdminSummary = {
  /** Everyone the filters leave, every state. */
  total: number;
  byState: Record<VolunteerState, number>;
  /** «De repartizat»: «Înscris» and «Confirmat» with no role given (§761) — the cancelled wait for nothing. */
  unassigned: number;
};

/**
 * The strip's figures (§246's shape): by state, and how many wait for a role. Blind to the state and role filters on purpose — the
 * strip says how the scope stands, and its pills are what set those two filters. One grouped query and one count.
 */
export async function summariseVolunteersForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  filters: Pick<VolunteerAdminFilters, "eventId" | "search">,
): Promise<VolunteerAdminSummary> {
  const scope = whereOf({ eventId: filters.eventId, search: filters.search });
  const grouped = await db
    .select({ state: eventVolunteers.state, n: count() })
    .from(eventVolunteers)
    .innerJoin(events, eq(events.id, eventVolunteers.eventId))
    .where(scope)
    .groupBy(eventVolunteers.state);
  const byState = Object.fromEntries(VOLUNTEER_STATES.map((state) => [state, 0])) as Record<VolunteerState, number>;
  for (const row of grouped) byState[row.state] = row.n;
  const [waiting] = await db
    .select({ n: count() })
    .from(eventVolunteers)
    .innerJoin(events, eq(events.id, eventVolunteers.eventId))
    .where(and(scope, noRoleGiven(), sql`${eventVolunteers.state} <> 'CANCELLED'`));
  return { total: grouped.reduce((sum, row) => sum + row.n, 0), byState, unassigned: waiting?.n ?? 0 };
}

/** The tab's figure (§839): how many offers still wait for an answer — «Înscris» on an event not yet over. */
export async function countVolunteersAwaiting<T extends Record<string, unknown>>(db: Database<T>, now: Date): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(eventVolunteers)
    .innerJoin(events, eq(events.id, eventVolunteers.eventId))
    .where(
      and(
        eq(eventVolunteers.state, "REGISTERED"),
        sql`${events.eventStatus} <> 'CANCELLED'`,
        or(isNull(events.startsAt), gt(sql`coalesce(${events.endsAt}, ${events.startsAt})`, now)),
      ),
    );
  return row?.n ?? 0;
}

/** One person by id, with the event they belong to — null for an id nobody has. */
export async function findVolunteerForAdmin<T extends Record<string, unknown>>(
  db: Database<T>,
  id: string,
  locale: Locale,
): Promise<(VolunteerAdminRow & { event: typeof events.$inferSelect }) | null> {
  const guardianDocument = alias(legalDocuments, "guardian_document");
  const [found] = await db
    .select({ row: eventVolunteers, agreementVersion: legalDocuments.version, guardianVersion: guardianDocument.version, event: events, eventTitle: eventTranslations.title })
    .from(eventVolunteers)
    .innerJoin(events, eq(events.id, eventVolunteers.eventId))
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, events.id), eq(eventTranslations.locale, locale)))
    .leftJoin(legalDocuments, eq(legalDocuments.id, eventVolunteers.agreementDocumentId))
    .leftJoin(guardianDocument, eq(guardianDocument.id, eventVolunteers.guardianDocumentId))
    .where(eq(eventVolunteers.id, id))
    .limit(1);
  if (!found) return null;
  const [item] = await volunteerItemsOf(db, [{ row: found.row, agreementVersion: found.agreementVersion, guardianVersion: found.guardianVersion }]);
  return { ...item, eventTitle: found.eventTitle, eventStartsAt: found.event.startsAt, eventDateToBeAnnounced: found.event.dateToBeAnnounced, event: found.event };
}

/** The roles of one event the list's role select offers, in the club's order, with how many people each was given. */
export async function listRolesWithCounts<T extends Record<string, unknown>>(
  db: Database<T>,
  eventId: string,
): Promise<Array<{ id: string; nameRo: string; nameEn: string; categoryId: string | null; needed: number | null; given: number }>> {
  const rows = await db
    .select({
      id: eventVolunteerRoles.id,
      nameRo: eventVolunteerRoles.nameRo,
      nameEn: eventVolunteerRoles.nameEn,
      categoryId: eventVolunteerRoles.categoryId,
      needed: eventVolunteerRoles.needed,
      position: eventVolunteerRoles.position,
      createdAt: eventVolunteerRoles.createdAt,
      // Aliased by hand: the assignments and the volunteers both carry a `role_id`, and the outer role's `id` is named through its table.
      given: sql<number>`(
        SELECT count(*)::int FROM event_volunteer_role_assignments AS given
        INNER JOIN event_volunteers AS held ON held.id = given.volunteer_id
        WHERE given.role_id = event_volunteer_roles.id AND held.state <> 'CANCELLED'
      )`,
    })
    .from(eventVolunteerRoles)
    .where(eq(eventVolunteerRoles.eventId, eventId))
    .orderBy(asc(eventVolunteerRoles.position), asc(eventVolunteerRoles.createdAt), asc(eventVolunteerRoles.id));
  return rows.map((row) => ({ id: row.id, nameRo: row.nameRo, nameEn: row.nameEn, categoryId: row.categoryId, needed: row.needed, given: row.given }));
}

/** The names of some roles, whatever their events: the list's «Roluri date» and «S-a oferit pentru» cells, one read per page. */
export async function listRoleNames<T extends Record<string, unknown>>(
  db: Database<T>,
  roleIds: readonly string[],
): Promise<Map<string, { nameRo: string; nameEn: string }>> {
  if (roleIds.length === 0) return new Map();
  const rows = await db
    .select({ id: eventVolunteerRoles.id, nameRo: eventVolunteerRoles.nameRo, nameEn: eventVolunteerRoles.nameEn })
    .from(eventVolunteerRoles)
    .where(inArray(eventVolunteerRoles.id, [...roleIds]));
  return new Map(rows.map((row) => [row.id, { nameRo: row.nameRo, nameEn: row.nameEn }]));
}
