import MapIcon from "@mui/icons-material/Map";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import SocialIcon from "@/shared/ui/SocialIcon";
import WatchIcon from "@mui/icons-material/Watch";
import { type RouteMap, routeMapEmbedSrc, routeMapLink } from "../domain/route-maps";

/** One service's words in «Traseul» (§718), in the reader's language. */
export type RouteMapProviderWords = {
  /** The tab: «Garmin Connect», «Strava». */
  tab: string;
  /** The press that loads the map: «Arată harta pe Strava». */
  show: string;
  /** Where the map comes from: «Harta vine de la Strava; Strava vede adresa ta IP.» */
  notice: string;
  /** The link to the route on the service: «Deschide în Strava». */
  open: string;
  /** The map's accessible title. */
  frame: string;
};

/**
 * One service's map in «Traseul» (§718), open from the start (§739), and its link.
 *
 * Since §739 the disclosure is drawn open: the owner chose the map with the page over the press, knowing
 * the service then sees the visitor's address. Before, the press was the house's facade for a third party (§69, §110, §266, §403): a native `<details>`,
 * rendered here on the server, whose closed state is the line «Arată harta pe …» — and a closed
 * disclosure keeps its contents out of the page (`content-visibility: hidden`), so the lazy iframe
 * inside asks Strava or Garmin for nothing, sets no cookie and runs no script until the visitor
 * opens it. No client code: a `<summary>` opens its `<details>` with scripts off. The iframe's
 * address is built from the stored id (and, for Strava, its three checked values) by
 * `routeMapEmbedSrc` — never the HTML the club pasted, and never the provider's `embed.js` (§61).
 *
 * The iframe is sandboxed to what a map needs — its own scripts, its own origin for the tiles, and
 * a new tab for the service's own links — and sends Strava or Garmin this site's origin, never the
 * page's path. A fixed height rather than Strava's height messages: those would need a script on our
 * page, and a map does not need to fit its content.
 *
 * Under the map, always visible: the sentence that says where the map comes from, and the link to the
 * route on the service (built from the id), with the service's mark, 44 pixels tall.
 */
/**
 * The frame's height by service (§738). Strava's card is its title and figures, the map, the elevation
 * profile and its footer, one under another; it would tell its height by a message, which needs a
 * script here, so the frame is tall enough for the whole card instead of scrolling inside itself.
 */
const FRAME_HEIGHT = { strava: { xs: 760, sm: 880 }, garmin: { xs: 600, sm: 720 } } as const;

export default function RouteMapPanel({
  map,
  words,
  origin,
  tab,
}: {
  map: RouteMap;
  words: RouteMapProviderWords;
  /** This site's origin, for Strava's height messages' target (`stravaEmbedSrc`). */
  origin: string;
  /** Set when the panel is one of the tabs: its own id and the tab that labels it. */
  tab?: { panelId: string; tabId: string };
}) {
  const mark =
    map.provider === "strava" ? <SocialIcon network="strava" size={22} /> : <WatchIcon aria-hidden="true" sx={{ fontSize: 22, flexShrink: 0 }} />;
  return (
    <Box
      data-route-map-panel={map.provider}
      data-testid={`route-map-${map.provider}`}
      {...(tab ? { role: "tabpanel", id: tab.panelId, "aria-labelledby": tab.tabId } : {})}
    >
      <Box
        component="details"
        // Open from the start (the owner, 2026-10-12: «yes I want it always opened», §739): the visible tab's
        // map loads with the page; a hidden tab's lazy frame waits until its tab is chosen.
        open
        sx={{
          "& summary::-webkit-details-marker": { display: "none" },
          // Open, the map takes the press's place: one box, never the line and the map stacked.
          "&[open] > summary": { display: "none" },
        }}
      >
        <Box
          component="summary"
          data-testid={`route-map-show-${map.provider}`}
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            minHeight: 44,
            px: 2,
            py: 1.5,
            listStyle: "none",
            cursor: "pointer",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            bgcolor: "action.hover",
            color: "primary.main",
            fontWeight: 600,
            textAlign: "center",
            "&::marker": { content: '""' },
            "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: "2px" },
          }}
        >
          <MapIcon aria-hidden="true" sx={{ fontSize: 22, flexShrink: 0 }} />
          {words.show}
        </Box>
        <Box sx={{ position: "relative", width: "100%", height: FRAME_HEIGHT[map.provider], borderRadius: 1, overflow: "hidden", bgcolor: "action.hover" }}>
          <Box
            component="iframe"
            src={routeMapEmbedSrc(map, origin)}
            title={words.frame}
            loading="lazy"
            referrerPolicy="strict-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            data-testid={`route-map-frame-${map.provider}`}
            sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
        {words.notice}
      </Typography>
      <Link
        href={routeMapLink(map)}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={`route-map-open-${map.provider}`}
        sx={{ display: "inline-flex", alignItems: "center", gap: 1, minHeight: 44, py: 0.5 }}
      >
        {mark}
        {words.open}
        <OpenInNewIcon aria-hidden="true" sx={{ fontSize: 16 }} />
      </Link>
    </Box>
  );
}
