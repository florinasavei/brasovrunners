import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";
import { OPEN_METEO_SITE } from "../domain/credit";
import { weatherListWords } from "../words";

/**
 * The listing's one credit for the forecasts on its cards (§416): «Prognoză: Open-Meteo», a link to
 * Open-Meteo's site as its CC BY licence asks (§402), under the cards and only when a card carries
 * a forecast. One line for the page rather than one per card: a card's pill is a glyph and a
 * number, and a link inside every card would be one more 44-pixel target on each. A thumb's 44
 * pixels (BR-REQ-041-01 criterion 6), `noopener noreferrer` like every link out.
 */
export default function WeatherCredit({ locale }: { locale: "ro" | "en" }) {
  const words = weatherListWords(locale);
  return (
    <Typography component="p" variant="body2" color="text.secondary" data-testid="listing-weather-credit" sx={{ mt: 1, mb: 0 }}>
      <Link
        href={OPEN_METEO_SITE}
        target="_blank"
        rel="noopener noreferrer"
        sx={{ display: "inline-flex", alignItems: "center", boxSizing: "border-box", minHeight: 44 }}
      >
        {words.credit}
      </Link>
    </Typography>
  );
}
