"use client";

import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import { useId, type ReactNode } from "react";
import { useRecall } from "@/shared/forms/recall";
import { CONSENT_DENSITY } from "./consent-density";
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
 *
 * ## After a refused submit
 *
 * The box comes back as it was ticked (`DECISIONS.md` §315): when the form it sits in has been
 * answered with a refusal, the tick is whether this box's value was posted — an unticked box
 * posts nothing, so "not posted" is "unticked", never the page's default. A disabled box posts
 * nothing either and keeps the page's word; the caller carries its value in a hidden field.
 */
export default function CheckboxField({
  name,
  id,
  value,
  required,
  defaultChecked,
  disabled,
  dense = false,
  help,
  helpTestId,
  optional,
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
  /**
   * The registration form's «Acorduri» density (§570, `CONSENT_DENSITY`): a small box still 44 px to
   * the thumb, the label in `body2` beside it, no margin between rows, and `help` as a caption
   * directly under the label.
   */
  dense?: boolean;
  /** One helper line under the label, a caption, and the box's description for a screen reader. */
  help?: string;
  helpTestId?: string;
  /**
   * An optional box's word (`Registration.optionalSuffix`), written after the label as « — opțional»
   * in the label's own flow (round 2 of §570): the same words on every optional box of the block.
   */
  optional?: string;
  /**
   * The label, which may contain a link. With `dense`, its first child is the box's glyph — an
   * `@mui/icons-material` element with `aria-hidden`, made by the Server Component that renders
   * this, never passed as a prop — drawn in its own column (`CONSENT_DENSITY.labelSx`).
   */
  children: ReactNode;
}) {
  const recall = useRecall();
  const helpId = useId();
  const checked =
    recall.has && !disabled ? (recall.all(name)?.includes(value ?? "on") ?? false) : defaultChecked;
  // A single box the refusal named carries the id its summary links to (§47, §315) — "confirm
  // that this person asked" linked nowhere without it. Never a box of a group: several boxes
  // with one id would be one label for many.
  const namedId = value === undefined && recall.named(name) ? recall.idOf(name) : undefined;
  /*
    The dense label (§570 round 2): the glyph in its column, then one inline flow of the words,
    « — opțional» and the required mark. The mark is drawn here rather than by `FormControlLabel`,
    which would wrap the label and its mark in a `<div>` of its own — an inline label there loses
    its padding and a flowing mark lands on a line of its own. So the input is required through its
    own slot (`required` on the control is what makes `FormControlLabel` draw the mark), and the
    browser's check, the missing-fields list and the error summary read the same `required` input.
  */
  const inputSlot = {
    ...(help ? { "aria-describedby": helpId } : {}),
    ...(dense && required ? { required: true } : {}),
  };
  const label = dense ? (
    <Box component="span" sx={CONSENT_DENSITY.labelSx}>
      {children}
      {optional ? ` — ${optional}` : null}
      {required && (
        <span aria-hidden="true" className="MuiFormControlLabel-asterisk">
          {"\u2009*"}
        </span>
      )}
    </Box>
  ) : optional ? (
    <>
      {children}
      {` — ${optional}`}
    </>
  ) : (
    children
  );

  const field = (
    <FormControlLabel
      control={
        <Checkbox
          key={recall.generation}
          id={id ?? namedId}
          name={name}
          value={value}
          required={dense ? undefined : required}
          defaultChecked={checked}
          disabled={disabled}
          size={dense ? CONSENT_DENSITY.checkboxSize : undefined}
          slotProps={Object.keys(inputSlot).length > 0 ? { input: inputSlot } : undefined}
          sx={CHECKBOX_TAP_TARGET}
        />
      }
      label={label}
      slotProps={dense ? { typography: { variant: CONSENT_DENSITY.labelVariant } } : undefined}
      sx={dense ? CONSENT_DENSITY.rowSx : undefined}
    />
  );
  if (!help) return field;
  return (
    <Box>
      {field}
      <Typography id={helpId} variant="caption" color="text.secondary" data-testid={helpTestId} sx={dense ? CONSENT_DENSITY.helpSx : { display: "block" }}>
        {help}
      </Typography>
    </Box>
  );
}
