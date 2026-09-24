"use client";

import type { ReactNode } from "react";
import { ShownWhen, useSelectedValue } from "./OnlyForType";

/** What the registration mode select posts; `admin/actions.ts#eventFieldsFrom` reads it by this name. */
const MODE_SELECT = "event.registrationMode";

/**
 * Shows its children while the registration mode says one of `mode` (§350, the event editor's
 * "Participare și înscrieri" box): the capacity, the window, the declaration and the numbers
 * belong to registration here, the organizer's name and link to registration elsewhere, and
 * nothing belongs to "no registration" but a sentence. Forty fields for three answers was the
 * box nobody could read.
 *
 * `OnlyForType`'s twin, over the mode select instead of the type select — the same observer on
 * MUI's hidden input, renewed on every answer of a kept form (§315). The children are always in
 * the DOM — hidden, not removed — so a capacity typed before the mode was changed is still
 * posted, and switching back finds it; the service ignores what the chosen mode hides, before its
 * schema reads the form (`ignoreHiddenFields`, then `normalizeForMode`, extending §111).
 *
 * Nothing in here carries a browser `required`, since the server decides what a mode needs — but
 * the boxes do carry `min`, `max` and `pattern`, and a hidden box left out of range used to stop
 * the save without a word. While hidden they are read-only, which the browser does not check
 * (`ShownWhen`); a server refusal about one of the boxes every mode keeps (the window's days, the
 * minimum age, the bib band) shows the block until the mode changes.
 */
export default function OnlyForMode({
  mode,
  initialMode,
  children,
}: {
  /** One mode, or the modes the children belong to. */
  mode: string | readonly string[];
  initialMode: string;
  children: ReactNode;
}) {
  const current = useSelectedValue(MODE_SELECT, initialMode);
  const shown = typeof mode === "string" ? current === mode : mode.includes(current);
  return (
    <ShownWhen shown={shown} answer={current}>
      {children}
    </ShownWhen>
  );
}
