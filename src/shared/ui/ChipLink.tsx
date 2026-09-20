import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import GlyphChip from "@/modules/events/ui/GlyphChip";
import type { GlyphName } from "@/modules/events/ui/glyphs";

/**
 * A small chip that is a link, inside a 44-pixel target (`DECISIONS.md` §133, §158; the
 * owner: "pretty much all the pills must be smaller"). The link is what a thumb hits and what
 * the e2e suite measures (BR-REQ-041-01 criterion 6); the pill is MUI's small size. Rendered
 * from Server Components: a string href, a string label, a glyph by name — nothing that
 * cannot cross into MUI's client components (`AGENTS.md` §14.1).
 */
export default function ChipLink({
  href,
  label,
  active = false,
  glyph,
  current,
  strike = false,
  title,
}: {
  href: string;
  label: string;
  /** Filled in the brand colour, like a pressed filter. */
  active?: boolean;
  glyph?: GlyphName;
  /** `aria-current` on the link — "page" for the filter in force, "date" for today's. */
  current?: "page" | "date";
  /** Struck through: a cancelled date. */
  strike?: boolean;
  title?: string;
}) {
  const look = { color: active ? ("primary" as const) : ("default" as const), variant: active ? ("filled" as const) : ("outlined" as const) };
  const sx = strike ? { textDecoration: "line-through", color: "text.secondary" } : undefined;
  return (
    <Box
      component="a"
      href={href}
      aria-current={current}
      title={title}
      sx={{ display: "inline-flex", alignItems: "center", minHeight: 44, textDecoration: "none", color: "inherit" }}
    >
      {glyph ? <GlyphChip glyph={glyph} label={label} {...look} sx={sx} /> : <Chip size="small" label={label} {...look} sx={sx} />}
    </Box>
  );
}
