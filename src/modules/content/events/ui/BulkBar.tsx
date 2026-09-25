"use client";

import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import ConfirmSubmitButton from "@/shared/ui/ConfirmSubmitButton";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * The bulk verbs of the events list, in one bar above it (`DECISIONS.md` §114; the owner:
 * "these batches are strange, I should be able to batch delete all"). It was a fold below the
 * table — out of sight of the ticks it acted on, with no way to tick everything and no delete.
 *
 * The one client island the list has, and it earns it: "select all" and "N ticked" need to
 * see the row checkboxes, which belong to this form by `form={formId}` and live in the table
 * above. The bar owns the `<form>`; each verb is a submit button with its own Server Action
 * as `formAction`, so the browser posts the same ticks to whichever was pressed. Every verb
 * asks first (§384) — publishing and archiving face the site, deleting cannot be undone — through
 * the one `ConfirmSubmitButton`, since one selection feeds three actions and a form-level question
 * could not tell them apart. Without JavaScript the buttons still post — only the counter, "select
 * all" and the questions go quiet, and the server refuses exactly as before.
 */
type Action = (form: FormData) => Promise<void>;

/** The row checkboxes of the table above, which name this form as theirs. */
function rowBoxes(formId: string): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="eventRef"][form="${formId}"]`));
}

export default function BulkBar({
  formId,
  uiLocale,
  publish,
  archive,
  remove,
  labels,
}: {
  formId: string;
  uiLocale: string;
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

  /** Nothing ticked, and this island is running — see the buttons below for why both halves. */
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
          {/*
            Dim while nothing is ticked (§170; the owner: "trebe să fie active doar dacă
            selectez ceva"), and each verb wears its glyph ("și butoanele astea au nevoie de
            iconițe").

            `total > 0` is the honest test for "this island is running": it is zero until the
            effect above has counted the rows, which is exactly the state a browser without
            JavaScript stays in — there the buttons still post, and the server answers "nothing
            ticked" as it always did. The server-side refusal is untouched either way.
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
