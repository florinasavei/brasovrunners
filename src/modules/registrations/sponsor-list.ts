import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { eventTranslations } from "@/db/schema/events";
import { participants } from "@/db/schema/participants";
import { registrations, type RegistrationStatus } from "@/db/schema/registrations";
import type { StaffUser } from "@/db/schema/staff-users";
import type { Database } from "@/db/types";
import type { Locale } from "@/i18n/routing";
import { findSponsorShareVersions, noticeDescribesPromotionalMaterialsShared } from "@/modules/legal-documents/repository";
import { CSV_BOM } from "@/modules/newsletter/subscribers-csv";
import { canExportSponsorList } from "@/modules/staff-identity/domain/roles";
import { DomainError } from "@/shared/errors/domain-error";
import { csvCell } from "./csv";
import { reachesPartner, sponsorShareGate, type SponsorShareGate } from "./domain/sponsor-share";

/**
 * «Descarcă lista pentru sponsori» (§NNN, amending §562 and §550). The owner, 2026-09-29: "I need to
 * be able to export the participants list but filter out just the ones who agreed to receive
 * marketing emails so we can share it with our sponsors."
 *
 * **One query, two doors.** `readPromoConsentRows` is the one read of who said yes to «oferte și
 * beneficii»: the event's registrations page asks it for one event, the «Newsletter» fold for every
 * event, and the fold's own table (§562's club list) reads the same rows. `sponsorList` narrows it to
 * the rows a partner may receive (`domain/sponsor-share.ts`), and `buildSponsorListCsv` is the one
 * file both doors download.
 *
 * **Who is listed.** A yes (`promo_consent`) on a real registration (never `TEST`: AGENTS.md §12.6 —
 * `kind` in no other condition) whose address is proved and which still stands — waiting for its
 * declaration, on the waiting list, offered a place, or confirmed — never an unproved address, a
 * cancelled or an expired one. For the partners, only a yes given under a notice that describes the
 * sharing (`{{promotionalMaterialsShared}}`), and never a minor: a child's name goes to no third
 * party's marketing, whatever the guardian ticked — the participant must be 18 on the day of the
 * download (`domain/sponsor-share.ts#adultForPartners`), and a registration with no birth date is
 * left out, the safe side. The club's own sending (§562's list) is not narrowed: the guardian's address receives it.
 *
 * **The minimum.** Prenume, Nume, Email, Eveniment, Data acordului — never the birth date, the
 * phone, the health note, the declaration's facts or the address holder's other people.
 *
 * **Who may take it.** `canExportSponsorList` (the Organizer, the Administrator, the
 * Superadministrator), asserted here and in the route (BR-REQ-060-01); offered only while the notice
 * in force describes the sharing, in every language — the route refuses otherwise.
 */

/** The states whose yes is listed: an address proved, a registration that still stands (§562). */
export const PROMO_LISTED_STATUSES = ["PENDING_DECLARATION", "WAITLISTED", "WAITLIST_OFFERED", "CONFIRMED"] as const satisfies readonly RegistrationStatus[];

/** «Cui dai lista», as long as a partner's name and a person's needs to be. */
export const SPONSOR_RECIPIENT_MAX = 120;

/**
 * The optional recipient a download names (`?to=`), as the audit row keeps it: control characters
 * gone, whitespace collapsed, at most `SPONSOR_RECIPIENT_MAX` characters; null when nothing is left.
 */
export function sponsorRecipient(raw: string | null): string | null {
  const text = (raw ?? "").replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, SPONSOR_RECIPIENT_MAX).trim();
  return text === "" ? null : text;
}

/** Every row, not a table's first ones: the file is the whole answer. */
export const SPONSOR_LIST_LIMIT = 100_000;

