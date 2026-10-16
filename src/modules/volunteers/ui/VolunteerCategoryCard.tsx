import VolunteerActivismIcon from "@mui/icons-material/VolunteerActivism";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { paletteWash } from "@/shared/ui/choice-card";

/**
 * One category of an event's volunteer roles on the volunteers' page, as a card of its own (§780, amending §774; the owner, 2026-10-15,
 * of the flat list of roles under two plain headings: «nu e clară gruparea pe categorii! vreau să prioritizezi asta!», and on 2026-10-16,
 * of the saturated band that answered it: «nu-mi place designul pt asta»): a bordered, rounded box on the page's paper surface, its header
 * on that same surface — the category's glyph (the house's volunteers glyph, one for every category) in a soft disc, its name as the
 * level-3 heading the group is named by, and how many roles it offers («4 roluri», muted, beside the name, under it on a phone) — then a
 * hairline, then, when the club set one, the category's contact line, and the role chips inside (`VolunteerRoleChip`). The cards stand a clear step apart
 * (the caller's stack), so on a phone a reader never wonders which category a role belongs to: the chip is inside the box under the
 * header, never between two headings. No filled band: the grouping is the border, the space and the heading, not a colour.
 *
 * Theme tokens only (`primary.main` and its wash for the disc, `text.primary` and `text.secondary`, `divider`, `background.paper`), so
 * the light and the dark scheme and both looks, «Tema v1» and «Tema v2», follow. The state is never in colour alone: the name, the
 * count and the glyph say it in words and shape.
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
  /** The role chips. */
  children: ReactNode;
}) {
  return (
    <Box
      data-testid="volunteer-category"
      role="group"
      aria-labelledby={`volunteer-category-${id}`}
      sx={{ border: 1, borderColor: "divider", borderRadius: 2, bgcolor: "background.paper" }}
    >
      <Box data-testid="volunteer-category-header" sx={{ display: "flex", alignItems: "center", gap: 1.5, px: { xs: 1.5, sm: 2 }, py: 1.5 }}>
        <Box
          aria-hidden="true"
          sx={{ flex: "none", width: 36, height: 36, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: paletteWash("primary", 12), color: "primary.main" }}
        >
          <VolunteerActivismIcon aria-hidden="true" sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1, display: "flex", flexDirection: { xs: "column", sm: "row" }, alignItems: { xs: "flex-start", sm: "baseline" }, columnGap: 1.5 }}>
          <Typography
            component="h3"
            id={`volunteer-category-${id}`}
            data-testid="volunteer-category-heading"
            sx={{ fontSize: "1.125rem", fontWeight: 700, lineHeight: 1.3, color: "text.primary", overflowWrap: "anywhere" }}
          >
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" data-testid="volunteer-category-count">
            {count}
          </Typography>
        </Box>
      </Box>
      <Divider />
      <Box sx={{ p: { xs: 1.5, sm: 2 } }}>
        {contact && (
          // The contact's first link reaches above its words (`INLINE_TAP_TARGET`): the row's padding gives it room under the header.
          <Box sx={{ pb: 1.5, pt: 0.5 }}>{contact}</Box>
        )}
        {children}
      </Box>
    </Box>
  );
}
