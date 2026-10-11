import EventIcon from "@mui/icons-material/Event";
import PlaceIcon from "@mui/icons-material/Place";
import WbTwilightIcon from "@mui/icons-material/WbTwilight";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { Link } from "@/i18n/navigation";
import type { WeatherGlyphName } from "@/modules/weather/domain/wmo";
import { WEATHER_GLYPH } from "@/modules/weather/ui/glyphs";
import { HOME_CARD_BODY_SX, HOME_CARD_PICTURE_SX, HOME_CARD_SX, HOME_CARD_TITLE_SX } from "./card-sx";
import HomePicture, { type HomePictureSources } from "./HomePicture";
import RoundArrow from "./RoundArrow";
import RunTag, { type RunTagProps } from "./RunTag";

export type NextRunCardProps = {
  /** The section's heading, «Următoarea alergare». */
  heading: string;
  slug: string;
  title: string;
  /** The date and the hour in words, on the event's own clock: «Marți, 14 oct. 2026, 18:30». */
  when: string;
  place: string | null;
  /** «Apus la 18:42» — the day's sunset at the event's place (`sun.ts`), or null for none. */
  sunset: string | null;
  /** The forecast at the start (§402), in words from its condition code, and its glyph by name; null outside the seven days. */
  weather: { glyph: WeatherGlyphName; words: string } | null;
  picture: HomePictureSources | null;
  tag: RunTagProps;
};

const FACT_ICON_SX = { fontSize: 20, color: "text.secondary", flexShrink: 0 } as const;

/**
 * «Următoarea alergare» (the facelift's phase 3, §NNN): the soonest run still going ahead
 * (`homeSections`, open question 7's default), as one wide card — its cover on top on a phone and
 * beside the words from `md`, the kind's tag over the picture, the title as the link to its page over
 * the whole card, then when, where, the forecast's words at the start (open question 6's default:
 * from Open-Meteo's condition code, §402) and the day's sunset, each a line with its glyph, and the
 * round arrow (decision 10).
 *
 * A Server Component with typed props (§370): the glyphs are drawn here, by name for the weather's.
 */
export default function NextRunCard({ heading, slug, title, when, place, sunset, weather, picture, tag }: NextRunCardProps) {
  const WeatherGlyph = weather ? WEATHER_GLYPH[weather.glyph] : null;
  const facts = [
    { key: "when", Icon: EventIcon, text: when },
    ...(place ? [{ key: "place", Icon: PlaceIcon, text: place }] : []),
    ...(weather && WeatherGlyph ? [{ key: "weather", Icon: WeatherGlyph, text: weather.words }] : []),
    ...(sunset ? [{ key: "sunset", Icon: WbTwilightIcon, text: sunset }] : []),
  ];
  return (
    <Box component="section" aria-labelledby="home-next-title" data-testid="home-next-run">
      <Typography variant="h2" id="home-next-title" sx={{ fontSize: { xs: "1.375rem", sm: "1.625rem" }, mb: 1.5 }}>
        {heading}
      </Typography>
      <Box
        component="article"
        sx={{ ...HOME_CARD_SX, flexDirection: { xs: "column", md: "row" } }}
      >
        <Box sx={{ ...HOME_CARD_PICTURE_SX, width: { xs: "100%", md: "50%" } }}>
          <HomePicture picture={picture} testId="home-next-picture" />
          <RunTag {...tag} />
        </Box>
        <Box sx={{ ...HOME_CARD_BODY_SX, gap: 1, justifyContent: "center", p: { xs: 2, md: 3 } }}>
          <Typography variant="h3" sx={{ ...HOME_CARD_TITLE_SX, fontSize: { xs: "1.25rem", md: "1.5rem" } }}>
            <Link href={{ pathname: "/events/[slug]", params: { slug } }}>{title}</Link>
          </Typography>
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexDirection: "column", gap: 0.75 }}>
            {facts.map(({ key, Icon, text }) => (
              <Box key={key} component="li" data-testid={`home-next-${key}`} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Icon aria-hidden="true" sx={FACT_ICON_SX} />
                <Typography component="span" variant="body2">
                  {text}
                </Typography>
              </Box>
            ))}
          </Box>
          <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
            <RoundArrow />
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
