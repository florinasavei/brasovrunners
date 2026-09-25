/**
 * Ages by calendar years — the same arithmetic a desk does on an ID card.
 *
 * **This module imports nothing**, deliberately (`DECISIONS.md` §188, the reasoning of
 * `media/limits.ts` in §178). It lived in `fields.ts`, which is the registration form's whole
 * Zod schema; the browser needs this one function to decide whether to show the guardian's name,
 * and importing it from there would have pulled the schema and Zod into the client bundle for
 * four lines of date arithmetic. `fields.ts` re-exports it, so nothing else moved.
 *
 * Two thresholds live here and they are counted against different days, on purpose:
 * - **eighteen, on the day of submission** (`isMinorOn`, §108) — whether a parent registers;
 * - **the event's own minimum, on the day of the event** (`events.min_age`, §321 and §329) —
 *   whether anybody can. Fourteen unless the organizer set another number.
 */

/**
 * The club's minimum age, **as a default** (§321; the owner, 2026-09-23: "Min age must be 14",
 * then the same day: "actually this min age must be set at event level!", §329).
 *
 * The rule is the event's own `events.min_age`, counted on the day of the event — that is when
 * the person runs, and the day the form already counts age categories against ("Categoriile de
 * vârstă se calculează la data cursei"); somebody who turns fourteen on race morning may enter
 * today. This constant is what the column defaults to, what the editor offers a new event, and
 * what a partial `EventForRegistration` built without the column is read with. It is never the
 * rule on an event that has its own number.
 */
export const MIN_PARTICIPANT_AGE = 14;

/** From here a person registers themselves (§108); under it, a parent or legal guardian does. */
export const ADULT_AGE = 18;

/**
 * "14 ani", "20 de ani", "101 ani" — a number of years as a sentence says it (§329).
 *
 * The catalogues interpolate the event's minimum as `{age}`, and ICU plurals are not used in this
 * codebase, so the one grammatical rule is here. Romanian puts "de" between a number and its noun
 * when the number's last two digits are 00 or 20 to 99 — "20 de ani", "100 de ani", "120 de ani",
 * but "19 ani" and "101 ani" — and says "1 an" in the singular. English says "1 year" and
 * "N years". Any other locale is read as English, which is the site's only other language.
 */
export function yearsPhrase(years: number, locale: string): string {
  if (locale === "ro") {
    if (years === 1) return "1 an";
    const lastTwo = years % 100;
    const takesDe = years >= 20 && (lastTwo === 0 || lastTwo >= 20);
    return `${years} ${takesDe ? "de " : ""}ani`;
  }
  return `${years} ${years === 1 ? "year" : "years"}`;
}

/**
 * Which sentence says who may enter an event with this minimum age (§329) — the intro line of
 * the form and the event page's age fact. Two plain sentences, each its own clause: the minimum
 * age on its own ("Vârsta minimă: {age}." / "Minimum age: {age}."), and — where a minor may
 * enter — a second sentence naming the parent and the parent's consent ("Sub 18 ani, înscrierea
 * se face de un părinte, cu acordul acestuia." / "Under 18, a parent registers the runner, with
 * their consent."):
 * - `minimumAndGuardian` — a minimum under eighteen: both sentences, minimum age then parent;
 * - `minimumOnly` — eighteen or more: nobody who may enter needs a parent, so no parent sentence;
 * - `guardianOnly` — no minimum (zero): only the parent sentence, never "from 0 years".
 */
export type AgeRuleVariant = "minimumAndGuardian" | "minimumOnly" | "guardianOnly";

export function ageRuleVariant(minAge: number): AgeRuleVariant {
  if (minAge <= 0) return "guardianOnly";
  return minAge >= ADULT_AGE ? "minimumOnly" : "minimumAndGuardian";
}

/** The day a birth date names, at UTC midnight, or null for anything that is not a date. */
function dayAt(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const at = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The `years`-th birthday. Born on 29 February, it falls on 1 March in a common year — which is
 * what `Date.UTC` rolls to, and what `isMinorOn` has always counted.
 */
function birthday(birth: Date, years: number): Date {
  return new Date(Date.UTC(birth.getUTCFullYear() + years, birth.getUTCMonth(), birth.getUTCDate()));
}

export function isMinorOn(birthDate: string, on: Date): boolean {
  const birth = dayAt(birthDate);
  if (!birth) return false;
  return on.getTime() < birthday(birth, ADULT_AGE).getTime();
}

/**
 * The calendar day an instant falls on in a time zone, as `YYYY-MM-DD`.
 *
 * The event's own zone (`events.timezone`): a race starting at 00:30 in Brașov on 21 November
 * is at 22:30 UTC on the 20th, and a birthday is counted against the day on the start line.
 * `Intl` is a global, so this module still imports nothing.
 */
export function dayIn(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * Whole years between a birth date and a day, both `YYYY-MM-DD`; negative for a birth date after
 * the day, null when either is not a date — the schema says what is wrong with a malformed one,
 * and an age rule must not add a second, untrue reason.
 */
export function ageOn(birthDate: string, day: string): number | null {
  const birth = dayAt(birthDate);
  const on = dayAt(day);
  if (!birth || !on) return null;
  const years = on.getUTCFullYear() - birth.getUTCFullYear();
  return birthday(birth, years).getTime() > on.getTime() ? years - 1 : years;
}

/**
 * The latest birth date that is still `years` old on `day` — the date input's `max` (§321), so
 * the picker cannot offer a date the server would refuse.
 *
 * `day` minus `years` calendar years, except on 29 February, where the year `years` earlier may
 * have none: then the 28th, because somebody born on 1 March of that year is not yet `years`
 * old until the day after. `ageOn` of the answer is `years`; of the day after it, `years - 1`.
 */
export function latestBirthDateFor(years: number, day: string): string {
  const on = dayAt(day);
  if (!on) throw new RangeError(`not a calendar day: ${day}`);
  const candidate = new Date(Date.UTC(on.getUTCFullYear() - years, on.getUTCMonth(), on.getUTCDate()));
  const latest =
    candidate.getUTCMonth() === on.getUTCMonth()
      ? candidate
      : new Date(Date.UTC(on.getUTCFullYear() - years, on.getUTCMonth() + 1, 0));
  return latest.toISOString().slice(0, 10);
}

/**
 * The age in whole years on a given day — the race's, for the spreadsheet's category column
 * (§322). The club has defined no age bands, so the column is the age itself, which is what a
 * band is computed from the day it has some. `ageOn` on the event's own calendar day (§321), so
 * the column, the minimum age and the minor rule can never disagree about who is seventeen.
 * Null for no date, one that cannot be read, or one after the race.
 */
export function ageOnRaceDay(birthDate: string | null, startsAt: Date, timeZone: string): number | null {
  if (!birthDate) return null;
  const age = ageOn(birthDate, dayIn(startsAt, timeZone));
  return age === null || age < 0 ? null : age;
}
