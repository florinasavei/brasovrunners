import { and, desc, eq, sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema/audit-logs";
import { eventTranslations } from "@/db/schema/events";
import { staffUsers, type StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import { calendarDayIn } from "@/i18n/dates";
import type { Locale } from "@/i18n/routing";
import { recordAuditEvent } from "@/modules/audit/repository";
import { canManageRegistrations } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { isUuid } from "@/shared/ids";
import { assertMayExport, sponsorListFormat, type SponsorListFormat } from "./sponsor-list";

/**
 * «Liste date sponsorilor» (§929, amending §570 and §581). The owner, 2026-11-10, of «Descarcă lista
 * pentru sponsori»: «trebuie să gestionez mai bine asta, cu trimiterea către sponsori» — and, asked
 * what he wants to be able to do, he chose the register of the lists given.
 *
 * Until now a download left one trace a person could read: «Dată partenerilor» on the page of each
 * registration in the file. Nobody could see the lists themselves — which were made, for whom, how
 * many people each held — and a download that named nobody read «destinatar nenotat» forever, though
 * the notice promises «pentru fiecare listă, clubul păstrează cui a dat-o și ce înscrieri a cuprins».
 *
 * **No new table.** The register is the audit rows the download already writes
 * (`registrations.sponsor_list_exported`: who, when, the event or null, the count, the file and the
 * recipient), read back as a list. The trail is kept three years, and so is the register.
 *
 * **Never a name of a participant.** A row is the list, not its people: the count the download
 * recorded, never the registrations' ids — the read does not even select them, a list of every event
 * holds thousands.
 *
 * **Two doors, one read.** An event's registrations page shows that event's lists and the lists made
 * for every event, which held its people too; «Newsletter» shows them all. The same read names the
 * recipients written before, newest first, for the box's suggestions on either door.
 */

/** How many days the club keeps its own copy of a list: the notice's section 7, «în cel mult 30 de zile de la descărcare». */
export const SPONSOR_COPY_DAYS = 30;

/** The newest lists the register hands a page: years of a club's sponsors, and a bound on what is returned and drawn. */
export const SPONSOR_REGISTER_LIMIT = 500;

/** How many earlier recipients the box suggests. */
export const SPONSOR_RECIPIENT_SUGGESTIONS = 50;

/** The register fold's own anchor on both doors: a delete comes back to it, and the address opens it and the fold it sits in (§948). */
export const SPONSOR_REGISTER_ANCHOR = "sponsor-register";

const DAY_MS = 86_400_000;

/** One list for sponsors that was downloaded: the list, never its people. */
export type GivenSponsorList = {
  /** The audit row's id: the row's key on the page, nothing a person reads. */
  id: string;
  /** When the file was made. */
  at: Date;
  /** The event the list was made for; null for a list of every event. */
  eventId: string | null;
  /** That event's title in the reader's language; null for every event, and for an event that is gone. */
  eventTitle: string | null;
  /** «Cui dai lista»; null on a download made while the box was optional. */
  recipient: string | null;
  /** How many people the file held. */
  count: number;
  /** Which of the two files; the CSV for a download older than the Excel file (§581). */
  format: SponsorListFormat;
  /** Who downloaded it; null when that account was removed. */
  actorName: string | null;
  /** The moment the club's own copy must be gone by. */
  deleteBy: Date;
};

export type SponsorRegister = {
  /** The door's lists, newest first. */
  lists: GivenSponsorList[];
  /** The recipients written before, on any list, newest first and each once. */
  recipients: string[];
};

/** The club's copy is deleted within `SPONSOR_COPY_DAYS` of the download. */
export function copyDeleteBy(at: Date): Date {
  return new Date(at.getTime() + SPONSOR_COPY_DAYS * DAY_MS);
}

/**
 * Whether the day the register names for a copy — «Șterge fișierul tău până pe» — has passed, on the zone's calendar.
 * The cell names a day, not an hour, so the whole of that day is still in time whatever the hour the file was made
 * at: «termen trecut» is said from the next day, never during the one the cell names as the last.
 */
export function copyOverdue(deleteBy: Date, now: Date, timeZone: string): boolean {
  return calendarDayIn(now, timeZone) > calendarDayIn(deleteBy, timeZone);
}

/**
 * The recipients a box suggests: each name once, whatever its capitals («Sport Shop» and «sport
 * shop» are one sponsor, spelled as it was last written), newest first.
 */
export function recipientSuggestions(lists: readonly Pick<GivenSponsorList, "recipient">[], limit: number = SPONSOR_RECIPIENT_SUGGESTIONS): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const list of lists) {
    if (names.length === limit) break;
    if (!list.recipient) continue;
    const key = list.recipient.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(list.recipient);
  }
  return names;
}

/** The lists a door shows: every list, or one event's own and those made for every event, which held its people too. */
export function listsOfDoor<List extends Pick<GivenSponsorList, "eventId">>(lists: readonly List[], eventId?: string): List[] {
  return eventId ? lists.filter((list) => list.eventId === eventId || list.eventId === null) : [...lists];
}

