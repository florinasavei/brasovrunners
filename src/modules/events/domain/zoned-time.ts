/**
 * Wall-clock time in the event's own timezone, both ways.
 *
 * An organizer types "10:00" meaning ten in the morning in Brașov, and the database stores an
 * instant. Between those two facts sits an offset that changes twice a year, so a form that
 * treats the typed value as UTC — or as the server's local time, which on Vercel is UTC and on
 * a Windows laptop is not — writes a race that starts three hours from when it does.
 *
 * Pure functions over an explicit timezone. AGENTS.md §9.4: store `timestamptz`, format in the
 * event's timezone.
 */

/**
 * How far ahead of UTC the zone is at a given instant, in milliseconds.
 *
 * Derived by asking Intl what the wall clock reads in that zone at that instant and comparing
 * it with the same instant read as UTC. This is the same technique the JSON-LD formatter uses,
 * and it needs no timezone database of our own.
 */
function offsetMilliseconds(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});

  // Intl emits hour "24" at midnight in some environments; normalise it.
  const hour = parts.hour === "24" ? "00" : parts.hour;

  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );

  return asUtc - date.getTime();
}

/** The value an `<input type="datetime-local">` shows: `YYYY-MM-DDTHH:mm`, no zone. */
export function toWallTimeInput(date: Date | null, timeZone: string): string {
  if (!date) return "";
  const shifted = new Date(date.getTime() + offsetMilliseconds(date, timeZone));
  return shifted.toISOString().slice(0, 16);
}

/**
 * The instant a wall-clock value in `timeZone` refers to, or null when the field was left
 * empty. Returns null for an unparseable value so the caller can reject it as a validation
 * error rather than storing an Invalid Date.
 *
 * The offset is applied twice on purpose. The first pass uses the offset at the *wrong*
 * instant — the wall time read as if it were UTC — which lands within an hour or two of the
 * right one; the second pass uses the offset at that near-correct instant. Only the hours
 * around a daylight-saving change can differ between the two, and that is exactly the window
 * a single pass gets wrong: the last Sunday of March, which in Romania is the weekend a
 * spring race is most likely to be held.
 */
export function fromWallTimeInput(value: string, timeZone: string): Date | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  // `datetime-local` omits seconds when they are zero; accept either shape.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  const wallAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second ?? "0"),
  );
  if (Number.isNaN(wallAsUtc)) return null;

  const firstPass = wallAsUtc - offsetMilliseconds(new Date(wallAsUtc), timeZone);
  const secondPass = wallAsUtc - offsetMilliseconds(new Date(firstPass), timeZone);

  return new Date(secondPass);
}
