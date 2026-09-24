import { CLUB_LOCALITY } from "./place";

/**
 * Whether two dates of a series meet at the same place (`DECISIONS.md` §122, and §NNN for the
 * rule below).
 *
 * The owner, at a Happy Monday date marked "Nu în locul obișnuit: Parcul Sportiv Tractorul –
 * intrarea dinspre Patinoarul Olimpic, Brasov": "the location is actually the same". It was. The
 * series was made with "Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic" and no map
 * link (QA's nine dates still read exactly that on 2026-09-24); production's pages read "…
 * Patinoarul Olimpic, Brasov", with the map link, on every date that day. The mark named the
 * longer spelling, so on the day it was drawn most of the dates on view still said it the shorter
 * way. It compared the two strings byte for byte, so ", Brasov" — a comma and the city the club
 * runs in, without its "ș" — was a move.
 *
 * **What is compared** is the name the reader's page shows, in the reader's language: a public row's
 * `locationName` is already that language's own name, else the event's (`PUBLIC_COLUMNS`, the rule
 * `place.ts#placeNameIn` states, §362), so the Romanian calendar compares Romanian names and the
 * English one English names; the backoffice, which has no reader's language, compares the event's
 * own name — the Romanian box's since §362. The street address an older event still carries
 * (`location_address`, no longer asked for since §36's follow-up) is **not** compared, although
 * `place.ts#placeShown` folds it in: that answers "did this save move this event", one row before
 * and after, where this answers "is this date where the others meet" — and a date saved since,
 * whose address the save cleared, would otherwise be "moved" away from the dates that keep it.
 *
 * Two places are the same when **either** of these holds, and in no other case:
 *
 * 1. **Their map links are the same link**, once `mapLinkKey` has read them: the scheme ignored,
 *    the host in lower case without "www.", no trailing slash, no fragment, and none of the
 *    parameters a share button adds (`g_st`, `utm_*`). Two different short links to one pin are
 *    two different strings and are not resolved here — this answers "the same link", never "a
 *    nearby pin", and it never makes two different links a difference: rule 2 still applies.
 * 2. **Their names say the same place**, once `placeKey` has read them. A name is compared, not
 *    shown: its diacritics dropped (ș and ş, ț and ţ, ă, â and î fold to s, t, a and i), lower
 *    case, every run of punctuation and spacing inside a part one space — so "–", "-", "—", "( )"
 *    and a double space never make a different place — and then its **trailing address parts**
 *    taken off, one by one from the end, never the first part. A part is what stands between two
 *    commas, and a trailing one is an address part when, folded, it is exactly:
 *    - the club's city (`CLUB_LOCALITY`): "Brașov", "Brasov", "municipiul Brașov", "mun. Brașov";
 *    - its county: "județul Brașov", "jud. Brașov", "jud. BV", "BV", "Brașov County";
 *    - the country: "România", "Romania", "RO";
 *    - a postcode: six digits, alone or with the city — "500152", "500152 Brașov";
 *    - a Romanian street, by the word it starts with: "strada"/"str.", "bulevardul"/"bd."/"b-dul",
 *      "calea", "aleea", "șoseaua"/"șos.", "splaiul" — "Aleea Tiberiu Brediceanu", "str. Turnului
 *      nr. 5";
 *    - an English street, by the word it ends with: "street"/"st", "road"/"rd", "avenue"/"ave",
 *      "boulevard"/"blvd" — "Turnului Street", "5 Eroilor Blvd";
 *    - a house number: "nr. 5", "no. 5", "5", "5A".
 *    What is left is the place itself; two names are the same place when what is left is equal.
 *
 * That is precise on purpose. "Parcul Tractorul, Brașov" and "Parcul Tractorul" are the same
 * place; "Parcul Tractorul, intrarea de nord" is not — "intrarea de nord" is none of the parts
 * above, so an entrance, a gate, a trailhead or a square ("Piața Sfatului") after a comma is still
 * a difference and still marked. So is a different park, a different street given as the whole
 * name ("Strada Turnului 5" and "Strada Lungă 12" — the first part is never taken off), and a
 * kilometre on a road ("km 3" and "km 7"). No similarity score, no edit distance: nothing that
 * could call a real move a typo.
 *
 * Pure, so the listing, the calendar, the backoffice and a test read the same answer.
 */

