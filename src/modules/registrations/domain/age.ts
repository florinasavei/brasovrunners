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
 * - **fourteen, on the day of the event** (`MIN_PARTICIPANT_AGE`, §NNN) — whether anybody can.
 */

/**
 * The youngest a participant may be **on the day of the event**, in whole years (§NNN; the
 * owner, 2026-09-23: "Min age must be 14").
 *
 * The day of the event and not the day of submission because that is when the person runs, and
 * it is the day the form already counts age categories against ("Categoriile de vârstă se
 * calculează la data cursei"). Somebody who turns fourteen on race morning may enter today.
 *
 * The catalogues repeat the number in words (`Registration.ageRule`, `errors.tooYoung`,
 * `birthDateHelp`, `Admin.errors.UNDER_MINIMUM_AGE`) because Romanian grammar changes at twenty
 * ("14 ani", "20 de ani"); `tests/unit/registrations/minimum-age.test.ts` holds the two together.
 */
export const MIN_PARTICIPANT_AGE = 14;

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
  return on.getTime() < birthday(birth, 18).getTime();
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
 * The latest birth date that is still `years` old on `day` — the date input's `max` (§NNN), so
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
