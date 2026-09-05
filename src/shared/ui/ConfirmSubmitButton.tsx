"use client";

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { useRef, useState } from "react";

type Props = {
  label: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  color?: "primary" | "error" | "warning";
  variant?: "text" | "outlined" | "contained";
  size?: "small" | "medium";
};

/**
 * A submit button that asks first.
 *
 * Deleting an event, duplicating one, clearing a queue of test registrations and archiving are
 * all one click away in the backoffice, and three of the four are hard to undo. This wraps the
 * button in a confirmation without changing anything behind it: the dialog is a Client
 * Component, and what it finally does is `requestSubmit()` on the form it already sits inside,
 * so the same Server Action receives the same fields.
 *
 * **Confirmation is UX and only UX.** Every server-side check stays exactly where it is — the
 * role, the version guard, the refusal to delete an event with registrations against it. This
 * asks "are you sure"; it does not decide anything. With JavaScript disabled the fallback below
 * submits directly, which is the honest behaviour: the guards that matter are on the server.
 */
export default function ConfirmSubmitButton({
  label,
  title,
  body,
  confirmLabel,
  cancelLabel,
  color = "primary",
  variant = "outlined",
  size = "small",
}: Props) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  return (
    <>
      {/*
        `type="submit"` is the fallback: without JavaScript this is an ordinary submit button
        and the form posts as it always did. With JavaScript, `preventDefault` turns it into the
        dialog's trigger.
      */}
      <Button
        ref={anchor}
        type="submit"
        variant={variant}
        color={color}
        size={size}
        sx={{ minHeight: 44 }}
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        {label}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby="confirm-title">
        <DialogTitle id="confirm-title">{title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{body}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} sx={{ minHeight: 44 }}>
            {cancelLabel}
          </Button>
          <Button
            color={color}
            variant="contained"
            sx={{ minHeight: 44 }}
            onClick={() => {
              setOpen(false);
              // `requestSubmit` rather than `submit()`: it runs the form's own validation and
              // fires the submit event React's Server Action handler is listening for. The
              // plain `submit()` bypasses both and posts nothing useful.
              anchor.current?.form?.requestSubmit();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
