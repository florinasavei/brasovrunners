import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import type { ComponentProps } from "react";
import type { Link } from "@/i18n/navigation";
import { glyphSx, WITH_GLYPH_SX } from "./button-glyph";
import ButtonLink from "./ButtonLink";
import { TAP_TARGET } from "./tap-target";

type Size = "small" | "medium";

type Props = {
  href: ComponentProps<typeof Link>["href"];
  /** The words; the arrow follows them. */
  label: string;
  /** `contained`: the primary fill (the accent under «Aspectul nou», pink by default). `outlined`: the ink outline. */
  variant?: "contained" | "outlined";
  size?: Size;
  "data-testid"?: string;
};

/**
 * The new look's button (§708; `docs/REDESIGN.md` § The visual system): a link that reads as a
 * pill — the theme rounds every MUI button under the look's scope (`theme/look.ts`) — with its
 * words first and a **trailing** arrow, 44 pixels tall. «Vino cu noi» in the header was the first
 * (it left the header, §NNN); the home page's three (phase 3) and the calendar's «Vezi detalii» wear it.
 *
 * The arrow is the one glyph file, imported here as a public button imports its glyph (§498, §521),
 * and drawn as the button's last child — never `endIcon`, which from a Server Component is an
 * element handed to a client component (§370). So a page, public or the design page, passes words
 * and an address, never an icon. `outlined` is ink, not the primary: the plan's «outlined ink»,
 * the quiet partner of the accent-filled one.
 *
 * A Server Component: `ButtonLink` is the one client boundary, and children cross it safely.
 */
export default function ArrowButtonLink({ href, label, variant = "contained", size = "medium", "data-testid": testId }: Props) {
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
        ...(variant === "outlined" ? { color: "text.primary", borderColor: "currentColor" } : {}),      }}
    >
      {label}
      <ArrowForwardIcon aria-hidden="true" sx={glyphSx(size)} />
    </ButtonLink>
  );
}