/**
 * The register for one door (`eventId` for an event's registrations page, absent for «Newsletter»).
 * Asserts the role (BR-REQ-060-01): whoever may take the list — the Organizer, the Administrator, the
 * Superadministrator — reads what was taken.
 *
 * One read of the trail: the rows about an event (the first column of `audit_logs_entity_idx`), kept
 * when their action is the export's, three values out of each row's metadata and never the ids beside
 * them. No index serves the action, and the limit bounds what is returned, not what is read: the cost
 * grows with everything the trail holds about events — a few milliseconds at a club's scale, as
 * `bibs.ts#erasedBibNumbers` and `audit/repository.ts#listPartnerShares` read it. Should the trail grow
 * past that, a partial index on the action is the remedy.
 */
export async function readSponsorRegister<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  input: { eventId?: string; locale: Locale },
): Promise<SponsorRegister> {
  assertMayExport(actor);
  const rows = await db
    .select({
      id: auditLogs.id,
      at: auditLogs.createdAt,
      eventId: auditLogs.entityId,
      eventTitle: eventTranslations.title,
      recipient: sql<string | null>`${auditLogs.metadataJson} ->> 'recipient'`,
      count: sql<string | null>`${auditLogs.metadataJson} ->> 'count'`,
      format: sql<string | null>`${auditLogs.metadataJson} ->> 'format'`,
      actorName: staffUsers.displayName,
    })
    .from(auditLogs)
    .leftJoin(staffUsers, eq(staffUsers.id, auditLogs.actorStaffUserId))
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, auditLogs.entityId), eq(eventTranslations.locale, input.locale)))
    .where(and(eq(auditLogs.entityType, "event"), eq(auditLogs.action, "registrations.sponsor_list_exported")))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(SPONSOR_REGISTER_LIMIT);

  const all: GivenSponsorList[] = rows.map((row) => {
    const count = Number.parseInt(row.count ?? "", 10);
    return {
      id: row.id,
      at: row.at,
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      recipient: row.recipient?.trim() || null,
      count: Number.isFinite(count) ? count : 0,
      format: sponsorListFormat(row.format),
      actorName: row.actorName,
      deleteBy: copyDeleteBy(row.at),
    };
  });
  return { lists: listsOfDoor(all, input.eventId), recipients: recipientSuggestions(all) };
}

/**
 * «Șterge» on a row of «Liste date sponsorilor» (§948; the owner, 2026-11-15, of a list he had downloaded by mistake:
 * «vreau să pot șterge (hard delete) și faza asta, pentru că am generat din greșeală!»).
 *
 * The register is the trail's own rows (§929), so deleting a row of it deletes that audit row — for real, nothing kept
 * of what it said: not the recipient, not the registrations it named. With it goes «Dată partenerilor» on the page of
 * every registration the file held (`audit/repository.ts#listPartnerShares` reads the same row): a file that reached
 * nobody was given to nobody, and the record said otherwise.
 *
 * **Only this kind of row.** The statement deletes by id *and* by the export's action and entity type, so the id of any
 * other row of the trail — posted by hand — finds nothing: the trail gets no other door for a deletion.
 *
 * **What stays:** one new row, `registrations.sponsor_list_record_deleted`, about the same event (none, for a list of
 * every event): who deleted and when, and of the list only its moment, its count and its file — never whom it named or
 * whom it held, as an erasure's row names nobody (§67).
 *
 * **Who:** the Administrator (`canManageRegistrations`), asserted here as at the action's door (BR-REQ-060-01). The
 * Organizer, who may take the list and read the register, does not take the record of a list out of it.
 */
export async function deleteSponsorListRecord<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "id" | "role">,
  listId: string,
  now: Date,
): Promise<{ eventId: string | null }> {
  if (!canManageRegistrations(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not delete a list from the sponsors' register`);
  }
  if (!isUuid(listId)) throw new DomainError("NOT_FOUND", "no such list");
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(auditLogs)
      .where(and(eq(auditLogs.id, listId), eq(auditLogs.entityType, "event"), eq(auditLogs.action, "registrations.sponsor_list_exported")))
      .returning({ eventId: auditLogs.entityId, at: auditLogs.createdAt, metadataJson: auditLogs.metadataJson });
    if (!deleted) throw new DomainError("NOT_FOUND", "no such list");
    const said = (deleted.metadataJson ?? {}) as { count?: unknown; format?: unknown };
    await recordAuditEvent(tx, {
      actorStaffUserId: actor.id,
      action: "registrations.sponsor_list_record_deleted",
      entityType: "event",
      entityId: deleted.eventId,
      metadata: {
        listedAt: deleted.at.toISOString(),
        count: typeof said.count === "number" ? said.count : 0,
        format: sponsorListFormat(typeof said.format === "string" ? said.format : null),
      },
      now,
    });
    return { eventId: deleted.eventId };
  });
}
