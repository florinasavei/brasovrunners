import { DomainError } from "@/shared/errors/domain-error";

/**
 * Where a point is (§961; the owner, 2026-11-17, of the volunteers' points: «să pun nume punct și la ce km e și coordonate
 * punct») — the pure part: what a person pastes from a maps application read into a latitude and a longitude, the one way
 * the pair is written back, and the address that opens it on a map.
 *
 * Pure and free of the database and of React, so every shape a person may paste is unit-tested without either. **Nothing is
 * ever fetched:** a pair is read from the characters typed, or refused. A shortened share link, which carries no numbers
 * and would have to be followed to learn them, is refused with the sentence that says how to write them.
 *
 * The pair is kept to six decimals — about a tenth of a metre, finer than a telephone's own fix — which is what the columns
 * hold (`event_checkpoints.latitude`, `longitude`).
 */

export type Coordinates = { latitude: number; longitude: number };

/** The box a refusal names: the form's «Coordonate». */
export const COORDINATES_BOX = "coordinates";

/** More than anything a maps application copies — a link with its data included: a longer text is refused unread. */
export const COORDINATES_TEXT_MAX = 2000;

/**
 * What was typed is in no shape read here, or is no place on Earth. A validation error naming the box, whose `reason` is the
 * catalogue's own sentence for it (`Admin.errors.COORDINATES_INVALID`: write them as Google Maps does, for example
 * 45.64271, 25.58871) — the action returns it as the form's error code, as a `CheckpointRefusal`'s reason is.
 */
export class CoordinatesRefusal extends DomainError {
  readonly reason = "COORDINATES_INVALID" as const;
  constructor(box: string = COORDINATES_BOX) {
    super("VALIDATION_ERROR", "COORDINATES_INVALID", [box]);
    this.name = "CoordinatesRefusal";
  }
}

const DECIMALS = 6;
const SCALE = 10 ** DECIMALS;
const round = (value: number): number => {
  const rounded = Math.round(value * SCALE) / SCALE;
  // No negative zero: the equator and Greenwich are written «0».
  return rounded === 0 ? 0 : rounded;
};

type Side = { axis: "latitude" | "longitude"; sign: 1 | -1 };

/** Which side of the equator or of Greenwich a letter says: N, S, E, W — and «V», the Romanian for west (vest). */
const SIDES: Readonly<Record<string, Side>> = {
  N: { axis: "latitude", sign: 1 },
  S: { axis: "latitude", sign: -1 },
  E: { axis: "longitude", sign: 1 },
  W: { axis: "longitude", sign: -1 },
  V: { axis: "longitude", sign: -1 },
};

/** One of the two numbers as typed: its size in degrees, its sign, the side its letter names (when it has one), and where it ends. */
type Half = { degrees: number; negative: boolean; side: Side | null; end: number };

