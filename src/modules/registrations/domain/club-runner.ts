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
 * The «Club runner» cell of both exports (§787, amended): "Da" for one of the club's runners, empty otherwise —
 * never "Nu", for the reason «Club member»'s cell never says "No" (§662). It is `isClubRunner`'s answer written
 * where a spreadsheet's own formulas and colour rules can read it: the typed-club match (§753) cannot be written
 * as a formula, so the footer's `COUNTIF` and the blue on a runner's cells look at this column instead of redoing
 * the rule. The word is Romanian like the club's own copy; the rules and the formulas read it from here, so no
 * file says it twice.
 */
export const CLUB_RUNNER_YES = "Da";

export function clubRunnerCell(clubRunner: boolean | undefined): string {
  return clubRunner ? CLUB_RUNNER_YES : "";
}
