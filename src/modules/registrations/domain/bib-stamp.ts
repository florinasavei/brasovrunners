import { fnv1a } from "@/shared/hash";

/**
 * The version of the bib's drawing (§755): raised whenever the renderers draw the same design
 * differently, so every stamped picture address changes with it. The design, the colour and the
 * title are what the club changes; this is what the platform changes. 2: the header's title in up to
 * two lines beside the badge, the date under its real height, the badge centred (§755). 3: the member
 * mark a star by default where §750 drew a ring and a check, and the emergency line fitted to the card
 * (§759). 4: the profile's strip drawn by the shared elevation core — the kilometre scale, the altitudes, the pins
 * with the core's glyphs, the aid stations' words (§804). 5: a checkpoint offering food and water draws the fork on the strip, as the event page does (§881). 6: the emergency line
 * reads «Name: number» with a bar between its numbers, and no word before numbers that each have a name (§947). 7: a registration
 * marked «Elită» prints its first name alone where the number goes, where it printed the registered name (§948). 8: an empty
 * gap between the profile's row and the phone line when both are drawn (§959). 9: an elite bib never prints a number, and a
 * line of the elite list prints its first word (§NNN). The bibs page's stamp (`bibPictureStamp`) and the desk's (`events/repository.ts#BIB_STAMP`) both carry it.
 */
export const BIB_DRAWING_VERSION = 9;

/**
 * A short, stable stamp of what a bib's picture is drawn from (§748, amending §735).
 *
 * The preview route lets the browser keep an answer for an hour, and the address used to name the
 * registration and nothing else, so a change of the event's design — «Cum arată numărul» from «1»
 * to «001» above all — left the old picture under the same address. The stamp goes into the
 * address (`v=`): a changed design is a new address and a fresh picture, an unchanged one is still
 * served from the cache. A changed drawing is a new address too: the stamp starts with
 * `BIB_DRAWING_VERSION`. A change detector, no security claim.
 */
export function bibPictureStamp(parts: unknown): string {
  return fnv1a(JSON.stringify([BIB_DRAWING_VERSION, parts]) ?? "");
}

/**
 * The address of one registration's bib picture, stamped with what it is drawn from. `m=1` and `e=1` — a member's bib
 * (§664), an elite one (§897) — are read by nobody: a mark set or cleared is a new address, never the hour-old picture.
 */
export function bibPictureSrc(input: { eventId: string; registrationId: string; locale: string; stamp: string; member?: boolean; elite?: boolean }): string {
  return `/api/admin/events/${input.eventId}/bibs/preview?registration=${input.registrationId}&locale=${input.locale}${input.member ? "&m=1" : ""}${input.elite ? "&e=1" : ""}&v=${input.stamp}`;
}
