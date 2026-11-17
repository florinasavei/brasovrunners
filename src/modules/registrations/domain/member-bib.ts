/**
 * The members' race number (§664; the owner, 2026-10-04: «I want BVR members to have an optional special BiBs, with
 * a special design»): who wears it — the one rule, as a TypeScript predicate (§NNN).
 *
 * The owner, 2026-11-17, printing the race's bibs: «că momentan nu se deosebesc cu nimic». Until then the bib needed
 * the person to have asked («Vreau numărul de membru») AND their address to be a member account's on «Echipa» (§662),
 * and most of the club's members have no account and registered before the question existed. His choice: **everyone
 * who ticked at registration that they are a member of the club** — no account, no second tick; a wrong tick is
 * corrected by an Administrator with «Modifică datele». So three facts, all on the registration and its event:
 *
 * - the **event** offers it — its bib design's members' switch is on (`bib-design.ts#bibMemberSchema`);
 * - the **person** ticked «Sunt membru al grupului {club}» (`registrations.club_member_declared`, BR-REQ-031-06) — their
 *   own answer about themselves (§48), never checked against an account or a roster;
 * - the registration is **not marked «Elită»** — an elite bib never wears the members' design (§897).
 *
 * Nothing else: not «Vreau numărul de membru» (asked no more; its column stays in the table, read by nothing), not
 * an account on «Echipa», not `kind` (a test registration answers like a real one; the sheet's own scope
 * keeps it off the paper, §30), not the state (what prints is the sheet's scope, `bibs.ts#bibScopeWhere`). The number
 * itself is untouched: the same band, the same order of confirmation (§173) — only the bib's look differs.
 *
 * Its SQL twin is `registrations/member-bib.ts#PRINTS_MEMBER_BIB`, for the queries that decide it in the database (the
 * sheet, the registrations list and its export, the registration's page); this one is for a caller that holds the
 * three facts already (the bib's picture, `bibs/preview/route.ts`). A test runs both over every combination.
 */
export function printsMemberBib(row: { offered: boolean; declared: boolean; elite: boolean }): boolean {
  return row.offered && row.declared && !row.elite;
}

/** The export's «Member bib» cell (CSV and spreadsheet alike), in the export's own English: `yes` when the rule holds. */
export const MEMBER_BIB_EXPORT_YES = "yes";

/** The cell itself: `yes` or empty — never "no", the same reading as the member claim's column (§48). */
export function memberBibCell(prints: boolean): string {
  return prints ? MEMBER_BIB_EXPORT_YES : "";
}
