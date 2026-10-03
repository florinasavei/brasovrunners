import { formatDay } from "@/i18n/dates";

/**
 * A deadline to act by, inside a sentence (§580; the owner, 2026-09-30: more bold in the emails):
 * the month spelled out — "vineri, 2 octombrie 2026, la 18:30" / "Friday, 2 October 2026, at 18:30"
 * — so the one date a runner must not miss reads whole, never as "2 oct.". The emails (`render.ts`)
 * and «Ce îi spui» (`registrations/ui/tell-words.ts`) both write a deadline through it.
 */
export function formatDeadlineInSentence(at: Date, timeZone: string, locale: string): string {
  return formatDay(at, { locale, timeZone, style: "long", month: "long", withTime: true, position: "inline" });
}
