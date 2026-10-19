import { topicsPhrase } from "@/modules/newsletter/topic-words";
import en from "../../../messages/en.json";
import ro from "../../../messages/ro.json";

/**
 * What the privacy notice's `{{rsvp}}` becomes (§811, «Vin!» part 1): the answer's own button on an event's page,
 * quoted, in that language — „Vin!” / “I'm coming!” — read from the catalogue the page's button reads
 * (`Event.rsvp.submit`), so the approved sentence names what a visitor presses. Outside a request, like
 * `results/notice-words.ts`, for the legal pages, the declaration and the token legend.
 */
export function rsvpClause(locale: string): string {
  return locale === "en" ? `“${en.Event.rsvp.submit}”` : `„${ro.Event.rsvp.submit}”`;
}

/**
 * What `{{rsvpAsk}}` becomes (§818, «Vii mâine?»): the newsletter topic that carries the day-before question, quoted, in that
 * language — „Întrebarea «Vii?» înaintea alergărilor” — read through `topicsPhrase` from the catalogue the pop-up's box reads, so the
 * approved sentence names what a subscriber ticked.
 */
export function rsvpAskClause(locale: string): string {
  return topicsPhrase(locale, ["RSVP_ASK"]);
}

/**
 * What `{{rsvpAskAnswerers}}` becomes (§823): the refusal button's own name, quoted, in that language — „Nu mă mai întreba la seria aceasta”
 * — read from the catalogue the token page's button reads (`Rsvp.askRefuseButton`), so the approved sentence names what a person presses.
 */
export function rsvpAskAnswerersClause(locale: string): string {
  return locale === "en" ? `“${en.Rsvp.askRefuseButton}”` : `„${ro.Rsvp.askRefuseButton}”`;
}

/**
 * What `{{rsvpMember}}` becomes (§829): the mark beside a shown name, quoted, in that language — „BVR” / “BVR” — read from the catalogue the chip
 * reads (`Event.rsvp.memberMark`), so the approved sentence names what a visitor sees on «Cine vine».
 */
export function rsvpMemberClause(locale: string): string {
  return locale === "en" ? `“${en.Event.rsvp.memberMark}”` : `„${ro.Event.rsvp.memberMark}”`;
}

/** The notice's merge values, beside the other features' on the legal pages. */
export function rsvpMergeValues(locale: string): { rsvp: string; rsvpAsk: string; rsvpAskAnswerers: string; rsvpMember: string } {
  return { rsvp: rsvpClause(locale), rsvpAsk: rsvpAskClause(locale), rsvpAskAnswerers: rsvpAskAnswerersClause(locale), rsvpMember: rsvpMemberClause(locale) };
}
