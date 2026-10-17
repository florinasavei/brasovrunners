import en from "../../../../messages/en.json";
import ro from "../../../../messages/ro.json";

/**
 * Whose name a published result carries (§NNN, extending the public list's rule — §143, §396, BR-REQ-039-01).
 *
 * The same tick, one for the list and the results: «Vreau să apar pe lista de participanți & rezultate». A result
 * shows a name only for a **registered** runner who **ticked** it (`registrations.list_opt_out` false) and whose
 * registration has a display name; every other row — an unticked runner, a runner the club typed by hand (who
 * ticked nothing, and whose consent no staff member may give for them), one whose registration was erased — is
 * «Participant #bib»: the position, the number, the time and the category, with no name.
 *
 * Pure, so the page that draws it, the cache that holds it and the test that pins it read one rule.
 */
export function publicResultName(runner: { registered: boolean; ticked: boolean; displayName: string | null | undefined }): string | null {
  if (!runner.registered || !runner.ticked) return null;
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
