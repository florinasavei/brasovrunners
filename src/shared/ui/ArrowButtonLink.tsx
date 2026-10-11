import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import type { ComponentProps } from "react";
import type { Link } from "@/i18n/navigation";
import { BUTTON_GLYPH_PX, glyphSx, WITH_GLYPH_SX } from "./button-glyph";
import ButtonLink from "./ButtonLink";
import { TAP_TARGET } from "./tap-target";

type Size = "small" | "medium";

type Props = {
  href: ComponentProps<typeof Link>["href"];
  /** The words; the arrow follows them. */
  label: string;
  /** `contained`: the primary fill (the pink under «Aspectul nou»). `outlined`: the ink outline. */
  variant?: "contained" | "outlined";
  size?: Size;
  /**
   * Below `sm`, a tighter pill (less padding, a smaller gap and arrow) that keeps its arrow, since a
   * button wears its glyph at every width (§521): the header's row at 320 pixels has room for the
   * logo, the first section and the ☰ beside it (§569's one row, §262's first entry).
   */
  compactOnPhone?: boolean;
  "data-testid"?: string;
};

/**
 * The new look's button (§NNN; `docs/REDESIGN.md` § The visual system): a link that reads as a
 * pill — the theme rounds every MUI button under the look's scope (`theme/look.ts`) — with its
 * words first and a **trailing** arrow, 44 pixels tall. «Vino cu noi» in the header is the first;
 * the home page's three (phase 3) are the next.
 *
 * The arrow is the one glyph file, imported here as a public button imports its glyph (§498, §521),
 * and drawn as the button's last child — never `endIcon`, which from a Server Component is an
 * element handed to a client component (§370). So a page, public or the design page, passes words
 * and an address, never an icon. `outlined` is ink, not the primary: the plan's «outlined ink»,
 * the quiet partner of the pink one.
 *
 * A Server Component: `ButtonLink` is the one client boundary, and children cross it safely.
 */
export default function ArrowButtonLink({ href, label, variant = "contained", size = "medium", compactOnPhone = false, "data-testid": testId }: Props) {
  return (
    <ButtonLink
      href={href}
      variant={variant}
      size={size}
      disableElevation
      {...(variant === "outlined" ? { color: "inherit" as const } : {})}
      data-testid={testId}
      sx={{
        ...TAP_TARGET,
        ...WITH_GLYPH_SX,
        textTransform: "none",
        fontWeight: 600,
        whiteSpace: "nowrap",
        flexShrink: 0,
        ...(variant === "outlined" ? { color: "text.primary", borderColor: "currentColor" } : {}),
        ...(compactOnPhone ? { px: { xs: 1, sm: size === "small" ? 1.25 : 2 }, gap: { xs: 0.25, sm: 1 } } : {}),
      }}
    >
      {label}
      <ArrowForwardIcon aria-hidden="true" sx={{ ...glyphSx(size), ...(compactOnPhone ? { fontSize: { xs: 16, sm: BUTTON_GLYPH_PX[size] } } : {}) }} />
    </ButtonLink>
  );
}
