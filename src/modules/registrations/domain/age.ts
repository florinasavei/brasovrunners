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
