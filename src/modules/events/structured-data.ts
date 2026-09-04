import { env } from "@/shared/config/env";
import { mapLinkFor } from "./domain/map-link";
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
 * NOT YET COMPLETE, deliberately. The criterion also requires a logo and `sameAs` entries for
 * the club's official profiles. Neither exists: the club's social accounts and logo are an
 * owner decision (AGENTS.md §29, BUSINESS.md §9) and inventing plausible URLs would be worse
 * than omitting them — a wrong `sameAs` actively misinforms search engines. Add both here the
 * day the owner supplies them; the requirement is not satisfied until then.
 */
export function sportsOrganizationJsonLd(name: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    "@id": clubId(),
    name,
    url: env.APP_BASE_URL,
    sport: "Running",
    areaServed: { "@type": "City", name: "Brașov" },
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

/** BR-REQ-052-02 criteria 2 and 4. */
export function sportsEventJsonLd(event: PublicEvent, url: string, organizationName: string) {
  const mapUrl = mapLinkFor(event, env.MAP_LINK_BASE_URL);

  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    "@id": `${url}#event`,
    name: event.title,
    ...(event.excerpt ? { description: event.excerpt } : {}),
    url,
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
    organizer: { "@type": "SportsOrganization", "@id": clubId(), name: organizationName },
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
       * The exact spot, when the club has stated it.
       *
       * A place name is ambiguous to a search engine in the same way it is to a runner: a park
       * is not a start line. `geo` is what lets a result show the right pin, and `hasMap` is
       * the link a person follows — the same one the page renders, so the two cannot disagree.
       */
      ...(event.latitude !== null && event.longitude !== null
        ? {
            geo: {
              "@type": "GeoCoordinates",
              latitude: Number(event.latitude),
              longitude: Number(event.longitude),
            },
          }
        : {}),
      ...(mapUrl ? { hasMap: mapUrl } : {}),
    },
    sport: "Running",
    // No `remainingAttendeeCapacity`: criterion 3 requires it to equal the free-place count
    // shown on the page, and the pilot has no capped events — the database refuses a capacity.
    // It arrives with the capacity transaction, not before.
  };
}
