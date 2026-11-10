/**
 * The pace calculator's arithmetic («Unelte» → «Calculator de ritm»): two of distance, time and pace
 * give the third. Pure, so the island and its test share it — one distance unit throughout (kilometres,
 * or miles if the visitor picks them: the arithmetic is the same in either) and seconds, rounded only
 * where a value is shown.
 */

/** Which of the three the calculator works out; the other two are typed. */
export type PaceSolve = "pace" | "time" | "distance";

/** The unit a distance is typed in and a pace is counted per: kilometres unless the visitor picks miles. */
export type DistanceUnit = "km" | "mi";

/** A statute mile in kilometres, exactly. */
export const KM_PER_MILE = 1.609344;

/** The three, whole, in the calculation's unit: what a solved calculation knows. */
export type PaceResult = { distance: number; timeSeconds: number; paceSeconds: number };

/** The races a runner times most, in kilometres — the half and the marathon at their official length. */
export const RACE_DISTANCES = [
  { key: "preset5", km: 5 },
  { key: "preset10", km: 10 },
  { key: "presetHalf", km: 21.0975 },
  { key: "presetMarathon", km: 42.195 },
] as const;

/**
 * A distance as a person types it — `21,1` or `21.1`, the Romanian comma as well as the point — or null
 * for anything that is not a positive number.
 */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (!/^(\d{1,5}(\.\d*)?|\.\d+)$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value > 0 ? value : null;
}

/** A box of a duration: empty is zero, a whole number is itself, anything else is null. */
export function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return 0;
  return /^\d{1,5}$/.test(trimmed) ? Number(trimmed) : null;
}

/**
 * Hours, minutes and seconds as typed into their boxes, in seconds; null when a box holds something
 * that is not a whole number, or the whole is zero. A box may run past 59 — «90» minutes is an hour and a half.
 */
export function durationSeconds(hours: string, minutes: string, seconds: string): number | null {
  const parts = [parseWhole(hours), parseWhole(minutes), parseWhole(seconds)];
  if (parts.some((part) => part === null)) return null;
  const [h, m, s] = parts as number[];
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

/** The third value from the two typed, or null while one of those two is missing or wrong. */
export function solvePace(
  solve: PaceSolve,
  { distance, timeSeconds, paceSeconds }: { distance: number | null; timeSeconds: number | null; paceSeconds: number | null },
): PaceResult | null {
  if (solve === "pace") return distance && timeSeconds ? { distance, timeSeconds, paceSeconds: timeSeconds / distance } : null;
  if (solve === "time") return distance && paceSeconds ? { distance, paceSeconds, timeSeconds: distance * paceSeconds } : null;
  return timeSeconds && paceSeconds ? { timeSeconds, paceSeconds, distance: timeSeconds / paceSeconds } : null;
}

/** Kilometres in one of `unit`. */
function kmIn(unit: DistanceUnit): number {
  return unit === "mi" ? KM_PER_MILE : 1;
}

/** A distance in the other unit: 10 km are 6.2137 mi. */
export function convertDistance(distance: number, from: DistanceUnit, to: DistanceUnit): number {
  return (distance * kmIn(from)) / kmIn(to);
}

/** A pace — seconds per unit — in the other unit: 5:00 a kilometre is 8:02.8 a mile. */
export function convertPace(paceSeconds: number, from: DistanceUnit, to: DistanceUnit): number {
  return (paceSeconds * kmIn(to)) / kmIn(from);
}

/** Units an hour at a pace of `paceSeconds` a unit: km/h for a pace per kilometre, mph for one per mile. */
export function speedPerHour(paceSeconds: number): number {
  return 3600 / paceSeconds;
}

/** A duration rounded to the second, split for the boxes: hours, then minutes under 60, then seconds. */
export function splitDuration(totalSeconds: number): { hours: number; minutes: number; seconds: number } {
  const rounded = Math.round(totalSeconds);
  return { hours: Math.floor(rounded / 3600), minutes: Math.floor((rounded % 3600) / 60), seconds: rounded % 60 };
}

/** A duration as a runner reads it: `4:05`, or `1:52:30` from an hour up. */
export function formatDuration(totalSeconds: number): string {
  const { hours, minutes, seconds } = splitDuration(totalSeconds);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${ss}` : `${minutes}:${ss}`;
}
