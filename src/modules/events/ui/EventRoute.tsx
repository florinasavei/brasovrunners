import RouteIcon from "@mui/icons-material/Route";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import RichText from "@/modules/content/rich-text/ui/RichText";
import SocialIcon from "@/shared/ui/SocialIcon";
import { DENSITY } from "@/theme/density";
import { isStravaLink } from "../domain/event-type";
import type { EventLinkKind } from "../domain/links";
import { hasRouteDescription, partitionEventLinks } from "../domain/route-section";
import { eventLinkRow, LinkList, type LinkRow } from "./EventLinks";

/**
 * "Traseul" / "The route" under `#route` (§NNN): the organizer's route or training description —
 * the pit stops, the climbs, what to expect, and a map when they have one, which is a picture in
 * the text (§72–§73) rather than a field of its own — with the route's own links first: the route
 * link (a Strava route or activity, with Strava's mark, §61) and the GPX and map links of
 * "Linkuri și fișiere" (§332), drawn exactly as that section draws them.
 *
 * Nothing at all when this language's description is empty: the route's links then stay where
 * they were — the route link in the facts' route row, the GPX and the map in "Linkuri și fișiere"
 * (`partitionEventLinks`, which the page's other two callers read the same way).
 *
 * A Server Component with no catalogue of its own, so the public page and the staff preview draw
 * it identically: the page hands it the words.
 */
export default function EventRoute({
  descriptionJson,
  links,
  routeUrl,
  locale,
  heading,
  openRouteLabel,
  kindLabels,
}: {
  /** This language's route description as stored (a rich-text document, or null). */
  descriptionJson: unknown;
  /** The event's "Linkuri și fișiere" column as stored; only its route kinds are drawn here. */
  links: unknown;
  /** The route link (`events.route_url`), or null. */
  routeUrl: string | null;
  locale: "ro" | "en";
  heading: string;
  /** "Vezi traseul" — the words the facts' route row gives the same link. */
  openRouteLabel: string;
  kindLabels: Record<EventLinkKind, string>;
}) {
  if (!hasRouteDescription(descriptionJson)) return null;

  const rows: LinkRow[] = [];
  if (routeUrl) {
    rows.push({
      url: routeUrl,
      label: openRouteLabel,
      icon: isStravaLink(routeUrl) ? <SocialIcon network="strava" size={22} /> : <RouteIcon aria-hidden="true" sx={{ fontSize: 22, flexShrink: 0 }} />,
      kind: "ROUTE",
    });
  }
  for (const link of partitionEventLinks(links, true).route) rows.push(eventLinkRow(link, locale, kindLabels));

  return (
    <Box component="section" id="route" data-testid="event-route" sx={{ mt: { xs: DENSITY.sectionGapLg, sm: 4 } }}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
        {heading}
      </Typography>
      {rows.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <LinkList rows={rows} />
        </Box>
      )}
      <RichText body={descriptionJson} />
    </Box>
  );
}
