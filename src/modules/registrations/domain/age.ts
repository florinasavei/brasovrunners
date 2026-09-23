/**
 * Eighteen on the day, by calendar years — the same arithmetic a desk does on an ID card.
 *
 * **This module imports nothing**, deliberately (`DECISIONS.md` §188, the reasoning of
 * `media/limits.ts` in §178). It lived in `fields.ts`, which is the registration form's whole
 * Zod schema; the browser needs this one function to decide whether to show the guardian's name,
 * and importing it from there would have pulled the schema and Zod into the client bundle for
 * four lines of date arithmetic. `fields.ts` re-exports it, so nothing else moved.
 */
export function isMinorOn(birthDate: string, on: Date): boolean {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return false;
  const eighteenth = new Date(Date.UTC(birth.getUTCFullYear() + 18, birth.getUTCMonth(), birth.getUTCDate()));
  return on.getTime() < eighteenth.getTime();
}

/**
 * The age in whole years on a given day — the race's, for the spreadsheet's category column
 * (§NNN). The club has defined no age bands, so the column is the age itself, which is what a
 * band is computed from the day it has some; the same calendar arithmetic as `isMinorOn`, so
 * the two can never disagree about who is seventeen. Null for no date or one that cannot be read.
 */
export function ageOn(birthDate: string | null, on: Date): number | null {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) return null;
  let age = on.getUTCFullYear() - birth.getUTCFullYear();
  const birthdayThisYear = Date.UTC(on.getUTCFullYear(), birth.getUTCMonth(), birth.getUTCDate());
  if (on.getTime() < birthdayThisYear) age -= 1;
  return age < 0 ? null : age;
}
