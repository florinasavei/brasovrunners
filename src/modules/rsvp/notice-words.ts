import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * What the privacy notice's `{{rsvp}}` becomes (§NNN, «Vin!» part 1): the answer's own button on an event's page,
 * quoted, in that language — „Vin!” / “I'm coming!” — read from the catalogue the page's button reads
 * (`Event.rsvp.submit`), so the approved sentence names what a visitor presses. Outside a request, like
 * `results/notice-words.ts`, for the legal pages, the declaration and the token legend.
 */
export function rsvpClause(locale: string): string {
  return locale === "en" ? `“${en.Event.rsvp.submit}”` : `„${ro.Event.rsvp.submit}”`;
}

/** The notice's merge value, beside the other features' on the legal pages. */
export function rsvpMergeValues(locale: string): { rsvp: string } {
  return { rsvp: rsvpClause(locale) };
}
