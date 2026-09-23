"use client";

import Button, { type ButtonProps } from "@mui/material/Button";
import type { ComponentProps } from "react";
import { Link } from "@/i18n/navigation";
import { ACTION_ICONS, type ActionIconName } from "./action-icons";

// As in `ButtonLink`: MUI's plain-string `href` is dropped so the locale-aware one wins, and
// `startIcon` is dropped because a Server Component cannot hand an element across — `icon` is
// the name it can hand instead.
type Props = Omit<ButtonProps, "href" | "startIcon"> &
  Pick<ComponentProps<typeof Link>, "href"> & {
    /** The verb's glyph before the label, by name — never an element (`action-icons.ts`). */
    icon: ActionIconName;
  };

/**
 * `ButtonLink` wearing a verb's glyph, for a backoffice Server Component to render (§318).
 *
 * **Backoffice only**, for the reason `GlyphSubmitButton` gives: the name is looked up in the
 * verbs' registry, which no bundler can shake, so `ButtonLink` itself — on the landing page's
 * featured event, every event page's registration button and the not-found page — takes no
 * glyph and imports no registry. `tests/unit/shared/action-icons.test.ts` holds the line.
 */
export default function GlyphButtonLink({ href, icon, children, ...props }: Props) {
  const Icon = ACTION_ICONS[icon];
  return (
    // The cast `ButtonLink` explains: MUI types `href` as a plain string on every overload, and
    // the prop above is fully typed, so a wrong route is still a compile error at the call site.
    <Button component={Link} href={href as never} startIcon={<Icon fontSize="small" />} {...props}>
      {children}
    </Button>
  );
}
