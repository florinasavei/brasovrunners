import Box from "@mui/material/Box";
import type { WeatherReading } from "../domain/forecast";
import { weatherListWords, weatherWords } from "../words";
import { WEATHER_GLYPH } from "./glyphs";

/**
 * The weather at the start on a listing card (§416; the owner, 2026-09-25: "aș vrea să văd vremea
 * și pe cardul principal"): the forecast's glyph and the degrees — «☁ 14 °C» — in the card's row of
 * chips, drawn like them (24 pixels, outlined, rounded) so it is one more fact a runner scans, not a
 * line of its own that would make every card taller.
 *
 * The glyph is a Material icon made here, in a Server Component, and never handed to a client
 * component as an element (§370): the pill is a plain `<span>`, not MUI's `Chip`, whose `icon` prop
 * would be exactly that. A screen reader hears «Vremea la start: Parțial noros, 14 °C»; the eye
 * gets the glyph and the number. The word, the rain, the wind, the details and the credit are the
 * page's — the listing credits Open-Meteo once, under its cards.
 */
export default function CardWeather({ reading, locale }: { reading: WeatherReading; locale: "ro" | "en" }) {
  const words = weatherWords(reading, locale);
  const Glyph = WEATHER_GLYPH[reading.glyph];
  const spoken = `${weatherListWords(locale).atStart}: ${words.summary}${words.temperature ? `, ${words.temperature}` : ""}`;
  return (
    <Box
      component="span"
      data-testid="card-weather"
      sx={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        // The border inside the 24 pixels, as a small Chip's is: 26 beside the chips otherwise (found by the e2e).
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
