import DownloadIcon from "@mui/icons-material/Download";
import RouteIcon from "@mui/icons-material/Route";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import RichText from "@/modules/content/rich-text/ui/RichText";
import { getStorage, isStorageConfigured } from "@/modules/media/storage";
import { env } from "@/shared/config/env";
import SocialIcon from "@/shared/ui/SocialIcon";
import { DENSITY } from "@/theme/density";
import { isStravaLink } from "../domain/event-type";
import type { EventLinkKind } from "../domain/links";
import { gpxSizeWords, readRouteGpx, routeGpxFileName } from "../domain/route-gpx";
import { readRouteMaps, type RouteMapProvider, routeUrlIsStravaMap } from "../domain/route-maps";
import { hasRouteDescription, hasRouteSection, partitionEventLinks } from "../domain/route-section";
import { eventLinkRow, LinkList, type LinkRow } from "./EventLinks";
import RouteMapPanel, { type RouteMapProviderWords } from "./RouteMapPanel";
import RouteMapTabs from "./RouteMapTabs";

/** «Traseul»'s words for the maps and the GPX (§NNN), the `Event.routeMaps` sub-tree of the catalogue. */
export type RouteMapWords = {
  /** The tabs' accessible name: «Hărțile traseului». */
  tabs: string;
  garmin: RouteMapProviderWords;
  strava: RouteMapProviderWords;
  /** «Descarcă traseul (GPX)». */
  gpx: string;
};

/**
 * "Traseul" / "The route" under `#route` (§387): the organizer's route or training description —
 * the pit stops, the climbs, what to expect, and a map when they have one, which is a picture in
 * the text (§72–§73) rather than a field of its own — with the route's own links first: the route
 * link (a Strava route or activity, with Strava's mark, §61) and the GPX and map links of
 * "Linkuri și fișiere" (§332), drawn exactly as that section draws them.
 *
 * Since §NNN, the event's own maps and file under them: Garmin Connect and Strava in tabs (the
 * owner's layout, Garmin first; one service alone needs no tabs), each map behind its own press
 * (`RouteMapPanel`), then the GPX the club uploaded, «Descarcă traseul (GPX)», whether or not there
 * is a map. The route link is not drawn when it is the very Strava route the Strava tab opens.
 *
 * Nothing at all when this language has no description and the event has no map and no file
 * (`hasRouteSection`): the route's links then stay where they were — the route link in the facts'
 * route row, the GPX and the map in "Linkuri și fișiere" (`partitionEventLinks`, which the page's
 * other two callers read the same way).
 *
 * A Server Component with no catalogue of its own, so the public page and the staff preview draw
 * it identically: the page hands it the words.
 */
export default function EventRoute({
  descriptionJson,
  links,
  routeUrl,
  routeMaps,
  routeGpx,
  locale,
  heading,
  openRouteLabel,
  kindLabels,
  mapWords,
}: {
  /** This language's route description as stored (a rich-text document, or null). */
  descriptionJson: unknown;
  /** The event's "Linkuri și fișiere" column as stored; only its route kinds are drawn here. */
  links: unknown;
  /** The route link (`events.route_url`), or null. */
  routeUrl: string | null;
  /** «Traseul»'s maps as stored (`events.route_maps`, §NNN). */
  routeMaps?: unknown;
  /** «Traseul»'s GPX as stored (`events.route_gpx`, §NNN). */
  routeGpx?: unknown;
  locale: "ro" | "en";
  heading: string;
  /** "Vezi traseul" — the words the facts' route row gives the same link. */
  openRouteLabel: string;
  kindLabels: Record<EventLinkKind, string>;
  /** The maps' and the file's words; without them the section draws neither. */
  mapWords?: RouteMapWords;
}) {
  if (!hasRouteSection({ routeDescriptionJson: descriptionJson, routeMaps, routeGpx })) return null;

  const rows: LinkRow[] = [];
  if (routeUrl && !routeUrlIsStravaMap(routeUrl, routeMaps)) {
    rows.push({
      url: routeUrl,
      label: openRouteLabel,
      icon: isStravaLink(routeUrl) ? <SocialIcon network="strava" size={22} /> : <RouteIcon aria-hidden="true" sx={{ fontSize: 22, flexShrink: 0 }} />,
      kind: "ROUTE",
    });
  }
  for (const link of partitionEventLinks(links, true).route) rows.push(eventLinkRow(link, locale, kindLabels));

  const maps = mapWords ? readRouteMaps(routeMaps) : [];
  const gpx = mapWords && isStorageConfigured() ? readRouteGpx(routeGpx) : null;
  const origin = new URL(env.APP_BASE_URL).origin;
  const ids = (provider: RouteMapProvider) => ({ tabId: `route-map-tab-${provider}`, panelId: `route-map-panel-${provider}` });

  return (
    <Box component="section" id="route" data-testid="event-route" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 } }}>
      <Typography variant="h2" sx={{ fontSize: "1.25rem", mb: 1 }}>
        {heading}
      </Typography>
      {rows.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <LinkList rows={rows} />
        </Box>
      )}
      {mapWords && maps.length === 1 && (
        <Box sx={{ mb: 1.5 }}>
          <RouteMapPanel map={maps[0]} words={mapWords[maps[0].provider]} origin={origin} />
        </Box>
      )}
      {mapWords && maps.length > 1 && (
        <Box sx={{ mb: 1.5 }}>
          <RouteMapTabs label={mapWords.tabs} tabs={maps.map((map) => ({ provider: map.provider, label: mapWords[map.provider].tab, ...ids(map.provider) }))}>
            {maps.map((map) => (
              <RouteMapPanel key={map.provider} map={map} words={mapWords[map.provider]} origin={origin} tab={ids(map.provider)} />
            ))}
          </RouteMapTabs>
        </Box>
      )}
      {mapWords && gpx && (
        <Box sx={{ mb: 1.5 }}>
          <Link
            href={getStorage().publicUrl(gpx.key)}
            download={routeGpxFileName(gpx.key)}
            data-testid="route-gpx-download"
            sx={{ display: "flex", alignItems: "center", gap: 1.25, minHeight: 44, py: 0.5 }}
          >
            <DownloadIcon aria-hidden="true" sx={{ fontSize: 22, flexShrink: 0 }} />
            <Box component="span" sx={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <Box component="span">{mapWords.gpx}</Box>
              <Typography component="span" variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere", lineHeight: 1.3 }}>
                {gpx.size > 0 ? `${gpx.name} · ${gpxSizeWords(gpx.size, locale)}` : gpx.name}
              </Typography>
            </Box>
          </Link>
        </Box>
      )}
      {hasRouteDescription(descriptionJson) && <RichText body={descriptionJson} />}
    </Box>
  );
}