export type PromoConsentRow = {
  registrationId: string;
  eventId: string;
  /** The registered name, as the registration carries it (§562's table). */
  name: string;
  /** The parts; a row with none falls back to the registered name as the first name. */
  firstName: string;
  lastName: string;
  /** The address the person's messages go to, as typed. */
  email: string;
  /** The event's title in the reader's language; null when the event has none in it. */
  eventTitle: string | null;
  /** The moment of the yes (or of the last change to it). */
  consentedAt: Date | null;
  /** The notice this registration recorded (§396's column). */
  privacyNoticeVersion: number;
  /** The participant's birth date (`YYYY-MM-DD`), read only to keep a minor out of the partners' list; never in a file. */
  birthDate: string | null;
};

/** The one condition of who is listed, per event or across events. */
export function promoListed(eventId?: string): SQL {
  const conditions = [eq(registrations.promoConsent, true), eq(registrations.kind, "REAL"), inArray(registrations.status, [...PROMO_LISTED_STATUSES])];
  if (eventId) conditions.push(eq(registrations.eventId, eventId));
  return and(...conditions) as SQL;
}

/** The one read of who said yes, newest first. The callers assert the role. */
export async function readPromoConsentRows<T extends Record<string, unknown>>(
  db: Database<T>,
  input: { locale: Locale; eventId?: string; limit: number; noticeVersions?: readonly number[] },
): Promise<PromoConsentRow[]> {
  const where = input.noticeVersions
    ? and(promoListed(input.eventId), inArray(registrations.privacyNoticeVersion, [...input.noticeVersions]))
    : promoListed(input.eventId);
  const rows = await db
    .select({
      registrationId: registrations.id,
      eventId: registrations.eventId,
      name: registrations.registeredName,
      firstName: registrations.firstName,
      lastName: registrations.lastName,
      email: participants.deliveryEmail,
      eventTitle: eventTranslations.title,
      consentedAt: registrations.promoConsentAt,
      privacyNoticeVersion: registrations.privacyNoticeVersion,
      birthDate: registrations.birthDate,
    })
    .from(registrations)
    .innerJoin(participants, eq(participants.id, registrations.participantId))
    .leftJoin(eventTranslations, and(eq(eventTranslations.eventId, registrations.eventId), eq(eventTranslations.locale, input.locale)))
    .where(where)
    .orderBy(sql`${registrations.promoConsentAt} desc nulls last`, desc(registrations.createdAt), asc(registrations.id))
    .limit(input.limit);
  return rows.map((row) => {
    const first = row.firstName?.trim();
    const last = row.lastName?.trim();
    return { ...row, firstName: first || row.name, lastName: first ? (last ?? "") : "" };
  });
}

/**
 * The approved notices as the row gate reads them — for a person's own page, which says «Clubul le
 * poate da partenerilor…» only on a registration whose yes may reach one (`sharedWithSponsors`),
 * and keeps §562's «partenerii nu primesc adresa ta» on every other, where it is still true.
 */
export async function readSponsorShareGate<T extends Record<string, unknown>>(db: Database<T>): Promise<SponsorShareGate> {
  return sponsorShareGate(await findSponsorShareVersions(db));
}

export type SponsorList = {
  /** Whether the notice in force describes the sharing, in every language: the button's switch. */
  offered: boolean;
  rows: PromoConsentRow[];
};

/** What a page shows beside the button: the switch and how many rows the file would hold. */
export type SponsorListSummary = { offered: boolean; count: number };

/**
 * The one row rule for the partners, shared by the file and the count: a yes given under a notice
 * that describes the sharing (`sharedWithSponsors`), and an adult on the day of the download.
 */
function mayReachPartner(row: { consentedAt: Date | null; privacyNoticeVersion: number; birthDate: string | null }, gate: SponsorShareGate, now: Date): boolean {
  return reachesPartner({ promoConsent: true, promoConsentAt: row.consentedAt, privacyNoticeVersion: row.privacyNoticeVersion, birthDate: row.birthDate }, gate, now);
}

