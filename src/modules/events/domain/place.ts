/**
 * The city every club event happens in (`DECISIONS.md` §328).
 *
 * The one thing said about a place that is not announced yet where a *name* has to stand rather
 * than a sentence: the structured data's `Place` (schema.org requires one, and "Brașov" is true)
 * and the declaration's `{{eventLocation}}` ("în locația Brașov" is a statement a runner can sign;
 * "în locația Locația se anunță în curând" is not a sentence). Every surface a person reads says
 * "Locația se anunță în curând" instead, from the `Event` catalogue.
 */
export const CLUB_LOCALITY = "Brașov";

/*
  The meeting point in each language (`DECISIONS.md` §36, §303, §NNN) — pure, so the editor, the
  service and the browser read one rule.

  Where it is stored has not changed: `events.location_name` is the event's own meeting point (the
  desk, the backoffice and every reader without a language at hand read it) and each translation's
  `location_name` is that language's name (migration `0059`). What changed in §NNN is how it is
  asked: once per language, in the Locul box, both required — the Romanian box writes the event's
  column and the Romanian row, the English box the English row. So a saved event names the place in
  both rows, and the fallback below only speaks for an event nobody has saved since.
*/

/**
 * The field of the event's form that carries each language's name, and the name the form posts it
 * under (`event.<field>`) — what a refusal and a publication gap point at. The Romanian one keeps
 * the old field's name because it is also the event's own meeting point.
 */
export const PLACE_NAME_FIELD = { ro: "locationName", en: "locationNameEn" } as const;

export type PlaceNameLocale = keyof typeof PLACE_NAME_FIELD;
export type PlaceNameField = (typeof PLACE_NAME_FIELD)[PlaceNameLocale];

/**
 * The place's name as one language's page shows it: the language's own when it has one, else the
 * event's — never the other language's (BR-REQ-040-02). The same rule as the public reads'
 * `COALESCE(NULLIF(btrim(translation), ''), event)` (`events/repository.ts`), for the code that has
 * the rows in hand. `null` when neither says anything.
 */
export function placeNameIn(event: { locationName: string | null }, own: string | null | undefined): string | null {
  const mine = own?.trim();
  if (mine) return mine;
  const shared = event.locationName?.trim();
  return shared ? shared : null;
}

/**
 * What the Locul box shows for one language: the name its page shows, with the street address an
 * older event still carries folded in after it — the box has had no address of its own since §36's
 * follow-up, and the save writes the address as null, so what the organizer reads in the box is
 * what the page said. An event opened in the editor shows exactly what its pages show today.
 */
export function placeInBox(event: { locationName: string | null; locationAddress: string | null }, own: string | null | undefined): string {
  return [placeNameIn(event, own), event.locationAddress?.trim()].filter((part): part is string => Boolean(part)).join(", ");
}

/** Text as a reader takes it in: spacing is not a different place. */
const spoken = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * The place one language's page shows, spacing aside — `placeInBox`, compared. Every "did the
 * place move" asks this one question (§NNN): the series edit (`service.ts#placesShown`), the
 * participants' notice (`event-changes.ts`) and the English name that follows the Romanian one
 * below. The street address an older event carries stands after a language's own name as much as
 * after the event's, because that is where the page shows it.
 */
export function placeShown(event: { locationName: string | null; locationAddress: string | null }, own: string | null | undefined): string {
  return spoken(placeInBox(event, own));
}

/**
 * The English name one save of an **older event** writes (§NNN, found by review): the Romanian
 * one, when the English page had no name of its own and the organizer moved only the Romanian.
 *
 * An event saved before the Locul box asked once per language has no English row name: its English
 * page shows the event's meeting point, which is what the English box opens with. Moving the
 * Romanian box alone used to store that old name as English, explicitly — and a series save then
 * left every other date's English page following the new Romanian name, while the edited date's
 * kept the old one. Here the English page follows the Romanian, as it always had: the English box
 * posted exactly what the English page showed, and the Romanian place is not the one it showed.
 *
 * Nothing else is touched (found by re-review), so the save never says something the editor did not:
 * - **a blank English box stays blank.** An event with no place yet shows "" in English, and a
 *   blank box posted with the switch on (§328) "equals" that — but it is the organizer's to fill,
 *   and `placeRule` asks for it when the switch goes off. Filled here, the English page would name
 *   the place in Romanian and nothing would ever ask again;
 * - **a name of its own in either language keeps what was posted.** An English row with one is the
 *   organizer's; and when only the Romanian row had one, the two pages already said different
 *   things, so the editor's line under the English box says the English stayed — and it does;
 * - **an English box the organizer changed** is theirs.
 *
 * The editor's box does the same while it is typed (`englishFollowsTyping`), and a save from the
 * editor with JavaScript running skips this rule altogether (`placeNamesAsTyped` in the service):
 * what its English box holds is what the organizer left there, put back to the old name included.
 * This is the rule for a save that did not come through it.
 */
export function englishNameAfterSave(
  before: { locationName: string | null; locationAddress: string | null },
  rows: { ro: string | null | undefined; en: string | null | undefined },
  posted: { ro: string | null; en: string | null },
): string | null {
  if (spoken(posted.en) === "") return posted.en;
  if (spoken(rows.en) !== "" || spoken(rows.ro) !== "") return posted.en;
  const shown = placeShown(before, null);
  if (spoken(posted.en) !== shown) return posted.en;
  if (spoken(posted.ro) === shown) return posted.en;
  return posted.ro;
}

/**
 * Whether the English box follows the Romanian one as it is typed (§NNN, found by review): while
 * both say the same place. An older event opens with the event's name in both, a place called the
 * same in both languages stays so, and "Același nume și în engleză" links them from then on —
 * moving the Romanian then moves the English with it, on the screen, before anything is saved. An
 * English box that says something else, or nothing, is the organizer's own and is never written.
 */
export function englishFollowsTyping(romanianBefore: string, english: string): boolean {
  const said = spoken(english);
  return said !== "" && said === spoken(romanianBefore);
}

/**
 * Whether "Același nume și în engleză" may fill the English box: only an empty one, and only with
 * something (§NNN, found by review). It never writes over a name the organizer typed — a thumb
 * under the English box on a phone would otherwise replace "Tractorul Park" in one tap, past the
 * browser's own undo.
 */
export function mayCopyToEnglish(romanian: string, english: string): boolean {
  return spoken(romanian) !== "" && spoken(english) === "";
}

/**
 * Whether the English box still names the place the Romanian one has moved away from (§NNN, found
 * by review): the Romanian differs from what was stored, the English is what was stored, and it is
 * a name of its own ("Tractorul Park") — so it did not follow, and says so under the box.
 */
export function englishLeftBehind(stored: { ro: string; en: string }, now: { ro: string; en: string }): boolean {
  const english = spoken(now.en);
  return english !== "" && spoken(now.ro) !== spoken(stored.ro) && english === spoken(stored.en) && english !== spoken(now.ro);
}
