import { membershipOf } from "./membership";
import { namesTheClub } from "./public-list-club";

/**
 * «Brașov Runners» in the registrations Excel's statistics footer (§787): whether a registration is one of the
 * club's runners, for the footer's «how many are ours» (the owner, 2026-10-15: «I can show „how many Brașov
 * Runners”, how many active, etc.»).
 *
 * The platform keeps three signals of belonging, none of them complete on its own, and the footer counts a row
 * that has **any** of them — the club's runners have no accounts to be sure by, so the claim and the typed name
 * are what the club has (§756):
 *
 * - **verified** — the participant's address is a live member account on «Echipa» (`membershipOf`, §662);
 * - **declared** — the person ticked «Sunt membru al grupului {club}» (`membershipOf`, §662);
 * - **named** — the free-text club they typed names the club, in any spelling the public list accepts
 *   («Brașov Runners», «Runners Brașov», «BVR»…, `namesTheClub`, §753, §766).
 *
 * Pure, and only ever read: the signals are the ones the list and the export already show, so the footer cannot
 * say something the rows above it do not. It is a count for the club's own use, never a verdict on a person.
 */
export function isClubRunner(row: { clubMemberDeclared: boolean; memberVerified: boolean; clubName?: string | null }): boolean {
  return membershipOf({ declared: row.clubMemberDeclared, verified: row.memberVerified }) !== null || namesTheClub(row.clubName);
}

/**
 * The «Club runner» cell of both exports (§787, amended): "Yes" for one of the club's runners, empty otherwise —
 * never "No", for the reason «Club member»'s cell never says "No" (§662). It is `isClubRunner`'s answer written
 * where a spreadsheet's own formulas and colour rules can read it: the typed-club match (§753) cannot be written
 * as a formula, so the footer's `COUNTIF` and the lavender on a club runner's cells without the tick look at this column instead of redoing
 * the rule. The word is English like the sheet's other words ("yes", "verified", "declared"); the rules and
 * the formulas read it from here, so no file says it twice. It is the spreadsheet's one «Yes», shared by «Club runner»
 * and «Member tick (declared)» (§NNN), so it carries the neutral name `YES_CELL`.
 */
export const YES_CELL = "Yes";

export function clubRunnerCell(clubRunner: boolean): string {
  return clubRunner ? YES_CELL : "";
}

/**
 * The «Member tick (declared)» cell of the spreadsheet (§NNN; the owner, 2026-10-16: «vreau în excel separat să văd bifa
 * „E din Brașov Runners” și în funcție de asta să colorez»): "Yes" when the person ticked «Sunt membru al grupului {club}»
 * (`clubMemberDeclared`), empty otherwise — the tick alone, apart from «Club member»'s words (which mix the tick with a
 * member account) and from «Club runner» (which adds a typed club). The colour rules and the footer's line read it from
 * the sheet, so an offline edit of the cell moves both.
 */
export function memberTickCell(declared: boolean): string {
  return declared ? YES_CELL : "";
}
