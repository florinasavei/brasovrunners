import { holdsResultsNameConsent } from "./name-consent";
import { type PublicNameInput, publicResultName } from "./public-name";

/**
 * Why a published result carries no name (§985; the owner, 2026-11-18, looking at «Clasament» with «Pe site: Participant #001» on
 * every line: «toate BIB-urile insa doar numele celor care au bifat ca vor sa apara se vad»). «Clasament» says it under each line's
 * «Pe site: Participant #…», so the club reads what keeps the name off — and that only the runner can change most of it.
 *
 * **One rule, not two.** The reason reads `publicResultName`'s own input and asks it first: `named` exactly when it gives a name, and
 * otherwise the first of its conditions that failed. Nothing here can name anybody, and nothing here can fail to explain a «Participant #…»
 * (`tests/unit/results/public-name-reason.test.ts` walks every combination of the input and holds the two together). The order:
 *
 * 1. `noResultsNotice` — no approved privacy notice has described the results (`firstResultsNoticeVersion` null): nobody is named,
 *    registered or typed, ticked or not. First, because it is the same for every line, and the page says it once at the top.
 * 2. A runner the club typed by hand (no registration): `noName` — no name to show (an erased registration's row keeps its result
 *    nameless) — then `typedNoAgreement`: nobody recorded on the line that the person agreed to appear by name (§810).
 * 3. A registered runner: `notTicked` — the person's own «Vreau să apar pe lista de participanți & rezultate» is off; `hiddenByClub` — the
 *    person ticked it, and an Administrator unticked «Apare pe site» on the registration while it is marked «Elită» or «Ambasador» (§910,
 *    §948: a staff tick that only hides); `notConfirmed` — the registration is not confirmed (cancelled, expired); `hiddenGuest` — a special
 *    guest the event does not show publicly (§743); `olderNotice` — registered under a notice older than the first that described the
 *    results and not asked since («Vreau să apar cu numele în clasament», §879); `noName` — no name to show.
 *
 * Pure: the page reads it through `results.ts#readEventResults`, which hands every line `named` and this reason from one input.
 */
export const PUBLIC_NAME_REASONS = ["named", "noResultsNotice", "noName", "typedNoAgreement", "notTicked", "hiddenByClub", "notConfirmed", "hiddenGuest", "olderNotice"] as const;

export type PublicNameReason = (typeof PUBLIC_NAME_REASONS)[number];

/** The reasons a line can carry while it is «Participant #…» — each with its sentence under `Admin.results.publicWhy`. */
export const UNNAMED_REASONS = PUBLIC_NAME_REASONS.filter((reason): reason is Exclude<PublicNameReason, "named"> => reason !== "named");

/**
 * `publicResultName`'s input, and the one fact it does not need: whether `ticked` is false because of the club rather than the person.
 * `results.ts#tickedForTheSite` folds the two into `ticked` (the club's «Apare pe site» only hides), so the reason carries it beside —
 * a boolean worked out there, beside the tick, from the same columns (`results.ts#siteHiddenByClub`): this file reads no mark.
 */
export type PublicNameReasonInput = PublicNameInput & {
  /** The person ticked «Vreau să apar…» and an Administrator unticked «Apare pe site» on the marked registration. Never names anybody. */
  hiddenByClub?: boolean;
};

export function publicNameReason(runner: PublicNameReasonInput): PublicNameReason {
  if (publicResultName(runner) !== null) return "named";
  if (runner.firstResultsNoticeVersion === null) return "noResultsNotice";
  if (!runner.registered) return runner.typedDisplayName?.trim() ? "typedNoAgreement" : "noName";
  if (!runner.ticked) return runner.hiddenByClub === true ? "hiddenByClub" : "notTicked";
  if (!runner.confirmed) return "notConfirmed";
  if (runner.hidden) return "hiddenGuest";
  const registeredUnderResults = runner.noticeVersion !== null && runner.noticeVersion >= runner.firstResultsNoticeVersion;
  // Under the club's «Toate numele» (§1029) the notice is not asked.
  if (runner.allNames !== true && !registeredUnderResults && !holdsResultsNameConsent(runner, runner.firstResultsNameAskNoticeVersion)) return "olderNotice";
  // Every condition above holds and still no name: the name itself is blank.
  return "noName";
}

/**
 * What a line of «Clasament» carries about the site, from ONE input: `named` is `publicResultName`'s own answer, exactly as before, and
 * `nameReason` says why not — so the line's «Pe site: …» and the sentence under it can never disagree.
 */
export function publicNameVerdict(runner: PublicNameReasonInput): { named: boolean; nameReason: PublicNameReason } {
  return { named: publicResultName(runner) !== null, nameReason: publicNameReason(runner) };
}