function assertMayExport(actor: Pick<StaffUser, "role">): void {
  if (!canExportSponsorList(actor.role)) {
    throw new DomainError("FORBIDDEN", `role ${actor.role} may not take the sponsor list; §NNN keeps it to the Organizer and the Administrator`);
  }
}

/**
 * The sponsor list, for one event or for every event (`eventId` absent). Its rows are those a
 * partner may receive even while `offered` is false — the page shows no count then and the route
 * refuses the file, so nothing leaves while the notice in force does not say it may.
 */
export async function sponsorList<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  input: { eventId?: string; locale: Locale; now: Date },
): Promise<SponsorList> {
  assertMayExport(actor);
  const [offered, versions] = await Promise.all([noticeDescribesPromotionalMaterialsShared(db, input.now), findSponsorShareVersions(db)]);
  const gate = sponsorShareGate(versions);
  if (gate.sharing.size === 0) return { offered, rows: [] };
  const candidates = await readPromoConsentRows(db, { locale: input.locale, eventId: input.eventId, limit: SPONSOR_LIST_LIMIT, noticeVersions: [...gate.sharing] });
  return { offered, rows: candidates.filter((row) => mayReachPartner(row, gate, input.now)) };
}

/**
 * The count beside the button, for the registrations page and «Newsletter» (§NNN, review nit): the
 * same rule as the file, over three columns and no join, and no count at all while the notice in
 * force does not describe the sharing — the page shows none then.
 */
export async function sponsorListSummary<T extends Record<string, unknown>>(
  db: Database<T>,
  actor: Pick<StaffUser, "role">,
  input: { eventId?: string; now: Date },
): Promise<SponsorListSummary> {
  assertMayExport(actor);
  const [offered, versions] = await Promise.all([noticeDescribesPromotionalMaterialsShared(db, input.now), findSponsorShareVersions(db)]);
  const gate = sponsorShareGate(versions);
  if (!offered || gate.sharing.size === 0) return { offered, count: 0 };
  const rows = await db
    .select({ consentedAt: registrations.promoConsentAt, privacyNoticeVersion: registrations.privacyNoticeVersion, birthDate: registrations.birthDate })
    .from(registrations)
    .where(and(promoListed(input.eventId), inArray(registrations.privacyNoticeVersion, [...gate.sharing])))
    .limit(SPONSOR_LIST_LIMIT);
  return { offered, count: rows.filter((row) => mayReachPartner(row, gate, input.now)).length };
}

export type SponsorListCsvHeader = { firstName: string; lastName: string; email: string; event: string; consentedAt: string };

/**
 * The file (§NNN): five columns and nothing else, the subscribers CSV's rules (§550) — every cell
 * through `csvCell` (formula characters neutralized, quotes doubled), CRLF, a BOM first for Excel on
 * Windows, the moment in ISO 8601 — with the headers in the reader's language. The newsletter's
 * club list downloads the same shape (§562's «Descarcă CSV»).
 */
export function buildSponsorListCsv(header: SponsorListCsvHeader, rows: readonly Pick<PromoConsentRow, "firstName" | "lastName" | "email" | "eventTitle" | "consentedAt">[]): string {
  const lines = [
    [header.firstName, header.lastName, header.email, header.event, header.consentedAt].map(csvCell).join(","),
    ...rows.map((row) => [row.firstName, row.lastName, row.email, row.eventTitle ?? "", row.consentedAt?.toISOString() ?? ""].map(csvCell).join(",")),
  ];
  return `${CSV_BOM}${lines.join("\r\n")}`;
}

/**
 * The file's name, with the club's date: `sponsori-crosul-toamnei-2026-09-29.csv` for one event
 * (its slug in the reader's language), `sponsori-toate-2026-09-29.csv` for every event. Only
 * `a-z`, digits and hyphens reach the header, whatever a slug holds.
 */
export function sponsorListFileName(eventSlug: string | null, day: string): string {
  const scope = eventSlug ? eventSlug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "eveniment" : "toate";
  return `sponsori-${scope}-${day}.csv`;
}
