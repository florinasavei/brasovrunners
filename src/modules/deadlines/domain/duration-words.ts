import { countForm, type CountForm } from "@/i18n/count-form";

/**
 * A number of minutes, hours, days or weeks as words, in both languages (§NNN) — so that every
 * sentence that states a deadline says the number the platform actually keeps.
 *
 * **One copy of these words, in code, for every surface.** The same "48 de ore" is written by a
 * page (the five steps on the form, §91), by an email (built by the outbox worker outside any
 * request, where there is no `next-intl` locale to ask), by the signed declaration's PDF and by
 * the legal texts' merge fields. The email templates and the PDF already keep their words in code
 * for exactly that reason (`notifications/templates.ts`, `registrations/declaration-labels.ts`);
 * a second copy in the catalogues would be two places for "de ore" to drift apart. The sentences
 * around the number stay in `messages/*.json`, with a `{hours}`-style placeholder that receives
 * the whole phrase — number and noun together, which is the only way the Romanian agrees for any
 * value: "1 oră", "2 ore", "20 de ore".
 *
 * The three Romanian forms are `countForm`'s (`one`, `few`, `other`, §341). English says "one"
 * rather than "1" for a single unit, and Romanian its article ("o oră", "un minut"), because the
 * phrase sits inside a sentence: "the link is valid for one day", "linkul e valabil o zi".
 */

export type DurationUnit = "minutes" | "hours" | "days" | "weeks";
type Locale = "ro" | "en";

const WORDS: Record<Locale, Record<DurationUnit, Record<CountForm, string>>> = {
  ro: {
    minutes: { one: "un minut", few: "{n} minute", other: "{n} de minute" },
    hours: { one: "o oră", few: "{n} ore", other: "{n} de ore" },
    days: { one: "o zi", few: "{n} zile", other: "{n} de zile" },
    weeks: { one: "o săptămână", few: "{n} săptămâni", other: "{n} de săptămâni" },
  },
  en: {
    minutes: { one: "one minute", few: "{n} minutes", other: "{n} minutes" },
    hours: { one: "one hour", few: "{n} hours", other: "{n} hours" },
    days: { one: "one day", few: "{n} days", other: "{n} days" },
    weeks: { one: "one week", few: "{n} weeks", other: "{n} weeks" },
  },
};

function asLocale(locale: string): Locale {
  return locale === "en" ? "en" : "ro";
}

/** Exactly this amount of this unit: "30 de minute", "48 de ore", "one day". */
export function durationPhrase(locale: string, amount: number, unit: DurationUnit): string {
  const lang = asLocale(locale);
  return WORDS[lang][unit][countForm(amount, lang)].replace("{n}", String(amount));
}

/**
 * A hold measured in minutes, in hours once it is a whole number of them: "30 de minute",
 * "90 de minute", "o oră", "2 ore".
 */
export function minutesPhrase(locale: string, minutes: number): string {
  return minutes >= 60 && minutes % 60 === 0 ? durationPhrase(locale, minutes / 60, "hours") : durationPhrase(locale, minutes, "minutes");
}

/**
 * A countdown somebody watches — the email link, the offer — in hours, always: "48 de ore",
 * "24 de ore". A deadline is read against a clock, and "2 zile" would leave a runner guessing
 * whether it means two calendar days.
 */
export function hoursPhrase(locale: string, hours: number): string {
  return durationPhrase(locale, hours, "hours");
}

/**
 * How long before something — the reminder before the start, "I am here" — in days once it is a
 * whole number of them, and in weeks once it is a whole number of those: "2 zile", "o zi",
 * "36 de ore", "o săptămână". "Cu două zile înainte" is how the club has always said the
 * reminder; the digit is the only change.
 */
export function leadPhrase(locale: string, hours: number): string {
  if (hours >= 24 && hours % 24 === 0) return daysPhrase(locale, hours / 24);
  return durationPhrase(locale, hours, "hours");
}

/** A span of days, in weeks once it is a whole number of them: "8 săptămâni", "10 zile", "o săptămână". */
export function daysPhrase(locale: string, days: number): string {
  return days >= 7 && days % 7 === 0 ? durationPhrase(locale, days / 7, "weeks") : durationPhrase(locale, days, "days");
}
