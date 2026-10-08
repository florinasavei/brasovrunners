import WaterDropIcon from "@mui/icons-material/WaterDrop";
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
 * the event is.
 *
 * The chance of rain after the degrees (§NNN, amending §429; the owner, 2026-10-08: «I hate that
 * umbrella closed, show percentages of precipitation as well»): a drop and the hour's chance —
 * «☁ 14 °C 💧 20 %» — whenever the forecast has one and it does not round to 0 (a dry hour has
 * nothing to read). In `text.secondary` like the glyph; when rain is likely at the start
 * (`rainLikely`, §429's rule, unchanged: a chance of 50% or more, *or* 0.5 mm or more already
 * falling in the hour, unless the sky's own glyph says more: snow, frost or the storm) the drop and
 * the figure take the primary colour — «🌧 9 °C 💧 60 %» — so the likely hour stands out without a
 * second glyph. A likely hour with no chance to show — likely by its amount alone, with no chance
 * or one that rounds to 0 — still gets the drop, alone and primary, so the eye is told what a screen
 * reader hears. No umbrella any more, closed or open. A screen reader hears the chance in words
 * after the degrees, «20% șanse de ploaie», and «ploaie probabilă» / "rain likely" after it when
 * rain is likely, as before.
 *
 * The glyphs are Material icons made here, in a Server Component, and never handed to a client
 * component as an element (§370): the pill is a plain `<span>`, not MUI's `Chip`, whose `icon` prop
 * would be exactly that. A screen reader hears «Vremea la start: Parțial noros, 14 °C»; the eye
 * gets the glyph and the number. The word, the wind, the details and the credit are the
 * page's. Open-Meteo's credit is never on a card: it lives in the site footer's «Despre club»
 * fold (`SiteFooter`), and beside the forecast on the event page and the featured hero (§429).
 */
export default function CardWeather({ reading, locale }: { reading: WeatherReading; locale: "ro" | "en" }) {
  const words = weatherWords(reading, locale);
  const likely = rainLikely(reading);
  const Glyph = WEATHER_GLYPH[reading.glyph];
  const spoken = [`${weatherListWords(locale).atStart}: ${words.summary}`, words.temperature, words.chanceSpoken, likely ? words.rainLikely : null]
    .filter(Boolean)
    .join(", ");
  return (
    <Box
      component="span"
      data-testid="card-weather"
      data-rain-likely={likely ? "true" : undefined}
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
      <span aria-hidden="true">{words.temperature ?? words.summary}</span>
      {words.chanceShort !== null || likely ? (
        <Box
          component="span"
          aria-hidden="true"
          data-testid="card-weather-chance"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, ml: 0.25, color: likely ? "primary.main" : "text.secondary" }}
        >
          <WaterDropIcon sx={{ fontSize: 18, color: "inherit" }} />
          {words.chanceShort}
        </Box>
      ) : null}
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
