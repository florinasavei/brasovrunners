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
 * regularly; `GEAR_TEST` is the shoe-testing evening (§121), and `MEETUP` — the value keeps its
 * name — is labelled "special event": the one-off the club does with a partner or for an
 * occasion (the owner: "meetup is a bit vague, and I need a special event type"); `EXTERNAL`
 * is somebody else's event the club goes to together — another city's race, say — where the
 * organizer's own page takes the entries (`registration_mode = EXTERNAL`).
 */
export const EVENT_TYPES = ["GROUP_RUN", "RACE", "HIKE", "COFFEE", "GEAR_TEST", "MEETUP", "EXTERNAL"] as const;

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

/** The same comparison for a Facebook event (§144): facebook.com, its subdomains, and fb.me. */
export function isFacebookLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.me" || host === "fb.com";
  } catch {
    return false;
  }
}

/**
 * The types that are simply turned up to — no registration, no participants, no programme.
 *
 * The owner, 2026-09-19: "group runs don't have registrations or participants, and they don't
 * have an event schedule; races are the most complex ones" (`DECISIONS.md` §111). The editor
 * offers neither block for one of these, a save through it writes `registration_mode = NONE`
 * and no programme whatever the form posted, and the public page says "no registration
 * needed". One list, so the day a hike needs a bus and a capacity it leaves this list and
 * nothing else changes. A hike, a coffee and a meetup keep both until the club says otherwise.
 */
const TURN_UP_TYPES: readonly EventType[] = ["GROUP_RUN"];

/** Whether the editor offers the registration block — capacity, the window, the declaration, the list. */
export function takesRegistrations(type: EventType): boolean {
  return !TURN_UP_TYPES.includes(type);
}

/**
 * Whether the event's age rule is said in public — on its page, in its structured data (§NNN).
 *
 * Only where the club takes the registrations itself: that is the one place the platform counts
 * `min_age` (`submitRegistration`). An event one turns up to has no registration to be too young
 * for (§111), an event registered elsewhere follows the other organizer's rule, and one with no
 * registration at all has nobody to refuse — stating the club's number on any of them would be a
 * rule nothing enforces.
 */
export function hasAgeRule(event: { type: EventType; registrationMode: "NONE" | "INTERNAL" | "EXTERNAL" }): boolean {
  return takesRegistrations(event.type) && event.registrationMode === "INTERNAL";
}

/** Whether the editor offers a programme — the timed rows and the text under `#schedule`. */
export function hasProgramme(type: EventType): boolean {
  return !TURN_UP_TYPES.includes(type);
}
