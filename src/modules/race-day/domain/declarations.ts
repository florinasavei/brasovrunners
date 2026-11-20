import type { RegistrationKind, RegistrationStatus } from "@/db/schema/registrations";
import { foldTerm } from "@/db/name-search";
import { raceNumberOf } from "@/modules/registrations/domain/race-number";
import type { FoldOpenWhen } from "@/shared/ui/fold";

/**
 * «Ziua cursei» → «Declarații» (§NNN), the pure half: what a row of the page is, the folds it stands in by the registration's
 * state, the order inside each, the search by name or race number, and the counts. No database, no request, no words:
 * `race-day/declarations.ts` reads, the page says it. The organizers' alone (`canReadRaceDayDeclarations`).
 *
 * **No identity document is anywhere here.** A row carries the signature's names, never the document typed beside them: the page is
 * opened at a race-day table that people stand in front of, and the document stays in the PDF — opened one at a time, every download
 * recorded — and on the registration's own page.
 */

/** One registration that holds a signed declaration, with its newest acceptance: what a row of the page draws, and nothing more. */
export type RaceDayDeclarationRow = {
  registrationId: string;
  status: RegistrationStatus;
  /** A test registration is drawn, labelled, and left out of every count (§30). */
  kind: RegistrationKind;
  registeredName: string;
  /** Set on a minor's registration (§108): with the minor's own signature on the acceptance, the row names two signers (§330). */
  guardianName: string | null;
  /** As stored; the page shows it as the desk does (`raceNumberOf`: once confirmed, and kept retired on a row that is over). */
  bibNumber: number | null;
  acceptedAt: Date;
  /** `PAPER`: signed at the desk on the printed form and recorded by a member of staff (BR-REQ-037-07). */
  method: "EMAIL_LINK" | "PAPER";
  /** The declarant's signature: the adult's, or the parent's or guardian's for a minor. */
  typedName: string;
  /** The minor's own signature beside the parent's (§330); null for an adult and for an acceptance from before two were asked. */
  minorTypedName: string | null;
  declarationVersion: number;
  /** The SHA-256 of the exact text signed (§556); null on an acceptance from before it. */
  textHash: string | null;
  /** The staff account that recorded a paper declaration; null for one signed online, and for an account deleted since. */
  recordedByName: string | null;
};

/**
 * The page's folds, in order — «Prezența»'s own (§1002, `registrations/domain/desk-sections.ts`), one per state, with the desk's two
 * folds of the confirmed («De ridicat numărul», «Prezenți») kept as one: who came does not change what they signed.
 *
 * 1. `confirmed` — the registrations that run. First, and open on every arrival (`primary`): they are what the page is for.
 * 2. `unsigned` — `PENDING_DECLARATION`: a registration cancelled or run out after it signed, then restarted (`AGENTS.md` §10.5),
 *    now owing a new signature; the one listed is from before.
 * 3. `addressUnconfirmed` — `PENDING_EMAIL_CONFIRMATION`, the same kind of restart, one step earlier.
 * 4. `offered` — `WAITLIST_OFFERED`.
 * 5. `waitlisted` — `WAITLISTED`.
 * 6. `voided` — `CANCELLED` or `EXPIRED`: the declaration is kept all the same (three years, §95).
 *
 * Every fold but the first starts closed, «Anulate sau expirate» included — the desk opens that one, for a printed bib that may
 * have to come out of the pile; nothing on this page is handed out. A fold with no rows is not drawn.
 */
export const DECLARATION_SECTION_KEYS = ["confirmed", "unsigned", "addressUnconfirmed", "offered", "waitlisted", "voided"] as const;
export type DeclarationSectionKey = (typeof DECLARATION_SECTION_KEYS)[number];

/** The fold a row stands in, by its state alone — the desk's (`deskSectionOf`) for every state but the confirmed, which is one here. */
export function declarationSectionOf(status: RegistrationStatus): DeclarationSectionKey {
  switch (status) {
    case "CONFIRMED":
      return "confirmed";
    case "PENDING_DECLARATION":
      return "unsigned";
    case "PENDING_EMAIL_CONFIRMATION":
      return "addressUnconfirmed";
    case "WAITLIST_OFFERED":
      return "offered";
    case "WAITLISTED":
      return "waitlisted";
    case "CANCELLED":
    case "EXPIRED":
      return "voided";
  }
}

