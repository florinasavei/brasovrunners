/**
 * The event types and surfaces, as AGENTS.md §10.1 defines them.
 *
 * Each list exists in three places by necessity — here, the database enum, and the message
 * catalogues — so each carries an exhaustiveness check (`tests/unit/i18n/messages.test.ts`).
 * Add a value to the enum without adding a label and the test fails rather than the page
 * rendering a raw `GROUP_RUN`.
 *
 * Two lists rather than the one seven-value `EVENT_KINDS` this file used to hold: what an event
 * *is* and what it is *run on* are separate questions, and one chip could not answer both
 * (`DECISIONS.md` §61). A hike and a coffee are their own types because the club holds both
 * regularly; a special meetup — a shoe-testing evening — is `MEETUP` with the theme in the title.
 */
export const EVENT_TYPES = ["GROUP_RUN", "RACE", "HIKE", "COFFEE", "MEETUP"] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Nullable on the event: a meetup is run on nothing. */
export const EVENT_SURFACES = ["ASPHALT", "TRAIL", "MIXED"] as const;

export type EventSurface = (typeof EVENT_SURFACES)[number];

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

/**
 * Is a pasted route link a Strava page?
 *
 * The event page shows the Strava mark beside "View the route" when it is, because that is where
 * the club draws its routes and a runner recognises the mark faster than the words. A hostname
 * *comparison*, not an emitted address: AGENTS.md §8 keeps hostnames out of `src/` so that every
 * URL the site produces about itself derives from `APP_BASE_URL`, and this produces nothing — it
 * reads what an organizer pasted. No Strava embed script follows from it (`DECISIONS.md` §61): a
 * third-party script is a processor the privacy notice does not name.
 */
export function isStravaLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "strava.com" || host.endsWith(".strava.com");
  } catch {
    return false;
  }
}
