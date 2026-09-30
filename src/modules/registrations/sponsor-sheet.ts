import type { PROMO_LISTED_STATUSES, SponsorListRow } from "./sponsor-list";
import { onClubClock, STAMP_FORMAT, writeSheet, type SheetColumn } from "./workbook";

/**
 * «Descarcă lista pentru sponsori» as an Excel file (§581, amending §570). The owner, 2026-09-30:
 * «cum pot exporta participanții, doar cei care au bifat că vor datele publicate pentru parteneri?
 * trebuie să am Excel cu toate bifele lor».
 *
 * **The same rows as the CSV** — `sponsorList`'s, the sharing rule of §570 unchanged: a yes given
 * under a notice that allows the sharing, an adult on the day of the download, a real registration
 * that still stands — written through the start list's writer (`workbook.ts#writeSheet`: a bold
 * frozen header, dates as dates on the club's clock, every text a text cell so a name is never a
 * formula), one sheet, «Sponsori».
 *
 * **Every tick beside the five.** The CSV's five columns first, in its order (the offers' moment
 * headed «Oferte și beneficii (data acordului)», since here it stands among other consents), then
 * the notice that yes was given under, the public list & results, the socials on the list, the
 * terms and the declaration (each its version and its moment) and the registration's state. Never
 * the birth date, the phone, the health note, the identity document or the address holder's other
 * people: the file shows what the person agreed to, not who they are beyond the three data.
 *
 * The headers, the yes and no and the states come in the reader's language (`words`), like the CSV's headers.
 */

type ListedStatus = (typeof PROMO_LISTED_STATUSES)[number];

/** A row as the sheet reads it: the sponsor list's, with the declaration signed (one query in the route). */
export type SponsorSheetRow = Pick<
  SponsorListRow,
  "firstName" | "lastName" | "email" | "eventTitle" | "consentedAt" | "consentNoticeVersion" | "listPublic" | "listSocials" | "termsVersion" | "termsAcceptedAt" | "status"
> & {
  declarationVersion: number | null;
  declarationSignedAt: Date | null;
};

/** The sheet's columns, in their order: the CSV's five, then every consent. */
export const SPONSOR_SHEET_COLUMNS = [
  "firstName",
  "lastName",
  "email",
  "event",
  "promoConsentedAt",
  "promoNotice",
  "listPublic",
  "listSocials",
  "termsVersion",
  "termsAcceptedAt",
  "declarationVersion",
  "declarationSignedAt",
  "status",
] as const;

export type SponsorSheetColumn = (typeof SPONSOR_SHEET_COLUMNS)[number];

export type SponsorSheetWords = {
  /** The sheet's name: «Sponsori». */
  sheet: string;
  yes: string;
  no: string;
  columns: Record<SponsorSheetColumn, string>;
  states: Record<ListedStatus, string>;
};

const text = (value: string) => ({ value, type: String });
const stamp = (at: Date | null) => ({ value: onClubClock(at), type: Date, format: STAMP_FORMAT });
const whole = (value: number | null) => ({ value, type: Number });

function cells(words: SponsorSheetWords): Record<SponsorSheetColumn, { width: number; cell: (row: SponsorSheetRow) => Record<string, unknown> }> {
  const yesNo = (value: boolean) => text(value ? words.yes : words.no);
  return {
    firstName: { width: 18, cell: (row) => text(row.firstName) },
    lastName: { width: 18, cell: (row) => text(row.lastName) },
    email: { width: 30, cell: (row) => text(row.email) },
    event: { width: 26, cell: (row) => text(row.eventTitle ?? "") },
    promoConsentedAt: { width: 20, cell: (row) => stamp(row.consentedAt) },
    promoNotice: { width: 14, cell: (row) => whole(row.consentNoticeVersion) },
    listPublic: { width: 14, cell: (row) => yesNo(row.listPublic) },
    listSocials: { width: 14, cell: (row) => yesNo(row.listSocials) },
    termsVersion: { width: 12, cell: (row) => whole(row.termsVersion) },
    termsAcceptedAt: { width: 18, cell: (row) => stamp(row.termsAcceptedAt) },
    declarationVersion: { width: 12, cell: (row) => whole(row.declarationVersion) },
    declarationSignedAt: { width: 18, cell: (row) => stamp(row.declarationSignedAt) },
    status: { width: 24, cell: (row) => text(words.states[row.status as ListedStatus] ?? row.status) },
  };
}

/** The header row, exactly as the file writes it — what a test reads the columns by. */
export function sponsorSheetHeaders(words: SponsorSheetWords): string[] {
  return SPONSOR_SHEET_COLUMNS.map((key) => words.columns[key]);
}

export async function buildSponsorListWorkbook(words: SponsorSheetWords, rows: readonly SponsorSheetRow[]): Promise<Buffer> {
  const byKey = cells(words);
  const columns: SheetColumn<SponsorSheetRow>[] = SPONSOR_SHEET_COLUMNS.map((key) => ({ header: words.columns[key], ...byKey[key] }));
  return writeSheet(columns, rows, words.sheet, "Sponsori");
}
