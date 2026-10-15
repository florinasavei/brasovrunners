import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/**
 * One category of an event's volunteer roles on the volunteers' page, as a card of its own (§NNN, amending §774; the owner, 2026-10-15,
 * of the flat list of roles under two plain headings: «nu e clară gruparea pe categorii! vreau să prioritizezi asta!»): a bordered,
 * rounded box with a coloured band across its top — the category's glyph (the house's volunteers glyph, one for every category), its name
 * large, as the level-3 heading the group is named by, and how many roles it offers («4 roluri») — then, when the club set one, the
 * category's contact line, and the role tiles inside, in the grid `RoleTileGrid` draws. The cards stand a clear step apart (the caller's
 * stack), so on a phone a reader never wonders which category a role belongs to: the role is inside the box under the band, never
 * between two headings.
 *
 * The band is the primary's deep shade (`primary.dark`: the logo's ink blue, `blueInk`, not its pure blue, which vibrates across a
 * full-width flat fill — `brand.ts`) with the primary's own contrast text (`primary.contrastText`, AA on it in the light and the dark scheme
 * and in both looks, «Tema v1» and «Tema v2», whose deep shade is `accentDeep`); it holds no link, so the contact line, whose links are the page's own colour,
 * sits on the card's surface under it. The state is never in colour alone: the name, the count and the glyph say it in words and shape.
 *
 * A Server Component with no state; `contact` is the page's `VolunteerContactLine` (a node, never a component reference, so the boundary
 * rule of `CheckboxField` does not apply: nothing here is a client component).
 */
export default function VolunteerCategoryCard({
  id,
  title,
  count,
  contact,
  children,
}: {
  /** The category's id, or `other` for the roles under none: the heading's id is `volunteer-category-<id>`, which names the group. */
  id: string;
  /** The category's name in the page's language (or «Alte activități»). */
  title: string;
  /** «4 roluri» / "4 roles", already worded. */
  count: string;
  /** The category's contact line, when the club set one. */
  contact?: ReactNode;
  /** The role tiles. */
  children: ReactNode;
}) {
  return (
    <Box
      data-testid="volunteer-category"
      role="group"
      aria-labelledby={`volunteer-category-${id}`}
      sx={{ border: 1, borderColor: "divider", borderRadius: 2, overflow: "hidden", bgcolor: "background.paper" }}
    >
      <Box
        data-testid="volunteer-category-band"
        sx={{ display: "flex", alignItems: "center", gap: 1.5, px: { xs: 1.5, sm: 2 }, py: 1.5, bgcolor: "primary.dark", color: "primary.contrastText" }}
      >
        <Box
          aria-hidden="true"
          sx={{
            flex: "none",
            width: 40,
            height: 40,
            borderRadius: 1.5,
            display: "grid",
            placeItems: "center",
            bgcolor: "color-mix(in srgb, var(--mui-palette-primary-contrastText) 20%, transparent)",
          }}
        >
          <VolunteerActivismIcon aria-hidden="true" sx={{ fontSize: 24 }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            component="h3"
            id={`volunteer-category-${id}`}
            data-testid="volunteer-category-heading"
            sx={{ fontSize: "1.25rem", fontWeight: 700, lineHeight: 1.25, overflowWrap: "anywhere" }}
          >
            {title}
          </Typography>
          <Typography variant="body2" data-testid="volunteer-category-count" sx={{ mt: 0.25 }}>
            {count}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        {contact && (
          // The contact's first link reaches above its words (`INLINE_TAP_TARGET`): the row's padding gives it room under the band.
          <Box sx={{ pb: 1.5, pt: 0.5 }}>{contact}</Box>
        )}
        {children}
      </Box>
    </Box>
  );
}
