"use client";

import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useRef, useState } from "react";
import { ACTION_ICONS } from "@/shared/ui/action-icons";
import { CHECKBOX_TAP_TARGET } from "@/shared/ui/tap-target";

/**
 * The bulk verbs of the events list, in one bar above it (`DECISIONS.md` §114; the owner:
 * "these batches are strange, I should be able to batch delete all"). It was a fold below the
 * table — out of sight of the ticks it acted on, with no way to tick everything and no delete.
 *
 * The one client island the list has, and it earns it: "select all" and "N ticked" need to
 * see the row checkboxes, which belong to this form by `form={formId}` and live in the table
 * above. The bar owns the `<form>`; each verb is a submit button with its own Server Action
 * as `formAction`, so the browser posts the same ticks to whichever was pressed. Delete asks
 * first; publish and archive are a click away from being undone and ask nothing. Without
 * JavaScript the buttons still post — only the counter and "select all" go quiet.
 */
type Action = (form: FormData) => Promise<void>;

/** The three verbs' glyphs, from the shared registry (§170). */
const PublishGlyph = ACTION_ICONS.publish;
const ArchiveGlyph = ACTION_ICONS.archive;
const DeleteGlyph = ACTION_ICONS.delete;

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
    confirmTitle: string;
    confirmBody: string;
    confirm: string;
    cancel: string;
  };
}) {
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);

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
          <Button
            type="submit"
            formAction={publish}
            variant="contained"
            size="small"
            disabled={idle}
            startIcon={<PublishGlyph fontSize="small" />}
            sx={{ textTransform: "none", minHeight: 36 }}
          >
            {labels.publish}
          </Button>
          <Button
            type="submit"
            formAction={archive}
            variant="outlined"
            size="small"
            disabled={idle}
            startIcon={<ArchiveGlyph fontSize="small" />}
            sx={{ textTransform: "none", minHeight: 36 }}
          >
            {labels.archive}
          </Button>
          {remove && (
            <Button
              ref={removeButton}
              type="submit"
              formAction={remove}
              variant="outlined"
              color="error"
              size="small"
              disabled={idle}
              startIcon={<DeleteGlyph fontSize="small" />}
              sx={{ textTransform: "none", minHeight: 36 }}
              onClick={(event) => {
                event.preventDefault();
                setConfirming(true);
              }}
            >
              {labels.remove}
            </Button>
          )}
        </form>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {labels.help}
      </Typography>

      <Dialog open={confirming} onClose={() => setConfirming(false)} aria-labelledby="bulk-delete-title">
        <DialogTitle id="bulk-delete-title">{labels.confirmTitle}</DialogTitle>
        <DialogContent>
          <DialogContentText>{labels.confirmBody}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)} sx={{ minHeight: 44 }}>
            {labels.cancel}
          </Button>
          <Button
            color="error"
            variant="contained"
            sx={{ minHeight: 44 }}
            onClick={() => {
              setConfirming(false);
              // The delete button as the submitter, so its `formAction` is the one posted to.
              if (removeButton.current) form.current?.requestSubmit(removeButton.current);
            }}
          >
            {labels.confirm}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
