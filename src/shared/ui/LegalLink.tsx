import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import Box from "@mui/material/Box";
import { Link } from "@/i18n/navigation";
import type { ComponentProps } from "react";

/**
 * A link to one of the club's legal texts, opened in a new tab and marked as such
 * (`DECISIONS.md` §197).
 *
 * The owner: "termenii de concurs și nota de confidențialitate trebe să se deschidă în ceva
 * pop-up sau new tab (iconiță diferită pt new tab)."
 *
 * ## Why a new tab and not a panel
 *
 * Because of where these links are: in the middle of a registration form somebody has half
 * filled in. A privacy notice is a long text — the platform's own runs to a dozen sections — and
 * a reader who follows it in the same tab and presses Back is relying on the browser to restore
 * a form it never stored. The race's *conditions* do open in a panel (§195), and that is the
 * right shape there: they are short, they are about this race, and reading them is a step in the
 * flow. These two are reference texts, read out of order and sometimes at length, so they get a
 * place of their own and the form stays exactly as it was left.
 *
 * ## The icon is the honest part
 *
 * A link that opens a new tab and does not say so is a small trap: somebody presses Back, finds
 * the page unchanged, and presses again. `OpenInNewIcon` is the convention for it, and the
 * accessible name carries the same fact in words — `aria-label` rather than a `title`, because a
 * title attribute is invisible on a touch screen, which is most of this form's traffic.
 *
 * `rel="noreferrer"` covers `noopener` as well in every browser this site supports, and keeps the
 * new tab from reaching back into this one through `window.opener`.
 */
export default function LegalLink({
  href,
  children,
  newTabLabel,
  style,
}: {
  href: ComponentProps<typeof Link>["href"];
  children: React.ReactNode;
  /** "opens in a new tab", from the catalogue — read by a screen reader, not shown. */
  newTabLabel: string;
  style?: React.CSSProperties;
}) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${typeof children === "string" ? children : ""} — ${newTabLabel}`.trim()}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, ...style }}
    >
      {children}
      {/*
        Decorative: the accessible name above already says where this goes, so announcing the
        icon as well would say it twice.
      */}
      <Box
        component={OpenInNewIcon}
        aria-hidden="true"
        sx={{ fontSize: "1rem", flexShrink: 0, opacity: 0.8 }}
      />
    </Link>
  );
}
