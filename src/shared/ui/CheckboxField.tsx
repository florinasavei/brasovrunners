"use client";

import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import type { ReactNode } from "react";
import { CHECKBOX_TAP_TARGET } from "./tap-target";

/**
 * A labelled checkbox that a Server Component can render safely.
 *
 * ## The defect this exists to prevent
 *
 * `FormControlLabel` takes its control as a prop: `control={<Checkbox />}`. Written in a Server
 * Component, that element crosses the server/client boundary *as a prop*, and React serialises
 * it. For a small tree the element arrives whole. Past a certain depth React outlines the
 * subtree into a later row of the payload and the client component receives a **lazy
 * reference** in its place — an object with no `props` — and `FormControlLabel` throws
 * `Cannot read properties of undefined (reading 'disabled')` while reading
 * `control.props.disabled`. The whole page answers 500.
 *
 * It is a shape-of-the-tree bug, not a code bug: the registration form rendered for weeks, then
 * broke the day two column wrappers were added around the same checkboxes (2026-09-17), and the
 * dev server had been failing on that page for the same reason since `BR-V1.26`. Bisecting it
 * cost five builds; the fix is the rule React documents — pass **children**, never elements, as
 * props across the boundary — applied by making the element on this side of it.
 *
 * `label` is `children` for the same reason: it may carry a link, and React handles children
 * robustly where it does not handle an element-valued prop.
 */
export default function CheckboxField({
  name,
  id,
  value,
  required,
  defaultChecked,
  disabled,
  children,
}: {
  name: string;
  id?: string;
  /** For a group posting one name with several values (the weekdays); "on" otherwise. */
  value?: string;
  required?: boolean;
  defaultChecked?: boolean;
  /** Shown but not changeable — and not posted: a disabled input leaves the form, so the caller carries the value. */
  disabled?: boolean;
  /** The label, which may contain a link. */
  children: ReactNode;
}) {
  return (
    <FormControlLabel
      control={
        <Checkbox
          id={id}
          name={name}
          value={value}
          required={required}
          defaultChecked={defaultChecked}
          disabled={disabled}
          sx={CHECKBOX_TAP_TARGET}
        />
      }
      label={children}
    />
  );
}
