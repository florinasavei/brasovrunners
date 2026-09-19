"use client";

import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import type { ReactNode } from "react";
import { CHECKBOX_TAP_TARGET } from "./tap-target";

/**
 * A labelled radio a Server Component can render safely — `CheckboxField`'s twin, for the
 * same reason: `FormControlLabel` takes its control as an element-valued prop, and an element
 * made on the server and passed across the boundary can arrive as a lazy reference and throw.
 * Made here, on the client side of the boundary, it always arrives whole.
 *
 * One radio per call; the group is the shared `name`, as in plain HTML. `defaultChecked` on
 * one of them is the form's default without any JavaScript.
 */
export default function RadioField({
  name,
  value,
  defaultChecked,
  children,
}: {
  name: string;
  value: string;
  defaultChecked?: boolean;
  /** The label, which may contain a link. */
  children: ReactNode;
}) {
  return <FormControlLabel control={<Radio name={name} value={value} defaultChecked={defaultChecked} sx={CHECKBOX_TAP_TARGET} />} label={children} />;
}
