"use client";

import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import { useFormStatus } from "react-dom";
import { TAP_TARGET } from "./tap-target";

type Props = {
  label: string;
  /** What the button says while the server is working. It is the whole reason this exists. */
  pendingLabel: string;
  color?: "primary" | "error" | "warning" | "inherit";
  variant?: "text" | "outlined" | "contained";
  size?: "small" | "medium";
  fullWidth?: boolean;
  /**
   * The accessible name, when the visible label cannot be one — an arrow in a row of pages is
   * "↓" to everybody who can see which row it is in, and nothing at all to anybody who cannot.
   */
  ariaLabel?: string;
};

/**
 * A submit button that shows the server is working, and says so in words.
 *
 * ## Why this earned a client island (§1.5, §14.1)
 *
 * Every write in the backoffice is a Server Action behind a full page round-trip, and until the
 * server answered there was no feedback at all: the button looked idle, so an organizer pressed
 * it again. That is not a cosmetic problem here — the editor carries an optimistic version on
 * both the event row and each translation, so the second press arrives with the version the
 * first one has already superseded and comes back a CONFLICT, which the organizer then has to
 * read, understand and recover from. The island exists to stop a double press, and there is no
 * way to know a submission is in flight without being on the client.
 *
 * It costs one `useFormStatus` call and no props that carry data — the labels are passed in
 * already translated, so the catalogue stays on the server and no participant row crosses the
 * boundary to render a button (§14.5).
 *
 * ## Why `aria-disabled` and not `disabled`
 *
 * The registration form already argues the general case, and it applies exactly: a disabled
 * control cannot say why it is disabled. `disabled` would also drop keyboard focus the instant
 * the press registers, so somebody using a screen reader would be moved off the control and
 * never told the save had begun. `aria-disabled` keeps it focused and announced; the label
 * changing to "saving" is the explanation, and the click handler is what actually stops the
 * second submission.
 *
 * With JavaScript off none of this runs and the button is an ordinary submit — which is the
 * honest fallback, because every guard that matters is on the server.
 */
export default function SubmitButton({
  label,
  pendingLabel,
  color = "primary",
  variant = "contained",
  size = "small",
  fullWidth,
  ariaLabel,
}: Props) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      color={color}
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      aria-label={ariaLabel}
      aria-disabled={pending}
      aria-busy={pending}
      sx={TAP_TARGET}
      startIcon={
        pending ? <CircularProgress size={16} thickness={5} color="inherit" /> : undefined
      }
      onClick={(event) => {
        // The press that is already in flight owns this form. Swallowing the second one here
        // rather than disabling the control is what keeps it focusable and readable.
        if (pending) event.preventDefault();
      }}
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}
