import Box from "@mui/material/Box";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import { tierGlyphName } from "@/modules/events/ui/tier-glyphs";
import type { TierView } from "../repository";

/**
 * A member tier as a small chip (§811, §NNN): the level's glyph and name on the house's `GlyphChip` (the glyph
 * travels as a name, never an element — a Server Component hands it a string). Drawn for the staff alone,
 * on «Echipa»'s member rows: the member and the visitor are never shown a level.
 *
 * A label, never a permission: the chip opens nothing and decides nothing.
 */
export default function TierBadge({ tier, testId = "member-tier-badge" }: { tier: TierView; testId?: string }) {
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", minWidth: 0, maxWidth: "100%" }}>
      <GlyphChip glyph={tierGlyphName(tier.glyph)} label={tier.name} color="default" variant="outlined" testId={testId} />
    </Box>
  );
}
