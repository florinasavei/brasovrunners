import AcUnitIcon from "@mui/icons-material/AcUnit";
import CloudIcon from "@mui/icons-material/Cloud";
import CloudySnowingIcon from "@mui/icons-material/CloudySnowing";
import FilterDramaIcon from "@mui/icons-material/FilterDrama";
import FoggyIcon from "@mui/icons-material/Foggy";
import GrainIcon from "@mui/icons-material/Grain";
import ThermostatIcon from "@mui/icons-material/Thermostat";
import ThunderstormIcon from "@mui/icons-material/Thunderstorm";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import type { Glyph } from "@/modules/events/ui/glyphs";
import type { WeatherGlyphName } from "../domain/wmo";
import RainyIcon from "./RainyIcon";

/**
 * The forecast's glyph by name (§402), one file per glyph from `@mui/icons-material` (§90), never
 * the barrel, and one drawn here where Material has none (`RainyIcon`). The domain says a name
 * (`wmo.ts`), so the reminder — which draws no icon — and the page read one table; only a Server
 * Component turns the name into an icon, and it never hands the icon to a client component (§370).
 *
 * The sun for a clear sky; a cloud with a gap in it for a partly cloudy one; a whole cloud for an
 * overcast one; the mist; fine drops for drizzle; one drop for rain; a cloud with rain falling from
 * it for showers and heavy rain (§NNN — never a closed umbrella); a snowflake for frost (freezing
 * drizzle and rain) and snow falling from a cloud for snow; the storm. Always beside its word: the
 * word is what is read.
 */
export const WEATHER_GLYPH: Record<WeatherGlyphName, Glyph> = {
  clear: WbSunnyIcon,
  partlyCloudy: FilterDramaIcon,
  cloud: CloudIcon,
  fog: FoggyIcon,
  drizzle: GrainIcon,
  rain: WaterDropIcon,
  showers: RainyIcon,
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
