import { fnv1a } from "@/shared/hash";

/**
 * A short, stable stamp of what a bib's picture is drawn from (§748, amending §735).
 *
 * The preview route lets the browser keep an answer for an hour, and the address used to name the
 * registration and nothing else, so a change of the event's design — «Cum arată numărul» from «1»
 * to «001» above all — left the old picture under the same address. The stamp goes into the
 * address (`v=`): a changed design is a new address and a fresh picture, an unchanged one is still
 * served from the cache. A change detector, no security claim.
 */
export function bibPictureStamp(parts: unknown): string {
  return fnv1a(JSON.stringify(parts) ?? "");
}

/** The address of one registration's bib picture, stamped with what it is drawn from. */
export function bibPictureSrc(input: { eventId: string; registrationId: string; locale: string; stamp: string; member?: boolean }): string {
  return `/api/admin/events/${input.eventId}/bibs/preview?registration=${input.registrationId}&locale=${input.locale}${input.member ? "&m=1" : ""}&v=${input.stamp}`;
}
