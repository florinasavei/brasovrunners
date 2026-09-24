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
