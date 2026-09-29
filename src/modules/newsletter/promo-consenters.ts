import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { csvCell } from "@/modules/registrations/csv";
import { canSendNewsletter } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { CSV_BOM } from "./subscribers-csv";

/**
 * «Participanți care au bifat materiale promoționale» (§NNN, amending §550): the second fold of the
 * newsletter's «Abonați» page — every registration whose person said yes to «Vreau să primesc
 * materiale promoționale de la club și de la partenerii lui», with the name, the address, the event
 * and the moment, newest first, and its own CSV.
 *
 * **Who reads it.** The newsletter's own readers (`canSendNewsletter`: the Organizer, the
 * Administrator, the Superadministrator — §550's rule, which the privacy notice's sentence names:
 * "only the club's organizers and administrators see the list … and may download it"). Asserted
 * here, in the one read both the page and the CSV route go through, and by each of them before
 * (BR-REQ-060-01): a volunteer, the Redactor, Tehnic and a member are refused whatever they post.
 *
 * **Who is listed.** A yes on a registration whose address is proved and which still stands —
 * waiting for its declaration, on the waiting list, offered a place, or confirmed. Never an unproved
 * address (`PENDING_EMAIL_CONFIRMATION`: nobody has shown the inbox is theirs), never a cancelled or
 * expired registration, never a `TEST` row (AGENTS.md §12.6: a test registration is omitted from
 * every count and list the club is given). An erased registration is gone with its row.
 *
 * **Two consents, two lists.** The newsletter's subscribers are the fold above; this is not a
 * subscription and an unsubscribe there changes nothing here. The club sends the materials itself;
 * the partners never receive the list (the notice says so).
 */

/** The states whose yes is listed: an address proved, a registration that still stands. */
export const PROMO_LISTED_STATUSES = ["PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED", "CONFIRMED"] as const satisfies readonly RegistrationStatus[];

/** The table draws at most this many rows; the count and the CSV are always the whole list. */
export const PROMO_TABLE_LIMIT = 500;

export type PromoConsenterRow = {
  registrationId: string;
  /** The registered name, as the registration carries it. */
  name: string;
  /** The address the person's messages go to, as typed. */
  email: string;
  /** The event's title in the reader's language; null when the event has none in it. */
  eventTitle: string | null;
  /** The moment of the yes (or of the last change to it). */
  consentedAt: Date | null;
};

export type PromoConsenterList = { rows: PromoConsenterRow[]; total: number; truncated: boolean };

function assertMayRead(actor: Pick<StaffUser, "role">): void {
  if (!canSendNewsletter(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read who consented to promotional materials; §550 keeps it to the Organizer and the Administrator`);
  }
}

const listed = () =>
  and(eq(registrations.promoConsent, true), eq(registrations.kind, "REAL"), inArray(registrations.status, [...PROMO_LISTED_STATUSES]));

async function readRows<T extends Record<string, unknown>>(db: Database<T>, locale: Locale, limit: number): Promise<PromoConsenterRow[]> {
  return db
    .select({
      registrationId: registrations.id,
      name: registrations.registeredName,
      email: participants.deliveryEmail,
      eventTitle: eventTranslations.title,
      consentedAt: registrations.promoConsentAt,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, registrations.eventId), eq(eventTranslations.locale, locale)))
    .where(listed())
    .orderBy(sql`${registrations.promoConsentAt} desc nulls last`, desc(registrations.createdAt), asc(registrations.id))
    .limit(limit);
}

/** The fold's read: the first rows for the table, and how many there are in all. */
export async function listPromoConsenters<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  locale: Locale,
  limit: number = PROMO_TABLE_LIMIT,
): Promise<PromoConsenterList> {
  assertMayRead(actor);
  const [totals] = await db.select({ total: count() }).from(registrations).where(listed());
  const rows = await readRows(db, locale, limit + 1);
  return { rows: rows.slice(0, limit), total: Number(totals?.total ?? 0), truncated: rows.length > limit };
}

/** The CSV's read: every row, not the table's first ones — the file is the whole answer. */
export async function exportPromoConsenters<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  locale: Locale,
  limit: number,
): Promise<PromoConsenterRow[]> {
  assertMayRead(actor);
  return readRows(db, locale, limit);
}

export type PromoConsenterCsvHeader = { name: string; email: string; event: string; consentedAt: string };

/**
 * The file (§NNN): the subscribers CSV's rules (§550) — every cell through `csvCell` (formula
 * characters neutralized, quotes doubled), CRLF, a BOM first for Excel on Windows, the moment in
 * ISO 8601 — with the headers in the reader's language.
 */
export function buildPromoConsentersCsv(header: PromoConsenterCsvHeader, rows: readonly PromoConsenterRow[]): string {
  const lines = [
    [header.name, header.email, header.event, header.consentedAt].map(csvCell).join(","),
    ...rows.map((row) => [row.name, row.email, row.eventTitle ?? "", row.consentedAt?.toISOString() ?? ""].map(csvCell).join(",")),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}`;
}

/** The file's name, with the club's date: `materiale-promotionale-2026-09-29.csv`. */
export function promoConsentersCsvFileName(day: string): string {
  return `materiale-promotionale-${day}.csv`;
}
