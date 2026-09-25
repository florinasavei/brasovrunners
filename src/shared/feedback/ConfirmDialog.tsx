"use client";

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { useId } from "react";
import { TAP_TARGET } from "@/shared/ui/tap-target";
import { type ConfirmSpec, confirmOnKey } from "./notice";

/**
 * The one confirmation dialog of the backoffice (`DECISIONS.md` §NNN): "are you sure", worded
 * on the server with the consequence and its values, drawn on the client.
 *
 * Driven by `ActionForm`'s `confirm` prop for every single-verb form, by `ConfirmSubmitButton`
 * where one form carries several verbs, and by nothing else — the row menus and the message
 * composer used to draw dialogs of their own, and every one of them now submits a form that asks.
 *
 * **A courtesy, not a permission** (BR-REQ-060-01): what it finally does is `requestSubmit()` on
 * the form, and the Server Action behind it asserts the role, the version and every rule exactly
 * as it did before the dialog existed. With JavaScript off there is no dialog and the form posts.
 *
 * The safe button — cancel — takes the focus on open, so a stray Enter or Space cancels. Enter
 * anywhere in the dialog confirms one that is not destructive (`confirmOnKey`): the reader who
 * pressed Enter in a box to send the form meant to send it, and the question is a pause, not a
 * trap. A destructive dialog answers only to its own red button; Escape and the backdrop cancel
 * either. An email the action will queue is a line of its own, in bold, so it is never missed.
 */
export default function ConfirmDialog({
  spec,
  open,
  onCancel,
  onConfirm,
}: {
  spec: ConfirmSpec | null;
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  if (!spec) return null;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        if (confirmOnKey(event.key, spec.destructive) !== "confirm") return;
        // Before the focused cancel button turns the Enter into its own click.
        event.preventDefault();
        onConfirm();
      }}
      data-testid="confirm-dialog"
    >
      <DialogTitle id={titleId}>{spec.title}</DialogTitle>
      <DialogContent>
        <DialogContentText id={descriptionId}>{spec.body}</DialogContentText>
        {spec.email && (
          <DialogContentText sx={{ mt: 1.5, fontWeight: 600, color: "text.primary" }} data-testid="confirm-email">
            {spec.email}
          </DialogContentText>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} autoFocus sx={TAP_TARGET} data-testid="confirm-dialog-cancel">
          {spec.cancelLabel}
        </Button>
        <Button
          variant="contained"
          color={spec.destructive ? "error" : "primary"}
          onClick={onConfirm}
          sx={TAP_TARGET}
          data-testid="confirm-dialog-confirm"
        >
          {spec.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
