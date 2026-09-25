import AcUnitIcon from "@mui/icons-material/AcUnit";
import CloudIcon from "@mui/icons-material/Cloud";
import CloudySnowingIcon from "@mui/icons-material/CloudySnowing";
import FilterDramaIcon from "@mui/icons-material/FilterDrama";
import FoggyIcon from "@mui/icons-material/Foggy";
import GrainIcon from "@mui/icons-material/Grain";
import ThunderstormIcon from "@mui/icons-material/Thunderstorm";
import UmbrellaIcon from "@mui/icons-material/Umbrella";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import WbSunnyIcon from "@mui/icons-material/WbSunny";
import type { Glyph } from "@/modules/events/ui/glyphs";
import type { WeatherGlyphName } from "../domain/wmo";

/**
 * The forecast's glyph by name (§402), one file per glyph from `@mui/icons-material` (§90), never
 * the barrel. The domain says a name (`wmo.ts`), so the reminder — which draws no icon — and the
 * page read one table; only a Server Component turns the name into an icon, and it never hands
 * the icon to a client component (§370).
 *
 * The sun for a clear sky; a cloud with a gap in it for a partly cloudy one; a whole cloud for an
 * overcast one; the mist; fine drops for drizzle; one drop for rain; the umbrella for showers and
 * heavy rain — the kind a runner packs for; a snowflake for frost (freezing drizzle and rain) and
 * snow falling from a cloud for snow; the storm. Always beside its word: the word is what is read.
 */
export const WEATHER_GLYPH: Record<WeatherGlyphName, Glyph> = {
  clear: WbSunnyIcon,
  partlyCloudy: FilterDramaIcon,
  cloud: CloudIcon,
  fog: FoggyIcon,
  drizzle: GrainIcon,
  rain: WaterDropIcon,
  showers: UmbrellaIcon,
  snow: CloudySnowingIcon,
  ice: AcUnitIcon,
  snowShowers: CloudySnowingIcon,
  thunder: ThunderstormIcon,
};
