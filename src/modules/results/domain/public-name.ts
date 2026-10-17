import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";

/**
 * Whose name a published result carries (§NNN, extending the public list's rule — §143, §396, §421, §743, BR-REQ-039-01).
 *
 * The same tick, one for the list and the results: «Vreau să apar pe lista de participanți & rezultate». A result shows a name
 * only for a runner who passes **every** condition the public list asks of a name, and one more:
 *
 * - the runner is **registered** and **ticked** the box (`registrations.list_opt_out` false) and the registration has a display name;
 * - the registration is **confirmed** — a cancelled, expired or otherwise not-confirmed one never names anybody, though its result
 *   may stay in the club's backoffice;
 * - the registration is not **one of the event's special guests the event hides** (§743: «În afara locurilor», shown only where the
 *   event shows its guests);
 * - the registration was made **under a privacy notice that described the named results** (`registrations.privacy_notice_version` at
 *   or above `firstResultsNoticeVersion`, §421's line for the states): a tick given under the older notice — «Rezultate cu nume nu
 *   publicăm încă», with terms that promised to ask separately first — agreed to a list, not to a ranking by name.
 *
 * **A runner the club typed by hand** (no registration, so no form and no tick) is named under a rule of its own (§NNN, amending the
 * above; the owner, 2026-10-17: «ar trebui să-l putem adăuga totuși în sistem manual … să-l punem în rezultat»): only while a staff
 * member **recorded that the person agreed** to appear by name (`event_results.name_agreed_at`, the actor and the moment kept — the
 * race-day desk's paper declaration has the same shape, §67: the participant agrees, a staff member records it), the typed name is not
 * blank, and the notice in force describes the results (`firstResultsNoticeVersion` is not null: the person agreed to the words the
 * staff read to them, the notice's own). A registered runner's row ignores the staff mark entirely: their name follows their own tick.
 *
 * Every other row — an unticked runner, a typed runner nobody recorded an agreement for, one whose registration was erased, cancelled or
 * hidden, or one who registered before the notice — is «Participant #bib»: the position, the number, the time and the category, with no
 * name. Pure, so the page that draws it, the backoffice that previews it and the test that pins it read one rule.
 */
export type PublicNameInput = {
  registered: boolean;
  ticked: boolean;
  displayName: string | null | undefined;
  /** The registration's state is `CONFIRMED`. */
  confirmed: boolean;
  /** The registration sits «În afara locurilor» and the event does not show its special guests publicly. */
  hidden: boolean;
  /** The privacy notice version the registration recorded; null for a row without one. */
  noticeVersion: number | null;
  /** The first approved notice that described the results (`findFirstResultsNoticeVersion`); null when none did. */
  firstResultsNoticeVersion: number | null;
  /** A runner typed by hand: the staff recorded that the person agreed to appear by name (`name_agreed_at` is set). Ignored for a registered runner. */
  typedNameAgreed: boolean;
  /** A runner typed by hand: the name the club typed; null for a registered one, whose registration's `displayName` answers. */
  typedDisplayName: string | null | undefined;
};

export function publicResultName(runner: PublicNameInput): string | null {
  if (!runner.registered) {
    // The staff-recorded agreement of a runner typed by hand: under a notice that describes the results, with a name to show.
    if (!runner.typedNameAgreed || runner.firstResultsNoticeVersion === null) return null;
    const typed = runner.typedDisplayName?.trim();
    return typed ? typed : null;
  }
  if (!runner.ticked || !runner.confirmed || runner.hidden) return null;
  if (runner.firstResultsNoticeVersion === null || runner.noticeVersion === null || runner.noticeVersion < runner.firstResultsNoticeVersion) return null;
  const name = runner.displayName?.trim();
  return name ? name : null;
}

/**
 * «Participant #123» in the reader's language, for a result with no name to show: read from the catalogue the
 * public page's table reads (`Event.results.anonymous`, `{bib}` filled here), outside a request like the notice's
 * own words, so the cached read and the page cannot say it two ways.
 */
export function anonymousResultLabel(locale: string, bibNumber: number): string {
  const template = locale === "en" ? en.Event.results.anonymous : ro.Event.results.anonymous;
  return template.replace("{bib}", String(bibNumber));
}
