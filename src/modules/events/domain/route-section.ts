import { hasRichTextContent, readRichText } from "@/modules/content/rich-text/domain/schema";
import { type EventLink, type EventLinkKind, readEventLinks } from "./links";
import { readRouteGpx } from "./route-gpx";
import { readRouteMaps } from "./route-maps";

/**
 * The route section of the event page, "Traseul" under `#route` (§387; the owner, 2026-09-25: "I
 * should be able to put 'descriere traseu/antrenament' with pit stops and all, basically a free
 * text, might also attach a map there; you can move the GPX and Strava link there").
 *
 * Pure, and the one place that decides what the section holds, so the page, the staff preview and
 * the facts' route row cannot disagree about which link is drawn where:
 * - the section exists only when this language's route description says something, or — since
 *   §NNN — the event has a Strava or Garmin Connect map or an uploaded GPX (`hasRouteSection`); an
 *   event with none of them keeps every link where it was;
 * - with it, the links of the route's own kinds — the GPX track and the route's map — leave
 *   "Linkuri și fișiere" for the section, and so does the route link (`route_url`, a Strava route
 *   or activity, which the facts' route row drew until then);
 * - everything else stays where it was: a document, an album, the results and any other link in
 *   "Linkuri și fișiere", the Strava *event* (where members RSVP, §71) and the Facebook event in
 *   the facts' route row.
 */

/**
 * Whether each kind of link belongs to the route. A `Record` over every kind rather than a list,
 * so a kind added to `EVENT_LINK_KINDS` does not compile until somebody says which side it is on.
 */
const IS_ROUTE_KIND: Record<EventLinkKind, boolean> = {
  GPX: true,
  MAP: true,
  DOCUMENT: false,
  PHOTOS: false,
  RESULTS: false,
  OTHER: false,
};

/** Whether a link of this kind is drawn in the route section when there is one. */
export const isRouteLinkKind = (kind: EventLinkKind): boolean => IS_ROUTE_KIND[kind];

/**
 * Whether a stored route description (a rich-text document, or null) has anything to show — words,
 * or a picture alone (a map with no alt text or caption). The same rule the save stores the column
 * by and the editor's closed line reads (`hasRichTextContent`), so a description the editor accepts
 * is never one the page leaves out.
 */
export function hasRouteDescription(json: unknown): boolean {
  return json !== null && json !== undefined && hasRichTextContent(readRichText(json));
}

/** What decides whether this language's page has a route section: its description, the maps, the GPX. */
export type RouteSectionSource = { routeDescriptionJson?: unknown; routeMaps?: unknown; routeGpx?: unknown };

/**
 * Whether the page draws «Traseul» under `#route` (§387, widened by §NNN): this language's route
 * description says something, or the event has a Strava or Garmin Connect map, or a GPX file the
 * club uploaded. The maps and the file are facts of the event, the same in both languages; the
 * description is per language. One rule for the page, the preview, the facts' route row and the
 * emails' deep links, so they cannot disagree about where the route's links are drawn.
 */
export function hasRouteSection(source: RouteSectionSource): boolean {
  return hasRouteDescription(source.routeDescriptionJson) || hasRouteMedia(source);
}

/** Whether the event has a map or a GPX file of its own for «Traseul» (§NNN). */
export function hasRouteMedia(source: Pick<RouteSectionSource, "routeMaps" | "routeGpx">): boolean {
  return readRouteMaps(source.routeMaps).length > 0 || readRouteGpx(source.routeGpx) !== null;
}

/**
 * The event's links split between the route section and "Linkuri și fișiere", each in the club's
 * order. Without a route section every link stays in "Linkuri și fișiere", exactly as before.
 */
export function partitionEventLinks(links: unknown, routeSection: boolean): { route: EventLink[]; other: EventLink[] } {
  const rows = readEventLinks(links);
  if (!routeSection) return { route: [], other: rows };
  return {
    route: rows.filter((link) => isRouteLinkKind(link.kind)),
    other: rows.filter((link) => !isRouteLinkKind(link.kind)),
  };
}
