/**
 * The event kinds, as AGENTS.md §10.1 defines them.
 *
 * This list exists in three places by necessity — here, the database enum, and the message
 * catalogues — so it carries an exhaustiveness check. Add a kind to the enum without adding a
 * label and `yarn typecheck` fails rather than the page rendering a raw `INTERVAL_SESSION`.
 */
export const EVENT_KINDS = [
  "COMMUNITY_RUN",
  "TRAIL_RUN",
  "INTERVAL_SESSION",
  "LONG_RUN",
  "MEETUP",
  "RACE",
  "OTHER",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * Metres to kilometres, as a number. Null when there is no distance, so the caller renders
 * nothing rather than "0 km".
 *
 * Returns a number, not a string, on purpose: the caller formats it through next-intl so the
 * locale picks the separator. Romanian writes 14,5 km and English writes 14.5 km, and a
 * string built here with `toFixed` would show a dot to Romanian readers (BR-REQ-040-03).
 */
export function distanceInKm(distanceMeters: number | null): number | null {
  if (distanceMeters === null || distanceMeters <= 0) return null;
  // One decimal is the useful precision for a run; 14049 m and 14000 m are the same route.
  return Math.round(distanceMeters / 100) / 10;
}
