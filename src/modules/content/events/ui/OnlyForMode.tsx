"use client";

import type { ReactNode } from "react";
import { ShownWhen, useSelectedValue } from "./OnlyForType";

/** What the registration mode select posts; `admin/actions.ts#eventFieldsFrom` reads it by this name. */
const MODE_SELECT = "event.registrationMode";

/**
 * Shows its children while the registration mode is one of `mode` (§350) — `OnlyForType`'s twin
 * over the mode select. Children are hidden, never removed, so a value typed before a mode change
 * is still posted; the service ignores what the chosen mode hides (`ignoreHiddenFields`,
 * `normalizeForMode`, §111). No browser `required` here — the server decides what a mode needs —
 * and hidden boxes are read-only (`ShownWhen`) so an out-of-range hidden box cannot silently
 * block the save.
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
