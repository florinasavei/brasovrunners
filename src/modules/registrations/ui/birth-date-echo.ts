import { formatCalendarDay } from "@/i18n/dates";
import { ageOn, yearsPhrase } from "../domain/age";

/**
 * The line under the registration form's birth-date box (§NNN): the typed day in words and the
 * age on the event's own day, or "" when the value is not a full, past-dated day. Pure, and kept
 * out of the island so the one date helper (`src/i18n/dates.ts`, §349) formats it; the island
 * only reads the box. A calendar day formatted at noon UTC, so no zone moves it — the island
 * renders nothing on the server and nothing before a date is typed, so no hydration can differ.
 */
export function birthDateEchoText(value: string, eventDay: string, locale: string, template: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return "";
  const age = ageOn(value, eventDay);
  if (age === null || age < 0) return "";
  return template
    .replace("{date}", formatCalendarDay(value, { locale, style: "long", month: "long" }))
    .replace("{age}", yearsPhrase(age, locale));
}
