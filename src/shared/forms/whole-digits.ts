/**
 * A whole number typed into a plain text box, read by one rule (§NNN; the review of §548).
 *
 * Only digits count, once the spaces round them are trimmed: «12», « 12 », «007» (which is 7).
 * An empty box, or no box on the form, is null — the caller says what that means (the desk's own
 * draw, a cleared number, no ceiling). Anything else — «12.7», «1e3», «0x10», «-5», «+3», «1 000»
 * — is NaN, which the service refuses naming the box: never rounded, and never read as another
 * number, which `Number` would do (`Number("1e3")` is 1000, `Number("0x10")` is 16).
 *
 * The range is the service's to check (a race number from 1 to 99 999, a Mailgun ceiling), not
 * this function's: it reads what was typed and nothing more.
 */
export function wholeDigits(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}
