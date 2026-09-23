"use client";

import { ACTION_ICONS, type ActionIconName } from "./action-icons";
import SubmitButton, { type SubmitButtonProps } from "./SubmitButton";

type Props = Omit<SubmitButtonProps, "glyph" | "runner"> & {
  /** The verb's glyph before the label, by name — never an element (`action-icons.ts`). */
  icon: ActionIconName;
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
 * `SubmitButton`'s, untouched: this hands it the resolved component and nothing more.
 */
export default function GlyphSubmitButton({ icon, ...props }: Props) {
  return <SubmitButton {...props} glyph={ACTION_ICONS[icon]} />;
}
