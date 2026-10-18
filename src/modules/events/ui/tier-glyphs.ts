import BoltIcon from "@mui/icons-material/Bolt";
import DiamondIcon from "@mui/icons-material/Diamond";
import DirectionsRunIcon from "@mui/icons-material/DirectionsRun";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import FavoriteIcon from "@mui/icons-material/Favorite";
import FlagIcon from "@mui/icons-material/Flag";
import LocalFireDepartmentIcon from "@mui/icons-material/LocalFireDepartment";
import ShieldIcon from "@mui/icons-material/Shield";
import StarIcon from "@mui/icons-material/Star";
import TerrainIcon from "@mui/icons-material/Terrain";
import VerifiedIcon from "@mui/icons-material/Verified";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import type { SvgIconProps } from "@mui/material/SvgIcon";
import type { ComponentType } from "react";
import type { TierGlyphKey } from "@/modules/content/member-tiers/glyph-keys";

/**
 * The pictures of the member tiers' glyphs (§811), by the names of `member-tiers/glyph-keys.ts`. Since §817
 * a leftover column (the card no longer offers the choice; the default is `star`): `GlyphChip` draws it as
 * `tier:<name>` only on «Echipa»'s level chip, for the staff. Registered in the public table
 * (`glyphs.ts` adds the prefix). One file per
 * glyph from `@mui/icons-material`, never the barrel (§90). Always beside the tier's name, never alone.
 */
export const TIER_GLYPH: Record<TierGlyphKey, ComponentType<SvgIconProps>> = {
  star: StarIcon,
  medal: WorkspacePremiumIcon,
  trophy: EmojiEventsIcon,
  diamond: DiamondIcon,
  heart: FavoriteIcon,
  bolt: BoltIcon,
  shield: ShieldIcon,
  runner: DirectionsRunIcon,
  flag: FlagIcon,
  flame: LocalFireDepartmentIcon,
  verified: VerifiedIcon,
  mountain: TerrainIcon,
};

/** The name `GlyphChip` takes for a tier's glyph: `tier:star`, `tier:medal`… — a key of `GLYPHS` (`glyphs.ts` registers the table with this prefix). */
export function tierGlyphName(key: TierGlyphKey): `tier:${TierGlyphKey}` {
  return `tier:${key}`;
}
