"use client";

import Box from "@mui/material/Box";
import type { ReactNode } from "react";
import { useRecall } from "@/shared/forms/recall";
import { TAP_TARGET } from "./tap-target";

/**
 * A labelled radio, native (§702, amending §678): a `<label>` around a plain `<input type="radio">`,
 * so the browser alone keeps the group — one `name`, one checked — with no JavaScript and no island.
 *
 * It was MUI's `Radio` in a `FormControlLabel`; outside a `RadioGroup` that keeps its own "checked"
 * state per radio and is never told when a sibling takes the choice, so after a click on the second
 * option both were drawn selected (the owner, 2026-10-11). The house's cards (`BranchChoice`) are
 * native for the same reason.
 *
 * One radio per call; the group is the shared `name`. `defaultChecked` on one of them is the form's
 * default. The row is 44 pixels tall at least (BR-REQ-041-01 criterion 6).
 *
 * After a refused submit the choice comes back as it was posted (§315, the checkbox's own rule): when
 * the form it sits in has been answered with a refusal and the group posted a value, the radio checked
 * is the one that was; a group that posted nothing, or a disabled radio, keeps the page's word. Without
 * it the badge's size, refused for being too small, came back on the saved size while the boxes typed
 * for «Altă dimensiune» stayed behind, hidden (§776).
 */
export default function RadioField({
  name,
  value,
  defaultChecked,
  disabled,
  children,
}: {
  name: string;
  value: string;
  defaultChecked?: boolean;
  /**
   * A choice that cannot be made now, greyed (§772): the browser does not post it and takes no click on it,
   * so it can stay checked to show what is saved. Never alone: the caller says why, in words beside it.
   */
  disabled?: boolean;
  /** The label, which may contain a link. */
  children: ReactNode;
}) {
  const recall = useRecall();
  const posted = disabled ? undefined : recall.value(name);
  const checked = posted === undefined ? defaultChecked : posted === value;
  return (
    <Box
      component="label"
      sx={{
        ...TAP_TARGET,
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        cursor: disabled ? "not-allowed" : "pointer",
        ...(disabled ? { color: "text.disabled" } : {}),
        "& input": { flex: "none", width: 24, height: 24, m: 0, ml: 1.5, accentColor: "var(--mui-palette-primary-main)", cursor: disabled ? "not-allowed" : "pointer" },
        "&:has(input:focus-visible)": { outline: "2px solid var(--mui-palette-primary-main)", outlineOffset: "-2px", borderRadius: 1 },
      }}
    >
      <input type="radio" name={name} value={value} defaultChecked={checked} disabled={disabled} />
      <Box component="span">{children}</Box>
    </Box>
  );
}