// Sticky patterns, each read from where the one before stopped; none takes the space after it, which is the separator's.
// A decimal mark is a point here: `asTyped` below is what reads a decimal comma, by turning it into one first.
/** A letter before the number: «N 45.64271». */
const LEADING_LETTER = /([NSEWV])\s*(?=[+\-\d])/iy;
/** A sign, directly before its number: a dash with a space after it is somebody's separator, never a minus. */
const SIGN = /([+-])(?=\d)/y;
/** Degrees with minutes, and seconds when given: 45°38'33.8" — or degrees and decimal minutes, 45°38.563'. */
const DEGREES_MINUTES = /(\d{1,3})\s*[°º˚]\s*(\d{1,2}(?:\.\d+)?)\s*['′’](?:\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|″|”|''|′′|’’))?/y;
/** Decimal degrees, with or without the degree sign: 45.64271 · 45.64271°. */
const DECIMAL_DEGREES = /(\d{1,3}(?:\.\d+)?)(?:\s*[°º˚])?/y;
/** A letter after the number: «45.64271° N». Never the first letter of a word, nor of the next number. */
const TRAILING_LETTER = /\s*([NSEWV])(?![\p{L}\d])/iuy;
/** What stands between the two: a comma or a semicolon, or just a space. */
const SEPARATOR = /\s*[,;]\s*|\s+/y;

function take(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(text);
}

/**
 * The ways one of the two numbers can be read at `at` — two when a letter follows it, since that letter may be this
 * number's («45.6 N 25.5 E») or the next one's («45.6 N25.5»): the caller keeps the first reading that takes the whole text.
 */
function halvesAt(text: string, at: number): Half[] {
  let index = at;
  const leading = take(LEADING_LETTER, text, index);
  if (leading) index += leading[0].length;
  const sign = take(SIGN, text, index);
  if (sign) index += sign[0].length;

  let degrees: number;
  const withMinutes = take(DEGREES_MINUTES, text, index);
  if (withMinutes) {
    const minutes = Number(withMinutes[2]);
    const seconds = withMinutes[3] === undefined ? 0 : Number(withMinutes[3]);
    if (minutes >= 60 || seconds >= 60) return [];
    degrees = Number(withMinutes[1]) + minutes / 60 + seconds / 3600;
    index += withMinutes[0].length;
  } else {
    const decimal = take(DECIMAL_DEGREES, text, index);
    if (!decimal) return [];
    degrees = Number(decimal[1]);
    index += decimal[0].length;
  }

  const negative = sign?.[1] === "-";
  const bare: Half = { degrees, negative, side: leading ? SIDES[leading[1].toUpperCase()] : null, end: index };
  // A letter on each side of one number would say its side twice: with one before it, none is read after it.
  const trailing = leading ? null : take(TRAILING_LETTER, text, index);
  if (!trailing) return [bare];
  return [{ degrees, negative, side: SIDES[trailing[1].toUpperCase()], end: index + trailing[0].length }, bare];
}

/** One half as a signed number of degrees, or null: a minus sign and a letter together say the side twice. */
function signed(half: Half): number | null {
  if (half.side) return half.negative ? null : half.degrees * half.side.sign;
  return half.negative ? -half.degrees : half.degrees;
}

const other = (axis: Side["axis"]): Side["axis"] => (axis === "latitude" ? "longitude" : "latitude");

/** Two halves as a pair — the latitude first unless the letters say otherwise — or null when they are no place on Earth. */
function pairOf(first: Half, second: Half): Coordinates | null {
  const a = signed(first);
  const b = signed(second);
  if (a === null || b === null) return null;
  const firstAxis = first.side?.axis ?? (second.side ? other(second.side.axis) : "latitude");
  const secondAxis = second.side?.axis ?? other(firstAxis);
  // «45 N, 46 N»: two latitudes are no pair.
  if (firstAxis === secondAxis) return null;
  const latitude = round(firstAxis === "latitude" ? a : b);
  const longitude = round(firstAxis === "latitude" ? b : a);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** A pair written with points as decimal marks, taking the whole of `text` — or null. */
function pointPair(text: string): Coordinates | null {
  for (const first of halvesAt(text, 0)) {
    const separator = take(SEPARATOR, text, first.end);
    if (!separator) continue;
    for (const second of halvesAt(text, first.end + separator[0].length)) {
      // The first reading that takes the whole text decides: what it says is a place, or the text is refused.
      if (second.end === text.length) return pairOf(first, second);
    }
  }
  return null;
}

/**
 * A pair as a person types it. Points as decimal marks first — the shape every maps application copies — and only when
 * that is no pair, commas: «45,64271; 25,58871», «45,64271 25,58871», «45,64271, 25,58871». A comma is read as a decimal
 * mark where it stands between two digits; the one shape that leaves in doubt, four runs of digits joined by commas alone
 * («45,64271,25,58871»), has one reading that is a pair — the middle comma parts them. Three runs («45,5,25») have two
 * readings, and are refused rather than guessed; so are two («45,64»), by `oneNumberWithComma` before this is asked.
 */
function asTyped(text: string): Coordinates | null {
  const pointed = pointPair(text);
  if (pointed) return pointed;
  const four = /^([+-]?\d{1,3}),(\d+),([+-]?\d{1,3}),(\d+)$/.exec(text);
  if (four) return pointPair(`${four[1]}.${four[2]}, ${four[3]}.${four[4]}`);
  const commas = text.replace(/(?<=\d),(?=\d)/g, ".");
  return commas === text ? null : pointPair(commas);
}

/**
 * Whether the text, its commas between two digits read as decimal marks, is one number alone — «45,64», «-45,6»,
 * «45,64° N», «N 45,64»: one coordinate written with a decimal comma, or two whole degrees with nothing but a comma between
 * them. Two readings, as three runs have (`asTyped`): refused rather than guessed, since the guess would be a pair a whole
 * continent away and the volunteer's email would carry its link. Asked of what a person typed into the box, never of a
 * link's value: in an address a comma is never a decimal mark, and «query=0%2C0» is the pair it says.
 */
function oneNumberWithComma(text: string): boolean {
  const commas = text.replace(/(?<=\d),(?=\d)/g, ".");
  return commas !== text && halvesAt(commas, 0).some((half) => half.end === commas.length);
}

/** What a person typed, tidied: one line, plain spaces, a plain minus, and no brackets around the whole of it. */
function tidy(text: string): string {
  const flat = text
    .replace(/[   ]/g, " ")
    .replace(/−/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const bracketed = /^[([](.*)[)\]]$/.exec(flat);
  return bracketed ? bracketed[1].trim() : flat;
}

/** A link's value as it was before it was put in an address: `%2C` a comma again, `+` a space. Never throws. */
function decoded(value: string): string {
  const spaced = value.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return spaced;
  }
}

/** A pair that a link carries as a value — «45.64271,25.58871», with a label in brackets after it or `loc:` before it. */
function carried(value: string): Coordinates | null {
  const plain = tidy(decoded(value))
    .replace(/^loc:\s*/i, "")
    .replace(/\s*\([^()]*\)$/, "");
  return plain === "" ? null : asTyped(plain);
}

/** The parameters of a maps link that name a place, in the order they are trusted: the place before the map's centre. */
const PLACE_PARAMETERS = ["q", "query", "destination", "ll"] as const;

/**
 * The pair a maps link carries in the open, or null. In the order of how surely each is the place itself:
 *
 * 1. the pin's own numbers in a Google Maps place address (`!3d<lat>!4d<lon>`);
 * 2. a parameter that names the place: `q=`, `query=`, `destination=`, then `ll=`;
 * 3. the place written as the address's own path (`/place/<pair>`, `/search/<pair>`);
 * 4. the centre the map was looking at (`@<lat>,<lon>`), which is the place itself for a link made by pressing on the map.
 *
 * A link that carries none of them — a shortened share link — is no pair: it would have to be followed, and nothing is.
 */
function fromLink(link: string): Coordinates | null {
  const pin = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(link);
  if (pin) return pointPair(`${pin[1]}, ${pin[2]}`);

  const parameters = new Map<string, string>();
  for (const part of link.split(/[?&#;]/).slice(1)) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const name = part.slice(0, at).toLowerCase();
    // The first of a name is the one a maps application reads.
    if (!parameters.has(name)) parameters.set(name, part.slice(at + 1));
  }
  for (const name of PLACE_PARAMETERS) {
    const value = parameters.get(name);
    const pair = value === undefined ? null : carried(value);
    if (pair) return pair;
  }

  const inPath = /\/(?:place|search)\/([^/?#]+)/i.exec(link);
  const named = inPath ? carried(inPath[1]) : null;
  if (named) return named;

  const centre = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/.exec(link);
  return centre ? pointPair(`${centre[1]}, ${centre[2]}`) : null;
}

/**
 * A `geo:` address: «geo:45.64271,25.58871», with a height, an uncertainty or a zoom after it — or the pair its `q=`
 * names, which is where a telephone puts the place when the address itself is the placeholder «0,0». A `q=` that is words
 * («geo:0,0?q=Piața Sfatului») names a search, not a place: no pair.
 */
function fromGeo(address: string): Coordinates | null {
  const rest = address.slice("geo:".length);
  const query = /[?&]q=([^&]*)/i.exec(rest);
  const asked = query ? carried(query[1]) : null;
  if (asked) return asked;
  const [latitude, longitude] = rest.split(/[?;]/)[0].split(",");
  if (latitude === undefined || longitude === undefined) return null;
  const pair = pointPair(`${latitude.trim()}, ${longitude.trim()}`);
  return pair && query && pair.latitude === 0 && pair.longitude === 0 ? null : pair;
}

/** The first address of the web in the text: a scheme or `www.` anywhere in it, or a host and a path it starts with. */
const linkIn = (text: string): string | null => /(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/i.exec(text)?.[0] ?? /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\/\S*/i.exec(text)?.[0] ?? null;

/**
 * What a person pasted from a maps application, as a latitude and a longitude of six decimals — null for an empty box
 * («none») — or a `CoordinatesRefusal` naming the box. Read:
 *
 * - «45.64271, 25.58871», the shape Google Maps copies, and the same with a space or a semicolon between the two;
 * - decimal commas where the two numbers can still be told apart: «45,64271; 25,58871», «45,64271 25,58871» — never one
 *   number alone with a decimal comma, «45,64», which is no pair or a wrong one (`oneNumberWithComma`);
 * - a degree sign and the letters N, S, E, W — and V, the Romanian vest: «45.64271° N, 25.58871° E»; with letters the two
 *   may stand in either order;
 * - degrees, minutes and seconds as Google Maps shows them on a computer: «45°38'33.8"N 25°35'19.4"E»;
 * - a `geo:45.64271,25.58871` address;
 * - a maps link that carries the pair in the open (`fromLink`).
 *
 * Without letters the latitude is the first number. Anything else, a latitude beyond ±90 and a longitude beyond ±180 are
 * refused; so is a link with no numbers in it. Nothing is fetched.
 */
export function parseCoordinates(text: string, box: string = COORDINATES_BOX): Coordinates | null {
  const typed = tidy(text);
  if (typed === "") return null;
  if (typed.length > COORDINATES_TEXT_MAX) throw new CoordinatesRefusal(box);
  const link = /^geo:/i.test(typed) ? null : linkIn(typed);
  // A lone number with a decimal comma is refused here, where a person typed it, before it can be read as two.
  const typedPair = oneNumberWithComma(typed) ? null : asTyped(typed);
  const pair = /^geo:/i.test(typed) ? fromGeo(typed) : (typedPair ?? (link ? fromLink(link) : null));
  if (!pair) throw new CoordinatesRefusal(box);
  return pair;
}

/** One number of the pair as it is written: up to six decimals, the zeros at the end left out, never an exponent. */
function written(value: number): string {
  return round(value).toFixed(DECIMALS).replace(/\.?0+$/, "");
}

/**
 * The pair as it is written everywhere — «45.64271, 25.58871»: the latitude, a comma and a space, the longitude; points
 * as decimal marks in both languages, since it is what a maps application takes back when pasted; up to six decimals,
 * with the zeros at the end left out, so what a person typed reads as they typed it.
 */
export function formatCoordinates(coordinates: Coordinates): string {
  return `${written(coordinates.latitude)}, ${written(coordinates.longitude)}`;
}

/**
 * The address that opens the pair on a map: Google Maps' own «open this place», which opens the maps application on a
 * telephone and the site on a computer. A link only, built from a point's stored numbers: nothing is loaded from it, and
 * nothing about a person is sent to it (`scripts/docs-check.mjs` lists the host with this reason).
 */
export function mapUrlOf(coordinates: Coordinates): string {
  return `https://www.google.com/maps/search/?api=1&query=${written(coordinates.latitude)}%2C${written(coordinates.longitude)}`;
}
