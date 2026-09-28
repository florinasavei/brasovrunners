"use client";

import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * The events list's bulk verbs in one bar above it (§114). A client island because "select all"
 * and "N ticked" must see the row checkboxes, which join this form via `form={formId}`. Each verb
 * is a submit with its own Server Action as `formAction`, each confirming separately (§384).
 * Without JavaScript the buttons still post and the server refuses as before.
 */
type Action = (form: FormData) => Promise<void>;

/** The row checkboxes of the table above, which name this form as theirs. */
function rowBoxes(formId: string): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="eventRef"][form="${formId}"]`));
}

export default function BulkBar({
  formId,
  uiLocale,
  back = "",
  publish,
  archive,
  remove,
  labels,
}: {
  formId: string;
  uiLocale: string;
  /** The list's own query string, posted as `back` so the action returns to it (§527). */
  back?: string;
  publish: Action;
  archive: Action;
  /** Absent for a role that may not delete: the button is not rendered, and the server refuses anyway. */
  remove?: Action;
  labels: {
    selectAll: string;
    /** "{count} ticked" — a template, filled here: a function cannot cross from a Server Component. */
    selected: string;
    help: string;
    publish: string;
    archive: string;
    remove: string;
    publishTitle: string;
    publishBody: string;
    archiveTitle: string;
    archiveBody: string;
    deleteTitle: string;
    deleteBody: string;
    cancel: string;
  };
}) {
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const read = () => {
      const all = rowBoxes(formId);
      setTotal(all.length);
      setCount(all.filter((box) => box.checked).length);
    };
    read();
    // Every tick in the table bubbles here; no ref into a Server Component's rows is needed.
    document.addEventListener("change", read);
    return () => document.removeEventListener("change", read);
  }, [formId]);

  /** Nothing ticked and this island running (see the buttons below). */
  const idle = total > 0 && count === 0;

  const selectAll = (checked: boolean) => {
    for (const box of rowBoxes(formId)) {
      if (box.checked !== checked) box.click();
    }
  };

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={total > 0 && count === total}
              indeterminate={count > 0 && count < total}
              onChange={(event) => selectAll(event.target.checked)}
              sx={CHECKBOX_TAP_TARGET}
            />
          }
          label={labels.selectAll}
        />
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 80 }} aria-live="polite">
          {labels.selected.replace("{count}", String(count))}
        </Typography>
        <form id={formId} ref={form} action={archive} style={{ display: "contents" }}>
          <input type="hidden" name="uiLocale" value={uiLocale} />
          <input type="hidden" name="back" value={back} />
          {/*
            Dim while nothing is ticked (§170). `total > 0` means the island is running: without
            JavaScript it stays zero, the buttons still post, and the server answers "nothing
            ticked".
          */}
          <ConfirmSubmitButton
            formAction={publish}
            label={labels.publish}
            icon="publish"
            title={labels.publishTitle}
            body={labels.publishBody}
            confirmLabel={labels.publish}
            cancelLabel={labels.cancel}
            variant="contained"
            disabled={idle}
          />
          <ConfirmSubmitButton
            formAction={archive}
            label={labels.archive}
            icon="archive"
            title={labels.archiveTitle}
            body={labels.archiveBody}
            confirmLabel={labels.archive}
            cancelLabel={labels.cancel}
            color="warning"
            disabled={idle}
          />
          {remove && (
            <ConfirmSubmitButton
              formAction={remove}
              label={labels.remove}
              icon="delete"
              title={labels.deleteTitle}
              body={labels.deleteBody}
              confirmLabel={labels.remove}
              cancelLabel={labels.cancel}
              color="error"
              disabled={idle}
            />
          )}
        </form>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {labels.help}
      </Typography>
    </Stack>
  );
}
