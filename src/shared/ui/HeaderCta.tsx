import Box from "@mui/material/Box";
import type { ComponentProps } from "react";
import type { Link } from "@/i18n/navigation";
import { onlyUnderLook } from "@/theme/look";
import ArrowButtonLink from "./ArrowButtonLink";

/**
 * «Vino cu noi» / "Join us" in the header under «Aspectul nou» (§NNN; `docs/REDESIGN.md`, decision
 * 5): the pink pill with its arrow, to the next weekly run's page — or the listing when no weekly
 * run is ahead (`nextWeeklyRun`). The header decides the address; this draws it.
 *
 * Inside the new look's scope only (`onlyUnderLook`): the backoffice shares this header and never
 * shows it. On a phone a tighter pill (`compactOnPhone`) keeps the arrow (§521) and the row one row at
 * 320 pixels with the logo, the first section and the ☰ (§569, §699).
 */
export default function HeaderCta({ href, label }: { href: ComponentProps<typeof Link>["href"]; label: string }) {
  return (
    <Box sx={{ flexShrink: 0, alignItems: "center", ...onlyUnderLook("flex") }}>
      <ArrowButtonLink href={href} label={label} size="small" compactOnPhone data-testid="header-cta" />
    </Box>
  );
}
