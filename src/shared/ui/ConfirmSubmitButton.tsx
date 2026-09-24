"use client";

import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { useRef, useState } from "react";
import { ACTION_ICONS, type ActionIconName } from "./action-icons";

type Props = {
  label: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  color?: "primary" | "error" | "warning";
  variant?: "text" | "outlined" | "contained";
  size?: "small" | "medium";
  /** A glyph before the verb, by name — never as an element (`action-icons.ts`). */
  icon?: ActionIconName;
  /**
   * A second Server Action for the form this button sits in (§287).
   *
   * One selection cannot belong to two forms — a checkbox's `form` attribute names exactly one —
   * so the list's bulk panel is one form with two verbs, and the button says which. React reads
   * `formAction` on the submitter and routes there, which is the supported way to have two
   * actions behind one set of fields.
   */
  formAction?: (formData: FormData) => void | Promise<void>;
  /**
   * The id of the form this button submits, when it sits inside another one (§NNN): the event
   * editor's "Alocă numerele" is drawn in the bib card of the save form, and posts the small form
   * rendered after it — HTML forms cannot nest, and the `form` attribute is how a control belongs
   * to a form it is not inside.
   */
  form?: string;
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
  formAction,
  title,
  body,
  confirmLabel,
  cancelLabel,
  color = "primary",
  variant = "outlined",
  size = "small",
  icon,
  form,
}: Props) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const Icon = icon ? ACTION_ICONS[icon] : null;

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
        form={form}
        formAction={formAction}
        variant={variant}
        color={color}
        size={size}
        sx={{ minHeight: 44 }}
        startIcon={Icon ? <Icon fontSize="small" /> : undefined}
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
              // With a second action, the *button* is the submitter React reads it from — so the
              // form is asked to submit through this control rather than by itself (§287).
              const form = anchor.current?.form;
              if (formAction && anchor.current) form?.requestSubmit(anchor.current);
              else form?.requestSubmit();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
