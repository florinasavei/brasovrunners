/**
 * «Oraș» on the registrations list (§660): where the person lives, as one short cell — the city as typed,
 * followed by the country's ISO code in brackets only when it is not Romania («Bristol (GB)»), because
 * most of the club's runners live in Romania and a «(RO)» on every row is noise. Empty when no city was
 * given: the list prints «—» for it, as it does for every column with nothing to say.
 *
 * The country is `registrations.country` (§510): an ISO 3166-1 alpha-2 code, `RO` by default. The list's
 * cell and its phone row read this one function; the export keeps the country and the city in their own
 * columns, as the spreadsheet always has, so a sheet can filter by either.
 */
const HOME_COUNTRY = "RO";

export function cityLabel(city: string | null | undefined, country: string | null | undefined): string {
  const typed = city?.trim() ?? "";
  if (!typed) return "";
  const code = country?.trim().toUpperCase() ?? "";
  return code && code !== HOME_COUNTRY ? `${typed} (${code})` : typed;
}
