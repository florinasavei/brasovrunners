"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import { ACTION_ICONS, type ActionIconName } from "./action-icons";
import SubmitButton, { type SubmitButtonProps } from "./SubmitButton";

type Props = Omit<SubmitButtonProps, "glyph" | "runner"> & {
  /** The verb's glyph before the label, by name — never an element (`action-icons.ts`). */
  icon: ActionIconName;
  /**
   * One sentence saying what the press does and what it changes, shown on hover, on keyboard focus
   * and on a long press (§NNN). It repeats nothing the label says: «Mai sus» is the label, «cardul
   * apare mai devreme pe pagină» is the tooltip. A phone has no hover, so the words that matter stay
   * on the button; this is the extra.
   */
  tooltip?: string;
};

/**
 * `SubmitButton` wearing a verb's glyph, for a backoffice Server Component to render (§318).
 *
 * **Backoffice only.** The name is looked up in the verbs' registry, and a lookup by a runtime
 * key cannot be tree-shaken: whatever renders this ships every glyph in `action-icons.ts`. So
 * the lookup lives here rather than in `SubmitButton`, which the register, contact and interest
 * forms render and which must stay as light as it was (the owner's rule: "the header and the
 * landing page are what every visitor pays for"). `tests/unit/shared/action-icons.test.ts`
 * walks the imports and fails if a public route reaches the registry through anything.
 *
 * Everything else — the pending runner, the held press of §304, the slow hint, `compact` — is
 * `SubmitButton`'s, untouched: this hands it the resolved component and nothing more. The tooltip
 * lives here for the same reason: MUI's `Tooltip` is the backoffice's cost, never a visitor's. It
 * wraps a span, not the button, because the button is `SubmitButton`'s to render and a tooltip
 * needs a node that takes a ref; the span's hover and the button's focus both open it.
 */
export default function GlyphSubmitButton({ icon, tooltip, ...props }: Props) {
  const button = <SubmitButton {...props} glyph={ACTION_ICONS[icon]} />;
  if (!tooltip) return button;
  return (
    <Tooltip title={tooltip} describeChild enterTouchDelay={400} leaveTouchDelay={4000}>
      <Box component="span" sx={{ display: "inline-flex" }}>
        {button}
      </Box>
    </Tooltip>
  );
}
