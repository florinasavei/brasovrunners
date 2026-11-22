import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { getLocale, getTranslations } from "next-intl/server";
import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { cachedPublishedAlbums } from "@/modules/public-cache/reads";
import { readOrWhileAway } from "@/modules/resilience/optional-read";
import { DENSITY } from "@/theme/density";

/**
 * «Album foto» on the event's page (§NNN — the owner, 2026-11-22: «sunt poze pe Google Photos … vor fi vreo 7 albume … cum am zis și cu
 * clasament»), under `#album-foto`, right under «Clasament»: one button per published album linked to this event, newest first — to the
 * album's «Link Google Photos» in a new tab when it has one, else to the album's own page. Nothing at all without an album, and nothing
 * while the database is away (a button is not worth a page). Reads the gallery's cached list, never a query of its own.
 */
export default async function EventAlbums({ eventId }: { eventId: string }) {
  const locale = (await getLocale()) as Locale;
  const albums = (await readOrWhileAway(() => cachedPublishedAlbums(locale), [])).filter((album) => album.eventId === eventId);
  if (albums.length === 0) return null;
  const t = await getTranslations("Gallery");
  return (
    <Box component="section" id="album-foto" aria-labelledby="album-foto-title" data-testid="event-albums" sx={{ mt: { xs: DENSITY.sectionGap, sm: 4 }, scrollMarginTop: 16 }}>
      <Typography component="h2" id="album-foto-title" variant="h2" sx={{ fontSize: "1.25rem", mb: 1.5 }}>
        <PhotoLibraryIcon aria-hidden sx={{ fontSize: "1.25rem", verticalAlign: "-0.15em", mr: 0.75 }} />
        {t("eventAlbumsTitle")}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        {albums.map((album) =>
          album.externalUrl ? (
            <Button key={album.id} component="a" href={album.externalUrl} target="_blank" rel="noopener noreferrer" variant="contained" data-testid="event-album">
              <PhotoLibraryIcon aria-hidden sx={{ mr: 1, fontSize: 20 }} />
              {album.title}
            </Button>
          ) : (
            <Button key={album.id} component="a" href={getPathname({ locale, href: { pathname: "/gallery/[slug]", params: { slug: album.slug } } })} variant="contained" data-testid="event-album">
              <PhotoLibraryIcon aria-hidden sx={{ mr: 1, fontSize: 20 }} />
              {album.title}
            </Button>
          ),
        )}
      </Box>
    </Box>
  );
}
