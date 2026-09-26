import { hasRouteDescription, partitionEventLinks } from "@/modules/events/domain/route-section";
import type { EventNotificationRow } from "@/modules/events/repository";
import type { EmailEventFacts } from "./domain/event-facts";

/**
 * One language's row of the event as the facts block reads it (§392): the anchors of that
 * language's page by the page's own rules — `#route` only with a route description in that
 * language (§387), `#links` only when the page's own split leaves "Linkuri și fișiere" something
 * to show (`partitionEventLinks`, the rule `EventLinks` draws by).
 *
 * Its own module so that every renderer that draws the block — the participant's messages
 * (`render.ts`) and the newsletter's new-event alert (`newsletter/render.ts`) — reads the event
 * the same way, and neither imports the other.
 */
export function emailEventFacts(row: EventNotificationRow, pageUrl: string | null): EmailEventFacts {
  const routeSection = hasRouteDescription(row.routeDescriptionJson);
  return {
    startsAt: row.startsAt,
    raceStartsAt: row.raceStartsAt,
    timezone: row.timezone,
    locationToBeAnnounced: row.locationToBeAnnounced,
    locationName: row.locationName,
    locationAddress: row.locationAddress,
    mapUrl: row.mapUrl,
    latitude: row.latitude,
    longitude: row.longitude,
    scheduleItems: row.scheduleItems,
    surface: row.surface,
    difficulty: row.difficulty,
    distanceMeters: row.distanceMeters,
    elevationGainMeters: row.elevationGainMeters,
    type: row.type,
    endsAt: row.endsAt,
    nightOverride: row.nightOverride,
    registrationMode: row.registrationMode,
    routeUrl: row.routeUrl,
    stravaEventUrl: row.stravaEventUrl,
    facebookEventUrl: row.facebookEventUrl,
    costType: row.costType,
    costAmount: row.costAmount,
    costUrl: row.costUrl,
    pageUrl,
    hasRules: row.hasRules === true,
    hasSchedule: row.hasSchedule === true,
    hasRouteDescription: routeSection,
    hasOtherLinks: partitionEventLinks(row.links, routeSection).other.length > 0,
  };
}
