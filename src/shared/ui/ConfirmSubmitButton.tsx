"use client";

import Button from "@mui/material/Button";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import ConfirmDialog from "@/shared/feedback/ConfirmDialog";
import { type ConfirmSpec, type EmailCount, resolveEmailCount } from "@/shared/feedback/notice";
import { ACTION_ICONS, type ActionIconName } from "./action-icons";

type Props = {
  label: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** "An email will be sent to N participants", worded on the server (`ConfirmSpec.email`). */
  email?: string;
  /**
   * The same sentence counted at the press from the form's ticked values (`ConfirmSpec.emailCount`):
   * the bulk cancel's ticks exist only in the browser, so the server hands the count each tick adds
   * and the dialog sums the ticked ones when it opens. Replaces `email`.
   */
  emailCount?: EmailCount;
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
   * The id of the form this button submits, when it sits inside another one (§350): the event
   * editor's "Alocă numerele" is drawn in the bib card of the save form, and posts the small form
   * rendered after it — HTML forms cannot nest, and the `form` attribute is how a control belongs
   * to a form it is not inside.
   */
  form?: string;
  disabled?: boolean;
  /**
   * What the button says while the form it confirmed is on its way (§371: "Se anulează…" on the
   * bulk cancel). Only when this button sent it: the submission carries the button's own
   * name and value, so a second verb of the same form never borrows the label.
   */
  pendingLabel?: string;
};

/** The field a confirmed press posts to name itself, so the pending label is this button's alone. */
const SUBMITTER_FIELD = "confirmedVerb";

/**
 * A submit button that asks first — for a form with **several verbs** (§NNN).
 *
 * A single-verb form asks through `ActionForm`'s `confirm` prop, which is where the question
 * belongs when there is one; this button is for the bulk bars, where one selection feeds two or
 * three Server Actions and each verb needs its own question: the events list's publish, archive
 * and delete, the registrations list's cancel and erase. The dialog is the same `ConfirmDialog`
 * every other question uses, and what it finally does is `requestSubmit()` on the form with this
 * button as the submitter, so the same Server Action receives the same fields.
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
  email,
  emailCount,
  color = "primary",
  variant = "outlined",
  size = "small",
  icon,
  form,
  disabled,
  pendingLabel,
}: Props) {
  const [open, setOpen] = useState<ConfirmSpec | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const Icon = icon ? ACTION_ICONS[icon] : null;
  const spec: ConfirmSpec = { title, body, confirmLabel, cancelLabel, email, emailCount, destructive: color === "error" };
  // The parent form's status: meaningful only for a button inside its form (not one tied by `form=`).
  const status = useFormStatus();
  const pending = pendingLabel !== undefined && status.pending && status.data?.get(SUBMITTER_FIELD) === label;

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
        disabled={disabled}
        name={pendingLabel !== undefined ? SUBMITTER_FIELD : undefined}
        value={pendingLabel !== undefined ? label : undefined}
        aria-busy={pending || undefined}
        sx={{ minHeight: 44 }}
        startIcon={Icon ? <Icon fontSize="small" /> : undefined}
        onClick={(event) => {
          event.preventDefault();
          if (pending) return;
          // The ticks as they are at this press, the checkboxes tied by `form=` included.
          const target = anchor.current?.form;
          const data = target ? new FormData(target) : null;
          setOpen(resolveEmailCount(spec, (field) => (data ? data.getAll(field).filter((value): value is string => typeof value === "string") : [])));
        }}
      >
        {pending ? pendingLabel : label}
      </Button>

      {open && (
        <ConfirmDialog
          spec={open}
          open
          onCancel={() => setOpen(null)}
          onConfirm={() => {
            setOpen(null);
            // `requestSubmit` rather than `submit()`: it runs the form's own validation and
            // fires the submit event React's Server Action handler is listening for. The
            // plain `submit()` bypasses both and posts nothing useful.
            // With a second action, the *button* is the submitter React reads it from — so the
            // form is asked to submit through this control rather than by itself (§287).
            const target = anchor.current?.form;
            // So is a button with a pending label: its name and value are how the status knows it.
            if ((formAction || pendingLabel !== undefined) && anchor.current) target?.requestSubmit(anchor.current);
            else target?.requestSubmit();
          }}
        />
      )}
    </>
  );
}
