import { CLUB_LOCALITY } from "./place";

/**
 * Whether two dates of a series meet at the same place (`DECISIONS.md` §122, and §NNN for the
 * rule below).
 *
 * The owner, at a Happy Monday date marked "Nu în locul obișnuit: Parcul Sportiv Tractorul –
 * intrarea dinspre Patinoarul Olimpic, Brasov": "the location is actually the same". It was: the
 * dates had been made with "Parcul Sportiv Tractorul – intrarea dinspre Patinoarul Olimpic", and
 * one of them had since been saved with ", Brasov" after it and a map link — the same entrance,
 * written a little longer. The mark compared the two strings byte for byte, so a comma and a
 * city were a move.
 *
 * Two places are the same when **either** of these holds, and in no other case:
 *
 * 1. **Their map links are the same link**, once `mapLinkKey` has read them: the host in lower
 *    case without "www.", no trailing slash, no fragment, and none of the parameters a share
 *    button adds (`g_st`, `utm_*`). Two different short links to one pin are two different
 *    strings and are not resolved here — this answers "the same link", never "a nearby pin".
 * 2. **Their names say the same place**, once `placeKey` has read them. A name is compared, not
 *    shown: its diacritics dropped (ș and ş, ț and ţ, ă, â and î fold to s, t, a and i), lower
 *    case, every run of punctuation and spacing inside a part one space — so "–", "-", "—" and
 *    "(…)" never make a different place — and then its **trailing address parts** taken off: a
 *    part after the last comma that is the club's city (`CLUB_LOCALITY`, "municipiul Brașov"),
 *    its county ("județul Brașov", "jud. BV"), the country ("România", "Romania", "RO"), a
 *    six-digit postcode ("500152", "500152 Brașov"), a street ("Strada Turnului 5", "str.",
 *    "bulevardul", "calea", "aleea", "piața", "șoseaua", "splaiul", "street", "road", "avenue")
 *    or a house number ("nr. 5", "5A"), repeatedly, from the end, and never the first part.
 *    What is left is the place itself; two places are the same when what is left is equal.
 *
 * That is precise on purpose. "Parcul Tractorul, Brașov" and "Parcul Tractorul" are the same
 * place; "Parcul Tractorul, intrarea de nord" is not — "intrarea de nord" is none of the address
 * parts above, so an entrance, a gate or a trailhead after a comma is still a difference and
 * still marked. So is a different park, a different street given as the whole name ("Strada
 * Turnului 5" and "Strada Lungă 12"), and a kilometre on a road ("km 3" and "km 7"). No
 * similarity score, no edit distance: nothing that could call a real move a typo.
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

/** A street word at the start of a part: Romanian and English, abbreviated or not. */
const STREET = /^(strada|str|bulevardul|bulevard|bdul|b dul|bd|calea|aleea|piata|soseaua|sos|splaiul|street|st|road|rd|avenue|ave)( |$)/;

/**
 * A trailing part that says where the place is rather than which place it is — the list in the
 * file's header, after `foldPart` (so "Județul Brașov" arrives as "judetul brasov").
 */
function isAddressPart(part: string): boolean {
  if (part === CITY || part === `municipiul ${CITY}` || part === `mun ${CITY}`) return true;
  if (part === `judetul ${CITY}` || part === `jud ${CITY}` || part === "jud bv" || part === "bv") return true;
  if (part === "romania" || part === "ro") return true;
  // A Romanian postcode is six digits, sometimes followed by the city it belongs to.
  if (/^\d{6}( |$)/.test(part)) return true;
  if (STREET.test(part)) return true;
  // "nr 5", "nr 5a", or the number on its own.
  if (/^(nr )?\d+[a-z]?$/.test(part)) return true;
  return false;
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