/** Why a fold opens by itself when nothing else asks it to (`shared/ui/fold.ts`, §336): the confirmed are the page's own list. */
const OPENS_BY_DEFAULT: Readonly<Partial<Record<DeclarationSectionKey, FoldOpenWhen>>> = { confirmed: { primary: true } };

/** The race number the row shows, as the desk shows it (§548, §311): null while it has none to show. */
export function declarationNumberOf(row: Pick<RaceDayDeclarationRow, "status" | "bibNumber">): number | null {
  return raceNumberOf(row);
}

/**
 * The order inside a fold: by the race number the row shows, lowest first; the rows without one after them, by name; then by id —
 * the same rows, the same order, whatever order the read gave them.
 */
export function compareDeclarationRows(a: RaceDayDeclarationRow, b: RaceDayDeclarationRow): number {
  const numberA = declarationNumberOf(a);
  const numberB = declarationNumberOf(b);
  if (numberA !== null && numberB !== null && numberA !== numberB) return numberA - numberB;
  if (numberA !== null && numberB === null) return -1;
  if (numberA === null && numberB !== null) return 1;
  return a.registeredName.localeCompare(b.registeredName, "ro") || (a.registrationId < b.registrationId ? -1 : a.registrationId > b.registrationId ? 1 : 0);
}

/**
 * The search box (`?q=`), read as the desk reads its own (`listDeskRegistrations`): one to five digits are a race number, matched
 * against the number the row shows — a confirmed row's, and the retired one of a row that is over (§311); anything else is a part
 * of the name, matched blind to case and diacritics (`foldTerm`, the fold the lists use), in every fold; nothing is everybody. A
 * desk code names nobody here: the page lists declarations, and the desk is where a code is scanned.
 */
export type DeclarationSearch = { kind: "none" } | { kind: "number"; number: number } | { kind: "name"; term: string };

export function declarationSearchOf(value: unknown): DeclarationSearch {
  const typed = typeof value === "string" ? value.trim() : "";
  if (typed === "") return { kind: "none" };
  if (/^\d{1,5}$/.test(typed)) return { kind: "number", number: Number(typed) };
  return { kind: "name", term: foldTerm(typed) };
}

export function matchesDeclarationSearch(row: RaceDayDeclarationRow, search: DeclarationSearch): boolean {
  if (search.kind === "none") return true;
  if (search.kind === "number") return declarationNumberOf(row) === search.number;
  return foldTerm(row.registeredName).includes(search.term);
}

/** How many of these rows are real registrations: the page's «N declarații semnate» and a fold's number (§30, `AGENTS.md` §12.6). */
export function countRealDeclarations(rows: readonly Pick<RaceDayDeclarationRow, "kind">[]): number {
  return rows.filter((row) => row.kind === "REAL").length;
}

export type DeclarationSection = {
  key: DeclarationSectionKey;
  /** The fold's rows, in `compareDeclarationRows`' order. */
  rows: RaceDayDeclarationRow[];
  /** How many of them are real registrations: the summary's number. */
  count: number;
  /** Why the fold is drawn open, if it is. */
  openWhen: FoldOpenWhen;
};

/**
 * The rows in their folds, in the page's order, the empty ones left out. `searching`: the box holds a name or a number — every
 * fold drawn holds a match, and opens (`inUse`), as a search opens the desk's.
 */
export function declarationSections(rows: readonly RaceDayDeclarationRow[], { searching }: { searching: boolean }): DeclarationSection[] {
  const byKey = new Map<DeclarationSectionKey, RaceDayDeclarationRow[]>(DECLARATION_SECTION_KEYS.map((key) => [key, []]));
  for (const row of rows) byKey.get(declarationSectionOf(row.status))?.push(row);
  return DECLARATION_SECTION_KEYS.flatMap((key): DeclarationSection[] => {
    const inSection = [...(byKey.get(key) ?? [])].sort(compareDeclarationRows);
    if (inSection.length === 0) return [];
    return [{ key, rows: inSection, count: countRealDeclarations(inSection), openWhen: { ...OPENS_BY_DEFAULT[key], ...(searching ? { inUse: true } : {}) } }];
  });
}

/** Whether the row names two signers — the minor and the parent or guardian, each in the hand (§330), as the registration's page does. */
export function signedByTwo(row: Pick<RaceDayDeclarationRow, "guardianName" | "minorTypedName">): boolean {
  return Boolean(row.guardianName) && row.minorTypedName !== null;
}
