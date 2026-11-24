import { z } from "zod";

/**
 * «Ce arată site-ul despre asociație» (§890): which of the association's facts the identity line
 * (`ClubIdentity`) shows, and where — a grid of tick boxes on «Pagini» → «Contact» (the owner,
 * 2026-11-02: «a checkmark», «they should all be configs!») — and the address its «Sediul» line
 * prints, typed in the same card.
 *
 * Pure: no database, no environment. The legal name and the CIF are the environment's
 * (`CLUB_LEGAL_NAME`, `CLUB_REGISTRATION_NUMBER`, §132), the email the address the club shows for
 * contact (§442). The seat is **never** `CLUB_REGISTERED_ADDRESS`: that one carries the building,
 * the staircase and the flat, for the legal texts; the site prints only what the club typed here
 * («Strada și numărul, localitatea, județul»), and an empty box is no seat line anywhere. A line
 * shows where its box is ticked and its value is set.
 */

/**
 * What: the lines the identity can carry. «Președinte» (§1056; the owner, 2026-11-24: «trebuie musai să
 * scrie pe site, sub denumirea asociației, președinte asociație …») sits right under the name; like
 * the seat, its value is typed in the card, never in this public repository.
 */
export const CLUB_IDENTITY_ITEMS = ["name", "president", "seat", "email"] as const;
export type ClubIdentityItem = (typeof CLUB_IDENTITY_ITEMS)[number];

/** Where: the listing (the site's home page), «Contact», «Echipa» and the club's pages, the footer's fold. */
export const CLUB_IDENTITY_PLACES = ["home", "contact", "pages", "footer"] as const;
export type ClubIdentityPlace = (typeof CLUB_IDENTITY_PLACES)[number];

/** The longest seat address the box takes. */
export const CLUB_IDENTITY_SEAT_MAX = 200;
/** The longest president's name the box takes. */
export const CLUB_IDENTITY_PRESIDENT_MAX = 120;

/** For each line, the places it is ticked for; and the seat and the president's name as the site prints them, or null. */
export type ClubIdentityShown = Record<ClubIdentityItem, ClubIdentityPlace[]> & {
  seatAddress: string | null;
  presidentName: string | null;
};

/**
 * Nothing stored: the name and the CIF everywhere, as the site showed them before the setting
 * existed (§565); the seat and the email nowhere, and no seat typed — a club's seat is often a
 * person's home.
 */
export const DEFAULT_CLUB_IDENTITY_SHOWN: ClubIdentityShown = {
  name: [...CLUB_IDENTITY_PLACES],
  // Wherever the name is: nothing shows until a name is typed.
  president: [...CLUB_IDENTITY_PLACES],
  seat: [],
  email: [],
  seatAddress: null,
  presidentName: null,
};

/** A line's places: known ones only, each once, in the grid's order. */
const places = z
  .array(z.enum(CLUB_IDENTITY_PLACES))
  .max(CLUB_IDENTITY_PLACES.length * 2)
  .transform((ticked) => CLUB_IDENTITY_PLACES.filter((place) => ticked.includes(place)));

/** A typed value: trimmed, inner runs of spaces made one, empty as null. */
const typed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((value) => (value ? value.replace(/\s+/g, " ") : null));

/**
 * The stored value's shape: the ticks, and the seat and the president as typed. A row saved before
 * «Președinte» existed reads as the president wherever the name is, and no name typed.
 */
export const clubIdentityShownSchema = z
  .object({
    name: places,
    president: places.default([...CLUB_IDENTITY_PLACES]),
    seat: places,
    email: places,
    seatAddress: typed(CLUB_IDENTITY_SEAT_MAX),
    presidentName: typed(CLUB_IDENTITY_PRESIDENT_MAX),
  })
  .strict();

/** Whether `item` is ticked for `place`. */
export function showsAt(shown: ClubIdentityShown, item: ClubIdentityItem, place: ClubIdentityPlace): boolean {
  return shown[item].includes(place);
}
