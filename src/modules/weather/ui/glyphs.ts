import AcUnitIcon from "@mui/icons-material/AcUnit";
import CloudIcon from "@mui/icons-material/Cloud";
import CloudySnowingIcon from "@mui/icons-material/CloudySnowing";
import FilterDramaIcon from "@mui/icons-material/FilterDrama";
import FoggyIcon from "@mui/icons-material/Foggy";
import ThermostatIcon from "@mui/icons-material/Thermostat";
import ThunderstormIcon from "@mui/icons-material/Thunderstorm";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import type { Glyph } from "@/modules/events/ui/glyphs";
import type { WeatherGlyphName } from "../domain/wmo";
import RainyHeavyIcon from "./RainyHeavyIcon";
import RainyIcon from "./RainyIcon";
import RainyLightIcon from "./RainyLightIcon";

/**
 * The forecast's glyph by name (§402), one file per glyph from `@mui/icons-material` (§90), never
 * the barrel, and the three rain clouds drawn here where Material has none (`RainyLightIcon`,
 * `RainyIcon`, `RainyHeavyIcon`). The domain says a name
 * (`wmo.ts`), so the reminder — which draws no icon — and the page read one table; only a Server
 * Component turns the name into an icon, and it never hands the icon to a client component (§370).
 *
 * The sun for a clear sky; a cloud with a gap in it for a partly cloudy one; a whole cloud for an
 * overcast one; the mist; then one family of three rain clouds by intensity (§682, amending §677)
 * — two short strokes under the cloud for drizzle, three for plain rain, four long ones for showers
 * and heavy rain (never a closed umbrella, §677); a snowflake for frost (freezing drizzle and rain)
 * and snow falling from a cloud for snow; the storm. Always beside its word: the word is what is
 * read.
 *
 * No sky glyph is the drop (`WaterDrop`, §682; the owner, 2026-10-09: «Yes different icon»): the
 * drop is the chance of rain's mark alone — after the degrees on a card's pill (`CardWeather`),
 * before «ploaie probabilă» on the hero's line and the event page's row (`EventFacts`) — so a rain
 * hour never reads «💧 12 °C 💧 70 %», one drop in two roles. A test holds it.
 */
export const WEATHER_GLYPH: Record<WeatherGlyphName, Glyph> = {
  clear: WbSunnyIcon,
  partlyCloudy: FilterDramaIcon,
  cloud: CloudIcon,
  fog: FoggyIcon,
  drizzle: RainyLightIcon,
  rain: RainyIcon,
  showers: RainyHeavyIcon,
  snow: CloudySnowingIcon,
  ice: AcUnitIcon,
  snowShowers: CloudySnowingIcon,
  thunder: ThunderstormIcon,
};

/**
 * The glyph beside the club's own weather text (§666): a thermometer, neither sun nor rain — the
 * sky is the club's words to say, not a forecast's kind to draw.
 */
export const CLUB_WEATHER_GLYPH: Glyph = ThermostatIcon;
