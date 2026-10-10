"use client";

import Button, { type ButtonProps } from "@mui/material/Button";
import { ACTION_ICONS, type ActionIconName } from "./action-icons";

type Props = Omit<ButtonProps, "startIcon" | "endIcon" | "component" | "href" | "ref"> & {
  /** The verb's glyph, by name — never an element (`action-icons.ts`). */
  icon: ActionIconName;
  /**
   * Set, the button is a plain `<a>` to this address: a download from `/api/…`, or a backoffice
   * path the caller already resolved with `getPathname`. Unset, it is a `<button>` — usually
   * `type="submit"` inside the form the Server Component rendered.
   */
  href?: string;
  /**
   * Set, the button is a `<label>` for the file input with this id — the input sits among its
   * children, hidden: the native file picker, which opens without JavaScript and which the e2e
   * upload path drives. Never with `href`.
   */
  htmlFor?: string;
};

/**
 * An MUI Button that wears a verb's glyph, for a Server Component to render (§170, §318).
 *
 * A client component for one reason: the icon. A Server Component may not hand an element across
 * the boundary as a prop — `GlyphChip` and `CheckboxField` record what that costs — so it hands
 * a name and this makes the element. Everything else passes straight through to MUI's `Button`:
 * no state, no handler, and the form and the Server Action behind a submit are untouched, so it
 * works with JavaScript off exactly as the plain button it replaces did.
 *
 * It replaced `SubmitIconButton`, which was this for submits only: the backoffice's download
 * links needed the same thing, and two components for one idea is one too many.
 *
 * Since §521 every button wears a glyph, public pages included — but not through this. The
 * lookup by name ships the whole table to whatever renders it, so the table stays off public
 * pages (§318's restriction, which §521 keeps for the table alone; `action-icons.test.ts` walks
 * the imports). A public page's button is `ButtonLink`, or `SubmitButton` with `runner` or
 * `glyph`, its glyph named in a registry listed in `ICON_REGISTRIES` (`tests/unit/design/guards-allowlist.ts`); never this, and
 * never MUI's `Button` with its own `startIcon` import: the design guards (`tests/unit/design/`,
 * §694) refuse both a bare MUI `Button` and a direct `@mui/icons-material` import.
 */
export default function GlyphButton({ icon, href, htmlFor, children, ...props }: Props) {
  const Icon = ACTION_ICONS[icon];
  const startIcon = <Icon fontSize="small" />;
  // With an `href`, MUI's ButtonBase renders its link component, a plain `<a>` — the element
  // `component="a"` used to ask for at every call site.
  if (htmlFor !== undefined) {
    return (
      <Button component="label" htmlFor={htmlFor} startIcon={startIcon} {...(props as ButtonProps<"label">)}>
        {children}
      </Button>
    );
  }
  return href === undefined ? (
    <Button startIcon={startIcon} {...props}>
      {children}
    </Button>
  ) : (
    <Button href={href} startIcon={startIcon} {...props}>
      {children}
    </Button>
  );
}
