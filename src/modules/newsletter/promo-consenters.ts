import { count } from "drizzle-orm";
import { registrations } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { buildSponsorListCsv, promoListed, readPromoConsentRows, type PromoConsentRow, type SponsorListCsvHeader } from "@/modules/registrations/sponsor-list";
import { canSendNewsletter } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";

/**
 * «Participanți care au bifat oferte și beneficii» (§562, amending §550): the second fold of the
 * newsletter's «Abonați» page — every registration whose person said yes to «Vreau să primesc
 * oferte și beneficii de la <club> și partenerii săi.», with the name, the address, the event
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
 * the partners never receive this list — only the sponsor list (§NNN), from the same read.
 *
 * **One query (§NNN).** The rows come from `readPromoConsentRows`, the read the sponsor list narrows,
 * and the file is `buildSponsorListCsv`'s five columns — one shape for every download of the yes.
 */

/** The states whose yes is listed — kept here under its §562 name; the one list is the sponsor list's. */
export { PROMO_LISTED_STATUSES } from "@/modules/registrations/sponsor-list";

/** The table draws at most this many rows; the count and the CSV are always the whole list. */
export const PROMO_TABLE_LIMIT = 500;

export type PromoConsenterRow = PromoConsentRow;

export type PromoConsenterList = { rows: PromoConsenterRow[]; total: number; truncated: boolean };

function assertMayRead(actor: Pick<StaffUser, "role">): void {
  if (!canSendNewsletter(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not read who consented to offers and benefits; §550 keeps it to the Organizer and the Administrator`);
  }
}

const listed = () => promoListed();

async function readRows<T extends Record<string, unknown>>(db: Database<T>, locale: Locale, limit: number): Promise<PromoConsenterRow[]> {
  return readPromoConsentRows(db, { locale, limit });
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

export type PromoConsenterCsvHeader = SponsorListCsvHeader;

/**
 * The file (§562): since §NNN the sponsor list's own shape — Prenume, Nume, Email, Eveniment, Data
 * acordului — through the one writer (`buildSponsorListCsv`: `csvCell`, CRLF, a BOM, ISO 8601), so
 * the club's list and the partners' read alike.
 */
export function buildPromoConsentersCsv(header: PromoConsenterCsvHeader, rows: readonly PromoConsenterRow[]): string {
  return buildSponsorListCsv(header, rows);
}

/** The file's name, with the club's date: `oferte-si-beneficii-2026-09-29.csv`. */
export function promoConsentersCsvFileName(day: string): string {
  return `oferte-si-beneficii-${day}.csv`;
}
