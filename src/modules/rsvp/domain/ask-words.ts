import { durationPhrase } from "@/modules/deadlines/domain/duration-words";

/**
 * «Vii mâine la …?» says WHEN the day is, in the club's words (§823: the club chose how many days before the start the question goes, so the
 * email can no longer say «mâine» for all of them). Pure; the email's words are in code, like every message's (`notifications/templates.ts`,
 * which is built by the outbox worker outside any request and has no `next-intl` locale to ask).
 *
 * `daysAway` is the calendar days from the send to the start's day (`domain/ask.ts#rsvpAskDaysAway`): 1 is «mâine» / "tomorrow", 2
 * «poimâine» / "the day after tomorrow", more «peste 3 zile» / "in 3 days" (the house's `durationPhrase`, so the Romanian agrees for
 * any number). 0 or less — a held message the send drops anyway (`checkRsvpAsk`) — reads as «astăzi» / "today", never as a wrong day.
 */
export function rsvpAskDayPhrase(locale: string, daysAway: number): string {
  if (daysAway <= 0) return locale === "en" ? "today" : "astăzi";
  if (daysAway === 1) return locale === "en" ? "tomorrow" : "mâine";
  if (daysAway === 2) return locale === "en" ? "the day after tomorrow" : "poimâine";
  return locale === "en" ? `in ${durationPhrase("en", daysAway, "days")}` : `peste ${durationPhrase("ro", daysAway, "days")}`;
}
