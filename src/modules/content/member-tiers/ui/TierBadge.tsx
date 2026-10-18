import Box from "@mui/material/Box";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import { tierGlyphName } from "@/modules/events/ui/tier-glyphs";
import QuietHelp from "@/shared/ui/QuietHelp";
import type { TierView } from "../repository";

/**
 * A member tier as a badge (§811): the level's glyph and name on the house's `GlyphChip` (the glyph
 * travels as a name, never an element — a Server Component hands it a string), and, when the club
 * wrote one, the level's description behind the discreet «?» (`QuietHelp`). Drawn under the member's
 * name in the zone and as the small «<tier>» chip on a discount code limited to some levels.
 *
 * A label and its benefits, never a permission: the badge opens nothing and decides nothing.
 */
export default function TierBadge({
  tier,
  help = true,
  variant = "outlined",
  color = "primary",
  testId = "member-tier-badge",
}: {
  tier: TierView;
  /** The «?» with the description — the zone's badge shows it; a code's small chip does not. */
  help?: boolean;
  variant?: "filled" | "outlined";
  color?: "default" | "primary" | "secondary";
  testId?: string;
}) {
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", minWidth: 0, maxWidth: "100%" }}>
      <GlyphChip glyph={tierGlyphName(tier.glyph)} label={tier.name} color={color} variant={variant} testId={testId} />
      {help && tier.description && <QuietHelp text={tier.description} testId="member-tier-help" />}
    </Box>
  );
}
