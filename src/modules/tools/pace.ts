/**
 * The pace calculator's arithmetic («Unelte» → «Calculator de ritm»): two of distance, time and pace
 * give the third. Pure, so the island and its test share it — kilometres and seconds throughout,
 * rounded only where a value is shown.
 */

/** Which of the three the calculator works out; the other two are typed. */
export type PaceSolve = "pace" | "time" | "distance";

/** The three, whole: what a solved calculation knows. */
export type PaceResult = { distanceKm: number; timeSeconds: number; paceSeconds: number };

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
  { distanceKm, timeSeconds, paceSeconds }: { distanceKm: number | null; timeSeconds: number | null; paceSeconds: number | null },
): PaceResult | null {
  if (solve === "pace") return distanceKm && timeSeconds ? { distanceKm, timeSeconds, paceSeconds: timeSeconds / distanceKm } : null;
  if (solve === "time") return distanceKm && paceSeconds ? { distanceKm, paceSeconds, timeSeconds: distanceKm * paceSeconds } : null;
  return timeSeconds && paceSeconds ? { timeSeconds, paceSeconds, distanceKm: timeSeconds / paceSeconds } : null;
}

/** Kilometres an hour at a pace of `paceSeconds` a kilometre. */
export function speedKmh(paceSeconds: number): number {
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