/** A place as a date of a series carries it: the name the reader is shown, and its map link. */
export type PlaceFacts = { locationName: string | null; mapUrl?: string | null };

/** The club's city as compared: "brasov". */
const CITY = foldPart(CLUB_LOCALITY);

/**
 * One comma-separated part as compared: no diacritics, lower case, every run of anything that is
 * not a letter or a digit one space. Unicode-aware, so a letter of any alphabet survives.
 */
function foldPart(part: string): string {
  return part
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The city, the county and the country, as whole parts (the header's first three kinds). */
const WHERE = new Set([
  CITY,
  `municipiul ${CITY}`,
  `mun ${CITY}`,
  `judetul ${CITY}`,
  `jud ${CITY}`,
  `${CITY} county`,
  "jud bv",
  "bv",
  "romania",
  "ro",
]);

/** A Romanian postcode: six digits, alone or with the city it belongs to. */
const POSTCODE = new RegExp(`^(\\d{6}( ${CITY})?|${CITY} \\d{6})$`);

/** A Romanian street, by the word it starts with ("b-dul" folds to "b dul", "șos." to "sos"). */
const ROMANIAN_STREET = /^(strada|str|bulevardul|bulevard|bdul|b dul|bd|calea|aleea|soseaua|sos|splaiul) \S/;

/** An English street, by the word it ends with. */
const ENGLISH_STREET = /\S (street|st|road|rd|avenue|ave|boulevard|blvd)$/;

/** A house number: "nr 5", "no 5a", "5". */
const HOUSE_NUMBER = /^((nr|no) )?\d+[a-z]?$/;

/** A trailing part that says where the place is rather than which place it is (the header's list). */
function isAddressPart(part: string): boolean {
  return WHERE.has(part) || POSTCODE.test(part) || ROMANIAN_STREET.test(part) || ENGLISH_STREET.test(part) || HOUSE_NUMBER.test(part);
}

/**
 * The place a name names, as compared: its parts folded (`foldPart`), the trailing address parts
 * taken off, the rest joined by one space — so a comma inside the place ("Parcul Tractorul,
 * intrarea de nord") and a dash ("Parcul Tractorul – intrarea de nord") read alike too.
 */
export function placeKey(name: string): string {
  const parts = name
    .split(",")
    .map(foldPart)
    .filter((part) => part !== "");
  while (parts.length > 1 && isAddressPart(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

/** A share button's own parameters, which say who shared the link and not where it points. */
const SHARE_PARAMETER = /^(g_st|utm_.*)$/;

/**
 * A map link as compared (rule 1 of the header), or null when there is none or it is not a URL.
 */
export function mapLinkKey(url: string | null | undefined): string | null {
  if (!url || !url.trim()) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  for (const name of [...parsed.searchParams.keys()]) {
    if (SHARE_PARAMETER.test(name)) parsed.searchParams.delete(name);
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/+$/, "");
  const query = parsed.searchParams.toString();
  return `${host}${path}${query ? `?${query}` : ""}`;
}

/**
 * A place as compared: the name's key (`placeKey`, null for no name), and every map link known to
 * point at it (`mapLinkKey`) — one for a single date, all of them for a series' usual place, whose
 * dates may carry the same pin under names written differently (`usualOf`).
 */
export type PlaceIdentity = { key: string | null; mapLinks: readonly string[] };

export function placeIdentity(place: PlaceFacts): PlaceIdentity {
  const link = mapLinkKey(place.mapUrl);
  const key = place.locationName ? placeKey(place.locationName) : "";
  return { key: key === "" ? null : key, mapLinks: link ? [link] : [] };
}

/** The header's rule, against a place already read: the same map link, or the same name once read. */
export function isAtPlace(place: PlaceFacts, at: PlaceIdentity): boolean {
  const link = mapLinkKey(place.mapUrl);
  if (link !== null && at.mapLinks.includes(link)) return true;
  const key = place.locationName ? placeKey(place.locationName) : "";
  return key !== "" && key === at.key;
}

/** The header's rule between two dates. Symmetric: either may be the one asked about. */
export const samePlace = (a: PlaceFacts, b: PlaceFacts): boolean => isAtPlace(a, placeIdentity(b));
