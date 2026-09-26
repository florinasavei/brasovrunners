import UmbrellaIcon from "@mui/icons-material/Umbrella";
import Box from "@mui/material/Box";
import { rainLikely, type WeatherReading } from "../domain/forecast";
import { weatherListWords, weatherWords } from "../words";
import { WEATHER_GLYPH } from "./glyphs";

/**
 * The weather at the start on a listing card (§416; the owner, 2026-09-25: "aș vrea să văd vremea
 * și pe cardul principal"): the forecast's glyph and the degrees — «☁ 14 °C» — drawn like the
 * route's pills (24 pixels, outlined, rounded) so it is one more fact a runner scans, not a line of
 * its own that would make every card taller.
 *
 * Where (§429, amending §416): the **last pill of the route's row** (`RoutePills`' trailing slot,
 * from `EventFacts`' compact form), after the cost — what the day will be like beside what the
 * route is, no longer among the marks above the title (type, partner, cancelled), which say what
 * the event is. And when rain is likely at the start (`rainLikely`: a chance of 50% or more, *or*
 * a forecast amount of 0.5 mm or more already falling in the hour even at a lower chance — a
 * showery hour of 45% with 2 mm still earns it — unless the sky's own glyph says more: snow, frost
 * or the storm), the umbrella sits **beside** the sky's own glyph — «🌧 ☂ 9 °C» — never replacing
 * it, so a showers hour still reads as showers and the umbrella says something on its own; a
 * screen reader hears «ploaie probabilă» / "rain likely" after the degrees.
 *
 * The glyph is a Material icon made here, in a Server Component, and never handed to a client
 * component as an element (§370): the pill is a plain `<span>`, not MUI's `Chip`, whose `icon` prop
 * would be exactly that. A screen reader hears «Vremea la start: Parțial noros, 14 °C»; the eye
 * gets the glyph and the number. The word, the rain, the wind, the details and the credit are the
 * page's. Open-Meteo's credit is never on a card: it lives in the site footer's «Despre club»
 * fold (`SiteFooter`), and beside the forecast on the event page and the featured hero (§429).
 */
export default function CardWeather({ reading, locale }: { reading: WeatherReading; locale: "ro" | "en" }) {
  const words = weatherWords(reading, locale);
  const umbrella = rainLikely(reading);
  const Glyph = WEATHER_GLYPH[reading.glyph];
  const spoken = [`${weatherListWords(locale).atStart}: ${words.summary}`, words.temperature, umbrella ? words.rainLikely : null].filter(Boolean).join(
    ", ",
  );
  return (
    <Box
      component="span"
      data-testid="card-weather"
      data-rain-likely={umbrella ? "true" : undefined}
      sx={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        // The border inside the 24 pixels, as a small Chip's is: 26 beside the pills otherwise (found by the e2e).
        boxSizing: "border-box",
        height: 24,
        px: 1,
        border: 1,
        borderColor: "divider",
        borderRadius: 4,
        fontSize: "0.8125rem",
        lineHeight: 1,
        color: "text.primary",
        whiteSpace: "nowrap",
      }}
    >
      <Glyph aria-hidden="true" sx={{ fontSize: 18, color: "text.secondary" }} />
      {umbrella ? <UmbrellaIcon aria-hidden="true" sx={{ fontSize: 18, color: "text.secondary" }} /> : null}
      <span aria-hidden="true">{words.temperature ?? words.summary}</span>
      <Box component="span" sx={SR_ONLY_SX}>
        {spoken}
      </Box>
    </Box>
  );
}

const SR_ONLY_SX = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;
