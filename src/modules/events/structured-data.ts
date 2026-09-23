import { env } from "@/shared/config/env";
import { readCoHosts } from "./domain/co-hosts";
import { hasAgeRule } from "./domain/event-type";
import type { PublicEvent } from "./repository";

/**
 * JSON-LD for search engines and AI assistants (BR-REQ-052-02, BR-REQ-070-03).
 *
 * Two rules govern everything here. Every URL derives from APP_BASE_URL, never a literal
 * (BR-REQ-101-02). And criterion 6 is absolute: no participant name, email, registration
 * list, or declaration content may appear in a block, so these functions accept only the
 * public event shape and never a registration.
 */

/** Stable identifier for the club, referenced by every event's `organizer`. */
export function clubId(): string {
  return `${env.APP_BASE_URL}/#organization`;
}

/**
 * BR-REQ-052-02 criterion 1.
 *
 * `sameAs` names the club's own profiles elsewhere, which is how a search engine knows that this
 * site and those accounts are one organization. It comes from configuration (`AGENTS.md` §8: no
 * hostname under `src/`) and is **omitted entirely when nothing is configured** — an empty array
 * is a claim that the club has no profiles, and a guessed URL actively misinforms.
 *
 * Still missing for the criterion: `logo`, which needs an absolute URL to a raster the club has
 * approved for the purpose. The SVG in `public/brand/` is not one — search engines want a
 * bitmap of a stated size — and producing one is the club's call, not this file's.
 */
export function sportsOrganizationJsonLd(name: string) {
  const sameAs = [env.CLUB_FACEBOOK_URL, env.CLUB_INSTAGRAM_URL, env.CLUB_STRAVA_URL].filter(
    (url): url is string => Boolean(url),
  );

  return {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    "@id": clubId(),
    name,
    url: env.APP_BASE_URL,
    sport: "Running",
    areaServed: { "@type": "City", name: "Brașov" },
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

const EVENT_STATUS_URL = {
  SCHEDULED: "https://schema.org/EventScheduled",
  CANCELLED: "https://schema.org/EventCancelled",
  COMPLETED: "https://schema.org/EventScheduled",
} as const;

/**
 * Format an instant with the event's own UTC offset, as criterion 2 requires.
 *
 * `toISOString()` would emit `Z`, which is correct but tells a reader in Brașov nothing about
 * local start time. This produces `2026-09-13T07:00:00+03:00`.
 */
export function toOffsetIsoString(date: Date, timeZone: string): string {
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
  const local = `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;

  // Derive the offset by comparing the zone's wall clock to UTC's for the same instant.
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMinutes = Math.round((asUtc - date.getTime()) / 60_000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;

  return `${local}${offset}`;
}

/**
 * The club, then the partners (§168): schema.org takes one organizer or several, and the
 * order is what says who holds the event. The club's entry is the same `@id` every event
 * points at, so a search engine reads one organization across the whole site; a partner is a
 * plain Organization with a name and, when the club pasted one, its page.
 */
function organizers(event: PublicEvent, organizationName: string) {
  const club = { "@type": "SportsOrganization", "@id": clubId(), name: organizationName };
  const coHosts = readCoHosts(event);
  if (coHosts.length === 0) return club;
  return [
    club,
    ...coHosts.map((host) => ({ "@type": "Organization", name: host.name, ...(host.url ? { url: host.url } : {}) })),
  ];
}

/** BR-REQ-052-02 criteria 2 and 4. */
export function sportsEventJsonLd(event: PublicEvent, url: string, organizationName: string, images: readonly string[] = []) {
  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    "@id": `${url}#event`,
    name: event.title,
    ...(event.excerpt ? { description: event.excerpt } : {}),
    url,
    // The cards the page already draws (§90) — Google's Event result wants an image and asks
    // for more than one aspect ratio; the 1200×630 card and the square one are those (§155).
    ...(images.length > 0 ? { image: [...images] } : {}),
    /**
     * Two times, mapped to the two properties schema.org already has for them.
     *
     * `startDate` is when the race starts — the time a runner must be on the line — and falls
     * back to the event start when the club has stated only one time. `doorTime` is when the
     * event begins, which for a race is the gathering. Getting these the wrong way round would
     * put the gathering time in the search result and the start time nowhere.
     */
    startDate: toOffsetIsoString(event.raceStartsAt ?? event.startsAt, event.timezone),
    doorTime: toOffsetIsoString(event.startsAt, event.timezone),
    ...(event.endsAt ? { endDate: toOffsetIsoString(event.endsAt, event.timezone) } : {}),
    // Criterion 4: a cancelled event keeps its block and states the status.
    eventStatus: EVENT_STATUS_URL[event.eventStatus],
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    // The club, and every organization the event is held with (§121, §168) — the club
    // first, the partners in the club's own order. A bare object when the club hosts alone,
    // because `organizer` is one value there and an array of one reads as a list of one.
    organizer: organizers(event, organizationName),
    /**
     * Brașov Runners events are free (the owner, 2026-09-19: "state somewhere that Brașov
     * Runners events are always free — this also helps us pass the Google verifications").
     * Google's event result wants an offer with a price; a club event that has not been
     * marked PAID is offered at zero, in lei, at its own page.
     */
    ...(event.costType !== "PAID"
      ? {
          isAccessibleForFree: true,
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "RON",
            url,
            availability: "https://schema.org/InStock",
            validFrom: toOffsetIsoString(event.publishedAt ?? event.startsAt, event.timezone),
          },
        }
      : {}),
    location: {
      "@type": "Place",
      name: event.locationName,
      address: {
        "@type": "PostalAddress",
        ...(event.locationAddress ? { streetAddress: event.locationAddress } : {}),
        addressLocality: "Brașov",
        addressCountry: "RO",
      },
      /**
       * The map link a person follows — the same one the page renders, so the two cannot
       * disagree. No `geo` any more: the coordinates it was built from left with migration
       * `0023` (`DECISIONS.md` §61), and a pin guessed from a place name would be wrong.
       */
      ...(event.mapUrl ? { hasMap: event.mapUrl } : {}),
    },
    sport: "Running",
    /*
      Who may enter (§NNN): schema.org's own spelling of an open-ended range, "14-". Only where
      the page says it too (`hasAgeRule`: the club takes the registrations and counts the age),
      and only for a minimum — zero is no minimum, and "0-" would state a rule nobody set.
    */
    ...(hasAgeRule(event) && event.minAge > 0 ? { typicalAgeRange: `${event.minAge}-` } : {}),
    // No `remainingAttendeeCapacity`: criterion 3 requires it to equal the free-place count
    // shown on the page, and the pilot has no capped events — the database refuses a capacity.
    // It arrives with the capacity transaction, not before.
  };
}
