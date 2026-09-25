import { hasRichTextContent, readRichText } from "@/modules/content/rich-text/domain/schema";
import { type EventLink, type EventLinkKind, readEventLinks } from "./links";

/**
 * The route section of the event page, "Traseul" under `#route` (§387; the owner, 2026-09-25: "I
 * should be able to put 'descriere traseu/antrenament' with pit stops and all, basically a free
 * text, might also attach a map there; you can move the GPX and Strava link there").
 *
 * Pure, and the one place that decides what the section holds, so the page, the staff preview and
 * the facts' route row cannot disagree about which link is drawn where:
 * - the section exists only when this language's route description says something
 *   (`hasRouteDescription`); an event without one keeps every link where it was;
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
